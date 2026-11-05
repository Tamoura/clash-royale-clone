import { describe, expect, it } from "vitest";
import { DECK, DEFAULT_DECK, TOKEN_IDS, isDeckable, type CardId } from "../game/cards";
import {
  CODE_ALPHABET,
  CODE_CARDS,
  CODE_LENGTH,
  encodeDeck,
  formatCode,
  isShareable,
  lockedCards,
  normalizeCode,
  parseDeckCode,
} from "./deckCode";

// Codes handed out by earlier builds: they must keep loading the same decks.
const PINNED_DEFAULT = "0024-2HGW-H0QV";
const PINNED_SAMPLE = "3YEY-0A3E-2D6A";
const SAMPLE: CardId[] = ["digger", "comet", "stone-golem", "knight", "mirror", "princess", "zap", "hog-rider"];

function codeOf(cards: CardId[]): string {
  const r = encodeDeck(cards);
  if (!r.ok) throw new Error(r.error);
  return r.code;
}

/** A code with valid check characters around arbitrary 10 data characters. */
function withValidCheck(data: string): string {
  // Brute-force the two check characters: tiny search, test-only.
  for (const a of CODE_ALPHABET)
    for (const b of CODE_ALPHABET) {
      const r = parseDeckCode(data + a + b);
      if (!r.ok && r.error === "check") continue;
      return data + a + b;
    }
  throw new Error("no check pair");
}

describe("CODE_CARDS (the index table)", () => {
  it("holds every deckable card exactly once and nothing else", () => {
    expect(new Set(CODE_CARDS).size).toBe(CODE_CARDS.length);
    const deckable = DECK.filter(isDeckable);
    // A new deckable card must be appended here, or it can't be shared.
    expect([...CODE_CARDS].sort()).toEqual([...deckable].sort());
    for (const t of TOKEN_IDS) expect(CODE_CARDS).not.toContain(t);
    expect(CODE_CARDS).not.toContain("champion");
    expect(CODE_CARDS.length).toBeLessThanOrEqual(64); // 6 bits per card
  });

  it("keeps old indices: pinned codes still read the same cards", () => {
    // If this fails, CODE_CARDS was reordered: append new cards instead.
    expect(codeOf([...DEFAULT_DECK])).toBe(PINNED_DEFAULT);
    expect(codeOf(SAMPLE)).toBe(PINNED_SAMPLE);
    expect(parseDeckCode(PINNED_SAMPLE)).toEqual({ ok: true, cards: SAMPLE, code: PINNED_SAMPLE });
    expect(CODE_CARDS.slice(0, 4)).toEqual(["knight", "archers", "firecracker", "magic-archer"]);
    expect(CODE_CARDS.indexOf("digger")).toBe(31);
    expect(CODE_CARDS.indexOf("mirror")).toBe(40);
  });
});

