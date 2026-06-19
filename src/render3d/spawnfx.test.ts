import { describe, expect, it } from "vitest";
import { spawnStyle } from "./spawnfx";

describe("spawn styles", () => {
  it("skeletons claw their way out of the ground", () => {
    expect(spawnStyle("skeletons")).toBe("rise");
  });

  it("the Mega Knight slams down from the sky", () => {
    expect(spawnStyle("mega-knight")).toBe("slam");
  });

  it("everyone else pops in", () => {
    expect(spawnStyle("knight")).toBe("pop");
    expect(spawnStyle("balloon")).toBe("pop");
    expect(spawnStyle(null)).toBe("pop");
  });
});
