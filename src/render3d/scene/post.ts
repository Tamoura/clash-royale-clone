/**
 * Renderer and post stack: the WebGL renderer with static (on-demand)
 * shadows and filmic tone mapping, a three-pass composer (render, bloom,
 * one fused final pass), and the quality ladder's application: resolution,
 * bloom size, shadow-map size, FXAA and the rim light, live from Settings.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import type { Battle3D } from "../scene3d";
import { getPrefs, onPrefs } from "../../ui/prefs";
import { LOOK } from "./common";
import { setOutlinesVisible } from "../outlineMaterial";
import { SCREEN_FLASH_MAX } from "../look/material";
import {
  QUALITY_LEVELS,
  autoStartFor,
  currentQuality,
  deviceKey,
  firstGuessLevel,
  gfxBuildTag,
  outlinesEnabled,
  readGfxMemory,
  recordGfx,
  writeGfxMemory,
  type QualityLevel,
  type StorageLike,
} from "../quality";
import { noteLowGraphics, registerGfxNote } from "../gfxNote";
import { applyArenaQuality } from "./arena/build";

/**
 * Display-space colour grade (art bible section 5): saturation about 1.12,
 * contrast 1.06, a subtle split tone and a vignette of at most 0.24. Looks
 * may lean a little either way, inside GRADE_LIMITS.
 */
export const DEFAULT_GRADE = { saturation: 1.12, contrast: 1.06, tint: [1, 1, 1] as [number, number, number], vignette: 0.2 };
export const GRADE_LIMITS = { saturation: [1.04, 1.16], contrast: [1.03, 1.08], vignette: [0, 0.24] } as const;
/** Split tone: shadows lean cool, highlights warm (multipliers at each end). */
export const SPLIT_TONE = { shadows: [0.96, 0.98, 1.04], highlights: [1.03, 1.0, 0.96] } as const;

/**
 * The bloom contract (art bible section 5): only emissive cores (fireball and
 * comet cores, sparks, elixir, lanterns and neon at night, lava) exceed the
 * linear threshold. Lit albedo stays under it: a white toon surface under the
 * full daylight rig reads about 0.8 linear (the diffuse BRDF divides by pi).
 */
export const BLOOM = { threshold: 0.92, strength: 0.32, radius: 0.3 } as const;
/** setFlash never whites out more than this. */
export const MAX_FLASH = SCREEN_FLASH_MAX;

const clampTo = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

/** The look's grade held inside GRADE_LIMITS. */
export function gradeFor(look: { grade?: { saturation?: number; contrast?: number; tint?: [number, number, number]; vignette?: number } }): {
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  vignette: number;
} {
  const g = { ...DEFAULT_GRADE, ...(look.grade ?? {}) };
  return {
    saturation: clampTo(g.saturation, GRADE_LIMITS.saturation),
    contrast: clampTo(g.contrast, GRADE_LIMITS.contrast),
    tint: g.tint,
    vignette: clampTo(g.vignette, GRADE_LIMITS.vignette),
  };
}

/**
 * The whole display transform in one full-screen pass:
 *   graded(uv) = grade(sRGB(ACES(exposure · hdr(uv))))   (the old Output + Grade passes)
 * FXAA then runs on the graded colour: three's FXAA reads the colour it
 * outputs through one Sample() hook, which is rewired to graded(). Its 9 to
 * 21 luma reads for edge detection only need a perceptual brightness, so
 * they read the HDR buffer directly (Reinhard, then a square-root gamma)
 * instead of running the full grade each: one grade per pixel, not 10-22.
 * Then the wide layout's edge shade (see setEdgeShade), and a white
 * additive flash goes on last.
 */
