import { describe, expect, it } from "vitest";
import {
  MIN_RENDER_SCALE,
  QUALITY_LEVELS,
  QualityGovernor,
  SETTLE,
  WARMUP,
  WINDOW,
  currentQuality,
  outlinesEnabled,
  particleScale,
  qualityPinFromUrl,
} from "./quality";

/** Run `seconds` of frames whose duration depends on the current level. */
function run(gov: QualityGovernor, frameAt: (level: number) => number, seconds: number): void {
  for (let t = 0; t < seconds; ) {
    const dt = frameAt(gov.index);
    gov.sample(dt);
    t += dt;
  }
}

describe("quality ladder", () => {
  it("has five levels that only ever get cheaper", () => {
    expect(QUALITY_LEVELS).toHaveLength(5);
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const a = QUALITY_LEVELS[i - 1];
      const b = QUALITY_LEVELS[i];
      expect(b.dprCap).toBeLessThanOrEqual(a.dprCap);
      expect(b.pixelBudget).toBeLessThanOrEqual(a.pixelBudget);
      expect(b.minScale).toBeLessThanOrEqual(a.minScale);
      expect(b.minScale).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
      expect(b.bloom).toBeLessThanOrEqual(a.bloom);
      expect(b.shadowSize).toBeLessThanOrEqual(a.shadowSize);
      expect(b.particles).toBeLessThanOrEqual(a.particles);
      expect(Number(b.fxaa)).toBeLessThanOrEqual(Number(a.fxaa));
      expect(Number(b.outlines)).toBeLessThanOrEqual(Number(a.outlines));
      expect(Number(b.rimLight)).toBeLessThanOrEqual(Number(a.rimLight));
      // Every step must actually cut something.
      expect(b).not.toEqual(a);
    }
  });

  it("matches the documented levels", () => {
    const [l0, l1, l2, l3, l4] = QUALITY_LEVELS;
    expect(l0).toEqual({
      dprCap: 2,
      pixelBudget: 2.2e6,
      minScale: 1,
      bloom: 1,
      shadowSize: 2048,
      fxaa: true,
      particles: 1,
      outlines: true,
      rimLight: true,
    });
    expect(l1).toMatchObject({ dprCap: 2, pixelBudget: 1.7e6, minScale: 0.9, bloom: 0.5, shadowSize: 1024 });
    expect(l2).toMatchObject({ dprCap: 1.75, pixelBudget: 1.3e6, minScale: 0.8, bloom: 0, particles: 0.75 });
    expect(l3).toMatchObject({ dprCap: 1.5, pixelBudget: 1e6, minScale: 0.75, shadowSize: 512, particles: 0.5 });
    expect(l4).toEqual({
      dprCap: 1.25,
      pixelBudget: 0.75e6,
      minScale: 0.7,
      bloom: 0,
      shadowSize: 0,
      fxaa: false,
      particles: 0.35,
      outlines: false,
      rimLight: false,
    });
  });
});

/** Frame time rounded up to whole 60 Hz refreshes, as vsync presents it. */
const vsync = (s: number): number => Math.ceil(s * 60 - 1e-9) / 60;

/** The levels a governor passes through (and when) over `seconds` of frames. */
function trace(gov: QualityGovernor, frameAt: (level: number) => number, seconds: number): { at: number; to: number }[] {
  const steps: { at: number; to: number }[] = [];
  for (let t = 0; t < seconds; ) {
    const dt = frameAt(gov.index);
    if (gov.sample(dt)) steps.push({ at: t, to: gov.index });
    t += dt;
  }
  return steps;
}

