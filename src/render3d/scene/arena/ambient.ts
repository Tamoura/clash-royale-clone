/**
 * Ambient weather: one THREE.Points of 20-60 particles per look.ambient,
 * moved entirely in a tiny vertex shader from a time uniform, so the CPU
 * only writes a few uniforms per frame (no allocation, no buffer uploads).
 * Fireflies blink, snow falls, embers rise, sand drifts low, petals and
 * leaves tumble, stars twinkle. Counts scale with particleScale(); reduced
 * motion slows everything and stops the blinking.
 */
import * as THREE from "three";
import type { AmbientKind, ArenaLook } from "../../arenaLooks";
import { particleScale } from "../../quality";

const KIND_ID: Record<Exclude<AmbientKind, "none">, number> = {
  fireflies: 0, snow: 1, embers: 2, leaves: 3, sand: 4, petals: 5, stars: 6,
};

/** Particles at full quality, per kind (always within 20..60). */
export const AMBIENT_COUNT: Record<Exclude<AmbientKind, "none">, number> = {
  fireflies: 30, snow: 60, embers: 44, leaves: 26, sand: 52, petals: 28, stars: 36,
};

/** World box the weather lives in: the visible board plus the backdrop band. */
const BOX_MIN = new THREE.Vector3(-10.5, 0.2, -21);
const BOX_SIZE = new THREE.Vector3(21, 6.5, 40);

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uKind;
  uniform float uPx;
  uniform float uSpeed;
  uniform vec3 uMin;
  uniform vec3 uSize;
  attribute vec4 aRand;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    float t = uTime * uSpeed;
    vec3 p = uMin + position * uSize;
    float ph = aRand.x * 6.2832;
    float size = 0.16;
    vAlpha = 1.0;
    vSpin = 0.0;
    if (uKind < 0.5) {
      // Fireflies wander in loops and blink.
      p += vec3(sin(t * (0.4 + aRand.y * 0.5) + ph), sin(t * (0.7 + aRand.z) + ph) * 0.5, cos(t * (0.35 + aRand.w * 0.4) + ph)) * 0.9;
      p.y = uMin.y + 0.3 + position.y * 2.2;
      vAlpha = smoothstep(0.1, 0.9, sin(t * (1.2 + aRand.z * 1.6) + ph * 3.0) * 0.5 + 0.5);
      size = 0.22;
    } else if (uKind < 1.5) {
      // Snow falls and sways.
      p.y = uMin.y + mod(position.y * uSize.y - t * (0.7 + aRand.y * 0.5), uSize.y);
      p.x += sin(t * 0.8 + ph) * 0.4;
      p.z += cos(t * 0.6 + ph) * 0.3;
      size = 0.1 + aRand.z * 0.09;
    } else if (uKind < 2.5) {
      // Embers rise, flicker and burn out near the top.
      float h = mod(position.y * uSize.y + t * (0.8 + aRand.y * 0.9), uSize.y);
      p.y = uMin.y + h;
      p.x += sin(t * 1.3 + ph) * 0.35;
      vAlpha = (1.0 - h / uSize.y) * (0.6 + 0.4 * sin(t * 9.0 + ph));
      size = 0.08 + aRand.z * 0.08;
    } else if (uKind < 3.5 || (uKind > 4.5 && uKind < 5.5)) {
      // Leaves and petals tumble down on the breeze.
      p.y = uMin.y + mod(position.y * uSize.y - t * (0.35 + aRand.y * 0.25), uSize.y);
      p.x = uMin.x + mod(position.x * uSize.x + t * (0.5 + aRand.z * 0.4) + sin(t + ph) * 0.6, uSize.x);
      vSpin = t * (1.5 + aRand.w * 2.0) + ph;
      size = uKind < 3.5 ? 0.24 : 0.18;
    } else if (uKind < 4.5) {
      // Sand streams low and fast across the court.
      p.x = uMin.x + mod(position.x * uSize.x + t * (2.4 + aRand.y * 1.6), uSize.x);
      p.y = uMin.y + position.y * 0.9 + sin(t * 2.0 + ph) * 0.1;
      vAlpha = 0.65;
      size = 0.07 + aRand.z * 0.05;
    } else {
      // Stars: motes of light hanging in the air, twinkling.
      vAlpha = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.5 + aRand.y * 2.5) + ph), 3.0);
      size = 0.12 + aRand.z * 0.08;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.5, size * uPx);
  }
