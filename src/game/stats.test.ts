import { describe, expect, it } from "vitest";
import { createBattle, deployCard, spawnUnits, type BattleState } from "./battle";
import { createHand } from "./hand";
import { tick } from "./sim";

const TICK = 1 / 20;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) tick(b, TICK);
}

function giveHand(b: BattleState, side: "player" | "enemy", cards: string[]): void {
  const state = side === "player" ? b.player : b.enemy;
  state.hand = createHand([...cards, "knight", "archers", "giant", "fireball"] as never);
  state.elixir = { amount: 10 };
}

describe("match stats", () => {
  it("starts at zero", () => {
    const b = createBattle();
    expect(b.player.stats).toEqual({ damageDealt: 0, elixirSpent: 0 });
    expect(b.enemy.stats).toEqual({ damageDealt: 0, elixirSpent: 0 });
  });

  it("deploying a card records its elixir cost", () => {
    const b = createBattle();
    giveHand(b, "player", ["knight"]);
    deployCard(b, "player", "knight", 9, 24);
    expect(b.player.stats.elixirSpent).toBe(3);
    expect(b.enemy.stats.elixirSpent).toBe(0);
  });

  it("a failed deploy records nothing", () => {
    const b = createBattle();
    giveHand(b, "player", ["knight"]);
    deployCard(b, "player", "knight", 9, 8); // enemy half: rejected
    expect(b.player.stats.elixirSpent).toBe(0);
  });

  it("troop attacks accumulate damage for their side", () => {
    const b = createBattle();
    spawnUnits(b, "player", "knight", 9, 16);
    spawnUnits(b, "enemy", "knight", 9, 16.5);
    run(b, 3);
    expect(b.player.stats.damageDealt).toBeGreaterThan(0);
    expect(b.enemy.stats.damageDealt).toBeGreaterThan(0);
  });

  it("spell damage counts toward the caster's total", () => {
    const b = createBattle();
    spawnUnits(b, "enemy", "knight", 9, 16);
    giveHand(b, "player", ["fireball"]);
    deployCard(b, "player", "fireball", 9, 16);
    expect(b.player.stats.damageDealt).toBeGreaterThanOrEqual(570);
  });
});
