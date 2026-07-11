/**
 * Persisted player profile: trophies, currencies, owned cards, shards,
 * levels, and chest slots. Migrates legacy trophy/level keys.
 */
import type { CardLevels } from "../game/battle";
import { DEFAULT_DECK, DECK, type CardId } from "../game/cards";
import {
  addShards,
  clampDeckToOwned,
  grantOwned,
  isOwnedDeck,
  ownedSet,
  starterOwned,
  type ShardMap,
} from "./collection";
import {
  emptyChestSlots,
  grantMatchChest,
  mulberry32,
  openChest,
  type ChestRewards,
  type ChestSlot,
} from "./chests";
import {
  CHEST_SKIP_GEMS,
  MATCH_GOLD,
  MATCH_TROPHIES,
  MAX_CARD_LEVEL,
  MIGRATION_GOLD_BONUS,
  START_GEMS,
  START_GOLD,
  canAfford,
  earnGems,
  earnGold,
  spendGems,
  spendGold,
  upgradeCost,
} from "./economy";
import { getCard } from "../game/cards";

export const STORAGE_KEYS = {
  trophies: "cr-clone-trophies",
  levels: "cr-clone-levels",
  gold: "cr-clone-gold",
  gems: "cr-clone-gems",
  owned: "cr-clone-owned",
  shards: "cr-clone-shards",
  chests: "cr-clone-chests",
  deck: "cr-clone-deck",
  migrated: "cr-clone-meta-v1",
} as const;

export interface MetaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PlayerProfile {
  trophies: number;
  gold: number;
  gems: number;
  owned: CardId[];
  shards: ShardMap;
  levels: CardLevels;
  chests: (ChestSlot | null)[];
  /** Deck clamped to owned cards (may be < 8 only mid-edit). */
  deck: CardId[];
}

export interface MatchRewardSummary {
  trophiesDelta: number;
  goldDelta: number;
  gemsDelta: number;
  chestGranted: boolean;
  chestRarity: "free" | "rare" | null;
  /** Legacy-style level-up notes removed; upgrades are collection-only. */
  rewardLine: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeOwned(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return starterOwned();
  const known = new Set<string>(DECK);
  const out: CardId[] = [];
  const seen = new Set<CardId>();
  for (const id of raw) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id as CardId)) continue;
    out.push(id as CardId);
    seen.add(id as CardId);
  }
  // Always keep the starter set so the player can always field a deck.
  for (const id of DEFAULT_DECK) {
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

function sanitizeShards(raw: unknown): ShardMap {
  if (!raw || typeof raw !== "object") return {};
  const known = new Set<string>(DECK);
  const out: ShardMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[k as CardId] = Math.floor(n);
  }
  return out;
}

function sanitizeLevels(raw: unknown): CardLevels {
  if (!raw || typeof raw !== "object") return {};
  const known = new Set<string>(DECK);
  const out: CardLevels = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k as CardId] = Math.min(MAX_CARD_LEVEL, Math.max(1, Math.floor(n)));
  }
  return out;
}

function sanitizeChests(raw: unknown): (ChestSlot | null)[] {
  const slots = emptyChestSlots();
  if (!Array.isArray(raw)) return slots;
  for (let i = 0; i < Math.min(slots.length, raw.length); i++) {
    const s = raw[i];
    if (!s || typeof s !== "object") {
      slots[i] = null;
      continue;
    }
    const rarity = (s as ChestSlot).rarity;
    const readyAt = Number((s as ChestSlot).readyAt);
    if ((rarity === "free" || rarity === "rare") && Number.isFinite(readyAt)) {
      slots[i] = { rarity, readyAt };
    } else {
      slots[i] = null;
    }
  }
  return slots;
}

function readDeck(storage: MetaStorage, owned: CardId[]): CardId[] {
  const raw = parseJson<CardId[]>(storage.getItem(STORAGE_KEYS.deck), []);
  return clampDeckToOwned(Array.isArray(raw) ? raw : [], ownedSet(owned));
}

/**
 * Load profile, migrating legacy trophy/level saves into the meta shell.
 */
