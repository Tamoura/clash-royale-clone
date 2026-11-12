import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeDom } from "./fakeDom.testkit";
import { REDUCE_MOTION_ATTR, applyMotionAttr } from "./motionAttr";

afterEach(() => vi.unstubAllGlobals());

describe("reduce-motion attribute", () => {
  it("toggles data-reduce-motion on <html>", () => {
    const doc = installFakeDom();
    const html = doc.documentElement as unknown as Element;
    applyMotionAttr(html, true);
    expect(doc.documentElement.hasAttribute(REDUCE_MOTION_ATTR)).toBe(true);
    applyMotionAttr(html, true);
    expect(doc.documentElement.hasAttribute(REDUCE_MOTION_ATTR)).toBe(true);
    applyMotionAttr(html, false);
    expect(doc.documentElement.hasAttribute(REDUCE_MOTION_ATTR)).toBe(false);
  });
});
