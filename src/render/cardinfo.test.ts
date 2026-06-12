import { describe, expect, it } from "vitest";
import { DECK } from "../game/cards";
import { cardStatLines } from "./cardinfo";

describe("card stat lines", () => {
  it("describes a troop with hp and damage", () => {
    const lines = cardStatLines("knight").join(" | ");
    expect(lines).toContain("Troop");
    expect(lines).toContain("1400");
    expect(lines).toContain("160");
  });

  it("describes spells by damage, radius and effects", () => {
    expect(cardStatLines("fireball").join(" ")).toContain("570");
    expect(cardStatLines("freeze").join(" ")).toMatch(/stun/i);
    expect(cardStatLines("rage").join(" ")).toMatch(/faster|boost/i);
  });

  it("mentions special powers", () => {
    expect(cardStatLines("witch").join(" ")).toMatch(/skeleton/i);
    expect(cardStatLines("balloon").join(" ")).toMatch(/death/i);
    expect(cardStatLines("elixir-collector").join(" ")).toMatch(/elixir/i);
  });

  it("covers the whole pool with at least two lines each", () => {
    for (const id of DECK) {
      expect(cardStatLines(id).length).toBeGreaterThanOrEqual(2);
    }
  });
});
