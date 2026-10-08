/**
 * A fallen crown tower comes apart: its chunks (battlements, flag, crew,
 * walls, roof) are flung off one after another and tumble ballistically to
 * the ground, bounce once or twice, and settle before the remains sink.
 *
 * Pure and render-only: the plan is seeded from the tower's entity id with
 * its own small RNG (never the sim's), and a chunk's pose is a closed-form
 * function of time, so any frame rate (or a hitch) gives the same motion.
 */

/** Downward acceleration, units/s². */
export const COLLAPSE_GRAVITY = 18;
/** Share of the vertical speed a chunk keeps when it hits the floor. */
export const COLLAPSE_BOUNCE = 0.3;
/** Delay between consecutive chunks leaving the tower, seconds. */
export const COLLAPSE_STAGGER = 0.06;
/** Length of the debris phase; the remains then sink for SINK_TIME. */
export const COLLAPSE_TIME = 1.2;
export const SINK_TIME = 0.6;

/** Launch order: the battlements go first, the roof last. */
export const CHUNK_ORDER = ["battlement", "flag", "defenderMount", "wall", "roof"] as const;
export type ChunkName = (typeof CHUNK_ORDER)[number];

/** Bounces slower than this (units/s) just stop. */
const SETTLE_SPEED = 0.6;
/** Horizontal speed and spin kept through each bounce. */
const BOUNCE_FRICTION = 0.5;

export interface ChunkStart {
  name: ChunkName;
  /** The chunk's centre, in the tower's local space. */
  x: number;
  y: number;
  z: number;
  /** Height of the centre above the floor once the chunk lies on the ground. */
  restY: number;
}

export interface ChunkMotion extends ChunkStart {
  /** Seconds after the collapse starts that this chunk leaves the tower. */
  launch: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin, rad/s about x, y, z. */
  wx: number;
  wy: number;
  wz: number;
}

export interface ChunkPose {
  x: number;
  y: number;
  z: number;
  /** Rotation (rad) added to the chunk's resting rotation. */
  rx: number;
  ry: number;
  rz: number;
  /** Has touched the floor at least once. */
  landed: boolean;
  /** Lies still. */
  resting: boolean;
}

/** mulberry32: a tiny seeded PRNG in [0, 1) for render-only variety. */
export function seededRandom(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How hard each kind of chunk is thrown: [upward min, max], [outward min, max], max spin. */
const THROW: Record<ChunkName, { up: [number, number]; out: [number, number]; spin: number }> = {
  battlement: { up: [2.5, 4], out: [1.8, 3.2], spin: 6 },
  flag: { up: [3.5, 5], out: [1.5, 2.5], spin: 9 },
  defenderMount: { up: [4.5, 5.5], out: [1, 2], spin: 7 },
  wall: { up: [0.5, 1.2], out: [0.6, 1.2], spin: 1.4 },
  roof: { up: [1, 2], out: [1.6, 2.6], spin: 4 },
};

/**
 * The throw for each chunk, seeded by the tower's entity id. Chunks fly
 * away from the tower's centre (each in its own direction around it) with
 * a little upward kick, in CHUNK_ORDER with COLLAPSE_STAGGER between them.
 */
export function planCollapse(seed: number, chunks: readonly ChunkStart[]): ChunkMotion[] {
  const rand = seededRandom(seed);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
  const spin = (max: number): number => (rand() < 0.5 ? -1 : 1) * between(max * 0.4, max);
  const base = rand() * Math.PI * 2;
  return chunks.map((c) => {
    const order = CHUNK_ORDER.indexOf(c.name);
    const t = THROW[c.name];
    // Spread the chunks around the compass, nudged off their own offset.
    const off = Math.hypot(c.x, c.z);
    const dir = off > 0.25 ? Math.atan2(c.z, c.x) + between(-0.5, 0.5) : base + order * 2.4 + between(-0.4, 0.4);
    const out = between(t.out[0], t.out[1]);
    return {
      ...c,
      launch: Math.max(0, order) * COLLAPSE_STAGGER,
      vx: Math.cos(dir) * out,
      vy: between(t.up[0], t.up[1]),
      vz: Math.sin(dir) * out,
      wx: spin(t.spin),
      wy: spin(t.spin * 0.5),
      wz: spin(t.spin),
    };
  });
}

/** The chunk's pose `t` seconds after the collapse started. */
export function chunkPose(m: ChunkMotion, t: number): ChunkPose {
  const g = COLLAPSE_GRAVITY;
  let tau = t - m.launch;
  if (tau <= 0) return { x: m.x, y: m.y, z: m.z, rx: 0, ry: 0, rz: 0, landed: false, resting: false };
  let x = m.x;
  let y = m.y;
  let z = m.z;
  let vx = m.vx;
  let vy = m.vy;
  let vz = m.vz;
  let spin = 1;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  let landed = false;
  // Arc by arc: fly until the centre meets restY, bounce, repeat.
  for (let arc = 0; arc < 6; arc++) {
    const drop = Math.max(0, y - m.restY);
    const hit = (vy + Math.sqrt(vy * vy + 2 * g * drop)) / g; // time to the floor
    const dt = Math.min(tau, hit);
    x += vx * dt;
    z += vz * dt;
    y += vy * dt - 0.5 * g * dt * dt;
    rx += m.wx * spin * dt;
    ry += m.wy * spin * dt;
    rz += m.wz * spin * dt;
    if (tau < hit) return { x, y, z, rx, ry, rz, landed, resting: false };
    tau -= hit;
    landed = true;
    y = m.restY;
    const impact = vy - g * hit; // negative: falling
    vy = -impact * COLLAPSE_BOUNCE;
    vx *= BOUNCE_FRICTION;
    vz *= BOUNCE_FRICTION;
    spin *= BOUNCE_FRICTION;
    if (vy < SETTLE_SPEED) break;
  }
  return { x, y: m.restY, z, rx, ry, rz, landed: true, resting: true };
}

/** Seconds after the collapse starts when every chunk lies still. */
export function settleTime(plan: readonly ChunkMotion[]): number {
  let latest = 0;
  for (const m of plan) {
    // Step until resting; poses are closed-form, so a coarse search is exact enough.
    let t = m.launch;
    while (!chunkPose(m, t).resting && t < 10) t += 1 / 120;
    latest = Math.max(latest, t);
  }
  return latest;
}
