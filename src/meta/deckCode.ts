/**
 * Deck codes: a short code for an 8-card deck that a kid can read out,
 * type or paste, e.g. "K7Q2-M9XA-3FB1".
 *
 * Layout (12 characters of Crockford base32, shown as three groups of 4):
 * - 10 data characters = 50 bits: a 2-bit format version, then the 8
 *   cards in deck order (hand order matters: the first 4 start in hand),
 *   6 bits each, as indices into CODE_CARDS;
 * - 2 check characters: a Luhn mod 32 character (catches every single
 *   wrong character and almost every swapped pair) and an odd-weighted
 *   sum, so a random typo slips through about 1 time in 1000.
 *
 * Reading is forgiving: lower case, spaces and dashes are fine, O reads
 * as 0, I and L as 1, and Arabic-Indic digits (from an Arabic keyboard)
 * as 0-9. Only deckable cards can be in a code: no tokens, no
 * duplicates, exactly 8, and never the per-device Studio Champion.
 */
import { DECK, isDeckable, TOKEN_IDS, type CardId } from "../game/cards";
import type { OwnedSet } from "./collection";

/**
 * Card index table for codes. APPEND ONLY: an index, once given out,
 * belongs to its card forever, or old codes would load the wrong cards.
 * New deckable cards go at the end (deckCode.test.ts enforces both).
 */
export const CODE_CARDS: readonly CardId[] = [
  "knight",
  "archers",
  "firecracker",
  "magic-archer",
  "giant",
  "fireball",
  "musketeer",
  "mini-pekka",
  "baby-dragon",
  "valkyrie",
  "skeletons",
  "wizard",
  "witch",
  "hog-rider",
  "balloon",
  "prince",
  "pekka",
  "cannon",
  "tombstone",
  "elixir-collector",
  "gargoyles",
  "bats",
  "minions",
  "skeleton-army",
  "executioner",
  "electro-wizard",
  "ice-wizard",
  "princess",
  "mega-knight",
  "royal-giant",
  "stone-golem",
  "digger",
  "arrows",
  "zap",
  "rage",
  "freeze",
  "heal",
  "tornado",
  "skeleton-barrel",
  "comet",
  "mirror",
];

/** Crockford base32: no I, L, O or U, so nothing looks like something else. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_DATA_CHARS = 10;
export const CODE_LENGTH = 12;
export const CODE_VERSION = 0;
const BITS_PER_CARD = 6;
const VERSION_BITS = 2;

export type DeckCodeError =
  /** Nothing typed. */
  | "empty"
  /** A character that is never in a code (e.g. U, #). */
  | "char"
  /** Too few or too many characters. */
  | "length"
  /** The check characters don't match: a typo. */
  | "check"
  /** A newer code format than this game knows. */
  | "version"
  /** A card index this game doesn't have (or a token). */
  | "card"
  /** The same card twice. */
  | "duplicate"
  /** Not exactly 8 cards (encode only). */
  | "count"
  /** The deck has the Studio Champion (encode only). */
  | "champion";

export type EncodeResult = { ok: true; code: string } | { ok: false; error: DeckCodeError };
export type ParseResult = { ok: true; cards: CardId[]; code: string } | { ok: false; error: DeckCodeError; detail?: string };

const TOKENS = new Set<CardId>(TOKEN_IDS);
const INDEX = new Map<CardId, number>(CODE_CARDS.map((id, i) => [id, i]));

const val = (ch: string): number => CODE_ALPHABET.indexOf(ch);

/** Luhn mod 32 check character over base32 digit values. */
function luhn32(values: readonly number[]): number {
  let sum = 0;
  let double = true; // the rightmost data digit is doubled
  for (let i = values.length - 1; i >= 0; i--) {
    let v = values[i];
    if (double) {
      v *= 2;
      v = Math.floor(v / 32) + (v % 32);
    }
    sum += v;
    double = !double;
  }
  return (32 - (sum % 32)) % 32;
}

