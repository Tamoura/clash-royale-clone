/**
 * Edition-aware UI strings for modules outside main.ts: English in the
 * Clash edition, Arabic in the Islamic edition.
 */
import { ARABIC } from "../render3d/theme";

export const tr = (en: string, ar: string): string => (ARABIC ? ar : en);

// Formatters are built once per locale (Intl construction is not free).
const numFmt = new Map<string, Intl.NumberFormat>();
function nf(arabic: boolean, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = arabic ? "ar-EG" : "en";
  const key = `${locale}|${JSON.stringify(opts ?? {})}`;
  let f = numFmt.get(key);
  if (!f) numFmt.set(key, (f = new Intl.NumberFormat(locale, opts)));
  return f;
}

/** A number with grouping, in Arabic-Indic digits for the Islamic edition. */
export function formatNum(n: number, arabic: boolean): string {
  return nf(arabic).format(n);
}

/** Whole seconds as m:ss (negative reads as 0; callers round first). */
export function formatTime(sec: number, arabic: boolean): string {
  const s = Math.max(0, Math.floor(sec));
  const ss = nf(arabic, { minimumIntegerDigits: 2, useGrouping: false }).format(s % 60);
  return `${nf(arabic, { useGrouping: false }).format(Math.floor(s / 60))}:${ss}`;
}

/** formatNum in the current edition. */
export const fmtNum = (n: number): string => formatNum(n, ARABIC);

/** formatTime in the current edition. */
export const fmtTime = (sec: number): string => formatTime(sec, ARABIC);
