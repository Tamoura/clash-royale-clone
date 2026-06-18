import { describe, expect, it } from "vitest";
import { ParticleField } from "./particles";

// Deterministic "random" so emitted directions are stable in tests.
const half = () => 0.5;

describe("pooled particle field", () => {
  it("emits live particles up to the requested count", () => {
    const f = new ParticleField(50);
    f.emit({ x: 0, y: 0, z: 0, count: 8, speed: 3, spread: 1, life: 1, size: 0.1, color: 0xffffff, rng: half });
    expect(f.liveCount).toBe(8);
  });

  it("never exceeds its capacity", () => {
    const f = new ParticleField(3);
    f.emit({ x: 0, y: 0, z: 0, count: 10, speed: 3, spread: 1, life: 1, size: 0.1, color: 0xffffff, rng: half });
    expect(f.liveCount).toBe(3);
  });

  it("particles expire after their lifetime", () => {
    const f = new ParticleField(10);
    f.emit({ x: 0, y: 0, z: 0, count: 5, speed: 3, spread: 1, life: 0.5, size: 0.1, color: 0xffffff, rng: half });
    f.update(0.6, 0);
    expect(f.liveCount).toBe(0);
  });

  it("moves particles and pulls them down with gravity", () => {
    const f = new ParticleField(10);
    f.emit({ x: 0, y: 0, z: 0, count: 1, speed: 4, spread: 0.2, life: 1, size: 0.1, color: 0xffffff, rng: half });
    const p = f.particles.find((q) => q.active)!;
    const startY = p.y;
    const startVy = p.vy;
    expect(startVy).toBeGreaterThan(0); // launched upward
    f.update(0.1, 20);
    expect(p.y).toBeGreaterThan(startY); // it moved
    expect(p.vy).toBeLessThan(startVy); // gravity decelerated it
    expect(p.life).toBeLessThan(p.life0); // aging
  });

  it("reuses dead slots on the next emit", () => {
    const f = new ParticleField(2);
    f.emit({ x: 0, y: 0, z: 0, count: 2, speed: 3, spread: 1, life: 0.2, size: 0.1, color: 0xffffff, rng: half });
    f.update(0.3, 0); // all expire
    expect(f.liveCount).toBe(0);
    f.emit({ x: 0, y: 0, z: 0, count: 2, speed: 3, spread: 1, life: 1, size: 0.1, color: 0xffffff, rng: half });
    expect(f.liveCount).toBe(2); // recycled, not overflowed
  });
});
