/**
 * Named particle presets: each is a list of emitter layers (pure data)
 * that emitPreset() turns into particle records for the additive (hot,
 * blooming) or alpha (smoke, chips) pool.
 *
 * Contract names used outside this package — keep them stable: 'dust',
 * 'smoke', 'smoke-column', 'chips' and 'ring'.
 *
 * Options: `radius` scales a layer's spawn area, speed and size (a ring's
 * final diameter is 2 x radius), `color` re-tints tintable layers, `count`
 * rescales every layer relative to the first, `side` is unused here.
 */
import * as THREE from "three";
import { MODE_BILLBOARD, MODE_GROUND, clearSpec, type ParticleSpec } from "../../particles";
import { CELL, SMOKE_CELLS } from "./atlas";

export type PoolKind = "add" | "alpha";

/** A fixed value or a [min, max] range picked uniformly. */
export type Range = number | readonly [number, number];

export interface Layer {
  pool: PoolKind;
  /** Atlas cell, or a list to pick from per particle. */
  cell: number | readonly number[];
  count: number;
  life: Range;
  delay?: Range;
  /** Launch direction: an upward cone, any direction, flat outward, straight down, or still. */
  dir: "up" | "sphere" | "out" | "down" | "none";
  /** Cone half-angle for 'up' (radians). */
  spread?: number;
  speed: Range;
  /** Extra vertical speed added after the direction. */
  vy?: Range;
  /** Horizontal spawn jitter radius. */
  area?: number;
  /** Spawn on the edge of the area circle instead of inside it. */
  edge?: boolean;
  /** Spawn height above the emit point. */
  height?: Range;
  gravity?: number;
  drag?: number;
  size0: Range;
  size1: Range;
  spin?: Range;
  color0: number;
  color1?: number;
  /** Colour multipliers: above 1 is HDR and feeds the bloom. */
  hdr0?: number;
  hdr1?: number;
  alpha0?: number;
  alpha1?: number;
  /** Random colour per particle (overrides color0/color1). */
  palette?: readonly number[];
  /** Streak length added per unit of screen speed (in sizes). */
  stretch?: number;
  /** Lie flat on the ground instead of facing the camera. */
  ground?: boolean;
  /** Depth nudge toward the camera, in sizes. */
  push?: number;
  /** Whether opts.color re-tints this layer (default true). */
  tint?: boolean;
  /** Whether opts.radius scales this layer (default true). */
  scales?: boolean;
}

export interface Spawner {
  spawn(kind: PoolKind, s: ParticleSpec): void;
  /** Uniform [0, 1) render randomness. */
  rand(): number;
  /** Particle count multiplier for the current quality. */
  scale(): number;
}

export interface EmitOpts {
  z?: number;
  color?: number;
  radius?: number;
  count?: number;
  /** Seconds to wait before the effect starts. */
  delay?: number;
}

const SMOKE = SMOKE_CELLS;

