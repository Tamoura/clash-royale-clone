import { afterEach, describe, expect, it } from "vitest";
import { setPrefs } from "../ui/prefs";
import { HitStopController, MAX_HITSTOP, REDUCED_HITSTOP } from "./hitstop";

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

  it("clamps to 300ms and drains over time", () => {
    const h = new HitStopController();
    h.punch(1);
    expect(h.left).toBeCloseTo(MAX_HITSTOP);
    expect(MAX_HITSTOP).toBeCloseTo(0.3);
    h.update(0.05);
    expect(h.left).toBeCloseTo(0.25);
    h.update(0.3);
    expect(h.active).toBe(false);
  });

  it("holds a king tower's 250ms freeze in full", () => {
    const h = new HitStopController();
    h.punch(0.25);
    expect(h.left).toBeCloseTo(0.25);
  });

  describe("under reduced motion", () => {
    afterEach(() => {
      setPrefs({ reduceMotion: "auto" });
    });

    it("keeps only a 50ms beat of any freeze", () => {
      setPrefs({ reduceMotion: "on" });
      const h = new HitStopController();
      h.punch(0.25);
      expect(h.left).toBeCloseTo(REDUCED_HITSTOP);
      expect(REDUCED_HITSTOP).toBeCloseTo(0.05);
      h.punch(0.02); // shorter hits are untouched
      expect(h.left).toBeCloseTo(0.05);
    });

    it("goes back to full freezes when the setting is turned off", () => {
      setPrefs({ reduceMotion: "on" });
      setPrefs({ reduceMotion: "off" });
      const h = new HitStopController();
      h.punch(0.25);
      expect(h.left).toBeCloseTo(0.25);
    });
  });

  it("resets cleanly", () => {
    const h = new HitStopController();
    h.punch(0.08);
    h.reset();
    expect(h.active).toBe(false);
  });
});
