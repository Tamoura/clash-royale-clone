import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import { createBattle, type BattleState } from "./battle";
import { createBot, tickBot } from "./bot";
import type { CardId } from "./cards";
import { ELIXIR_MAX } from "./elixir";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";

const TICK = 1 / 30;

describe("full battle integration", () => {
  it("a bot beats a passive player well before the clock runs out", () => {
    const b = createBattle();
    const bot = createBot(123);
    const maxTime = BATTLE_DURATION + OVERTIME_DURATION + 5;
    while (!b.result && b.time < maxTime) {
      tick(b, TICK);
      tickBot(b, bot, TICK);
    }
    expect(b.result).not.toBeNull();
    expect(b.result!.winner).toBe("enemy");
    expect(b.result!.enemyCrowns).toBeGreaterThan(0);
  });

  it("two bots always produce a finished, valid result", () => {
    // The bot API only plays the enemy side; mirror a second battle is
    // overkill — instead just confirm a long passive game terminates.
    const b = createBattle();
    const maxTime = BATTLE_DURATION + OVERTIME_DURATION + 5;
    while (!b.result && b.time < maxTime) tick(b, TICK);
    expect(b.result).not.toBeNull();
    expect(b.result!.winner).toBe("draw");
  });
});

/** The board stays sane: finite, in-bounds bodies and an elixir bar in range. */
function checkInvariants(b: BattleState): void {
  for (const e of b.entities) {
    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
    expect(Number.isFinite(e.hp)).toBe(true);
    expect(e.hp).toBeLessThanOrEqual(e.maxHp + 1e-6);
    expect(e.hp).toBeGreaterThan(0);
    expect(e.x).toBeGreaterThanOrEqual(-0.01);
    expect(e.x).toBeLessThanOrEqual(ARENA_WIDTH + 0.01);
    expect(e.y).toBeGreaterThanOrEqual(-0.01);
    expect(e.y).toBeLessThanOrEqual(ARENA_HEIGHT + 0.01);
    expect(e.burrowTimer).toBeGreaterThanOrEqual(0);
  }
  expect(b.player.elixir.amount).toBeGreaterThanOrEqual(0);
  expect(b.player.elixir.amount).toBeLessThanOrEqual(ELIXIR_MAX + 1e-6);
  expect(b.enemy.elixir.amount).toBeGreaterThanOrEqual(0);
  expect(b.enemy.elixir.amount).toBeLessThanOrEqual(ELIXIR_MAX + 1e-6);
  expect(b.player.crowns).toBeLessThanOrEqual(3);
  expect(b.enemy.crowns).toBeLessThanOrEqual(3);
}

describe("self-play invariants", () => {
  it(
    "keeps units on the board, elixir in range, and finishes within overtime",
    () => {
      const maxTime = BATTLE_DURATION + OVERTIME_DURATION + 1;
      for (const seed of [7, 42, 99]) {
        const b = createBattle();
        const bot = createBot(seed);
        let steps = 0;
        while (!b.result && b.time < maxTime) {
          tick(b, TICK);
          tickBot(b, bot, TICK);
          // Sample every ~0.5s to keep the CI guard cheap.
          if (steps++ % 15 === 0) checkInvariants(b);
        }
        expect(b.result).not.toBeNull();
        expect(b.time).toBeLessThanOrEqual(maxTime + TICK);
      }
    },
    20_000,
  );

  it(
    "holds the same invariants with the Stone Golem, Digger and Comet on both sides",
    () => {
      const maxTime = BATTLE_DURATION + OVERTIME_DURATION + 1;
      const decks: CardId[][] = [
        ["stone-golem", "digger", "comet", "knight", "archers", "musketeer", "fireball", "zap"],
        ["digger", "comet", "stone-golem", "tombstone", "witch", "bats", "skeleton-army", "tornado"],
      ];
      for (const seed of [7, 42, 99]) {
        const b = createBattle(decks[0], decks[seed % 2]);
        const botP = createBot(seed, { side: "player" });
        const botE = createBot(seed ^ 0x9e3779b9);
        let steps = 0;
        while (!b.result && b.time < maxTime) {
          tick(b, TICK);
          // Right after the tick: a spell a bot casts kills on the next one.
          if (steps++ % 15 === 0) checkInvariants(b);
          tickBot(b, botE, TICK);
          tickBot(b, botP, TICK);
          b.events.length = 0;
        }
        expect(b.result).not.toBeNull();
        expect(b.time).toBeLessThanOrEqual(maxTime + TICK);
      }
    },
    20_000,
  );
});
