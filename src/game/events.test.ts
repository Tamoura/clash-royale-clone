import { describe, expect, it } from "vitest";
import { createBattle, deployCard, spawnUnits } from "./battle";
import { BATTLE_DURATION, tick } from "./sim";

const TICK = 1 / 20;

describe("battle events", () => {
  it("deploying a troop records a deploy event", () => {
    const b = createBattle();
    deployCard(b, "player", "knight", 9, 24);
    expect(b.events).toContainEqual({
      type: "deploy",
      side: "player",
      cardId: "knight",
    });
  });

  it("casting a spell records a spell event with its location", () => {
    const b = createBattle();
    deployCard(b, "player", "fireball", 9, 8);
    expect(b.events).toContainEqual({
      type: "spell",
      side: "player",
      cardId: "fireball",
      x: 9,
      y: 8,
    });
  });

  it("landing a hit records an attack event", () => {
    const b = createBattle();
    spawnUnits(b, "player", "mini-pekka", 9, 20);
    spawnUnits(b, "enemy", "knight", 9, 19.2);
    for (let i = 0; i < 40; i++) tick(b, TICK);
    const attacks = b.events.filter((e) => e.type === "attack");
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.some((e) => e.type === "attack" && e.cardId === "mini-pekka")).toBe(true);
  });

  it("ranged attackers are flagged as ranged", () => {
    const b = createBattle();
    spawnUnits(b, "player", "musketeer", 9, 20);
    spawnUnits(b, "enemy", "knight", 9, 16.5);
    for (let i = 0; i < 60; i++) tick(b, TICK);
    const ranged = b.events.find(
      (e) => e.type === "attack" && e.cardId === "musketeer",
    );
    expect(ranged).toBeDefined();
    expect(ranged!.type === "attack" && ranged!.ranged).toBe(true);
  });

  it("a troop dying records a death event with its position", () => {
    const b = createBattle();
    spawnUnits(b, "player", "mini-pekka", 9, 20);
    spawnUnits(b, "enemy", "skeletons", 9, 19.2);
    for (let i = 0; i < 100; i++) tick(b, TICK);
    const death = b.events.find(
      (e) => e.type === "death" && e.cardId === "skeletons",
    );
    expect(death).toBeDefined();
    if (death?.type === "death") {
      expect(death.side).toBe("enemy");
      expect(death.x).toBeGreaterThan(0);
    }
  });

  it("destroying a princess tower records a crown event for the winner", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    tower.hp = 1;
    spawnUnits(b, "player", "mini-pekka", tower.x, tower.y + 1.5);
    for (let i = 0; i < 100; i++) tick(b, TICK);
    expect(b.events).toContainEqual({ type: "crown", winner: "player" });
  });

  it("the battle finishing records a finish event", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION;
    b.player.crowns = 1;
    tick(b, TICK);
    expect(b.events).toContainEqual({ type: "finish", winner: "player" });
  });
});
