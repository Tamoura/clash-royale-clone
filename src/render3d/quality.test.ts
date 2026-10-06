import { describe, expect, it } from "vitest";
import {
  QUALITY_LEVELS,
  QualityGovernor,
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
    expect(l0).toEqual({ dprCap: 2, bloom: 1, shadowSize: 2048, fxaa: true, particles: 1, outlines: true, rimLight: true });
    expect(l1).toMatchObject({ dprCap: 2, bloom: 0.5, shadowSize: 1024 });
    expect(l2).toMatchObject({ dprCap: 1.75, bloom: 0, particles: 0.75 });
    expect(l3).toMatchObject({ dprCap: 1.5, shadowSize: 512, particles: 0.5 });
    expect(l4).toEqual({ dprCap: 1.25, bloom: 0, shadowSize: 0, fxaa: false, particles: 0.35, outlines: false, rimLight: false });
  });
});

describe("adaptive quality governor", () => {
  it("holds full quality on a device that keeps 60 fps", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 60, 60);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]);
  });

  it("walks down the ladder in order while each step really helps", () => {
    // GPU-bound phone: every step down buys real frame time.
    const gov = new QualityGovernor();
    const cost = [1 / 20, 1 / 26, 1 / 32, 1 / 38, 1 / 50];
    run(gov, (i) => cost[i], 9); // warm-up 5 s + one 2 s window
    expect(gov.index).toBe(1);
    expect(gov.level.dprCap).toBe(2); // the first cut keeps full resolution
    const seen = [gov.index];
    for (let k = 0; k < 40; k++) {
      run(gov, (i) => cost[i], 1);
      if (seen[seen.length - 1] !== gov.index) seen.push(gov.index);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(gov.level.dprCap).toBe(1.25); // floor of the ladder
  });

  it("undoes a step that doesn't help and stops (30 fps cap, Low Power Mode)", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 30, 120);
    expect(gov.index).toBe(0);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]); // sharp, with bloom
  });

  it("ignores start-up hitches and long pauses such as a tab switch", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 40; i++) gov.sample(0.1); // 4 s of loading jank
    for (let i = 0; i < 20; i++) gov.sample(1.5);
    run(gov, () => 1 / 60, 20);
    expect(gov.index).toBe(0);
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
