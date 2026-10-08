import { describe, expect, it } from "vitest";
import {
  CHUNK_ORDER,
  COLLAPSE_BOUNCE,
  COLLAPSE_GRAVITY,
  COLLAPSE_STAGGER,
  COLLAPSE_TIME,
  SINK_TIME,
  chunkPose,
  planCollapse,
  seededRandom,
  settleTime,
  type ChunkStart,
} from "./towerCollapse";

/** Chunk centres roughly as a king tower lays them out (local units). */
const KING: ChunkStart[] = [
  { name: "wall", x: 0, y: 1.2, z: 0, restY: 0.6 },
  { name: "battlement", x: 0, y: 2.55, z: 0, restY: 0.2 },
  { name: "roof", x: 0, y: 2.9, z: -0.3, restY: 0.3 },
  { name: "flag", x: -0.77, y: 2.85, z: 0, restY: 0.05 },
  { name: "defenderMount", x: 0, y: 3.2, z: 0, restY: 0.4 },
];

describe("tower collapse plan", () => {
  it("is seeded: the same tower always falls the same way, another tower differently", () => {
    expect(planCollapse(7, KING)).toEqual(planCollapse(7, KING));
    expect(planCollapse(7, KING)).not.toEqual(planCollapse(8, KING));
  });

  it("launches battlements first and the roof last, 60 ms apart", () => {
    const plan = planCollapse(3, KING);
    const launch = (n: string) => plan.find((m) => m.name === n)!.launch;
    expect(launch("battlement")).toBe(0);
    expect(launch("roof")).toBeCloseTo((CHUNK_ORDER.length - 1) * COLLAPSE_STAGGER);
    expect(COLLAPSE_STAGGER).toBeCloseTo(0.06);
    const sorted = [...plan].sort((a, b) => a.launch - b.launch).map((m) => m.name);
    expect(sorted).toEqual([...CHUNK_ORDER]);
  });

  it("throws every chunk up and outward", () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const m of planCollapse(seed, KING)) {
        expect(m.vy).toBeGreaterThan(0);
        expect(Math.hypot(m.vx, m.vz)).toBeGreaterThan(0.5);
      }
    }
  });

  it("uses its own RNG (the sim's is never touched)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("chunk motion", () => {
  it("holds still until its launch", () => {
    const m = planCollapse(5, KING).find((c) => c.name === "roof")!;
    expect(chunkPose(m, m.launch - 0.01)).toMatchObject({ x: m.x, y: m.y, z: m.z, rx: 0, landed: false });
  });

  it("is airborne shortly after launch and follows gravity 18", () => {
    const m = planCollapse(9, KING).find((c) => c.name === "battlement")!;
    const t = 0.1;
    const p = chunkPose(m, m.launch + t);
    expect(p.landed).toBe(false);
    expect(p.y).toBeCloseTo(m.y + m.vy * t - 0.5 * COLLAPSE_GRAVITY * t * t, 6);
    expect(p.x).toBeCloseTo(m.x + m.vx * t, 6);
  });

  it("never sinks through the floor and bounces with 0.3 of its speed", () => {
    for (let seed = 1; seed < 12; seed++) {
      for (const m of planCollapse(seed, KING)) {
        for (let t = 0; t < 2; t += 1 / 120) {
          expect(chunkPose(m, t).y).toBeGreaterThanOrEqual(m.restY - 1e-9);
        }
        // First impact speed, then the bounce apex it allows.
        const g = COLLAPSE_GRAVITY;
        const impact = Math.sqrt(m.vy * m.vy + 2 * g * (m.y - m.restY));
        const hit = (m.vy + impact) / g;
        const rebound = impact * COLLAPSE_BOUNCE;
        const apex = chunkPose(m, m.launch + hit + rebound / g);
        expect(apex.y - m.restY).toBeCloseTo((rebound * rebound) / (2 * g), 5);
      }
    }
  });

  it("has every chunk on the ground within the 1.2 s collapse and still before the sink ends", () => {
    for (let seed = 1; seed < 60; seed++) {
      const plan = planCollapse(seed, KING);
      for (const m of plan) expect(chunkPose(m, COLLAPSE_TIME).landed).toBe(true);
      expect(settleTime(plan)).toBeLessThanOrEqual(COLLAPSE_TIME + SINK_TIME);
    }
  });

  it("keeps the debris near the tower", () => {
    for (let seed = 1; seed < 30; seed++) {
      for (const m of planCollapse(seed, KING)) {
        const p = chunkPose(m, 5);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(5);
        expect(p.resting).toBe(true);
      }
    }
  });

  it("does not depend on the frame rate", () => {
    const m = planCollapse(11, KING)[2];
    // A pose is a function of time alone: sampling it at 30 Hz or 144 Hz
    // passes through the very same states.
    expect(chunkPose(m, 0.5)).toEqual(chunkPose(m, 0.5));
    const a = chunkPose(m, 0.75);
    for (let t = 0; t < 0.75; t += 1 / 144) chunkPose(m, t);
    expect(chunkPose(m, 0.75)).toEqual(a);
  });
});
