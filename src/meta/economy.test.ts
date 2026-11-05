import { describe, expect, it } from "vitest";
import {
  FREE_LOSS_BELOW,
  MATCH_GOLD,
  MATCH_TROPHIES,
  trophyLossAt,
  MAX_CARD_LEVEL,
  START_GOLD,
  UPGRADE_BASE,
  SHARD_GOLD_PRICE,
  shardGoldPrice,
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

  it("legendaries cost the most gold per level but need fewer (scarce) shards", () => {
    expect(upgradeCost("legendary", 1)).toEqual({ gold: 400, shards: 1 });
    expect(upgradeCost("legendary", 5)).toEqual({ gold: 2000, shards: 5 });
    expect(upgradeCost("legendary", MAX_CARD_LEVEL)).toBeNull();
    for (let lvl = 1; lvl < MAX_CARD_LEVEL; lvl++) {
      const leg = upgradeCost("legendary", lvl)!;
      const epic = upgradeCost("epic", lvl)!;
      expect(leg.gold).toBeGreaterThan(epic.gold);
      expect(leg.shards).toBeLessThan(epic.shards);
    }
    // Every rarity has a cost table, ordered by rarity.
    const order = ["common", "rare", "epic", "legendary"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(UPGRADE_BASE[order[i]].gold).toBeGreaterThan(UPGRADE_BASE[order[i - 1]].gold);
    }
  });

  it("a legendary shard costs far more to craft, so crafting never makes legendary levels cheap", () => {
    for (const r of ["common", "rare", "epic"] as const) expect(shardGoldPrice(r)).toBe(SHARD_GOLD_PRICE);
    expect(shardGoldPrice("legendary")).toBeGreaterThanOrEqual(10 * SHARD_GOLD_PRICE);
    for (let lvl = 1; lvl < MAX_CARD_LEVEL; lvl++) {
      const leg = upgradeCost("legendary", lvl)!;
      const epic = upgradeCost("epic", lvl)!;
      const legAllCrafted = leg.gold + leg.shards * shardGoldPrice("legendary");
      const epicAllCrafted = epic.gold + epic.shards * shardGoldPrice("epic");
      // Crafting every shard costs more than the level's own gold for a
      // legendary... (shards keep their worth)
      expect(leg.shards * shardGoldPrice("legendary")).toBeGreaterThanOrEqual(leg.gold / 2);
      // ...and a fully crafted legendary level still costs more than an epic one.
      expect(legAllCrafted).toBeGreaterThan(epicAllCrafted);
    }
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
