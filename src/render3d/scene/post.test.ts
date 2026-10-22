import { describe, expect, it } from "vitest";
import { DIORAMA_DPR, finalFragmentShader, renderDpr } from "./post";
import { MIN_RENDER_SCALE, QUALITY_LEVELS } from "../quality";

describe("fused final pass", () => {
  it("routes every FXAA texel fetch through the tone map and grade", () => {
    const src = finalFragmentShader();
    // The only raw fetch left is inside graded(); FXAA's Sample() calls it.
    expect(src.match(/texture\(\s*tex2D,\s*uv\s*\)/g)).toHaveLength(1);
    expect(src).toMatch(/vec4 Sample\( sampler2D tex2D, vec2 uv \) \{\s*return graded\( tex2D, uv \);/);
    expect(src).toContain("ApplyFXAA( tDiffuse, resolution.xy, vUv )");
  });

  it("tone-maps, converts to sRGB, grades, and adds the flash", () => {
    const src = finalFragmentShader();
    expect(src).toContain("#include <tonemapping_pars_fragment>");
    expect(src).toContain("ACESFilmicToneMapping( c.rgb )");
    expect(src).toContain("sRGBTransferOETF( c )");
    expect(src).toMatch(/col\.rgb \+ uFlash/);
    expect(src.match(/void main\(\)/g)).toHaveLength(1);
  });
});

describe("renderDpr", () => {
  const [L0, , , , L4] = QUALITY_LEVELS;
  /** Device pixels a w x h canvas draws at `dpr`. */
  const px = (w: number, h: number, dpr: number): number => w * h * dpr * dpr;

  it("leaves phones at their capped device ratio on every level", () => {
    expect(QUALITY_LEVELS.map((l) => renderDpr(390, 653, 3, l, false))).toEqual([2, 2, 1.75, 1.5, 1.25]);
    expect(renderDpr(390, 653, 1, L0, false)).toBe(1);
  });

  it("holds a full-screen retina battle to the pixel budget", () => {
    const dpr = renderDpr(1440, 900, 2, L0, false);
    expect(dpr).toBeCloseTo(Math.sqrt(L0.pixelBudget / (1440 * 900)), 9);
    expect(dpr).toBeCloseTo(1.303, 3);
    expect(px(1440, 900, dpr)).toBeCloseTo(L0.pixelBudget, -1);
  });

  it("never drops below one device pixel per CSS pixel at the top level", () => {
    expect(renderDpr(2560, 1440, 1, L0, false)).toBe(1);
    expect(renderDpr(3840, 2160, 2, L0, false)).toBe(1);
  });

  it("sheds resolution on every step of a big 1x canvas, down to the floor", () => {
    const dprs = QUALITY_LEVELS.map((l) => renderDpr(1920, 1080, 1, l, false));
    expect(dprs[0]).toBe(1); // L0 at 1x: pixel for pixel as before
    for (let i = 1; i < dprs.length; i++) {
      expect(px(1920, 1080, dprs[i])).toBeLessThan(px(1920, 1080, dprs[i - 1]));
    }
    expect(dprs[4]).toBe(MIN_RENDER_SCALE);
  });

  it("never renders below the minimum scale when the device can do it", () => {
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ]) {
      for (const d of [0.7, 1, 1.25, 2]) {
        for (const l of QUALITY_LEVELS) expect(renderDpr(w, h, d, l, false)).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
      }
    }
    expect(renderDpr(3840, 2160, 1, L4, false)).toBe(MIN_RENDER_SCALE);
  });

  it("keeps the diorama's own cap", () => {
    expect(renderDpr(468, 900, 3, L0, true)).toBeLessThanOrEqual(DIORAMA_DPR);
    expect(renderDpr(468, 900, 1, L0, true)).toBe(1);
  });

  it("treats a missing device ratio as 1", () => {
    expect(renderDpr(390, 653, 0, L0, false)).toBe(1);
  });
});
