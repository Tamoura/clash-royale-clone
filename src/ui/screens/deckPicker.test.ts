import { describe, expect, it } from "vitest";
import type { CardId } from "../../game/cards";
import type { DeckCodeError } from "../../meta/deckCode";
import { codeErrorText, editDeck, type EditState } from "./deckPicker";

const FULL: CardId[] = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
const st = (deck: CardId[], pending: CardId | null = null): EditState => ({ deck: deck.slice(), pending });

describe("editDeck: adding and removing", () => {
  it("adds a collection card while there is room, at the end", () => {
    const r = editDeck(st(FULL.slice(0, 7)), { kind: "collection", id: "wizard" });
    expect(r.deck).toEqual([...FULL.slice(0, 7), "wizard"]);
    expect(r.pending).toBeNull();
  });

  it("removes a card tapped in the collection or in the deck", () => {
    expect(editDeck(st(FULL), { kind: "collection", id: "giant" }).deck).toEqual(FULL.filter((c) => c !== "giant"));
    expect(editDeck(st(FULL), { kind: "slot", index: 0 }).deck).toEqual(FULL.slice(1));
  });

  it("ignores taps on empty deck spots", () => {
    const r = editDeck(st(FULL.slice(0, 5)), { kind: "slot", index: 6 });
    expect(r.deck).toEqual(FULL.slice(0, 5));
  });

  it("never mutates the state it was given", () => {
    const s = st(FULL);
    editDeck(s, { kind: "slot", index: 0 });
    editDeck(s, { kind: "collection", id: "wizard" });
    expect(s.deck).toEqual(FULL);
    expect(s.pending).toBeNull();
  });
});

describe("editDeck: swap mode on a full deck", () => {
  it("picks up a new card instead of doing nothing", () => {
    const r = editDeck(st(FULL), { kind: "collection", id: "wizard" });
    expect(r.deck).toEqual(FULL);
    expect(r.pending).toBe("wizard");
  });

  it("swaps it in place for the deck card tapped next", () => {
    const r = editDeck(st(FULL, "wizard"), { kind: "slot", index: 2 });
    expect(r.deck).toEqual(["knight", "archers", "wizard", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"]);
    expect(r.pending).toBeNull();
    expect(r.swapped).toBe(2);
  });

  it("also swaps when the deck card is tapped in the collection grid", () => {
    const r = editDeck(st(FULL, "wizard"), { kind: "collection", id: "arrows" });
    expect(r.deck[7]).toBe("wizard");
    expect(r.deck).not.toContain("arrows");
    expect(r.swapped).toBe(7);
  });

  it("drops the picked card on a second tap, on cancel, or switches to another", () => {
    expect(editDeck(st(FULL, "wizard"), { kind: "collection", id: "wizard" }).pending).toBeNull();
    expect(editDeck(st(FULL, "wizard"), { kind: "cancel" }).pending).toBeNull();
    const other = editDeck(st(FULL, "wizard"), { kind: "collection", id: "witch" });
    expect(other.pending).toBe("witch");
    expect(other.deck).toEqual(FULL);
  });

  it("keeps the deck at 8 unique cards through any swap sequence", () => {
    let s: EditState = st(FULL);
    const taps: CardId[] = ["wizard", "knight", "witch", "wizard", "hog-rider", "witch"];
    for (const id of taps) {
      s = editDeck(s, { kind: "collection", id });
      if (s.pending) s = editDeck(s, { kind: "slot", index: 3 });
      expect(new Set(s.deck).size).toBe(s.deck.length);
      expect(s.deck.length).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("codeErrorText", () => {
  const en = (a: string): string => a;
  const ar = (_: string, b: string): string => b;
  const errors: DeckCodeError[] = ["empty", "char", "length", "check", "version", "card", "duplicate", "count", "champion"];

  it("has a clear message for every error, in both editions", () => {
    for (const e of errors) {
      expect(codeErrorText(en, e, "U").length).toBeGreaterThan(10);
      expect(codeErrorText(ar, e, "U")).toMatch(/[؀-ۿ]/);
    }
    expect(codeErrorText(en, "char", "U")).toContain('"U"');
    expect(codeErrorText(en, "length", "10")).toContain("This one has 10");
  });
});
