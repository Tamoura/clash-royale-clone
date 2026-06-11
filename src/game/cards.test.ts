import { describe, expect, it } from "vitest";
import { CARDS, DECK, getCard } from "./cards";

describe("cards", () => {
  it("defines the 14-card deck", () => {
    expect(DECK).toEqual([
      "knight",
      "archers",
      "giant",
      "fireball",
      "musketeer",
      "mini-pekka",
      "baby-dragon",
      "valkyrie",
      "skeletons",
      "wizard",
      "prince",
      "cannon",
      "gargoyles",
      "arrows",
    ]);
    for (const id of DECK) expect(CARDS[id]).toBeDefined();
  });

  it("flying units and air-targeting are modeled", () => {
    const dragon = getCard("baby-dragon");
    if (dragon.kind !== "troop") throw new Error("dragon should be a troop");
    expect(dragon.unit.flying).toBe(true);
    expect(dragon.unit.targetsAir).toBe(true);
    const knight = getCard("knight");
    if (knight.kind !== "troop") throw new Error("knight should be a troop");
    expect(knight.unit.flying).toBe(false);
    expect(knight.unit.targetsAir).toBe(false);
  });

  it("splash attackers define a splash radius", () => {
    const wizard = getCard("wizard");
    if (wizard.kind !== "troop") throw new Error("wizard should be a troop");
    expect(wizard.unit.splashRadius).toBeGreaterThan(0);
    const musketeer = getCard("musketeer");
    if (musketeer.kind !== "troop") throw new Error("musketeer is a troop");
    expect(musketeer.unit.splashRadius).toBe(0);
  });

  it("the prince charges, the cannon is a building with a lifetime", () => {
    const prince = getCard("prince");
    if (prince.kind !== "troop") throw new Error("prince should be a troop");
    expect(prince.unit.chargeDistance).toBeGreaterThan(0);
    const cannon = getCard("cannon");
    expect(cannon.kind).toBe("building");
    if (cannon.kind !== "building") return;
    expect(cannon.lifetime).toBeGreaterThan(0);
    expect(cannon.unit.targetsAir).toBe(false);
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
