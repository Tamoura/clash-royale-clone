/**
 * The bot ladder as a curve (notes/features/bot-ladder.md). Two seeded,
 * deterministic measures, with both sides playing DEFAULT_DECK at level 1,
 * as the bots do against a brand-new profile:
 *
 * (a) Duels: each tier beats the tier below it in at least 60% of games.
 *     The two bots swap halves of the arena every other seed, so neither
 *     side of the board favours one of them.
 * (b) A near-random "kid" (pilot.ts: a random affordable card on a random
 *     legal tile every 3-5 s) wins less at every step, in clear steps of
 *     about 0.9 / 0.65 / 0.35 / 0.15 / under 0.05 from practice to hard.
 *
 * The bands leave room for the seed set; novice.test.ts checks the same
 * curve on a second, smaller one.
 */
import { describe, expect, it } from "vitest";
import type { Side } from "../game/arena";
import { createBattle } from "../game/battle";
import { createBot, tickBot, type BotProfile } from "../game/bot";
import { DEFAULT_DECK } from "../game/cards";
import { createPilot, tickPilot } from "../game/pilot";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "../game/sim";
import { TIERS, tierProfile, type Tier } from "./difficulty";

const DT = 1 / 30;
const END = BATTLE_DURATION + OVERTIME_DURATION + 1;
const DUEL_SEEDS = 24;
const PILOT_SEEDS = 32;

/** The kid's expected win rate against each tier: [lowest, highest] allowed. */
const PILOT_BANDS: Record<Tier, readonly [number, number]> = {
  practice: [0.75, 1],
  rookie: [0.5, 0.8],
  easy: [0.2, 0.5],
  normal: [0.05, 0.3],
  hard: [0, 0.05 - 1e-9], // under 5%
};
/** Each step down the curve is at least this much. */
const MIN_STEP = 0.1;
/** A tier beats the one below in at least this share of duels. */
const MIN_DUEL = 0.6;

interface Outcome {
  winner: Side | "draw";
  time: number;
  crowns: [number, number];
}

/** One duel: `upper` on `upperSide`, `lower` on the other half. */
function duel(upper: BotProfile, lower: BotProfile, seed: number, upperSide: Side): Outcome {
  const lowerSide: Side = upperSide === "player" ? "enemy" : "player";
  const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
  // The bottom-half bot always takes the 500s seed, the top-half one the 900s.
  const seedFor = (side: Side): number => (side === "player" ? 500 : 900) + seed;
  const up = createBot(seedFor(upperSide), { ...upper, side: upperSide });
  const lo = createBot(seedFor(lowerSide), { ...lower, side: lowerSide });
  const [bottom, top] = upperSide === "player" ? [up, lo] : [lo, up];
  while (!b.result && b.time < END) {
    tickBot(b, bottom, DT);
    tick(b, DT);
    tickBot(b, top, DT);
    b.events.length = 0;
  }
  return { winner: b.result?.winner ?? "draw", time: b.time, crowns: [b.player.crowns, b.enemy.crowns] };
}

/** Share of DUEL_SEEDS duels the upper tier wins (sides alternate by seed). */
function duelWinRate(upper: Tier, lower: Tier): number {
  let wins = 0;
  for (let i = 0; i < DUEL_SEEDS; i++) {
    const side: Side = i % 2 === 0 ? "player" : "enemy";
    if (duel(tierProfile(upper), tierProfile(lower), i, side).winner === side) wins++;
  }
  return wins / DUEL_SEEDS;
}

/** Share of PILOT_SEEDS games the near-random kid wins against a tier. */
function pilotWinRate(tier: Tier): number {
  let wins = 0;
  for (let i = 0; i < PILOT_SEEDS; i++) {
    const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
    const bot = createBot(300 + i, tierProfile(tier));
    const pilot = createPilot(9300 + i);
    while (!b.result && b.time < END) {
      tickPilot(b, pilot, DT);
      tick(b, DT);
      tickBot(b, bot, DT);
      b.events.length = 0;
    }
    if (b.result?.winner === "player") wins++;
  }
  return wins / PILOT_SEEDS;
}

describe("the bot ladder is an even staircase", () => {
  it("replays a duel exactly (the curve is deterministic)", () => {
    const a = duel(tierProfile("normal"), tierProfile("easy"), 3, "enemy");
    const b = duel(tierProfile("normal"), tierProfile("easy"), 3, "enemy");
    expect(b).toEqual(a);
  }, 10_000);

  for (let i = 1; i < TIERS.length; i++) {
    const [lower, upper] = [TIERS[i - 1], TIERS[i]];
    it(`${upper} beats ${lower} in at least ${MIN_DUEL * 100}% of duels`, () => {
      const rate = duelWinRate(upper, lower);
      expect(rate, `${upper} vs ${lower}: ${rate}`).toBeGreaterThanOrEqual(MIN_DUEL);
    }, 60_000);
  }

  it("a near-random kid wins in clear steps: about 0.9 / 0.65 / 0.35 / 0.15 / under 0.05", () => {
    const rates = TIERS.map(pilotWinRate);
    const curve = TIERS.map((t, i) => `${t} ${rates[i]}`).join(", ");
    TIERS.forEach((t, i) => {
      const [lo, hi] = PILOT_BANDS[t];
      expect(rates[i], `${t} (${curve})`).toBeGreaterThanOrEqual(lo);
      expect(rates[i], `${t} (${curve})`).toBeLessThanOrEqual(hi);
      if (i > 0) expect(rates[i - 1] - rates[i], `step to ${t} (${curve})`).toBeGreaterThanOrEqual(MIN_STEP);
    });
  }, 120_000);
});
