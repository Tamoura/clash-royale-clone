/**
 * Match pacing at card level 1 (every online match, every new player): a
 * Normal bot against a Normal bot with the starter deck should mostly end
 * on crowns, in about 3-4 minutes, not on a 0-0 tower-HP tiebreak after
 * five. Sim v3 does it with a one-minute, triple-elixir overtime in which
 * troops hit crown towers 3x (OVERTIME_TOWER_DAMAGE).
 *
 * The seeds are the first 128 of `npm run lab -- mirror` (1000 + 17i), a
 * representative sample rather than a lucky one. Here the build gives 37 0-0
 * finishes (28.9%), 39 tower-HP tiebreaks and a 210.5 s mean. Over 1024
 * mirror seeds (two seed schemes) it gives 31.9% 0-0 (about +/-1.5) and a
 * 210.7 s mean, and its eight 128-seed windows range from 26.6% to 39.1%. So
 * this guards against a regression; the 1024-seed lab is the measurement.
 * Sim v2 (a1ed21f) on these same 128 seeds: 59 0-0, 60 tiebreaks, 253.9 s.
 * notes/features/card-wave-3.md has the tables, random decks included.
 */
import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { createBot, tickBot } from "./bot";
import { DEFAULT_DECK } from "./cards";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";

const DT = 1 / 30;
const MATCHES = 128;
/** The classic Normal profile (match/difficulty.ts "normal" at the time of sim v3). */
const NORMAL = { thinkInterval: 1.0, pushAt: 8 };
/** Tower-HP tiebreaks sim v2 (a1ed21f) gave on these same 128 seeds, measured with the lab. */
const V2_TIEBREAKS = 60;

interface Outcome {
  seconds: number;
  playerCrowns: number;
  enemyCrowns: number;
  /** Decided on tower HP: crowns level at the end, not a draw. */
  tiebreak: boolean;
}

function playMatch(seed: number): Outcome {
  const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
  const botP = createBot(seed, { ...NORMAL, side: "player" });
  const botE = createBot(seed ^ 0x9e3779b9, NORMAL);
  while (!b.result && b.time < BATTLE_DURATION + OVERTIME_DURATION + 1) {
    tick(b, DT);
    tickBot(b, botE, DT);
    tickBot(b, botP, DT);
    b.events.length = 0;
  }
  expect(b.result).not.toBeNull();
  const { winner, playerCrowns, enemyCrowns } = b.result!;
  return {
    seconds: b.time,
    playerCrowns,
    enemyCrowns,
    tiebreak: winner !== "draw" && playerCrowns === enemyCrowns,
  };
}

describe("match pacing (Normal vs Normal, level 1)", () => {
  it("ends on crowns most of the time, in about 3-4 minutes", () => {
    const games = Array.from({ length: MATCHES }, (_, i) => playMatch(1000 + i * 17));
    const zeroZero = games.filter((g) => g.playerCrowns + g.enemyCrowns === 0).length;
    const tiebreaks = games.filter((g) => g.tiebreak).length;
    const meanSeconds = games.reduce((s, g) => s + g.seconds, 0) / MATCHES;
    expect(zeroZero / MATCHES).toBeLessThanOrEqual(0.35);
    expect(meanSeconds).toBeLessThanOrEqual(215);
    // Fewer matches decided on tower HP than sim v2 on the same seeds.
    expect(tiebreaks).toBeLessThan(V2_TIEBREAKS);
    // Every match is over by the end of the one-minute overtime.
    for (const g of games) expect(g.seconds).toBeLessThanOrEqual(BATTLE_DURATION + OVERTIME_DURATION + DT);
  }, 120_000);
});
