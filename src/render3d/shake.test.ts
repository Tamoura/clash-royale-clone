import { afterEach, describe, expect, it } from "vitest";
import { setPrefs } from "../ui/prefs";
import { MAX_TRAUMA, ShakeController } from "./shake";

describe("trauma-based camera shake", () => {
  it("adds trauma and reports a quadratic intensity", () => {
    const s = new ShakeController();
    expect(s.intensity).toBe(0);
    s.add(0.5);
    // intensity = trauma^2, so a half-trauma kick is a gentle 0.25 shake.
    expect(s.intensity).toBeCloseTo(0.25);
    expect(s.active).toBe(true);
  });

  it("stacks with diminishing returns and clamps at MAX_TRAUMA", () => {
    const s = new ShakeController();
    s.add(0.4);
    s.add(0.4); // the second kick lands at 80%
    expect(Math.sqrt(s.intensity)).toBeCloseTo(0.4 + 0.4 * 0.8);
    s.add(0.8);
    s.add(0.8); // would overshoot
    expect(Math.sqrt(s.intensity)).toBeCloseTo(MAX_TRAUMA);
    expect(MAX_TRAUMA).toBeLessThan(1);
  });

  it("decays to rest over time", () => {
    const s = new ShakeController();
    s.add(1);
    s.update(0.5, 1.5); // 0.75 of trauma drains
    expect(s.intensity).toBeCloseTo((MAX_TRAUMA - 0.75) ** 2, 4);
    s.update(1, 1.5); // fully drained (clamped)
    expect(s.intensity).toBe(0);
    expect(s.active).toBe(false);
  });

  it("a bigger kick shakes harder", () => {
    const small = new ShakeController();
    const big = new ShakeController();
    small.add(0.3);
    big.add(0.9);
    expect(big.intensity).toBeGreaterThan(small.intensity);
  });

  describe("under reduced motion", () => {
    afterEach(() => {
      setPrefs({ reduceMotion: "auto" });
    });

    it("scales every kick to nothing", () => {
      setPrefs({ reduceMotion: "on" });
      const s = new ShakeController();
      s.add(0.9);
      expect(s.intensity).toBe(0);
      expect(s.active).toBe(false);
    });

    it("lets trauma already in flight drain normally", () => {
      const s = new ShakeController();
      s.add(0.5);
      setPrefs({ reduceMotion: "on" });
      s.add(0.5); // ignored
      expect(s.intensity).toBeCloseTo(0.25);
      s.update(1, 1.5);
      expect(s.active).toBe(false);
    });
  });
});
