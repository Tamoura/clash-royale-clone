/**
 * Crown Pass: a free monthly track (no purchases). Every crown taken in a
 * real match (ladder, events, online) fills it; each 10 crowns opens one of
 * 30 tiers, and each tier pays once. The pass is keyed by the season key
 * (calendar month): on a new month the old pass is archived and a fresh
 * one starts. Stored in 'cr-clone-pass'.
 *
 * Permanent unlocks it pays (tower flair, emotes) live in their own keys so
 * the monthly reset never takes them away.
 */
import { CARDS, type CardId, type Rarity } from "../game/cards";
import { defaultKV, readJson, writeJson, type KV } from "./kv";

export const PASS_KEY = "cr-clone-pass";
export const PASS_TIERS = 30;
export const CROWNS_PER_TIER = 10;
export const PASS_MAX_CROWNS = PASS_TIERS * CROWNS_PER_TIER;
/** Past passes kept for the profile's season history. */
export const PASS_ARCHIVE_MAX = 12;

export interface PassArchiveEntry {
  key: string;
  crowns: number;
  tier: number;
}

export interface PassState {
  /** Season key (YYYY-MM) this pass belongs to. */
  key: string;
  crowns: number;
  /** Tiers already paid out. */
  claimed: number[];
  /** Earlier seasons' passes, newest first. */
  archive: PassArchiveEntry[];
}

export type PassReward =
  | { kind: "gold"; amount: number }
  | { kind: "gems"; amount: number }
  | { kind: "chest"; chest: "free" | "rare" }
  /** Shards for one owned card the player picks from three. */
  | { kind: "shards"; amount: Record<Rarity, number> }
  /** Permanent tower decoration (setTowerFlair tier). */
  | { kind: "flair"; tier: 1 | 2 }
  /** A new in-battle emote. */
  | { kind: "emote" };

// ---- Rewards ----------------------------------------------------------------

/** What tier t (1..30) pays. Gems every 5 tiers; cosmetics at 10, 20 and 30. */
export function passRewards(t: number): PassReward[] {
  if (t < 1 || t > PASS_TIERS) return [];
  const late = t > 15;
  switch (t % 5) {
    case 0: {
      const gems: PassReward = { kind: "gems", amount: t === PASS_TIERS ? 20 : 10 };
      if (t === 10) return [gems, { kind: "flair", tier: 1 }];
      if (t === 20) return [gems, { kind: "emote" }];
      if (t === 30) return [gems, { kind: "flair", tier: 2 }];
      return [gems];
    }
    case 2:
      return [{ kind: "chest", chest: t >= 12 && t % 10 === 2 ? "rare" : "free" }];
    case 3:
      return [{ kind: "shards", amount: late ? { common: 15, rare: 9, epic: 4 } : { common: 10, rare: 6, epic: 3 } }];
    default:
      return [{ kind: "gold", amount: 40 + 10 * t }];
  }
}

/** Gold paid when a season ends: 100 plus a tenth of the season's best trophies. */
export function seasonPayout(best: number): number {
  return 100 + Math.floor(Math.max(0, best) / 10);
}

// ---- State ----------------------------------------------------------------

export function freshPass(key: string, archive: PassArchiveEntry[] = []): PassState {
  return { key, crowns: 0, claimed: [], archive };
}

/** Tiers opened by this many crowns (0..30). */
export function tierOf(crowns: number): number {
  return Math.min(PASS_TIERS, Math.floor(Math.max(0, crowns) / CROWNS_PER_TIER));
}

/** Progress toward the next tier, for the pill and the track. */
export function passProgress(state: PassState): { tier: number; into: number; need: number; maxed: boolean } {
  const tier = tierOf(state.crowns);
  if (tier >= PASS_TIERS) return { tier, into: CROWNS_PER_TIER, need: CROWNS_PER_TIER, maxed: true };
  return { tier, into: state.crowns - tier * CROWNS_PER_TIER, need: CROWNS_PER_TIER, maxed: false };
}

/** Add crowns from a finished match (capped at the end of the track). */
export function addCrowns(state: PassState, n: number): PassState {
  const add = Math.max(0, Math.floor(n));
  if (add === 0) return state;
  return { ...state, crowns: Math.min(PASS_MAX_CROWNS, state.crowns + add) };
}

/** Opened tiers not yet claimed, low to high. */
export function claimableTiers(state: PassState): number[] {
  const out: number[] = [];
  for (let t = 1; t <= tierOf(state.crowns); t++) if (!state.claimed.includes(t)) out.push(t);
  return out;
}

/** Claim tier t once. Null when it is locked or already claimed. */
export function claimTier(state: PassState, t: number): { state: PassState; rewards: PassReward[] } | null {
  if (!Number.isInteger(t) || t < 1 || t > tierOf(state.crowns) || state.claimed.includes(t)) return null;
  return {
    state: { ...state, claimed: [...state.claimed, t].sort((a, b) => a - b) },
    rewards: passRewards(t),
  };
}

/**
 * The pass for season `key`. A pass from an earlier season is archived
 * (newest first, capped) and replaced by a fresh one; `rolled` says so.
 */
export function ensurePassSeason(state: PassState | null, key: string): { state: PassState; rolled: boolean } {
  if (!state) return { state: freshPass(key), rolled: false };
  if (state.key === key) return { state, rolled: false };
  const entry: PassArchiveEntry = { key: state.key, crowns: state.crowns, tier: tierOf(state.crowns) };
  const archive = [entry, ...state.archive.filter((a) => a.key !== state.key)].slice(0, PASS_ARCHIVE_MAX);
  return { state: freshPass(key, archive), rolled: true };
}

