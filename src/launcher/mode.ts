/**
 * Which game the intro launches: the Clash Royale clone ("clash", Western art)
 * or the Islamic Golden Age version ("islamic", turbaned warriors + crescents).
 *
 * A mode IS an arena theme under the hood — clash = "normal", islamic = "arabic"
 * — so we persist it under the same key the renderer reads (theme.ts), keeping a
 * single source of truth. Switching modes reloads the page so the theme, art,
 * and names are all rebuilt from scratch.
 */
import { ARENA_THEME_KEY, type ArenaTheme } from "../render3d/theme";

export type GameMode = "clash" | "islamic";
export const DEFAULT_MODE: GameMode = "islamic";

/** Minimal localStorage-compatible surface, injected so this stays testable. */
export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isGameMode(value: unknown): value is GameMode {
  return value === "clash" || value === "islamic";
}

export function modeToTheme(mode: GameMode): ArenaTheme {
  return mode === "islamic" ? "arabic" : "normal";
}

export function themeToMode(theme: string | null): GameMode {
  // Anything other than the explicit "normal" theme means the Islamic version,
  // matching theme.ts's own default-to-arabic behaviour.
  return theme === "normal" ? "clash" : "islamic";
}

export function loadMode(storage: ModeStorage): GameMode {
  return themeToMode(storage.getItem(ARENA_THEME_KEY));
}

export function saveMode(storage: ModeStorage, mode: GameMode): void {
  storage.setItem(ARENA_THEME_KEY, modeToTheme(mode));
}

export function otherMode(mode: GameMode): GameMode {
  return mode === "clash" ? "islamic" : "clash";
}
