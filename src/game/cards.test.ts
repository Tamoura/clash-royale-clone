import { describe, expect, it } from "vitest";
import { CARDS, DECK, getCard } from "./cards";

describe("cards", () => {
  it("defines the 8-card deck", () => {
    expect(DECK).toEqual([
      "knight",
      "archers",
      "giant",
      "fireball",
      "musketeer",
      "mini-pekka",
      "skeletons",
      "arrows",
    ]);
    for (const id of DECK) expect(CARDS[id]).toBeDefined();
  });

  it("every card has a positive elixir cost", () => {
    for (const id of DECK) expect(getCard(id).cost).toBeGreaterThan(0);
  });

  it("troop cards define unit stats and counts", () => {
    const archers = getCard("archers");
    expect(archers.kind).toBe("troop");
    if (archers.kind !== "troop") return;
    expect(archers.count).toBe(2);
    expect(archers.unit.maxHp).toBeGreaterThan(0);
    expect(archers.unit.attackRange).toBeGreaterThan(1); // ranged
  });

  it("giant only targets buildings", () => {
    const giant = getCard("giant");
    if (giant.kind !== "troop") throw new Error("giant should be a troop");
    expect(giant.unit.targetsBuildingsOnly).toBe(true);
  });

  it("spell cards define damage and radius", () => {
    const fireball = getCard("fireball");
    expect(fireball.kind).toBe("spell");
    if (fireball.kind !== "spell") return;
    expect(fireball.damage).toBeGreaterThan(0);
    expect(fireball.radius).toBeGreaterThan(0);
  });
});