export function finalFragmentShader(): string {
  const fxaa = FXAAShader.fragmentShader;
  const sample = /vec4 Sample\(\s*sampler2D\s+tex2D,\s*vec2 uv\s*\)\s*\{[^}]*\}/;
  // The 2-argument overload only (the 5-argument one takes texSize second).
  const luma = /float SampleLuminance\(\s*sampler2D\s+tex2D,\s*vec2 uv\s*\)\s*\{[^}]*\}/;
  const main = /void main\(\)\s*\{[^}]*\}\s*$/;
  if (!sample.test(fxaa) || !luma.test(fxaa) || !main.test(fxaa)) {
    throw new Error("FXAAShader layout changed: update finalFragmentShader()");
  }
  const graded = /* glsl */ `
    uniform float saturation;
    uniform float contrast;
    uniform vec3 tint;
    uniform float vignette;
    uniform float uFlash;
    uniform float uFxaa;
    uniform vec3 uEdge; // edge shade: alpha, left stop, right stop (vUv.x)

    #include <tonemapping_pars_fragment>

    vec4 graded( sampler2D tex2D, vec2 uv ) {
      vec4 c = texture( tex2D, uv );
      #if defined( ACES_FILMIC_TONE_MAPPING )
        c.rgb = ACESFilmicToneMapping( c.rgb );
      #elif defined( NEUTRAL_TONE_MAPPING )
        c.rgb = NeutralToneMapping( c.rgb );
      #elif defined( LINEAR_TONE_MAPPING )
        c.rgb = LinearToneMapping( c.rgb );
      #endif
      #ifdef SRGB_TRANSFER
        c = sRGBTransferOETF( c );
      #endif
      float l = dot( c.rgb, vec3( 0.299, 0.587, 0.114 ) );
      vec3 col = mix( vec3( l ), c.rgb, saturation );
      col = ( col - 0.5 ) * contrast + 0.5;
      col *= tint;
      // Split tone: shadows lean cool, highlights warm (a painted, sunlit read).
      col *= mix( vec3( ${SPLIT_TONE.shadows.join(", ")} ), vec3( ${SPLIT_TONE.highlights.join(", ")} ), smoothstep( 0.12, 0.82, l ) );
      vec2 d = uv - 0.5;
      col *= 1.0 - vignette * smoothstep( 0.35, 0.95, dot( d, d ) * 2.2 );
      return vec4( clamp( col, 0.0, 1.0 ), c.a );
    }`;
  return fxaa
    .replace("varying vec2 vUv;", `varying vec2 vUv;\n${graded}`)
    .replace(sample, "vec4 Sample( sampler2D tex2D, vec2 uv ) {\n\t\t\treturn graded( tex2D, uv );\n\t\t}")
    .replace(
      luma,
      /* glsl */ `float SampleLuminance( sampler2D tex2D, vec2 uv ) {
        float l = dot( texture( tex2D, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) ) * toneMappingExposure;
        return sqrt( l / ( 1.0 + l ) );
      }`,
    )
    .replace(
      main,
      /* glsl */ `void main() {
        vec4 col = uFxaa > 0.5 ? ApplyFXAA( tDiffuse, resolution.xy, vUv ) : graded( tDiffuse, vUv );
        float edge = max( 1.0 - vUv.x / uEdge.y, ( vUv.x - uEdge.z ) / ( 1.0 - uEdge.z ) );
        col.rgb = mix( col.rgb, vec3( 4.0, 8.0, 20.0 ) / 255.0, uEdge.x * clamp( edge, 0.0, 1.0 ) );
        gl_FragColor = vec4( min( col.rgb + uFlash, 1.0 ), col.a );
      }`,
    );
}

/** The fused final pass's shader (see finalFragmentShader). */
function finalShader(renderer: THREE.WebGLRenderer): THREE.ShaderMaterialParameters & {
  uniforms: Record<string, THREE.IUniform>;
} {
  const defines: Record<string, string> = {};
  if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) {
    defines.SRGB_TRANSFER = "";
  }
  if (renderer.toneMapping === THREE.ACESFilmicToneMapping) defines.ACES_FILMIC_TONE_MAPPING = "";
  else if (renderer.toneMapping === THREE.NeutralToneMapping) defines.NEUTRAL_TONE_MAPPING = "";
  else if (renderer.toneMapping === THREE.LinearToneMapping) defines.LINEAR_TONE_MAPPING = "";
  return {
    name: "FinalShader",
    defines,
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      toneMappingExposure: { value: renderer.toneMappingExposure },
      saturation: { value: DEFAULT_GRADE.saturation },
      contrast: { value: DEFAULT_GRADE.contrast },
      tint: { value: new THREE.Vector3(1, 1, 1) },
      vignette: { value: DEFAULT_GRADE.vignette },
      uFlash: { value: 0 },
      uFxaa: { value: 1 },
      uEdge: { value: new THREE.Vector3(...edgeShadeStops(0, 1)) },
    },
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: finalFragmentShader(),
  };
}

