/**
 * Speed-matched walk cycles: feet should not skate. A unit's stride rate
 * follows its ground speed and shrinks with its size (big legs swing
 * slower), its bounce follows its weight class, and four-legged mounts
 * get a proper leg order instead of two pairs of marching biped legs.
 */
import type { QuadGait, Weight } from "./archetypes";

/** Stride rate (rad/s of the walk sine) of a medium-speed, standard-size troop. */
export const BASE_CADENCE = 10;
/** Tiles per second of the reference troop (a medium-speed walker). */
export const REF_SPEED = 1.1;
/** Rig scale of the reference troop (see buildTroopMesh). */
export const REF_SCALE = 1.25;

/**
 * Walk-cycle rate for a unit moving at `speed` tiles/s with rig scale
 * `rigScale`: proportional to speed, and slower for bigger bodies (a
 * pendulum's rate goes with 1/sqrt(length)).
 */
export function gaitCadence(speed: number, rigScale: number): number {
  const s = Math.max(0.05, speed);
  const k = Math.max(0.2, rigScale);
  return BASE_CADENCE * (s / REF_SPEED) * Math.sqrt(REF_SCALE / k);
}

/** Hop and waddle multiplier: skittering lightweights bounce, heavies plod. */
export function hopScale(weight: Weight): number {
  return weight === "light" ? 1.2 : weight === "heavy" ? 0.6 : 1;
}

/** Extra squash when a foot lands (heavies only: the ground takes the weight). */
export function stepSquash(weight: Weight): number {
  return weight === "heavy" ? 0.04 : 0;
}

const BIPED: readonly number[] = [0, Math.PI];
/** Four-beat trot order for [front-left, front-right, hind-left, hind-right]. */
const TROT: readonly number[] = [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2];
/** Bound: the front pair strikes together, then the hind pair. */
const BOUND: readonly number[] = [0, 0, Math.PI, Math.PI];

/**
 * Phase offset (radians) of each leg in the walk cycle. Rigs list four legs
 * front pair first. Shared constant arrays: callers must not mutate them.
 */
export function legPhases(count: number, quad?: QuadGait): readonly number[] {
  if (count === 4) return quad === "bound" ? BOUND : TROT;
  return BIPED;
}

/** Phase of leg `i` (falls back to alternating for unusual leg counts). */
export function legPhase(i: number, count: number, quad?: QuadGait): number {
  const p = legPhases(count, quad);
  return i < p.length ? p[i] : i % 2 === 0 ? 0 : Math.PI;
}
