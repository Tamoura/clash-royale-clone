/**
 * Bot difficulty: the tier presets, the "auto" pseudo-option that tracks
 * how the player is doing, and the bot's card levels (pegged to the
 * player's own deck, so a new card never meets a bot that outgrew it).
 */
import type { CardLevels } from "../game/battle";
import type { BotProfile } from "../game/bot";
import { DECK, type CardId } from "../game/cards";
import { MAX_CARD_LEVEL } from "../meta/progress";
import { on } from "../app/hooks";
import { installCoachTips } from "./coachTips";

export const DIFF_KEY = "cr-clone-difficulty";
export const AUTO_KEY = "cr-clone-auto-history";

/** Real bot tiers, weakest first. */
export type Tier = "practice" | "rookie" | "easy" | "normal" | "hard";
export const TIERS: readonly Tier[] = ["practice", "rookie", "easy", "normal", "hard"];

/**
 * The two first-hour tiers are tuned against a near-random player
 * (novice.test.ts): it should beat rookie in most games and practice in
 * nearly all of them. Rookie thinks every 6.5 s, notices each invader late,
 * slips up on almost half its plays, only spells big clusters and never
 * finishes a tower with a spell. Practice (where auto steps a kid down to
 * after two straight losses) is slower and sloppier still: it thinks only
 * every 10 s, so even the cycle personality's speed-up (archetypeTweak:
 * 8.5 s, push at 8) stays well below rookie.
 */
const TIER_PROFILES: Record<Tier, BotProfile> = {
  practice: {
    thinkInterval: 10,
    pushAt: 10,
    mistakeRate: 0.6,
    allowFinisher: false,
    spellIQ: 3,
    reactionDelay: 2.5,
  },
  rookie: {
    thinkInterval: 6.5,
    pushAt: 10,
    mistakeRate: 0.45,
    allowFinisher: false,
    spellIQ: 2.5,
    reactionDelay: 1.8,
  },
  easy: { thinkInterval: 1.8, pushAt: 9 },
  normal: { thinkInterval: 1.0, pushAt: 8 },
  hard: { thinkInterval: 0.55, pushAt: 6 },
};

/**
 * Every option the difficulty picker offers, in display order. "auto" is a
 * pseudo-option: its entry here is only a fallback, and a match resolves
 * it with resolveTier() to whichever tier the player's results call for.
 */
export const DIFFICULTIES: Record<string, BotProfile> = {
  auto: TIER_PROFILES.normal,
  ...TIER_PROFILES,
};

export const DIFF_AR: Record<string, string> = {
  auto: "تلقائي",
  practice: "تمرين",
  rookie: "مبتدئ",
  easy: "سهل",
  normal: "عادي",
  hard: "صعب",
};

/** One-line explanation per option: [English, Arabic]. */
export const DIFF_BLURB: Record<string, [string, string]> = {
  auto: ["Adapts to how you play", "يتكيّف مع مستواك"],
  practice: ["A sleepy sparring partner", "شريك تدريب نعسان"],
  rookie: ["Slow and forgiving", "بطيء ومتسامح"],
  easy: ["A gentle opponent", "خصم لطيف"],
  normal: ["A fair fight", "قتال متكافئ"],
  hard: ["Fast and ruthless", "سريع ولا يرحم"],
};

/** The saved choice, or "auto" (the default for new profiles). */
export function loadDifficulty(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DIFF_KEY);
  } catch {
    // storage blocked: fall back to auto
  }
  return saved !== null && saved in DIFFICULTIES ? saved : "auto";
}

// ---- Auto difficulty --------------------------------------------------------

export type MatchOutcome = "win" | "loss" | "draw";

export interface MatchSample {
  /** My crowns minus theirs. */
  crownDiff: number;
  /** How it ended for me (a 0-0 tiebreak can still be a loss). Older saves lack it. */
  outcome?: MatchOutcome;
}

export interface AutoState {
  v: 1;
  /** Ladder matches finished since auto tracking began. */
  ladderMatches: number;
  /** The tier auto currently plays at. */
  tier: Tier;
  /** The last few ladder results, oldest first (at most HISTORY_SIZE). */
  history: MatchSample[];
}

export const HISTORY_SIZE = 5;
/** Auto plays rookie (or practice below it) for this many ladder matches. */
export const ROOKIE_MATCHES = 5;
/** Bots keep their taunts to themselves for this many ladder matches. */
export const POLITE_MATCHES = 10;
/** Straight losses at a QUICK_STEP_DOWN tier that drop auto one tier at once. */
export const STEP_DOWN_LOSSES = 2;
/** The first-hour tiers where a losing streak steps down without waiting for the window. */
const QUICK_STEP_DOWN: readonly Tier[] = ["rookie", "easy"];