/** Push the current look's colour grade into the final pass (after a look change). */
export function applyGrade(b: Battle3D): void {
  if (!b.finalPass) return;
  const g = gradeFor(LOOK);
  const u = b.finalPass.material.uniforms;
  u["saturation"].value = g.saturation;
  u["contrast"].value = g.contrast;
  (u["tint"].value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
  u["vignette"].value = g.vignette;
  // setArenaLook rebuilt the light rig and the set: re-apply the shadow
  // and rim settings to the new lights and re-render the shadow map.
  applyLightQuality(b);
  markShadowsDirty(b);
}

/**
 * The edge shade's darkest alpha (over rgb(4, 8, 20)) at the screen's sides:
 * light, because the long sides are dressed (stands, pavilions, the outer
 * ring) and are worth seeing; it only settles the eye on the board.
 */
const EDGE_SHADE = 0.24;

/**
 * The edge shade's uniform for a board `fieldW` CSS px wide, centred on a
 * `w` CSS px wide canvas: [alpha, left stop, right stop] in uv. It fades
 * from the sides to clear at 22% / 78% of the width, or sooner where the
 * board starts further out; off (alpha 0) without a board or room for it.
 */
export function edgeShadeStops(fieldW: number, w: number): [number, number, number] {
  const half = fieldW / (2 * Math.max(1, w));
  const left = Math.min(0.22, 0.5 - half);
  if (!(fieldW > 0) || left <= 0) return [0, 0.22, 0.78];
  return [EDGE_SHADE, left, Math.max(0.78, 0.5 + half)];
}

/**
 * Wide battles: the world past the stands is bare in some arenas, so shade
 * the screen's outer edges to keep the eye on the board (`fieldW` CSS px
 * wide; 0 turns it off). Drawn in the final pass rather than as a CSS
 * overlay, which was one more full-screen layer to composite every frame.
 */
export function setEdgeShade(b: Battle3D, fieldW: number): void {
  if (fieldW === b.edgeFieldW) return; // a canvas resize re-applies it (applyQuality)
  b.edgeFieldW = fieldW;
  applyEdgeShade(b, b.container.clientWidth || 1);
}

function applyEdgeShade(b: Battle3D, w: number): void {
  if (!b.finalPass) return;
  (b.finalPass.material.uniforms["uEdge"].value as THREE.Vector3).set(...edgeShadeStops(b.edgeFieldW, w));
}

/** Additive white over the whole frame, 0..MAX_FLASH (spell impacts, KOs). */
export function setFlash(b: Battle3D, a: number): void {
  if (!b.finalPass) return;
  b.finalPass.material.uniforms["uFlash"].value = Math.max(0, Math.min(MAX_FLASH, a));
}

/** The battle renderer, mounted in `container`. */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  // Composer owns the final image; MSAA here would spend mobile bandwidth
  // before the post stack downsamples it again.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Everything that casts a shadow (the set, towers, buildings) stands
  // still, so the depth pass only runs when something marks it dirty.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // CR daylight grade: filmic tone mapping with a touch of extra
  // exposure keeps the greens punchy without blowing highlights.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

/** Anisotropic filtering for oblique ground textures, capped at 4x. */
export function maxAnisotropy(renderer: THREE.WebGLRenderer): number {
  return Math.min(4, renderer.capabilities.getMaxAnisotropy());
}

/**
 * Re-render the shadow map on the next frame: after the set or the light
 * rig is rebuilt, a tower or building appears or changes shape, and every
 * frame while one sinks or collapses.
 */
export function markShadowsDirty(b: Battle3D): void {
  b.renderer.shadowMap.needsUpdate = true;
}

export interface PostStack {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  finalPass: ShaderPass;
}

/** Build the composer for `b.scene` through `b.camera`. */
export function buildComposer(b: Battle3D): PostStack {
  // Bloom pipeline: only bright pixels (the unlit "glow" materials —
  // lanterns, spell FX, hit-sparks) bloom, so it stays subtle and cheap.
  const composer = new EffectComposer(b.renderer);
  composer.addPass(new RenderPass(b.scene, b.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  // One pass for tone mapping, sRGB output, the per-arena grade, FXAA and
  // the flash (formerly three separate full-screen passes).
  const finalPass = new ShaderPass(finalShader(b.renderer));
  // The shader tone-maps itself; keep three from adding its own chunk.
  finalPass.material.toneMapped = false;
  composer.addPass(finalPass);
  b.finalPass = finalPass;
  applyGrade(b);
  countShadowRenders(b);

  // Auto starts where this device left off (or at a first guess); then
  // Settings → Quality applies live (a ?quality= URL pin still wins).
  const device = configureAutoQuality(b);
  b.quality.setPref(getPrefs().quality);
  const q = b.quality;
  console.info(
    q.mode === "auto"
      ? `[graphics] auto starts at L${q.index} (${q.start.source}) on ${device}`
      : `[graphics] pinned ${q.mode} (L${q.index}); auto would start at L${q.start.level} (${q.start.source}) on ${device}`,
  );
  noteIfLow(b);
  onPrefs((p) => {
    // (A disposed scene has left the page; it no longer follows Settings.)
    if (b.quality.setPref(p.quality) && b.renderer.domElement.isConnected) {
      b.resize();
      noteIfLow(b);
    }
  });
  if (typeof document !== "undefined") {
    // Back from another tab: the gap says nothing about speed.
    document.addEventListener("visibilitychange", () => {
      b.lastFrameAt = 0;
      if (!document.hidden) b.quality.rearm();
    });
  }
  return { composer, bloom, finalPass };
}

/**
 * The WebGL renderer string, unmasked where the browser allows it (Chrome
 * masks gl.RENDERER as "WebKit WebGL" and answers through
 * WEBGL_debug_renderer_info; Firefox answers gl.RENDERER directly and warns
 * about the extension), or "" when it is hidden.
 */
export function rendererName(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const plain: unknown = gl.getParameter(gl.RENDERER);
    if (typeof plain === "string" && plain.trim() !== "" && !/^(webkit webgl|mozilla)$/i.test(plain.trim())) return plain;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const unmasked: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    if (typeof unmasked === "string" && unmasked.trim() !== "") return unmasked;
    return typeof plain === "string" ? plain : "";
  } catch {
    return "";
  }
}

function gfxStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Where Auto starts on this device (C44): its remembered level
 * ('cr-clone-gfx-memory'), else a first guess from the renderer string,
 * else the top of the ladder; and where it settles is remembered for next
 * time. ?gfxguess=off skips the first guess (for testing the slow-window
 * path on a software renderer). Never breaks boot: on any error Auto just
 * starts at the top, as before.
 */
function configureAutoQuality(b: Battle3D): string {
  try {
    registerGfxNote();
    const store = gfxStorage();
    const renderer = rendererName(b.renderer);
    const scr = typeof screen === "undefined" ? null : screen;
    const key = deviceKey(renderer, scr?.width ?? 0, scr?.height ?? 0, window.devicePixelRatio || 1);
    const build = gfxBuildTag(import.meta.url, import.meta.env.DEV);
    const guessOff = new URLSearchParams(location.search).get("gfxguess") === "off";
    const entry = readGfxMemory(store).find((e) => e.key === key);
    const start = autoStartFor(entry, guessOff ? 0 : firstGuessLevel(renderer), build, Date.now());
    b.quality.configure(start, (settled) => {
      writeGfxMemory(store, recordGfx(readGfxMemory(store), key, settled, build, Date.now()));
    });
    return key;
  } catch {
    // no memory, no guess: Auto starts at the top as before
    return "an unknown device";
  }
}

/** Auto graphics is on Low (the bottom level): queue the one-time note. */
function noteIfLow(b: Battle3D): void {
  if (b.quality.mode === "auto" && b.quality.index === QUALITY_LEVELS.length - 1) noteLowGraphics();
}

/** Count real shadow-map renders into b.shadowRenders (for budgets and tests). */
function countShadowRenders(b: Battle3D): void {
  const sm = b.renderer.shadowMap;
  const render = sm.render.bind(sm);
  sm.render = (lights, scene, camera) => {
    if (sm.enabled && (sm.autoUpdate || sm.needsUpdate) && lights.length > 0) b.shadowRenders++;
    render(lights, scene, camera);
  };
}

/** Renderers drawing the home diorama: lighter settings (see setDioramaQuality). */
const dioramaMode = new WeakSet<Battle3D>();

/** Auto levels from which a battle start prepares the other light state (L3 and L4). */
export const PREPARE_FROM = 3;
/** Scenes whose next battle frame should prepare the other light state first. */
const preparePending = new WeakSet<Battle3D>();

/** The rim lights: the directional lights that are neither the sun nor the fill. */
function rimLights(b: Battle3D): THREE.Light[] {
  return b.lightGroup.children.filter(
    (l): l is THREE.DirectionalLight => (l as THREE.DirectionalLight).isDirectionalLight === true && l !== b.sun && l !== b.fillLight,
  );
}

/**
 * C44: compile, without drawing, the shader variants for the other side of
 * the light-state line between L3 and L4 (the shadow map and the rim light
 * on or off), so a later step across it mid-fight (L3 down to L4, or the
 * once-per-session try from L4 up to L3) finds every lit program ready
 * instead of compiling them all in one long frame. three keeps each
 * material's programs per light state, so both sets stay live until the
 * material is disposed. Compiled as the composer's scene pass draws (into
 * its render target: linear, no tone mapping), so the keys match. Returns
 * the milliseconds it took.
 */
export function prepareLightVariants(b: Battle3D): number {
  const sun = b.sun;
  const r = b.renderer;
  if (!sun || !b.composer) return 0;
  const t0 = performance.now();
  const shadows = b.quality.level.shadowSize > 0;
  const rim = b.quality.level.rimLight;
  const rims = rimLights(b);
  const saved = { map: r.shadowMap.enabled, cast: sun.castShadow, rims: rims.map((l) => l.visible), target: r.getRenderTarget() };
  try {
    r.shadowMap.enabled = !shadows;
    sun.castShadow = !shadows;
    for (const l of rims) l.visible = !rim;
    r.setRenderTarget(b.composer.readBuffer);
    r.compile(b.scene, b.camera);
  } finally {
    r.shadowMap.enabled = saved.map;
    sun.castShadow = saved.cast;
    rims.forEach((l, i) => (l.visible = saved.rims[i]));
    r.setRenderTarget(saved.target);
  }
  return performance.now() - t0;
}

/**
 * The home screen's live arena is a small framed window behind the menus:
 * it renders without bloom at up to the battle's own resolution (lifecycle.ts
 * also halves its frame rate). Off restores the quality level's own settings.
 *
 * Called on every screen change, so off also re-arms the governor: a new
 * battle's start-up hitches (a rematch never passes the diorama) aren't
 * judged as its speed.
 */
export function setDioramaQuality(b: Battle3D, on: boolean): void {
  if (!on) {
    b.quality.rearm();
    // A battle (or the deck picker over one) is starting on a device Auto
    // runs at L3 or L4: get the other side of the light-state line ready
    // during its countdown (see prepareLightVariants).
    if (b.quality.mode === "auto" && b.quality.index >= PREPARE_FROM) preparePending.add(b);
  }
  if (on === dioramaMode.has(b)) return;
  if (on) dioramaMode.add(b);
  else dioramaMode.delete(b);
  b.lastFrameAt = 0; // frame times across the switch say nothing
  b.resize();
}

/**
 * The resolution cap for the diorama window: the battle's 2x, so the first
 * screen a parent sees is as sharp as the game (at 1.25x the keeps were mush
 * and the court's borders jagged on a 2x phone). It still runs at half the
 * frame rate and without bloom, so it costs less than a battle frame.
 */
export const DIORAMA_DPR = 2;

/**
 * The pixel ratio to render a w x h (CSS px) canvas at. A full-screen
 * desktop battle would draw up to 4x the pixels of the old phone-width
 * column, so each quality level holds a big canvas to its pixel budget,
 * trading resolution (never below the level's minScale device px per CSS
 * px) for frame rate. Phones (390x653 @3 at a 2x cap = 1.02M) sit under
 * every budget, so only dprCap moves them.
 */
export function renderDpr(
  w: number,
  h: number,
  device: number,
  level: Pick<QualityLevel, "dprCap" | "pixelBudget" | "minScale">,
  diorama: boolean,
): number {
  const budget = Math.max(level.minScale, Math.sqrt(level.pixelBudget / Math.max(1, w * h)));
  return Math.min(level.dprCap, diorama ? DIORAMA_DPR : Infinity, device || 1, budget);
}

/**
 * Device pixels above which full-size bloom drops to half size. Most phones
 * (a 390x844 screen's 390x653 board @2 = 1.02M) and a 1366x768 laptop
 * (1.05M) keep full bloom. The biggest phones do not: a 430x932 screen's
 * board is 430x727 @2 = 1.25M, as many pixels as a 1440x900 laptop (1.30M)
 * on a phone GPU, so it gets the same half-size bloom. Pixel count can't
 * tell those two apart, and the cheaper frame is the point.
 */
export const BLOOM_HALF_PX = 1.2e6;

/**
 * Bloom resolution as a share of the canvas (1 full, 0.5 half, 0 off) for a
 * level's `levelBloom` on a canvas of `devicePx` device pixels: full-size
 * bloom on a big canvas costs about 30% of the frame and looks much the
 * same at half size (L1's setting). The diorama never blooms.
 */
export function bloomScaleFor(levelBloom: number, devicePx: number, diorama: boolean): number {
  if (diorama) return 0;
  return levelBloom >= 1 && devicePx > BLOOM_HALF_PX ? 0.5 : levelBloom;
}

/** Size the renderer and post stack for the container at the current quality. */
export function applyQuality(b: Battle3D): void {
  const w = b.container.clientWidth || 1;
  const h = b.container.clientHeight || 1;
  const level = b.quality.level;
  const diorama = dioramaMode.has(b);
  const dpr = renderDpr(w, h, window.devicePixelRatio, level, diorama);
  const bloomScale = bloomScaleFor(level.bloom, w * h * dpr * dpr, diorama);
  b.bloom.enabled = bloomScale > 0;
  b.renderer.setPixelRatio(dpr);
  b.renderer.setSize(w, h, false);
  b.composer.setPixelRatio(dpr);
  b.composer.setSize(w, h);
  // UnrealBloomPass already blurs from a half-size target; a bloom scale
  // below 1 shrinks the whole chain further (L1: a quarter of the canvas).
  if (bloomScale > 0 && bloomScale < 1) {
    b.bloom.setSize(Math.max(2, Math.round(w * dpr * bloomScale)), Math.max(2, Math.round(h * dpr * bloomScale)));
  }
  const u = b.finalPass.material.uniforms;
  (u["resolution"].value as THREE.Vector2).set(1 / (w * dpr), 1 / (h * dpr));
  u["uFxaa"].value = level.fxaa ? 1 : 0;
  applyEdgeShade(b, w);
  applyLightQuality(b);
  setOutlinesVisible(outlinesEnabled());
  applyArenaQuality(b, level);
}

/**
 * The quality level's lighting: sun shadow-map size (or no shadow map at
 * all on the lowest level, where only contact and blob shadows remain) and
 * the cool back-rim light.
 */
function applyLightQuality(b: Battle3D): void {
  const level = b.quality.level;
  const sun = b.sun;
  if (!sun) return;
  const shadows = level.shadowSize > 0;
  if (b.renderer.shadowMap.enabled !== shadows || sun.castShadow !== shadows) {
    // Toggling the light's shadow changes the light state, so every lit
    // material picks up a matching shader variant on its next draw.
    b.renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    markShadowsDirty(b);
  }
  if (shadows && sun.shadow.mapSize.x !== level.shadowSize) {
    sun.shadow.mapSize.set(level.shadowSize, level.shadowSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // reallocated at the new size on the next render
    markShadowsDirty(b);
  }
  syncTroopCasters(b);
  // The rim is the only directional light that is neither the sun nor the fill.
  for (const light of b.lightGroup.children) {
    if ((light as THREE.DirectionalLight).isDirectionalLight && light !== sun && light !== b.fillLight) {
      light.visible = level.rimLight;
    }
  }
}

const dynState = new WeakMap<Battle3D, boolean>();

/**
 * Real troop shadows follow the LIVE level: every mesh flagged
 * userData.troopCaster joins or leaves the sun's casters whenever the level's
 * answer changes (a Settings change, or the governor stepping down), and the
 * map re-renders once more so no shadow is left frozen where a troop stood.
 * Cheap enough to check every frame (one boolean compare).
 */
function syncTroopCasters(b: Battle3D): void {
  const dyn = dynamicShadows(b);
  if (dynState.get(b) === dyn) return;
  dynState.set(b, dyn);
  b.scene.traverse((o) => {
    if (o.userData.troopCaster) o.castShadow = dyn;
  });
  markShadowsDirty(b);
}

/**
 * Whether troops cast real shadows at this quality: the top level only
 * (QualityLevel.troopShadows). The shadow pass then draws every
 * troop a second time each frame, so the governor's first step down sheds
 * it; lower levels keep the static map and the blob shadows. Both editions.
 */
export function dynamicShadows(b: Battle3D): boolean {
  return troopShadowLevel(b.quality.level);
}

/** Shadow casters each troop may add to the per-frame shadow pass. */
export const TROOP_CASTERS_PER_UNIT = 1;

/**
 * The level test behind dynamicShadows, for code that has no scene at hand:
 * the level's own troopShadows flag (L0 only), on a level that has a shadow
 * map at all. With no argument it reads the live level
 * (quality.currentQuality()), so a troop built after a step-down never casts
 * a frozen shadow.
 */
export function troopShadowLevel(level: Pick<QualityLevel, "shadowSize" | "troopShadows"> = currentQuality()): boolean {
  return level.troopShadows && level.shadowSize > 0;
}

/**
 * Flag `mesh` as its troop's shadow caster (one per unit) and set its
 * castShadow for the live level; post.ts keeps it in step from then on.
 */
export function registerTroopCaster(mesh: THREE.Object3D): void {
  mesh.userData.troopCaster = true;
  mesh.castShadow = troopShadowLevel();
}

/** True for one more frame after a tower stops sinking, to drop its shadow. */
const sinkingLastFrame = new WeakSet<Battle3D>();

/**
 * After each frame: feed the frame time to the quality governor (re-size
 * when it steps), and keep the shadow map fresh while a tower or building
 * sinks or collapses.
 */
export function sampleQuality(b: Battle3D): void {
  syncTroopCasters(b);
  const sinking = b.dying.some((d) => !d.view.isTroop);
  if (sinking || sinkingLastFrame.has(b) || dynamicShadows(b)) markShadowsDirty(b);
  if (sinking) sinkingLastFrame.add(b);
  else sinkingLastFrame.delete(b);

  if (preparePending.has(b)) {
    // The battle's first frame has drawn (its own programs are built): now
    // the other light state, inside the start-up grace, before any step.
    preparePending.delete(b);
    try {
      const ms = prepareLightVariants(b);
      console.info(`[graphics] prepared the other light state in ${Math.round(ms)} ms`);
    } catch {
      // never worth a broken frame: a later step just compiles as before
    }
    b.lastFrameAt = 0; // the compile is not a frame time
    return;
  }
  const now = performance.now();
  if (dioramaMode.has(b)) {
    // The diorama renders every other frame on purpose: not a speed signal.
    b.lastFrameAt = 0;
    return;
  }
  const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  if (b.lastFrameAt > 0 && b.quality.sample((now - b.lastFrameAt) / 1000, visible)) {
    b.resize();
    if (b.quality.mode === "auto") console.info(`[graphics] auto: L${b.quality.index}`);
    noteIfLow(b);
  }
  b.lastFrameAt = now;
}