function sanitizePass(raw: unknown): PassState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PassState>;
  if (typeof r.key !== "string" || !/^\d{4}-\d{2}$/.test(r.key)) return null;
  const crowns = Number(r.crowns);
  const claimed = Array.isArray(r.claimed)
    ? [...new Set(r.claimed.filter((t): t is number => Number.isInteger(t) && t >= 1 && t <= PASS_TIERS))]
    : [];
  const archive = Array.isArray(r.archive)
    ? r.archive
        .filter((a): a is PassArchiveEntry => !!a && typeof a.key === "string" && Number.isFinite(a.crowns))
        .map((a) => ({ key: a.key, crowns: Math.max(0, Math.floor(a.crowns)), tier: tierOf(a.crowns) }))
        .slice(0, PASS_ARCHIVE_MAX)
    : [];
  return {
    key: r.key,
    crowns: Number.isFinite(crowns) ? Math.min(PASS_MAX_CROWNS, Math.max(0, Math.floor(crowns))) : 0,
    claimed: claimed.sort((a, b) => a - b),
    archive,
  };
}

/** The saved pass for season `key` (rolled over if it belongs to an older month). */
export function loadPass(key: string, kv: KV | null = defaultKV()): PassState {
  const saved = sanitizePass(readJson<unknown>(PASS_KEY, null, kv));
  const { state, rolled } = ensurePassSeason(saved, key);
  if (rolled || !saved) savePass(state, kv);
  return state;
}

export function savePass(state: PassState, kv: KV | null = defaultKV()): void {
  writeJson(PASS_KEY, state, kv);
}

// ---- Shard picks --------------------------------------------------------------

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Three owned cards to pick shards for at tier t: deck cards first, then
 * the rest of the collection, in a seeded order (stable per season and tier,
 * so reopening the picker offers the same three).
 */
export function shardChoices(owned: readonly CardId[], deck: readonly CardId[], key: string, t: number): CardId[] {
  const known = owned.filter((id) => id in CARDS && id !== "champion");
  const rank = (id: CardId): number => hash(`${key}#${t}#${id}`);
  const inDeck = known.filter((id) => deck.includes(id)).sort((a, b) => rank(a) - rank(b));
  const rest = known.filter((id) => !deck.includes(id)).sort((a, b) => rank(a) - rank(b));
  // Mix: two from the deck and one from the collection when both exist.
  const picks = [...inDeck.slice(0, rest.length > 0 ? 2 : 3), ...rest.slice(0, 1)];
  for (const id of [...inDeck, ...rest]) {
    if (picks.length >= 3) break;
    if (!picks.includes(id)) picks.push(id);
  }
  return picks.slice(0, 3);
}

// ---- Permanent unlocks ------------------------------------------------------

export const FLAIR_KEY = "cr-clone-tower-flair";
export const EMOTES_UNLOCKED_KEY = "cr-clone-emotes-unlocked";

/**
 * Emotes the pass can unlock, in unlock order (an emote IS an emoji: the
 * in-battle bubble draws it). Ids are stable; glyphs may be restyled.
 */
export const PASS_EMOTES: readonly { id: string; glyph: string }[] = [
  { id: "crown", glyph: "\u{1F451}" },
  { id: "clap", glyph: "\u{1F44F}" },
  { id: "fire", glyph: "\u{1F525}" },
  { id: "muscle", glyph: "\u{1F4AA}" },
  { id: "star", glyph: "\u{1F31F}" },
  { id: "handshake", glyph: "\u{1F91D}" },
];

export function towerFlairUnlocked(kv: KV | null = defaultKV()): number {
  const n = readJson<number>(FLAIR_KEY, 0, kv);
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(2, Math.floor(n))) : 0;
}

export function unlockTowerFlair(tier: number, kv: KV | null = defaultKV()): number {
  const next = Math.max(towerFlairUnlocked(kv), Math.max(0, Math.min(2, Math.floor(tier))));
  writeJson(FLAIR_KEY, next, kv);
  return next;
}

export function emotesUnlocked(kv: KV | null = defaultKV()): string[] {
  const raw = readJson<unknown>(EMOTES_UNLOCKED_KEY, [], kv);
  const ids = new Set(PASS_EMOTES.map((e) => e.id));
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [];
}

/** The next emote a pass would unlock (null when all are owned). */
export function nextPassEmote(kv: KV | null = defaultKV()): { id: string; glyph: string } | null {
  const have = new Set(emotesUnlocked(kv));
  return PASS_EMOTES.find((e) => !have.has(e.id)) ?? null;
}

/** Unlock the next pass emote; returns it, or null when all are owned. */
export function unlockNextEmote(kv: KV | null = defaultKV()): { id: string; glyph: string } | null {
  const next = nextPassEmote(kv);
  if (next) writeJson(EMOTES_UNLOCKED_KEY, [...emotesUnlocked(kv), next.id], kv);
  return next;
}

/** Glyphs of the unlocked emotes, for the in-battle tray. */
export function unlockedEmoteGlyphs(kv: KV | null = defaultKV()): string[] {
  const have = new Set(emotesUnlocked(kv));
  return PASS_EMOTES.filter((e) => have.has(e.id)).map((e) => e.glyph);
}

// ---- Season clock -----------------------------------------------------------

/** Whole days left in the season of `now` (local calendar month), at least 1. */
export function seasonDaysLeft(now: Date): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}
