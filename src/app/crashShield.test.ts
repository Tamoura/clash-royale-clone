import { describe, expect, it } from "vitest";
import {
  AGAIN_MS,
  CrashShield,
  OOPS_AFTER_SEC,
  OOPS_MESSAGE,
  OOPS_THROWS,
  OopsSwitch,
  oopsRequested,
  PRINT_GAP_MS,
  STORM_ERRORS,
  STORM_FRAMES,
  STORM_WINDOW_MS,
  type ShieldDeps,
} from "./crashShield";
import { LOUD_ERRORS } from "./shieldWire";
import mainSource from "../main.ts?raw";

function rig(over: Partial<ShieldDeps> = {}) {
  let t = 1000;
  const recorded: unknown[] = [];
  const printed: string[] = [];
  const storms: boolean[] = [];
  let menu = false;
  const shield = new CrashShield({
    now: () => t,
    record: (_w, err) => void recorded.push(err),
    print: (text) => void printed.push(text),
    onStorm: (again) => {
      if (menu) return false;
      storms.push(again);
      return true;
    },
    rethrow: false,
    ...over,
  });
  let scheduled = 0;
  const schedule = (): void => {
    scheduled++;
  };
  return {
    shield,
    recorded,
    printed,
    storms,
    schedule,
    get scheduled() {
      return scheduled;
    },
    setMenu: (v: boolean) => {
      menu = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
    /** One frame whose body throws `err` (or returns cleanly). */
    frame(err?: unknown) {
      shield.runFrame(() => {
        if (err !== undefined) throw err;
      }, schedule);
    },
  };
}

describe("the next frame is always scheduled", () => {
  // A frame shaped like main.ts's: an early return, then several steps; a
  // throw at each point in turn must still schedule exactly one next frame.
  const STEPS = ["sim", "bot", "events", "sync", "render", "hud", "emit"];
  for (let at = -1; at <= STEPS.length; at++) {
    const label = at < 0 ? "a clean frame" : at === STEPS.length ? "the early return" : `a throw in ${STEPS[at]}`;
    it(`after ${label}`, () => {
      const r = rig();
      r.shield.runFrame(() => {
        if (at === STEPS.length) return; // the deck picker's early exit
        STEPS.forEach((_s, i) => {
          if (i === at) throw new Error(`boom in ${STEPS[i]}`);
        });
      }, r.schedule);
      expect(r.scheduled).toBe(1);
      expect(r.recorded).toHaveLength(at >= 0 && at < STEPS.length ? 1 : 0);
    });
  }

  it("a thrown non-Error (a string, undefined) too", () => {
    const r = rig();
    r.frame("just a string");
    r.shield.runFrame(() => {
      throw undefined;
    }, r.schedule);
    expect(r.scheduled).toBe(2);
    expect(r.recorded).toEqual(["just a string", undefined]);
  });

  it("schedules first, then throws on when errors must stay loud (dev server, vitest)", () => {
    const r = rig({ rethrow: true });
    const err = new Error("loud");
    expect(() => r.frame(err)).toThrow(err);
    expect(r.scheduled).toBe(1);
    expect(r.recorded).toEqual([err]);
    expect(r.printed).toEqual([]); // the rethrow is the print
  });

  it("schedules even when recording, printing and the overlay all throw", () => {
    const r = rig({
      record: () => {
        throw new Error("log broken");
      },
      print: () => {
        throw new Error("console broken");
      },
      onStorm: () => {
        throw new Error("overlay broken");
      },
    });
    for (let i = 0; i < 5; i++) r.frame(new Error("x"));
    expect(r.scheduled).toBe(5);
  });

  it("is loud in the dev server and in vitest", () => {
    expect(LOUD_ERRORS).toBe(true);
  });
});

describe("storms", () => {
  it("one stray error: the game carries on, no overlay", () => {
    const r = rig();
    r.frame(new Error("once"));
    for (let i = 0; i < 200; i++) {
      r.advance(16);
      r.frame();
    }
    expect(r.storms).toEqual([]);
    expect(r.shield.holding).toBe(false);
  });

  it("stray errors far apart never add up to a storm", () => {
    const r = rig();
    for (let i = 0; i < 10; i++) {
      r.frame(new Error(`e${i}`));
      r.advance(STORM_WINDOW_MS + 1);
      r.frame();
    }
    expect(r.storms).toEqual([]);
  });

  it(`${STORM_ERRORS} errors within ${STORM_WINDOW_MS} ms open the overlay exactly once`, () => {
    const r = rig();
    for (let i = 0; i < STORM_ERRORS; i++) {
      r.frame(new Error(`e${i}`));
      r.frame(); // good frames between: only the window rule can fire
      r.advance(STORM_WINDOW_MS / STORM_ERRORS - 10);
    }
    expect(r.storms).toEqual([false]);
    expect(r.shield.holding).toBe(true);
    // An error on every frame while it is up: no re-entry.
    for (let i = 0; i < 300; i++) {
      r.advance(16);
      r.frame(new Error("still broken"));
    }
    expect(r.storms).toEqual([false]);
    expect(r.scheduled).toBe(STORM_ERRORS * 2 + 300);
  });

  it(`an error every frame of a very slow device (${STORM_FRAMES} failed frames in a row) is a storm too`, () => {
    const r = rig();
    for (let i = 0; i < STORM_FRAMES; i++) {
      r.frame(new Error("every frame"));
      r.advance(1500); // under 1 fps: the window rule alone would never fire
    }
    expect(r.storms).toEqual([false]);
  });

  it("Keep playing resumes; failing again right away says so; later it is a fresh glitch", () => {
    const r = rig();
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("a"));
    r.shield.resume();
    expect(r.shield.holding).toBe(false);
    r.advance(500);
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("a"));
    expect(r.storms).toEqual([false, true]); // again: Back to menu comes first
    r.shield.resume();
    r.advance(AGAIN_MS + 1);
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("a"));
    expect(r.storms).toEqual([false, true, false]);
  });

  it("Back to menu starts afresh", () => {
    const r = rig();
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("a"));
    r.shield.reset();
    expect(r.shield.holding).toBe(false);
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("a"));
    expect(r.storms).toEqual([false, false]);
  });

  it("on a menu screen nothing is held: the shield records and keeps counting", () => {
    const r = rig();
    r.setMenu(true);
    for (let i = 0; i < 30; i++) r.frame(new Error("diorama"));
    expect(r.shield.holding).toBe(false);
    expect(r.recorded).toHaveLength(30);
    r.setMenu(false);
    for (let i = 0; i < STORM_FRAMES; i++) r.frame(new Error("battle"));
    expect(r.storms).toEqual([false]);
  });
});

