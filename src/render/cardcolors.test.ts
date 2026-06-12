import { describe, expect, it } from "vitest";
import { DECK } from "../game/cards";
import { CARD_COLOR } from "./cardcolors";

describe("card signature colors", () => {
  it("every card in the pool has one", () => {
    for (const id of DECK) {
      expect(CARD_COLOR[id]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("no two cards share the exact same color", () => {
    const colors = DECK.map((id) => CARD_COLOR[id]);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
