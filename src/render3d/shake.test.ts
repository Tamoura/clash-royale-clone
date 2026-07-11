import { describe, expect, it } from "vitest";
import { ShakeController } from "./shake";

describe("trauma-based camera shake", () => {
  it("adds trauma and reports a quadratic intensity", () => {
    const s = new ShakeController();
    expect(s.intensity).toBe(0);
    s.add(0.5);
    // intensity = trauma^2, so a half-trauma kick is a gentle 0.25 shake.
    expect(s.intensity).toBeCloseTo(0.25);
    expect(s.active).toBe(true);
  });

  it("clamps trauma at 1", () => {
    const s = new ShakeController();
    s.add(0.8);
    s.add(0.8); // would overshoot
    expect(s.intensity).toBeCloseTo(1);
  });

  it("decays to rest over time", () => {
    const s = new ShakeController();
    s.add(1);
    s.update(0.5, 1.5); // 0.75 of trauma drains
    expect(s.intensity).toBeCloseTo(0.25 * 0.25, 4); // (1 - 0.75)^2
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
});
