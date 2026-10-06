/**
 * Player settings: one versioned JSON blob under "cr-clone-settings".
 *
 * Every read goes through getPrefs() and every write through setPrefs(),
 * which sanitises the patch, persists it, and notifies onPrefs()
 * subscribers so screens and the renderer can apply changes live.
 *
 * Who reads what:
 * - master, music, sfx, muted, haptics: audio and haptics.
 * - quality: the renderer's quality ladder ('auto' = adaptive governor;
 *   a ?quality= URL pin still wins for testing).
 * - reduceMotion (via reducedMotion()): renderer, VFX, animation and any
 *   screen with decorative motion.
 * - teamPalette: unit and HUD team colours ('cb' = colour-blind pair).
 * - textScale: CSS, through the --text-scale custom property on :root.
 * - playerName, crest: Profile, the result screen and online lobbies.
 * The Settings sheet and Profile are the only writers.
 *
 * Storage may be missing or throw (private mode, blocked site data), so
 * every access is wrapped and the defaults always work.
 */

export type ReduceMotion = "auto" | "on" | "off";
export type QualityPref = "auto" | "low" | "medium" | "high";
export type TeamPalette = "default" | "cb";
export type TextScale = 1 | 1.15 | 1.3;

export interface Prefs {
  v: 1;
  /** Volumes, 0..1. */
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  haptics: boolean;
  reduceMotion: ReduceMotion;
  quality: QualityPref;
  teamPalette: TeamPalette;
  textScale: TextScale;
  /** Display name ('' = use the default label). */
  playerName: string;
  /** Profile crest index, 0..CREST_COUNT-1 (icons crest-0..crest-11). */
  crest: number;
}

export const PREFS_KEY = "cr-clone-settings";
export const CREST_COUNT = 12;
export const PLAYER_NAME_MAX = 12;

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  v: 1,
  master: 1,
  music: 0.5,
  sfx: 0.8,
  muted: false,
  haptics: true,
  reduceMotion: "auto",
  quality: "auto",
  teamPalette: "default",
  textScale: 1,
  playerName: "",
  crest: 0,
});

const REDUCE_MOTION: readonly ReduceMotion[] = ["auto", "on", "off"];
const QUALITY: readonly QualityPref[] = ["auto", "low", "medium", "high"];
const PALETTES: readonly TeamPalette[] = ["default", "cb"];
const TEXT_SCALES: readonly TextScale[] = [1, 1.15, 1.3];

/**
 * Letters and digits in any script, spaces, '_' and '-'; trimmed and capped
 * at 12 characters (counted in code points, so Arabic names count fairly).
 */
export function sanitizePlayerName(s: unknown): string {
  if (typeof s !== "string") return "";
  const kept = s.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(kept).slice(0, PLAYER_NAME_MAX).join("").trim();
}

const unit = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** Coerce anything (a stored blob, a patch) into a valid Prefs. */
export function sanitizePrefs(raw: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const crest = r.crest;
  return {
    v: 1,
    master: unit(r.master, base.master),
    music: unit(r.music, base.music),
    sfx: unit(r.sfx, base.sfx),
    muted: bool(r.muted, base.muted),
    haptics: bool(r.haptics, base.haptics),
    reduceMotion: oneOf(REDUCE_MOTION, r.reduceMotion, base.reduceMotion),
    quality: oneOf(QUALITY, r.quality, base.quality),
    teamPalette: oneOf(PALETTES, r.teamPalette, base.teamPalette),
    textScale: oneOf(TEXT_SCALES, r.textScale, base.textScale),
    playerName: "playerName" in r ? sanitizePlayerName(r.playerName) : base.playerName,
    crest:
      typeof crest === "number" && Number.isInteger(crest) && crest >= 0 && crest < CREST_COUNT
        ? crest
        : base.crest,
  };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): Prefs {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let current: Prefs | null = null;
const listeners = new Set<(p: Readonly<Prefs>) => void>();

function applyTextScale(p: Prefs): void {
  try {
    globalThis.document?.documentElement.style.setProperty("--text-scale", String(p.textScale));
  } catch {
    // No DOM (tests, workers): nothing to style.
  }
}

/** The current settings (loaded once, then kept in memory). */
export function getPrefs(): Readonly<Prefs> {
  if (!current) {
    current = load();
    applyTextScale(current);
  }
  return current;
}

/** Merge a patch: sanitise, persist, apply --text-scale, notify subscribers. */
export function setPrefs(patch: Partial<Omit<Prefs, "v">>): Readonly<Prefs> {
  const next = sanitizePrefs(patch, getPrefs() as Prefs);
  current = next;
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep the in-memory value for this session.
  }
  applyTextScale(next);
  for (const fn of [...listeners]) {
    try {
      fn(next);
    } catch (err) {
      console.error("prefs listener failed", err);
    }
  }
  return next;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onPrefs(fn: (p: Readonly<Prefs>) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True when motion should be reduced: forced on, or 'auto' and the OS asks for it. */
export function reducedMotion(): boolean {
  const pref = getPrefs().reduceMotion;
  if (pref !== "auto") return pref === "on";
  try {
    return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
