import { describe, expect, it } from "vitest";
import { CODE_DIGITS, CODE_WORDS, makeCodeGen, normalizeCode } from "../net/codewords";
import { CODE_PATTERN } from "../net/validate";
import { mulberry32 } from "../net/session";
import { cleanCode, opponentFallbackName } from "../match/online";
import { sanitizeCode } from "./screens/lobby";

describe("lobby code sanitizer", () => {
  it("drops dashes, spaces and case: 'carp-86 ' joins CARP86", () => {
    expect(sanitizeCode("carp-86 ")).toBe("CARP86");
    expect(sanitizeCode("lion-42 ")).toBe("LION42");
    expect(sanitizeCode(" Lion 42")).toBe("LION42");
    expect(sanitizeCode("w.a.s.p_94!")).toBe("WASP94");
    expect(sanitizeCode("")).toBe("");
  });

  it("reads O as 0 and I as 1 in the number, never in the word", () => {
    expect(CODE_DIGITS).not.toMatch(/[OI]/);
    expect(sanitizeCode("lion4o")).toBe("LION40");
    expect(sanitizeCode("LIONIO")).toBe("LION10");
    expect(sanitizeCode("fox-o7")).toBe("FOX07");
    // The words themselves keep their letters (LION, GOAT, MOLE, TOAD, OWL…).
    for (const w of CODE_WORDS) expect(sanitizeCode(w.toLowerCase())).toBe(w);
  });

  it("leaves codes without a word alone (base32 has no O or I anyway)", () => {
    expect(sanitizeCode("7kq-2mx")).toBe("7KQ2MX");
    expect(sanitizeCode("r00io")).toBe("R00IO");
  });

  it("keeps every generated code unchanged", () => {
    const gen = makeCodeGen(mulberry32(3));
    for (let i = 0; i < 300; i++) {
      const c = gen();
      expect(normalizeCode(c)).toBe(c);
      expect(sanitizeCode(c.toLowerCase().replace(/(\d)/, "-$1"))).toBe(c);
    }
  });

  it("invite links and the join button use the same rules", () => {
    expect(cleanCode("carp-86 ")).toBe("CARP86");
    expect(cleanCode("lion4o")).toBe("LION40");
    expect(cleanCode("--")).toBeNull();
    expect(cleanCode(null)).toBeNull();
    expect(cleanCode("x".repeat(13))).toBeNull();
  });

  it("refuses markup in a link instead of stripping it into a code", () => {
    expect(cleanCode("<script>")).toBeNull();
    expect(cleanCode("LION42\"onload=x")).toBeNull();
    expect(cleanCode("a/b/c")).toBeNull();
    expect(cleanCode(" Lion 42 ")).toBe("LION42");
    expect(cleanCode("w.a.s.p_94")).toBe("WASP94");
  });
});

/**
 * The code rules as a page cached before the 3-digit change runs them
 * (2054fdb: src/net/codewords.ts normalizeCode, src/match/online.ts cleanCode,
 * and the lobby's code box with maxLength 12). Frozen here on purpose: a
 * kid with that old page must still be able to type a new code.
 */
const OLD_WORDS = ["LION", "BEAR", "WOLF", "FROG", "DEER", "GOAT", "HAWK", "SEAL", "CRAB", "LYNX", "MOLE", "TOAD", "DUCK", "FOX", "OWL", "PUMA", "MULE", "SWAN", "CARP", "WASP"];
function oldNormalize(raw: string): string {
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const word = OLD_WORDS.find((w) => up.startsWith(w));
  if (!word) return up;
  const look: Record<string, string> = { O: "0", I: "1" };
  return word + up.slice(word.length).replace(/[A-Z]/g, (c) => (!"0123456789".includes(c) && look[c]) || c);
}
function oldClean(raw: string): string | null {
  if (/[<>"'`&\\/=;(){}]/.test(raw)) return null;
  const c = oldNormalize(raw);
  return /^[A-Z0-9]{3,12}$/.test(c) ? c : null;
}
const OLD_MAX_LENGTH = 12;

describe("three-digit room codes", () => {
  const gen = makeCodeGen(mulberry32(11));
  const codes = Array.from({ length: 400 }, gen);

  it("are what new rooms get (LION042)", () => {
    for (const c of codes) expect(c).toMatch(/^[A-Z]{3,4}\d{3}$/);
    expect(new Set(OLD_WORDS)).toEqual(new Set(CODE_WORDS));
  });

  it("pass the code box, the Join button, invite links and the relay unchanged", () => {
    for (const c of codes) {
      expect(sanitizeCode(c)).toBe(c);
      expect(sanitizeCode(` ${c.toLowerCase().replace(/(\d)/, "-$1")} `)).toBe(c);
      expect(cleanCode(c)).toBe(c);
      expect(c.length).toBeLessThanOrEqual(12);
      expect(CODE_PATTERN.test(c)).toBe(true);
    }
    expect(sanitizeCode("lion-o4i")).toBe("LION041");
  });

  it("still work on a page cached before the change (old rules, 12-character box)", () => {
    for (const c of codes) {
      const typed = ` ${c.toLowerCase().replace(/(\d)/, "-$1")} `;
      expect(oldNormalize(typed)).toBe(c);
      expect(oldNormalize(typed).slice(0, OLD_MAX_LENGTH)).toBe(c);
      expect(oldClean(c)).toBe(c);
      expect(oldClean(typed)).toBe(c);
    }
  });

  it("old two-digit codes are still accepted everywhere (a room made just before an update)", () => {
    expect(sanitizeCode("lion-42")).toBe("LION42");
    expect(cleanCode("LION42")).toBe("LION42");
    expect(CODE_PATTERN.test("LION42")).toBe(true);
  });
});

describe("opponent names", () => {
  it("a quick-match stranger is 'Opponent', a friend's game says 'Friend'", () => {
    // Node tests run the Golden Age edition, so these are the Arabic words.
    expect(opponentFallbackName(true)).toBe("خصم");
    expect(opponentFallbackName(false)).toBe("صديق");
  });
});
