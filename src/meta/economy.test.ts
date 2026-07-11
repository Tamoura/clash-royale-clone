import { describe, expect, it } from "vitest";
import {
  MATCH_GOLD,
  MAX_CARD_LEVEL,
  START_GOLD,
  canAfford,
  earnGems,
  spendGems,
  spendGold,
  upgradeCost,
} from "./economy";

describe("economy", () => {
  it("starts with a modest gold bank and earned-only gems", () => {
    expect(START_GOLD).toBe(100);
    expect(MATCH_GOLD.win).toBeGreaterThan(MATCH_GOLD.loss);
  });

  it("scales upgrade costs by rarity and level", () => {
    expect(upgradeCost("common", 1)).toEqual({ gold: 20, shards: 2 });
    expect(upgradeCost("rare", 2)).toEqual({ gold: 100, shards: 4 });
    expect(upgradeCost("epic", 3)).toEqual({ gold: 600, shards: 6 });
    expect(upgradeCost("common", MAX_CARD_LEVEL)).toBeNull();
  });

  it("checks affordability and spends currencies safely", () => {
    expect(canAfford(100, 5, { gold: 40, shards: 2 })).toBe(true);
    expect(canAfford(10, 5, { gold: 40, shards: 2 })).toBe(false);
    expect(spendGold(100, 40)).toBe(60);
    expect(spendGold(10, 40)).toBeNull();
    expect(earnGems(0, 3)).toBe(3);
    expect(spendGems(3, 10)).toBeNull();
    expect(spendGems(12, 10)).toBe(2);
  });
});
