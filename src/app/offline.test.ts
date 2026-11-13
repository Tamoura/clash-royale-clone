import { describe, expect, it, vi } from "vitest";
import sw from "../../public/sw.js?raw";
import lobbySrc from "../ui/screens/lobby.ts?raw";
import mainSrc from "../main.ts?raw";
import {
  ASK_READY_MESSAGE,
  FRESH_PARAM,
  OFFLINE_READY_SEEN_KEY,
  READY_MESSAGE,
  calmGate,
  freshUrl,
  reloadToNewest,
  startOfflineSupport,
  withoutFresh,
  type CalmDeps,
  type ContainerLike,
  type OfflineDeps,
  type ReloadDeps,
} from "./offline";

/** The worker's spelling of a constant (public/sw.js and this module must agree). */
const swConst = (name: string): string | undefined => new RegExp(`const ${name} = "([^"]+)";`).exec(sw)?.[1];

describe("the page and the worker agree", () => {
  it("on the fresh mark and the ready messages", () => {
    expect(swConst("FRESH_PARAM")).toBe(FRESH_PARAM);
    expect(swConst("READY")).toBe(READY_MESSAGE);
    expect(swConst("ASK_READY")).toBe(ASK_READY_MESSAGE);
    expect(OFFLINE_READY_SEEN_KEY).toBe("cr-clone-offline-ready-seen");
  });
});

describe("the fresh mark", () => {
  it("is added with a new value each time and taken off cleanly", () => {
    const a = freshUrl("https://game.example/?quality=low#x", 1000);
    const b = freshUrl("https://game.example/?quality=low#x", 2000);
    expect(a).not.toBe(b);
    expect(new URL(a).searchParams.get("quality")).toBe("low");
    expect(withoutFresh(a)).toBe("https://game.example/?quality=low#x");
    expect(withoutFresh(freshUrl("https://tamoura.github.io/clash-royale-clone/", 5))).toBe("https://tamoura.github.io/clash-royale-clone/");
    expect(withoutFresh("https://game.example/?quality=low")).toBeNull();
  });
});

