/** Seconds between footstep dust puffs while a ground troop walks. */
export const DUST_INTERVAL = 0.45;

/**
 * Scale of a flyer's soft blob shadow: full size at its resting
 * hover height, shrinking (but never vanishing) as it bobs upward.
 */
export function blobShadowScale(restingHover: number, currentY: number): number {
  const rise = currentY - restingHover;
  return Math.min(1.3, Math.max(0.55, 1 - rise * 0.6));
}
