/**
 * Seeded, stateless noise for render-only variety (blink timing, shard
 * scatter). Integer hashing keeps results identical across runs and
 * devices, and never touches Math.random.
 */

/** A well-mixed 32-bit hash of two integers. */
export function hash32(seed: number, n: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((n | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform in [0, 1) for (seed, n). */
export function hash01(seed: number, n: number): number {
  return hash32(seed, n) / 4294967296;
}

/** Uniform in [-1, 1) for (seed, n). */
export function hashSigned(seed: number, n: number): number {
  return hash01(seed, n) * 2 - 1;
}
