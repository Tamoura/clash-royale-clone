// @ts-expect-error -- "node:fs" has no type declarations here; Vitest runs in Node.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// @ts-expect-error -- as above.
import { tmpdir } from "node:os";
// @ts-expect-error -- as above.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sw from "../../public/sw.js?raw";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";
import manifestRaw from "../../public/manifest.webmanifest?raw";
import {
  BUILD_ID_PLACEHOLDER,
  PRECACHE_PLACEHOLDER,
  composeBuildId,
  precacheList,
  stampBuildId,
  stampPrecache,
  unlisted,
} from "./swStamp";

// ---- A fake service-worker world -------------------------------------------
// One origin's Cache Storage, its open pages and the network, shared by as
// many workers (builds) as a test starts, with a clock the test moves.

type Net = (url: URL, init?: RequestInit) => Promise<Response>;
type Listener = (event: Record<string, unknown>) => void;

interface Page {
  id: string;
  inbox: unknown[];
  postMessage(msg: unknown): void;
}

const ORIGIN = "https://game.example";
const offline: Net = async () => {
  throw new TypeError("offline");
};

function world(base = "/") {
  const scope = `${ORIGIN}${base}`;
  const stores = new Map<string, Map<string, Response>>();
  const pages: Page[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  let net: Net = offline;
  const requests: string[] = [];

  const keyOf = (k: unknown): string => {
    const u = new URL(typeof k === "string" ? k : (k as { url: string }).url, scope);
    u.hash = "";
    return u.href;
  };
  const fetchStub = (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(keyOf(input));
    requests.push(url.pathname + url.search);
    return net(url, init);
  };
  const storeOf = (name: string): Map<string, Response> => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  const caches = {
    open: async (name: string) => {
      const store = storeOf(name);
      return {
        match: async (k: unknown) => store.get(keyOf(k))?.clone(),
        put: async (k: unknown, res: Response) => {
          if (res.bodyUsed) throw new TypeError("body already used");
          store.set(keyOf(k), res);
        },
        add: async (k: unknown) => {
          const res = await fetchStub(keyOf(k));
          if (!res.ok) throw new TypeError("bad status");
          store.set(keyOf(k), res);
        },
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
    delete: async (name: string) => stores.delete(name),
  };
  /** Let every pending promise and zero-delay task run (the real clock, not the fake one). */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const w = {
    scope,
    stores,
    pages,
    requests,
    settle,
    setNetwork(fn: Net): void {
      net = fn;
    },
    openPage(id: string): Page {
      const page: Page = { id, inbox: [], postMessage: (msg) => void page.inbox.push(msg) };
      pages.push(page);
      return page;
    },
    closePage(id: string): void {
      const i = pages.findIndex((p) => p.id === id);
      if (i >= 0) pages.splice(i, 1);
    },
    /** Move the clock: due timers fire, then everything settles. */
    async advance(ms: number): Promise<void> {
      await settle();
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
        await settle();
      }
      await settle();
    },
    cacheNames: (): string[] => [...stores.keys()],
    /** The paths a cache holds, scope-relative ("./" is the shell). */
    held(name: string): string[] {
      return [...(stores.get(name)?.keys() ?? [])].map((k) => k.slice(scope.length) || "./").sort();
    },
    /** The text of a cache's shell, or null. */
    async shellIn(name: string): Promise<string | null> {
      const hit = stores.get(name)?.get(scope);
      return hit ? hit.clone().text() : null;
    },
    /** Start a worker running `source` (a stamped public/sw.js). */
    startWorker(source: string) {
      const listeners: Record<string, Listener> = {};
      const self = {
        registration: { scope },
        location: { origin: ORIGIN, href: `${scope}sw.js` },
        addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
        skipWaiting: async () => undefined,
        clients: {
          claim: async () => undefined,
          matchAll: async () => [...pages],
        },
      };
      const clock = (fn: () => void, ms: number) => void timers.push({ at: now + ms, fn });
      new Function("self", "caches", "fetch", "setTimeout", "Date", source)(self, caches, fetchStub, clock, {
        now: () => now,
      });

      const dispatch = (type: string, extra: Record<string, unknown> = {}) => {
        const pending: Promise<unknown>[] = [];
        let responded: Promise<Response> | undefined;
        listeners[type]?.({
          ...extra,
          waitUntil: (p: Promise<unknown>) => void pending.push(Promise.resolve(p)),
          respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)),
        });
        const done = (async () => {
          let seen = -1;
          while (seen !== pending.length) {
            seen = pending.length;
            await Promise.allSettled([...pending, responded]);
            await settle();
          }
        })();
        return { pending, responded, done };
      };
      return {
        /** The install event; true when it succeeded. */
        async install(): Promise<boolean> {
          const { pending, done } = dispatch("install");
          await done;
          return (await Promise.allSettled(pending)).every((r) => r.status === "fulfilled");
        },
        async activate(): Promise<void> {
          await dispatch("activate").done;
        },
        /** Install, then activate (the worker skips waiting): what a deploy does. */
        async deploy(): Promise<boolean> {
          if (!(await this.install())) return false;
          await this.activate();
          return true;
        },
        /** Start a navigation: `response` is what the browser shows, `done` waits for background work. */
        navigate(path = "", pageId = "next-page") {
          const { responded, done } = dispatch("fetch", {
            request: { method: "GET", url: new URL(path, scope).href, mode: "navigate" },
            resultingClientId: pageId,
            clientId: "",
          });
          return { response: responded!, done };
        },
        /** A navigation allowed to finish, with its page then open. */
        async open(path = "", pageId = "next-page"): Promise<{ text: string; status: number }> {
          const nav = this.navigate(path, pageId);
          const res = await nav.response;
          await nav.done;
          w.openPage(pageId);
          return { text: await res.text(), status: res.status };
        },
        /** A plain same-origin GET (not a navigation): the response, or null when the worker left it to the network. */
        async get(path: string, clientId = "page"): Promise<Response | null> {
          const { responded, done } = dispatch("fetch", {
            request: { method: "GET", url: new URL(path, scope).href, mode: "cors" },
            clientId,
          });
          await done;
          return responded ? responded : null;
        },
        async message(data: unknown, source: Page): Promise<void> {
          await dispatch("message", { data, source }).done;
        },
      };
    },
  };
  return w;
}

