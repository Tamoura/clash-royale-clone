import { describe, expect, it } from "vitest";
import { passBarLine, passFraction, passPillLine } from "./passText";

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
