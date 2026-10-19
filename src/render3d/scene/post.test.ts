import { describe, expect, it } from "vitest";
import { DIORAMA_DPR, PIXEL_BUDGET, finalFragmentShader, renderDpr } from "./post";

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
  it("leaves phones at their capped device ratio", () => {
    expect(renderDpr(390, 653, 3, 2, false)).toBe(2);
    expect(renderDpr(390, 653, 1, 2, false)).toBe(1);
  });

  it("holds a full-screen retina battle to the pixel budget", () => {
    const dpr = renderDpr(1440, 900, 2, 2, false);
    expect(dpr).toBeCloseTo(Math.sqrt(PIXEL_BUDGET / (1440 * 900)), 9);
    expect(dpr).toBeCloseTo(1.416, 3);
    expect(1440 * 900 * dpr * dpr).toBeCloseTo(PIXEL_BUDGET, -1);
  });

  it("never drops below one device pixel per CSS pixel", () => {
    expect(renderDpr(2560, 1440, 1, 2, false)).toBe(1);
    expect(renderDpr(3840, 2160, 2, 2, false)).toBe(1);
  });

  it("keeps the diorama's own cap", () => {
    expect(renderDpr(468, 900, 3, 2, true)).toBeLessThanOrEqual(DIORAMA_DPR);
    expect(renderDpr(468, 900, 1, 2, true)).toBe(1);
  });

  it("treats a missing device ratio as 1", () => {
    expect(renderDpr(390, 653, 0, 2, false)).toBe(1);
  });
});
