import { describe, expect, it } from "vitest";
import { BLOOM_HALF_PX, DIORAMA_DPR, bloomScaleFor, edgeShadeStops, finalFragmentShader, renderDpr } from "./post";
import hudCss from "../../ui/styles/hud.css?raw";
import { MIN_RENDER_SCALE, QUALITY_LEVELS } from "../quality";

describe("fused final pass", () => {
  it("routes FXAA's output colour through the tone map and grade", () => {
    const src = finalFragmentShader();
    expect(src).toMatch(/vec4 Sample\( sampler2D tex2D, vec2 uv \) \{\s*return graded\( tex2D, uv \);/);
    expect(src).toContain("ApplyFXAA( tDiffuse, resolution.xy, vUv )");
  });

  it("reads FXAA's edge-detection luma straight from the HDR buffer", () => {
    const src = finalFragmentShader();
    const luma = src.match(/float SampleLuminance\( sampler2D tex2D, vec2 uv \) \{[^}]*\}/);
    expect(luma).not.toBeNull();
    expect(luma![0]).toContain("texture( tex2D, uv )");
    expect(luma![0]).toContain("toneMappingExposure");
    expect(luma![0]).not.toContain("graded(");
    expect(luma![0]).not.toContain("Sample(");
    // The only raw fetches: graded() (one per pixel) and the luma reads.
    expect(src.match(/texture\(\s*tex2D,\s*uv\s*\)/g)).toHaveLength(2);
    // The 5-argument overload still forwards to the 2-argument one.
    expect(src).toMatch(/float SampleLuminance\( sampler2D tex2D, vec2 texSize, vec2 uv, float uOffset, float vOffset \)/);
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

describe("edge shade", () => {
  it("is drawn by the final pass, not a full-screen CSS layer", () => {
    const src = finalFragmentShader();
    expect(src).toContain("uniform vec3 uEdge;");
    expect(src).toMatch(/mix\( col\.rgb, vec3\( 4\.0, 8\.0, 20\.0 \) \/ 255\.0, uEdge\.x \* clamp\( edge, 0\.0, 1\.0 \) \)/);
    // Before the flash, after FXAA.
    expect(src.indexOf("uEdge.x *")).toBeGreaterThan(src.indexOf("ApplyFXAA( tDiffuse"));
    expect(src.indexOf("uEdge.x *")).toBeLessThan(src.indexOf("col.rgb + uFlash"));
    expect(hudCss).not.toMatch(/#stage::after/);
  });

  it("fades out at 22% / 78% of the width, or where a wide board begins", () => {
    expect(edgeShadeStops(668, 1440)).toEqual([0.45, 0.22, 0.78]);
    const [a, l, r] = edgeShadeStops(1000, 1440);
    expect(a).toBe(0.45);
    expect(l).toBeCloseTo(0.5 - 500 / 1440, 9);
    expect(r).toBeCloseTo(0.5 + 500 / 1440, 9);
  });

  it("is off without a board or room beside it", () => {
    expect(edgeShadeStops(0, 1440)[0]).toBe(0);
    expect(edgeShadeStops(1440, 1440)[0]).toBe(0);
    // Off still leaves stops the shader can divide by.
    expect(edgeShadeStops(0, 1440)[1]).toBeGreaterThan(0);
    expect(edgeShadeStops(0, 1440)[2]).toBeLessThan(1);
  });
});

describe("bloomScaleFor", () => {
  it("keeps full-size bloom on phones and small laptops", () => {
    expect(bloomScaleFor(1, 390 * 653 * 4, false)).toBe(1); // 1.02M
    expect(bloomScaleFor(1, 1366 * 768, false)).toBe(1); // 1.05M
  });

  it("halves bloom on a big canvas", () => {
    expect(bloomScaleFor(1, 1920 * 1080, false)).toBe(0.5); // 2.07M
    expect(BLOOM_HALF_PX).toBeLessThan(1920 * 1080);
  });

  it("leaves a level's own reduced or absent bloom alone", () => {
    expect(bloomScaleFor(0.5, 1920 * 1080, false)).toBe(0.5);
    expect(bloomScaleFor(0, 1920 * 1080, false)).toBe(0);
    expect(bloomScaleFor(QUALITY_LEVELS[2].bloom, 390 * 653 * 4, false)).toBe(0);
  });

  it("never blooms the diorama", () => {
    expect(bloomScaleFor(1, 468 * 900, true)).toBe(0);
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
