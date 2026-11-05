import { describe, expect, it } from "vitest";
import { sparkleField } from "./sparkles";

describe("sparkle fields", () => {
  it("is seeded: the same layout every time, a new one for a new seed", () => {
    expect(sparkleField({ seed: 3 })).toEqual(sparkleField({ seed: 3 }));
    expect(sparkleField({ seed: 3 })).not.toEqual(sparkleField({ seed: 4 }));
  });

  it("rises from round the middle of the host and stays on screen", () => {
    const f = sparkleField({ count: 24, seed: 1, mode: "rise" });
    expect(f).toHaveLength(24);
    for (const s of f) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(100);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(100);
      expect(s.rise).toBeGreaterThan(0); // always upward
      expect(s.size).toBeGreaterThanOrEqual(6);
      expect(s.dur).toBeGreaterThan(s.delay > 0 ? 0 : -1);
      expect([0, 1, 2, 3]).toContain(s.hue);
    }
  });

  it("bursts outwards in every direction, quickly", () => {
    const f = sparkleField({ count: 16, seed: 2, mode: "burst" });
    const left = f.filter((s) => s.dx < 0).length;
    const right = f.filter((s) => s.dx > 0).length;
    expect(left).toBeGreaterThan(3);
    expect(right).toBeGreaterThan(3);
    for (const s of f) expect(s.delay + s.dur).toBeLessThan(1300);
  });

  it("clamps the count", () => {
    expect(sparkleField({ count: -5 })).toHaveLength(0);
    expect(sparkleField({ count: 500 })).toHaveLength(64);
  });
});
