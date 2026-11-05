/**
 * Deck slots: three named decks and the one that is active. The active
 * slot is the deck bot battles and online matches use.
 *
 * The single saved deck ('cr-clone-deck', written by saveProfile) stays
 * the live copy of the active slot: main.ts boots from it and every
 * screen that edits meta.playerDeck keeps working unchanged. saveProfile
 * mirrors it into the active slot (mirrorActiveDeck), and loadDeckSlots
 * reconciles the two, so neither can drift.
 *
 * Migration: the first load copies the existing saved deck into slot 1
 * (and, like a fresh Clash Royale account, into slots 2 and 3 as starting
 * points), so nobody loses the deck they built.
 *
 * Stored in 'cr-clone-deck-slots'. Pure functions; storage is injected.
 */
import { DECK, type CardId } from "../game/cards";
import { clampDeckToOwned, type OwnedSet } from "./collection";

export const DECK_SLOTS_KEY = "cr-clone-deck-slots";
export const SLOT_COUNT = 3;
/** Longest custom slot name (characters). */
export const SLOT_NAME_MAX = 14;

export interface DeckSlotStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DeckSlot {
  /** Custom name; "" shows the default "Deck N". */
  name: string;
  /** Up to 8 unique known cards, in hand order (the first 4 start in hand). */
  cards: CardId[];
}

export interface DeckSlots {
  v: 1;
  /** Index of the active slot (0..SLOT_COUNT-1). */
  active: number;
  slots: DeckSlot[];
}

const KNOWN = new Set<string>(DECK);

/** Known cards only, no repeats, at most 8, order kept. */
export function cleanCards(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return [];
  const out: CardId[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !KNOWN.has(id) || out.includes(id as CardId)) continue;
    out.push(id as CardId);
    if (out.length === 8) break;
  }
  return out;
}

/** A full deck: exactly 8 unique known cards. */
export function isFullDeck(cards: readonly CardId[]): boolean {
  return cards.length === 8 && cleanCards(cards).length === 8;
}

/** Trim, drop control characters, collapse spaces and cap the length. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, SLOT_NAME_MAX).join("").trim();
}

/** Three slots holding `deck`, slot 1 active (the migration of a single saved deck). */
export function freshSlots(deck: readonly CardId[]): DeckSlots {
  const cards = cleanCards(deck);
  return {
    v: 1,
    active: 0,
    slots: Array.from({ length: SLOT_COUNT }, () => ({ name: "", cards: cards.slice() })),
  };
}

/** A stored value made safe, or null when it is not a slot store at all. */
export function sanitizeSlots(raw: unknown): DeckSlots | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<DeckSlots>;
  if (!Array.isArray(r.slots)) return null;
  const slots: DeckSlot[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = r.slots[i] as Partial<DeckSlot> | undefined;
    slots.push({ name: cleanName(s?.name), cards: cleanCards(s?.cards) });
  }
  // Empty slots (a damaged save) borrow the first full one.
  const donor = slots.find((s) => isFullDeck(s.cards));
  if (donor) for (const s of slots) if (s.cards.length === 0) s.cards = donor.cards.slice();
  const a = Number(r.active);
  const active = Number.isInteger(a) && a >= 0 && a < SLOT_COUNT ? a : 0;
  return { v: 1, active, slots };
}

function sameCards(a: readonly CardId[], b: readonly CardId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function read(kv: DeckSlotStore | null): DeckSlots | null {
  try {
    const raw = kv?.getItem(DECK_SLOTS_KEY);
    return raw ? sanitizeSlots(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveDeckSlots(state: DeckSlots, kv: DeckSlotStore | null): void {
  try {
    kv?.setItem(DECK_SLOTS_KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked: the slots just won't persist
  }
}

/** `state` with the active slot holding `deck` (unchanged unless `deck` is full and different). */
export function withActiveDeck(state: DeckSlots, deck: readonly CardId[]): DeckSlots {
  const cards = cleanCards(deck);
  if (!isFullDeck(cards) || sameCards(state.slots[state.active].cards, cards)) return state;
  return setSlotCards(state, state.active, cards);
}

/**
 * The slots, migrated on first use. `liveDeck` is the saved single deck
 * (meta.playerDeck): it becomes slot 1 on migration and always wins over
 * a stale copy in the active slot. Saves whatever it had to fix.
 */
export function loadDeckSlots(kv: DeckSlotStore | null, liveDeck: readonly CardId[]): DeckSlots {
  const saved = read(kv);
  if (!saved) {
    const fresh = freshSlots(liveDeck);
    saveDeckSlots(fresh, kv);
    return fresh;
  }
  const next = withActiveDeck(saved, liveDeck);
  if (next !== saved) saveDeckSlots(next, kv);
  return next;
}

/** saveProfile's hook: keep the active slot equal to the saved deck. */
export function mirrorActiveDeck(kv: DeckSlotStore | null, deck: readonly CardId[]): void {
  const saved = read(kv);
  if (!saved) {
    if (isFullDeck(cleanCards(deck))) saveDeckSlots(freshSlots(deck), kv);
    return;
  }
  const next = withActiveDeck(saved, deck);
  if (next !== saved) saveDeckSlots(next, kv);
}

const inRange = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < SLOT_COUNT;

export function setActiveSlot(state: DeckSlots, i: number): DeckSlots {
  if (!inRange(i) || i === state.active) return state;
  return { ...state, active: i };
}

export function setSlotCards(state: DeckSlots, i: number, cards: readonly CardId[]): DeckSlots {
  if (!inRange(i)) return state;
  const slots = state.slots.map((s, k) => (k === i ? { ...s, cards: cleanCards(cards) } : s));
  return { ...state, slots };
}

export function renameSlot(state: DeckSlots, i: number, name: string): DeckSlots {
  if (!inRange(i)) return state;
  const slots = state.slots.map((s, k) => (k === i ? { ...s, name: cleanName(name) } : s));
  return { ...state, slots };
}

/** Slot i's cards made playable: unowned cards swapped for owned ones (always 8 when the starter set is owned). */
export function playableDeck(state: DeckSlots, i: number, owned: OwnedSet): CardId[] {
  const s = state.slots[inRange(i) ? i : state.active];
  return clampDeckToOwned(s.cards, owned);
}
