/** Floating combat-text recipe for one batched hit. */
export interface DamageLabel {
  text: string;
  /** Sprite scale multiplier. */
  scale: number;
  /** CSS fill color. */
  color: string;
}

/**
 * Label for `dmg` HP lost since the last popup, or null for chip
 * damage not worth a number.
 */
export function damageLabel(dmg: number): DamageLabel | null {
  if (dmg < 25) return null;
  const text = String(Math.round(dmg));
  if (dmg >= 500) return { text, scale: 1.9, color: "#ff5252" };
  if (dmg >= 200) return { text, scale: 1.45, color: "#ffab40" };
  return { text, scale: 1.0, color: "#ffffff" };
}