describe("adaptive quality governor", () => {
  it("holds full quality on a device that keeps 60 fps", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 60, 60);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]);
  });

  it("walks down in order while slow and stops at the first fast-enough level", () => {
    // GPU-bound: every step buys frame time; L3 is the first under 1/45 s.
    const cost = [1 / 30, 1 / 36, 1 / 42, 1 / 52, 1 / 65];
    const gov = new QualityGovernor();
    run(gov, (i) => cost[i], WARMUP + WINDOW + 0.1);
    expect(gov.index).toBe(1);
    expect(gov.level.dprCap).toBe(2); // the first cut keeps full resolution on phones
    const steps = trace(gov, (i) => cost[i], 60);
    expect(steps.map((s) => s.to)).toEqual([2, 3]);
    expect(gov.index).toBe(3);
    // Not locked: if L3 gets slow later (a busier fight), the walk carries
    // on from here.
    expect(trace(gov, (i) => (i < 4 ? 1 / 30 : 1 / 65), 10).map((s) => s.to)).toEqual([4]);
  });

  it("goes back to full quality and stops when no level helps (30 fps cap, Low Power Mode)", () => {
    const gov = new QualityGovernor();
    const walk = trace(gov, () => 1 / 30, 30);
    // L1-L3 cost no shader compiles; L4 (light state change) is never tried.
    expect(walk.map((s) => s.to)).toEqual([1, 2, 3, 0]);
    expect(walk[walk.length - 1].at).toBeLessThan(14);
    expect(gov.index).toBe(0);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]); // sharp, with bloom
    expect(trace(gov, () => 1 / 30, 120)).toEqual([]); // and stays there
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]);
  });

  it("keeps walking when vsync hides a step's gain (the old probe locked at L0)", () => {
    // 30 ms at L0; each step's real cost is rounded up to whole refreshes,
    // so L1 (22.5 ms) still presents at 33 ms but L2 (15 ms) makes 60 fps.
    const ratio = [1, 0.75, 0.5, 0.42, 0.25];
    const gov = new QualityGovernor();
    const steps = trace(gov, (i) => vsync(0.03 * ratio[i]), 60);
    expect(gov.index).toBe(2);
    expect(steps.map((s) => s.to)).toEqual([1, 2]);
    expect(steps[steps.length - 1].at).toBeLessThan(12); // settled within 12 s
  });

  it("keeps stepping through levels that change nothing once a step has helped", () => {
    const ms = [60, 40, 39, 38, 20];
    const gov = new QualityGovernor();
    run(gov, (i) => ms[i] / 1000, 60);
    expect(gov.index).toBe(4);
  });

  it("does not take the shader-recompiling step into L4 when no step has helped", () => {
    // Flat from L0 to L3 looks like a frame cap: L4's shadow map and rim
    // light changes would recompile every lit material for nothing.
    const ms = [50, 48, 47, 47, 25];
    const gov = new QualityGovernor();
    const walk = trace(gov, (i) => ms[i] / 1000, 60);
    expect(walk.map((s) => s.to)).not.toContain(4);
    expect(gov.index).toBe(0);
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]); // locked
  });

  it("lets a later walk reach L4 when an earlier step bought frame time", () => {
    const gov = new QualityGovernor();
    run(gov, (i) => [1 / 30, 1 / 50][Math.min(i, 1)], 20); // L1 is fast enough
    expect(gov.index).toBe(1);
    // A busier fight later: L1-L3 are equally slow, only L4 helps.
    run(gov, (i) => (i < 4 ? 1 / 30 : 1 / 60), 30);
    expect(gov.index).toBe(4);
  });

  it("settles on the best-looking level of a plateau (frame cap below the target)", () => {
    const ms = [50, 40, 100 / 3, 100 / 3, 100 / 3];
    const gov = new QualityGovernor();
    run(gov, (i) => ms[i] / 1000, 60);
    expect(gov.index).toBe(2);
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]); // locked
  });

  it("ignores isolated hitches in a 60 fps game (5% of frames at 0.2 s)", () => {
    const gov = new QualityGovernor();
    let n = 0;
    run(gov, () => (++n % 20 === 0 ? 0.2 : 1 / 60), 60);
    expect(gov.index).toBe(0);
  });

  it("steps two levels at once when frames take over twice the target", () => {
    const gov = new QualityGovernor();
    const steps = trace(gov, () => 1 / 15, WARMUP + WINDOW + 0.5);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBe(2);
  });

  it("ignores start-up hitches and long pauses such as a tab switch", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 25; i++) gov.sample(0.1); // 2.5 s of loading jank
    for (let i = 0; i < 20; i++) gov.sample(1.5);
    run(gov, () => 1 / 60, 20);
    expect(gov.index).toBe(0);
  });

  it("rearm() gives a new battle's start-up a grace period", () => {
    const slowStart = (rearm: boolean): number => {
      const gov = new QualityGovernor();
      run(gov, () => 1 / 60, 10);
      if (rearm) gov.rearm();
      run(gov, () => 1 / 20, SETTLE + WINDOW - 0.1);
      return gov.index;
    };
    expect(slowStart(false)).toBe(2); // judged on the first slow window
    expect(slowStart(true)).toBe(0); // still settling
  });
});

describe("quality pins", () => {
  it("reads high/medium/low from the URL", () => {
    expect(qualityPinFromUrl("?quality=high")).toBe("high");
    expect(qualityPinFromUrl("?quality=medium")).toBe("medium");
    expect(qualityPinFromUrl("?quality=low")).toBe("low");
    expect(qualityPinFromUrl("?quality=ultra")).toBe("auto");
    expect(qualityPinFromUrl("?arena=2")).toBe("auto");
  });

  it("pins Settings high/medium/low to L0/L2/L4 and never auto-steps", () => {
    expect(new QualityGovernor("auto", "high").index).toBe(0);
    expect(new QualityGovernor("auto", "medium").index).toBe(2);
    expect(new QualityGovernor("auto", "low").index).toBe(4);
    const high = new QualityGovernor("auto", "high");
    run(high, () => 1 / 10, 30);
    expect(high.index).toBe(0);
  });

  it("applies a Settings change live, and back to auto restarts at the top", () => {
    const gov = new QualityGovernor();
    expect(gov.setPref("low")).toBe(true);
    expect(gov.level.dprCap).toBe(1.25);
    expect(gov.setPref("low")).toBe(false); // no-op
    expect(gov.setPref("medium")).toBe(true);
    expect(gov.index).toBe(2);
    expect(gov.setPref("auto")).toBe(true);
    expect(gov.index).toBe(0);
    expect(gov.mode).toBe("auto");
  });

  it("lets a URL pin beat the saved setting", () => {
    const gov = new QualityGovernor("high", "low");
    expect(gov.index).toBe(0);
    expect(gov.setPref("low")).toBe(false);
    expect(gov.index).toBe(0);
  });

  it("feeds particleScale() and outlinesEnabled() from the level in force", () => {
    const gov = new QualityGovernor("auto", "low");
    expect(currentQuality()).toBe(QUALITY_LEVELS[4]);
    expect(particleScale()).toBe(0.35);
    expect(outlinesEnabled()).toBe(false);
    gov.setPref("medium");
    expect(particleScale()).toBe(0.75);
    expect(outlinesEnabled()).toBe(true);
    gov.setPref("high");
    expect(particleScale()).toBe(1);
  });
});
