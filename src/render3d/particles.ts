/**
 * Pure particle core shared by the GPU pools in scene/fx: the ring-buffer
 * slot allocator, the per-particle record the CPU writes on emit, a CPU
 * mirror of the motion the vertex shader evaluates (so the maths is unit
 * tested), and a tiny seeded RNG. No Three.js here.
 *
 * Particles are fire-and-forget: the CPU writes one record when a particle
 * is born and the shader derives everything else from `uTime`, so there is
 * no per-frame CPU work and nothing to allocate.
 */

/** Camera-facing quad (the default). */
export const MODE_BILLBOARD = 0;
/** Flat on the ground plane (shockwaves, ground rings). */
export const MODE_GROUND = 1;
/**
 * A static camera-facing segment: the particle sits still at its position
 * and its velocity is the segment vector (lightning bolt ribbons).
 */
export const MODE_SEGMENT = 2;

/** Everything one particle needs; the CPU writes this once, on emit. */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Downward acceleration (negative floats upward). */
  gravity: number;
  /** Linear drag coefficient (1/s); 0 = none. */
  drag: number;
  /** Seconds before the particle appears. */
  delay: number;
  life: number;
  size0: number;
  size1: number;
  rot: number;
  spin: number;
  /** Start colour, linear RGB (HDR allowed) and alpha. */
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  /** End colour. */
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  /** Atlas cell index. */
  cell: number;
  /** >0 stretches the quad along its screen-space velocity. */
  stretch: number;
  mode: number;
  /** Depth nudge toward the camera, in sizes (keeps billboards off the ground). */
  push: number;
}

export function blankSpec(): ParticleSpec {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, delay: 0, life: 1,
    size0: 1, size1: 1, rot: 0, spin: 0,
    r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0,
    cell: 0, stretch: 0, mode: MODE_BILLBOARD, push: 0,
  };
}

/** Reset a reused spec in place (no allocation). */
export function clearSpec(s: ParticleSpec): ParticleSpec {
  s.x = s.y = s.z = s.vx = s.vy = s.vz = 0;
  s.gravity = s.drag = s.delay = 0;
  s.life = 1;
  s.size0 = s.size1 = 1;
  s.rot = s.spin = 0;
  s.r0 = s.g0 = s.b0 = s.a0 = 1;
  s.r1 = s.g1 = s.b1 = 1;
  s.a1 = 0;
  s.cell = 0;
  s.stretch = 0;
  s.mode = MODE_BILLBOARD;
  s.push = 0;
  return s;
}

/**
 * Fixed-capacity ring of slots. alloc() always succeeds: once the ring is
 * full it overwrites the oldest slot, so the pool never grows. It also
 * tracks which slots were written since the last flush, as at most two
 * contiguous ranges, for BufferAttribute.addUpdateRange.
 */
export class Ring {
  /** Slots in use: the allocated capacity times the current scale. */
  private capNow: number;
  private head = 0;
  private total = 0;
  private pending = 0;
  private flushStart = 0;

  constructor(readonly capacity: number) {
    this.capNow = capacity;
  }

  get cap(): number {
    return this.capNow;
  }

  /** Slots that may hold a live particle (never above the cap). */
  get count(): number {
    return Math.min(this.total, this.capNow);
  }

  /** Shrink or restore the working cap (quality scaling); never above capacity. */
  setCap(n: number): void {
    const next = Math.max(1, Math.min(this.capacity, Math.floor(n)));
    if (next === this.capNow) return;
    this.capNow = next;
    this.head %= next;
    this.total = Math.min(this.total, next);
    this.flushStart = this.head;
    this.pending = next; // everything may need re-uploading
  }

  alloc(): number {
    const i = this.head;
    this.head = (this.head + 1) % this.capNow;
    this.total++;
    if (this.pending < this.capNow) this.pending++;
    return i;
  }

  /**
   * Slot ranges written since the last flush as [start, count] pairs (zero,
   * one or two of them), then start a new batch. `out` is reused.
   */
  flush(out: number[]): number[] {
    out.length = 0;
    const n = this.pending;
    if (n > 0) {
      if (n >= this.capNow) {
        out.push(0, this.capNow);
      } else {
        const start = this.flushStart;
        const first = Math.min(n, this.capNow - start);
        out.push(start, first);
        if (n > first) out.push(0, n - first);
      }
    }
    this.pending = 0;
    this.flushStart = this.head;
    return out;
  }

  reset(): void {
    this.head = 0;
    this.total = 0;
    this.pending = 0;
    this.flushStart = 0;
  }
}

/** Distance factor of linear drag after `age` s: ∫e^(-k t)dt. */
export function dragTravel(drag: number, age: number): number {
  return drag > 1e-4 ? (1 - Math.exp(-drag * age)) / drag : age;
}

/** The ease the shader applies to size: fast start, soft landing. */
export function sizeEase(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export interface ParticleSample {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
}

/**
 * CPU mirror of the vertex shader: where particle `s`, born at `birth`
 * (pool seconds), is at pool time `now`. Used by tests and nothing else.
 */
export function sampleParticle(s: ParticleSpec, birth: number, now: number, out: ParticleSample): ParticleSample {
  const age = now - birth;
  out.alive = age >= 0 && age <= s.life;
  const t = Math.max(0, Math.min(1, age / s.life));
  const a = Math.max(0, age);
  const k = dragTravel(s.drag, a);
  out.x = s.x + s.vx * k;
  out.y = s.y + s.vy * k - 0.5 * s.gravity * a * a;
  out.z = s.z + s.vz * k;
  out.size = s.size0 + (s.size1 - s.size0) * sizeEase(t);
  out.alpha = (s.a0 + (s.a1 - s.a0) * t) * Math.min(1, t / 0.04);
  return out;
}

/** Small, fast, seedable PRNG (mulberry32); render-only randomness. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer seed from an arena point (same cast, same bolt shape). */
export function seedFrom(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 100) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 100) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}
