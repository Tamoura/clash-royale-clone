/**
 * Daily quests: three goals drawn from a pool each day, gold on claim.
 * Progress persists in localStorage and resets when the date changes.
 */

export type QuestMeasure = "wins" | "plays" | "damage";

export interface QuestDef {
  id: string;
  /** English + Arabic labels (the UI picks by edition). */
  en: string;
  ar: string;
  measure: QuestMeasure;
  target: number;
  /** Gold granted on claim. */
  reward: number;
}

export const QUEST_POOL: QuestDef[] = [
  { id: "win2", en: "Win 2 battles", ar: "افز في معركتين", measure: "wins", target: 2, reward: 40 },
  { id: "win3", en: "Win 3 battles", ar: "افز في ٣ معارك", measure: "wins", target: 3, reward: 70 },
  { id: "play20", en: "Play 20 cards", ar: "العب ٢٠ بطاقة", measure: "plays", target: 20, reward: 30 },
  { id: "play40", en: "Play 40 cards", ar: "العب ٤٠ بطاقة", measure: "plays", target: 40, reward: 60 },
  { id: "dmg30", en: "Deal 30,000 damage", ar: "ألحق ٣٠ ألف ضرر", measure: "damage", target: 30000, reward: 40 },
  { id: "dmg80", en: "Deal 80,000 damage", ar: "ألحق ٨٠ ألف ضرر", measure: "damage", target: 80000, reward: 80 },
];

export interface QuestState {
  /** Day these quests belong to (YYYY-MM-DD); a new day rerolls. */
  date: string;
  /** Ids of today's three quests. */
  active: string[];
  progress: Record<string, number>;
  claimed: string[];
}

/** Deterministic small hash for date-seeded quest selection. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Today's three quests, chosen deterministically from the pool. */
export function rollQuests(date: string): QuestState {
  const ids = QUEST_POOL.map((q) => q.id);
  const picked: string[] = [];
  let h = hash(date);
  while (picked.length < 3 && ids.length > 0) {
    h = hash(String(h) + date);
    const idx = h % ids.length;
    picked.push(ids.splice(idx, 1)[0]);
  }
  return { date, active: picked, progress: {}, claimed: [] };
}

export function questDef(id: string): QuestDef | undefined {
  return QUEST_POOL.find((q) => q.id === id);
}

/** Fold a finished match into quest progress (capped at each target). */
export function recordMatch(
  state: QuestState,
  result: { won: boolean; cardsPlayed: number; damage: number },
): QuestState {
  const progress = { ...state.progress };
  for (const id of state.active) {
    const def = questDef(id);
    if (!def) continue;
    const gain =
      def.measure === "wins" ? (result.won ? 1 : 0)
      : def.measure === "plays" ? result.cardsPlayed
      : result.damage;
    if (gain <= 0) continue;
    progress[id] = Math.min(def.target, (progress[id] ?? 0) + gain);
  }
  return { ...state, progress };
}

export function isComplete(state: QuestState, id: string): boolean {
  const def = questDef(id);
  return !!def && (state.progress[id] ?? 0) >= def.target;
}

/**
 * Claim a completed quest; returns the gold reward and the new state, or
 * null when the quest isn't complete or was already claimed.
 */
export function claimQuest(
  state: QuestState,
  id: string,
): { state: QuestState; reward: number } | null {
  if (!isComplete(state, id) || state.claimed.includes(id)) return null;
  const def = questDef(id)!;
  return { state: { ...state, claimed: [...state.claimed, id] }, reward: def.reward };
}

export const QUESTS_STORAGE_KEY = "cr-clone-quests";

/** Load today's quest state (rerolls on a new day / corrupt save). Node-safe. */
export function loadQuests(today: string): QuestState {
  try {
    const raw = localStorage.getItem(QUESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QuestState;
      if (
        parsed &&
        parsed.date === today &&
        Array.isArray(parsed.active) &&
        parsed.active.length === 3
      ) {
        return {
          date: today,
          active: parsed.active,
          progress: parsed.progress ?? {},
          claimed: Array.isArray(parsed.claimed) ? parsed.claimed : [],
        };
      }
    }
  } catch {
    // fall through to a fresh roll
  }
  return rollQuests(today);
}

export function saveQuests(state: QuestState): void {
  try {
    localStorage.setItem(QUESTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — quests just won't persist
  }
}
