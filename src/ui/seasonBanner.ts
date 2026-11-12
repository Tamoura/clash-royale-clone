/**
 * The season-start banner: a small celebration on the first boot of a new
 * month that tells the player the arena they kept (the reset never takes
 * one away, see seasonResetTrophies in src/meta/achievements.ts).
 */
import { ARENAS, arenaIndexAt } from "../meta/arenas";
import { formatNum } from "./i18n";

/**
 * "December 2026 season starts! You kept Royal Arena with 1,600 trophies."
 * `season` is the season's display name (seasonName in screens/pass.ts),
 * already in the edition's language and digits.
 */
export function seasonStartText(season: string, trophies: number, arabic: boolean): string {
  const arena = ARENAS[arenaIndexAt(trophies)];
  const n = formatNum(trophies, arabic);
  return arabic
    ? `بدأ موسم ${season}! بقيت في ${arena.ar} ومعك ${n} كأس.`
    : `${season} season starts! You kept ${arena.name} with ${n} ${trophies === 1 ? "trophy" : "trophies"}.`;
}
