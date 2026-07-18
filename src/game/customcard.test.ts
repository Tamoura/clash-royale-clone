import { describe, expect, it } from "vitest";
import { CARDS, getCard, type CardId } from "./cards";
import {
  CHAMPION_LIMITS,
  DEFAULT_CHAMPION,
  MAX_CHAMPION_COST,
  applyChampion,
  buildChampionCard,
  championCostInfo,
  championElixirCost,
  deleteChampion,
  fitChampionToBudget,
  normalizeChampion,
  saveChampion,
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

  it("a maxed-out monster is over budget, not discounted to 10", () => {
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
    const info = championCostInfo(monster);
    expect(info.overBudget).toBe(true);
    expect(info.raw).toBeGreaterThan(MAX_CHAMPION_COST);
    expect(info.cost).toBe(MAX_CHAMPION_COST); // display clamp only
  });

  it("the guardrail refuses to save an over-budget design", () => {
    const before = structuredClone(CARDS.champion);
    const monster: ChampionDef = {
      ...structuredClone(DEFAULT_CHAMPION),
      count: 5,
      hp: 3600,
      damage: 700,
      hitSpeed: 0.9,
      range: 8,
      abilities: { ...DEFAULT_CHAMPION.abilities, flying: true, splash: true, stun: true },
    };
    expect(championCostInfo(normalizeChampion(monster)).overBudget).toBe(true);
    expect(saveChampion(monster)).toBeNull();
    // The shared card must be untouched by the refused save.
    expect(CARDS.champion).toEqual(before);
  });

  it("fitChampionToBudget scales an over-budget design into the bar", () => {
    const monster: ChampionDef = {
      ...structuredClone(DEFAULT_CHAMPION),
      count: 5,
      hp: 3600,
      damage: 700,
      hitSpeed: 0.9,
      range: 8,
      abilities: { ...DEFAULT_CHAMPION.abilities, flying: true, splash: true, stun: true },
    };
    const fitted = fitChampionToBudget(monster);
    const info = championCostInfo(fitted);
    expect(info.overBudget).toBe(false);
    expect(info.cost).toBeLessThanOrEqual(MAX_CHAMPION_COST);
    // Capabilities and identity survive; only raw stats are toned down.
    expect(fitted.abilities.flying).toBe(true);
    expect(fitted.count).toBe(5);
    expect(fitted.hp).toBeLessThan(3600);
  });

  it("mid-range prices are honest, not floored (worth 6 costs 6, not 2)", () => {
    const strong = normalizeChampion({
      ...base,
      hp: 3000,
      damage: 450,
      hitSpeed: 1.0,
      speed: "fast",
      abilities: { ...DEFAULT_CHAMPION.abilities, splash: true },
    });
    const info = championCostInfo(strong);
    expect(info.overBudget).toBe(false);
    expect(info.cost).toBeGreaterThanOrEqual(6); // a big design can never price tiny
  });

  it("deleteChampion resets the shared card to the default", () => {
    applyChampion({ ...structuredClone(DEFAULT_CHAMPION), name: "Doomed", hp: 3000 });
    expect(CARDS.champion.name).toBe("Doomed");
    deleteChampion();
    expect(CARDS.champion.name).toBe(DEFAULT_CHAMPION.name);
    expect(CARDS.champion.kind === "troop" && CARDS.champion.unit.maxHp).toBe(
      DEFAULT_CHAMPION.hp,
    );
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
