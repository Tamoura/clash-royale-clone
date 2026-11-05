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

/** Left-to-right isolate: keeps a number run in reading order inside Arabic text. */
const LRI = "\u2066";
const PDI = "\u2069";

/**
 * A compact count for a tight cell (the Profile's "Cards found"): "22/42"
 * in both editions, so it fits on one line on a phone. In Golden Age the
 * slash between two numbers keeps them one left-to-right number run
 * (isolated from the RTL text around it); there is no dot-like separator
 * for the dot-like zero to blur into, which was the Crown Pass problem.
 */
export function countFraction(n: number, of: number, arabic: boolean): string {
  const s = `${formatNum(n, arabic)}/${formatNum(of, arabic)}`;
  return arabic ? `${LRI}${s}${PDI}` : s;
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
