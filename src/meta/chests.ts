/**
 * Post-match chest slots and seeded open rewards.
 * Gems are earned from chests only (no IAP).
 */
import type { CardId, Rarity } from "../game/cards";
import { getCard } from "../game/cards";
import { cardsAvailableAt } from "./arenas";
import type { OwnedSet, ShardMap } from "./collection";
import { findableUnowned, grantOwned } from "./collection";
import { ARENAS } from "./arenas";
import { defaultKV, type KV } from "./kv";

export const CHEST_SLOT_COUNT = 4;

/** Soft-open timers (ms). Free chests use the short band; wins may grant longer. */
export const CHEST_TIMER_MS = {
  free: 3 * 60 * 60 * 1000, // 3h
  rare: 8 * 60 * 60 * 1000, // 8h
} as const;

export type ChestRarity = "free" | "rare";

// ---- Early chests: a new player's first three chests are quick -----------

/** How many match chests this profile has ever been granted. */
export const CHESTS_EARNED_KEY = "cr-clone-chests-earned";

/** Timers of a new profile's 1st, 2nd and 3rd chest: now, 5 min, 15 min. */
export const EARLY_CHEST_TIMERS_MS: readonly number[] = [0, 5 * 60 * 1000, 15 * 60 * 1000];

/**
 * Unlock timer for a chest granted after `earnedCount` earlier ones:
 * the early schedule for the first three, then the normal 3h / 8h.
 */
export function earlyTimerMs(earnedCount: number, rarity: ChestRarity = "free"): number {
  const n = Math.max(0, Math.floor(earnedCount));
  return n < EARLY_CHEST_TIMERS_MS.length ? EARLY_CHEST_TIMERS_MS[n] : CHEST_TIMER_MS[rarity];
}

/** Match chests granted so far (0 when unknown: a new profile). */
export function chestsEarned(kv: KV | null = defaultKV()): number {
  try {
    const n = Number(kv?.getItem(CHESTS_EARNED_KEY) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** True once the counter exists (existing players get it seeded once). */
export function hasChestsEarned(kv: KV | null = defaultKV()): boolean {
  try {
    return kv?.getItem(CHESTS_EARNED_KEY) != null;
  } catch {
    return false;
  }
}

export function setChestsEarned(n: number, kv: KV | null = defaultKV()): void {
  try {
    kv?.setItem(CHESTS_EARNED_KEY, String(Math.max(0, Math.floor(n))));
  } catch {
    // storage blocked: every chest just reads as a new player's
  }
}

/** Count `added` newly granted chests; returns the new total. */
export function noteChestsEarned(added = 1, kv: KV | null = defaultKV()): number {
  const n = chestsEarned(kv) + Math.max(0, Math.floor(added));
  setChestsEarned(n, kv);
  return n;
}

// ---- Free chest: one on the house every 4 hours ----------------------------

export const FREE_CHEST_KEY = "cr-clone-free-chest-at";
export const FREE_CHEST_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Epoch ms when the free chest can next be claimed (0: right now). */
export function freeChestReadyAt(kv: KV | null = defaultKV()): number {
  try {
    const n = Number(kv?.getItem(FREE_CHEST_KEY) ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function isFreeChestReady(now: number, kv: KV | null = defaultKV()): boolean {
  return now >= freeChestReadyAt(kv);
}

/**
 * Claim the free chest if it is ready, re-arming it 4h from now. Returns
 * false (and changes nothing) while it is still cooling down.
 */
export function claimFreeChest(now: number, kv: KV | null = defaultKV()): boolean {
  if (!isFreeChestReady(now, kv)) return false;
  try {
    kv?.setItem(FREE_CHEST_KEY, String(now + FREE_CHEST_INTERVAL_MS));
  } catch {
    // blocked storage: the chest re-arms on reload, which is harmless
  }
  return true;
}

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
  /** Chests granted before this one (drives the early-chest timers). */
  earned: number = chestsEarned(),
): { slots: (ChestSlot | null)[]; granted: boolean; rarity: ChestRarity | null } {
  const next = slots.slice();
  while (next.length < CHEST_SLOT_COUNT) next.push(null);
  const i = firstEmptySlot(next);
  if (i < 0) return { slots: next, granted: false, rarity: null };
  // Losses still grant occasionally so kids aren't stuck.
  if (!won && rng() > 0.35) return { slots: next, granted: false, rarity: null };
  const rarity = chestRarityForArena(trophies, rng);
  // A new player's first chests open (almost) at once; later ones use the
  // 3h / 8h timers (or a gem skip).
  next[i] = { rarity, readyAt: now + earlyTimerMs(earned, rarity) };
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

// ---- First chest: a guaranteed new card ----------------------------------

/**
 * The card a player's very first chest guarantees: the first unowned card
 * findable at their arena (in unlock order), or, in Training Camp where
 * every card is already owned, the first one the next arena unlocks.
 * Deterministic, so a reload can never reroll it.
 */
export function firstChestCard(trophies: number, owned: OwnedSet): CardId | null {
  const here = findableUnowned(trophies, owned);
  const ordered = ARENAS.flatMap((a) => a.unlocks);
  const inOrder = ordered.find((id) => here.includes(id));
  if (inOrder) return inOrder;
  return ordered.find((id) => !owned.has(id)) ?? null;
}

/**
 * Make the first chest ever opened carry a new card. `openedBefore` is the
 * lifetime chests-opened count before this one. A chest that already rolled
 * a new card is left alone.
 */
export function ensureFirstChestCard<P extends { trophies: number; owned: CardId[] }>(
  profile: P,
  rewards: ChestRewards,
  openedBefore: number,
): { profile: P; rewards: ChestRewards } {
  if (openedBefore > 0 || rewards.newCard) return { profile, rewards };
  const card = firstChestCard(profile.trophies, new Set(profile.owned));
  if (!card) return { profile, rewards };
  return {
    profile: { ...profile, owned: grantOwned(profile.owned, card) },
    rewards: { ...rewards, newCard: card },
  };
}

export function emptyChestSlots(): (ChestSlot | null)[] {
  return Array.from({ length: CHEST_SLOT_COUNT }, () => null);
}