const html = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

/** A built index.html for `build`, linking its entry script, preload and styles as Vite writes them. */
const pageOf = (build: string, base = "/"): string =>
  `<!doctype html><html><head><meta name="cr-app-shell" content="game" /><title>Crown Rush</title>` +
  `<link rel="manifest" href="manifest.webmanifest" />` +
  `<script type="module" crossorigin src="${base}assets/index-${build}.js"></script>` +
  `<link rel="modulepreload" crossorigin href="${base}assets/three-${build}.js">` +
  `<link rel="stylesheet" crossorigin href="${base}assets/index-${build}.css"></head><body></body></html>`;

/** Every file `build` emitted under assets/ (scope-relative), as the plugin lists them. */
const filesOf = (build: string): string[] =>
  precacheList([
    "index.html",
    `assets/index-${build}.js`,
    `assets/three-${build}.js`,
    `assets/index-${build}.css`,
    `assets/roster-${build}.js`,
    `assets/lilita-${build}.woff2`,
  ]);

/** public/sw.js as `build` would ship it. */
const workerOf = (build: string, list = filesOf(build)): string => stampPrecache(stampBuildId(sw, build), list);

/**
 * A server holding one build (what Render or Pages serve after a deploy):
 * its page, its files, the cast and the icons. Anything else is a 404, like
 * an older build's hashed files once the new one is live.
 */
function serverOf(build: string, base = "/", opts: { failing?: string[] } = {}): Net {
  return async (url) => {
    const rel = url.pathname.slice(base.length);
    if (opts.failing?.includes(rel)) return new Response("busy", { status: 503 });
    if (rel === "" || rel === "index.html") return html(pageOf(build, base));
    if (filesOf(build).includes(rel)) return new Response(`/* ${build}: ${rel} */`, { headers: { "content-type": "text/javascript" } });
    if (rel.startsWith("models/") || /\.(png|webmanifest)$/.test(rel)) return new Response(`bin:${rel}`);
    if (rel === "healthz") return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  };
}

/** A network that never answers until `release` is called (a sleeping host, a stalled connection). */
function stalled(then: Net): { net: Net; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { net: async (url, init) => gate.then(() => then(url, init)), release };
}

/**
 * A server whose game page sends its headers and first bytes at once, then
 * holds the rest until `finish` is called (a weak signal in the car).
 * Every other file is `build`'s, as serverOf serves it.
 */
function stallingBody(build: string): { net: Net; finish: () => void } {
  const page = pageOf(build);
  const head = new TextEncoder().encode(page.slice(0, 120));
  const rest = new TextEncoder().encode(page.slice(120));
  const held: ReadableStreamDefaultController<Uint8Array>[] = [];
  const files = serverOf(build);
  return {
    net: async (url, init) => {
      if (url.pathname !== "/") return files(url, init);
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(head);
          held.push(c);
        },
      });
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
    finish: () => {
      for (const c of held.splice(0)) {
        c.enqueue(rest);
        c.close();
      }
    },
  };
}

/** Watch a pending response: `shown()` is the response once the browser has one. */
function watch(response: Promise<Response>): () => Response | undefined {
  let shown: Response | undefined;
  void response.then(
    (r) => (shown = r),
    () => undefined,
  );
  return () => shown;
}

const cacheOf = (build: string): string => `cr-clone-${build}`;
const bodyOf = async (res: Response | null): Promise<string> => (res ? res.text() : "");

// ---- Versioning and the precache list ---------------------------------------

