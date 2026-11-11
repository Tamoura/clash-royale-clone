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
  { name: "upper", x: 0, y: 2.1, z: 0, restY: 0.6 },
  { name: "front", x: 0, y: 3.4, z: 1.1, restY: 0.3 },
  { name: "back", x: 0, y: 3.4, z: -1.1, restY: 0.3 },
  { name: "canopy", x: 0, y: 5.1, z: -0.45, restY: 0.3 },
  { name: "crew", x: 0, y: 3.6, z: -0.23, restY: 0.4 },
];

describe("tower collapse plan", () => {
  it("is seeded: the same tower always falls the same way, another tower differently", () => {
    expect(planCollapse(7, KING)).toEqual(planCollapse(7, KING));
    expect(planCollapse(7, KING)).not.toEqual(planCollapse(8, KING));
  });

  it("splits a tower into at most four keep chunks plus its crew; the base never flies", () => {
    expect(CHUNK_ORDER.filter((n) => n !== "crew")).toHaveLength(4);
    expect(CHUNK_ORDER).not.toContain("base" as never);
    expect(planCollapse(1, KING.filter((c) => c.name !== "canopy"))).toHaveLength(4); // a princess: 3 chunks + crew
  });

  it("launches the canopy first and the upper keep last, 60 ms apart", () => {
    const plan = planCollapse(3, KING);
    const launch = (n: string) => plan.find((m) => m.name === n)!.launch;
    expect(launch("canopy")).toBe(0);
    expect(launch("upper")).toBeCloseTo((CHUNK_ORDER.length - 1) * COLLAPSE_STAGGER);
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
    const m = planCollapse(5, KING).find((c) => c.name === "front")!;
    expect(chunkPose(m, m.launch - 0.01)).toMatchObject({ x: m.x, y: m.y, z: m.z, rx: 0, landed: false });
  });

  it("is airborne shortly after launch and follows gravity 18", () => {
    const m = planCollapse(9, KING).find((c) => c.name === "front")!;
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
