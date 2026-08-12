/**
 * Soft currency helpers and card upgrade costs by rarity.
 * Kid-safe: gems are earned only (no IAP).
 */
import type { Rarity } from "../game/cards";

export const START_GOLD = 100;
export const START_GEMS = 0;
export const MAX_CARD_LEVEL = 11;

/** Gold granted after a solo match. */
export const MATCH_GOLD = {
  win: 50,
  loss: 15,
  draw: 25,
} as const;

/** Trophy delta after a solo match. */
export const MATCH_TROPHIES = {
  win: 30,
  loss: -20,
  draw: 0,
} as const;

/** Gems to skip a chest timer. */
export const CHEST_SKIP_GEMS = 10;

/** Gold price to craft one missing upgrade shard (player agency: no
 * more waiting on chest luck to level the card you actually play). */
export const SHARD_GOLD_PRICE = 15;

/** One-time bonus when migrating an old all-cards save. */
export const MIGRATION_GOLD_BONUS = 200;

export interface UpgradeCost {
  gold: number;
  shards: number;
}

const BASE: Record<Rarity, UpgradeCost> = {
  common: { gold: 20, shards: 2 },
  rare: { gold: 50, shards: 2 },
  epic: { gold: 200, shards: 2 },
};

/**
 * Cost to upgrade from `fromLevel` → fromLevel+1.
 * Returns null when already at the cap.
 */
export function upgradeCost(
  rarity: Rarity,
  fromLevel: number,
): UpgradeCost | null {
  if (fromLevel < 1 || fromLevel >= MAX_CARD_LEVEL) return null;
  const b = BASE[rarity];
  return {
    gold: b.gold * fromLevel,
    shards: b.shards * fromLevel,
  };
}

export function canAfford(
  gold: number,
  shardsOwned: number,
  cost: UpgradeCost,
): boolean {
  return gold >= cost.gold && shardsOwned >= cost.shards;
}

export function clampNonNeg(n: number): number {
  return Math.max(0, Math.floor(n));
}

export function earnGold(current: number, amount: number): number {
  return clampNonNeg(current) + clampNonNeg(amount);
}

export function spendGold(current: number, amount: number): number | null {
  const have = clampNonNeg(current);
  const need = clampNonNeg(amount);
  if (have < need) return null;
  return have - need;
}

export function earnGems(current: number, amount: number): number {
  return clampNonNeg(current) + clampNonNeg(amount);
}

export function spendGems(current: number, amount: number): number | null {
  const have = clampNonNeg(current);
  const need = clampNonNeg(amount);
  if (have < need) return null;
  return have - need;
}
