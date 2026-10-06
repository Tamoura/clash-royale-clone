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

/** Display-space colour grade defaults: saturation, contrast, tint, vignette. */
const DEFAULT_GRADE = { saturation: 1.1, contrast: 1.05, tint: [1, 1, 1] as [number, number, number], vignette: 0.3 };

/**
 * The whole display transform in one full-screen pass:
 *   graded(uv) = grade(sRGB(ACES(exposure · hdr(uv))))   (the old Output + Grade passes)
 * FXAA then runs on the graded colour: three's FXAA reads every texel
 * through one Sample() hook, which is rewired to graded(). A white
 * additive flash goes on last.
 */
export function finalFragmentShader(): string {
  const fxaa = FXAAShader.fragmentShader;
  const sample = /vec4 Sample\(\s*sampler2D\s+tex2D,\s*vec2 uv\s*\)\s*\{[^}]*\}/;
  const main = /void main\(\)\s*\{[^}]*\}\s*$/;
  if (!sample.test(fxaa) || !main.test(fxaa)) {
    throw new Error("FXAAShader layout changed: update finalFragmentShader()");
  }
  const graded = /* glsl */ `
    uniform float saturation;
    uniform float contrast;
    uniform vec3 tint;
    uniform float vignette;
    uniform float uFlash;
    uniform float uFxaa;

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
      vec2 d = uv - 0.5;
      col *= 1.0 - vignette * smoothstep( 0.35, 0.95, dot( d, d ) * 2.2 );
      return vec4( clamp( col, 0.0, 1.0 ), c.a );
    }`;
  return fxaa
    .replace("varying vec2 vUv;", `varying vec2 vUv;\n${graded}`)
    .replace(sample, "vec4 Sample( sampler2D tex2D, vec2 uv ) {\n\t\t\treturn graded( tex2D, uv );\n\t\t}")
    .replace(
      main,
      /* glsl */ `void main() {
        vec4 col = uFxaa > 0.5 ? ApplyFXAA( tDiffuse, resolution.xy, vUv ) : graded( tDiffuse, vUv );
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
    },
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: finalFragmentShader(),
  };
}

/** Push the current look's colour grade into the final pass (after a look change). */
export function applyGrade(b: Battle3D): void {
  if (!b.finalPass) return;
  const g = { ...DEFAULT_GRADE, ...(LOOK.grade ?? {}) };
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

/** Additive white over the whole frame, 0..1 (spell impacts, KOs). */
export function setFlash(b: Battle3D, a: number): void {
  if (!b.finalPass) return;
  b.finalPass.material.uniforms["uFlash"].value = Math.max(0, Math.min(1, a));
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.34, 0.9);
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

  // Settings → Quality applies live (a ?quality= URL pin still wins).
  b.quality.setPref(getPrefs().quality);
  onPrefs((p) => {
    // (A disposed scene has left the page; it no longer follows Settings.)
    if (b.quality.setPref(p.quality) && b.renderer.domElement.isConnected) b.resize();
  });
  return { composer, bloom, finalPass };
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

/**
 * The home screen's live arena is a small framed window behind the menus:
 * it renders at most at 1.25x without bloom (lifecycle.ts also halves its
 * frame rate). Off restores the quality level's own settings.
 */
export function setDioramaQuality(b: Battle3D, on: boolean): void {
  if (on === dioramaMode.has(b)) return;
  if (on) dioramaMode.add(b);
  else dioramaMode.delete(b);
  b.lastFrameAt = 0; // frame times across the switch say nothing
  b.resize();
}

/** The resolution cap for the diorama window. */
export const DIORAMA_DPR = 1.25;

/** Size the renderer and post stack for the container at the current quality. */
export function applyQuality(b: Battle3D): void {
  const w = b.container.clientWidth || 1;
  const h = b.container.clientHeight || 1;
  const level = b.quality.level;
  const diorama = dioramaMode.has(b);
  const dpr = Math.min(level.dprCap, diorama ? DIORAMA_DPR : Infinity, window.devicePixelRatio || 1);
  const bloomScale = diorama ? 0 : level.bloom;
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
  applyLightQuality(b);
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
  // The rim is the only directional light that is neither the sun nor the fill.
  for (const light of b.lightGroup.children) {
    if ((light as THREE.DirectionalLight).isDirectionalLight && light !== sun && light !== b.fillLight) {
      light.visible = level.rimLight;
    }
  }
}

/** True for one more frame after a tower stops sinking, to drop its shadow. */
const sinkingLastFrame = new WeakSet<Battle3D>();

/**
 * After each frame: feed the frame time to the quality governor (re-size
 * when it steps), and keep the shadow map fresh while a tower or building
 * sinks or collapses.
 */
export function sampleQuality(b: Battle3D): void {
  const sinking = b.dying.some((d) => !d.view.isTroop);
  if (sinking || sinkingLastFrame.has(b)) markShadowsDirty(b);
  if (sinking) sinkingLastFrame.add(b);
  else sinkingLastFrame.delete(b);

  const now = performance.now();
  if (dioramaMode.has(b)) {
    // The diorama renders every other frame on purpose: not a speed signal.
    b.lastFrameAt = 0;
    return;
  }
  if (b.lastFrameAt > 0 && b.quality.sample((now - b.lastFrameAt) / 1000)) b.resize();
  b.lastFrameAt = now;
}
