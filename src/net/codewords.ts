/** Friendly, unambiguous animal words kids can read aloud and type. */
export const CODE_WORDS = [
  "LION",
  "BEAR",
  "WOLF",
  "FROG",
  "DEER",
  "GOAT",
  "HAWK",
  "SEAL",
  "CRAB",
  "LYNX",
  "MOLE",
  "TOAD",
  "DUCK",
  "FOX",
  "OWL",
  "PUMA",
  "MULE",
  "SWAN",
  "CARP",
  "WASP",
] as const;

/** Digits after the word in a new room code (LION042). */
export const CODE_NUMBER_DIGITS = 3;

/**
 * A room-code generator: a word from {@link CODE_WORDS} plus three digits
 * (LION042), which gives 20,000 distinct codes. Together with the relay's
 * wrong-code limit (server/joinGuard.ts) that makes a waiting room's code
 * impractical to guess. Randomness is injected.
 *
 * Codes used to have two digits (LION42). Any digit count still joins: the
 * relay looks codes up exactly, and normalizeCode, cleanCode and the code
 * box (12 characters) all take 3 digits, including on pages cached before
 * this change.
 */
export function makeCodeGen(rand: () => number): () => string {
  const span = 10 ** CODE_NUMBER_DIGITS;
  return () => {
    const word = CODE_WORDS[Math.floor(rand() * CODE_WORDS.length)];
    const n = Math.floor(rand() * span);
    return word + String(n).padStart(CODE_NUMBER_DIGITS, "0");
  };
}

/** The word part of a code (LION042 -> LION); v1 clients get bare words. */
export function wordPart(code: string): string {
  return code.replace(/\d+$/, "");
}

/** Crockford base32: no I, L, O or U, so codes read aloud unambiguously. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Fallback code of `len` base32 characters, used when the words run out. */
export function base32Code(rand: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += BASE32[Math.floor(rand() * BASE32.length)];
  return out;
}

/** The number part of a word code (the 042 in LION042): plain digits only. */
export const CODE_DIGITS = "0123456789";

/** Letters kids type for the digits they look like. */
const LOOKALIKE_DIGITS: Readonly<Record<string, string>> = { O: "0", I: "1" };

/**
 * A room code as a kid might type or paste it ("lion-42 ", "Carp 86",
 * "LION4O"), made canonical: every character that is not a letter or digit
 * goes, the rest is upper-cased, and in the number after a code word an O
 * reads as 0 and an I as 1. The word itself is left alone (LION has both),
 * and so is any code without a word (base32 codes have no O or I at all).
 */
export function normalizeCode(raw: string): string {
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const word = CODE_WORDS.find((w) => up.startsWith(w));
  if (!word) return up;
  const digits = up
    .slice(word.length)
    .replace(/[A-Z]/g, (c) => (!CODE_DIGITS.includes(c) && LOOKALIKE_DIGITS[c]) || c);
  return word + digits;
}
