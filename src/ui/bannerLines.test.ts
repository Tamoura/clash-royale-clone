import { describe, expect, it } from "vitest";
import { bannerLines } from "./banner";

describe("bannerLines", () => {
  it("keeps a one-line banner as its headline", () => {
    expect(bannerLines("FIGHT!")).toEqual({ head: "FIGHT!", details: [] });
  });

  it("splits the overtime call into a headline and short detail lines", () => {
    expect(bannerLines("OVERTIME!\n3x sparks\nTroops hit towers 3x!")).toEqual({
      head: "OVERTIME!",
      details: ["3x sparks", "Troops hit towers 3x!"],
    });
  });

  it("drops empty detail lines", () => {
    expect(bannerLines("OVERTIME!\n\n3x sparks\n")).toEqual({ head: "OVERTIME!", details: ["3x sparks"] });
  });
});
