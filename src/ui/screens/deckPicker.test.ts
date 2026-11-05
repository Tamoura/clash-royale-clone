import { describe, expect, it } from "vitest";
import type { CardId } from "../../game/cards";
import type { DeckCodeError } from "../../meta/deckCode";
import { codeErrorText, codeLockedText, deckSpots, editDeck, loadCode, swapScroll, type EditState } from "./deckPicker";

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

describe("ghosts: an entered code keeps its hand order", () => {
  // A sibling's code; the player hasn't found the Digger, the Comet or the Wizard yet.
  const CODE: CardId[] = ["digger", "hog-rider", "comet", "zap", "valkyrie", "wizard", "knight", "archers"];
  const OWNED = new Set<CardId>([...FULL, "hog-rider", "zap", "valkyrie", "bats"]);
  const drawn = (s: EditState): string[] =>
    deckSpots(s.deck, s.ghosts).map((x) => (x === null ? "-" : "card" in x ? x.card : `(${x.ghost})`));

  it("loads the owned cards and leaves each locked card in its own spot", () => {
    const s: EditState = { ...loadCode(CODE, OWNED), pending: null };
    expect(s.deck).toEqual(["hog-rider", "zap", "valkyrie", "knight", "archers"]);
    expect(drawn(s)).toEqual(["(digger)", "hog-rider", "(comet)", "zap", "valkyrie", "(wizard)", "knight", "archers"]);
  });

  it("fills the ghost spots in order, so the saved deck keeps the code's positions", () => {
    let s: EditState = { ...loadCode(CODE, OWNED), pending: null };
    for (const id of ["bats", "giant", "fireball"] as CardId[]) s = editDeck(s, { kind: "collection", id });
    expect(s.deck).toEqual(["bats", "hog-rider", "giant", "zap", "valkyrie", "fireball", "knight", "archers"]);
    expect(s.ghosts).toEqual([]);
    expect(drawn(s)).toEqual(s.deck);
  });

  it("keeps ghosts beside their neighbours when a card is removed, and fills them before the end", () => {
    let s: EditState = { ...loadCode(CODE, OWNED), pending: null };
    s = editDeck(s, { kind: "slot", index: 0 }); // remove hog-rider (deck index 0)
    expect(drawn(s)).toEqual(["(digger)", "(comet)", "zap", "valkyrie", "(wizard)", "knight", "archers", "-"]);
    s = editDeck(s, { kind: "collection", id: "knight" }); // tapping a deck card in the grid removes it too
    expect(drawn(s)).toEqual(["(digger)", "(comet)", "zap", "valkyrie", "(wizard)", "archers", "-", "-"]);
    s = editDeck(s, { kind: "collection", id: "bats" });
    s = editDeck(s, { kind: "collection", id: "giant" });
    expect(drawn(s)).toEqual(["bats", "giant", "zap", "valkyrie", "(wizard)", "archers", "-", "-"]);
    s = editDeck(s, { kind: "collection", id: "arrows" });
    s = editDeck(s, { kind: "collection", id: "musketeer" });
    expect(drawn(s)).toEqual(["bats", "giant", "zap", "valkyrie", "arrows", "archers", "musketeer", "-"]);
  });

  it("handles ghosts at the very end and back to back", () => {
    const tail: EditState = { ...loadCode(["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "digger", "comet"], OWNED), pending: null };
    expect(drawn(tail).slice(5)).toEqual(["mini-pekka", "(digger)", "(comet)"]);
    const next = editDeck(tail, { kind: "collection", id: "bats" });
    expect(drawn(next).slice(5)).toEqual(["mini-pekka", "bats", "(comet)"]);
    const head: EditState = { ...loadCode(["digger", "comet", "knight", "archers", "giant", "fireball", "musketeer", "mini-pekka"], OWNED), pending: null };
    expect(drawn(editDeck(head, { kind: "collection", id: "bats" })).slice(0, 3)).toEqual(["bats", "(comet)", "knight"]);
  });

  it("never draws more than 8 spots, and a deck with no ghosts draws as before", () => {
    expect(deckSpots(FULL)).toHaveLength(8);
    expect(deckSpots(FULL.slice(0, 6)).slice(6)).toEqual([null, null]);
    expect(deckSpots(FULL.slice(0, 7), [{ id: "digger", at: 0 }, { id: "comet", at: 7 }])).toHaveLength(8);
  });
});

describe("swapScroll: the swap prompt and the deck come into view", () => {
  const view = { top: 100, bottom: 400 };

  it("does nothing when the bar and the whole deck are in view", () => {
    expect(swapScroll(view, 120, 220, 330)).toBe(0);
  });

  it("scrolls down only as far as the whole deck needs, never past the bar", () => {
    // Deck bottom 40 px below the view: 48 px is enough (bar stays in view).
    expect(swapScroll(view, 200, 300, 440)).toBe(48);
    // Deck far below: stop with the bar at the top (8 px margin).
    expect(swapScroll(view, 300, 400, 650)).toBe(192);
  });

  it("scrolls back up when the bar is above the view (the kid had scrolled down to the cards)", () => {
    expect(swapScroll(view, -150, -40, 70)).toBe(-258);
  });

  it("on a screen too short for both, keeps the first deck row in view", () => {
    // Phone landscape: 90 px of view, a 56 px bar and a 44 px row.
    const short = { top: 120, bottom: 210 };
    const d = swapScroll(short, 180, 288, 288);
    expect(288 - d).toBeLessThanOrEqual(210);
    expect(288 - 44 - d).toBeGreaterThanOrEqual(120);
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

describe("codeLockedText", () => {
  const en = (a: string): string => a;
  const ar = (_: string, b: string): string => b;
  it("speaks of one card in the singular, in both languages", () => {
    expect(codeLockedText(en, ["Bats"])).toBe("1 card is still locked: Bats. You'll pick another card for its spot.");
    expect(codeLockedText(ar, ["Bats"])).toContain("بطاقة واحدة");
    expect(codeLockedText(ar, ["Bats"])).not.toContain("من البطاقات");
  });
  it("keeps the plural for two or more", () => {
    expect(codeLockedText(en, ["Bats", "Comet"])).toBe("2 cards are still locked: Bats, Comet. You'll pick others for those spots.");
    expect(codeLockedText(ar, ["Bats", "Comet"])).toContain("من البطاقات");
  });
});