/** A fake registration whose update finds a new worker that activates when `activate()` is called. */
function registration(opts: { newWorker?: boolean; updateFails?: boolean; updateHangs?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const worker = {
    state: "installing",
    addEventListener: (_: "statechange", fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: "statechange", fn: () => void) => void listeners.delete(fn),
  };
  const reg = {
    installing: null as typeof worker | null,
    waiting: null as typeof worker | null,
    update: async () => {
      if (opts.updateHangs) return new Promise(() => undefined);
      if (opts.updateFails) throw new TypeError("offline");
      if (opts.newWorker) reg.installing = worker;
      return reg;
    },
  };
  return {
    reg,
    activate(): void {
      worker.state = "activated";
      reg.installing = null;
      for (const fn of [...listeners]) fn();
    },
  };
}

function reloadDeps(over: Partial<ReloadDeps> = {}): ReloadDeps & { went: string[] } {
  const went: string[] = [];
  return { getRegistration: null, href: "https://game.example/?quality=low", go: (h) => void went.push(h), went, ...over };
}

describe("the 'update needed' reload lands on the newest game", () => {
  it("waits for the new worker to take over, then reloads with the fresh mark", async () => {
    vi.useFakeTimers();
    try {
      const r = registration({ newWorker: true });
      const deps = reloadDeps({ getRegistration: async () => r.reg });
      const done = reloadToNewest(deps);
      await vi.advanceTimersByTimeAsync(2000);
      expect(deps.went).toEqual([]); // still waiting for the worker
      r.activate();
      await done;
      expect(deps.went).toHaveLength(1);
      const url = new URL(deps.went[0]);
      expect(url.searchParams.has(FRESH_PARAM)).toBe(true);
      expect(url.searchParams.get("quality")).toBe("low");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads at once when there is no newer worker or no worker support", async () => {
    const r = registration();
    const a = reloadDeps({ getRegistration: async () => r.reg });
    await reloadToNewest(a);
    expect(a.went).toHaveLength(1);
    const b = reloadDeps();
    await reloadToNewest(b);
    expect(new URL(b.went[0]).searchParams.has(FRESH_PARAM)).toBe(true);
  });

  it("never hangs: a failing or stalled update, or a worker that never activates, still reloads", async () => {
    vi.useFakeTimers();
    try {
      for (const opts of [{ updateFails: true }, { updateHangs: true }, { newWorker: true }]) {
        const r = registration(opts);
        const onWait = vi.fn();
        const deps = reloadDeps({ getRegistration: async () => r.reg, onWait });
        const done = reloadToNewest(deps);
        await vi.advanceTimersByTimeAsync(20_000);
        await done;
        expect(deps.went).toHaveLength(1);
        // A long wait shows the "getting the newest game" note; a quick one does not.
        expect(onWait).toHaveBeenCalledTimes(opts.updateFails ? 0 : 1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("is what the lobby's Reload button calls", () => {
    const at = lobbySrc.indexOf('failed === "update-required"');
    const block = lobbySrc.slice(at, at + 300);
    expect(block).toContain("reloadToNewest()");
    expect(block).not.toContain("location.reload()");
  });
});

/** A fake navigator.serviceWorker. */
function container() {
  const fns = new Set<(e: { data: unknown }) => void>();
  const posted: unknown[] = [];
  const registered: string[] = [];
  const c: ContainerLike & { send(data: unknown): void; posted: unknown[]; registered: string[] } = {
    register: async (url) => void registered.push(url),
    ready: Promise.resolve({ active: { postMessage: (m: unknown) => void posted.push(m) } }),
    addEventListener: (_t, fn) => void fns.add(fn),
    removeEventListener: (_t, fn) => void fns.delete(fn),
    send: (data) => [...fns].forEach((fn) => fn({ data })),
    posted,
    registered,
  };
  return c;
}

function offlineDeps(over: Partial<OfflineDeps> = {}) {
  const store = new Map<string, string>();
  const shown: string[] = [];
  const calm: (() => void)[] = [];
  const replaced: string[] = [];
  const deps: OfflineDeps = {
    container: container(),
    workerUrl: "/sw.js",
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    href: "https://game.example/",
    replaceHref: (h) => void replaced.push(h),
    afterLoad: (fn) => fn(),
    whenCalm: (fn) => void calm.push(fn),
    onReady: () => void shown.push("ready"),
    ...over,
  };
  return { deps, store, shown, replaced, calmed: () => calm.splice(0).forEach((fn) => fn()) };
}

describe("startOfflineSupport", () => {
  it("registers the worker and asks whether this build is already cached", async () => {
    const t = offlineDeps();
    startOfflineSupport(t.deps);
    await Promise.resolve();
    const c = t.deps.container as ReturnType<typeof container>;
    expect(c.registered).toEqual(["/sw.js"]);
    await c.ready;
    await Promise.resolve();
    expect(c.posted).toEqual([{ type: ASK_READY_MESSAGE }]);
  });

  it("says 'ready to play offline' once per device, and only once the kid is on a menu", () => {
    const t = offlineDeps();
    startOfflineSupport(t.deps);
    const c = t.deps.container as ReturnType<typeof container>;
    c.send({ type: "something-else" });
    c.send({ type: READY_MESSAGE });
    c.send({ type: READY_MESSAGE }); // the broadcast and the answer to the question
    expect(t.shown).toEqual([]); // the splash, a battle or the tutorial is on screen
    t.calmed();
    expect(t.shown).toEqual(["ready"]);
    expect(t.store.get(OFFLINE_READY_SEEN_KEY)).toBe("1");
    // Next launch: never again.
    const next = offlineDeps({ storage: t.deps.storage });
    startOfflineSupport(next.deps);
    (next.deps.container as ReturnType<typeof container>).send({ type: READY_MESSAGE });
    next.calmed();
    expect(next.shown).toEqual([]);
  });

  it("takes the fresh mark off the address, also where there is no worker (dev, old browsers)", () => {
    const t = offlineDeps({ container: null, href: "https://game.example/?cr-fresh=abc&quality=low" });
    startOfflineSupport(t.deps);
    expect(t.replaced).toEqual(["https://game.example/?quality=low"]);
    const u = offlineDeps({ href: "https://game.example/" });
    startOfflineSupport(u.deps);
    expect(u.replaced).toEqual([]);
  });

  it("survives blocked storage", () => {
    const t = offlineDeps({
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => startOfflineSupport(t.deps)).not.toThrow();
    (t.deps.container as ReturnType<typeof container>).send({ type: READY_MESSAGE });
    expect(() => t.calmed()).not.toThrow();
    expect(t.shown).toEqual(["ready"]);
  });

  it("is started by main.ts, with the worker only in production builds", () => {
    // At the top of main.ts, before the boot shows its first screen (calmGate needs to see it).
    expect(mainSrc.indexOf("startOfflineSupport({")).toBeLessThan(mainSrc.indexOf('openHome();\n'));
    const at = mainSrc.indexOf("startOfflineSupport({");
    expect(at).toBeGreaterThan(0);
    const block = mainSrc.slice(at, at + 400);
    expect(block).toContain("import.meta.env.PROD ? {} : { container: null }");
    expect(block).toContain('tr("Ready to play offline!", "اللعبة جاهزة للعب بلا إنترنت!")');
    expect(mainSrc).not.toMatch(/serviceWorker\.register\(/);
  });
});

/** A fake page for calmGate: the boot and the screen hook, driven by the test. */
function calmPage() {
  let booted = false;
  const bootFns: (() => void)[] = [];
  const screenFns: ((s: { sceneMode: string }) => void)[] = [];
  const deps: CalmDeps = {
    booted: () => booted,
    onBooted: (fn) => void bootFns.push(fn),
    onScreen: (fn) => void screenFns.push(fn),
  };
  return {
    deps,
    boot: () => {
      booted = true;
      bootFns.splice(0).forEach((fn) => fn());
    },
    screen: (sceneMode: string) => screenFns.forEach((fn) => fn({ sceneMode })),
    watchingBoot: () => bootFns.length,
  };
}

describe("the offline note waits for a calm screen (never over a battle's cards)", () => {
  it("a first visit: the note waits through the guided battle and shows on the first Home", () => {
    const page = calmPage();
    const whenCalm = calmGate(page.deps);
    const shown: string[] = [];
    // The tutorial starts the boot in a battle; the worker finishes caching mid-battle.
    page.screen("battle");
    page.boot();
    whenCalm(() => shown.push("note"));
    expect(shown).toEqual([]);
    page.screen("battle"); // "Play again"
    expect(shown).toEqual([]);
    page.screen("diorama"); // Home
    expect(shown).toEqual(["note"]);
    page.screen("none");
    page.screen("diorama");
    expect(shown).toEqual(["note"]); // once
  });

  it("waits for the splash to go, even on Home", () => {
    const page = calmPage();
    const whenCalm = calmGate(page.deps);
    const shown: string[] = [];
    page.screen("diorama"); // Home is built under the splash
    whenCalm(() => shown.push("note"));
    expect(shown).toEqual([]);
    expect(page.watchingBoot()).toBe(1);
    page.boot();
    expect(shown).toEqual(["note"]);
  });

  it("shows at once on a menu, and nothing counts as calm before a first screen", () => {
    const page = calmPage();
    const whenCalm = calmGate(page.deps);
    const shown: string[] = [];
    page.boot();
    whenCalm(() => shown.push("before"));
    expect(shown).toEqual([]); // no screen seen yet
    page.screen("none"); // a picker (collection, lobby)
    expect(shown).toEqual(["before"]);
    whenCalm(() => shown.push("now"));
    expect(shown).toEqual(["before", "now"]);
    expect(page.watchingBoot()).toBe(0); // already booted: no boot watch
  });
});
