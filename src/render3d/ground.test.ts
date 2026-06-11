import { describe, expect, it } from "vitest";
import { DUST_INTERVAL, blobShadowScale } from "./ground";

describe("ground contact", () => {
  it("the blob shadow shrinks as the flyer rises", () => {
    const atRest = blobShadowScale(1.0, 1.0);
    const high = blobShadowScale(1.0, 1.4);
    expect(high).toBeLessThan(atRest);
  });

  it("never vanishes or balloons", () => {
    expect(blobShadowScale(1.0, 5)).toBeGreaterThan(0.3);
    expect(blobShadowScale(1.0, 0)).toBeLessThanOrEqual(1.3);
  });

  it("paces footstep dust sensibly", () => {
    expect(DUST_INTERVAL).toBeGreaterThan(0.2);
    expect(DUST_INTERVAL).toBeLessThan(1);
  });
});
