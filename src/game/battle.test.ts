import { describe, expect, it } from "vitest";
import { RIVER_Y } from "./arena";
import { createBattle, deployCard } from "./battle";

describe("battle setup", () => {
  it("starts with 6 towers, full hands, and 5 elixir each", () => {
    const b = createBattle();
    expect(b.entities.filter((e) => e.kind !== "troop")).toHaveLength(6);
    expect(b.player.hand.cards).toHaveLength(4);
    expect(b.enemy.hand.cards).toHaveLength(4);
    expect(b.player.elixir.amount).toBe(5);
    expect(b.time).toBe(0);
    expect(b.result).toBeNull();
  });

  it("king towers start inactive, princess towers active", () => {
    const b = createBattle();
    for (const e of b.entities) {
      if (e.kind === "king-tower") expect(e.active).toBe(false);
      else expect(e.active).toBe(true);
    }
  });
});

describe("deployment", () => {
  it("deploys a troop card: spends elixir, cycles hand, spawns units", () => {
    const b = createBattle();
    const ok = deployCard(b, "player", "knight", 9, 24);
    expect(ok).toBe(true);
    const knights = b.entities.filter((e) => e.cardId === "knight");
    expect(knights).toHaveLength(1);
    expect(b.player.elixir.amount).toBeCloseTo(2); // 5 - 3
    expect(b.player.hand.cards).not.toContain("knight");
  });

  it("spawns one unit per count for multi-unit cards", () => {
    const b = createBattle();
    deployCard(b, "player", "archers", 9, 24);
    expect(b.entities.filter((e) => e.cardId === "archers")).toHaveLength(2);
  });

  it("rejects deployment without enough elixir", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "giant", 9, 24)).toBe(true); // 5 elixir
    expect(deployCard(b, "player", "knight", 9, 24)).toBe(false); // 0 left
    expect(b.entities.filter((e) => e.cardId === "knight")).toHaveLength(0);
  });

  it("rejects troop deployment on the enemy half", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "knight", 9, 8)).toBe(false);
    expect(b.player.elixir.amount).toBe(5);
    expect(b.player.hand.cards).toContain("knight");
  });

  it("allows spells anywhere, damaging enemies in the radius", () => {
    const b = createBattle();
    deployCard(b, "enemy", "knight", 9, 8);
    const knight = b.entities.find((e) => e.cardId === "knight")!;
    const before = knight.hp;
    expect(deployCard(b, "player", "fireball", 9, 8)).toBe(true);
    expect(knight.hp).toBeLessThan(before);
  });

  it("spells deal reduced (40%) damage to crown towers", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const before = tower.hp;
    deployCard(b, "player", "fireball", tower.x, tower.y);
    expect(before - tower.hp).toBeCloseTo(570 * 0.4);
  });

  it("spells do not hit your own units", () => {
    const b = createBattle();
    b.player.elixir = { amount: 10 };
    deployCard(b, "player", "knight", 9, 24);
    const knight = b.entities.find((e) => e.cardId === "knight")!;
    expect(deployCard(b, "player", "fireball", 9, 24)).toBe(true);
    expect(knight.hp).toBe(knight.maxHp);
  });

  it("rejects troop deployment on the river itself", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "knight", 9, RIVER_Y)).toBe(false);
  });
});
