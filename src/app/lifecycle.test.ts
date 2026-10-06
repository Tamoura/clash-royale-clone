import { describe, expect, it } from "vitest";
import { renderThisFrame } from "./lifecycle";

describe("idle rendering", () => {
  it("never draws behind an opaque screen", () => {
    for (let t = 0; t < 10; t++) expect(renderThisFrame("none", t)).toBe(false);
  });

  it("draws every frame in battle", () => {
    for (let t = 0; t < 10; t++) expect(renderThisFrame("battle", t)).toBe(true);
  });

  it("draws the home diorama on every other frame, starting with the first", () => {
    const drawn = Array.from({ length: 8 }, (_, t) => renderThisFrame("diorama", t));
    expect(drawn).toEqual([true, false, true, false, true, false, true, false]);
  });
});
