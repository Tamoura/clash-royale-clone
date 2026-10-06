import { describe, expect, it } from "vitest";
import { CODE_WORDS, base32Code, makeCodeGen, wordPart } from "./codewords";

describe("room code words", () => {
  it("are short, uppercase, and kid-typable", () => {
    expect(CODE_WORDS.length).toBeGreaterThan(12);
    for (const w of CODE_WORDS) {
      expect(w).toMatch(/^[A-Z]{3,5}$/);
    }
  });

  it("builds WORD + 2 digits from the injected random source", () => {
    const gen = makeCodeGen(() => 0);
    expect(gen()).toBe(`${CODE_WORDS[0]}00`);
    let i = 0;
    const seq = [0.99, 0.42];
    expect(makeCodeGen(() => seq[i++])()).toBe(`${CODE_WORDS[CODE_WORDS.length - 1]}42`);
  });

  it("spreads picks across the list", () => {
    let i = 0;
    const seq = [0, 0, 0.5, 0, 0.99, 0];
    const gen = makeCodeGen(() => seq[i++]);
    expect(new Set([gen(), gen(), gen()].map(wordPart)).size).toBe(3);
  });

  it("strips the digits for v1 clients", () => {
    expect(wordPart("LION42")).toBe("LION");
    expect(wordPart("OWL")).toBe("OWL");
  });

  it("makes fixed-length, unambiguous base32 fallback codes", () => {
    let x = 0;
    const code = base32Code(() => (x = (x + 0.37) % 1), 6);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(base32Code(() => 0.999, 5)).toBe("ZZZZZ");
  });
});
