import { describe, expect, it } from "vitest";
import { BRIDGE_XS, RIVER_Y } from "./arena";
import { applySpell, createBattle, spawnUnits, type BattleState } from "./battle";
import { tick } from "./sim";

const TICK = 1 / 20;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) tick(b, TICK);
}

describe("tick: time and elixir", () => {
  it("advances time and regenerates elixir for both sides", () => {
    const b = createBattle();
    run(b, 2.8);
    expect(b.time).toBeCloseTo(2.8);
    expect(b.player.elixir.amount).toBeCloseTo(6, 1);
    expect(b.enemy.elixir.amount).toBeCloseTo(6, 1);
  });

  it("uses double elixir in the final 60 seconds", () => {
    const b = createBattle();
    b.time = 125;
    run(b, 1.4);
    expect(b.player.elixir.amount).toBeCloseTo(6, 1);
  });
});

describe("tick: movement", () => {
  it("troops advance toward the enemy side", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 24);
    const startY = knight.y;
    run(b, 2);
    expect(knight.y).toBeLessThan(startY);
  });

  it("troops cross the river via the nearest bridge", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 8, 18);
    run(b, 8);
    // It should have funneled toward the left bridge to cross.
    expect(Math.abs(knight.x - BRIDGE_XS[0])).toBeLessThan(1.5);
    expect(knight.y).toBeLessThan(RIVER_Y + 1);
  });
});

describe("tick: targeting", () => {
  it("troops lock onto enemy troops within sight range", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 20);
    const [enemy] = spawnUnits(b, "enemy", "knight", 9, 18);
    tick(b, TICK);
    expect(knight.targetId).toBe(enemy.id);
  });

  it("building-only troops ignore enemy troops", () => {
    const b = createBattle();
    const [giant] = spawnUnits(b, "player", "giant", 9, 20);
    spawnUnits(b, "enemy", "knight", 9, 19);
    tick(b, TICK);
    const target = b.entities.find((e) => e.id === giant.targetId);
    expect(target).toBeDefined();
    expect(target!.kind).not.toBe("troop");
  });
});

describe("tick: combat", () => {
  it("adjacent enemies fight and lose hp", () => {
    const b = createBattle();
    const [pekka] = spawnUnits(b, "player", "mini-pekka", 9, 20);
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 19.2);
    run(b, 3);
    expect(knight.hp).toBeLessThan(knight.maxHp);
    expect(pekka.hp).toBeLessThan(pekka.maxHp);
  });

  it("removes dead entities from the battle", () => {
    const b = createBattle();
    spawnUnits(b, "player", "mini-pekka", 9, 20);
    spawnUnits(b, "enemy", "skeletons", 9, 19.2);
    run(b, 10);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
  });

  it("princess towers shoot troops in range", () => {
    const b = createBattle();
    const [skeleton] = spawnUnits(b, "enemy", "skeletons", BRIDGE_XS[0], 21);
    run(b, 4);
    expect(skeleton.hp).toBeLessThan(skeleton.maxHp);
  });

  it("destroying a princess tower awards a crown and wakes the king", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    tower.hp = 100;
    spawnUnits(b, "player", "mini-pekka", tower.x, tower.y + 1.5);
    run(b, 5);
    expect(b.entities.find((e) => e.id === tower.id)).toBeUndefined();
    expect(b.player.crowns).toBe(1);
    const king = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "king-tower",
    )!;
    expect(king.active).toBe(true);
  });

  it("damaging the king tower activates it", () => {
    const b = createBattle();
    const king = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "king-tower",
    )!;
    applySpell(b, "player", "fireball", king.x, king.y, 570, 2.5);
    tick(b, TICK);
    expect(king.active).toBe(true);
  });

  it("inactive king towers do not shoot", () => {
    const b = createBattle();
    // Remove the enemy princess towers without triggering death processing,
    // so the king stays asleep and nothing else can shoot.
    b.entities = b.entities.filter(
      (e) => !(e.side === "enemy" && e.kind === "princess-tower"),
    );
    const [knight] = spawnUnits(b, "player", "knight", 9, 9);
    run(b, 0.5); // in king range the whole time, but still approaching
    expect(knight.hp).toBe(knight.maxHp);
  });
});
