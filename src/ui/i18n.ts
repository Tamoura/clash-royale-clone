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

/**
 * A whole number with no grouping, for a number that sits on its own
 * (a tower's HP plate): 2534 / ٢٥٣٤.
 */
export function formatInt(n: number, arabic: boolean): string {
  return nf(arabic, { useGrouping: false, maximumFractionDigits: 0 }).format(n);
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

/**
 * A count of Sparks (the battle resource; the sim calls it elixir) in
 * English: "1 spark", "4 sparks". Whole numbers only.
 */
export function sparksEn(n: number): string {
  return n === 1 ? "1 spark" : `${n} sparks`;
}

/**
 * A count of Sparks in Arabic, with the number agreement Arabic needs:
 * 1 شرارة واحدة, 2 شرارتان (شرارتين as an object or after a preposition,
 * `form` "acc"), 3 to 10 (by the last two digits) ٣ شرارات, and every other
 * count the singular, ١١ شرارة. Digits are Arabic-Indic. Whole numbers only.
 */
export function sparksAr(n: number, form: "nom" | "acc" = "nom"): string {
  if (n === 1) return "شرارة واحدة";
  if (n === 2) return form === "acc" ? "شرارتين" : "شرارتان";
  const tail = n % 100;
  return tail >= 3 && tail <= 10 ? `${formatNum(n, true)} شرارات` : `${formatNum(n, true)} شرارة`;
}

/** A count of Sparks in the current edition ("3 sparks" / "٣ شرارات"). */
export const sparks = (n: number, form: "nom" | "acc" = "nom"): string => tr(sparksEn(n), sparksAr(n, form));
