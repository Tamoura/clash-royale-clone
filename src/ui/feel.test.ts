import { afterEach, describe, expect, it, vi } from "vitest";
import { BUZZ_PATTERNS, BUZZ_THROTTLE_MS, buzzPattern, createThrottle, type BuzzKind } from "./feel";

type FeelModule = typeof import("./feel");
type PrefsModule = typeof import("./prefs");

/** Fresh feel + prefs modules (clean throttle and prefs cache). */
async function fresh(nav: unknown): Promise<{ feel: FeelModule; prefs: PrefsModule }> {
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("localStorage", undefined);
  vi.resetModules();
  const prefs = await import("./prefs");
  const feel = await import("./feel");
  return { feel, prefs };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haptic patterns", () => {
  it("maps every kind to the documented pattern", () => {
    expect(BUZZ_PATTERNS).toMatchObject({
      select: 6,
      deploy: 12,
      invalid: [18, 40, 18],
      towerHit: 8,
      towerDown: [40, 60, 80],
      king: [30, 30, 30],
      victory: [20, 40, 20, 40, 60],
      defeat: [60],
      claim: [10, 30, 10],
    });
    for (const kind of Object.keys(BUZZ_PATTERNS) as BuzzKind[]) {
      const p = buzzPattern(kind);
      const parts = typeof p === "number" ? [p] : p;
      // Short, positive, and an odd number of entries (ends on a pulse).
      expect(parts.length % 2).toBe(1);
      for (const ms of parts) expect(ms).toBeGreaterThan(0);
      expect(parts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    }
  });

  it("hands out copies, so callers cannot mutate the table", () => {
    const p = buzzPattern("victory") as number[];
    p[0] = 999;
    expect(BUZZ_PATTERNS.victory).toEqual([20, 40, 20, 40, 60]);
  });
});

describe("throttle", () => {
  it("lets a tower-hit tap through at most every 400 ms", () => {
    expect(BUZZ_THROTTLE_MS.towerHit).toBe(400);
    const allow = createThrottle();
    const fired = [0, 100, 399, 400, 650, 800, 1300].filter((t) => allow("towerHit", t));
    expect(fired).toEqual([0, 400, 800, 1300]);
  });

  it("throttles kinds independently and merges double taps", () => {
    const allow = createThrottle();
    expect(allow("select", 0)).toBe(true);
    expect(allow("select", 10)).toBe(false); // same tap fired twice
    expect(allow("deploy", 10)).toBe(true);
    expect(allow("select", 80)).toBe(true);
  });
});

describe("buzz()", () => {
  it("vibrates with the kind's pattern", async () => {
    const vibrate = vi.fn(() => true);
    const { feel } = await fresh({ vibrate });
    expect(feel.buzz("towerDown")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([40, 60, 80]);
    expect(feel.canBuzz()).toBe(true);
  });

  it("does nothing, and never throws, without navigator.vibrate", async () => {
    for (const nav of [undefined, {}, { vibrate: undefined }, { vibrate: "nope" }]) {
      const { feel } = await fresh(nav);
      expect(() => feel.buzz("deploy")).not.toThrow();
      expect(feel.buzz("victory")).toBe(false);
    }
  });

  it("respects the Haptics setting", async () => {
    const vibrate = vi.fn(() => true);
    const { feel, prefs } = await fresh({ vibrate });
    prefs.setPrefs({ haptics: false });
    expect(feel.buzz("deploy")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    prefs.setPrefs({ haptics: true });
    expect(feel.buzz("deploy")).toBe(true);
  });

  it("swallows a throwing or refusing vibrate()", async () => {
    const { feel } = await fresh({
      vibrate: () => {
        throw new Error("blocked by permissions policy");
      },
    });
    expect(feel.buzz("claim")).toBe(false);
    const refusing = await fresh({ vibrate: () => false });
    expect(refusing.feel.buzz("claim")).toBe(false);
  });

  it("applies the tower-hit throttle in real use", async () => {
    const vibrate = vi.fn(() => true);
    const { feel } = await fresh({ vibrate });
    expect(feel.buzz("towerHit")).toBe(true);
    expect(feel.buzz("towerHit")).toBe(false);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
