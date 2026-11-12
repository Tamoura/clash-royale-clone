/**
 * The season-start celebration: a toast on the first boot of a new month
 * that tells the player the arena they kept (the reset never takes one
 * away, see seasonResetTrophies in src/meta/achievements.ts). It stays up
 * for SEASON_TOAST_MS, long enough for a young reader to finish it.
 */
import { ARENAS, arenaIndexAt } from "../meta/arenas";

/**
 * How long the season-start toast stays up (the usual toast is 2.4 s). The
 * line is about eight words: a 6-8 year old needs four or five seconds,
 * so this leaves a little more.
 */
export const SEASON_TOAST_MS = 6000;

/**
 * "November 2026 season starts! You kept Royal Arena." `season` is the
 * season's display name (seasonName in screens/pass.ts), already in the
 * edition's language and digits; `trophies` are the trophies after the
 * reset; `tr` picks the edition's language (ui/i18n.ts tr).
 */
export function seasonStartText(season: string, trophies: number, tr: (en: string, ar: string) => string): string {
  const arena = ARENAS[arenaIndexAt(trophies)];
  return tr(`${season} season starts! You kept ${arena.name}.`, `بدأ موسم ${season}! بقيت في ${arena.ar}.`);
}
