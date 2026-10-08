import { describe, expect, it } from "vitest";
import { Ring, blankSpec, clearSpec, makeRng, sampleParticle, seedFrom, sizeEase, type ParticleSample } from "./particles";

const sample = (): ParticleSample => ({ alive: false, x: 0, y: 0, z: 0, size: 0, alpha: 0 });

describe("particle ring buffer", () => {
  it("hands out slots in order and wraps without growing", () => {
    const r = new Ring(4);
    const slots = Array.from({ length: 10 }, () => r.alloc());
    expect(slots).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    expect(r.count).toBe(4);
  });

  it("reports what was written as at most two update ranges", () => {
    const r = new Ring(8);
    const out: number[] = [];
    for (let i = 0; i < 6; i++) r.alloc();
    expect(r.flush(out)).toEqual([0, 6]);
    for (let i = 0; i < 4; i++) r.alloc(); // slots 6, 7, 0, 1
    expect(r.flush(out)).toEqual([6, 2, 0, 2]);
    expect(r.flush(out)).toEqual([]);
    for (let i = 0; i < 20; i++) r.alloc(); // more than a lap
    expect(r.flush(out)).toEqual([0, 8]);
  });

  it("a scaled-down cap keeps slots inside it", () => {
    const r = new Ring(100);
    r.setCap(10);
    for (let i = 0; i < 50; i++) expect(r.alloc()).toBeLessThan(10);
    expect(r.count).toBe(10);
    r.setCap(1000); // never above the allocated capacity
    expect(r.cap).toBe(100);
  });
});

describe("particle motion model", () => {
  it("moves along its velocity and falls under gravity", () => {
    const s = clearSpec(blankSpec());
    s.vx = 2;
    s.vy = 4;
    s.gravity = 10;
    s.life = 2;
    const p = sampleParticle(s, 0, 0.5, sample());
    expect(p.alive).toBe(true);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(4 * 0.5 - 0.5 * 10 * 0.25);
  });

  it("drag bleeds speed off so the particle settles", () => {
    const s = clearSpec(blankSpec());
    s.vx = 10;
    s.drag = 4;
    s.life = 10;
    const a = sampleParticle(s, 0, 1, sample()).x;
    const b = sampleParticle(s, 0, 5, sample()).x;
    expect(a).toBeLessThan(10);
    expect(b - a).toBeLessThan(0.5);
    expect(b).toBeCloseTo(10 / 4, 1);
  });

  it("is hidden before its delay and after its life", () => {
    const s = clearSpec(blankSpec());
    s.life = 1;
    expect(sampleParticle(s, 2, 1.5, sample()).alive).toBe(false);
    expect(sampleParticle(s, 2, 2.5, sample()).alive).toBe(true);
    expect(sampleParticle(s, 2, 3.5, sample()).alive).toBe(false);
  });

  it("eases size from size0 to size1 and fades alpha", () => {
    const s = clearSpec(blankSpec());
    s.size0 = 1;
    s.size1 = 3;
    s.a0 = 1;
    s.a1 = 0;
    expect(sizeEase(0)).toBe(0);
    expect(sizeEase(1)).toBe(1);
    const end = sampleParticle(s, 0, 1, sample());
    expect(end.size).toBeCloseTo(3);
    expect(end.alpha).toBeCloseTo(0);
  });
});

describe("render RNG", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(seedFrom(9, 16)).toBe(seedFrom(9, 16));
    expect(seedFrom(9, 16)).not.toBe(seedFrom(9.5, 16));
  });
});
