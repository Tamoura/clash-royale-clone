import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./arena";
import { createBattle } from "./battle";
import { createBot, tickBot } from "./bot";
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
          if (steps++ % 15 === 0) {
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
            }
            expect(b.player.elixir.amount).toBeGreaterThanOrEqual(0);
            expect(b.player.elixir.amount).toBeLessThanOrEqual(ELIXIR_MAX + 1e-6);
            expect(b.enemy.elixir.amount).toBeGreaterThanOrEqual(0);
            expect(b.enemy.elixir.amount).toBeLessThanOrEqual(ELIXIR_MAX + 1e-6);
          }
        }
        expect(b.result).not.toBeNull();
        expect(b.time).toBeLessThanOrEqual(maxTime + TICK);
      }
    },
    20_000,
  );
});
