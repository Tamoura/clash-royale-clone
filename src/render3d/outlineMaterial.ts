/**
 * The ink outline every character shares: one back-face ShaderMaterial that
 * pushes each vertex outward in CLIP space along a smoothed normal, so the
 * line is the same width on screen (2 CSS px) for a Knight and a Giant, at
 * any zoom or device pixel ratio. The old hull scaled each mesh by 7.5 %,
 * which made big bodies fat-lined and small parts hairline, and cost one
 * hull draw per part; a baked rig now needs one outline mesh per animated
 * node.
 *
 * Geometry carries an `outlineNormal` attribute: the vertex normals averaged
 * over every vertex at the same position, so hard edges (boxes, cones) and
 * sphere seams extrude together instead of tearing open.
 */
import * as THREE from "three";

/** Outline width in CSS pixels (the device-pixel width scales with the DPR). */
export const OUTLINE_CSS_PX = 2;
/** Near-black ink with a touch of blue, like the old hull. */
export const OUTLINE_COLOR = 0x0b0e16;
/** Parts whose bounding radius (in their node's units) is below this stay unlined. */
export const OUTLINE_MIN_RADIUS = 0.05;

const VERT = /* glsl */ `
  attribute vec3 outlineNormal;
  uniform float uOutlinePx;
  uniform vec2 uViewport;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 nView = normalize(normalMatrix * outlineNormal);
    vec2 nClip = (projectionMatrix * vec4(nView, 0.0)).xy;
    float len = length(nClip);
    if (len > 1e-5) {
      clip.xy += (nClip / len) * uOutlinePx * 2.0 / uViewport * clip.w;
    }
    gl_Position = clip;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

/**
 * The ink uniforms, shared by the standalone hull material and by baked
 * materials that carry their own ink triangles (see installInk): one set of
 * values for the whole battle, refreshed by fitInk.
 */
export const INK = {
  uInkPx: { value: OUTLINE_CSS_PX * 2 },
  uInkViewport: { value: new THREE.Vector2(390, 844) },
  uInkOn: { value: 1 },
  uInkColor: { value: new THREE.Color(OUTLINE_COLOR) },
};

let shared: THREE.ShaderMaterial | null = null;

/** The one outline material (never disposed per unit). */
export function outlineMaterial(): THREE.ShaderMaterial {
  if (!shared) {
    shared = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uOutlinePx: INK.uInkPx, uViewport: INK.uInkViewport, uColor: INK.uInkColor },
      side: THREE.BackSide,
      fog: false,
    });
    shared.name = "outline";
    shared.userData.shared = true;
  }
  return shared;
}

const SIZE = new THREE.Vector2();
let lastW = 0;
let lastH = 0;
let lastDpr = 0;

/**
 * onBeforeRender hook for anything that draws ink: keeps the line 2 CSS px
 * wide for whichever renderer is drawing (the battle, a card portrait, the
 * gallery), refreshing the shared uniforms only when its buffer changed.
 */
export function fitInk(renderer: THREE.WebGLRenderer): void {
  renderer.getDrawingBufferSize(SIZE);
  const dpr = renderer.getPixelRatio();
  if (SIZE.x === lastW && SIZE.y === lastH && dpr === lastDpr) return;
  lastW = SIZE.x;
  lastH = SIZE.y;
  lastDpr = dpr;
  INK.uInkViewport.value.set(Math.max(1, SIZE.x), Math.max(1, SIZE.y));
  INK.uInkPx.value = OUTLINE_CSS_PX * dpr;
  if (shared) shared.uniformsNeedUpdate = true;
}

/**
 * Baked geometries whose ink triangles sit after the body's in one index
 * buffer, with the body's index count. With ink off the draw range stops at
 * the body, so the hidden shell costs no vertex work at all.
 */
const inkGeometries = new Map<THREE.BufferGeometry, number>();
let inkVisible = true;

function applyInkRange(g: THREE.BufferGeometry, bodyCount: number): void {
  g.setDrawRange(0, inkVisible ? Infinity : bodyCount);
}

/** Track a baked geometry whose first `bodyIndexCount` indices are the body. */
export function registerInkGeometry(g: THREE.BufferGeometry, bodyIndexCount: number): void {
  inkGeometries.set(g, bodyIndexCount);
  applyInkRange(g, bodyIndexCount);
  g.addEventListener("dispose", () => inkGeometries.delete(g));
}

/** Show or hide every outline at once (quality L4 turns them off). */
export function setOutlinesVisible(on: boolean): void {
  outlineMaterial().visible = on;
  INK.uInkOn.value = on ? 1 : 0;
  inkVisible = on;
  for (const [g, n] of inkGeometries) applyInkRange(g, n);
}

/**
 * Teach a lit material to draw ink from its own geometry: vertices with a
 * non-zero `outlineNormal` are hull vertices (wound inside-out so a
 * front-face material shows exactly what a back-face one would). They are
 * pushed out along that normal in clip space and painted ink-black. One
 * mesh then draws a node's body and its outline in a single call.
 */
export function installInk(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }): void {
  Object.assign(shader.uniforms, INK);
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       attribute vec3 outlineNormal;
       uniform float uInkPx;
       uniform vec2 uInkViewport;
       uniform float uInkOn;
       varying float vInk;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       vInk = dot(outlineNormal, outlineNormal) > 0.25 ? 1.0 : 0.0;
       if (vInk > 0.5) {
         if (uInkOn < 0.5) {
           gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
         } else {
           vec3 nView = normalize(normalMatrix * outlineNormal);
           vec2 nClip = (projectionMatrix * vec4(nView, 0.0)).xy;
           float nLen = length(nClip);
           if (nLen > 1e-5) gl_Position.xy += (nClip / nLen) * uInkPx * 2.0 / uInkViewport * gl_Position.w;
         }
       }`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>
     uniform vec3 uInkColor;
     varying float vInk;`,
  );
}

/** GLSL for the end of a fragment shader: ink pixels are flat ink colour. */
export const INK_FRAGMENT = "if (vInk > 0.5) { gl_FragColor = vec4(uInkColor, 1.0); } else {";

/** The current outline width in device pixels (for tools and tests). */
export function outlineDevicePx(): number {
  return outlineMaterial().uniforms.uOutlinePx.value as number;
}

/**
 * Per-vertex normals averaged over coincident vertices (same position to
 * 1e-4), normalised. Pure: returns a new array, three floats per vertex.
 */
export function smoothedNormals(geo: THREE.BufferGeometry): Float32Array {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const out = new Float32Array(pos.count * 3);
  if (!nor) return out;
  const sums = new Map<string, [number, number, number]>();
  // Each distinct (position, normal) pair counts once, so a corner shared by
  // many triangles (a non-indexed box) is not weighted by how it was cut up.
  const seen = new Set<string>();
  const keyOf = (i: number): string =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const pair = `${k}|${Math.round(nor.getX(i) * 1e3)},${Math.round(nor.getY(i) * 1e3)},${Math.round(nor.getZ(i) * 1e3)}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    let s = sums.get(k);
    if (!s) {
      s = [0, 0, 0];
      sums.set(k, s);
    }
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keyOf(i))!;
    const len = Math.hypot(s[0], s[1], s[2]);
    if (len > 1e-6) {
      out[i * 3] = s[0] / len;
      out[i * 3 + 1] = s[1] / len;
      out[i * 3 + 2] = s[2] / len;
    } else {
      out[i * 3] = nor.getX(i);
      out[i * 3 + 1] = nor.getY(i);
      out[i * 3 + 2] = nor.getZ(i);
    }
  }
  return out;
}

/** Add the smoothed `outlineNormal` attribute once (idempotent). */
export function ensureOutlineNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.getAttribute("outlineNormal")) {
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    geo.setAttribute("outlineNormal", new THREE.BufferAttribute(smoothedNormals(geo), 3));
  }
  return geo;
}

/** An outline mesh drawing `geo` with the shared material. */
export function outlineHull(geo: THREE.BufferGeometry): THREE.Mesh {
  ensureOutlineNormals(geo);
  const hull = new THREE.Mesh(geo, outlineMaterial());
  hull.name = "outline";
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.onBeforeRender = fitInk;
  return hull;
}
