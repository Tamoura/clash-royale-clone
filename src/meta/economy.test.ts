import { describe, expect, it } from "vitest";
import {
  FREE_LOSS_BELOW,
  MATCH_GOLD,
  MATCH_TROPHIES,
  trophyLossAt,
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

  it("trophyLossAt: free in Training Camp, capped at the loss and the arena floor", () => {
    expect(FREE_LOSS_BELOW).toBe(100);
    for (const t of [0, 1, 20, 50, 99]) expect(trophyLossAt(t)).toBe(0);
    expect(trophyLossAt(100)).toBe(0); // standing on Goblin Stadium's floor
    expect(trophyLossAt(105)).toBe(5);
    expect(trophyLossAt(110)).toBe(10);
    expect(trophyLossAt(130)).toBe(-MATCH_TROPHIES.loss);
    expect(trophyLossAt(199)).toBe(20);
    expect(trophyLossAt(200)).toBe(0); // Bone Pit floor
    expect(trophyLossAt(215)).toBe(15);
    expect(trophyLossAt(5000)).toBe(20);
    // Junk in, safe out.
    expect(trophyLossAt(Number.NaN)).toBe(0);
    expect(trophyLossAt(-40)).toBe(0);
    expect(trophyLossAt(110.9)).toBe(10);
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