describe("service worker versioning", () => {
  it("names its cache after a build id the build stamps in", () => {
    expect(sw).toContain(`const BUILD_ID = "${BUILD_ID_PLACEHOLDER}"`);
    expect(sw).toMatch(/const CACHE = `cr-clone-\$\{BUILD_ID\}`/);
    // vite.config.ts wires both stamps into the built copy of sw.js...
    expect(viteConfig).toContain("stampBuildId");
    expect(viteConfig).toContain("stampPrecache");
    expect(viteConfig).toContain('"sw.js"');
    // ...with one id per build, worked out once at module level (anything else stamped with it agrees).
    expect(viteConfig).toMatch(/^const BUILD_ID = buildId\(\);$/m);
    expect(viteConfig.match(/\bbuildId\(\)/g)).toHaveLength(2); // its definition and that one call
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
});

describe("service worker precache list", () => {
  /** The keys of a real build's Rollup output bundle (d5fda1d), plus a source map. */
  const bundle = [
    "index.html",
    "assets/index-CmFI_LGv.js",
    "assets/three-f4GkQ5GL.js",
    "assets/index-ClaLf9Gn.css",
    "assets/gallery-DL_OxGiy.js",
    "assets/meshopt_decoder.module-BvwdjiD3.js",
    "assets/GLTFLoader-SuCOoGrb.js",
    "assets/roster-BQ4Bfr6q.js",
    "assets/lilita-one-latin-400-normal-87r-Z-Re.woff2",
    "assets/lilita-one-latin-400-normal-DXkechA3.woff",
    "assets/baloo-bhaijaan-2-arabic-700-normal-BuUEWU-Z.woff2",
    "assets/baloo-bhaijaan-2-arabic-700-normal-C3qElwAX.woff",
    "assets/baloo-bhaijaan-2-arabic-800-normal-53vlEMIg.woff",
    "assets/baloo-bhaijaan-2-arabic-800-normal-seqr1dGG.woff2",
    "assets/index-CmFI_LGv.js.map",
  ];
  const keyed = (): Record<string, unknown> => Object.fromEntries(bundle.map((n) => [n, {}]));

  it("lists every emitted file under assets/ (scripts, styles, fonts), scope-relative and sorted", () => {
    const list = precacheList(bundle);
    expect(list).toHaveLength(13);
    for (const name of bundle) {
      if (name.startsWith("assets/") && !name.endsWith(".map")) expect(list).toContain(name);
    }
    expect(list).not.toContain("index.html"); // the page is the shell, fetched fresh at install
    expect(list.some((p) => p.endsWith(".map"))).toBe(false);
    for (const p of list) expect(p).toMatch(/^assets\/[^/]/); // no leading slash, no base path
    expect([...list].sort()).toEqual(list);
    // A custom assets folder, written any way the config allows.
    expect(precacheList(["static/a.js", "assets/b.js", "./static/c.css"], "./static/")).toEqual(["static/a.js", "static/c.css"]);
  });

  it("finds any file on disk the list misses (the build fails on it)", () => {
    const list = precacheList(bundle);
    const onDisk = bundle.filter((n) => n.startsWith("assets/")).map((n) => n.slice("assets/".length));
    expect(unlisted(list, onDisk)).toEqual([]);
    expect(unlisted(list, [...onDisk, "late-chunk-Zz9.js"])).toEqual(["assets/late-chunk-Zz9.js"]);
  });

  it("stamps the list into the worker's empty placeholder, which the source carries once", () => {
    expect(sw.split(PRECACHE_PLACEHOLDER).length).toBe(2);
    expect(sw).toMatch(/const PRECACHE = \/\* __PRECACHE__ \*\/ \[\];/);
    const out = stampPrecache(sw, ["assets/a.js", "assets/b.css"]);
    expect(out).toContain('const PRECACHE = ["assets/a.js","assets/b.css"];');
    expect(out).not.toContain("__PRECACHE__");
    expect(() => stampPrecache("const PRECACHE = [];", [])).toThrow(/placeholder/);
  });

  it("the build plugin stamps dist/sw.js with every emitted asset and fails on an unlisted one", async () => {
    // Imported by a computed path, so the type check here never pulls in the Node-only config.
    const configPath = "../../vite.config.ts";
    const { default: config } = (await import(/* @vite-ignore */ configPath)) as { default: { plugins?: unknown[] } };
    type StampPlugin = {
      configResolved: (c: unknown) => void;
      writeBundle: (o: { dir: string }, b: Record<string, unknown>) => void;
    };
    const plugin = (config.plugins ?? []).flat().find((p) => (p as { name?: string } | null)?.name === "sw-stamp") as StampPlugin;
    expect(plugin).toBeTruthy();
    plugin.configResolved({ build: { assetsDir: "assets" } });
    const dir = mkdtempSync(join(tmpdir(), "sw-stamp-"));
    try {
      mkdirSync(join(dir, "assets"));
      for (const name of bundle) if (name.startsWith("assets/")) writeFileSync(join(dir, name), "x");
      writeFileSync(join(dir, "sw.js"), sw);
      plugin.writeBundle({ dir }, keyed());
      const out = readFileSync(join(dir, "sw.js"), "utf8");
      const listed = JSON.parse(/const PRECACHE = (\[[^\]]*\]);/.exec(out)![1]) as string[];
      expect(listed).toEqual(precacheList(bundle));
      expect(out).not.toContain(BUILD_ID_PLACEHOLDER);
      // A file in dist/assets the bundle never mentioned: the build stops.
      writeFileSync(join(dir, "sw.js"), sw);
      writeFileSync(join(dir, "assets", "stray-Qq1.js"), "x");
      expect(() => plugin.writeBundle({ dir }, keyed())).toThrow(/stray-Qq1\.js/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- Install ------------------------------------------------------------------

describe("service worker install", () => {
  it("keeps the shell, every precache file, the cast and the icons", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    expect(await w.startWorker(workerOf("b1")).install()).toBe(true);
    const held = w.held(cacheOf("b1"));
    expect(held).toContain("./");
    for (const f of filesOf("b1")) expect(held).toContain(f);
    expect(held).toContain("models/troops/knight.glb");
    for (const f of ["manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) expect(held).toContain(f);
    expect(held).not.toContain("sw.js");
  });

  it("works under the GitHub Pages sub-path with the same scope-relative list", async () => {
    const w = world("/clash-royale-clone/");
    w.setNetwork(serverOf("p1", "/clash-royale-clone/"));
    const worker = w.startWorker(workerOf("p1"));
    expect(await worker.deploy()).toBe(true);
    const held = w.held(cacheOf("p1"));
    for (const f of [...filesOf("p1"), "./"]) expect(held).toContain(f);
    expect(w.requests).toContain("/clash-royale-clone/assets/index-p1.js");
    // Offline, the installed game opens and finds its files.
    w.setNetwork(offline);
    expect((await worker.open("/clash-royale-clone/")).text).toBe(pageOf("p1", "/clash-royale-clone/"));
    expect(await bodyOf(await worker.get("/clash-royale-clone/assets/three-p1.js"))).toContain("three-p1.js");
  });

  it("a failing file never fails the install, but the shell waits until every precache file is in", async () => {
    const w = world();
    // The cast's mage and one font fail to download.
    w.setNetwork(serverOf("b1", "/", { failing: ["models/troops/mage.glb", "assets/lilita-b1.woff2"] }));
    const worker = w.startWorker(workerOf("b1"));
    expect(await worker.deploy()).toBe(true);
    let held = w.held(cacheOf("b1"));
    expect(held).toContain("assets/index-b1.js");
    expect(held).not.toContain("models/troops/mage.glb");
    expect(held).not.toContain("./"); // not complete: no shell yet
    // The connection recovers: the next fetch tops the cache up and keeps the shell.
    w.setNetwork(serverOf("b1"));
    const page = w.openPage("p");
    await w.advance(10_000);
    await worker.get("icon-192.png", "p");
    held = w.held(cacheOf("b1"));
    expect(held).toContain("assets/lilita-b1.woff2");
    expect(held).toContain("./");
    expect(page.inbox).toContainEqual({ type: "cr-offline-ready" });
  });

  it("a missing cast file alone does not hold the shell back (the game falls back to its own roster)", async () => {
    const w = world();
    w.setNetwork(serverOf("b1", "/", { failing: ["models/troops/mage.glb"] }));
    await w.startWorker(workerOf("b1")).install();
    expect(w.held(cacheOf("b1"))).toContain("./");
  });

  it("does not install without this build's game page (offline, a wake-up page, an error, another deploy's page)", async () => {
    const nets: Net[] = [
      offline,
      async () => html("<html><title>Service waking up</title></html>"),
      async () => html(pageOf("b1"), 502),
      serverOf("b2"), // the host already serves the next build
    ];
    for (const net of nets) {
      const w = world();
      w.setNetwork(net);
      expect(await w.startWorker(workerOf("b1")).install()).toBe(false);
      expect(w.held(cacheOf("b1"))).not.toContain("./");
    }
  });
});

// ---- Navigations ----------------------------------------------------------------

describe("service worker navigations: the cached game never waits on a sleeping server", () => {
  /** A device with build b1 installed; from then on the server answers with `net`. */
  async function installed(net: Net) {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const worker = w.startWorker(workerOf("b1"));
    await worker.deploy();
    w.setNetwork(net);
    return { w, worker };
  }

  it("a fast game page from the network is shown (and kept)", async () => {
    const { w, worker } = await installed(serverOf("b1"));
    const nav = worker.navigate("");
    const shown = watch(nav.response);
    await w.settle();
    expect(await shown()!.text()).toBe(pageOf("b1"));
    await nav.done;
    expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
  });

  it("a slow page: the cached game after 2.5 s, and the network's page kept when it lands", async () => {
    const slow = stalled(serverOf("b1"));
    const { w, worker } = await installed(slow.net);
    // Mark the kept shell, to see the late page replace it.
    w.stores.get(cacheOf("b1"))!.set(w.scope, html(pageOf("b1").replace("<title>", "<title>kept ")));
    const nav = worker.navigate("");
    const shown = watch(nav.response);
    await w.advance(2000);
    expect(shown()).toBeUndefined(); // still giving the network its chance
    await w.advance(600);
    expect(await shown()!.text()).toContain("<title>kept ");
    slow.release();
    await nav.done;
    expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
  });

  it("a page that starts and then stalls: the cached game after 2.5 s all the same, the page kept once whole", async () => {
    const weak = stallingBody("b1");
    const { w, worker } = await installed(weak.net);
    w.stores.get(cacheOf("b1"))!.set(w.scope, html(pageOf("b1").replace("<title>", "<title>kept ")));
    const nav = worker.navigate("");
    const shown = watch(nav.response);
    await w.advance(2000);
    expect(shown()).toBeUndefined(); // the first bytes are in, the rest is still on its way
    await w.advance(600);
    expect(shown()).toBeDefined(); // the deadline covers the whole page, not just its first bytes
    expect(await shown()!.text()).toContain("<title>kept ");
    await w.advance(70_000);
    weak.finish();
    await nav.done;
    expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
    // ?cr-fresh gives a stalling page longer, but not for ever.
    const weak2 = stallingBody("b1");
    w.setNetwork(weak2.net);
    const fresh = worker.navigate("?cr-fresh=1");
    const freshShown = watch(fresh.response);
    await w.advance(11_000);
    expect(freshShown()).toBeUndefined();
    await w.advance(1100);
    expect(await freshShown()!.text()).toBe(pageOf("b1"));
    weak2.finish();
    await fresh.done;
  });

  it("a wake-up page, an error page or JSON is never shown or kept: the cached game at once", async () => {
    const nets: Net[] = [
      async () => html("<html><head><title>Service waking up</title></head><body>Please wait</body></html>"),
      async () => html("<html><title>Bad gateway</title></html>", 502),
      async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    ];
    for (const net of nets) {
      const { w, worker } = await installed(net);
      const nav = worker.navigate("");
      const shown = watch(nav.response);
      await w.settle();
      expect(shown()).toBeDefined(); // no timer needed: the answer was not the game
      expect(await shown()!.text()).toBe(pageOf("b1"));
      await nav.done;
      expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
    }
  });

  it("offline: the cached game at once (query strings too)", async () => {
    const { w, worker } = await installed(offline);
    const nav = worker.navigate("?quality=low");
    const shown = watch(nav.response);
    await w.settle();
    expect(await shown()!.text()).toBe(pageOf("b1"));
    expect((await worker.open("index.html")).text).toBe(pageOf("b1"));
  });

  it("the very first visit (nothing cached) waits for the network, however long", async () => {
    const w = world();
    const slow = stalled(serverOf("b1"));
    w.setNetwork(slow.net);
    // A worker that is active but holds no shell yet.
    const worker = w.startWorker(workerOf("b1"));
    const nav = worker.navigate("");
    const shown = watch(nav.response);
    await w.advance(60_000);
    expect(shown()).toBeUndefined();
    slow.release();
    await nav.done;
    expect(await shown()!.text()).toBe(pageOf("b1"));
    // Offline with nothing cached: the browser's own offline page (a network error).
    const w2 = world();
    await expect(w2.startWorker(workerOf("b1")).navigate("").response).rejects.toThrow();
  });

  it("?cr-fresh waits for the network's newest page, and still falls back to the cached game", async () => {
    const slow = stalled(serverOf("b2"));
    const { w, worker } = await installed(slow.net);
    const nav = worker.navigate("?cr-fresh=1");
    const shown = watch(nav.response);
    await w.advance(5000);
    expect(shown()).toBeUndefined(); // past the usual 2.5 s
    slow.release();
    await nav.done;
    expect(await shown()!.text()).toBe(pageOf("b2"));
    // Offline: the cached game, not an error.
    w.setNetwork(offline);
    expect((await worker.open("?cr-fresh=2")).text).toBe(pageOf("b1"));
  });

  it("other pages (/healthz, an old bookmark) are the network's, with the game as the offline fallback", async () => {
    const { w, worker } = await installed(serverOf("b1"));
    expect((await worker.open("healthz")).text).toContain('"ok":true');
    w.setNetwork(async () => html("<html><title>Service waking up</title></html>"));
    expect((await worker.open("wake")).text).toContain("waking up");
    w.setNetwork(offline);
    expect((await worker.open("healthz")).text).toBe(pageOf("b1"));
    expect(w.held(cacheOf("b1"))).not.toContain("healthz");
  });

  it("a newer deploy's page is shown but never kept as this build's shell", async () => {
    const { w, worker } = await installed(serverOf("b2"));
    expect((await worker.open("")).text).toBe(pageOf("b2"));
    expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
  });

  it("never serves or caches the worker script itself", async () => {
    const { w, worker } = await installed(serverOf("b1"));
    expect(await worker.get("sw.js")).toBeNull();
    expect(w.held(cacheOf("b1"))).not.toContain("sw.js");
  });
});

// ---- Upgrades -----------------------------------------------------------------

describe("service worker upgrades: a cached page always finds its own files", () => {
  it("old -> new -> newer: no launch blanks, each ends on the newest build, old caches go once unused", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    expect((await w1.open("", "kid-1")).text).toBe(pageOf("b1"));

    // Deploy b2 while the b1 page is open: the server drops b1's files.
    w.setNetwork(serverOf("b2"));
    const w2 = w.startWorker(workerOf("b2"));
    expect(await w2.deploy()).toBe(true);
    expect(w.cacheNames()).toEqual([cacheOf("b1"), cacheOf("b2")]); // b1's page is still open
    // The open b1 page lazy-loads a chunk: found in b1's cache, though the server 404s it.
    expect(await bodyOf(await w2.get("assets/roster-b1.js", "kid-1"))).toContain("b1: assets/roster-b1.js");

    // The kid closes the game and opens it again: the new build, and b1's cache goes.
    w.closePage("kid-1");
    expect((await w2.open("", "kid-2")).text).toBe(pageOf("b2"));
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);

    // Offline next time: the new build opens with all its files.
    w.setNetwork(offline);
    w.closePage("kid-2");
    expect((await w2.open("", "kid-3")).text).toBe(pageOf("b2"));
    for (const f of filesOf("b2")) expect(await bodyOf(await w2.get(f, "kid-3"))).toContain(f);

    // And again: b2 -> b3.
    w.setNetwork(serverOf("b3"));
    const w3 = w.startWorker(workerOf("b3"));
    expect(await w3.deploy()).toBe(true);
    expect(await bodyOf(await w3.get("assets/roster-b2.js", "kid-3"))).toContain("b2: assets/roster-b2.js");
    w.closePage("kid-3");
    w.setNetwork(offline);
    expect((await w3.open("", "kid-4")).text).toBe(pageOf("b3"));
    expect(w.cacheNames()).toEqual([cacheOf("b3")]);
  });

  it("a launch served the previous build's cached page while the new build activates still starts", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    // b2 is deployed, but the server is asleep: w1 shows b1's cached page after 2.5 s.
    const sleepy = stalled(serverOf("b2"));
    w.setNetwork(sleepy.net);
    const nav = w1.navigate("", "kid");
    const shown = watch(nav.response);
    await w.advance(2600);
    expect(await shown()!.text()).toBe(pageOf("b1"));
    w.openPage("kid");
    // The server wakes; the browser installs b2, which activates while the b1 page boots.
    sleepy.release();
    await nav.done;
    w.setNetwork(serverOf("b2"));
    const w2 = w.startWorker(workerOf("b2"));
    expect(await w2.deploy()).toBe(true);
    // Every file the b1 page asks for now comes through w2, from b1's cache.
    for (const f of filesOf("b1")) expect(await bodyOf(await w2.get(f, "kid"))).toContain(f);
    // w1 never kept b2's page as b1's shell.
    expect(await w.shellIn(cacheOf("b1"))).toBe(pageOf("b1"));
    // Next launch: the new build, and b1's cache goes once its page has closed.
    w.closePage("kid");
    expect((await w2.open("", "kid-2")).text).toBe(pageOf("b2"));
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);
  });

  it("a page open while a reload replaces it: the old cache goes on a later fetch, once that page is gone", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    await w1.open("", "old-tab");
    w.setNetwork(serverOf("b2"));
    const w2 = w.startWorker(workerOf("b2"));
    await w2.deploy();
    // The old tab reloads: during the navigation it is still open, so nothing is swept yet.
    const nav = w2.navigate("", "new-tab");
    await nav.response;
    await nav.done;
    expect(w.cacheNames()).toContain(cacheOf("b1"));
    w.closePage("old-tab");
    w.openPage("new-tab");
    await w.advance(10_000);
    await w2.get("assets/index-b2.js", "new-tab");
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);
  });

  it("an older build's page from the network (an HTTP or CDN cache) keeps its build's cache while it may need it", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    await w1.open("", "kid-1");
    w.setNetwork(serverOf("b2"));
    const w2 = w.startWorker(workerOf("b2"));
    await w2.deploy();
    expect(w.cacheNames()).toEqual([cacheOf("b1"), cacheOf("b2")]);
    w.closePage("kid-1");
    // The kid relaunches with nothing else open, and a cache on the way
    // (Pages' max-age, a CDN) answers at once with b1's page; b1's files are
    // already gone from the server.
    const b2 = serverOf("b2");
    w.setNetwork(async (url, init) => (url.pathname === "/" ? html(pageOf("b1")) : b2(url, init)));
    expect((await w2.open("", "kid-2")).text).toBe(pageOf("b1"));
    expect(w.cacheNames()).toContain(cacheOf("b1"));
    // Minutes later that page still finds every file it links or loads lazily.
    await w.advance(60_000);
    for (const f of filesOf("b1")) expect(await bodyOf(await w2.get(f, "kid-2"))).toContain(f);
    expect(w.cacheNames()).toContain(cacheOf("b1"));
    // Once it closes and the new build opens, b1's cache goes.
    w.closePage("kid-2");
    w.setNetwork(serverOf("b2"));
    expect((await w2.open("", "kid-3")).text).toBe(pageOf("b2"));
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);
  });

  it("a navigation that never became a page holds older caches only for a while", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    await w1.open("", "kid-1");
    w.setNetwork(serverOf("b2"));
    const w2 = w.startWorker(workerOf("b2"));
    await w2.deploy();
    w.closePage("kid-1");
    // An older page handed over, then the kid backs out before it starts.
    const b2 = serverOf("b2");
    w.setNetwork(async (url, init) => (url.pathname === "/" ? html(pageOf("b1")) : b2(url, init)));
    const nav = w2.navigate("", "gone");
    await nav.response;
    await nav.done;
    await w.advance(10_000);
    await w2.get("icon-192.png", "nobody");
    expect(w.cacheNames()).toContain(cacheOf("b1"));
    await w.advance(25_000);
    await w2.get("icon-192.png", "nobody");
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);
  });

  it("a new build whose install missed a file keeps opening the old build offline until it is complete", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const w1 = w.startWorker(workerOf("b1"));
    await w1.deploy();
    w.setNetwork(serverOf("b2", "/", { failing: ["assets/three-b2.js"] }));
    const w2 = w.startWorker(workerOf("b2"));
    expect(await w2.deploy()).toBe(true);
    expect(w.held(cacheOf("b2"))).not.toContain("./");
    // Offline launch: b2 is not complete, so b1's complete cache opens.
    w.setNetwork(offline);
    expect((await w2.open("", "kid")).text).toBe(pageOf("b1"));
    for (const f of filesOf("b1")) expect(await bodyOf(await w2.get(f, "kid"))).toContain(f);
    await w.advance(10_000);
    await w2.get("assets/index-b1.js", "kid");
    expect(w.cacheNames()).toContain(cacheOf("b1")); // never swept while it is the only complete build
    // Back online: the top-up completes b2, and the next launch is b2.
    w.setNetwork(serverOf("b2"));
    await w.advance(10_000);
    await w2.get("assets/index-b1.js", "kid");
    expect(w.held(cacheOf("b2"))).toContain("./");
    w.closePage("kid");
    w.setNetwork(offline);
    expect((await w2.open("", "kid-2")).text).toBe(pageOf("b2"));
    expect(w.cacheNames()).toEqual([cacheOf("b2")]);
  });

  it("a cache from before precaching (a shell without its files) is passed over, never served", async () => {
    const w = world();
    // What the d5fda1d worker left on many devices: the shell, but not its scripts.
    w.stores.set(cacheOf("legacy"), new Map([[w.scope, html(pageOf("legacy"))]]));
    w.setNetwork(serverOf("b2", "/", { failing: ["assets/index-b2.css"] }));
    const w2 = w.startWorker(workerOf("b2"));
    await w2.deploy();
    // b2 is not complete and the legacy shell cannot start: the network decides, however slow.
    const slow = stalled(serverOf("b2"));
    w.setNetwork(slow.net);
    const nav = w2.navigate("", "kid");
    const shown = watch(nav.response);
    await w.advance(5000);
    expect(shown()).toBeUndefined();
    slow.release();
    await nav.done;
    expect(await shown()!.text()).toBe(pageOf("b2"));
  });

  it("keeps at most two older builds while an old page stays open, and never touches other caches", async () => {
    const w = world();
    w.stores.set("someone-elses-cache", new Map());
    w.openPage("forever"); // a tab that never closes and that none of these workers served
    for (const b of ["b1", "b2", "b3", "b4", "b5"]) {
      w.setNetwork(serverOf(b));
      expect(await w.startWorker(workerOf(b)).deploy()).toBe(true);
    }
    expect(w.cacheNames()).toEqual(["someone-elses-cache", cacheOf("b3"), cacheOf("b4"), cacheOf("b5")]);
  });
});

