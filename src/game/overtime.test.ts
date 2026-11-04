/**
 * Sim v3 overtime: one minute at triple elixir in which troop and building
 * attacks, and death blasts, hit crown towers OVERTIME_TOWER_DAMAGE (3x)
 * harder. Spells keep their own tower factor, and troops still hit troops
 * for their listed damage.
 */
import { describe, expect, it } from "vitest";
import { TOWER_SPELL_DAMAGE_FACTOR, createBattle, deployCard, spawnUnits, type BattleState, type Entity } from "./battle";
import { CARDS, type CardId } from "./cards";
import { createHand } from "./hand";
import { BATTLE_DURATION, OVERTIME_DURATION, OVERTIME_TOWER_DAMAGE, elixirMultiplier, tick } from "./sim";

const DT = 1 / 30;

function unitDamage(id: CardId): number {
  const c = CARDS[id];
  if (c.kind === "spell") throw new Error(`${id} is a spell`);
  return c.unit.damage;
}

function enemyPrincess(b: BattleState): Entity {
  return b.entities.find((e) => e.side === "enemy" && e.kind === "princess-tower" && e.x < 9)!;
}

/** A battle in regulation time, or one second into overtime. */
function battle(overtime: boolean): BattleState {
  const b = createBattle();
  if (overtime) {
    b.time = BATTLE_DURATION + 1;
    b.overtime = true;
  }
  return b;
}

/** HP the tower loses to the first hit from `id`, fielded `dy` tiles in front of it. */
function firstHitOnTower(id: CardId, overtime: boolean, dy: number): number {
  const b = battle(overtime);
  const tower = enemyPrincess(b);
  const [u] = spawnUnits(b, "player", id, tower.x, tower.y + dy);
  u.deployTimer = 0;
  u.hp = u.maxHp = 1e6; // outlive the tower's fire
  const before = tower.hp;
  for (let i = 0; i < 300 && tower.hp === before; i++) tick(b, DT);
  return before - tower.hp;
}

describe("overtime: troops hit crown towers 3x", () => {
  it("lasts one minute, with 3x tower hits", () => {
    expect(OVERTIME_TOWER_DAMAGE).toBe(3);
    expect(OVERTIME_DURATION).toBe(60);
  });

  it("melee: a Giant's swing lands 3x in overtime", () => {
    const giant = unitDamage("giant");
    expect(firstHitOnTower("giant", false, 2.2)).toBeCloseTo(giant, 6);
    expect(firstHitOnTower("giant", true, 2.2)).toBeCloseTo(giant * OVERTIME_TOWER_DAMAGE, 6);
  });

  it("projectiles: a Musketeer's shot lands 3x in overtime", () => {
    const musk = unitDamage("musketeer");
    expect(firstHitOnTower("musketeer", false, 5)).toBeCloseTo(musk, 6);
    expect(firstHitOnTower("musketeer", true, 5)).toBeCloseTo(musk * OVERTIME_TOWER_DAMAGE, 6);
  });

  it("stacks with the Digger's 35% tower factor (56 a hit, 168 in overtime)", () => {
    expect(firstHitOnTower("digger", false, 2.2)).toBeCloseTo(56, 6);
    expect(firstHitOnTower("digger", true, 2.2)).toBeCloseTo(168, 6);
  });

  it("death blasts: a Balloon's fall hits a tower 3x in overtime", () => {
    for (const overtime of [false, true]) {
      const b = battle(overtime);
      const tower = enemyPrincess(b);
      const [balloon] = spawnUnits(b, "player", "balloon", tower.x, tower.y + 1.5);
      const blast = balloon.deathDamage;
      expect(blast).toBeGreaterThan(0);
      balloon.hp = 0;
      const before = tower.hp;
      tick(b, DT);
      expect(before - tower.hp).toBeCloseTo(blast * (overtime ? OVERTIME_TOWER_DAMAGE : 1), 6);
    }
  });

  it("spells keep their own tower factor", () => {
    const b = battle(true);
    const tower = enemyPrincess(b);
    b.player.hand = createHand(["fireball", "knight", "archers", "giant", "musketeer", "zap", "bats", "minions"]);
    b.player.elixir = { amount: 10 };
    const before = tower.hp;
    expect(deployCard(b, "player", "fireball", tower.x, tower.y)).toBe(true);
    const fb = CARDS.fireball;
    if (fb.kind !== "spell") throw new Error("fireball is a spell");
    for (let i = 0; i < 90 && tower.hp === before; i++) tick(b, DT);
    expect(before - tower.hp).toBeCloseTo(fb.damage * TOWER_SPELL_DAMAGE_FACTOR, 6);
  });

  it("troops still hit troops for their listed damage", () => {
    const b = battle(true);
    const [k] = spawnUnits(b, "player", "knight", 9, 20);
    const [foe] = spawnUnits(b, "enemy", "knight", 9, 20.9);
    k.deployTimer = 0;
    foe.deployTimer = 5;
    for (let i = 0; i < 90 && foe.hp === foe.maxHp; i++) tick(b, DT);
    expect(foe.maxHp - foe.hp).toBeCloseTo(unitDamage("knight"), 6);
  });

  it("begins when regulation ends level on crowns, at triple elixir", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION - DT / 2;
    expect(elixirMultiplier(b)).toBe(2);
    tick(b, DT);
    expect(b.overtime).toBe(true);
    expect(elixirMultiplier(b)).toBe(3);
  });
});