export const PRESETS: Record<string, readonly Layer[]> = {
  // Footstep dust: two tiny scuffs.
  dust: [
    { pool: "alpha", cell: SMOKE, count: 2, life: [0.35, 0.5], dir: "up", spread: 1.2, speed: [0.3, 0.6], area: 0.15, height: 0.1, drag: 2, size0: [0.12, 0.18], size1: [0.35, 0.45], spin: [-1, 1], color0: 0xd6cbb6, color1: 0xbcae96, alpha0: 0.55, alpha1: 0, push: 0.5 },
  ],
  // Smouldering grey billows (damaged towers, generic puffs).
  smoke: [
    { pool: "alpha", cell: SMOKE, count: 4, life: [0.7, 1.0], dir: "up", spread: 0.9, speed: [0.5, 1.1], area: 0.3, height: 0.2, drag: 1.6, gravity: -0.4, size0: [0.35, 0.5], size1: [0.9, 1.3], spin: [-0.8, 0.8], color0: 0x8a8278, color1: 0x5a544d, alpha0: 0.8, alpha1: 0, push: 0.5 },
  ],
  // A tall rising column (tower collapse): staggered billows plus cinders.
  "smoke-column": [
    { pool: "alpha", cell: SMOKE, count: 16, life: [1.6, 2.3], delay: [0, 1.2], dir: "up", spread: 0.35, speed: [1.4, 2.4], area: 0.9, height: [0.3, 1.2], drag: 0.6, gravity: -0.3, size0: [0.7, 1.0], size1: [1.9, 2.6], spin: [-0.5, 0.5], color0: 0x6e665d, color1: 0x3b3733, alpha0: 0.85, alpha1: 0, push: 0.4 },
    { pool: "add", cell: CELL.EMBER, count: 10, life: [0.8, 1.4], delay: [0, 0.8], dir: "up", spread: 0.6, speed: [2, 4], area: 0.8, height: 0.6, drag: 1.2, gravity: 1.5, size0: [0.12, 0.18], size1: 0.04, color0: 0xffa040, color1: 0xff3d00, hdr0: 3, hdr1: 1.5, alpha0: 1, alpha1: 0, tint: false },
  ],
  // Masonry chips knocked off a tower, with a little dust.
  chips: [
    { pool: "alpha", cell: CELL.CHIP, count: 8, life: [0.55, 0.8], dir: "up", spread: 1.1, speed: [3, 5.5], area: 0.35, height: 0.4, gravity: 16, size0: [0.16, 0.26], size1: [0.14, 0.2], spin: [-12, 12], color0: 0xa89a86, color1: 0x8b7c69, alpha0: 1, alpha1: 0.6 },
    { pool: "alpha", cell: SMOKE, count: 2, life: [0.4, 0.6], dir: "up", spread: 1.2, speed: [0.5, 1], area: 0.3, height: 0.3, drag: 2, size0: 0.3, size1: 0.8, color0: 0xb8ab98, alpha0: 0.6, alpha1: 0, push: 0.5, tint: false },
  ],
  // Troop landing: a low ring of dust rolling outward.
  deployPuff: [
    { pool: "alpha", cell: SMOKE, count: 7, life: [0.45, 0.65], dir: "out", speed: [1.6, 2.4], vy: [0.2, 0.5], area: 0.3, edge: true, height: 0.15, drag: 3.5, size0: [0.3, 0.4], size1: [0.7, 0.9], spin: [-1, 1], color0: 0xe2d7c4, color1: 0xcbbda6, alpha0: 0.75, alpha1: 0, push: 0.5 },
  ],
  // Melee contact: velocity-stretched streaks plus one sparkle.
  hitSpark: [
    { pool: "add", cell: CELL.STREAK, count: 6, life: [0.18, 0.3], dir: "sphere", speed: [4, 7.5], height: 0, drag: 3, gravity: 9, size0: [0.08, 0.12], size1: 0.04, stretch: 0.9, color0: 0xfff1c4, hdr0: 2.6, hdr1: 1.2, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.STAR, count: 1, life: 0.13, dir: "none", speed: 0, size0: 0.65, size1: 0.2, spin: [-6, 6], color0: 0xfff7e0, hdr0: 3, hdr1: 1.5, alpha0: 1, alpha1: 0, push: 1 },
  ],
  // A huge hit: a big sparkle, a hot flash, a fan of streaks and a ring.
  crit: [
    { pool: "add", cell: CELL.FLARE, count: 1, life: 0.16, dir: "none", speed: 0, size0: 1.6, size1: 0.5, color0: 0xffe7a0, hdr0: 3.2, hdr1: 1, alpha0: 1, alpha1: 0, push: 1 },
    { pool: "add", cell: CELL.STAR, count: 1, life: 0.22, dir: "none", speed: 0, size0: 1.1, size1: 0.3, spin: [-5, 5], color0: 0xffffff, hdr0: 3, alpha0: 1, alpha1: 0, push: 1, tint: false },
    { pool: "add", cell: CELL.STREAK, count: 12, life: [0.25, 0.4], dir: "sphere", speed: [6, 10], drag: 3, gravity: 8, size0: [0.1, 0.15], size1: 0.05, stretch: 1.0, color0: 0xffd36b, hdr0: 3, hdr1: 1.2, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.RING, count: 1, life: 0.3, dir: "none", speed: 0, height: 0.06, size0: 0.4, size1: 2.6, ground: true, color0: 0xffe7a0, hdr0: 2, alpha0: 0.9, alpha1: 0 },
  ],
  // Ranged shot leaving the barrel.
  muzzle: [
    { pool: "add", cell: CELL.FLARE, count: 1, life: 0.09, dir: "none", speed: 0, size0: 0.9, size1: 0.35, color0: 0xffb300, hdr0: 3.5, hdr1: 1.5, alpha0: 1, alpha1: 0, push: 1 },
    { pool: "add", cell: CELL.EMBER, count: 3, life: [0.15, 0.25], dir: "sphere", speed: [1.5, 3], drag: 4, size0: 0.12, size1: 0.04, color0: 0xffd36b, hdr0: 2.5, alpha0: 1, alpha1: 0 },
  ],
  // A skeleton falls apart.
  boneShards: [
    { pool: "alpha", cell: CELL.BONE, count: 6, life: [0.5, 0.65], dir: "up", spread: 1.1, speed: [2.2, 3.6], height: 0.4, gravity: 12, size0: [0.24, 0.32], size1: [0.2, 0.26], spin: [-14, 14], color0: 0xf5f2ea, color1: 0xd9d2c3, alpha0: 1, alpha1: 0.2 },
    { pool: "alpha", cell: SMOKE, count: 2, life: 0.45, dir: "up", spread: 1, speed: 0.6, height: 0.2, drag: 2, size0: 0.3, size1: 0.7, color0: 0xcfc7b8, alpha0: 0.6, alpha1: 0, push: 0.5, tint: false },
  ],
  // Hot embers thrown up from fire.
  embers: [
    { pool: "add", cell: CELL.EMBER, count: 12, life: [0.6, 1.1], dir: "up", spread: 1.2, speed: [2.5, 5.5], area: 0.4, height: 0.3, drag: 1.4, gravity: 3, size0: [0.12, 0.2], size1: 0.04, color0: 0xffb347, color1: 0xff3d00, hdr0: 3.2, hdr1: 1.4, alpha0: 1, alpha1: 0 },
  ],
  // Snowflakes drifting down over the area.
  snow: [
    { pool: "add", cell: CELL.SNOW, count: 22, life: [1.2, 1.9], delay: [0, 0.9], dir: "down", speed: [0.9, 1.5], area: 1, height: [1.6, 3.2], drag: 0.3, size0: [0.2, 0.32], size1: [0.14, 0.22], spin: [-2, 2], color0: 0xe3f6ff, hdr0: 1.25, alpha0: 0.95, alpha1: 0 },
  ],
  // Low freezing fog rolling out over the ground.
  "frost-mist": [
    { pool: "alpha", cell: SMOKE, count: 10, life: [1.1, 1.7], dir: "out", speed: [0.4, 0.9], vy: [0.05, 0.2], area: 0.75, height: 0.2, drag: 1.2, size0: [0.7, 0.9], size1: [1.5, 2.0], spin: [-0.4, 0.4], color0: 0xf0fbff, color1: 0xc7ecff, alpha0: 0.6, alpha1: 0, push: 0.35 },
  ],
  // Green plus signs floating up.
  "heal-plus": [
    { pool: "alpha", cell: CELL.PLUS, count: 14, life: [0.9, 1.3], delay: [0, 0.7], dir: "up", spread: 0.25, speed: [1.1, 1.8], area: 0.85, height: [0.1, 0.6], drag: 0.5, size0: [0.5, 0.62], size1: [0.34, 0.42], color0: 0x5dff8f, color1: 0x2fd46f, alpha0: 1, alpha1: 0, push: 1 },
    { pool: "add", cell: CELL.SOFT, count: 6, life: [0.7, 1], delay: [0, 0.6], dir: "up", spread: 0.3, speed: [1, 1.6], area: 0.8, height: [0.1, 0.5], size0: 0.7, size1: 0.3, color0: 0x7dffa8, hdr0: 1.6, alpha0: 0.6, alpha1: 0 },
  ],
  // Purple rage embers rising.
  "rage-ember": [
    { pool: "add", cell: CELL.EMBER, count: 10, life: [0.8, 1.3], dir: "up", spread: 0.3, speed: [0.9, 1.7], area: 0.9, height: [0, 0.4], drag: 0.6, size0: [0.22, 0.32], size1: 0.06, color0: 0xd36bff, color1: 0xff4db8, hdr0: 3, hdr1: 1.5, alpha0: 1, alpha1: 0 },
  ],
  // A flat ring snapping outward to 2 x radius.
  ring: [
    { pool: "add", cell: CELL.RING, count: 1, life: 0.3, dir: "none", speed: 0, height: 0.06, size0: 0.5, size1: 2, ground: true, color0: 0xffffff, hdr0: 1.6, alpha0: 0.95, alpha1: 0 },
  ],
  // Melee contact: a soft, quick ring (many land per second in a brawl).
  contact: [
    { pool: "add", cell: CELL.RING, count: 1, life: 0.24, dir: "none", speed: 0, height: 0.06, size0: 0.6, size1: 2, ground: true, color0: 0xffffff, hdr0: 1.15, alpha0: 0.7, alpha1: 0 },
  ],
  // Celebration confetti.
  confetti: [
    { pool: "alpha", cell: CELL.CONFETTI, count: 26, life: [1.4, 2.1], dir: "up", spread: 0.7, speed: [4.5, 7.5], area: 0.3, height: 0.5, drag: 1.4, gravity: 5, size0: [0.16, 0.22], size1: [0.14, 0.2], spin: [-14, 14], palette: [0xffd23f, 0xff5c8a, 0x4dd4ff, 0x7cff6b, 0xb98bff, 0xffffff], color0: 0xffffff, alpha0: 1, alpha1: 0.6, tint: false },
  ],
  // Heavy debris: chunky chips and a dust cloud.
  debris: [
    { pool: "alpha", cell: CELL.CHIP, count: 12, life: [0.6, 0.9], dir: "up", spread: 1.25, speed: [3.5, 6.5], area: 0.5, height: 0.3, gravity: 15, size0: [0.24, 0.36], size1: [0.2, 0.3], spin: [-10, 10], color0: 0x9d8b72, color1: 0x7a6b55, alpha0: 1, alpha1: 0.5 },
    { pool: "alpha", cell: SMOKE, count: 5, life: [0.7, 1], dir: "out", speed: [1.2, 2], vy: [0.3, 0.8], area: 0.4, height: 0.2, drag: 2.2, size0: [0.5, 0.7], size1: [1.2, 1.6], spin: [-0.6, 0.6], color0: 0xc9b99c, color1: 0xa8987d, alpha0: 0.8, alpha1: 0, push: 0.45, tint: false },
  ],

  // --- building blocks for the spell recipes and the legacy helpers ---

  // Point spark spray (emitSparks): soft hot dots under gravity.
  sparks: [
    { pool: "add", cell: CELL.EMBER, count: 6, life: [0.3, 0.5], dir: "up", spread: 1.4, speed: [2.5, 4], gravity: 7, size0: [0.18, 0.24], size1: 0.06, color0: 0xfff1c4, hdr0: 2.4, hdr1: 1.2, alpha0: 1, alpha1: 0 },
  ],
  // Impact flash quad.
  flash: [
    { pool: "add", cell: CELL.FLARE, count: 1, life: 0.2, dir: "none", speed: 0, height: 0.6, size0: 2.6, size1: 1.4, color0: 0xffd08a, hdr0: 3, hdr1: 1, alpha0: 1, alpha1: 0, push: 2 },
  ],
  // Ground shockwave to 2 x radius.
  shockwave: [
    { pool: "add", cell: CELL.RING, count: 1, life: 0.45, dir: "none", speed: 0, height: 0.07, size0: 0.4, size1: 2, ground: true, color0: 0xffc27a, hdr0: 3.2, hdr1: 2, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.SOFT, count: 1, life: 0.3, dir: "none", speed: 0, height: 0.05, size0: 1.2, size1: 2.2, ground: true, color0: 0xff9a40, hdr0: 1.4, alpha0: 0.6, alpha1: 0 },
  ],
  // Fireball billows: warm, then sooty.
  "fire-billow": [
    { pool: "alpha", cell: SMOKE, count: 7, life: [1, 1.4], dir: "out", speed: [1.6, 2.6], vy: [0.9, 1.7], area: 0.5, height: 0.4, drag: 2, gravity: -0.6, size0: [0.9, 1.1], size1: [2.1, 2.7], spin: [-0.7, 0.7], color0: 0xffc07a, color1: 0x6d635a, alpha0: 1, alpha1: 0, push: 0.45 },
  ],
  // Fire core of the blast (additive tongues).
  "fire-core": [
    { pool: "add", cell: CELL.FLAME, count: 8, life: [0.25, 0.4], dir: "up", spread: 0.9, speed: [1.5, 3], area: 0.35, height: 0.3, drag: 2.5, size0: [0.7, 0.9], size1: [0.3, 0.4], color0: 0xffc061, color1: 0xff4a12, hdr0: 3.2, hdr1: 1.6, alpha0: 1, alpha1: 0, push: 0.6 },
  ],
  // Electric crackle sparks.
  "zap-sparks": [
    { pool: "add", cell: CELL.STREAK, count: 14, life: [0.15, 0.3], dir: "sphere", speed: [5, 9], height: 0.3, area: 0.6, drag: 4, gravity: 4, size0: [0.09, 0.13], size1: 0.05, stretch: 0.8, color0: 0xd8f6ff, hdr0: 3, hdr1: 1.5, alpha0: 1, alpha1: 0 },
  ],
  // Electric ground ring.
  "zap-ring": [
    { pool: "add", cell: CELL.RING, count: 1, life: 0.36, dir: "none", speed: 0, height: 0.07, size0: 1.3, size1: 2, ground: true, color0: 0xfff38a, hdr0: 3.4, hdr1: 1.6, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.SOFT, count: 1, life: 0.22, dir: "none", speed: 0, height: 0.05, size0: 2.1, size1: 2.3, ground: true, color0: 0x4aa8ff, hdr0: 1.2, alpha0: 0.3, alpha1: 0 },
  ],
  // Arrow landing kick.
  "dust-kick": [
    { pool: "alpha", cell: SMOKE, count: 2, life: [0.4, 0.55], dir: "up", spread: 1.1, speed: [0.8, 1.4], height: 0.1, drag: 3, size0: 0.3, size1: [0.7, 0.85], spin: [-1, 1], color0: 0xb9a582, color1: 0xa18e6e, alpha0: 0.85, alpha1: 0, push: 0.5 },
    { pool: "add", cell: CELL.STREAK, count: 2, life: 0.18, dir: "up", spread: 0.8, speed: [2.5, 4], gravity: 10, size0: 0.07, size1: 0.03, stretch: 0.8, color0: 0xfff1c4, hdr0: 2, alpha0: 1, alpha1: 0 },
  ],
  // Tornado debris whipped around (the spiral is placed by the recipe).
  "tornado-dust": [
    { pool: "alpha", cell: SMOKE, count: 6, life: [0.7, 1], dir: "out", speed: [0.6, 1], vy: [1.2, 2], area: 0.9, edge: true, height: 0.2, drag: 1, size0: [0.5, 0.7], size1: [1, 1.3], spin: [-3, -1.5], color0: 0xb7c0cc, color1: 0x8d96a3, alpha0: 0.7, alpha1: 0, push: 0.4 },
  ],
  // Dark summoning disc for risers.
  portal: [
    { pool: "alpha", cell: CELL.SOFT, count: 1, life: 0.6, dir: "none", speed: 0, height: 0.04, size0: 0.6, size1: 1.5, ground: true, color0: 0x2e1a47, alpha0: 0.85, alpha1: 0, tint: false },
    { pool: "add", cell: CELL.RING, count: 1, life: 0.6, dir: "none", speed: 0, height: 0.06, size0: 0.8, size1: 1.9, ground: true, color0: 0x76ff03, hdr0: 2, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.EMBER, count: 6, life: [0.4, 0.6], dir: "up", spread: 0.3, speed: [1.2, 2], area: 0.45, edge: true, height: 0.05, size0: 0.16, size1: 0.05, color0: 0x76ff03, hdr0: 2.5, alpha0: 1, alpha1: 0 },
  ],
  // A broken war machine: streaky electric burst plus a flash.
  "spark-burst": [
    { pool: "add", cell: CELL.STREAK, count: 10, life: [0.3, 0.45], dir: "sphere", speed: [3.5, 6], height: 0.7, drag: 2.5, gravity: 6, size0: [0.1, 0.14], size1: 0.05, stretch: 0.9, color0: 0x8c7bff, hdr0: 2.8, hdr1: 1.2, alpha0: 1, alpha1: 0 },
    { pool: "add", cell: CELL.FLARE, count: 1, life: 0.16, dir: "none", speed: 0, height: 0.7, size0: 1.6, size1: 0.6, color0: 0x8c7bff, hdr0: 2.6, alpha0: 1, alpha1: 0, push: 1 },
    { pool: "add", cell: CELL.RING, count: 1, life: 0.3, dir: "none", speed: 0, height: 0.06, size0: 0.4, size1: 1.8, ground: true, color0: 0x8c7bff, hdr0: 2, alpha0: 0.9, alpha1: 0 },
  ],
  // A balloon envelope venting: torn scraps spiralling down plus a sigh of smoke.
  deflate: [
    { pool: "alpha", cell: CELL.PETAL, count: 7, life: [0.8, 1.1], dir: "out", speed: [1, 2], vy: [0.5, 1.5], height: 1.5, area: 0.3, drag: 1.5, gravity: 3, size0: [0.32, 0.42], size1: [0.24, 0.3], spin: [-9, 9], color0: 0xc62828, color1: 0x8e1c1c, alpha0: 1, alpha1: 0.3 },
    { pool: "alpha", cell: SMOKE, count: 4, life: [0.7, 0.9], dir: "up", spread: 0.8, speed: [0.5, 1], height: 1.4, area: 0.3, drag: 1.5, size0: 0.5, size1: 1.2, color0: 0xd8cbb5, alpha0: 0.7, alpha1: 0, push: 0.5, tint: false },
  ],
  // Angry steam venting from a waking king.
  steam: [
    { pool: "alpha", cell: SMOKE, count: 6, life: [0.6, 0.8], delay: [0, 0.3], dir: "up", spread: 0.5, speed: [1.4, 2.2], area: 0.7, edge: true, height: 2.6, drag: 1.2, size0: [0.35, 0.45], size1: [0.9, 1.2], spin: [-1, 1], color0: 0xffb0a8, color1: 0xff8a80, alpha0: 0.85, alpha1: 0, push: 0.5 },
  ],
};

