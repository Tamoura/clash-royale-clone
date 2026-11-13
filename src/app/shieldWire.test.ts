// How a glitch storm is routed (src/app/shieldWire.ts): which overlay, the
// solo sim hold, the online no-contest stop, Back to menu, and ?oops=1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKV } from "../meta/kv";
import { markMatchStart, readMarker } from "../match/leftMatch";
import type { OopsActions, OopsKind } from "../ui/oops";
import { PRINT_GAP_MS, STORM_ERRORS } from "./crashShield";
import type { HookErrorReporter } from "./hooks";
import { problemLog } from "./problemLog";

const shown: { kind: OopsKind; actions: OopsActions }[] = [];
vi.mock("../ui/oops", () => ({
  showOops: (kind: OopsKind, actions: OopsActions) => {
    shown.push({ kind, actions });
    return { close: () => undefined };
  },
}));

const holds: (() => boolean)[] = [];
const reporters: HookErrorReporter[] = [];
vi.mock("./hooks", () => ({
  registerSimHold: (fn: () => boolean) => {
    holds.push(fn);
    return () => undefined;
  },
  setHookErrorReporter: (fn: HookErrorReporter) => {
    reporters.push(fn);
    return () => undefined;
  },
}));

// Imported after the mocks are declared (vi.mock is hoisted anyway).
const { installCrashShield, hookErrorReporter } = await import("./shieldWire");

interface Fakes {
  calls: string[];
  kv: ReturnType<typeof memoryKV>;
  menu: boolean;
  session: { setPaused(p: boolean): void } | null;
  over: boolean;
}

function wire(over: Partial<Fakes> = {}) {
  const f: Fakes = { calls: [], kv: memoryKV(), menu: false, session: null, over: false, ...over };
  markMatchStart(f.kv, Date.UTC(2026, 10, 13), 320);
  const w = installCrashShield({
    kv: f.kv,
    onMenu: () => f.menu,
    online: () => f.session,
    battleOver: () => f.over,
    leaveOnline: () => {
      f.calls.push("leaveOnline");
      f.session = null;
    },
    abandonBattle: () => void f.calls.push("abandon"),
    releaseLiveMatch: () => void f.calls.push("release"),
    dismissHud: () => void f.calls.push("dismiss"),
    openHome: () => void f.calls.push("home"),
    context: () => ({ screen: "battle/playing", quality: "auto L2", edition: "classic", online: f.session !== null }),
  });
  const hold = holds[holds.length - 1];
  /** A glitch storm: STORM_ERRORS errors at once (caught() never throws, even in vitest). */
  const storm = (): void => {
    for (let i = 0; i < STORM_ERRORS; i++) w.shield.caught("frame", new Error(`glitch ${i}`));
  };
  return { f, w, hold, storm };
}

let search = "";
const replaced: string[] = [];

