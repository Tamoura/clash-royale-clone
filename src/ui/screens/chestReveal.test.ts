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

  it("without a legendary: shards from common up, the new card last", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "wizard",
      shards: { "baby-dragon": 2, knight: 6, wizard: 3, musketeer: 2 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "musketeer", "baby-dragon", "wizard"]);
    expect(order[order.length - 1].isNew).toBe(true);
    expect(order[order.length - 1].shards).toBe(3);
  });

  it("legendary shards are the finale, after an ordinary new card", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "bats",
      shards: { "mega-knight": 1, knight: 6, "baby-dragon": 2 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "baby-dragon", "bats", "mega-knight"]);
    expect(order.map((o) => o.isNew)).toEqual([false, false, true, false]);
  });

  it("a new legendary comes last of all, after legendary shards", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "digger",
      shards: { digger: 1, "magic-archer": 2, knight: 6 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "magic-archer", "digger"]);
    expect(order[2]).toEqual({ id: "digger", isNew: true, shards: 1 });
  });

  it("names the tier", () => {
    expect(rarityLabel("legendary", tr)).toBe("Legendary");
    expect(rarityLabel("epic", tr)).toBe("Epic");
  });
});
