/**
 * A fixed-capacity particle pool — pure math, no Three.js. The renderer
 * mirrors the live particles into an InstancedMesh each frame; keeping the
 * motion here makes it unit-testable and allocation-free (slots are reused).
 */
export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds of life remaining. */
  life: number;
  /** Lifetime it started with (for fade fraction). */
  life0: number;
  size: number;
  color: number;
  active: boolean;
}

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  /** How many particles to spawn (capped by free slots). */
  count: number;
  /** Launch speed in world units per second. */
  speed: number;
  /** Cone half-angle (radians) around straight up; bigger = wider spray. */
  spread: number;
  life: number;
  size: number;
  color: number;
  /** Injectable RNG for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

function blank(): Particle {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, life0: 1, size: 0, color: 0xffffff, active: false };
}

export class ParticleField {
  readonly particles: Particle[];

  constructor(capacity: number) {
    this.particles = Array.from({ length: capacity }, blank);
  }

  get liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    return n;
  }

  /** Spawn a burst from (x,y,z), reusing dead slots; extras are dropped. */
  emit(opts: EmitOptions): void {
    const rng = opts.rng ?? Math.random;
    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= opts.count) break;
      if (p.active) continue;
      const theta = rng() * Math.PI * 2;
      const phi = rng() * opts.spread;
      const up = Math.cos(phi);
      const out = Math.sin(phi);
      p.x = opts.x;
      p.y = opts.y;
      p.z = opts.z;
      p.vx = out * Math.cos(theta) * opts.speed;
      p.vy = up * opts.speed; // mostly upward, spread tilts it out
      p.vz = out * Math.sin(theta) * opts.speed;
      p.life = opts.life;
      p.life0 = opts.life;
      p.size = opts.size;
      p.color = opts.color;
      p.active = true;
      spawned++;
    }
  }

  /** Advance every live particle: move, fall under gravity, age out. */
  update(dt: number, gravity: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= gravity * dt;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }
}
