/**
 * The boot splash in index.html: it waits for the game's first frame, says
 * "still loading" after 12 s, and offers "Tap to try again" on a boot error
 * or after 45 s, in the saved edition's language. The watcher script is run
 * here as it is in the page, against a small fake document.
 */
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import { FakeDocument, FakeElement, FakeEvent } from "../ui/fakeDom.testkit";
import { GAME_NAME, GAME_NAME_AR } from "./brand";

const script = /<script id="boot-script">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? "";

interface Opts {
  theme?: string | null;
  search?: string;
  storageThrows?: boolean;
  /** False: the script runs while the page is still being parsed (no #boot yet). */
  parsed?: boolean;
  /** The rest of localStorage (the problem log); written back here. */
  stored?: Record<string, string>;
  /** The game's error traps are running: they cancel the splash's boot-problem event. */
  traps?: boolean;
}

/** The splash markup as index.html writes it. */
function buildSplash(doc: FakeDocument): FakeElement {
  const boot = doc.createElement("div");
  boot.id = "boot";
  const make = (tag: string, cls: string, text = ""): FakeElement => {
    const node = doc.createElement(tag);
    node.className = cls;
    node.textContent = text;
    boot.appendChild(node);
    return node;
  };
  make("div", "boot-crest");
  make("div", "boot-title", "Crown Rush");
  make("div", "boot-bar");
  make("p", "boot-note");
  make("button", "boot-retry", "Tap to try again").hidden = true;
  doc.body.appendChild(boot);
  return boot;
}

