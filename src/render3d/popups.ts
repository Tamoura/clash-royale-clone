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

/** Art bible 8: every damage number is gold, stroked dark (glyphs.ts). */
export const DAMAGE_GOLD = "#ffd23f";
/** Crits and tower hits print about this much larger than a normal hit. */
export const BIG_HIT_SCALE = 1.3;

/**
 * Label for `dmg` HP lost since the last popup, or null for chip
 * damage not worth a number. Size, not colour, says how big the hit was.
 */
export function damageLabel(dmg: number): DamageLabel | null {
  if (dmg < 25) return null;
  const text = String(Math.round(dmg));
  if (dmg >= 500) return { text, scale: BIG_HIT_SCALE, color: DAMAGE_GOLD, crit: true };
  if (dmg >= 200) return { text, scale: 1.12, color: DAMAGE_GOLD };
  return { text, scale: 1.0, color: DAMAGE_GOLD };
}

/** The same label on a tower: printed at least BIG_HIT_SCALE (crits a step larger still). */
export function towerHitLabel(label: DamageLabel): DamageLabel {
  return { ...label, scale: label.crit ? BIG_HIT_SCALE * 1.12 : Math.max(label.scale, BIG_HIT_SCALE) };
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
