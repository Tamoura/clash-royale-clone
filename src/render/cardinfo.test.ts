import { describe, expect, it } from "vitest";
import { DECK } from "../game/cards";
import { cardStatLines } from "./cardinfo";

// Node runs under the Arabic edition by default (theme.ts fallback), so
// assertions accept either language wherever text is edition-dependent.
describe("card stat lines", () => {
  it("describes a troop with hp and damage", () => {
    const lines = cardStatLines("knight").join(" | ");
    expect(lines).toMatch(/Troop|وحدة/);
    expect(lines).toContain("1400");
    expect(lines).toContain("160");
  });

  it("describes spells by damage, radius and effects", () => {
    expect(cardStatLines("fireball").join(" ")).toContain("570");
    expect(cardStatLines("freeze").join(" ")).toMatch(/stun|صعق/i);
    expect(cardStatLines("rage").join(" ")).toMatch(/faster|boost|تسريع/i);
  });

  it("mentions special powers", () => {
    // Summon text uses the active mode's name (Skeletons / ميليشيا).
    expect(cardStatLines("witch").join(" ")).toMatch(/skeleton|militia|ميليشيا/i);
    expect(cardStatLines("balloon").join(" ")).toMatch(/death|موت/i);
    expect(cardStatLines("elixir-collector").join(" ")).toMatch(/elixir|إكسير/i);
  });

  it("covers the whole pool with at least two lines each", () => {
    for (const id of DECK) {
      expect(cardStatLines(id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("calls out piercing shots and recoil", () => {
    expect(cardStatLines("magic-archer").join(" ")).toMatch(/pierc|يخترق/i);
    expect(cardStatLines("firecracker").join(" ")).toMatch(/recoil|kick|ارتداد/i);
  });
});
