/**
 * The first-session promise in numbers: a near-random player (a random
 * affordable card on a random legal tile every 3-5 s; see pilot.ts) wins
 * about half its games against the rookie bot and almost never against
 * hard. Bots play at level 1, as they do against a brand-new deck.
 */
import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { createBot, tickBot } from "./bot";
import { DEFAULT_DECK } from "./cards";
import { createPilot, tickPilot } from "./pilot";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";
import { DIFFICULTIES } from "../match/difficulty";

const DT = 1 / 30;
const SEEDS = 20;

function pilotWinRate(tier: "rookie" | "hard"): number {
  let wins = 0;
  for (let i = 0; i < SEEDS; i++) {
    const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
    const bot = createBot(100 + i, DIFFICULTIES[tier]);
    const pilot = createPilot(7000 + i);
    while (!b.result && b.time < BATTLE_DURATION + OVERTIME_DURATION + 1) {
      tickPilot(b, pilot, DT);
      tick(b, DT);
      tickBot(b, bot, DT);
      b.events.length = 0;
    }
    if (b.result?.winner === "player") wins++;
  }
  return wins / SEEDS;
}

describe("a novice against each bot tier", () => {
  it("wins 35-65% against rookie", () => {
    const rate = pilotWinRate("rookie");
    expect(rate).toBeGreaterThanOrEqual(0.35);
    expect(rate).toBeLessThanOrEqual(0.65);
  }, 60_000);

  it("wins under 15% against hard", () => {
    expect(pilotWinRate("hard")).toBeLessThan(0.15);
  }, 60_000);
});
