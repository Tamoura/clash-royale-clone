/** Floating combat-text recipe for one batched hit. */
export interface DamageLabel {
  text: string;
  /** Sprite scale multiplier. */
  scale: number;
  /** CSS fill color. */
  color: string;
  /** A huge hit: the number gets a star and a burst. */
  crit?: boolean;
}

/**
 * Label for `dmg` HP lost since the last popup, or null for chip
 * damage not worth a number.
 */
export function damageLabel(dmg: number): DamageLabel | null {
  if (dmg < 25) return null;
  const text = String(Math.round(dmg));
  if (dmg >= 500) return { text, scale: 1.9, color: "#ff5252", crit: true };
  if (dmg >= 200) return { text, scale: 1.45, color: "#ffab40" };
  return { text, scale: 1.0, color: "#ffffff" };
}

/*
 * Popup timing over its life (t = age / POPUP_LIFE, 0..1). The glyph
 * vertex shader in scene/fx/glyphs.ts evaluates the same curves; keep the
 * two in step.
 */

/** Seconds a damage number stays up. */
export const POPUP_LIFE = 0.8;

/** Size multiplier: pops past full size, settles, holds. */
export function popupScale(t: number): number {
  if (t <= 0) return 0.3;
  if (t < 0.12) return 0.3 + (1.25 - 0.3) * (t / 0.12);
  if (t < 0.25) return 1.25 - 0.25 * ((t - 0.12) / 0.13);
  return 1;
}

/** World units risen: quick at first, easing off. */
export function popupRise(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1.1 * (1 - (1 - c) * (1 - c));
}

/** Opacity: solid, then fading over the last 35%. */
export function popupAlpha(t: number): number {
  if (t < 0.65) return 1;
  return Math.max(0, 1 - (t - 0.65) / 0.35);
}
