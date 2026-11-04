import { describe, expect, it } from "vitest";
import { DECK, getCard, type CardId } from "../game/cards";
import { tr } from "../ui/i18n";
import { CARD_BLURBS, blurbText, cardBlurb } from "./cardBlurbs";

/**
 * The 38 stock cards at the time the blurbs were written. Frozen on
 * purpose: new cards land in other packages, and wave 2 extends this test
 * to every deckable card once their lines exist.
 */
const STOCK_CARDS: readonly CardId[] = Object.freeze([
  "knight", "archers", "firecracker", "magic-archer", "giant", "fireball", "musketeer",
  "mini-pekka", "baby-dragon", "valkyrie", "skeletons", "wizard", "witch", "hog-rider",
  "balloon", "prince", "pekka", "cannon", "tombstone", "elixir-collector", "gargoyles",
  "bats", "minions", "skeleton-army", "executioner", "electro-wizard", "ice-wizard",
  "princess", "mega-knight", "royal-giant", "arrows", "zap", "rage", "freeze", "heal",
  "tornado", "skeleton-barrel", "mirror",
] as CardId[]);

const ARABIC_LETTER = /[؀-ۿ]/;

describe("card blurbs", () => {
  it("covers the 38 stock cards with English and Arabic lines", () => {
    expect(STOCK_CARDS).toHaveLength(38);
    expect(new Set(STOCK_CARDS).size).toBe(38);
    for (const id of STOCK_CARDS) {
      const b = cardBlurb(id);
      expect(b, id).not.toBeNull();
      expect(b!.en.trim().length, id).toBeGreaterThan(10);
      expect(b!.ar.trim().length, id).toBeGreaterThan(10);
      expect(ARABIC_LETTER.test(b!.ar), id).toBe(true);
      expect(ARABIC_LETTER.test(b!.en), id).toBe(false);
    }
  });

  it("gives the Studio champion a generic line", () => {
    const b = cardBlurb("champion");
    expect(b?.en).toMatch(/Studio/);
    expect(b?.ar.length).toBeGreaterThan(5);
    expect(b?.good).toEqual([]);
    expect(b?.watch).toEqual([]);
  });

  it("only refers to real cards, never itself, never twice", () => {
    for (const [id, b] of Object.entries(CARD_BLURBS) as [CardId, NonNullable<(typeof CARD_BLURBS)[CardId]>][]) {
      const refs = [...b.good, ...b.watch];
      expect(new Set(refs).size, id).toBe(refs.length);
      for (const ref of refs) {
        expect(ref, id).not.toBe(id);
        expect(DECK, `${id} -> ${ref}`).toContain(ref);
        expect(getCard(ref).id).toBe(ref);
      }
      expect(b.good.length + b.watch.length, id).toBeLessThanOrEqual(4);
    }
  });

  it("matches the playtest example for Archers", () => {
    expect(CARD_BLURBS.archers?.en).toBe("Two sharpshooters. Great vs Baby Dragon!");
    expect(CARD_BLURBS.archers?.good).toContain("baby-dragon");
  });

  it("reads the line in the current edition and is null for an unknown card", () => {
    const k = CARD_BLURBS.knight!;
    expect(blurbText("knight")).toBe(tr(k.en, k.ar));
    expect(blurbText("not-a-card" as CardId)).toBeNull();
    expect(cardBlurb("not-a-card" as CardId)).toBeNull();
  });
});
