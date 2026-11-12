import { describe, expect, it } from "vitest";
import type { CardId } from "../../game/cards";
import { DECK_SIZE, STRIP_ARM_MS, STRIP_LOOK, addWithoutSwap, swapIntoDeck } from "./deckSwap";

const DECK: CardId[] = ["knight", "archers", "giant", "musketeer", "fireball", "mini-pekka", "arrows", "baby-dragon"];

describe("deck strip: the kid chooses which card leaves", () => {
  it("swaps exactly the card they tapped, and nothing else", () => {
    const next = swapIntoDeck(DECK, 3, "skeletons")!;
    expect(next).toEqual(["knight", "archers", "giant", "skeletons", "fireball", "mini-pekka", "arrows", "baby-dragon"]);
    expect(DECK[3]).toBe("musketeer"); // the old deck is untouched
    // The Giant (the most expensive card) stays unless they tap it.
    expect(next).toContain("giant");
  });

  it("is not a choice for a slot that doesn't exist or a card already in", () => {
    for (const i of [-1, 8, 1.5, Number.NaN]) expect(swapIntoDeck(DECK, i, "skeletons")).toBeNull();
    expect(swapIntoDeck(DECK, 0, "giant")).toBeNull();
  });

  it("a deck with room takes the card without anything going out", () => {
    expect(addWithoutSwap(DECK.slice(0, 7), "skeletons")).toEqual([...DECK.slice(0, 7), "skeletons"]);
    expect(addWithoutSwap(DECK, "skeletons")).toBeNull(); // full: the kid picks
    expect(addWithoutSwap(DECK.slice(0, 7), "knight")).toBeNull();
    expect(DECK).toHaveLength(DECK_SIZE);
  });

  it("'Keep my deck' is the big yellow default and takes the first focus", () => {
    expect(STRIP_LOOK.cancel).toBe("cta");
    expect(STRIP_LOOK.focus).toBe("cancel");
  });

  it("ignores the second tap of a double tap on Add", () => {
    expect(STRIP_ARM_MS).toBeGreaterThanOrEqual(300);
    expect(STRIP_ARM_MS).toBeLessThanOrEqual(800);
  });
});
