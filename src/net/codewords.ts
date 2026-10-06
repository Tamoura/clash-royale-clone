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

/**
 * A room-code generator: a word from {@link CODE_WORDS} plus two digits
 * (LION42), which gives 2,000 distinct codes. Randomness is injected.
 */
export function makeCodeGen(rand: () => number): () => string {
  return () => {
    const word = CODE_WORDS[Math.floor(rand() * CODE_WORDS.length)];
    const n = Math.floor(rand() * 100);
    return word + String(n).padStart(2, "0");
  };
}

/** The word part of a code (LION42 -> LION); v1 clients get bare words. */
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
