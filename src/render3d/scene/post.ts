/**
 * Renderer and post stack: the WebGL renderer with soft shadows and filmic
 * tone mapping, the composer (render, bloom, output, per-arena colour
 * grade, FXAA), and the adaptive-quality resolution/bloom application.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import type { Battle3D } from "../scene3d";
import { LOOK } from "./common";


/** Display-space colour grade: saturation, contrast, tint, vignette. */
const DEFAULT_GRADE = { saturation: 1.1, contrast: 1.05, tint: [1, 1, 1] as [number, number, number], vignette: 0.3 };
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.1 },
    contrast: { value: 1.05 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform vec3 tint;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= tint;
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.35, 0.95, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/** Push the current look's colour grade into the grade pass. */
export function applyGrade(b: Battle3D): void {
  if (!b.grade) return;
  const g = { ...DEFAULT_GRADE, ...(LOOK.grade ?? {}) };
  const u = b.grade.material.uniforms;
  u["saturation"].value = g.saturation;
  u["contrast"].value = g.contrast;
  (u["tint"].value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
  u["vignette"].value = g.vignette;
}

/** The battle renderer, mounted in `container`. */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  // Composer owns the final image; MSAA here would spend mobile bandwidth
  // before the post stack downsamples it again.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // CR daylight grade: filmic tone mapping with a touch of extra
  // exposure keeps the greens punchy without blowing highlights.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

export interface PostStack {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  outputPass: OutputPass;
  grade: ShaderPass;
  fxaa: ShaderPass;
}

/** Build the composer for `b.scene` through `b.camera`. */
export function buildComposer(b: Battle3D): PostStack {
  // Bloom pipeline: only bright pixels (the unlit "glow" materials —
  // lanterns, spell FX, hit-sparks) bloom, so it stays subtle and cheap.
  const composer = new EffectComposer(b.renderer);
  composer.addPass(new RenderPass(b.scene, b.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.34, 0.9);
  composer.addPass(bloom);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);
  // Per-arena colour grade (saturation, contrast, tint, vignette) in
  // display space: the final "painted" push each world gets.
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  b.grade = grade;
  applyGrade(b);
  // FXAA last: smooths the toon silhouettes the raw composer leaves
  // jagged (MSAA is off because the post stack would discard it anyway).
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  return { composer, bloom, outputPass, grade, fxaa };
}

/** Size the renderer and post stack for the container at the current quality. */
export function applyQuality(b: Battle3D): void {
  const w = b.container.clientWidth || 1;
  const h = b.container.clientHeight || 1;
  // Full retina sharpness everywhere (capped at 2x): the old 1.5x mobile
  // cap left phones — where most play happens — visibly soft.
  const dpr = Math.min(b.quality.level.dprCap, window.devicePixelRatio || 1);
  b.bloom.enabled = b.quality.level.bloom;
  b.renderer.setPixelRatio(dpr);
  b.renderer.setSize(w, h, false);
  b.composer.setPixelRatio(dpr);
  b.composer.setSize(w, h);
  const res = b.fxaa.material.uniforms["resolution"].value as THREE.Vector2;
  res.set(1 / (w * dpr), 1 / (h * dpr));
}

/** Feed the frame time to the quality governor; re-size when it steps. */
export function sampleQuality(b: Battle3D): void {
  const now = performance.now();
  if (b.lastFrameAt > 0 && b.quality.sample((now - b.lastFrameAt) / 1000)) b.resize();
  b.lastFrameAt = now;
}