/** A sample's outcome; older samples only know their crown difference. */
export function sampleOutcome(m: MatchSample): MatchOutcome {
  if (m.outcome === "win" || m.outcome === "loss" || m.outcome === "draw") return m.outcome;
  return m.crownDiff > 0 ? "win" : m.crownDiff < 0 ? "loss" : "draw";
}

/**
 * The tier auto should play next, given the results so far at `current`
 * (the history restarts at every tier change):
 * - practice is a short breather: one win there returns to rookie;
 * - STEP_DOWN_LOSSES straight losses at rookie or easy drop one tier;
 * - the first ROOKIE_MATCHES ladder matches never climb above rookie;
 * - otherwise one step up when the last 3 crown diffs add up to +3 or
 *   more, one step down at -3 or less, else stay at `current`.
 */
export function autoTier(
  history: readonly MatchSample[],
  ladderMatches: number,
  current: Tier = "rookie",
): Tier {
  const i = TIERS.indexOf(current);
  const last = history[history.length - 1];
  if (current === "practice" && last && sampleOutcome(last) === "win") return "rookie";
  if (
    QUICK_STEP_DOWN.includes(current) &&
    history.length >= STEP_DOWN_LOSSES &&
    history.slice(-STEP_DOWN_LOSSES).every((m) => sampleOutcome(m) === "loss")
  ) {
    return TIERS[Math.max(0, i - 1)];
  }
  if (ladderMatches < ROOKIE_MATCHES) return current === "practice" ? "practice" : "rookie";
  if (history.length < 3) return current;
  const sum = history.slice(-3).reduce((s, m) => s + m.crownDiff, 0);
  if (sum >= 3) return TIERS[Math.min(TIERS.length - 1, i + 1)];
  if (sum <= -3) return TIERS[Math.max(0, i - 1)];
  return current;
}

/**
 * Fold one finished ladder match into the auto state. A tier change starts
 * a fresh window, so the next step needs new results.
 */
export function recordAutoResult(s: AutoState, crownDiff: number, outcome?: MatchOutcome): AutoState {
  const ladderMatches = s.ladderMatches + 1;
  const sample: MatchSample = outcome ? { crownDiff, outcome } : { crownDiff };
  const history = [...s.history, sample].slice(-HISTORY_SIZE);
  const tier = autoTier(history, ladderMatches, s.tier);
  return { v: 1, ladderMatches, tier, history: tier === s.tier ? history : [] };
}

/**
 * A profile from before auto existed has no record: one with trophies has
 * clearly played, so it starts where the old default left it (normal).
 */
export function freshAutoState(trophies: number): AutoState {
  return trophies > 0
    ? { v: 1, ladderMatches: POLITE_MATCHES, tier: "normal", history: [] }
    : { v: 1, ladderMatches: 0, tier: "rookie", history: [] };
}

function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

/** Parse a stored record, falling back to a fresh one on anything odd. */
export function parseAutoState(raw: string | null, trophies: number): AutoState {
  if (!raw) return freshAutoState(trophies);
  try {
    const o = JSON.parse(raw) as Partial<AutoState>;
    const n = Number(o.ladderMatches);
    if (!Number.isFinite(n) || n < 0 || !isTier(o.tier) || !Array.isArray(o.history)) {
      return freshAutoState(trophies);
    }
    const history = o.history
      .map((m): MatchSample => {
        const raw = m as Partial<MatchSample> | null;
        const crownDiff = Number(raw?.crownDiff);
        const outcome = raw?.outcome;
        return outcome === "win" || outcome === "loss" || outcome === "draw" ? { crownDiff, outcome } : { crownDiff };
      })
      .filter((m) => Number.isFinite(m.crownDiff))
      .slice(-HISTORY_SIZE);
    return { v: 1, ladderMatches: Math.floor(n), tier: o.tier, history };
  } catch {
    return freshAutoState(trophies);
  }
}

export function loadAutoState(trophies: number): AutoState {
  try {
    return parseAutoState(localStorage.getItem(AUTO_KEY), trophies);
  } catch {
    return freshAutoState(trophies);
  }
}

/**
 * Pin the auto record once, before anything can grant trophies. A brand-new
 * profile is saved as rookie with no matches played, so the tutorial payout
 * (or a first ladder win) cannot make it look like a veteran later. A profile
 * that already has trophies, or `playedBefore`, keeps the veteran start.
 * An existing record is never touched.
 */