function run(opts: Opts = {}) {
  const doc = new FakeDocument();
  const state = doc as unknown as { readyState: string };
  state.readyState = opts.parsed === false ? "loading" : "interactive";
  let boot = opts.parsed === false ? null : buildSplash(doc);
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const went: string[] = [];
  const search = opts.search ?? "";
  const stored = opts.stored ?? {};
  const dispatched: { type: string; detail: unknown }[] = [];
  const win = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("blocked");
        return k === "cr-clone-arena-theme" ? (opts.theme ?? null) : (stored[k] ?? null);
      },
      setItem: (k: string, v: string) => {
        if (opts.storageThrows) throw new Error("blocked");
        stored[k] = v;
      },
    },
    dispatchEvent: (ev: { type: string; detail: unknown; cancelable: boolean }) => {
      dispatched.push({ type: ev.type, detail: ev.detail });
      return !(opts.traps && ev.cancelable); // the traps cancel it
    },
    location: {
      href: `https://game.example/${search}`,
      search,
      replace: (href: string) => void went.push(href),
      reload: () => void went.push("reload"),
    },
    setTimeout: (fn: () => void, ms: number) => void timers.push({ at: now + ms, fn }),
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] ??= []).push(fn),
  };
  new Function("window", "document", script)(win, doc);

  const t = {
    doc,
    went,
    get boot(): FakeElement {
      return boot!;
    },
    part: (cls: string): FakeElement => boot!.querySelector(`.${cls}`)!,
    /** The page finishes parsing (the splash is now in the document). */
    parse(): void {
      boot = buildSplash(doc);
      state.readyState = "interactive";
      doc.dispatchEvent(new FakeEvent("readystatechange"));
    },
    advance(ms: number): void {
      now += ms;
      for (const timer of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
    /** A window event, as the browser fires it. */
    fire(type: string, event: Record<string, unknown>): void {
      for (const fn of listeners[type] ?? []) fn(event);
    },
    /** A resource that failed to load (fires on its element, seen by capture listeners). */
    failLoad(tag: string, rel = ""): void {
      const el = doc.createElement(tag) as FakeElement & { rel: string };
      el.rel = rel;
      t.fire("error", { target: el });
    },
    booted: (): void => doc.body.classList.add("booted"),
    stored,
    dispatched,
    /** The problem log as the splash left it in storage. */
    log: (): Record<string, unknown>[] => JSON.parse(stored["cr-clone-problem-log"] ?? "[]") as Record<string, unknown>[],
    slow: (): boolean => boot!.classList.contains("is-slow"),
    failed: (): boolean => boot!.classList.contains("is-failed"),
    retryShown: (): boolean => !t.part("boot-retry").hidden,
    win,
  };
  return t;
}

describe("the boot splash in index.html", () => {
  it("has no blind fade and no 'load' trigger: it waits for main.ts's first frame", () => {
    expect(indexHtml).not.toMatch(/bootOut/);
    expect(indexHtml).not.toMatch(/addEventListener\("load"/);
    // The watcher sits in <head>, ahead of the game's scripts, so it hears their load errors.
    expect(script).not.toBe("");
    expect(indexHtml.indexOf('id="boot-script"')).toBeLessThan(indexHtml.indexOf("</head>"));
    // The splash is no longer hidden from screen readers (its line and button speak).
    expect(indexHtml).toMatch(/<div id="boot">/);
    expect(indexHtml).toMatch(/<p class="boot-note" role="status" aria-live="polite"><\/p>/);
    expect(indexHtml).toMatch(/<button class="boot-retry" type="button" hidden>Tap to try again<\/button>/);
    // Reduced motion still stills the bar (and the line does not fade in).
    expect(indexHtml).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*boot-bar::after \{ animation: none/);
  });

  it("stays until the game is ready, says 'still loading' at 12 s and offers a retry at 45 s", () => {
    const t = run();
    expect(t.part("boot-title").textContent).toBe(GAME_NAME);
    t.advance(11_000);
    expect(t.slow()).toBe(false);
    t.advance(1_000);
    expect(t.slow()).toBe(true);
    expect(t.part("boot-note").textContent).toBe("Still loading… nearly there!");
    expect(t.retryShown()).toBe(false);
    t.advance(33_000);
    expect(t.retryShown()).toBe(true);
    expect(t.part("boot-retry").textContent).toBe("Tap to try again");
    expect(t.failed()).toBe(false); // still loading: the bar keeps going
    expect(t.went).toEqual([]); // nothing reloads by itself
    // The game appears after all: body.booted takes the splash down in CSS.
    expect(indexHtml).toMatch(/body\.booted #boot \{\s*display: none;/);
  });

  it("does nothing once the game is on screen", () => {
    const t = run();
    t.advance(3_000);
    t.booted();
    t.advance(60_000);
    t.failLoad("script");
    t.fire("error", { target: t.win, message: "late bug" });
    expect(t.slow()).toBe(false);
    expect(t.failed()).toBe(false);
    expect(t.retryShown()).toBe(false);
  });

  it("'Tap to try again' reloads asking the worker for the newest page", () => {
    const t = run({ search: "?quality=low" });
    t.failLoad("script");
    expect(t.failed()).toBe(true);
    expect(t.retryShown()).toBe(true);
    t.part("boot-retry").dispatchEvent(new FakeEvent("click"));
    const url = new URL(t.went[0]);
    expect(url.searchParams.has("cr-fresh")).toBe(true);
    expect(url.searchParams.get("quality")).toBe("low");
    // A tap anywhere on a failed splash does the same.
    t.boot.dispatchEvent(new FakeEvent("click"));
    expect(t.went.length).toBeGreaterThanOrEqual(2);
  });

  it("fails on boot errors only: scripts, styles, module chunks and uncaught errors", () => {
    const cases: [string, (t: ReturnType<typeof run>) => void, boolean][] = [
      ["a script that failed to load", (t) => t.failLoad("script"), true],
      ["the stylesheet", (t) => t.failLoad("link", "stylesheet"), true],
      ["a module preload", (t) => t.failLoad("link", "modulepreload"), true],
      ["an uncaught error", (t) => t.fire("error", { target: t.win, message: "boom" }), true],
      ["an uncaught error with no target", (t) => t.fire("error", { message: "boom" }), true],
      ["a chunk that failed (Chrome)", (t) => t.fire("unhandledrejection", { reason: new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js") }), true],
      ["a chunk that failed (Safari)", (t) => t.fire("unhandledrejection", { reason: new TypeError("Importing a module script failed.") }), true],
      ["a chunk that failed (Firefox)", (t) => t.fire("unhandledrejection", { reason: new TypeError("error loading dynamically imported module") }), true],
      ["an image that failed", (t) => t.failLoad("img"), false],
      ["an icon link that failed", (t) => t.failLoad("link", "icon"), false],
      ["a sound that would not autoplay", (t) => t.fire("unhandledrejection", { reason: new Error("NotAllowedError: play() failed") }), false],
    ];
    for (const [what, act, fails] of cases) {
      const t = run();
      act(t);
      expect([what, t.failed()]).toEqual([what, fails]);
      expect([what, t.retryShown()]).toEqual([what, fails]);
    }
  });

  it("speaks Arabic, right to left on its own text only, in the Golden Age edition", () => {
    const t = run({ theme: "arabic" });
    expect(t.part("boot-title").textContent).toBe(GAME_NAME_AR);
    t.advance(12_000);
    expect(t.part("boot-note").textContent).toBe("ما زالت اللعبة تُحمَّل… اقتربنا!");
    t.advance(33_000);
    expect(t.part("boot-retry").textContent).toBe("اضغط لتحاول مجددًا");
    for (const cls of ["boot-title", "boot-note", "boot-retry"]) {
      expect(t.part(cls).getAttribute("dir")).toBe("rtl");
      expect(t.part(cls).getAttribute("lang")).toBe("ar");
    }
    expect(t.boot.getAttribute("dir")).toBeNull();
    expect(t.doc.documentElement.getAttribute("dir")).toBeNull();
    // Arabic-only words: no Latin letters or digits.
    for (const cls of ["boot-title", "boot-note", "boot-retry"]) expect(t.part(cls).textContent).not.toMatch(/[A-Za-z0-9]/);
  });

  it("falls back to English when storage is blocked, and for the Classic edition", () => {
    for (const opts of [{ storageThrows: true }, { theme: "normal" }]) {
      const t = run(opts);
      t.advance(12_000);
      expect(t.part("boot-note").textContent).toBe("Still loading… nearly there!");
      expect(t.part("boot-note").getAttribute("dir")).toBeNull();
    }
  });

  it("hears errors while the page is still parsing and fills the splash in once it is parsed", () => {
    const t = run({ parsed: false, theme: "arabic" });
    t.failLoad("link", "stylesheet"); // the style fails before the body is even read
    t.parse();
    expect(t.part("boot-title").textContent).toBe(GAME_NAME_AR);
    expect(t.failed()).toBe(true);
    expect(t.retryShown()).toBe(true);
  });

  it("steps aside for the portrait studio (?gallery=, a dev tool)", () => {
    const t = run({ search: "?gallery=knight" });
    expect(t.doc.body.classList.contains("booted")).toBe(true);
    t.fire("error", { target: t.win, message: "gallery mode" });
    expect(t.failed()).toBe(false);
  });
});

describe("the boot splash and the local problem log", () => {
  it("before the game's scripts run, writes a boot problem to storage in the log's own shape", async () => {
    const { loadProblems } = await import("./problemLog");
    const t = run({ theme: "arabic" });
    t.fire("error", { target: { tagName: "SCRIPT", src: "https://game.example/assets/index-Ab12.js?v=1" } });
    expect(t.failed()).toBe(true);
    const [entry] = t.log();
    expect(entry).toMatchObject({
      kind: "error",
      where: "boot splash",
      msg: "A game file did not load: /assets/index-Ab12.js",
      screen: "boot",
      edition: "golden-age",
      n: 1,
    });
    // The game's log reads it back cleanly (Settings > Help > Problem report).
    const read = loadProblems({ getItem: (k) => t.stored[k] ?? null, setItem: () => undefined });
    expect(read[0]).toMatchObject({ msg: "A game file did not load: /assets/index-Ab12.js", where: "boot splash", edition: "golden-age" });
  });

  it("counts the same problem again instead of adding a row, and keeps what was there", () => {
    const old = { at: 5, last: 5, n: 1, kind: "frame", msg: "Error: older", stack: [], build: "b", screen: "home", quality: "auto L0 high (fresh start)", edition: "classic", online: false };
    const before = { at: 9, last: 9, n: 2, kind: "error", where: "boot splash", msg: "The game was not ready after 45 s (Tap to try again shown)", stack: [], build: "?", screen: "boot", quality: "?", edition: "classic", online: false };
    const t = run({ theme: "normal", stored: { "cr-clone-problem-log": JSON.stringify([old, before]) } });
    t.advance(45_000);
    expect(t.retryShown()).toBe(true);
    const log = t.log();
    expect(log.map((p) => p.msg)).toEqual(["The game was not ready after 45 s (Tap to try again shown)", "Error: older"]);
    expect(log[0]).toMatchObject({ n: 3, at: 9 });
  });

  it("an uncaught boot error before the traps run is logged once; a booted game logs nothing", () => {
    const t = run();
    t.fire("error", { target: t.win, message: "Uncaught SyntaxError: Unexpected token", filename: "https://game.example/assets/index-Ab12.js", lineno: 1 });
    t.failLoad("script"); // a second problem: the splash has already failed, nothing more
    expect(t.log().map((p) => p.msg)).toEqual(["Boot error: Uncaught SyntaxError: Unexpected token at /assets/index-Ab12.js:1"]);
    const quiet = run();
    quiet.booted();
    quiet.failLoad("script");
    quiet.advance(60_000);
    expect(quiet.log()).toEqual([]);
    expect(quiet.dispatched).toEqual([]);
  });

  it("once the game's error traps run, hands the problem to them and leaves storage alone", () => {
    const t = run({ traps: true });
    t.fire("error", { target: { tagName: "LINK", rel: "stylesheet", href: "https://game.example/clash-royale-clone/assets/index-Zz.css" } });
    t.fire("error", { message: "boom" }); // already failed: not sent again
    expect(t.dispatched).toEqual([
      { type: "cr-boot-problem", detail: { msg: "A game file did not load: /clash-royale-clone/assets/index-Zz.css", seen: false } },
    ]);
    expect(t.log()).toEqual([]);
    // A page error is marked "seen": the traps record it themselves.
    const u = run({ traps: true });
    u.fire("unhandledrejection", { reason: new TypeError("Importing a module script failed.") });
    expect(u.dispatched).toEqual([{ type: "cr-boot-problem", detail: { msg: "Boot error: Importing a module script failed.", seen: true } }]);
  });

  it("never breaks the splash when storage is blocked", () => {
    const t = run({ storageThrows: true });
    t.failLoad("script");
    expect(t.failed()).toBe(true);
    expect(t.retryShown()).toBe(true);
  });
});
