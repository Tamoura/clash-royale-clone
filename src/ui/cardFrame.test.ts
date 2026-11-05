import { describe, expect, it } from "vitest";
import { DECK, getCard } from "../game/cards";
import { isLegendaryRarity, legendaryTwinkles } from "./cardFrame";

describe("legendary card frame", () => {
  it("only the legendary tier gets the frame", () => {
    expect(isLegendaryRarity("legendary")).toBe(true);
    for (const r of ["common", "rare", "epic"] as const) expect(isLegendaryRarity(r)).toBe(false);
    expect(DECK.filter((id) => isLegendaryRarity(getCard(id).rarity))).toContain("digger");
  });

  it("twinkles are stable per card and stay near the tile's edges", () => {
    const a = legendaryTwinkles("digger");
    expect(legendaryTwinkles("digger")).toEqual(a);
    expect(legendaryTwinkles("comet")).not.toEqual(a);
    expect(a).toHaveLength(4);
    for (const t of a) {
      expect(t.x).toBeGreaterThan(0);
      expect(t.x).toBeLessThan(1);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(1);
      expect(t.r).toBeGreaterThan(0.04);
      expect(t.r).toBeLessThan(0.1);
      // Clear of the portrait's middle (the face).
      const off = Math.max(Math.abs(t.x - 0.5), Math.abs(t.y - 0.45));
      expect(off).toBeGreaterThan(0.2);
    }
  });
});
