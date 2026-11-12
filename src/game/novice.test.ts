/**
 * The first-session promise in numbers: a near-random player (a random
 * affordable card on a random legal tile every 3-5 s; see pilot.ts) wins
 * nearly all its games against practice (where auto steps a kid down
 * after two straight losses), most against rookie, some against easy, a
 * few against normal and almost never against hard. Bots play at level 1,
 * as they do against a brand-new deck. match/ladder.test.ts pins the same
 * staircase on a larger seed set; this one is a second, independent look.
 */
import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { createBot, tickBot, type BotProfile } from "./bot";
import { DEFAULT_DECK } from "./cards";
import { createPilot, tickPilot } from "./pilot";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";
import { DIFFICULTIES, archetypeTweak } from "../match/difficulty";

const DT = 1 / 30;
const SEEDS = 20;

function pilotWinRate(tier: "practice" | "rookie" | "easy" | "normal" | "hard", profile: BotProfile = DIFFICULTIES[tier]): number {
  let wins = 0;
  for (let i = 0; i < SEEDS; i++) {
    const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
    const bot = createBot(100 + i, profile);
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
  it("wins at least 55% against rookie", () => {
    expect(pilotWinRate("rookie")).toBeGreaterThanOrEqual(0.55);
  }, 60_000);

  it("wins at least 70% against practice", () => {
    expect(pilotWinRate("practice")).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  // Ladder personalities leave practice alone (ladderProfile), but even the
  // fastest one, cycle, must not make it harder than rookie.
  it("wins at least 70% against practice even with the cycle speed-up", () => {
    expect(pilotWinRate("practice", archetypeTweak(DIFFICULTIES.practice, "cycle"))).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  it("wins some games against easy (20-55%)", () => {
    const r = pilotWinRate("easy");
    expect(r).toBeGreaterThanOrEqual(0.2);
    expect(r).toBeLessThanOrEqual(0.55);
  }, 60_000);

  it("wins a few games against normal (5-30%)", () => {
    const r = pilotWinRate("normal");
    expect(r).toBeGreaterThanOrEqual(0.05);
    expect(r).toBeLessThanOrEqual(0.3);
  }, 60_000);

  it("wins under 5% against hard", () => {
    expect(pilotWinRate("hard")).toBeLessThan(0.05);
  }, 60_000);
});
