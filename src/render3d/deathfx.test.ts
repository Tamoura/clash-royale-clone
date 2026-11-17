import { describe, expect, it, vi } from "vitest";
import { deathMotion, deathStyle, toppleDirection } from "./deathfx";

describe("death effect styles", () => {
  it("Classic skeletal troops scatter bones", async () => {
    vi.resetModules();
    vi.doMock("./theme", async (orig) => ({ ...(await orig<typeof import("./theme")>()), ARABIC: false }));
    try {
      const classic = (await import("./deathfx")).deathStyle;
      expect(classic("skeletons").kind).toBe("bones");
      expect(classic("skeleton-army").kind).toBe("bones");
    } finally {
      vi.doUnmock("./theme");
      vi.resetModules();
    }
  });

  it("the Golden Age foot soldiers leave a puff of sand, never bones (Node runs that edition)", () => {
    expect(deathStyle("skeletons").kind).toBe("puff");
    expect(deathStyle("skeleton-army").kind).toBe("puff");
  });

  it("the robots burst into purple sparks", () => {
    expect(deathStyle("pekka").kind).toBe("sparks");
    expect(deathStyle("mini-pekka").kind).toBe("sparks");
  });

  it("the balloon deflates", () => {
    expect(deathStyle("balloon").kind).toBe("deflate");
  });

  it("everything else puffs", () => {
    expect(deathStyle("knight").kind).toBe("puff");
    expect(deathStyle(null).kind).toBe("puff");
  });

  it("every recipe budgets accent particles and a visible scale", () => {
    for (const id of ["knight", "pekka", "balloon"] as const) {
      expect(deathStyle(id).particles).toBeGreaterThan(0);
      expect(deathStyle(id).scale).toBeGreaterThan(0);
    }
  });
});

describe("death motions", () => {
  it("faceless skeletons and robots shatter, people get knocked out, flyers tumble", () => {
    expect(deathMotion("skeletons", { flying: false, hasFace: false })).toBe("shatter");
    expect(deathMotion("pekka", { flying: false, hasFace: false })).toBe("shatter");
    expect(deathMotion("knight", { flying: false, hasFace: true })).toBe("ko");
    expect(deathMotion("baby-dragon", { flying: true, hasFace: false })).toBe("tumble");
    // An edition that dresses skeletons as militiamen knocks them out instead.
    expect(deathMotion("skeletons", { flying: false, hasFace: true })).toBe("ko");
  });

  it("the topple direction follows the recoil vector", () => {
    const out = { x: 0, z: 0 };
    toppleDirection(3, 4, -5, -5, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.z).toBeCloseTo(0.8);
    toppleDirection(-2, 0, 4, 4, out);
    expect(out.x).toBeCloseTo(-1);
    expect(out.z).toBeCloseTo(0);
  });

  it("without a recent blow, bodies fall away from the middle of the board", () => {
    const out = { x: 0, z: 0 };
    toppleDirection(0, 0, 0, 6, out);
    expect(out.z).toBeCloseTo(1);
    toppleDirection(0, 0, -3, 0, out);
    expect(out.x).toBeCloseTo(-1);
    toppleDirection(0, 0, 0, 0, out); // dead centre: still a unit vector
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
  });
});