describe("encodeDeck / parseDeckCode", () => {
  it("round-trips decks in hand order", () => {
    for (const deck of [[...DEFAULT_DECK], SAMPLE, [...SAMPLE].reverse()]) {
      const code = codeOf(deck);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      const back = parseDeckCode(code);
      expect(back).toEqual({ ok: true, cards: deck, code });
    }
  });

  it("round-trips 300 random decks", () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let n = 0; n < 300; n++) {
      const pool = [...CODE_CARDS];
      const deck: CardId[] = [];
      while (deck.length < 8) deck.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      const r = parseDeckCode(codeOf(deck));
      expect(r.ok && r.cards).toEqual(deck);
    }
  });

  it("gives different codes for different orders (hand order is kept)", () => {
    const swapped = [...SAMPLE];
    [swapped[0], swapped[7]] = [swapped[7], swapped[0]];
    expect(codeOf(swapped)).not.toBe(codeOf(SAMPLE));
  });

  it("refuses decks that can't be shared", () => {
    expect(encodeDeck(SAMPLE.slice(0, 7))).toEqual({ ok: false, error: "count" });
    expect(encodeDeck([...SAMPLE.slice(0, 7), "digger"])).toEqual({ ok: false, error: "duplicate" });
    expect(encodeDeck([...SAMPLE.slice(0, 7), "champion"])).toEqual({ ok: false, error: "champion" });
    expect(encodeDeck([...SAMPLE.slice(0, 7), "pebble-golem"])).toEqual({ ok: false, error: "card" });
    expect(isShareable("pebble-golem")).toBe(false);
    expect(isShareable("champion")).toBe(false);
    expect(isShareable("digger")).toBe(true);
  });

  it("reads codes the way kids type them", () => {
    const code = codeOf(SAMPLE);
    const r = parseDeckCode(code);
    const plain = code.replace(/-/g, "");
    expect(parseDeckCode(plain)).toEqual(r);
    expect(parseDeckCode(`  ${code.toLowerCase()}  `)).toEqual(r);
    expect(parseDeckCode(plain.replace(/(.{4})/g, "$1 "))).toEqual(r);
    // Look-alikes: O -> 0, I/L -> 1.
    expect(normalizeCode("o0-Il")).toBe("0011");
    // Arabic-Indic digits from an Arabic keyboard.
    expect(normalizeCode("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    const arabic = code.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
    expect(parseDeckCode(arabic)).toEqual(r);
  });

  it("names what is wrong with a bad code", () => {
    const code = codeOf(SAMPLE).replace(/-/g, "");
    expect(parseDeckCode("")).toEqual({ ok: false, error: "empty" });
    expect(parseDeckCode(" - ")).toEqual({ ok: false, error: "empty" });
    expect(parseDeckCode(code.slice(0, 11) + "U")).toEqual({ ok: false, error: "char", detail: "U" });
    expect(parseDeckCode("K7Q2#M9XA3FB1")).toEqual({ ok: false, error: "char", detail: "#" });
    expect(parseDeckCode(code.slice(0, 10))).toEqual({ ok: false, error: "length", detail: "10" });
    expect(parseDeckCode(code + "7")).toEqual({ ok: false, error: "length", detail: "13" });
  });

  it("catches every single wrong character and every swapped neighbour pair", () => {
    const code = codeOf(SAMPLE).replace(/-/g, "");
    for (let i = 0; i < CODE_LENGTH; i++) {
      for (const ch of CODE_ALPHABET) {
        if (ch === code[i]) continue;
        const typo = code.slice(0, i) + ch + code.slice(i + 1);
        expect(parseDeckCode(typo).ok, `typo at ${i}: ${typo}`).toBe(false);
      }
    }
    for (let i = 0; i < CODE_LENGTH - 1; i++) {
      if (code[i] === code[i + 1]) continue;
      const swap = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      const r = parseDeckCode(swap);
      expect(r.ok, `swap at ${i}: ${swap}`).toBe(false);
    }
  });

  it("rejects crafted codes with a valid check: unknown card, duplicate, newer version", () => {
    // 50 bits: version 00, then 8 x 6-bit indices. Index 63 is no card.
    const toData = (version: number, idx: number[]): string => {
      const bits = version.toString(2).padStart(2, "0") + idx.map((i) => i.toString(2).padStart(6, "0")).join("");
      let s = "";
      for (let i = 0; i < 50; i += 5) s += CODE_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
      return s;
    };
    const unknown = withValidCheck(toData(0, [0, 1, 2, 3, 4, 5, 6, 63]));
    expect(parseDeckCode(unknown)).toEqual({ ok: false, error: "card" });
    const dup = withValidCheck(toData(0, [0, 1, 2, 3, 4, 5, 6, 0]));
    expect(parseDeckCode(dup)).toEqual({ ok: false, error: "duplicate" });
    const newer = withValidCheck(toData(1, [0, 1, 2, 3, 4, 5, 6, 7]));
    expect(parseDeckCode(newer)).toEqual({ ok: false, error: "version" });
    const fine = withValidCheck(toData(0, [0, 1, 2, 3, 4, 5, 6, 7]));
    expect(parseDeckCode(fine).ok).toBe(true);
  });

  it("formats in groups of four", () => {
    expect(formatCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("lockedCards", () => {
  it("lists the cards not owned yet, in deck order", () => {
    const owned = new Set<CardId>(["knight", "zap", "hog-rider", "princess"]);
    expect(lockedCards(SAMPLE, owned)).toEqual(["digger", "comet", "stone-golem", "mirror"]);
    expect(lockedCards(SAMPLE, new Set(SAMPLE))).toEqual([]);
  });
});
