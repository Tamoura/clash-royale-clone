import { describe, expect, it } from "vitest";
import { countFraction, passBarLine, passFraction, passPillLine } from "./passText";

const ARABIC_ZERO = "٠";

describe("Crown Pass text", () => {
  it("Classic keeps the short forms", () => {
    expect(passFraction(2, 10, false)).toBe("2/10");
    expect(passPillLine(1, 2, 10, false)).toBe("Tier 1 · 2/10");
    expect(passBarLine(2, 10, 2, false)).toBe("2 / 10 · next tier 2");
  });

  it("Golden Age uses Arabic-Indic digits, 'of' and the Arabic comma", () => {
    expect(passFraction(2, 10, true)).toBe("٢ من ١٠");
    expect(passPillLine(0, 2, 10, true)).toBe("المستوى ٠، ٢ من ١٠");
    expect(passBarLine(2, 10, 1, true)).toBe("٢ من ١٠، المستوى التالي ١");
  });

  it("the compact count stays short: one isolated left-to-right number run", () => {
    expect(countFraction(22, 42, false)).toBe("22/42");
    expect(countFraction(22, 42, true)).toBe("\u2066٢٢/٤٢\u2069");
    for (let n = 0; n <= 42; n++) {
      const s = countFraction(n, 42, true);
      // Only Arabic-Indic digits and one slash inside the isolate: no space
      // to wrap at, no dot-like separator next to the dot-like zero.
      expect(s).toMatch(/^\u2066[\u0660-\u0669]+\/[\u0660-\u0669]+\u2069$/);
      expect(s).not.toMatch(/[·.\u066B\u066C\s]/);
      // Never longer than the passFraction form it replaces in tight cells.
      expect(s.length).toBeLessThan(passFraction(n, 42, true).length + 2);
    }
  });

  it("never puts a dot-like separator or a slash next to the dot-like Arabic zero", () => {
    for (let tier = 0; tier <= 30; tier++) {
      for (const into of [0, 2, 9, 10]) {
        for (const s of [passPillLine(tier, into, 10, true), passBarLine(into, 10, tier + 1, true)]) {
          expect(s).not.toMatch(/[·./]/);
          // A zero only ever touches a digit, a space or the comma-shaped ،.
          const re = new RegExp(`${ARABIC_ZERO}[^\\s\\u0660-\\u0669\\u060C]`);
          expect(s).not.toMatch(re);
        }
      }
    }
  });
});
