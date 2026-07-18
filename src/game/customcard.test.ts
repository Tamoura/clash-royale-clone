import { describe, expect, it } from "vitest";
import { CARDS, getCard, type CardId } from "./cards";
import {
  CHAMPION_LIMITS,
  DEFAULT_CHAMPION,
  applyChampion,
  buildChampionCard,
  championElixirCost,
  normalizeChampion,
  type ChampionDef,
} from "./customcard";

/** Translate a built-in troop card into a ChampionDef for calibration. */
function defFromCard(id: CardId): ChampionDef {
  const card = CARDS[id];
  if (card.kind !== "troop") throw new Error(`${id} is not a troop`);
  const u = card.unit;
  return {
    ...structuredClone(DEFAULT_CHAMPION),
    count: card.count,
    hp: u.maxHp,
    damage: u.damage,
    hitSpeed: u.hitSpeed,
    range: u.attackRange,
    speed: u.speed,
    abilities: {
      flying: u.flying,
      targetsAir: u.targetsAir,
      splash: u.splashRadius > 0,
      charge: u.chargeDistance > 0,
      stun: u.stunOnHit > 0,
      chill: u.slowOnHit > 0,
      pierce: u.pierce,
      jumpsRiver: u.jumpsRiver,
      deathBomb: u.deathDamage > 0,
    },
  };
}

describe("championElixirCost calibration", () => {
  // Troops whose full kit the model prices (no spawners / chain / recoil /
  // building-targeting, and counts within Studio limits).
  const reference: CardId[] = [
    "knight",
    "archers",
    "skeletons",
    "bats",
    "gargoyles",
    "minions",
    "musketeer",
    "mini-pekka",
    "pekka",
    "valkyrie",
    "prince",
    "wizard",
    "baby-dragon",
  ];

  for (const id of reference) {
    it(`prices ${id} within 1 elixir of its real cost`, () => {
      const model = championElixirCost(normalizeChampion(defFromCard(id)));
      expect(Math.abs(model - CARDS[id].cost)).toBeLessThanOrEqual(1);
    });
  }

  it("prices the default champion like a mid-cost card", () => {
    const cost = championElixirCost(DEFAULT_CHAMPION);
    expect(cost).toBeGreaterThanOrEqual(2);
    expect(cost).toBeLessThanOrEqual(4);
  });
});

describe("championElixirCost monotonicity", () => {
  const base = normalizeChampion(structuredClone(DEFAULT_CHAMPION));

  it("more HP never costs less", () => {
    const buffed = normalizeChampion({ ...base, hp: 3600 });
    expect(championElixirCost(buffed)).toBeGreaterThanOrEqual(championElixirCost(base));
  });

  it("more damage never costs less", () => {
    const buffed = normalizeChampion({ ...base, damage: 700 });
    expect(championElixirCost(buffed)).toBeGreaterThanOrEqual(championElixirCost(base));
  });

  it("every capability adds (never subtracts) cost", () => {
    // A beefy base so a percentage surcharge moves the rounded price.
    const beefy = normalizeChampion({ ...base, hp: 3000, damage: 500, range: 6 });
    for (const key of Object.keys(beefy.abilities) as (keyof ChampionDef["abilities"])[]) {
      const withIt = structuredClone(beefy);
      withIt.abilities[key] = true;
      expect(championElixirCost(normalizeChampion(withIt))).toBeGreaterThanOrEqual(
        championElixirCost(beefy),
      );
    }
  });

  it("a maxed-out monster caps at 10 elixir", () => {
    const monster = normalizeChampion({
      ...base,
      count: 5,
      hp: 3600,
      damage: 700,
      hitSpeed: 0.9,
      range: 8,
      speed: "fast",
      abilities: {
        flying: true, targetsAir: true, splash: true, charge: true,
        stun: true, chill: true, pierce: true, jumpsRiver: false, deathBomb: true,
      },
    });
    expect(championElixirCost(monster)).toBe(10);
  });

  it("the weakest possible design still costs at least 1", () => {
    const feeble = normalizeChampion({
      ...base, count: 1, hp: 100, damage: 40, hitSpeed: 2.6, speed: "slow",
    });
    expect(championElixirCost(feeble)).toBe(1);
  });
});

describe("normalizeChampion", () => {
  it("clamps out-of-range stats into limits", () => {
    const wild = normalizeChampion({
      name: "X".repeat(40),
      count: 99,
      hp: 999999,
      damage: -5,
      hitSpeed: 0.01,
      range: 30,
    });
    expect(wild.count).toBe(CHAMPION_LIMITS.count.max);
    expect(wild.hp).toBe(CHAMPION_LIMITS.hp.max);
    expect(wild.damage).toBe(CHAMPION_LIMITS.damage.min);
    expect(wild.hitSpeed).toBe(CHAMPION_LIMITS.hitSpeed.min);
    expect(wild.range).toBe(CHAMPION_LIMITS.range.max);
    expect(wild.name.length).toBe(CHAMPION_LIMITS.nameLength);
  });

  it("snaps short ranges to melee and forbids melee pierce", () => {
    const d = normalizeChampion({
      ...DEFAULT_CHAMPION,
      range: 0.8,
      abilities: { ...DEFAULT_CHAMPION.abilities, pierce: true },
    });
    expect(d.range).toBe(0.8);
    expect(d.abilities.pierce).toBe(false);
  });

  it("flyers don't also river-jump", () => {
    const d = normalizeChampion({
      ...DEFAULT_CHAMPION,
      abilities: { ...DEFAULT_CHAMPION.abilities, flying: true, jumpsRiver: true },
    });
    expect(d.abilities.jumpsRiver).toBe(false);
  });

  it("garbage input falls back to the default design", () => {
    const d = normalizeChampion(null);
    expect(d.name).toBe(DEFAULT_CHAMPION.name);
    expect(d.hp).toBe(DEFAULT_CHAMPION.hp);
  });
});

describe("buildChampionCard / applyChampion", () => {
  it("materializes abilities into unit stats", () => {
    const card = buildChampionCard({
      ...structuredClone(DEFAULT_CHAMPION),
      name: "Stormcaller",
      range: 6,
      abilities: {
        ...DEFAULT_CHAMPION.abilities,
        targetsAir: true, splash: true, stun: true, pierce: true,
      },
    });
    expect(card.name).toBe("Stormcaller");
    expect(card.unit.attackRange).toBe(6);
    expect(card.unit.targetsAir).toBe(true);
    expect(card.unit.splashRadius).toBeGreaterThan(0);
    expect(card.unit.stunOnHit).toBeGreaterThan(0);
    expect(card.unit.pierce).toBe(true);
    expect(card.cost).toBeGreaterThanOrEqual(1);
    expect(card.cost).toBeLessThanOrEqual(10);
  });

  it("writes through so getCard sees the design", () => {
    const before = structuredClone(CARDS.champion);
    applyChampion({
      ...structuredClone(DEFAULT_CHAMPION),
      name: "Testblade",
      hp: 2000,
    });
    const seen = getCard("champion");
    expect(seen.name).toBe("Testblade");
    expect(seen.kind === "troop" && seen.unit.maxHp).toBe(2000);
    Object.assign(CARDS.champion, before); // restore for other tests
  });
});
