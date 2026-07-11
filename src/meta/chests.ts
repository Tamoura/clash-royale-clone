/**
 * Post-match chest slots and seeded open rewards.
 * Gems are earned from chests only (no IAP).
 */
import type { CardId, Rarity } from "../game/cards";
import { getCard } from "../game/cards";
import { cardsAvailableAt } from "./arenas";
import type { OwnedSet, ShardMap } from "./collection";
import { findableUnowned } from "./collection";

export const CHEST_SLOT_COUNT = 4;

/** Soft-open timers (ms). Free chests use the short band; wins may grant longer. */
export const CHEST_TIMER_MS = {
  free: 3 * 60 * 60 * 1000, // 3h
  rare: 8 * 60 * 60 * 1000, // 8h
} as const;

export type ChestRarity = "free" | "rare";

export interface ChestSlot {
  /** Empty slot = null contents. */
  rarity: ChestRarity;
  /** Epoch ms when the chest becomes free to open. */
  readyAt: number;
}

export interface ChestRewards {
  gold: number;
  gems: number;
  /** Newly unlocked card, if any. */
  newCard: CardId | null;
  /** Shard drops for owned (or just-unlocked) cards. */
  shards: Partial<Record<CardId, number>>;
}

export type Rng = () => number;

/** Deterministic mulberry32 — same as the bot RNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function chestRarityForArena(trophies: number, rng: Rng): ChestRarity {
  // Higher arenas lean toward the longer / richer chest.
  const rareChance = Math.min(0.55, 0.15 + trophies / 6000);
  return rng() < rareChance ? "rare" : "free";
}

/** First empty slot index, or -1 if full. */
export function firstEmptySlot(slots: (ChestSlot | null)[]): number {
  return slots.findIndex((s) => s === null);
}

export function isChestReady(slot: ChestSlot, now: number): boolean {
  return now >= slot.readyAt;
}

/**
 * Try to grant a post-match chest into the first empty slot.
 * Returns the updated slots (copy) and whether a chest was placed.
 */
export function grantMatchChest(
  slots: (ChestSlot | null)[],
  trophies: number,
  now: number,
  rng: Rng,
  won: boolean,
): { slots: (ChestSlot | null)[]; granted: boolean; rarity: ChestRarity | null } {
  const next = slots.slice();
  while (next.length < CHEST_SLOT_COUNT) next.push(null);
  const i = firstEmptySlot(next);
  if (i < 0) return { slots: next, granted: false, rarity: null };
  // Losses still grant occasionally so kids aren't stuck.
  if (!won && rng() > 0.35) return { slots: next, granted: false, rarity: null };
  const rarity = chestRarityForArena(trophies, rng);
  // Free chests open immediately; rare chests use the long timer (or gem skip).
  const timer = rarity === "free" ? 0 : CHEST_TIMER_MS.rare;
  next[i] = { rarity, readyAt: now + timer };
  return { slots: next, granted: true, rarity };
}

function shardAmount(rarity: Rarity, chest: ChestRarity, rng: Rng): number {
  const base = rarity === "common" ? 4 : rarity === "rare" ? 2 : 1;
  const mult = chest === "rare" ? 2 : 1;
  return Math.max(1, Math.floor(base * mult * (0.7 + rng() * 0.8)));
}

/**
 * Open a ready chest. Caller removes the slot / spends skip gems separately.
 */
export function openChest(
  chest: ChestSlot,
  trophies: number,
  owned: OwnedSet,
  rng: Rng,
): ChestRewards {
  const goldBase = chest.rarity === "rare" ? 80 : 40;
  const gold = goldBase + Math.floor(rng() * goldBase);
  const gems = rng() < (chest.rarity === "rare" ? 0.45 : 0.2)
    ? 1 + Math.floor(rng() * (chest.rarity === "rare" ? 4 : 2))
    : 0;

  const shards: ShardMap = {};
  let newCard: CardId | null = null;

  const unowned = findableUnowned(trophies, owned);
  // Prefer unlocking a new card when any are available.
  if (unowned.length > 0 && rng() < (chest.rarity === "rare" ? 0.75 : 0.45)) {
    newCard = pick(rng, unowned);
  }

  const pool = cardsAvailableAt(trophies).filter(
    (id) => owned.has(id) || id === newCard,
  );
  const drops = chest.rarity === "rare" ? 3 : 2;
  for (let n = 0; n < drops && pool.length > 0; n++) {
    const id = pick(rng, pool);
    const card = getCard(id);
    shards[id] = (shards[id] ?? 0) + shardAmount(card.rarity, chest.rarity, rng);
  }

  return { gold, gems, newCard, shards };
}

export function emptyChestSlots(): (ChestSlot | null)[] {
  return Array.from({ length: CHEST_SLOT_COUNT }, () => null);
}
