/**
 * Crown Pass progress text that reads right in both editions. In Golden
 * Age the Arabic-Indic zero (٠) is a dot, so "٠ · ٢/١٠" looked like
 * "2/1000": Golden Age writes "٢ من ١٠" ("2 of 10") and separates parts
 * with the Arabic comma (،), never a middle dot or a bare slash.
 */
import { formatNum } from "./i18n";

/** "2/10" (Classic) or "٢ من ١٠" (Golden Age). */
export function passFraction(n: number, of: number, arabic: boolean): string {
  return arabic ? `${formatNum(n, true)} من ${formatNum(of, true)}` : `${formatNum(n, false)}/${formatNum(of, false)}`;
}

/** The Battle-tab pill: "Tier 1 · 2/10" / "المستوى ١، ٢ من ١٠". */
export function passPillLine(tier: number, into: number, need: number, arabic: boolean): string {
  return arabic
    ? `المستوى ${formatNum(tier, true)}، ${passFraction(into, need, true)}`
    : `Tier ${formatNum(tier, false)} · ${passFraction(into, need, false)}`;
}

/** The track's bar label after the crown icon: "2 / 10 · next tier 1" / "٢ من ١٠، المستوى التالي ١". */
export function passBarLine(into: number, need: number, nextTier: number, arabic: boolean): string {
  return arabic
    ? `${passFraction(into, need, true)}، المستوى التالي ${formatNum(nextTier, true)}`
    : `${formatNum(into, false)} / ${formatNum(need, false)} · next tier ${formatNum(nextTier, false)}`;
}
