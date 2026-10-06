import { describe, expect, it } from "vitest";
import { POPUP_LIFE, damageLabel, popupAlpha, popupRise, popupScale } from "./popups";

describe("damage labels", () => {
  it("ignores chip damage", () => {
    expect(damageLabel(3)).toBeNull();
    expect(damageLabel(24)).toBeNull();
  });

  it("rounds the number", () => {
    expect(damageLabel(159.7)?.text).toBe("160");
  });

  it("grows and heats up with the hit size", () => {
    const small = damageLabel(110)!;
    const medium = damageLabel(320)!;
    const huge = damageLabel(750)!;
    expect(medium.scale).toBeGreaterThan(small.scale);
    expect(huge.scale).toBeGreaterThan(medium.scale);
    expect(small.color).not.toBe(huge.color);
  });

  it("only huge hits are crits", () => {
    expect(damageLabel(750)?.crit).toBe(true);
    expect(damageLabel(320)?.crit).toBeFalsy();
  });
});

describe("popup timing", () => {
  it("lives 0.8 s", () => {
    expect(POPUP_LIFE).toBe(0.8);
  });

  it("pops past full size, then settles at 1", () => {
    expect(popupScale(0)).toBeLessThan(0.5);
    expect(popupScale(0.12)).toBeCloseTo(1.25);
    expect(popupScale(0.25)).toBeCloseTo(1);
    expect(popupScale(0.9)).toBe(1);
  });

  it("rises quickly then eases, and never sinks", () => {
    let prev = popupRise(0);
    expect(prev).toBe(0);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const r = popupRise(t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(popupRise(1)).toBeCloseTo(1.1);
    expect(popupRise(0.5)).toBeGreaterThan(0.55 * 1.1); // front-loaded
  });

  it("stays solid, then fades to nothing", () => {
    expect(popupAlpha(0.3)).toBe(1);
    expect(popupAlpha(0.8)).toBeGreaterThan(0);
    expect(popupAlpha(0.8)).toBeLessThan(1);
    expect(popupAlpha(1)).toBe(0);
  });
});
