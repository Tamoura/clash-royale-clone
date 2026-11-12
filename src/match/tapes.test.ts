/**
 * Replay safety across tier re-tunes. A "Last battle" tape stores the bot's
 * whole profile (main.ts records `botProfile: banded`, the exact profile
 * its bot was created with, after personality and champion or mercy
 * banding) plus the bot's seed and the player's deploy ticks. Playback
 * rebuilds the bot from the tape alone, so a tape saved before the ladder
 * re-tune (notes/features/bot-ladder.md) plays back exactly as it was
 * fought, even though easy, normal and hard have changed since.
 */
import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../game/arena";
import { createBattle, deployCard, type BattleState } from "../game/battle";
import { BOT_PROFILE_DEFAULTS, createBot, tickBot, type BotProfile } from "../game/bot";
import { getCard, type CardId } from "../game/cards";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "../game/sim";
import { stateChecksum } from "../net/checksum";
import { tierProfile } from "./difficulty";

const mainSrc = import.meta.glob<string>("../main.ts", { query: "?raw", import: "default", eager: true })["../main.ts"];

/** The source of `function name(...)` in main.ts, up to its closing brace at column 0. */
function fnSource(name: string): string {
  const start = mainSrc.indexOf(`function ${name}(`);
  expect(start, `main.ts has function ${name}`).toBeGreaterThanOrEqual(0);
  const end = mainSrc.indexOf("\n}\n", start);
  return mainSrc.slice(start, end);
}

const SIM_DT = 1 / 30;
const END_TICKS = Math.ceil((BATTLE_DURATION + OVERTIME_DURATION + 1) / SIM_DT);

interface Tape {
  botSeed: number;
  botProfile: BotProfile;
  deploys: Array<{ t: number; c: CardId; x: number; y: number }>;
}

interface Ending {
  sum: number;
  winner: string;
  ticks: number;
}

/**
 * Fight one match the way main.ts runs a solo ladder match and record its
 * tape: every ~3 s the player puts the first affordable troop at a bridge
 * (lanes alternate), between ticks, as a tap would.
 */
function fight(botSeed: number, profile: BotProfile): { tape: Tape; end: Ending } {
  const b = createBattle();
  const bot = createBot(botSeed, profile);
  const tape: Tape = { botSeed, botProfile: profile, deploys: [] };
  let t = 0;
  for (; t < END_TICKS && !b.result; t++) {
    if (t > 0 && t % 90 === 0) {
      const card = b.player.hand.cards.find((id) => {
        const c = getCard(id);
        return c.kind === "troop" && c.cost <= b.player.elixir.amount;
      });
      const x = (t / 90) % 2 === 0 ? 3.5 : ARENA_WIDTH - 3.5;
      const y = ARENA_HEIGHT - 9;
      if (card && deployCard(b, "player", card, x, y)) tape.deploys.push({ t, c: card, x, y });
    }
    tick(b, SIM_DT);
    tickBot(b, bot, SIM_DT);
  }
  return { tape, end: ending(b, t) };
}

/** Play a tape back as main.ts's startReplay does, with the bot built from `profile`. */
function play(tape: Tape, profile: Partial<BotProfile>): Ending {
  const b = createBattle();
  const bot = createBot(tape.botSeed, profile);
  let cursor = 0;
  let t = 0;
  for (; t < END_TICKS && !b.result; t++) {
    while (cursor < tape.deploys.length && tape.deploys[cursor].t === t) {
      const d = tape.deploys[cursor++];
      deployCard(b, "player", d.c, d.x, d.y);
    }
    tick(b, SIM_DT);
    tickBot(b, bot, SIM_DT);
  }
  return ending(b, t);
}

function ending(b: BattleState, ticks: number): Ending {
  return { sum: stateChecksum(b), winner: b.result?.winner ?? "none", ticks };
}

/** The tiers as they were before the re-tune: the profiles old tapes carry. */
const OLD_TIERS: Record<"easy" | "normal" | "hard", BotProfile> = {
  easy: { thinkInterval: 1.8, pushAt: 9 },
  normal: { thinkInterval: 1.0, pushAt: 8 },
  hard: { thinkInterval: 0.55, pushAt: 6 },
};

describe("Last battle tapes keep the bot they were fought with", () => {
  it("main.ts records the bot's whole profile and replays from the tape alone", () => {
    const ladder = fnSource("startLadder");
    expect(ladder).toContain("bot = createBot(botSeed, banded);");
    expect(ladder).toContain("botProfile: banded,");
    const replay = fnSource("startReplay");
    expect(replay).toContain("bot = createBot(rep.botSeed, { ...BOT_PROFILE_DEFAULTS, ...rep.botProfile });");
    // Never today's tier tables: those move when the ladder is re-tuned.
    expect(replay).not.toMatch(/tierProfile|ladderProfile|DIFFICULTIES|currentTier|resolveTier|SOLVER_PROFILE/);
  });

  for (const tier of ["easy", "normal", "hard"] as const) {
    it(`a tape fought against the old ${tier} replays move for move (and would not on today's ${tier})`, () => {
      const { tape, end } = fight(4242, OLD_TIERS[tier]);
      expect(tape.deploys.length).toBeGreaterThan(3);
      // Through JSON, as the tape sits in localStorage.
      const saved = JSON.parse(JSON.stringify({ v: 3, ...tape })) as Tape & { v: 3 };
      expect(play(saved, { ...BOT_PROFILE_DEFAULTS, ...saved.botProfile })).toEqual(end);
      // Rebuilding the bot from today's tier instead would replay a different match.
      expect(play(saved, tierProfile(tier)).sum).not.toBe(end.sum);
    }, 20_000);
  }
});
