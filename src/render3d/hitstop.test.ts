import { describe, expect, it } from "vitest";
import { HitStopController } from "./hitstop";

describe("HitStopController", () => {
  it("is inactive until punched", () => {
    const h = new HitStopController();
    expect(h.active).toBe(false);
    h.punch(0.05);
    expect(h.active).toBe(true);
    expect(h.left).toBeCloseTo(0.05);
  });

  it("keeps the longer freeze when punched again", () => {
    const h = new HitStopController();
    h.punch(0.04);
    h.punch(0.09);
    expect(h.left).toBeCloseTo(0.09);
    h.punch(0.02);
    expect(h.left).toBeCloseTo(0.09);
  });

  it("clamps to 120ms and drains over time", () => {
    const h = new HitStopController();
    h.punch(1);
    expect(h.left).toBeCloseTo(0.12);
    h.update(0.05);
    expect(h.left).toBeCloseTo(0.07);
    h.update(0.1);
    expect(h.active).toBe(false);
  });

  it("resets cleanly", () => {
    const h = new HitStopController();
    h.punch(0.08);
    h.reset();
    expect(h.active).toBe(false);
  });
});
