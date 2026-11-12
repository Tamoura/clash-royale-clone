import { describe, expect, it } from "vitest";
import mainSource from "../main.ts?raw";
import { EMOTES, EMOTE_PICKER, RETIRED_EMOTES, botReaction, emoteGlyph, type BotMoment } from "./emotes";

/** Faces that laugh at, gloat over or shout at the other player. */
const UNKIND = ["\u{1F602}", "\u{1F923}", "\u{1F621}", "\u{1F620}", "\u{1F92C}", "\u{1F389}", "\u{1F61C}", "\u{1F60F}"];

describe("emotes: a friendly set on stable wire ids", () => {
  it("fits the protocol's 0..7 ids and keeps the shared ones where old clients have them", () => {
    expect(EMOTES.length).toBeLessThanOrEqual(8);
    expect(EMOTES[1]).toBe("\u{1F62D}"); // crying: as on old clients
    expect(EMOTES[2]).toBe("\u{1F44D}"); // thumbs up: as on old clients
  });

  it("retires laughing (0) and angry (3): a new client shows nothing for them", () => {
    expect(RETIRED_EMOTES).toEqual([0, 3]);
    for (const id of RETIRED_EMOTES) {
      expect(EMOTES[id]).toBe("");
      expect(emoteGlyph(id)).toBeNull();
    }
  });

  it("drops ids it does not know (and junk)", () => {
    for (const id of [7, 8, 255, -1, 1.5, Number.NaN]) expect(emoteGlyph(id)).toBeNull();
  });

  it("the picker offers four friendly emotes, none retired and none unkind", () => {
    expect(EMOTE_PICKER).toHaveLength(4);
    const ids = EMOTE_PICKER.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    for (const p of EMOTE_PICKER) {
      expect(RETIRED_EMOTES).not.toContain(p.id);
      const g = emoteGlyph(p.id);
      expect(g).toBeTruthy();
      expect(UNKIND).not.toContain(g);
      expect(p.id).toBeGreaterThanOrEqual(0);
      expect(p.id).toBeLessThanOrEqual(7);
      // Every button has a spoken name in both languages.
      expect(p.label[0].length).toBeGreaterThan(0);
      expect(p.label[1]).toMatch(/[؀-ۿ]/);
    }
    // The crying face from the old set is not offered any more either.
    expect(ids).not.toContain(1);
    // New emotes live on the ids old clients ignore.
    expect(ids.filter((id) => id >= 4).length).toBe(3);
  });

  it("no unkind glyph is anywhere in the table", () => {
    for (const g of EMOTES) expect(UNKIND).not.toContain(g);
  });
});

describe("botReaction: the bot is a good sport", () => {
  const moments: BotMoment[] = [
    { type: "crown", byKid: true },
    { type: "crown", byKid: false },
    { type: "end", kidWon: true },
    { type: "end", kidWon: false },
    { type: "end", kidWon: null },
  ];

  it("never laughs, gloats or celebrates the kid's loss", () => {
    for (const m of moments) {
      const id = botReaction(m);
      if (id === null) continue;
      const g = emoteGlyph(id);
      expect(g).toBeTruthy();
      expect(UNKIND).not.toContain(g);
      expect(id).not.toBe(1); // not even the crying face
    }
  });

  it("stays quiet when it takes the kid's tower", () => {
    expect(botReaction({ type: "crown", byKid: false })).toBeNull();
  });

  it("says wow when the kid takes its tower", () => {
    expect(emoteGlyph(botReaction({ type: "crown", byKid: true })!)).toBe("\u{1F62E}");
  });

  it("gives a thumbs up when the kid wins and a friendly wave otherwise", () => {
    expect(emoteGlyph(botReaction({ type: "end", kidWon: true })!)).toBe("\u{1F44D}");
    expect(emoteGlyph(botReaction({ type: "end", kidWon: false })!)).toBe("\u{1F44B}");
    expect(emoteGlyph(botReaction({ type: "end", kidWon: null })!)).toBe("\u{1F44B}");
  });
});

describe("main.ts wires only the kind set", () => {
  it("has no laughing, angry or party glyph and no emote list of its own", () => {
    for (const g of UNKIND) expect(mainSource.includes(g)).toBe(false);
    expect(mainSource).not.toMatch(/\bconst EMOTES\s*=/);
    expect(mainSource).not.toMatch(/politeBot/);
  });
});
