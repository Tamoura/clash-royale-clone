import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeDom } from "./fakeDom.testkit";
import {
  btnClass,
  burstCount,
  clampProgress,
  confirmLook,
  flightPoint,
  segmentedNext,
  toastBottom,
  toast,
  toastBottomOver,
  trapOrder,
  walletValue,
} from "./components";

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

describe("toastBottom", () => {
  it("sits just above the bottom edge when nothing is docked there", () => {
    expect(toastBottom(844, [])).toBe(12);
    expect(toastBottom(844, [], 34)).toBe(46);
  });
  it("lifts above the tab bar or a footer in the bottom half", () => {
    // Tab bar 72px tall at the bottom of a 390x844 phone.
    expect(toastBottom(844, [{ top: 772, bottom: 844 }])).toBe(72 + 12);
    // A footer above the tab bar lifts it further.
    expect(toastBottom(844, [{ top: 772, bottom: 844 }, { top: 700, bottom: 770 }])).toBe(144 + 12);
  });
  it("ignores bars in the top half (headers, the wallet) and junk", () => {
    expect(toastBottom(844, [{ top: 0, bottom: 64 }, { top: 300, bottom: 360 }])).toBe(12);
    expect(toastBottom(844, [{ top: 900, bottom: 950 }, { top: 800, bottom: 790 }])).toBe(12);
  });
  it("keeps a toast clear of a title in landscape too", () => {
    // 844x390: header at the top, tab bar 56px at the bottom.
    const b = toastBottom(390, [{ top: 0, bottom: 52 }, { top: 334, bottom: 390 }]);
    expect(390 - b).toBeGreaterThan(52 + 40); // room for a toast below the header
  });
});

describe("toastBottomOver (a sheet or dialog is open)", () => {
  it("sits just above the sheet, clear of its bottom actions", () => {
    // 390x844 card info sheet: panel top 101, Upgrade button at 716-772.
    const b = toastBottomOver(844, 101, 40);
    const toastBottomY = 844 - b;
    expect(toastBottomY).toBe(101 - 12);
    expect(toastBottomY - 40).toBeGreaterThanOrEqual(12); // whole toast on screen
    // Never near the sheet's Upgrade button (the old spot above the tab bar).
    expect(toastBottomY).toBeLessThan(716);
    expect(b).toBeGreaterThan(toastBottom(844, [{ top: 774, bottom: 844 }]));
  });
  it("a short sheet gets the toast right above it", () => {
    expect(844 - toastBottomOver(844, 520, 40)).toBe(520 - 12);
  });
  it("a sheet that leaves no room above pins the stack to the top, over its title strip", () => {
    // 844x390: the sheet's panel starts at 47.
    const b = toastBottomOver(390, 47, 40);
    expect(390 - b - 40).toBe(12); // stack top at the 12px gap
    expect(390 - b).toBeLessThan(47 + 30); // ends within the handle / title strip
    // Two toasts stacked still start on screen.
    expect(390 - toastBottomOver(390, 47, 88) - 88).toBe(12);
    // A full-screen panel (top 0) behaves the same.
    expect(390 - toastBottomOver(390, 0, 40) - 40).toBe(12);
  });
  it("never goes below the bottom gap, even for a huge stack", () => {
    expect(toastBottomOver(390, 47, 900)).toBe(12);
  });
});

describe("reward bursts", () => {
  it("flies more coins for bigger rewards, within 4..12", () => {
    expect(burstCount(0)).toBe(0);
    expect(burstCount(-5)).toBe(0);
    expect(burstCount(Number.NaN)).toBe(0);
    expect(burstCount(1)).toBe(4);
    expect(burstCount(50)).toBeGreaterThan(burstCount(5));
    expect(burstCount(400)).toBeGreaterThanOrEqual(burstCount(50));
    expect(burstCount(1_000_000)).toBe(12);
  });

  it("each coin starts at the button and lands exactly on the wallet", () => {
    const a = { x: 200, y: 600 };
    const b = { x: 320, y: 30 };
    for (let i = 0; i < 8; i++) {
      expect(flightPoint(a, b, 0, i, 8)).toEqual(a);
      const end = flightPoint(a, b, 1, i, 8);
      expect(end.x).toBeCloseTo(b.x, 6);
      expect(end.y).toBeCloseTo(b.y, 6);
    }
  });

  it("coins scatter apart mid-flight (not one blob) and head toward the wallet", () => {
    const a = { x: 100, y: 700 };
    const b = { x: 300, y: 20 };
    const mid = [0, 1, 2, 3, 4, 5].map((i) => flightPoint(a, b, 0.5, i, 6));
    const xs = mid.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
    for (const p of mid) expect(p.y).toBeLessThan(a.y);
    // Clamped outside 0..1.
    expect(flightPoint(a, b, 2, 0, 6)).toEqual(flightPoint(a, b, 1, 0, 6));
  });

  it("the wallet counts up as coins land and ends exactly on the total", () => {
    expect(walletValue(100, 150, 0, 5)).toBe(100);
    expect(walletValue(100, 150, 2, 5)).toBe(120);
    expect(walletValue(100, 150, 5, 5)).toBe(150);
    expect(walletValue(100, 150, 9, 5)).toBe(150);
    expect(walletValue(100, 150, 0, 0)).toBe(150);
    // Never down along the way.
    let last = 0;
    for (let k = 0; k <= 7; k++) {
      const v = walletValue(1000, 1333, k, 7);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe("toast lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    installFakeDom();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("goes after 2.4 s by default", () => {
    const t = toast("Saved");
    vi.advanceTimersByTime(2399);
    expect(t.classList.contains("is-leaving")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.classList.contains("is-leaving")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(t.isConnected).toBe(false);
  });

  it("stays up as long as asked, for a line a young reader needs time for", () => {
    const t = toast("November 2026 season starts! You kept Royal Arena.", "success", 6000);
    vi.advanceTimersByTime(5999);
    expect(t.isConnected).toBe(true);
    expect(t.classList.contains("is-leaving")).toBe(false);
    vi.advanceTimersByTime(401);
    expect(t.isConnected).toBe(false);
  });
});