export function loadProfile(storage: MetaStorage): PlayerProfile {
  const trophies =
    Math.max(0, parseInt(storage.getItem(STORAGE_KEYS.trophies) ?? "0", 10) || 0);
  const levels = sanitizeLevels(parseJson(storage.getItem(STORAGE_KEYS.levels), {}));
  const alreadyMigrated = storage.getItem(STORAGE_KEYS.migrated) === "1";

  let gold: number;
  let gems: number;
  let owned: CardId[];
  let shards: ShardMap;
  let chests: (ChestSlot | null)[];
  let migrationBonus = 0;

  if (alreadyMigrated) {
    gold = Math.max(0, parseInt(storage.getItem(STORAGE_KEYS.gold) ?? String(START_GOLD), 10) || 0);
    gems = Math.max(0, parseInt(storage.getItem(STORAGE_KEYS.gems) ?? String(START_GEMS), 10) || 0);
    owned = sanitizeOwned(parseJson(storage.getItem(STORAGE_KEYS.owned), starterOwned()));
    shards = sanitizeShards(parseJson(storage.getItem(STORAGE_KEYS.shards), {}));
    chests = sanitizeChests(parseJson(storage.getItem(STORAGE_KEYS.chests), null));
  } else {
    // Fresh meta: starter owned only. Old saves assumed the full pool — clamp
    // deck to owned starter and grant a gold bonus when the deck had extras.
    gold = START_GOLD;
    gems = START_GEMS;
    owned = starterOwned();
    shards = {};
    chests = emptyChestSlots();

    const oldDeck = parseJson<CardId[]>(storage.getItem(STORAGE_KEYS.deck), []);
    if (Array.isArray(oldDeck) && oldDeck.length > 0) {
      const ownedNow = ownedSet(owned);
      const hadLocked = oldDeck.some(
        (id) => typeof id === "string" && DECK.includes(id as CardId) && !ownedNow.has(id as CardId),
      );
      if (hadLocked) {
        migrationBonus = MIGRATION_GOLD_BONUS;
        gold += migrationBonus;
      }
    }
  }

  const deck = readDeck(storage, owned);
  const profile: PlayerProfile = {
    trophies,
    gold,
    gems,
    owned,
    shards,
    levels,
    chests,
    deck: isOwnedDeck(deck, ownedSet(owned)) ? deck : clampDeckToOwned(deck, ownedSet(owned)),
  };

  if (!alreadyMigrated) {
    storage.setItem(STORAGE_KEYS.migrated, "1");
    saveProfile(storage, profile);
  }

  return profile;
}

export function saveProfile(storage: MetaStorage, profile: PlayerProfile): void {
  storage.setItem(STORAGE_KEYS.trophies, String(profile.trophies));
  storage.setItem(STORAGE_KEYS.levels, JSON.stringify(profile.levels));
  storage.setItem(STORAGE_KEYS.gold, String(profile.gold));
  storage.setItem(STORAGE_KEYS.gems, String(profile.gems));
  storage.setItem(STORAGE_KEYS.owned, JSON.stringify(profile.owned));
  storage.setItem(STORAGE_KEYS.shards, JSON.stringify(profile.shards));
  storage.setItem(STORAGE_KEYS.chests, JSON.stringify(profile.chests));
  storage.setItem(STORAGE_KEYS.deck, JSON.stringify(profile.deck));
}

export function saveDeck(storage: MetaStorage, deck: CardId[]): void {
  storage.setItem(STORAGE_KEYS.deck, JSON.stringify(deck));
}

/**
 * Apply solo match outcome. Online matches must not call this.
 */
