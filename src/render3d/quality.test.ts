import { describe, expect, it } from "vitest";
import { QUALITY_LEVELS, QualityGovernor, SETTLE, WINDOW, qualityPinFromUrl } from "./quality";

function run(gov: QualityGovernor, fps: number, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (gov.sample(1 / fps)) changes++;
  return changes;
}

describe("adaptive quality", () => {
  it("holds full quality on a device that keeps 60 fps", () => {
    const gov = new QualityGovernor();
    expect(run(gov, 60, 30)).toBe(0);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]);
  });

  it("steps down one level per window when frames are slow, waiting to settle between", () => {
    const gov = new QualityGovernor();
    expect(run(gov, 30, WINDOW + 0.1)).toBe(1);
    expect(gov.index).toBe(1);
    // Still slow: the next step only comes after the settle time plus a window.
    expect(run(gov, 30, SETTLE - 0.2)).toBe(0);
    expect(run(gov, 30, WINDOW + 0.5)).toBe(1);
    expect(gov.index).toBe(2);
    expect(gov.level.bloom).toBe(false);
  });

  it("bottoms out at the lowest level and never steps back up", () => {
    const gov = new QualityGovernor();
    run(gov, 20, 60);
    expect(gov.index).toBe(QUALITY_LEVELS.length - 1);
    run(gov, 60, 30);
    expect(gov.index).toBe(QUALITY_LEVELS.length - 1);
  });

  it("ignores long hitches such as a tab switch", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 20; i++) gov.sample(1.5);
    expect(gov.index).toBe(0);
  });

  it("can be pinned from the URL for screenshots and testing", () => {
    expect(qualityPinFromUrl("?quality=high")).toBe("high");
    expect(qualityPinFromUrl("?quality=low")).toBe("low");
    expect(qualityPinFromUrl("?arena=2")).toBe("auto");
    const high = new QualityGovernor("high");
    run(high, 10, 30);
    expect(high.index).toBe(0);
    expect(new QualityGovernor("low").index).toBe(QUALITY_LEVELS.length - 1);
  });
});
