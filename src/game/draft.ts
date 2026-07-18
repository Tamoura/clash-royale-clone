import { CARDS, type CardId } from "./cards";

export const DRAFT_ROUNDS = 8;
const OFFER_SIZE = 3;

/**
 * A seeded, deterministic card draft (CR "Mega Draft" style):
 * each of 8 rounds offers 3 cards from the full pool, the player keeps one
 * and the bot secretly takes one of the other two. No card ever appears
 * twice in a draft, so the finished decks never overlap.
 */
export interface DraftState {
  /** The 3 cards offered this round (empty once the draft is complete). */
  offers: CardId[];
  /** Player's picks so far, in pick order. */
  picks: CardId[];
  /** Bot's picks so far (one per completed round). */
  botPicks: CardId[];
  /** Cards not yet seen in any offer. */
  remaining: CardId[];
  /** PRNG state, advanced by each round's draw and bot pick. */
  rngState: number;
}

/** Deterministic PRNG (mulberry32) step: returns [0,1) and the next state. */
function rngStep(state: number): { value: number; next: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next };
}

function drawOffers(
  remaining: CardId[],
  rngState: number,
): { offers: CardId[]; remaining: CardId[]; rngState: number } {
  const pool = [...remaining];
  const offers: CardId[] = [];
  let state = rngState;
  for (let i = 0; i < OFFER_SIZE; i++) {
    const step = rngStep(state);
    state = step.next;
    offers.push(pool.splice(Math.floor(step.value * pool.length), 1)[0]);
  }
  return { offers, remaining: pool, rngState: state };
}

export function createDraft(
  seed: number,
  // The Studio champion is personal — it never appears in draft offers.
  pool: CardId[] = (Object.keys(CARDS) as CardId[]).filter((id) => id !== "champion"),
): DraftState {
  const first = drawOffers(pool, seed | 0 || 1);
  return {
    offers: first.offers,
    picks: [],
    botPicks: [],
    remaining: first.remaining,
    rngState: first.rngState,
  };
}

export function isDraftComplete(d: DraftState): boolean {
  return d.picks.length >= DRAFT_ROUNDS;
}

/**
 * Player keeps `id` from the current offer; the bot takes one of the other
 * two. Returns the next round's state, or null if `id` was not offered.
 */
export function pickCard(d: DraftState, id: CardId): DraftState | null {
  if (isDraftComplete(d) || !d.offers.includes(id)) return null;
  const rest = d.offers.filter((c) => c !== id);
  const step = rngStep(d.rngState);
  const botPick = rest[Math.floor(step.value * rest.length)];
  const picks = [...d.picks, id];
  const done = picks.length >= DRAFT_ROUNDS;
  const next = done
    ? { offers: [] as CardId[], remaining: d.remaining, rngState: step.next }
    : drawOffers(d.remaining, step.next);
  return {
    offers: next.offers,
    picks,
    botPicks: [...d.botPicks, botPick],
    remaining: next.remaining,
    rngState: next.rngState,
  };
}
