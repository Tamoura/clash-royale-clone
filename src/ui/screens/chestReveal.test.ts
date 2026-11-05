import { describe, expect, it } from "vitest";
import { LEGENDARY_BUILD_MS, flipDelay, rarityLabel, revealOrder } from "./chestReveal";

const tr = (en: string): string => en;

describe("chest reveal: the legendary moment", () => {
  it("a legendary waits face down for the build-up; other cards flip at once", () => {
    expect(flipDelay("legendary", false)).toBe(LEGENDARY_BUILD_MS);
    expect(LEGENDARY_BUILD_MS).toBeGreaterThan(1200);
    for (const r of ["common", "rare", "epic"] as const) expect(flipDelay(r, false)).toBeLessThan(LEGENDARY_BUILD_MS);
    // Reduced motion: no long build, just a beat more than a plain card.
    expect(flipDelay("legendary", true)).toBeLessThan(LEGENDARY_BUILD_MS);
    expect(flipDelay("legendary", true)).toBeGreaterThan(flipDelay("epic", true));
  });

  it("legendary shards come after the other shards, the new card last", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "wizard",
      shards: { "mega-knight": 1, knight: 6, "baby-dragon": 2, wizard: 3 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "baby-dragon", "mega-knight", "wizard"]);
    expect(order[order.length - 1].isNew).toBe(true);
  });

  it("names the tier", () => {
    expect(rarityLabel("legendary", tr)).toBe("Legendary");
    expect(rarityLabel("epic", tr)).toBe("Epic");
  });
});
