/**
 * Render-side motion smoothing between fixed sim ticks.
 *
 * The sim advances in 1/30 s steps; the screen refreshes at 60/120 Hz. Each
 * view keeps the last two sim positions it saw and draws a blend of them by
 * the frame's `alpha` (the fraction of a tick elapsed since the newest
 * state). Long jumps (Mega Knight leaps, teleports) snap; short sudden
 * shoves (spell knockback, firing recoil) ease in over a few frames.
 *
 * Everything here is read-only with respect to the battle state and
 * allocation-free: callers pass the per-view record and a scratch output.
 */

/** Seconds per sim tick (matches the fixed step in main.ts). */
export const SIM_DT = 1 / 30;
/** A per-tick move longer than this (tiles) is a teleport: no blending. */
export const SNAP_DIST = 1.4;
/** Seconds a knockback / recoil shove takes to play out on screen. */
export const KNOCK_EASE = 0.12;

/** Fields a view keeps for interpolation (EntityView carries them). */
export interface InterpTrack {
  /** World x/z of the second-newest sim sample. */
  prevX?: number;
  prevZ?: number;
  /** World x/z of the newest sim sample. */
  curX?: number;
  curZ?: number;
  /** Sim time of the newest sample (the "last tick"). */
  lastTick?: number;
  /** Seconds left of an eased knockback, and where it started on screen. */
  knockT?: number;
  knockFromX?: number;
  knockFromZ?: number;
  /** Where the view was drawn last frame (the knockback start point). */
  drawnX?: number;
  drawnZ?: number;
}

/** What a new sim sample meant for the view. */
export type SampleKind = "same" | "step" | "knock" | "snap";

/** Alpha as a usable blend weight: NaN / out of range clamp into [0, 1]. */
export function clampAlpha(alpha: number): number {
  if (!(alpha > 0)) return 0; // NaN, negatives, -0
  return alpha >= 1 ? 1 : alpha;
}

/** Linear blend of two scalars. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Blend from `prev` to `cur` by `alpha`, unless the two are more than
 * SNAP_DIST apart, in which case the newest sample is drawn as is.
 * Writes into `out` and returns it (no allocation).
 */
export function lerpSnap(
  prevX: number,
  prevZ: number,
  curX: number,
  curZ: number,
  alpha: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const dx = curX - prevX;
  const dz = curZ - prevZ;
  if (dx * dx + dz * dz > SNAP_DIST * SNAP_DIST) {
    out.x = curX;
    out.z = curZ;
    return out;
  }
  const a = clampAlpha(alpha);
  out.x = prevX + dx * a;
  out.z = prevZ + dz * a;
  return out;
}

/**
 * Feed the newest sim position. Called every frame; only a change in sim
 * time (a new tick) shifts the samples. `maxStep` is the farthest the unit
 * can plausibly walk per tick; anything longer (but under SNAP_DIST) was a
 * shove and is eased in over KNOCK_EASE instead of popping.
 */
export function pushSample(
  tr: InterpTrack,
  x: number,
  z: number,
  tick: number,
  maxStep: number,
): SampleKind {
  if (tr.lastTick === undefined || tr.curX === undefined || tick < tr.lastTick) {
    // First sight (or a new battle rewound the clock): start at rest.
    tr.prevX = tr.curX = tr.drawnX = x;
    tr.prevZ = tr.curZ = tr.drawnZ = z;
    tr.lastTick = tick;
    tr.knockT = 0;
    return "snap";
  }
  if (tick === tr.lastTick) {
    // Same tick, but the position may still have been nudged (dev tools,
    // a paused sim being edited): keep the newest sample truthful.
    tr.curX = x;
    tr.curZ = z;
    return "same";
  }
  const ticks = Math.max(1, Math.round((tick - tr.lastTick) / SIM_DT));
  const dx = x - tr.curX;
  const dz = z - (tr.curZ ?? z);
  const step2 = dx * dx + dz * dz;
  tr.lastTick = tick;
  if (step2 > SNAP_DIST * SNAP_DIST) {
    tr.prevX = tr.curX = x;
    tr.prevZ = tr.curZ = z;
    tr.knockT = 0;
    return "snap";
  }
  const reach = maxStep * ticks;
  if (step2 > reach * reach) {
    // Ease from wherever the unit is on screen right now to the new spot.
    tr.knockFromX = tr.drawnX ?? tr.curX;
    tr.knockFromZ = tr.drawnZ ?? tr.curZ;
    tr.knockT = KNOCK_EASE;
    tr.prevX = tr.curX = x;
    tr.prevZ = tr.curZ = z;
    return "knock";
  }
  tr.prevX = tr.curX;
  tr.prevZ = tr.curZ;
  tr.curX = x;
  tr.curZ = z;
  return "step";
}

/**
 * Where to draw the view this frame: the alpha blend of its samples, or a
 * running knockback ease. `dt` is the presentation step that drains the
 * ease. Records the result as the view's drawn position.
 */
export function sampleTrack(
  tr: InterpTrack,
  alpha: number,
  dt: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  lerpSnap(tr.prevX ?? 0, tr.prevZ ?? 0, tr.curX ?? 0, tr.curZ ?? 0, alpha, out);
  if (tr.knockT && tr.knockT > 0) {
    tr.knockT = Math.max(0, tr.knockT - dt);
    const f = 1 - tr.knockT / KNOCK_EASE;
    const e = 1 - (1 - f) * (1 - f) * (1 - f); // ease-out cubic
    out.x = lerp(tr.knockFromX ?? out.x, out.x, e);
    out.z = lerp(tr.knockFromZ ?? out.z, out.z, e);
  }
  tr.drawnX = out.x;
  tr.drawnZ = out.z;
  return out;
}

/**
 * The shared animation clock: sim time pushed forward by the fraction of a
 * tick already elapsed, so cycles advance every frame rather than in 30 Hz
 * steps. While a render hit-stop holds, the clock holds too.
 */
export function animClock(prev: number, stateTime: number, alpha: number, hitStop: boolean): number {
  if (hitStop) return prev;
  return stateTime + clampAlpha(alpha) * SIM_DT;
}
