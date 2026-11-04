import { describe, expect, it } from "vitest";
import { btnClass, clampProgress, confirmLook, segmentedNext, trapOrder } from "./components";

describe("btnClass", () => {
  it("combines the base, variant and size classes", () => {
    expect(btnClass("cta", "lg")).toBe("ui-btn ui-btn--cta ui-btn--lg");
    expect(btnClass("icon")).toBe("ui-btn ui-btn--icon ui-btn--md");
  });
});

describe("clampProgress", () => {
  it("returns the fill fraction, clamped to 0..1", () => {
    expect(clampProgress(3, 10)).toBeCloseTo(0.3);
    expect(clampProgress(15, 10)).toBe(1);
    expect(clampProgress(-2, 10)).toBe(0);
  });
  it("treats a zero, negative or non-finite max as empty", () => {
    expect(clampProgress(5, 0)).toBe(0);
    expect(clampProgress(5, -1)).toBe(0);
    expect(clampProgress(Number.NaN, 10)).toBe(0);
    expect(clampProgress(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("segmentedNext", () => {
  const opts = [{ value: "low" }, { value: "medium" }, { value: "high" }] as const;
  it("steps forward and back", () => {
    expect(segmentedNext(opts, "low", 1)).toBe("medium");
    expect(segmentedNext(opts, "high", -1)).toBe("medium");
  });
  it("wraps at both ends", () => {
    expect(segmentedNext(opts, "high", 1)).toBe("low");
    expect(segmentedNext(opts, "low", -1)).toBe("high");
  });
  it("enters from the matching end when the value is unknown", () => {
    expect(segmentedNext<string>(opts, "ultra", 1)).toBe("low");
    expect(segmentedNext<string>(opts, "ultra", -1)).toBe("high");
  });
  it("keeps the value with no options", () => {
    expect(segmentedNext([], 7, 1)).toBe(7);
  });
});

describe("trapOrder", () => {
  it("cycles Tab forward and Shift+Tab backward", () => {
    expect(trapOrder(3, 0, false)).toBe(1);
    expect(trapOrder(3, 2, false)).toBe(0);
    expect(trapOrder(3, 0, true)).toBe(2);
  });
  it("enters at the first or last element from outside", () => {
    expect(trapOrder(4, -1, false)).toBe(0);
    expect(trapOrder(4, -1, true)).toBe(3);
  });
  it("returns -1 with nothing focusable", () => {
    expect(trapOrder(0, -1, false)).toBe(-1);
  });
});

describe("confirmLook", () => {
  it("keeps the old looks with no emphasis", () => {
    expect(confirmLook({})).toEqual({ ok: "cta", cancel: "secondary", okDanger: false, focus: "ok" });
    expect(confirmLook({ danger: true })).toEqual({ ok: "primary", cancel: "secondary", okDanger: true, focus: "cancel" });
  });
  it("emphasis 'cancel' makes Cancel the yellow CTA and focuses it", () => {
    expect(confirmLook({ emphasis: "cancel" })).toEqual({ ok: "secondary", cancel: "cta", okDanger: false, focus: "cancel" });
    // A destructive OK keeps its red but loses the focus to Cancel.
    expect(confirmLook({ emphasis: "cancel", danger: true })).toEqual({
      ok: "primary",
      cancel: "cta",
      okDanger: true,
      focus: "cancel",
    });
  });
  it("emphasis 'ok' makes OK the CTA (red when destructive) and focuses it", () => {
    expect(confirmLook({ emphasis: "ok" })).toEqual({ ok: "cta", cancel: "secondary", okDanger: false, focus: "ok" });
    expect(confirmLook({ emphasis: "ok", danger: true })).toEqual({ ok: "primary", cancel: "secondary", okDanger: true, focus: "ok" });
  });
  it("never makes both buttons the CTA", () => {
    for (const emphasis of [undefined, "ok", "cancel"] as const) {
      for (const danger of [false, true]) {
        const l = confirmLook({ emphasis, danger });
        expect(l.ok === "cta" && l.cancel === "cta").toBe(false);
      }
    }
  });
});
