/**
 * Ground decals: one InstancedMesh of flat quads (scorch, frost, crack,
 * heal glyph, crater, ring, falling shadow, rune circle) drawn from the
 * decal atlas. At most DECAL_CAP marks exist; a new one takes a dead slot
 * or else recycles the oldest. Each mark grows in, holds, then fades over
 * the last third of its life (6-8 s by default). They sit just above the
 * ground with a polygon offset and draw before the deploy-zone overlay.
 */
import * as THREE from "three";
import type { DecalKindName } from "./api";
import { DECAL_CELL, DECAL_COLS, DECAL_ROWS, makeDecalAtlas } from "./atlas";

export const DECAL_CAP = 16;
/** Default decal life in seconds (the spec's 6-8 s window). */
export const DECAL_LIFE = 7;

export interface DecalOpts {
  color?: number;
  /** Seconds the mark lasts, fade included. */
  life?: number;
  /** Seconds before the mark appears. */
  delay?: number;
  /** Starting radius (defaults to 70% of r); a larger r0 shrinks the mark. */
  r0?: number;
  /** Seconds to go from r0 to r (defaults to 0.18; shrinking marks use their life). */
  grow?: number;
  /** Peak opacity (default 1). */
  alpha?: number;
  /** Colour multiplier (HDR glow for rings). */
  hdr?: number;
}

/**
 * The slot a new decal takes at pool time `now`: the first dead slot, or
 * else the one born longest ago.
 */
export function pickDecalSlot(births: ArrayLike<number>, lives: ArrayLike<number>, now: number): number {
  let oldest = 0;
  for (let i = 0; i < births.length; i++) {
    if (now > births[i] + lives[i]) return i;
    if (births[i] < births[oldest]) oldest = i;
  }
  return oldest;
}

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // x, z, r0, r1
attribute vec4 aB; // birth, life, cell, grow
attribute vec4 aC; // rgba
attribute vec4 aD; // rotation
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float age = uTime - aB.x;
  if (age < 0.0 || age > aB.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vCol = vec4(0.0);
    return;
  }
  float t = age / aB.y;
  float g = clamp(age / max(aB.w, 1e-3), 0.0, 1.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  float r = mix(aA.z, aA.w, g);
  float cr = cos(aD.x);
  float sr = sin(aD.x);
  vec2 c = position.xy;
  vec2 o = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * r * 2.0;
  float cell = aB.z;
  vec2 cxy = vec2(mod(cell, ${DECAL_COLS}.0), floor(cell / ${DECAL_COLS}.0));
  vUv = vec2((cxy.x + uv.x) / ${DECAL_COLS}.0, (${DECAL_ROWS - 1}.0 - cxy.y + uv.y) / ${DECAL_ROWS}.0);
  vCol = aC;
  vCol.a *= min(1.0, age / 0.08) * (1.0 - smoothstep(0.66, 1.0, t));
  gl_Position = projectionMatrix * viewMatrix * vec4(aA.x + o.x, 0.012, aA.y + o.y, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * tex.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const TMP = new THREE.Color();

export class DecalLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly births = new Float32Array(DECAL_CAP).fill(-1e6);
  readonly lives = new Float32Array(DECAL_CAP);
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly c: THREE.InstancedBufferAttribute;
  private readonly d: THREE.InstancedBufferAttribute;
  private dirty = false;
  private liveUntil = -1;
  private spin = 0;

  constructor(uTime: { value: number }, arabic: boolean) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const attr = (name: string): THREE.InstancedBufferAttribute => {
      const x = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_CAP * 4), 4);
      x.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, x);
      return x;
    };
    this.a = attr("aA");
    this.b = attr("aB");
    this.c = attr("aC");
    this.d = attr("aD");
    for (let i = 0; i < DECAL_CAP; i++) this.b.array[i * 4] = -1e6;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime, uMap: { value: makeDecalAtlas(arabic) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    mat.userData.shared = true;
    this.mesh = new THREE.InstancedMesh(geo, mat, DECAL_CAP);
    this.mesh.count = DECAL_CAP;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // Transparent objects sort by renderOrder first: marks go down before
    // the deploy-zone overlay (renderOrder 0) and every other effect.
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
  }

  /** A mark of radius `r` at world (wx, wz), born at pool time `now`. */
  add(kind: DecalKindName, wx: number, wz: number, r: number, now: number, o?: DecalOpts): number {
    const i = pickDecalSlot(this.births, this.lives, now);
    const life = o?.life ?? DECAL_LIFE;
    const birth = now + (o?.delay ?? 0);
    const r0 = o?.r0 ?? r * 0.7;
    this.births[i] = birth;
    this.lives[i] = life;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    const D = this.d.array as Float32Array;
    const k = i * 4;
    A[k] = wx;
    A[k + 1] = wz;
    A[k + 2] = r0;
    A[k + 3] = r;
    B[k] = birth;
    B[k + 1] = life;
    B[k + 2] = DECAL_CELL[kind];
    B[k + 3] = o?.grow ?? (r0 > r ? life : 0.18);
    TMP.setHex(o?.color ?? 0xffffff);
    const h = o?.hdr ?? 1;
    C[k] = TMP.r * h;
    C[k + 1] = TMP.g * h;
    C[k + 2] = TMP.b * h;
    C[k + 3] = o?.alpha ?? 1;
    // A golden-angle twist per mark so repeated scorches never line up.
    this.spin += 2.39996;
    D[k] = kind === "ring" || kind === "shadow" ? 0 : this.spin;
    this.dirty = true;
    this.liveUntil = Math.max(this.liveUntil, birth + life);
    return i;
  }

  flush(now: number): void {
    if (this.dirty) {
      for (const x of [this.a, this.b, this.c, this.d]) {
        x.clearUpdateRanges();
        x.needsUpdate = true; // 16 instances: upload them whole
      }
      this.dirty = false;
    }
    this.mesh.visible = now <= this.liveUntil;
  }

  reset(): void {
    this.births.fill(-1e6);
    const B = this.b.array as Float32Array;
    for (let i = 0; i < DECAL_CAP; i++) B[i * 4] = -1e6;
    this.dirty = true;
    this.liveUntil = -1;
    this.mesh.visible = false;
  }
}