// ---- Offline ready ---------------------------------------------------------------

describe("service worker: 'ready to play offline'", () => {
  it("tells open pages once the build is fully cached, and answers when asked", async () => {
    const w = world();
    const page = w.openPage("first-visit");
    w.setNetwork(serverOf("b1"));
    const worker = w.startWorker(workerOf("b1"));
    await worker.deploy();
    expect(page.inbox).toEqual([{ type: "cr-offline-ready" }]);
    await worker.message({ type: "cr-offline?" }, page);
    expect(page.inbox).toHaveLength(2);
  });

  it("stays quiet while a file is missing", async () => {
    const w = world();
    const page = w.openPage("first-visit");
    w.setNetwork(serverOf("b1", "/", { failing: ["assets/index-b1.js"] }));
    const worker = w.startWorker(workerOf("b1"));
    await worker.deploy();
    await worker.message({ type: "cr-offline?" }, page);
    expect(page.inbox).toEqual([]);
  });
});

// ---- The shell marker ---------------------------------------------------------------

/** The shell marker as public/sw.js spells it. */
const SHELL_MARK = /const SHELL_MARK = (["'])(.+?)\1;/.exec(sw)?.[2];

describe("service worker offline shell", () => {
  const game = `<!doctype html><html><head><meta name="cr-app-shell" content="game" /><title>Crown Rush</title></head><body></body></html>`;
  const unstamped = cacheOf(BUILD_ID_PLACEHOLDER);

  it("keeps the game's page, and only it, as the shell", async () => {
    let online = true;
    const w = world();
    w.setNetwork(async (url) => {
      if (!online) throw new TypeError("offline");
      if (url.pathname === "/") return html(game);
      if (url.pathname === "/healthz") return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      if (url.pathname === "/wake") return html("<html><title>Service waking up</title></html>");
      return html("<html><title>Bad gateway</title></html>", 502);
    });
    const worker = w.startWorker(sw);

    await worker.open("/");
    expect(await w.shellIn(unstamped)).toBe(game);
    // /healthz (step 3 of the deploy guide), a host's wake-up page and an
    // error page are shown when online, but never replace the shell.
    expect((await worker.open("/healthz")).text).toContain('"ok":true');
    expect((await worker.open("/wake")).text).toContain("waking up");
    expect((await worker.open("/broken")).status).toBe(502);
    expect(await w.shellIn(unstamped)).toBe(game);

    online = false;
    expect((await worker.open("/")).text).toBe(game);
  });

  it("uses a marker the real index.html carries", () => {
    expect(SHELL_MARK).toBeTruthy();
    expect(indexHtml).toContain(SHELL_MARK!);
    // Exactly once, on its own meta line (not some text that could move).
    expect(indexHtml.split(SHELL_MARK!).length).toBe(2);
    expect(indexHtml).toMatch(new RegExp(`<meta ${SHELL_MARK!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} content="game" />`));
  });

  it("does not depend on the game's title (renaming the game keeps offline play)", async () => {
    expect(SHELL_MARK).not.toMatch(/title/i);
    const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1] ?? "";
    expect(title).not.toBe("");
    expect(title).not.toContain(SHELL_MARK!);
    let page = "";
    const w = world();
    w.setNetwork(async () => html(page));
    const worker = w.startWorker(sw);
    // Another name, same marker: still the game, still kept.
    page = `<html><head><meta name="cr-app-shell" content="game" /><title>Some new name</title></head></html>`;
    await worker.open("/");
    expect(await w.shellIn(unstamped)).toBe(page);
    // The game's name without the marker (a host's page, say): never kept.
    const kept = page;
    page = `<html><head><title>${title}</title></head><body>Bad gateway</body></html>`;
    await worker.open("/");
    expect(await w.shellIn(unstamped)).toBe(kept);
  });
});

describe("service worker: the modelled cast and the icons are precached per build", () => {
  it("lists exactly the pack the loader fetches and public/models/troops holds", async () => {
    const { FILES } = await import("../render3d/cast/types");
    const cast = /const CAST = \[([^\]]+)\]/.exec(sw)![1].match(/[a-z_]+/g)!;
    // The files themselves are never loaded here: only the glob's keys are read.
    const onDisk = Object.keys(import.meta.glob("../../public/models/troops/*.glb")).map((f) => /([a-z_]+)\.glb$/.exec(f)![1]);
    expect([...cast].sort()).toEqual([...onDisk].sort());
    expect([...cast].sort()).toEqual(["anims", ...FILES].sort());
  });

  it("lists every icon and the manifest that index.html and the manifest link, and they exist", () => {
    const appFiles = JSON.parse(/const APP_FILES = (\[[^\]]*\]);/.exec(sw)![1]) as string[];
    const inPublic = Object.keys(import.meta.glob("../../public/*.{png,webmanifest}")).map((f) => f.replace("../../public/", ""));
    for (const f of appFiles) expect(inPublic).toContain(f);
    const linked = [...indexHtml.matchAll(/<link rel="(?:manifest|apple-touch-icon|icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const icons = (JSON.parse(manifestRaw) as { icons: { src: string }[] }).icons.map((i) => i.src);
    expect(linked.length).toBeGreaterThanOrEqual(3);
    for (const f of [...linked, ...icons]) expect(appFiles).toContain(f);
  });

  it("serves a cached model with no network round trip", async () => {
    const w = world();
    w.setNetwork(serverOf("b1"));
    const worker = w.startWorker(workerOf("b1"));
    await worker.deploy();
    w.setNetwork(offline);
    const before = w.requests.length;
    expect(await bodyOf(await worker.get("models/troops/rogue.glb"))).toBe("bin:models/troops/rogue.glb");
    expect(w.requests.length).toBe(before);
  });
});
