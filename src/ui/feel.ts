/**
 * Haptic feedback: short vibration patterns for touches and match beats.
 *
 * buzz(kind) is fire-and-forget. It does nothing (and never throws) when
 * the device has no vibration motor API (iOS Safari, desktop), when the
 * player turned Haptics off in Settings, or when the browser refuses.
 * Callers in other packages use it freely; the pattern table and the
 * throttle are pure and unit-tested.
 */
import { getPrefs } from "./prefs";

export type BuzzKind =
  | "select"
  | "deploy"
  | "invalid"
  | "ability"
  | "towerHit"
  | "towerDown"
  | "king"
  | "victory"
  | "defeat"
  | "claim";

/** Vibration patterns in ms (on, off, on, …). */
export const BUZZ_PATTERNS: Readonly<Record<BuzzKind, number | readonly number[]>> = {
  select: 6,
  deploy: 12,
  invalid: [18, 40, 18],
  ability: [14, 30, 24],
  towerHit: 8,
  towerDown: [40, 60, 80],
  king: [30, 30, 30],
  victory: [20, 40, 20, 40, 60],
  defeat: [60],
  claim: [10, 30, 10],
};

/** Minimum gap between two buzzes of the same kind. */
export const BUZZ_THROTTLE_MS: Readonly<Partial<Record<BuzzKind, number>>> = {
  towerHit: 400,
};
/** Gap for kinds without their own entry: merges double-fired taps. */
export const DEFAULT_THROTTLE_MS = 50;

/** A per-kind rate limiter: allow(kind, now) is true when the kind may fire. */
export function createThrottle(
  table: Readonly<Partial<Record<BuzzKind, number>>> = BUZZ_THROTTLE_MS,
  fallback = DEFAULT_THROTTLE_MS,
): (kind: BuzzKind, now: number) => boolean {
  const last = new Map<BuzzKind, number>();
  return (kind, now) => {
    const prev = last.get(kind);
    if (prev !== undefined && now - prev < (table[kind] ?? fallback)) return false;
    last.set(kind, now);
    return true;
  };
}

/** The pattern for a kind, as navigator.vibrate takes it. */
export function buzzPattern(kind: BuzzKind): number | number[] {
  const p = BUZZ_PATTERNS[kind];
  return typeof p === "number" ? p : [...p];
}

const allow = createThrottle();

function clock(): number {
  try {
    return globalThis.performance?.now() ?? Date.now();
  } catch {
    return Date.now();
  }
}

/** Vibrate for `kind` if the device can and the player wants it. Returns true if it did. */
export function buzz(kind: BuzzKind): boolean {
  try {
    const nav = globalThis.navigator as (Navigator & { vibrate?: Navigator["vibrate"] }) | undefined;
    if (!nav || !("vibrate" in nav) || typeof nav.vibrate !== "function") return false;
    if (!getPrefs().haptics) return false;
    if (!(kind in BUZZ_PATTERNS) || !allow(kind, clock())) return false;
    return nav.vibrate(buzzPattern(kind)) !== false;
  } catch {
    return false;
  }
}

/** True when this device exposes a vibration API (Settings hides the toggle otherwise). */
export function canBuzz(): boolean {
  try {
    return typeof globalThis.navigator?.vibrate === "function";
  } catch {
    return false;
  }
}
