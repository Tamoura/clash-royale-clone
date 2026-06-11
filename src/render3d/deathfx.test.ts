import { describe, expect, it } from "vitest";
import { deathStyle } from "./deathfx";

describe("death effect styles", () => {
  it("skeletal troops scatter bones", () => {
    expect(deathStyle("skeletons").kind).toBe("bones");
  });

  it("the robots burst into purple sparks", () => {
    expect(deathStyle("pekka").kind).toBe("sparks");
    expect(deathStyle("mini-pekka").kind).toBe("sparks");
  });

  it("the balloon deflates", () => {
    expect(deathStyle("balloon").kind).toBe("deflate");
  });

  it("everything else puffs", () => {
    expect(deathStyle("knight").kind).toBe("puff");
    expect(deathStyle(null).kind).toBe("puff");
  });
});