`;

const FRAG = /* glsl */ `
  uniform float uKind;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (uKind > 2.5 && uKind < 3.5 || uKind > 4.5 && uKind < 5.5) {
      // A tumbling leaf/petal: an ellipse that flips as it turns.
      float s = sin(vSpin);
      float k = cos(vSpin);
      vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
      r.y /= max(0.25, abs(sin(vSpin * 0.7)));
      float d = length(r * vec2(1.0, 2.0));
      a = 1.0 - smoothstep(0.38, 0.5, d);
      if (uKind < 3.5) a *= 0.75 + 0.25 * step(0.03, abs(r.y));
    } else {
      float d = length(c) * 2.0;
      a = uKind < 1.5 && uKind > 0.5 ? 1.0 - smoothstep(0.6, 1.0, d) : pow(max(0.0, 1.0 - d), 1.6);
    }
    a *= vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Colour per kind; glowing kinds are HDR so the bloom pass picks them up. */
function colorFor(kind: Exclude<AmbientKind, "none">, look: ArenaLook): THREE.Color {
  switch (kind) {
    case "fireflies":
      return new THREE.Color(look.lanterns?.[0] ?? 0xd8ff6a).multiplyScalar(2.2);
    case "embers":
      return new THREE.Color(0xff8a3a).multiplyScalar(2.6);
    case "stars":
      return new THREE.Color(0xfff2c8).multiplyScalar(1.8);
    case "snow":
      return new THREE.Color(0xffffff);
    case "sand":
      return new THREE.Color(look.drift).lerp(new THREE.Color(0xfff0d0), 0.4);
    case "petals":
      return new THREE.Color(0xffb0c8);
    case "leaves":
      return new THREE.Color(look.tree.leafB).lerp(new THREE.Color(0xd8c040), 0.25);
  }
}

export interface Ambient {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  count: number;
}

/** Build the weather for `look`, or null for "none". `seed` keeps it deterministic. */
export function buildAmbient(look: ArenaLook, seed: number): Ambient | null {
  if (look.ambient === "none") return null;
  const kind = look.ambient;
  const count = Math.max(20, Math.min(60, Math.round(AMBIENT_COUNT[kind] * particleScale())));
  let s = seed >>> 0 || 1;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rand();
    pos[i * 3 + 1] = rand();
    pos[i * 3 + 2] = rand();
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rnd, 4));
  const glows = kind === "fireflies" || kind === "embers" || kind === "stars";
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uKind: { value: KIND_ID[kind] },
      uPx: { value: 20 },
      uSpeed: { value: 1 },
      uMin: { value: BOX_MIN.clone() },
      uSize: { value: BOX_SIZE.clone() },
      uColor: { value: colorFor(kind, look) },
      uOpacity: { value: kind === "snow" ? 0.85 : 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: glows ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: !glows,
  });
  const points = new THREE.Points(geo, material);
  points.name = "ambient";
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.userData.noBatch = true;
  return { points, material, count };
}

/**
 * Per frame: advance time and fit point sizes to the frame. `pxPerUnit` is
 * drawing-buffer pixels per world unit. Writes uniforms only.
 */
export function updateAmbient(a: Ambient, time: number, pxPerUnit: number, reduced: boolean): void {
  const u = a.material.uniforms;
  u["uTime"].value = time;
  u["uPx"].value = pxPerUnit;
  u["uSpeed"].value = reduced ? 0.4 : 1;
}

/** Points are skipped by disposeDeep (it frees meshes only), so free them here. */
export function disposeAmbient(a: Ambient): void {
  a.points.geometry.dispose();
  a.material.dispose();
}
