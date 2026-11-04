import { describe, expect, it } from "vitest";
import { CODE_DIGITS, CODE_WORDS, makeCodeGen, normalizeCode } from "../net/codewords";
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
});

describe("opponent names", () => {
  it("a quick-match stranger is 'Opponent', a friend's game says 'Friend'", () => {
    // Node tests run the Golden Age edition, so these are the Arabic words.
    expect(opponentFallbackName(true)).toBe("خصم");
    expect(opponentFallbackName(false)).toBe("صديق");
  });
});