export function applyMatchResult(
  profile: PlayerProfile,
  winner: "player" | "enemy" | "draw",
  now = Date.now(),
  seed = (now ^ (profile.trophies * 2654435761)) >>> 0,
): { profile: PlayerProfile; summary: MatchRewardSummary } {
  const rng = mulberry32(seed);
  let trophiesDelta = 0;
  let goldDelta = 0;

  if (winner === "player") {
    trophiesDelta = MATCH_TROPHIES.win;
    goldDelta = MATCH_GOLD.win;
  } else if (winner === "enemy") {
    trophiesDelta = MATCH_TROPHIES.loss;
    goldDelta = MATCH_GOLD.loss;
  } else {
    trophiesDelta = MATCH_TROPHIES.draw;
    goldDelta = MATCH_GOLD.draw;
  }

  const next: PlayerProfile = {
    ...profile,
    trophies: Math.max(0, profile.trophies + trophiesDelta),
    gold: earnGold(profile.gold, goldDelta),
    chests: profile.chests.slice(),
    owned: [...profile.owned],
    shards: { ...profile.shards },
    levels: { ...profile.levels },
    deck: [...profile.deck],
  };

  const chest = grantMatchChest(
    next.chests,
    next.trophies,
    now,
    rng,
    winner === "player",
  );
  next.chests = chest.slots;

  const parts: string[] = [];
  if (trophiesDelta > 0) parts.push(`+${trophiesDelta} 🏆`);
  else if (trophiesDelta < 0) parts.push(`${trophiesDelta} 🏆`);
  else parts.push("🏆 unchanged");
  parts.push(`+${goldDelta} 🪙`);
  if (chest.granted) parts.push("Chest earned!");

  return {
    profile: next,
    summary: {
      trophiesDelta,
      goldDelta,
      gemsDelta: 0,
      chestGranted: chest.granted,
      chestRarity: chest.rarity,
      rewardLine: parts.join(" · "),
    },
  };
}

export function tryUpgradeCard(
  profile: PlayerProfile,
  id: CardId,
): { profile: PlayerProfile; ok: boolean; reason?: string } {
  if (!profile.owned.includes(id)) {
    return { profile, ok: false, reason: "locked" };
  }
  const level = profile.levels[id] ?? 1;
  const cost = upgradeCost(getCard(id).rarity, level);
  if (!cost) return { profile, ok: false, reason: "max" };
  const haveShards = profile.shards[id] ?? 0;
  if (!canAfford(profile.gold, haveShards, cost)) {
    return { profile, ok: false, reason: "afford" };
  }
  const gold = spendGold(profile.gold, cost.gold);
  if (gold === null) return { profile, ok: false, reason: "afford" };
  const next: PlayerProfile = {
    ...profile,
    gold,
    shards: { ...profile.shards, [id]: haveShards - cost.shards },
    levels: { ...profile.levels, [id]: level + 1 },
    owned: [...profile.owned],
    chests: profile.chests.slice(),
    deck: [...profile.deck],
  };
  return { profile: next, ok: true };
}

export function tryOpenChest(
  profile: PlayerProfile,
  slotIndex: number,
  now = Date.now(),
  seed?: number,
  opts: { skipWithGems?: boolean } = {},
): { profile: PlayerProfile; rewards: ChestRewards | null; ok: boolean; reason?: string } {
  const slot = profile.chests[slotIndex];
  if (!slot) return { profile, ok: false, rewards: null, reason: "empty" };

  let gems = profile.gems;
  if (now < slot.readyAt) {
    if (!opts.skipWithGems) {
      return { profile, ok: false, rewards: null, reason: "locked" };
    }
    const spent = spendGems(gems, CHEST_SKIP_GEMS);
    if (spent === null) return { profile, ok: false, rewards: null, reason: "gems" };
    gems = spent;
  }

  const rng = mulberry32(seed ?? ((now ^ (slotIndex + 1) * 997) >>> 0));
  const owned = ownedSet(profile.owned);
  const rewards = openChest(slot, profile.trophies, owned, rng);

  let nextOwned = [...profile.owned];
  let nextShards = { ...profile.shards };
  if (rewards.newCard) {
    nextOwned = grantOwned(nextOwned, rewards.newCard);
  }
  for (const [id, n] of Object.entries(rewards.shards)) {
    nextShards = addShards(nextShards, id as CardId, n ?? 0);
  }

  const chests = profile.chests.slice();
  chests[slotIndex] = null;

  const next: PlayerProfile = {
    ...profile,
    gold: earnGold(profile.gold, rewards.gold),
    gems: earnGems(gems, rewards.gems),
    owned: nextOwned,
    shards: nextShards,
    chests,
    levels: { ...profile.levels },
    deck: [...profile.deck],
  };
  return { profile: next, rewards, ok: true };
}

export { MAX_CARD_LEVEL, starterOwned, isOwnedDeck, clampDeckToOwned, ownedSet };
