import { describe, expect, it } from "vitest";
import sw from "../../public/sw.js?raw";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";
import { BUILD_ID_PLACEHOLDER, composeBuildId, stampBuildId } from "./swStamp";

describe("service worker versioning", () => {
  it("names its cache after a build id the build stamps in", () => {
    expect(sw).toContain(`const BUILD_ID = "${BUILD_ID_PLACEHOLDER}"`);
    expect(sw).toMatch(/const CACHE = `cr-clone-\$\{BUILD_ID\}`/);
    // vite.config.ts wires the stamp into the built copy of sw.js.
    expect(viteConfig).toContain("stampBuildId");
    expect(viteConfig).toContain('"sw.js"');
  });

  it("two builds stamp different ids and no placeholder survives", () => {
    const a = stampBuildId(sw, composeBuildId("abc1234", 1_000, 123_456_789n));
    const b = stampBuildId(sw, composeBuildId("abc1234", 1_000, 123_456_790n)); // same sha, same millisecond
    const c = stampBuildId(sw, composeBuildId("abc1234", 1_001, 123_456_789n));
    for (const src of [a, b, c]) expect(src).not.toContain(BUILD_ID_PLACEHOLDER);
    const id = (src: string): string => /const BUILD_ID = "([^"]+)"/.exec(src)![1];
    expect(new Set([id(a), id(b), id(c)]).size).toBe(3);
    expect(id(a)).toMatch(/^abc1234-[0-9a-z]+$/);
    expect(composeBuildId("", 5, 5n)).toMatch(/^nogit-/);
  });

  it("deletes every older cache when it activates", () => {
    const activate = sw.slice(sw.indexOf('addEventListener("activate"'), sw.indexOf('addEventListener("fetch"'));
    expect(activate.replace(/\s+/g, "")).toContain("caches.keys()");
    expect(activate).toContain("k !== CACHE");
    expect(activate).toContain("caches.delete(k)");
    expect(activate).toContain("clients.claim()");
  });

  it("serves /assets/* cache-first with no background refetch, and pages network-first", () => {
    expect(sw).toContain('new URL("assets/", self.registration.scope)');
    const from = sw.indexOf("url.pathname.startsWith(ASSETS)");
    const to = sw.indexOf("event.respondWith(\n    caches.match(req).then((hit) => {\n      const refresh");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const assets = sw.slice(from, to);
    // A hit returns at once; only a miss reaches the network, and nothing refreshes a hit.
    expect(assets).toContain("hit ??");
    expect(assets).not.toContain("refresh");
    const nav = sw.slice(sw.indexOf('req.mode === "navigate"'), from);
    expect(nav.indexOf("fetch(req)")).toBeLessThan(nav.indexOf("caches.match"));
  });
});

/** Runs public/sw.js in a fake service-worker scope with an in-memory Cache API. */
function bootSw(network: (path: string) => Promise<Response>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (k: unknown): string => (typeof k === "string" ? k : (k as { url: string }).url);
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (k: unknown, r: Response) => void store.set(keyOf(k), r),
        match: async (k: unknown) => store.get(keyOf(k))?.clone(),
        addAll: async () => undefined,
      };
    },
    match: async (k: unknown) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(k));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (k: string) => stores.delete(k),
  };
  const scope = {
    registration: { scope: "https://game.example/" },
    location: { origin: "https://game.example" },
    addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fetchStub = (req: { url: string }) => network(new URL(req.url).pathname);
  new Function("self", "caches", "fetch", sw)(scope, caches, fetchStub);

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return {
    /** A browser navigation to `path`: what the page gets. */
    async navigate(path: string): Promise<Response> {
      let responded: Promise<Response> | undefined;
      listeners.fetch({
        request: { method: "GET", url: `https://game.example${path}`, mode: "navigate" },
        respondWith: (p: Promise<Response>) => void (responded = p),
      });
      const res = await responded!;
      await settle();
      return res;
    },
    /** The cached offline shell's text, or null. */
    async shell(): Promise<string | null> {
      const hit = await caches.match("./");
      return hit ? hit.text() : null;
    },
  };
}

describe("service worker offline shell", () => {
  const game = `<!doctype html><html><head><title>Clash Royale Clone</title></head><body></body></html>`;
  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

  it("keeps the game's page, and only it, as the shell", async () => {
    let online = true;
    const sw = bootSw(async (path) => {
      if (!online) throw new TypeError("offline");
      if (path === "/") return html(game);
      if (path === "/healthz") {
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      }
      if (path === "/wake") return html("<html><title>Service waking up</title></html>");
      return html("<html><title>Bad gateway</title></html>", 502);
    });

    await sw.navigate("/");
    expect(await sw.shell()).toBe(game);

    // /healthz (step 3 of the deploy guide), a host's wake-up page and an
    // error page are shown when online, but never replace the shell.
    expect(await (await sw.navigate("/healthz")).text()).toContain('"ok":true');
    expect(await (await sw.navigate("/wake")).text()).toContain("waking up");
    expect((await sw.navigate("/broken")).status).toBe(502);
    expect(await sw.shell()).toBe(game);

    online = false;
    expect(await (await sw.navigate("/")).text()).toBe(game);
  });

  it("uses a marker the real index.html carries", () => {
    const mark = /const SHELL_MARK = "([^"]+)"/.exec(sw)?.[1];
    expect(mark).toBeTruthy();
    expect(indexHtml).toContain(mark!);
  });
});