describe("printing identical messages is throttled (never silent: each one is recorded)", () => {
  it("prints the first, counts the rest, and says how many when it prints again", () => {
    const r = rig();
    for (let i = 0; i < 100; i++) {
      r.frame(new Error("same"));
      r.advance(10);
    }
    expect(r.recorded).toHaveLength(100);
    expect(r.printed).toHaveLength(1);
    expect(r.printed[0]).toBe("[shield] frame failed; the game goes on");
    r.advance(PRINT_GAP_MS);
    r.frame(new Error("same"));
    expect(r.printed).toHaveLength(2);
    expect(r.printed[1]).toContain("(and 99 more like it)");
  });

  it("different messages each print", () => {
    const r = rig();
    r.frame(new Error("one"));
    r.frame(new Error("two"));
    expect(r.printed).toHaveLength(2);
  });

  it("throttles the rethrow too, so a broken frame does not flood the dev console", () => {
    const r = rig({ rethrow: true });
    expect(() => r.frame(new Error("same"))).toThrow();
    expect(() => r.frame(new Error("same"))).not.toThrow();
    expect(r.scheduled).toBe(2);
    expect(r.recorded).toHaveLength(2);
  });
});

describe("the ?oops=1 test switch", () => {
  it("reads the address", () => {
    expect(oopsRequested("?oops=1")).toBe(true);
    expect(oopsRequested("?quality=low&oops=1")).toBe(true);
    expect(oopsRequested("?oops=0")).toBe(false);
    expect(oopsRequested("")).toBe(false);
  });

  it("does nothing unless armed, and only while a battle is being played", () => {
    const off = new OopsSwitch(false);
    for (let i = 0; i < 100; i++) expect(() => off.tick(true, 0.25)).not.toThrow();
    const on = new OopsSwitch(true);
    for (let i = 0; i < 100; i++) expect(() => on.tick(false, 0.25)).not.toThrow();
    expect(on.armed).toBe(true);
  });

  it(`throws ${OOPS_THROWS} times after ${OOPS_AFTER_SEC} s of play, then never again`, () => {
    const s = new OopsSwitch(true);
    let thrown = 0;
    let frames = 0;
    for (let i = 0; i < 200; i++) {
      frames++;
      try {
        s.tick(true, 0.1);
      } catch (e) {
        expect((e as Error).message).toBe(OOPS_MESSAGE);
        thrown++;
        if (thrown === 1) expect(frames).toBeGreaterThanOrEqual(OOPS_AFTER_SEC / 0.1);
      }
    }
    expect(thrown).toBe(OOPS_THROWS);
    expect(s.armed).toBe(false);
  });

  it("inside the shield it opens the overlay once and the battle goes on afterwards", () => {
    const r = rig();
    const s = new OopsSwitch(true);
    let ticks = 0;
    const body = (): void => {
      s.tick(!r.shield.holding, 0.1);
      ticks++; // the sim step after it
    };
    for (let i = 0; i < 60; i++) {
      r.advance(100);
      r.shield.runFrame(body, r.schedule);
      if (r.shield.holding) r.shield.resume(); // the kid taps Keep playing
    }
    expect(r.storms).toEqual([false]);
    expect(r.scheduled).toBe(60);
    expect(ticks).toBe(60 - OOPS_THROWS);
  });
});

describe("main.ts runs every frame through the shield", () => {
  const src: string = mainSource;
  const body = src.slice(src.indexOf("function frameBody("), src.indexOf("\n}\n", src.indexOf("function frameBody(")));

  it("frame() is the shield's runFrame, scheduling itself", () => {
    expect(src).toMatch(/function frame\(now: number\): void \{\s*crash\.shield\.runFrame\(\(\) => frameBody\(now\), \(\) => requestAnimationFrame\(frame\)\);\s*\}/);
  });

  it("the frame body never schedules (so no exit can skip or double the next frame)", () => {
    expect(body.length).toBeGreaterThan(1000);
    expect(body).not.toContain("requestAnimationFrame");
  });

  it("the error listeners are installed by main.ts's first import", () => {
    expect(src.split("\n").find((l: string) => l.startsWith("import "))).toBe('import "./app/errorTraps";');
  });
});
