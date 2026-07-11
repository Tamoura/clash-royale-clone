import { describe, expect, it } from "vitest";
import { spawnRecipe, spawnStyle } from "./spawnfx";

describe("spawn styles", () => {
  it("skeletons claw their way out of the ground", () => {
    expect(spawnStyle("skeletons")).toBe("rise");
    expect(spawnStyle("skeleton-army")).toBe("rise");
  });

  it("the Mega Knight slams down from the sky", () => {
    expect(spawnStyle("mega-knight")).toBe("slam");
  });

  it("everyone else pops in", () => {
    expect(spawnStyle("knight")).toBe("pop");
    expect(spawnStyle("balloon")).toBe("pop");
    expect(spawnStyle(null)).toBe("pop");
  });

  it("special deploys use recognizable accent colors and burst scales", () => {
    expect(spawnRecipe("electro-wizard").color).not.toBe(spawnRecipe("witch").color);
    expect(spawnRecipe("mega-knight").burst).toBeGreaterThan(spawnRecipe("knight").burst);
  });
});
