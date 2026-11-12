import { describe, expect, it } from "vitest";
import * as reveal from "./chestReveal";
import { LEGENDARY_BUILD_MS, flipDelay, rarityLabel, revealOrder } from "./chestReveal";
import source from "./chestReveal.ts?raw";

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

describe("chest reveal: the deck is safe from tap-through", () => {
  /** The source of one arrow-function const in playChestReveal, up to the next one. */
  const body = (name: string, next: string): string => {
    const from = source.indexOf(`const ${name} = `);
    const to = source.indexOf(`const ${next} = `, from + 1);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("no card in the reveal sequence offers Add to deck (only the summary does)", () => {
    const showCard = body("showCard", "addToDeckOffer");
    expect(showCard).not.toMatch(/addToDeck|button\(/);
    const summary = body("showSummary", "run");
    expect(summary).toMatch(/addToDeckOffer\(newId\)/);
    // ...below Collect, not in the middle of the screen.
    expect(summary.indexOf("addToDeckOffer(newId)")).toBeGreaterThan(summary.indexOf("summary.appendChild(ok)"));
  });

  it("never picks the outgoing card for the kid", () => {
    expect("swapOutIndex" in reveal).toBe(false);
    expect(source).not.toMatch(/swapOutIndex|most expensive|Swap in/);
    const offer = body("addToDeckOffer", "showSummary");
    // The deck changes only from the strip's answer, or by filling a free slot.
    expect(offer).toMatch(/pickSwapOut\(/);
    expect(offer).toMatch(/if \(i === null\) return;/);
  });
});
