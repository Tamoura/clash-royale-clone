import { describe, expect, it } from "vitest";
import { CARDS, DECK, getCard } from "./cards";

describe("cards", () => {
  it("defines the 22-card deck", () => {
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
      "witch",
      "hog-rider",
      "balloon",
      "prince",
      "pekka",
      "cannon",
      "tombstone",
      "gargoyles",
      "arrows",
      "zap",
      "rage",
      "freeze",
    ]);
    for (const id of DECK) expect(CARDS[id]).toBeDefined();
  });

  it("freeze is a long stun with no damage", () => {
    const freeze = getCard("freeze");
    expect(freeze.kind).toBe("spell");
    if (freeze.kind !== "spell") return;
    expect(freeze.cost).toBe(4);
    expect(freeze.damage).toBe(0);
    expect(freeze.stunSeconds).toBeGreaterThanOrEqual(3);
  });

  it("rage is a damage-free spell with a lingering boost zone", () => {
    const rage = getCard("rage");
    expect(rage.kind).toBe("spell");
    if (rage.kind !== "spell") return;
    expect(rage.cost).toBe(2);
    expect(rage.damage).toBe(0);
    expect(rage.rageSeconds).toBeGreaterThan(0);
  });

  it("zap is a cheap spell that stuns", () => {
    const zap = getCard("zap");
    expect(zap.kind).toBe("spell");
    if (zap.kind !== "spell") return;
    expect(zap.cost).toBe(2);
    expect(zap.damage).toBeGreaterThan(0);
    expect(zap.stunSeconds).toBeGreaterThan(0);
  });

  it("the tombstone is a spawner building", () => {
    const tomb = getCard("tombstone");
    expect(tomb.kind).toBe("building");
    if (tomb.kind !== "building") return;
    expect(tomb.cost).toBe(3);
    expect(tomb.lifetime).toBeGreaterThan(0);
    expect(tomb.unit.spawnUnitId).toBe("skeletons");
    expect(tomb.unit.spawnInterval).toBeGreaterThan(0);
    expect(tomb.unit.damage).toBe(0); // it just spawns, never attacks
  });

  it("the balloon is a flying building-seeker with a death bomb", () => {
    const balloon = getCard("balloon");
    expect(balloon.cost).toBe(5);
    if (balloon.kind !== "troop") throw new Error("balloon should be a troop");
    expect(balloon.unit.flying).toBe(true);
    expect(balloon.unit.targetsBuildingsOnly).toBe(true);
    expect(balloon.unit.deathDamage).toBeGreaterThan(0);
    expect(balloon.unit.deathRadius).toBeGreaterThan(0);
  });

  it("the hog rider is a fast building-seeker that jumps the river", () => {
    const hog = getCard("hog-rider");
    expect(hog.cost).toBe(4);
    if (hog.kind !== "troop") throw new Error("hog rider should be a troop");
    expect(hog.unit.speed).toBe("fast");
    expect(hog.unit.targetsBuildingsOnly).toBe(true);
    expect(hog.unit.jumpsRiver).toBe(true);
    expect(hog.unit.flying).toBe(false);
  });

  it("the witch periodically summons skeletons", () => {
    const witch = getCard("witch");
    if (witch.kind !== "troop") throw new Error("witch should be a troop");
    expect(witch.unit.spawnUnitId).toBe("skeletons");
    expect(witch.unit.spawnInterval).toBeGreaterThan(0);
    expect(witch.unit.targetsAir).toBe(true);
  });

  it("the P.E.K.K.A is a 7-elixir single-target ground tank", () => {
    const pekka = getCard("pekka");
    expect(pekka.cost).toBe(7);
    if (pekka.kind !== "troop") throw new Error("pekka should be a troop");
    expect(pekka.unit.maxHp).toBeGreaterThan(2500);
    expect(pekka.unit.damage).toBeGreaterThan(600);
    expect(pekka.unit.splashRadius).toBe(0);
    expect(pekka.unit.targetsAir).toBe(false);
    expect(pekka.unit.speed).toBe("slow");
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
