import { CARDS, type CardId } from "./cards";

/** Local-time YYYY-MM-DD — the identity of "today's" challenge. */
export function dateKey(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** FNV-1a over the date key: everyone gets the same seed on the same day. */
export function dailySeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Version of the deck-of-the-day rules. It is mixed into the seed, so a
 * rule change deals a fresh deck instead of a near-copy of today's old one.
 * v2: no Champion, a building-targeting troop, at most 3 spells.
 */
export const DAILY_FORMAT = 2;

/** The seed key the deck of the day is dealt from (format-versioned). */
export function dailyDeckKey(key: string): string {
  return `v${DAILY_FORMAT}:${key}`;
}

/** Most spells a deck of the day may hold. */
export const DAILY_MAX_SPELLS = 3;

/** Shuffles tried before the deterministic repair kicks in (never reached in practice). */
const MAX_DEALS = 64;

/** A troop that walks straight for buildings (Giant, Hog Rider...): the deck's win condition. */
export function isWinCondition(id: CardId): boolean {
  const c = CARDS[id];
  return c.kind === "troop" && c.unit.targetsBuildingsOnly;
}

/** Does this 8-card deck follow the deck-of-the-day rules? */
export function isFairDailyDeck(deck: readonly CardId[]): boolean {
  if (deck.includes("champion")) return false;
  if (!deck.some(isWinCondition)) return false;
  return deck.filter((id) => CARDS[id].kind === "spell").length <= DAILY_MAX_SPELLS;
}

/**
 * The mirror deck of the day: both sides battle with these 8 cards.
 * Seeded shuffle of the pool (the player's own Studio Champion is left out),
 * re-dealt from the same RNG until the deck has a win condition and no
 * more than 3 spells — same deck for everyone all day.
 */
export function dailyDeck(key: string): CardId[] {
  const rng = mulberry32(dailySeed(dailyDeckKey(key)));
  const pool = (Object.keys(CARDS) as CardId[]).filter((id) => id !== "champion");
  const deal = (): CardId[] => {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 8);
  };
  let deck = deal();
  for (let n = 1; n < MAX_DEALS && !isFairDailyDeck(deck); n++) deck = deal();
  if (isFairDailyDeck(deck)) return deck;
  // Deterministic repair, should 64 deals ever all miss: swap surplus
  // spells for the next non-spells of the pool, then the last non-spell
  // for the first win condition.
  const rest = pool.slice(8);
  for (let i = deck.length - 1; i >= 0; i--) {
    if (deck.filter((id) => CARDS[id].kind === "spell").length <= DAILY_MAX_SPELLS) break;
    const j = rest.findIndex((id) => CARDS[id].kind !== "spell" && !isWinCondition(id));
    if (CARDS[deck[i]].kind === "spell" && j >= 0) deck[i] = rest.splice(j, 1)[0];
  }
  if (!deck.some(isWinCondition)) {
    const wc = rest.find(isWinCondition);
    const i = deck.map((id) => CARDS[id].kind !== "spell").lastIndexOf(true);
    if (wc && i >= 0) deck[i] = wc;
  }
  return deck;
}
