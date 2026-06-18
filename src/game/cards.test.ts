import { afterEach, describe, expect, it } from "vitest";
import {
  CARDS,
  DECK,
  crazyCards,
  getCard,
  setCardOverrides,
  type CardId,
} from "./cards";

describe("cards", () => {
  it("defines the 29-card deck", () => {
    expect(DECK).toEqual([
      "knight",
      "archers",
      "firecracker",
      "magic-archer",
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
      "elixir-collector",
      "gargoyles",
      "bats",
      "minions",
      "skeleton-army",
      "executioner",
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

  it("the elixir collector is a passive generator building", () => {
    const pump = getCard("elixir-collector");
    expect(pump.kind).toBe("building");
    if (pump.kind !== "building") return;
    expect(pump.cost).toBe(6);
    expect(pump.rarity).toBe("rare");
    expect(pump.unit.elixirInterval).toBeGreaterThan(0);
    expect(pump.unit.damage).toBe(0);
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

  it("the firecracker is a squishy splash kiter that recoils", () => {
    const fc = getCard("firecracker");
    if (fc.kind !== "troop") throw new Error("firecracker should be a troop");
    expect(fc.unit.attackRange).toBeGreaterThan(1); // ranged
    expect(fc.unit.targetsAir).toBe(true);
    expect(fc.unit.splashRadius).toBeGreaterThan(0); // spread sparks
    expect(fc.unit.recoil).toBeGreaterThan(0); // hops back after firing
    expect(fc.unit.maxHp).toBeLessThan(300); // very squishy
    expect(fc.unit.pierce).toBe(false);
  });

  it("the magic archer fires a piercing line shot", () => {
    const ma = getCard("magic-archer");
    if (ma.kind !== "troop") throw new Error("magic-archer should be a troop");
    expect(ma.unit.pierce).toBe(true);
    expect(ma.unit.targetsAir).toBe(true);
    expect(ma.unit.attackRange).toBeGreaterThan(6); // longest reach in the game
    expect(ma.unit.recoil).toBe(0);
  });

  it("bats are a cheap 5-strong flying swarm", () => {
    const bats = getCard("bats");
    if (bats.kind !== "troop") throw new Error("bats should be a troop");
    expect(bats.cost).toBe(2);
    expect(bats.count).toBe(5);
    expect(bats.unit.flying).toBe(true);
    expect(bats.unit.targetsAir).toBe(true);
  });

  it("the skeleton army is a big cheap ground swarm", () => {
    const army = getCard("skeleton-army");
    if (army.kind !== "troop") throw new Error("skeleton-army should be a troop");
    expect(army.count).toBeGreaterThanOrEqual(12);
    expect(army.unit.maxHp).toBeLessThan(150); // each one is fragile
  });

  it("minions are 3 short-range flyers", () => {
    const m = getCard("minions");
    if (m.kind !== "troop") throw new Error("minions should be a troop");
    expect(m.count).toBe(3);
    expect(m.unit.flying).toBe(true);
    expect(m.unit.targetsAir).toBe(true);
    expect(m.unit.attackRange).toBeGreaterThan(1); // ranged spit
  });

  it("the executioner throws a piercing axe", () => {
    const ex = getCard("executioner");
    if (ex.kind !== "troop") throw new Error("executioner should be a troop");
    expect(ex.cost).toBe(5);
    expect(ex.unit.pierce).toBe(true);
    expect(ex.unit.targetsAir).toBe(true);
    expect(ex.unit.attackRange).toBeGreaterThan(1);
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

describe("rarities", () => {
  it("every card declares a rarity", () => {
    for (const id of DECK) {
      expect(["common", "rare", "epic"]).toContain(getCard(id).rarity);
    }
  });

  it("matches CR's classic assignments", () => {
    expect(getCard("knight").rarity).toBe("common");
    expect(getCard("giant").rarity).toBe("rare");
    expect(getCard("witch").rarity).toBe("epic");
    expect(getCard("pekka").rarity).toBe("epic");
    expect(getCard("zap").rarity).toBe("common");
    expect(getCard("fireball").rarity).toBe("rare");
    expect(getCard("freeze").rarity).toBe("epic");
  });
});

describe("card balance tweaks", () => {
  it("the P.E.K.K.A is nerfed by 100 HP and 100 damage", () => {
    const pekka = getCard("pekka");
    if (pekka.kind !== "troop") throw new Error("pekka troop");
    expect(pekka.unit.maxHp).toBe(2900);
    expect(pekka.unit.damage).toBe(650);
  });

  it("the balloon's death bomb is exactly half a normal hit", () => {
    const balloon = getCard("balloon");
    if (balloon.kind !== "troop") throw new Error("balloon troop");
    expect(balloon.unit.deathDamage).toBe(balloon.unit.damage / 2);
  });
});

describe("crazy mode card overrides", () => {
  afterEach(() => setCardOverrides(null));

  it("getCard returns overrides when set, base otherwise", () => {
    expect(getCard("archers")).toBe(CARDS.archers);
    const crazy = crazyCards();
    setCardOverrides(crazy);
    expect(getCard("archers")).toBe(crazy.archers);
    setCardOverrides(null);
    expect(getCard("archers")).toBe(CARDS.archers);
  });

  it("scrambles every troop into a swarm without mutating the base cards", () => {
    for (let run = 0; run < 30; run++) {
      const crazy = crazyCards();
      for (const id of Object.keys(crazy) as CardId[]) {
        const card = crazy[id];
        if (card.kind === "troop") {
          expect(card.count).toBeGreaterThanOrEqual(3);
          expect(card.count).toBeLessThanOrEqual(12);
        }
      }
    }
    // Base archers untouched (count still 2).
    const archers = CARDS.archers;
    if (archers.kind !== "troop") throw new Error("archers troop");
    expect(archers.count).toBe(2);
  });

  it("existing spawners get a summon from the pure pool (Witch can spawn Mini P.E.K.K.A)", () => {
    const pool = new Set(["skeletons", "archers", "gargoyles", "mini-pekka"]);
    const seen = new Set<string>();
    for (let run = 0; run < 60; run++) {
      const witch = crazyCards().witch;
      if (witch.kind !== "troop") throw new Error("witch troop");
      expect(witch.unit.spawnUnitId).not.toBeNull();
      expect(pool.has(witch.unit.spawnUnitId!)).toBe(true);
      if (witch.unit.spawnUnitId) seen.add(witch.unit.spawnUnitId);
    }
    // Over many rolls the Witch summons more than one kind of unit.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("summonable pool units never spawn (chains stay one level deep)", () => {
    const crazy = crazyCards();
    for (const id of ["skeletons", "archers", "gargoyles", "mini-pekka"] as CardId[]) {
      const card = crazy[id];
      if (card.kind === "troop") expect(card.unit.spawnUnitId).toBeNull();
    }
  });
});
