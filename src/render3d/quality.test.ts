import { describe, expect, it } from "vitest";
import { QUALITY_LEVELS, QualityGovernor, qualityPinFromUrl } from "./quality";

/** Run `seconds` of frames whose duration depends on the current level. */
function run(gov: QualityGovernor, frameAt: (level: number) => number, seconds: number): void {
  for (let t = 0; t < seconds; ) {
    const dt = frameAt(gov.index);
    gov.sample(dt);
    t += dt;
  }
}

describe("adaptive quality", () => {
  it("holds full quality on a device that keeps 60 fps", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 60, 60);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]);
  });

  it("drops bloom first, then resolution, while each step really helps", () => {
    // GPU-bound phone: every step down buys real frame time.
    const gov = new QualityGovernor();
    const cost = [1 / 24, 1 / 32, 1 / 50];
    run(gov, (i) => cost[i], 9); // warm-up 5 s + one 2 s window
    expect(gov.index).toBe(1);
    expect(gov.level).toEqual({ dprCap: 2, bloom: false }); // still full res
    run(gov, (i) => cost[i], 30);
    expect(gov.index).toBe(2);
    expect(gov.level.dprCap).toBe(1.5); // never lower than 1.5x
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

  it("can be pinned from the URL for screenshots and testing", () => {
    expect(qualityPinFromUrl("?quality=high")).toBe("high");
    expect(qualityPinFromUrl("?quality=low")).toBe("low");
    expect(qualityPinFromUrl("?arena=2")).toBe("auto");
    const high = new QualityGovernor("high");
    run(high, () => 1 / 10, 30);
    expect(high.index).toBe(0);
    expect(new QualityGovernor("low").index).toBe(QUALITY_LEVELS.length - 1);
  });
});
