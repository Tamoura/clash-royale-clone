import { describe, expect, it } from "vitest";
import {
  ALBEDO_SATURATION,
  GROUND_AO,
  INK_COLOR,
  INK_DEPTH,
  INK_PX,
  RIM_COLOR,
  RIM_STRENGTH,
  RIM_UNIFORM,
  SCREEN_FLASH_MAX,
  TINT_MAX,
  TOON_RAMP,
  TOWER_FLASH_MAX,
  TROOP_FLASH_MAX,
  rgb01,
  rimGlsl,
  syncRim,
  toonRampGlsl,
} from "./material";
import { OUTLINE_COLOR, OUTLINE_CSS_PX } from "../outlineMaterial";
import { ALBEDO_SATURATION as CAST_SATURATION, CAST_INK_DEPTH, CAST_INK_PX, GROUND_AO_DARK, GROUND_AO_HEIGHT, RIM_UNIFORM as CAST_RIM } from "../cast/bake";
import { RIG_AO, RIG_FLASH_MAX, RIG_INK_DEPTH, RIG_INK_PX, RIG_RAMP, RIG_RIM, RIG_RIM_UNIFORM, RIG_SATURATION, RIG_TINT_MAX } from "../characters3d";
import { TOWER_INK, TOWER_INK_PX } from "../scene/views/towerCraft";
import { HIT_FLASH, HIT_FLASH_PEAK, TOWER_FLASH_PEAK } from "../scene/views/animate";
import { MAX_FLASH } from "../scene/post";
import { FX_MAX_FLASH } from "../scene/fx/pool";

describe("look/material: one material language (shared rules 5)", () => {
  it("holds the art bible's numbers", () => {
    expect(TOON_RAMP).toEqual([0.62, 0.86, 1.0]);
    expect(RIM_COLOR).toBe(0xbfe3ff);
    expect(RIM_STRENGTH).toBe(0.35);
    expect(INK_COLOR).toBe(0x1f1a2e);
    expect(INK_PX).toBe(1.6);
    expect(INK_DEPTH).toBe(0.3);
    expect(GROUND_AO).toEqual({ share: 0.18, dark: 0.15 });
    expect(ALBEDO_SATURATION).toBe(1.12);
    expect(TINT_MAX).toBe(0.6);
    expect(TROOP_FLASH_MAX).toBeLessThanOrEqual(0.35);
    expect(TOWER_FLASH_MAX).toBeLessThanOrEqual(0.25);
    expect(SCREEN_FLASH_MAX).toBeLessThanOrEqual(0.25);
  });

  it("is the one source for the cast, the rigs, the ink, the keeps and the flashes", () => {
    expect([OUTLINE_CSS_PX, CAST_INK_PX, RIG_INK_PX, TOWER_INK_PX]).toEqual([INK_PX, INK_PX, INK_PX, INK_PX]);
    expect([OUTLINE_COLOR, TOWER_INK]).toEqual([INK_COLOR, INK_COLOR]);
    expect([CAST_INK_DEPTH, RIG_INK_DEPTH]).toEqual([INK_DEPTH, INK_DEPTH]);
    expect([GROUND_AO_HEIGHT, GROUND_AO_DARK]).toEqual([GROUND_AO.share, GROUND_AO.dark]);
    expect(RIG_AO).toBe(GROUND_AO);
    expect([CAST_SATURATION, RIG_SATURATION]).toEqual([ALBEDO_SATURATION, ALBEDO_SATURATION]);
    expect(RIG_RAMP).toBe(TOON_RAMP);
    expect(RIG_RIM).toEqual({ color: RIM_COLOR, strength: RIM_STRENGTH });
    expect(RIG_TINT_MAX).toBe(TINT_MAX);
    expect([RIG_FLASH_MAX, HIT_FLASH_PEAK]).toEqual([TROOP_FLASH_MAX, TROOP_FLASH_MAX]);
    expect(TOWER_FLASH_PEAK).toBe(TOWER_FLASH_MAX);
    expect([MAX_FLASH, FX_MAX_FLASH]).toEqual([SCREEN_FLASH_MAX, SCREEN_FLASH_MAX]);
    expect(HIT_FLASH.map((v) => Math.round(v * 255))).toEqual([0xff, 0xf4, 0xe0]);
  });

  it("ties the cast's and the rigs' rim to one live uniform", () => {
    expect(CAST_RIM).toBe(RIM_UNIFORM);
    expect(RIG_RIM_UNIFORM).toBe(RIM_UNIFORM);
    syncRim({ rimLight: false });
    expect(CAST_RIM.value).toBe(0);
    syncRim({ rimLight: true });
    expect(RIG_RIM_UNIFORM.value).toBe(1);
  });

  it("writes the same GLSL the packages wrote by hand", () => {
    expect(toonRampGlsl()).toContain("float k = 0.62 + 0.24 * smoothstep(0.40, 0.44, x) + 0.14 * smoothstep(0.68, 0.72, x);");
    expect(rimGlsl("uRim")).toContain("_rim = smoothstep(0.62, 1.0, _rim) * 0.35 * uRim;");
    expect(rimGlsl("uRim")).toContain("vec3(0.749, 0.890, 1.000)");
    expect(rgb01(RIM_COLOR).map((v) => Math.round(v * 255))).toEqual([0xbf, 0xe3, 0xff]);
  });
});
