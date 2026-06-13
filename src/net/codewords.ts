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

/** A room-code generator drawing from {@link CODE_WORDS}; randomness injected. */
export function makeCodeGen(rand: () => number): () => string {
  return () => CODE_WORDS[Math.floor(rand() * CODE_WORDS.length)];
}
