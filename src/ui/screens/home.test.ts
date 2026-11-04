import { describe, expect, it } from "vitest";
import { chestGuideSlot } from "./home";

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
