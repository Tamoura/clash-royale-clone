/**
 * The season-start celebration: a toast on the first boot of a new month
 * that tells the player the arena they kept (the reset never takes one
 * away, see seasonResetTrophies in src/meta/achievements.ts). Short, so a
 * young reader finishes it before it goes.
 */
import { ARENAS, arenaIndexAt } from "../meta/arenas";

/**
 * "November 2026 season starts! You kept Royal Arena." `season` is the
 * season's display name (seasonName in screens/pass.ts), already in the
 * edition's language and digits; `trophies` are the trophies after the reset.
 */
export function seasonStartText(season: string, trophies: number, arabic: boolean): string {
  const arena = ARENAS[arenaIndexAt(trophies)];
  return arabic ? `بدأ موسم ${season}! بقيت في ${arena.ar}.` : `${season} season starts! You kept ${arena.name}.`;
}
