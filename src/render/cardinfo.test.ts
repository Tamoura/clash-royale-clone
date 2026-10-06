import { describe, expect, it } from "vitest";
import { levelMultiplier } from "../game/battle";
import { DECK, getCard } from "../game/cards";
import { cardStatLines, cardStatsAtLevel } from "./cardinfo";

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

describe("cardStatsAtLevel", () => {
  it("scales HP by the sim's level multiplier", () => {
    for (const id of ["knight", "giant", "cannon", "archers"] as const) {
      const base = getCard(id);
      if (base.kind === "spell") continue;
      for (const L of [1, 2, 5, 11]) {
        const s = cardStatsAtLevel(id, L);
        expect(s.hp).toBe(base.unit.maxHp * levelMultiplier({ [id]: L }, id));
      }
    }
  });

  it("raises damage and DPS level over level, and keeps rate stats fixed", () => {
    const a = cardStatsAtLevel("knight", 3);
    const b = cardStatsAtLevel("knight", 4);
    expect(b.damage!).toBeGreaterThan(a.damage!);
    expect(b.dps!).toBeCloseTo(b.damage! / b.hitSpeed!, 9);
    expect(b.hitSpeed).toBe(a.hitSpeed);
    expect(b.range).toBe(a.range);
    expect(b.speed).toBe("medium");
    expect(b.targets).toBe("ground");
  });

  it("describes spells by cast damage and radius", () => {
    const s = cardStatsAtLevel("fireball", 2);
    const card = getCard("fireball");
    expect(s.kind).toBe("spell");
    expect(s.hp).toBeNull();
    expect(s.damage).toBe(card.kind === "spell" ? card.damage * 1.1 : NaN);
    expect(s.targets).toBe("area");
  });

  it("reports counts, flyers and building hunters", () => {
    expect(cardStatsAtLevel("archers", 1).count).toBe(2);
    expect(cardStatsAtLevel("giant", 1).targets).toBe("buildings");
    expect(cardStatsAtLevel("musketeer", 1).targets).toBe("air-ground");
    expect(cardStatsAtLevel("elixir-collector", 1).dps).toBeNull();
  });

  it("covers every card without throwing", () => {
    for (const id of DECK) expect(() => cardStatsAtLevel(id, 1)).not.toThrow();
  });
});
