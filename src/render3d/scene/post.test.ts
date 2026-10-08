import { describe, expect, it } from "vitest";
import { finalFragmentShader } from "./post";

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
