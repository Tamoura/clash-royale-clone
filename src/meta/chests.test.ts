import { describe, expect, it } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import { ownedSet } from "./collection";
import {
  emptyChestSlots,
  grantMatchChest,
  mulberry32,
  openChest,
} from "./chests";

describe("chests", () => {
  it("grants a ready free chest into an empty slot on a win", () => {
    const rng = mulberry32(1);
    const { slots, granted, rarity } = grantMatchChest(
      emptyChestSlots(),
      0,
      1_000_000,
      rng,
      true,
    );
    expect(granted).toBe(true);
    expect(rarity).not.toBeNull();
    const filled = slots.filter(Boolean);
    expect(filled).toHaveLength(1);
    if (rarity === "free") {
      expect(filled[0]!.readyAt).toBe(1_000_000);
    }
  });

  it("opens with seeded rewards (gold always, deterministic)", () => {
    const a = openChest(
      { rarity: "free", readyAt: 0 },
      0,
      ownedSet(DEFAULT_DECK),
      mulberry32(42),
    );
    const b = openChest(
      { rarity: "free", readyAt: 0 },
      0,
      ownedSet(DEFAULT_DECK),
      mulberry32(42),
    );
    expect(a).toEqual(b);
    expect(a.gold).toBeGreaterThan(0);
  });

  it("can unlock a new arena-available card from a chest", () => {
    // At Goblin Stadium trophies, skeletons/zap/cannon are findable.
    const owned = ownedSet(DEFAULT_DECK);
    let foundNew = false;
    for (let seed = 0; seed < 80; seed++) {
      const r = openChest(
        { rarity: "rare", readyAt: 0 },
        100,
        owned,
        mulberry32(seed),
      );
      if (r.newCard && !owned.has(r.newCard)) {
        foundNew = true;
        break;
      }
    }
    expect(foundNew).toBe(true);
  });
});
