import { describe, expect, it } from "vitest";
import { CODE_NUMBER_DIGITS, CODE_WORDS, base32Code, makeCodeGen, wordPart } from "./codewords";

describe("room code words", () => {
  it("are short, uppercase, and kid-typable", () => {
    expect(CODE_WORDS.length).toBeGreaterThan(12);
    for (const w of CODE_WORDS) {
      expect(w).toMatch(/^[A-Z]{3,5}$/);
    }
  });

  it("builds WORD + 3 digits from the injected random source", () => {
    expect(CODE_NUMBER_DIGITS).toBe(3);
    const gen = makeCodeGen(() => 0);
    expect(gen()).toBe(`${CODE_WORDS[0]}000`);
    let i = 0;
    const seq = [0.99, 0.042];
    expect(makeCodeGen(() => seq[i++])()).toBe(`${CODE_WORDS[CODE_WORDS.length - 1]}042`);
    let j = 0;
    const top = [0, 0.9999];
    expect(makeCodeGen(() => top[j++])()).toBe(`${CODE_WORDS[0]}999`);
  });

  it("has 20,000 codes, and the generator reaches all 1,000 numbers", () => {
    expect(CODE_WORDS.length * 10 ** CODE_NUMBER_DIGITS).toBe(20_000);
    const seen = new Set<string>();
    for (let n = 0; n < 1000; n++) {
      let k = 0;
      const seq = [0, (n + 0.5) / 1000];
      seen.add(makeCodeGen(() => seq[k++])());
    }
    expect(seen.size).toBe(1000);
  });

  it("spreads picks across the list", () => {
    let i = 0;
    const seq = [0, 0, 0.5, 0, 0.99, 0];
    const gen = makeCodeGen(() => seq[i++]);
    expect(new Set([gen(), gen(), gen()].map(wordPart)).size).toBe(3);
  });

  it("strips the digits for v1 clients", () => {
    expect(wordPart("LION42")).toBe("LION");
    expect(wordPart("LION042")).toBe("LION");
    expect(wordPart("OWL")).toBe("OWL");
  });

  it("makes fixed-length, unambiguous base32 fallback codes", () => {
    let x = 0;
    const code = base32Code(() => (x = (x + 0.37) % 1), 6);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(base32Code(() => 0.999, 5)).toBe("ZZZZZ");
  });
});
