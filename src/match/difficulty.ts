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

export const DIFF_KEY = "cr-clone-difficulty";
export const AUTO_KEY = "cr-clone-auto-history";

/** Real bot tiers, weakest first. */
export type Tier = "rookie" | "easy" | "normal" | "hard";
export const TIERS: readonly Tier[] = ["rookie", "easy", "normal", "hard"];

/**
 * Rookie is tuned against a near-random player (novice.test.ts wins about
 * half its games): it thinks every 5 s, notices each invader late, slips
 * up on a third of its plays, only spells big clusters and never finishes
 * a tower with a spell.
 */
const TIER_PROFILES: Record<Tier, BotProfile> = {
  rookie: {
    thinkInterval: 5,
    pushAt: 10,
    mistakeRate: 0.35,
    allowFinisher: false,
    spellIQ: 2.0,
    reactionDelay: 1.2,
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
  rookie: "مبتدئ",
  easy: "سهل",
  normal: "عادي",
  hard: "صعب",
};

/** One-line explanation per option: [English, Arabic]. */
export const DIFF_BLURB: Record<string, [string, string]> = {
  auto: ["Adapts to how you play", "يتكيّف مع مستواك"],
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

export interface MatchSample {
  /** My crowns minus theirs. */
  crownDiff: number;
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
/** Auto plays rookie for this many ladder matches. */
export const ROOKIE_MATCHES = 5;
/** Bots keep their taunts to themselves for this many ladder matches. */
export const POLITE_MATCHES = 10;

/**
 * The tier auto should play next. Rookie for the first ROOKIE_MATCHES;
 * then one step up when the last 3 crown diffs add up to +3 or more, one
 * step down at -3 or less, otherwise stay at `current`.
 */
export function autoTier(
  history: readonly MatchSample[],
  ladderMatches: number,
  current: Tier = "rookie",
): Tier {
  if (ladderMatches < ROOKIE_MATCHES) return "rookie";
  if (history.length < 3) return current;
  const sum = history.slice(-3).reduce((s, m) => s + m.crownDiff, 0);
  const i = TIERS.indexOf(current);
  if (sum >= 3) return TIERS[Math.min(TIERS.length - 1, i + 1)];
  if (sum <= -3) return TIERS[Math.max(0, i - 1)];
  return current;
}

/**
 * Fold one finished ladder match into the auto state. A tier change starts
 * a fresh window, so the next step needs three new results.
 */
export function recordAutoResult(s: AutoState, crownDiff: number): AutoState {
  const ladderMatches = s.ladderMatches + 1;
  const history = [...s.history, { crownDiff }].slice(-HISTORY_SIZE);
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
      .map((m) => ({ crownDiff: Number((m as MatchSample)?.crownDiff) }))
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

/** Ladder matches the player has finished (for the bots' manners). */
export function ladderMatchesPlayed(trophies: number): number {
  return loadAutoState(trophies).ladderMatches;
}

/**
 * Keep the auto record current: every finished solo ladder match (not a
 * sandbox, replay or online game) adds its crown difference.
 */
export function installAutoDifficulty(trophies: () => number): () => void {
  return on("matchEnd", (m) => {
    if (m.kind !== "ladder" || m.online || m.sandbox || m.replay) return;
    saveAutoState(recordAutoResult(loadAutoState(trophies()), m.myCrowns - m.theirCrowns));
  });
}

// ---- Bot card levels --------------------------------------------------------

const LEVEL_OFFSET: Record<Tier, number> = { rookie: -2, easy: -1, normal: 0, hard: 1 };

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