/** Odd weights are invertible mod 32, so any single wrong character changes it. */
function weighted32(values: readonly number[]): number {
  let sum = 7;
  values.forEach((v, i) => {
    sum += v * (2 * i + 3);
  });
  return sum % 32;
}

function checkChars(data: readonly number[]): string {
  return CODE_ALPHABET[luhn32(data)] + CODE_ALPHABET[weighted32(data)];
}

/** "K7Q2M9XA3FB1" -> "K7Q2-M9XA-3FB1". */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Can this card be in a shared code? */
export function isShareable(id: CardId): boolean {
  return INDEX.has(id) && isDeckable(id) && !TOKENS.has(id);
}

/** The code for a deck (dashes included), or why it can't have one. */
export function encodeDeck(cards: readonly CardId[]): EncodeResult {
  if (cards.length !== 8) return { ok: false, error: "count" };
  if (new Set(cards).size !== 8) return { ok: false, error: "duplicate" };
  if (cards.includes("champion")) return { ok: false, error: "champion" };
  if (!cards.every(isShareable)) return { ok: false, error: "card" };
  let bits = CODE_VERSION.toString(2).padStart(VERSION_BITS, "0");
  for (const id of cards) bits += INDEX.get(id)!.toString(2).padStart(BITS_PER_CARD, "0");
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 5) data.push(parseInt(bits.slice(i, i + 5), 2));
  const raw = data.map((v) => CODE_ALPHABET[v]).join("") + checkChars(data);
  return { ok: true, code: formatCode(raw) };
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Upper-case, strip separators, read look-alikes (O->0, I/L->1) and
 * Arabic-Indic digits. Characters that are never in a code are kept, so
 * the parser can name them.
 */
export function normalizeCode(input: string): string {
  let out = "";
  for (const raw of input.normalize("NFKC")) {
    let ch = raw.toUpperCase();
    const ar = ARABIC_DIGITS.indexOf(raw);
    const fa = PERSIAN_DIGITS.indexOf(raw);
    if (ar >= 0) ch = String(ar);
    else if (fa >= 0) ch = String(fa);
    if (/[\s\-_.‐-―−ـ]/.test(ch)) continue;
    if (ch === "O") ch = "0";
    else if (ch === "I" || ch === "L") ch = "1";
    out += ch;
  }
  return out;
}

/** Read a typed or pasted code. Cards come back in deck (hand) order. */
export function parseDeckCode(input: string): ParseResult {
  const code = normalizeCode(input);
  if (code.length === 0) return { ok: false, error: "empty" };
  const bad = Array.from(code).find((ch) => val(ch) < 0);
  if (bad !== undefined) return { ok: false, error: "char", detail: bad };
  if (code.length !== CODE_LENGTH) return { ok: false, error: "length", detail: String(code.length) };
  const values = Array.from(code).map(val);
  const data = values.slice(0, CODE_DATA_CHARS);
  if (checkChars(data) !== code.slice(CODE_DATA_CHARS)) return { ok: false, error: "check" };
  const bits = data.map((v) => v.toString(2).padStart(5, "0")).join("");
  const version = parseInt(bits.slice(0, VERSION_BITS), 2);
  if (version !== CODE_VERSION) return { ok: false, error: "version" };
  const cards: CardId[] = [];
  for (let i = 0; i < 8; i++) {
    const at = VERSION_BITS + i * BITS_PER_CARD;
    const id = CODE_CARDS[parseInt(bits.slice(at, at + BITS_PER_CARD), 2)];
    if (!id || !DECK.includes(id) || !isShareable(id)) return { ok: false, error: "card" };
    if (cards.includes(id)) return { ok: false, error: "duplicate" };
    cards.push(id);
  }
  return { ok: true, cards, code: formatCode(code) };
}

/** The cards of a deck the player has not found yet (shown with a lock). */
export function lockedCards(cards: readonly CardId[], owned: OwnedSet): CardId[] {
  return cards.filter((id) => !owned.has(id));
}
