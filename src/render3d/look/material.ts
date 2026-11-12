/**
 * The Toy Tournament material language in one place (art bible 0.3, 5 and 6;
 * shared rules 5): troops, creatures, card buildings and towers share one
 * toon ramp, one cool rim, one ink and one cap on hit flashes. Wave 1 held
 * these numbers locally in each package; the cast (cast/bake.ts), the baked
 * rigs (characters3d.ts), the shared ink (outlineMaterial.ts), the keeps
 * (towerCraft.ts), the hit flashes (scene/views/animate.ts) and the screen
 * flash (scene/post.ts, scene/fx/pool.ts) all read them from here now.
 *
 * Not covered: the unbaked toon() parts (arena props, the hand-built tower
 * crews, non-humanoid card portraits) keep the handcrafted coloured ramp of
 * characters3d.ts's gradientMap(); bloom and grade live with the light rig
 * in scene/post.ts and scene/sky.ts.
 */

/** The three light bands of the toon ramp (shade, half-tone, lit). */
export const TOON_RAMP = [0.62, 0.86, 1.0] as const;
/** Soft band edges, as smoothstep ranges over N.L * 0.5 + 0.5 (0.04 wide). */
export const TOON_STEPS = [
  [0.4, 0.44],
  [0.68, 0.72],
] as const;

/** The cool back-rim on characters: #BFE3FF at 0.35 (off at L4, see RIM_UNIFORM). */
export const RIM_COLOR = 0xbfe3ff;
export const RIM_STRENGTH = 0.35;
/** Where the rim starts on the view Fresnel term (smoothstep from here to 1). */
export const RIM_FROM = 0.62;
/**
 * Rim on (1) or off (0): ONE uniform object shared by every cast and baked
 * rig material, kept in step with the live quality level (rimLight).
 */
export const RIM_UNIFORM = { value: 1 };

/** Set the shared rim for a quality level (its rimLight flag). */
export function syncRim(level: { rimLight: boolean }): void {
  RIM_UNIFORM.value = level.rimLight ? 1 : 0;
}

/** Ink: #1F1A2E, 1.6 CSS px on screen at any DPR (fitInk), silhouette-only. */
export const INK_COLOR = 0x1f1a2e;
export const INK_PX = 1.6;
/** World units the ink shell sits behind the body along the view: only the silhouette survives. */
export const INK_DEPTH = 0.3;

/** Painted ground occlusion: the lowest `share` of a unit darkens by up to `dark` at its feet. */
export const GROUND_AO = { share: 0.18, dark: 0.15 } as const;
/** Albedo saturation multiplier applied when a character or rig is baked. */
export const ALBEDO_SATURATION = 1.12;

/** The most a status tint (freeze, rage, slow) may pull a pixel toward its colour. */
export const TINT_MAX = 0.6;
/** Hit flashes MIX toward a warm white (#FFF4E0), never add light, so they never bloom. */
export const HIT_FLASH_COLOR = 0xfff4e0;
/** Peak hit flash on troops, creatures and card buildings' bodies. */
export const TROOP_FLASH_MAX = 0.35;
/** Peak hit flash on towers (a softer warm throb). */
export const TOWER_FLASH_MAX = 0.25;
/** Peak full-screen flash (setFlash and the FX pool's impact flashes). */
export const SCREEN_FLASH_MAX = 0.25;

/**
 * The brightest a lit character pixel may get (linear HDR luminance, with
 * the bloom pass's weights), kept under the bloom threshold (scene/post.ts
 * BLOOM.threshold, 0.92) so no albedo, rim or hit flash ever glows: a white
 * turban, beard or bork in full sun rolls off softly from LIT_KNEE toward
 * LIT_MAX instead (art bible 5, bloom contract).
 */
export const LIT_MAX = 0.9;
export const LIT_KNEE = 0.8;
/** Luminance weights of three's LuminosityHighPassShader (the bloom's bright pass). */
export const BLOOM_LUMA = [0.299, 0.587, 0.114] as const;

/** The roll-off litClampGlsl applies, on a luminance (for tests and tools). */
export function litClamp(l: number): number {
  if (l <= LIT_KNEE) return l;
  const room = LIT_MAX - LIT_KNEE;
  return LIT_KNEE + room * (1 - Math.exp(-(l - LIT_KNEE) / room));
}

/** 0..1 sRGB channels of a hex colour, for GLSL literals. */
export function rgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const f2 = (v: number): string => v.toFixed(2);
const f3 = (v: number): string => v.toFixed(3);

/**
 * GLSL replacing three's `#include <gradientmap_pars_fragment>`: the
 * three-band ramp above as a light irradiance (grey, the albedo keeps its hue).
 */
export function toonRampGlsl(): string {
  const [a, b, c] = TOON_RAMP;
  const [[s0, s1], [t0, t1]] = TOON_STEPS;
  return `vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
         float x = dot( normal, lightDirection ) * 0.5 + 0.5;
         float k = ${f2(a)} + ${f2(b - a)} * smoothstep(${f2(s0)}, ${f2(s1)}, x) + ${f2(c - b)} * smoothstep(${f2(t0)}, ${f2(t1)}, x);
         return vec3(k);
       }`;
}

/**
 * GLSL for the end of a lit fragment shader (needs `normal` and
 * `vViewPosition`): the cool rim, scaled by the float uniform `onUniform`.
 */
export function rimGlsl(onUniform: string): string {
  const [r, g, b] = rgb01(RIM_COLOR);
  return `float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
         _rim = smoothstep(${f2(RIM_FROM)}, 1.0, _rim) * ${f2(RIM_STRENGTH)} * ${onUniform};
         gl_FragColor.rgb += _rim * vec3(${f3(r)}, ${f3(g)}, ${f3(b)});`;
}

/** GLSL for the very end of a lit character's fragment: the soft luminance roll-off (litClamp). */
export function litClampGlsl(): string {
  const room = LIT_MAX - LIT_KNEE;
  const [r, g, b] = BLOOM_LUMA;
  return `{
           float _l = dot(gl_FragColor.rgb, vec3(${f3(r)}, ${f3(g)}, ${f3(b)}));
           if (_l > ${f2(LIT_KNEE)}) gl_FragColor.rgb *= (${f2(LIT_KNEE)} + ${f2(room)} * (1.0 - exp(-(_l - ${f2(LIT_KNEE)}) / ${f2(room)}))) / _l;
         }`;
}
