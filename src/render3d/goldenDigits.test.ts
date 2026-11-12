/**
 * Golden Age digits on the battle board and the profile. The Golden Age
 * edition shows every number in Arabic-Indic digits (٠-٩), like the clock
 * and the card costs: the tower HP plates, the level shield capping them,
 * the floating damage numbers and the profile's season line. Classic keeps
 * Latin digits. Node tests run the Golden Age edition (ARABIC is true), so
 * the canvas painters are checked through a recording 2D context.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatInt } from "../ui/i18n";
import { seasonLine } from "../ui/screens/profile";
import profileSource from "../ui/screens/profile.ts?raw";
import { GLYPHS, glyphFace, paintGlyphs } from "./scene/fx/glyphs";
import { hpPlateLabel, levelBadgeLabel, makeLevelBadge, updateHpText } from "./scene/views/troops";
import type { HpText } from "./scene/common";
import { ARABIC } from "./theme";

const LATIN_DIGIT = /[0-9]/;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** A 2D context that records the text it is asked to draw (into `texts`). */
function recordingContext(texts: string[] = []): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "fillText" || prop === "strokeText") return (t: string) => void texts.push(t);
      if (prop === "measureText") return () => ({ width: 52 });
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("Golden Age digits", () => {
  it("node tests run the Golden Age edition", () => {
    expect(ARABIC).toBe(true);
  });

  it("formatInt: whole, ungrouped, in the edition's digits", () => {
    expect(formatInt(2534, true)).toBe("٢٥٣٤");
    expect(formatInt(2534, false)).toBe("2534");
    expect(formatInt(4008, true)).toBe("٤٠٠٨");
    expect(formatInt(9, true)).toBe("٩");
  });

  it("HP plate labels: Arabic-Indic in Golden Age, Latin in Classic", () => {
    expect(hpPlateLabel(2534)).toBe("٢٥٣٤");
    expect(hpPlateLabel(2534, false)).toBe("2534");
  });

  it("the HP plate paints Arabic-Indic digits only", () => {
    const { ctx, texts } = recordingContext();
    const t = { ctx, tex: { needsUpdate: false }, last: -1 } as unknown as HpText;
    updateHpText(t, 2533.2); // rounds up, like the bar
    expect(texts.length).toBeGreaterThan(0);
    for (const s of texts) expect(s).toBe("٢٥٣٤");
  });

  it("the level shield uses the same digits as the plate beside it", () => {
    expect(levelBadgeLabel(9)).toBe("٩");
    expect(levelBadgeLabel(9, false)).toBe("9");
    expect(levelBadgeLabel(11)).toBe("١١");
  });

  describe("the level shield's canvas", () => {
    const painted: string[] = [];
    beforeAll(() => {
      vi.stubGlobal("document", {
        // Every shield canvas records into `painted`.
        createElement: () => {
          const { ctx } = recordingContext(painted);
          return { width: 64, height: 64, getContext: () => ctx };
        },
      });
    });
    afterAll(() => vi.unstubAllGlobals());

    it("paints Arabic-Indic digits only", () => {
      makeLevelBadge("player", 9);
      makeLevelBadge("enemy", 11);
      expect(painted).toContain("٩");
      expect(painted).toContain("١١");
      for (const s of painted) expect(s).not.toMatch(LATIN_DIGIT);
    });
  });

  it("damage-number glyphs: digit cells show the edition's digits", () => {
    expect([..."0123456789"].map((d) => glyphFace(d, true)).join("")).toBe(ARABIC_DIGITS);
    expect([..."0123456789"].map((d) => glyphFace(d, false)).join("")).toBe("0123456789");
    for (const ch of "-+!*") expect(glyphFace(ch, true)).toBe(ch);
  });

  it("the damage-number atlas paints Arabic-Indic digits in Golden Age, Latin in Classic", () => {
    const golden = recordingContext();
    paintGlyphs(golden.ctx, Array<number>(GLYPHS.length).fill(0));
    for (const d of ARABIC_DIGITS) expect(golden.texts).toContain(d);
    for (const s of golden.texts) expect(s).not.toMatch(LATIN_DIGIT);

    const classic = recordingContext();
    paintGlyphs(classic.ctx, Array<number>(GLYPHS.length).fill(0), false);
    for (const d of "0123456789") expect(classic.texts).toContain(d);
    for (const s of classic.texts) expect(s).not.toMatch(/[٠-٩]/);
  });

  it("the profile names the season, with no Latin digits in Golden Age", () => {
    const line = seasonLine("2026-11");
    expect(line).toBe("الموسم: نوفمبر ٢٠٢٦");
    expect(line).not.toMatch(LATIN_DIGIT);
    // ...and the player card shows that line, not the raw key ("2026-11").
    expect(profileSource).toMatch(/\.textContent = seasonLine\(meta\.season\.key\)/);
    expect(profileSource).not.toMatch(/\$\{meta\.season\.key\}/);
  });
});
