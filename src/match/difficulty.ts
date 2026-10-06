/** Bot difficulty presets and the bot's trophy-scaled card levels. */
import type { CardLevels } from "../game/battle";
import type { BotProfile } from "../game/bot";
import { DECK } from "../game/cards";
import { MAX_CARD_LEVEL } from "../meta/progress";

export const DIFF_KEY = "cr-clone-difficulty";
export const DIFFICULTIES: Record<string, BotProfile> = {
  easy: { thinkInterval: 1.8, pushAt: 9 },
  normal: { thinkInterval: 1.0, pushAt: 8 },
  hard: { thinkInterval: 0.55, pushAt: 6 },
};

export function loadDifficulty(): string {
  const saved = localStorage.getItem(DIFF_KEY) ?? "normal";
  return saved in DIFFICULTIES ? saved : "normal";
}

export const DIFF_AR: Record<string, string> = { easy: "سهل", normal: "عادي", hard: "صعب" };

/** The bot levels up with your trophies, one level per 150. */
export function botLevels(trophies: number): CardLevels {
  const lvl = Math.min(MAX_CARD_LEVEL, 1 + Math.floor(trophies / 150));
  const out: CardLevels = {};
  for (const id of DECK) out[id] = lvl;
  return out;
}
