import { describe, expect, it } from "vitest";
import { shardGoldPrice, upgradeCost } from "../../meta/economy";
import { chestGuideSlot, craftOffers } from "./home";

describe("chestGuideSlot: the first-chest pointer", () => {
  const chest = { rarity: "free", readyAt: 0 };
  it("points at the first slot holding a chest after a chest was earned", () => {
    expect(chestGuideSlot("1", null, [chest, null, null, null])).toBe(0);
    expect(chestGuideSlot("1", null, [null, chest, chest, null])).toBe(1);
  });
  it("stays away once the kid has tapped a chest, or with no fresh chest", () => {
    expect(chestGuideSlot("1", "1", [chest, null, null, null])).toBe(-1);
    expect(chestGuideSlot(null, null, [chest, null, null, null])).toBe(-1);
    expect(chestGuideSlot("1", null, [null, null, null, null])).toBe(-1);
    expect(chestGuideSlot("1", null, [])).toBe(-1);
  });
});

describe("craftOffers: the Shop's shard workshop", () => {
  it("charges the same per-rarity price as card info (legendary shards are dear)", () => {
    const offers = craftOffers({
      cardLevels: { digger: 3 },
      playerDeck: ["digger"],
      profile: { owned: ["knight", "digger"], shards: {} },
    });
    const digger = offers.find((o) => o.id === "digger")!;
    const knight = offers.find((o) => o.id === "knight")!;
    expect(digger.missing).toBe(upgradeCost("legendary", 3)!.shards);
    expect(digger.price).toBe(digger.missing * shardGoldPrice("legendary"));
    expect(knight.price).toBe(knight.missing * shardGoldPrice("common"));
    // Deck cards still lead, even when they cost more.
    expect(offers[0].id).toBe("digger");
  });
});
