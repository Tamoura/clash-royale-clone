import { describe, expect, it } from "vitest";
import { BRIDGE_XS, RIVER_Y } from "./arena";
import { createBattle, deployCard, spawnUnits, type BattleState } from "./battle";
import { createHand } from "./hand";
import { moveGoal, tick } from "./sim";

const TICK = 1 / 20;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) tick(b, TICK);
}

/** Put specific cards in a side's hand for deployment tests. */
function giveHand(b: BattleState, side: "player" | "enemy", cards: string[]): void {
  const state = side === "player" ? b.player : b.enemy;
  state.hand = createHand([...cards, "knight", "archers", "giant", "fireball"] as never);
  state.elixir = { amount: 10 };
}

describe("air units", () => {
  it("ground-only melee units ignore flyers and walk to buildings", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 20);
    spawnUnits(b, "enemy", "baby-dragon", 9, 19);
    tick(b, TICK);
    const target = b.entities.find((e) => e.id === knight.targetId);
    expect(target).toBeDefined();
    expect(target!.kind).not.toBe("troop");
  });

  it("air-targeting units shoot flyers down", () => {
    const b = createBattle();
    spawnUnits(b, "player", "musketeer", 9, 20);
    const [dragon] = spawnUnits(b, "enemy", "baby-dragon", 9, 17);
    run(b, 3);
    expect(dragon.hp).toBeLessThan(dragon.maxHp);
  });

  it("flyers head straight for their target, ignoring bridges", () => {
    const b = createBattle();
    const [dragon] = spawnUnits(b, "player", "baby-dragon", 9, 18);
    const [knight] = spawnUnits(b, "player", "knight", 9, 18);
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const dragonGoal = moveGoal(dragon, tower);
    const knightGoal = moveGoal(knight, tower);
    expect(dragonGoal.x).toBe(tower.x); // straight line
    expect(BRIDGE_XS).toContain(knightGoal.x); // bridge detour
  });

  it("towers shoot flying units", () => {
    const b = createBattle();
    const [dragon] = spawnUnits(b, "enemy", "baby-dragon", BRIDGE_XS[0], 21);
    run(b, 3);
    expect(dragon.hp).toBeLessThan(dragon.maxHp);
  });
});

describe("splash damage", () => {
  it("splash attackers damage the whole cluster", () => {
    const b = createBattle();
    spawnUnits(b, "player", "wizard", 9, 21);
    spawnUnits(b, "enemy", "skeletons", 9, 17.5);
    run(b, 4);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
  });
});

describe("charge", () => {
  it("a prince hits for double damage after a run-up", () => {
    const b = createBattle();
    // Remove the enemy princess towers so only the cannon fights back
    // and the prince survives his (otherwise heavily contested) run-up.
    b.entities = b.entities.filter(
      (e) => !(e.side === "enemy" && e.kind === "princess-tower"),
    );
    giveHand(b, "enemy", ["cannon"]);
    expect(deployCard(b, "enemy", "cannon", 9, 14)).toBe(true);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    // Same side of the river so the approach is a straight 5-tile run-up.
    spawnUnits(b, "player", "prince", 9, 9);
    for (let i = 0; i < 20 * 10; i++) {
      tick(b, TICK);
      if (b.events.some((e) => e.type === "attack" && e.cardId === "prince")) break;
    }
    // 800 max, one charged hit = 650 (vs 325 uncharged); some decay too.
    expect(cannon.hp).toBeLessThan(200);
    const prince = b.entities.find((e) => e.cardId === "prince")!;
    expect(prince.chargeProgress).toBe(0); // resets after the hit
  });
});

describe("buildings", () => {
  it("deploys on own half and decays away over its lifetime", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    expect(deployCard(b, "player", "cannon", 9, 8)).toBe(false); // enemy half
    expect(deployCard(b, "player", "cannon", 9, 20)).toBe(true);
    expect(b.entities.some((e) => e.kind === "building")).toBe(true);
    run(b, 31);
    expect(b.entities.some((e) => e.kind === "building")).toBe(false);
    expect(b.enemy.crowns).toBe(0); // expiring grants nothing
  });

  it("baits building-seeking troops away from towers", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    deployCard(b, "player", "cannon", 9, 20);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    const [giant] = spawnUnits(b, "enemy", "giant", 9, 17.5);
    tick(b, TICK);
    expect(giant.targetId).toBe(cannon.id);
  });

  it("cannot shoot flying units", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    deployCard(b, "player", "cannon", 9, 20);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    spawnUnits(b, "enemy", "baby-dragon", 9, 19);
    run(b, 2);
    expect(cannon.targetId).toBeNull();
  });
});

describe("spawners", () => {
  it("a witch summons skeletons on her side over time", () => {
    const b = createBattle();
    spawnUnits(b, "player", "witch", 9, 24);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
    run(b, 10);
    const skeletons = b.entities.filter((e) => e.cardId === "skeletons");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
    for (const s of skeletons) expect(s.side).toBe("player");
  });

  it("non-spawner troops never summon anything", () => {
    const b = createBattle();
    spawnUnits(b, "player", "knight", 9, 24);
    run(b, 10);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
  });
});

describe("river jump", () => {
  it("the hog rider heads straight across the river, no bridge detour", () => {
    const b = createBattle();
    const [hog] = spawnUnits(b, "player", "hog-rider", 9, 18);
    const [knight] = spawnUnits(b, "player", "knight", 9, 18);
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    expect(moveGoal(hog, tower).x).toBe(tower.x); // straight line
    expect(BRIDGE_XS).toContain(moveGoal(knight, tower).x); // bridge detour
  });

  it("the hog rider still fights as a ground unit and ignores troops", () => {
    const b = createBattle();
    const [hog] = spawnUnits(b, "player", "hog-rider", 9, 20);
    spawnUnits(b, "enemy", "knight", 9, 19);
    tick(b, TICK);
    const target = b.entities.find((e) => e.id === hog.targetId);
    expect(target).toBeDefined();
    expect(target!.kind).not.toBe("troop"); // building-seeker
    expect(hog.flying).toBe(false); // ground attackers can hit him
  });
});

describe("deploy delay", () => {
  it("troops stand frozen for the first second", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 24);
    run(b, 0.8);
    expect(knight.y).toBe(24);
    run(b, 1);
    expect(knight.y).toBeLessThan(24);
  });

  it("river deployment rule still applies to buildings near the river", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    expect(deployCard(b, "player", "cannon", 9, RIVER_Y)).toBe(false);
  });
});
