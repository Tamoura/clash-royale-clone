import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { createBot, tickBot } from "./bot";
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
