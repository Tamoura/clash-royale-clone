import { describe, expect, it } from "vitest";
import { CODE_WORDS, makeCodeGen } from "./codewords";

describe("room code words", () => {
  it("are short, uppercase, and kid-typable", () => {
    expect(CODE_WORDS.length).toBeGreaterThan(12);
    for (const w of CODE_WORDS) {
      expect(w).toMatch(/^[A-Z]{3,5}$/);
    }
  });

  it("picks a word using the injected random source", () => {
    const gen = makeCodeGen(() => 0);
    expect(gen()).toBe(CODE_WORDS[0]);
  });

  it("spreads picks across the list", () => {
    let i = 0;
    const seq = [0, 0.5, 0.99];
    const gen = makeCodeGen(() => seq[i++]);
    expect(new Set([gen(), gen(), gen()]).size).toBe(3);
  });
});
