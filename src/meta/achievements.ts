/**
 * Lifetime achievements + monthly seasons.
 *
 * Achievements accumulate forever (unlike daily quests) from simple
 * counters, and pay gold once on claim. Seasons are keyed by calendar
 * month: on the first boot of a new month, trophies above the season
 * floor are halved back toward it (CR-style soft reset) and the previous
 * season's best is archived.
 */

export interface AchievementDef {
  id: string;
  /** English + Arabic labels (the UI picks by edition). */
  en: string;
  ar: string;
  counter: keyof AchievementCounters;
  target: number;
  /** Gold granted on claim. */
  reward: number;
}

export interface AchievementCounters {
  wins: number;
  threeCrowns: number;
  plays: number;
  damage: number;
  chests: number;
  quickWins: number;
  championWins: number;
  bestTrophies: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-win", en: "Win your first battle", ar: "افز بأول معركة", counter: "wins", target: 1, reward: 50 },
  { id: "win-10", en: "Win 10 battles", ar: "افز بـ ١٠ معارك", counter: "wins", target: 10, reward: 100 },
  { id: "win-50", en: "Win 50 battles", ar: "افز بـ ٥٠ معركة", counter: "wins", target: 50, reward: 250 },
  { id: "three-crown", en: "Score a 3-crown victory", ar: "حقق نصرًا بثلاثة تيجان", counter: "threeCrowns", target: 1, reward: 60 },
  { id: "three-crown-10", en: "Score 10 three-crown victories", ar: "حقق ١٠ انتصارات بثلاثة تيجان", counter: "threeCrowns", target: 10, reward: 150 },
  { id: "play-200", en: "Play 200 cards", ar: "العب ٢٠٠ بطاقة", counter: "plays", target: 200, reward: 80 },
  { id: "dmg-500k", en: "Deal 500,000 total damage", ar: "ألحق ٥٠٠ ألف ضرر إجمالي", counter: "damage", target: 500_000, reward: 120 },
  { id: "chest-10", en: "Open 10 chests", ar: "افتح ١٠ صناديق", counter: "chests", target: 10, reward: 80 },
  { id: "champion-win", en: "Win with your Champion in the deck", ar: "افز وبطلك ضمن المجموعة", counter: "championWins", target: 1, reward: 70 },
  { id: "quick-win", en: "Win a battle in under 2 minutes", ar: "افز بمعركة في أقل من دقيقتين", counter: "quickWins", target: 1, reward: 90 },
  { id: "trophies-1k", en: "Reach 1000 trophies", ar: "اجمع ١٠٠٠ كأس", counter: "bestTrophies", target: 1000, reward: 150 },
];

export interface AchievementState {
  counters: AchievementCounters;
  claimed: string[];
}

export function freshAchievements(): AchievementState {
  return {
    counters: {
      wins: 0,
      threeCrowns: 0,
      plays: 0,
      damage: 0,
      chests: 0,
      quickWins: 0,
      championWins: 0,
      bestTrophies: 0,
    },
    claimed: [],
  };
}

export interface MatchFacts {
  won: boolean;
  crowns: number;
  cardsPlayed: number;
  damage: number;
  /** Match length in seconds. */
  durationSec: number;
  deckHadChampion: boolean;
  trophiesAfter: number;
}

/** Fold a finished match into the lifetime counters. */
export function recordMatch(state: AchievementState, m: MatchFacts): AchievementState {
  const c = { ...state.counters };
  if (m.won) c.wins += 1;
  if (m.won && m.crowns >= 3) c.threeCrowns += 1;
  c.plays += m.cardsPlayed;
  c.damage += m.damage;
  if (m.won && m.durationSec < 120) c.quickWins += 1;
  if (m.won && m.deckHadChampion) c.championWins += 1;
  c.bestTrophies = Math.max(c.bestTrophies, m.trophiesAfter);
  return { ...state, counters: c };
}

/** Fold a chest opening into the lifetime counters. */
export function recordChest(state: AchievementState): AchievementState {
  return {
    ...state,
    counters: { ...state.counters, chests: state.counters.chests + 1 },
  };
}

export function achievementProgress(state: AchievementState, def: AchievementDef): number {
  return Math.min(def.target, state.counters[def.counter]);
}

export function isEarned(state: AchievementState, def: AchievementDef): boolean {
  return state.counters[def.counter] >= def.target;
}

/**
 * Claim an earned achievement; returns the gold reward and the new state,
 * or null when it isn't earned yet or was already claimed.
 */
export function claimAchievement(
  state: AchievementState,
  id: string,
): { state: AchievementState; reward: number } | null {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def || !isEarned(state, def) || state.claimed.includes(id)) return null;
  return {
    state: { ...state, claimed: [...state.claimed, id] },
    reward: def.reward,
  };
}

export const ACHIEVEMENTS_STORAGE_KEY = "cr-clone-achievements";

export function loadAchievements(): AchievementState {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AchievementState;
      if (parsed && parsed.counters) {
        return {
          counters: { ...freshAchievements().counters, ...parsed.counters },
          claimed: Array.isArray(parsed.claimed) ? parsed.claimed : [],
        };
      }
    }
  } catch {
    // fall through to a fresh state
  }
  return freshAchievements();
}

export function saveAchievements(state: AchievementState): void {
  try {
    localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — progress just won't persist
  }
}

// ---- Seasons -------------------------------------------------------------

/** Trophies below the floor are untouched by the season reset. */
export const SEASON_FLOOR = 1000;

export interface SeasonState {
  /** Calendar month key, e.g. "2026-08". */
  key: string;
  /** Best trophy count reached this season. */
  best: number;
  /** Archived past seasons, newest first (capped). */
  history: Array<{ key: string; best: number }>;
}

export function seasonKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Roll the season forward if the month changed. Returns the (possibly
 * soft-reset) trophy count and whether a reset banner should show.
 */
export function checkSeason(
  state: SeasonState | null,
  nowKey: string,
  trophies: number,
): { state: SeasonState; trophies: number; reset: boolean } {
  if (state && state.key === nowKey) {
    return {
      state: { ...state, best: Math.max(state.best, trophies) },
      trophies,
      reset: false,
    };
  }
  const history = state
    ? [{ key: state.key, best: Math.max(state.best, trophies) }, ...state.history].slice(0, 12)
    : [];
  const softReset =
    trophies > SEASON_FLOOR
      ? SEASON_FLOOR + Math.floor((trophies - SEASON_FLOOR) / 2)
      : trophies;
  return {
    state: { key: nowKey, best: softReset, history },
    trophies: softReset,
    // Only banner an actual change — a fresh profile just starts season 1.
    reset: state !== null && softReset !== trophies,
  };
}

export const SEASON_STORAGE_KEY = "cr-clone-season";

export function loadSeason(): SeasonState | null {
  try {
    const raw = localStorage.getItem(SEASON_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SeasonState;
      if (parsed && typeof parsed.key === "string") {
        return {
          key: parsed.key,
          best: parsed.best ?? 0,
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

export function saveSeason(state: SeasonState): void {
  try {
    localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable
  }
}