beforeEach(() => {
  shown.length = 0;
  holds.length = 0;
  reporters.length = 0;
  replaced.length = 0;
  search = "";
  vi.stubGlobal("location", {
    get search() {
      return search;
    },
    pathname: "/play/",
    hash: "#top",
  });
  vi.stubGlobal("history", {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url),
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a storm in a solo battle", () => {
  it("shows the 'glitch' overlay once and holds the sim while it is up", () => {
    const { w, hold, storm } = wire();
    expect(hold()).toBe(false);
    storm();
    storm(); // no re-entry while it is open
    expect(shown.map((s) => s.kind)).toEqual(["glitch"]);
    expect(hold()).toBe(true);
    expect(w.shield.holding).toBe(true);
  });

  it("Keep playing lets go of the sim; failing again right away shows 'again'", () => {
    const { hold, storm } = wire();
    storm();
    shown[0].actions.onKeepPlaying?.();
    expect(hold()).toBe(false);
    storm();
    expect(shown.map((s) => s.kind)).toEqual(["glitch", "again"]);
    expect(hold()).toBe(true);
  });

  it("Back to menu leaves as no contest: the battle is abandoned, the marker cleared, Home opened, the hold let go", () => {
    const { f, hold, storm } = wire();
    storm();
    shown[0].actions.onBackToMenu();
    expect(f.calls).toEqual(["abandon", "release", "dismiss", "home"]);
    expect(readMarker(f.kv)).toBeNull(); // nothing for the next launch to charge
    expect(hold()).toBe(false);
    storm(); // a fresh start: the next storm is a plain glitch again
    expect(shown.map((s) => s.kind)).toEqual(["glitch", "glitch"]);
  });

  it("a battle already decided (even online) gets the solo overlay: nothing left to stop", () => {
    const { f, storm } = wire({ session: { setPaused: () => undefined }, over: true });
    storm();
    expect(shown.map((s) => s.kind)).toEqual(["glitch"]);
    expect(f.calls).toEqual([]);
  });
});

describe("a storm in an online match still being played", () => {
  it("says paused, leaves the room, and shows the 'online' overlay with only Back to menu", () => {
    const paused: boolean[] = [];
    const { f, storm } = wire({ session: { setPaused: (p) => void paused.push(p) } });
    storm();
    expect(paused).toEqual([true]);
    expect(f.calls).toEqual(["leaveOnline"]);
    expect(shown.map((s) => s.kind)).toEqual(["online"]);
    expect(shown[0].actions.onKeepPlaying).toBeUndefined();
    shown[0].actions.onBackToMenu();
    expect(f.calls).toEqual(["leaveOnline", "abandon", "release", "dismiss", "home"]);
  });
});

describe("a storm on a menu screen", () => {
  it("shows nothing and holds nothing: menus keep working", () => {
    const { hold, storm, w } = wire({ menu: true });
    storm();
    storm();
    expect(shown).toEqual([]);
    expect(hold()).toBe(false);
    expect(w.shield.holding).toBe(false);
  });
});

describe("where the problem log says it was caught", () => {
  it("a guarded part of a frame keeps its label; a whole frame and a no-contest step are labelled too", () => {
    problemLog.clear();
    const { w } = wire();
    w.shield.guard("battle event 'death'", () => {
      throw new Error("tower fx");
    });
    w.shield.caught("frame", new Error("whole frame"));
    const byMsg = (m: string) => problemLog.list().find((p) => p.msg === m);
    expect(byMsg("Error: tower fx")).toMatchObject({ kind: "frame", where: "battle event 'death'" });
    expect(byMsg("Error: whole frame")).not.toHaveProperty("where");
  });
});

describe("a hook's listener that throws", () => {
  it("is installed as the hooks' reporter", () => {
    wire();
    expect(reporters).toHaveLength(1);
  });

  it("goes in the problem log as 'hook', printed once then throttled, and never opens the overlay", () => {
    problemLog.clear();
    let t = 0;
    const report = hookErrorReporter(() => t);
    const { w, hold } = wire();
    const printed = vi.mocked(console.error);
    printed.mockClear();
    // A 'frame' listener that throws on every frame for a second.
    for (let i = 0; i < 60; i++) {
      report("frame", new Error("tutorial arrow"));
      t += 16;
    }
    const entry = problemLog.list().find((p) => p.msg === "Error: tutorial arrow");
    expect(entry).toMatchObject({ kind: "hook", where: "frame listener", n: 60 });
    expect(printed).toHaveBeenCalledTimes(1);
    t += PRINT_GAP_MS;
    report("frame", new Error("tutorial arrow"));
    expect(printed).toHaveBeenCalledTimes(2);
    expect(String(printed.mock.calls[1][0])).toContain("(and 59 more like it)");
    // The battle is fine: no overlay, no hold.
    expect(shown).toEqual([]);
    expect(hold()).toBe(false);
    expect(w.shield.holding).toBe(false);
  });
});

describe("the ?oops=1 test switch", () => {
  it("arms the switch and takes the parameter off the address bar (a reload does not glitch again)", () => {
    search = "?oops=1&join=123";
    const { w } = wire();
    expect(w.oops.armed).toBe(true);
    expect(replaced).toEqual(["/play/?join=123#top"]);
  });

  it("without it, nothing is armed and the address is left alone", () => {
    search = "?join=123";
    const { w } = wire();
    expect(w.oops.armed).toBe(false);
    expect(replaced).toEqual([]);
  });
});
