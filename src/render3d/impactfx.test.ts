import { describe, expect, it } from "vitest";
import { impactStyle } from "./impactfx";

describe("melee impact styles", () => {
  it("heavy hitters throw big sparks and shake the screen", () => {
    const pekka = impactStyle("pekka");
    expect(pekka.trauma).toBeGreaterThan(0);
    const light = impactStyle("skeletons");
    expect(pekka.particles).toBeGreaterThan(light.particles);
    expect(pekka.trauma).toBeGreaterThan(light.trauma);
  });

  it("light troops just flick a few sparks, no shake", () => {
    expect(impactStyle("skeletons").trauma).toBe(0);
    expect(impactStyle("skeletons").particles).toBeGreaterThan(0);
  });

  it("the mini P.E.K.K.A and prince hit as hard as the P.E.K.K.A", () => {
    expect(impactStyle("mini-pekka").trauma).toBe(impactStyle("pekka").trauma);
    expect(impactStyle("prince").trauma).toBe(impactStyle("pekka").trauma);
  });

  it("falls back to a light hit for unknown cards", () => {
    const d = impactStyle(null);
    expect(d.particles).toBeGreaterThan(0);
    expect(d.trauma).toBe(0);
  });
});