export function ensureAutoState(trophies: number, playedBefore = false): void {
  try {
    if (localStorage.getItem(AUTO_KEY) !== null) return;
  } catch {
    return;
  }
  saveAutoState(freshAutoState(playedBefore ? Math.max(1, trophies) : trophies));
}

export function saveAutoState(s: AutoState): void {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: auto just restarts next session
  }
}

/** The real tier a difficulty option plays at right now. */
export function resolveTier(option: string, auto: AutoState): Tier {
  if (option === "auto") return autoTier([], auto.ladderMatches, auto.tier);
  return isTier(option) ? option : "normal";
}

/** The bot profile for a tier. */
export function tierProfile(tier: Tier): BotProfile {
  return TIER_PROFILES[tier];
}

// ---- Ladder personalities ----------------------------------------------------

/** A ladder bot's personality (main.ts picks one per match). */
export type BotArchetype = "balanced" | "beatdown" | "cycle" | "siege";

/**
 * The first-hour tiers are calibrated as a whole against a novice
 * (novice.test.ts), so a ladder personality never changes their pace.
 */
export function keepsOwnPace(tier: Tier): boolean {
  return tier === "practice" || tier === "rookie";
}

/**
 * A personality's tweak to a profile: beatdown banks bigger pushes, cycle
 * plays faster, siege turtles behind buildings and only commits when
 * fully loaded. Balanced plays the profile as it is.
 */
export function archetypeTweak(base: BotProfile, archetype: BotArchetype): BotProfile {
  switch (archetype) {
    case "beatdown":
      return { ...base, pushAt: Math.min(10, base.pushAt + 1) };
    case "cycle":
      return { ...base, thinkInterval: base.thinkInterval * 0.85, pushAt: Math.max(4, base.pushAt - 2) };
    case "siege":
      return { ...base, thinkInterval: base.thinkInterval * 1.1, pushAt: 10 };
    default:
      return base;
  }
}

/**
 * The ladder bot's profile for a tier and personality, before the champion
 * or mercy banding: practice and rookie keep their own pace, every other
 * tier gets the personality's tweak.
 */
export function ladderProfile(tier: Tier, archetype: BotArchetype): BotProfile {
  const base = tierProfile(tier);
  return keepsOwnPace(tier) ? base : archetypeTweak(base, archetype);
}

/** Ladder matches the player has finished (for the bots' manners). */
export function ladderMatchesPlayed(trophies: number): number {
  return loadAutoState(trophies).ladderMatches;
}

/** My outcome for a finished match. */
export function outcomeFor(winner: string, mySide: string): MatchOutcome {
  return winner === "draw" ? "draw" : winner === mySide ? "win" : "loss";
}

/**
 * Keep the auto record current: every finished solo ladder match (not a
 * sandbox, replay or online game) adds its crown difference and outcome.
 * Also installs the defeat coaching tips (src/match/coachTips.ts), which
 * speak up after the same solo ladder matches, so main.ts wires both at once.
 */
export function installAutoDifficulty(trophies: () => number): () => void {
  const off = on("matchEnd", (m) => {
    if (m.kind !== "ladder" || m.online || m.sandbox || m.replay) return;
    saveAutoState(
      recordAutoResult(loadAutoState(trophies()), m.myCrowns - m.theirCrowns, outcomeFor(m.winner, m.mySide)),
    );
  });
  const offTips = installCoachTips();
  return () => {
    off();
    offTips();
  };
}

// ---- Bot card levels --------------------------------------------------------

const LEVEL_OFFSET: Record<Tier, number> = { practice: -2, rookie: -2, easy: -1, normal: 0, hard: 1 };

/** Mean level of a deck (a missing level is 1). */
export function avgDeckLevel(deck: readonly CardId[], levels: CardLevels): number {
  if (deck.length === 0) return 1;
  return deck.reduce((s, id) => s + (levels[id] ?? 1), 0) / deck.length;
}

/** The bot's level for every card: the player's deck average, shifted by tier. */
export function botLevel(avg: number, tier: Tier): number {
  return Math.min(MAX_CARD_LEVEL, Math.max(1, Math.round(avg) + LEVEL_OFFSET[tier]));
}

/** botLevel for every card; `bonus` adds the champion bot's extra level. */
export function botLevels(avg: number, tier: Tier, bonus = 0): CardLevels {
  const lvl = Math.min(MAX_CARD_LEVEL, botLevel(avg, tier) + bonus);
  const out: CardLevels = {};
  for (const id of DECK) out[id] = lvl;
  return out;
}
