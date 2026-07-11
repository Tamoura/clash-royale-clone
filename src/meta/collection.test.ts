import { describe, expect, it } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import {
  canPutInDeck,
  clampDeckToOwned,
  isOwnedDeck,
  ownedSet,
  starterOwned,
} from "./collection";

describe("collection", () => {
  it("starter owned matches the default battle deck", () => {
    expect(starterOwned()).toEqual([...DEFAULT_DECK]);
  });

  it("gates deck slots to owned cards only", () => {
    const owned = ownedSet(DEFAULT_DECK);
    expect(canPutInDeck("knight", owned)).toBe(true);
    expect(canPutInDeck("pekka", owned)).toBe(false);
    expect(isOwnedDeck(DEFAULT_DECK, owned)).toBe(true);
    expect(isOwnedDeck([...DEFAULT_DECK.slice(0, 7), "pekka"], owned)).toBe(false);
  });

  it("clamps illegal decks back to owned cards", () => {
    const owned = ownedSet(DEFAULT_DECK);
    const clamped = clampDeckToOwned(
      ["pekka", "knight", "witch", "archers", "giant", "fireball", "musketeer", "mini-pekka"],
      owned,
    );
    expect(clamped).toHaveLength(8);
    expect(clamped.every((id) => owned.has(id))).toBe(true);
    expect(new Set(clamped).size).toBe(8);
  });
});