const TMP = new THREE.Color();

function pick(r: Range, rand: () => number): number {
  return typeof r === "number" ? r : r[0] + (r[1] - r[0]) * rand();
}

/** Every preset name (fx tests check them all). */
export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS);

const SPEC = clearSpec({} as ParticleSpec);

/**
 * Emit preset `name` at world point (wx, wy, wz). Returns false for an
 * unknown name (callers fall back to something generic).
 */
export function emitPreset(sp: Spawner, name: string, wx: number, wy: number, wz: number, opts?: EmitOpts): boolean {
  const layers = PRESETS[name];
  if (!layers) return false;
  const R = opts?.radius ?? 1;
  const countK = opts?.count !== undefined && layers[0].count > 0 ? opts.count / layers[0].count : 1;
  const q = sp.scale();
  const rand = (): number => sp.rand();
  for (const L of layers) {
    // Quality and the caller's count scale everything, but a layer that
    // exists keeps at least one particle (a lone flash or ring).
    const n = Math.max(1, Math.round(L.count * countK * q));
    const k = L.scales === false ? 1 : R;
    const tinted = opts?.color !== undefined && L.tint !== false;
    for (let i = 0; i < n; i++) {
      const s = clearSpec(SPEC);
      // Spawn position.
      const area = (L.area ?? 0) * k;
      const pa = rand() * Math.PI * 2;
      const pr = L.edge ? area : Math.sqrt(rand()) * area;
      s.x = wx + Math.cos(pa) * pr;
      s.z = wz + Math.sin(pa) * pr;
      s.y = wy + (L.height === undefined ? 0 : pick(L.height, rand));
      // Launch velocity.
      const sp0 = pick(L.speed, rand) * (L.scales === false ? 1 : Math.sqrt(k));
      if (L.dir === "up") {
        const th = rand() * Math.PI * 2;
        const ph = rand() * (L.spread ?? 0.5);
        s.vx = Math.sin(ph) * Math.cos(th) * sp0;
        s.vz = Math.sin(ph) * Math.sin(th) * sp0;
        s.vy = Math.cos(ph) * sp0;
      } else if (L.dir === "sphere") {
        const th = rand() * Math.PI * 2;
        const u = rand() * 2 - 1;
        const h = Math.sqrt(1 - u * u);
        s.vx = h * Math.cos(th) * sp0;
        s.vz = h * Math.sin(th) * sp0;
        s.vy = Math.abs(u) * sp0 * 0.9 + 0.1 * sp0; // bias upward: sparks fly, not dig
      } else if (L.dir === "out") {
        // Outward from the emit point (or a random heading at the centre).
        const ox = s.x - wx;
        const oz = s.z - wz;
        const d = Math.hypot(ox, oz);
        const hx = d > 1e-3 ? ox / d : Math.cos(pa);
        const hz = d > 1e-3 ? oz / d : Math.sin(pa);
        s.vx = hx * sp0;
        s.vz = hz * sp0;
      } else if (L.dir === "down") {
        s.vy = -sp0;
      }
      if (L.vy !== undefined) s.vy += pick(L.vy, rand);
      s.gravity = L.gravity ?? 0;
      s.drag = L.drag ?? 0;
      s.delay = (opts?.delay ?? 0) + (L.delay === undefined ? 0 : pick(L.delay, rand));
      s.life = pick(L.life, rand);
      s.size0 = pick(L.size0, rand) * k;
      s.size1 = pick(L.size1, rand) * k;
      s.rot = rand() * Math.PI * 2;
      s.spin = L.spin === undefined ? 0 : pick(L.spin, rand);
      // Colours: linear, scaled into HDR by hdr0/hdr1.
      const c0 = L.palette ? L.palette[Math.floor(rand() * L.palette.length)] : tinted ? opts!.color! : L.color0;
      const c1 = L.palette ? c0 : tinted ? opts!.color! : (L.color1 ?? L.color0);
      const h0 = L.hdr0 ?? 1;
      const h1 = L.hdr1 ?? h0;
      TMP.setHex(c0);
      s.r0 = TMP.r * h0;
      s.g0 = TMP.g * h0;
      s.b0 = TMP.b * h0;
      TMP.setHex(c1);
      s.r1 = TMP.r * h1;
      s.g1 = TMP.g * h1;
      s.b1 = TMP.b * h1;
      s.a0 = L.alpha0 ?? 1;
      s.a1 = L.alpha1 ?? 0;
      const cells = L.cell;
      s.cell = typeof cells === "number" ? cells : cells[Math.floor(rand() * cells.length)];
      s.stretch = L.stretch ?? 0;
      s.mode = L.ground ? MODE_GROUND : MODE_BILLBOARD;
      s.push = L.push ?? 0;
      sp.spawn(L.pool, s);
    }
  }
  return true;
}
