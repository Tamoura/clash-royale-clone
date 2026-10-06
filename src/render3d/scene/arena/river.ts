/**
 * The living mid-band: one plane with a procedural ShaderMaterial (fog and
 * tone-mapping chunks included) instead of a scrolling canvas on a box.
 * look.band.kind picks the mode:
 *
 *  - water: two scrolling noise layers over a depth gradient, streaks,
 *    caustic highlights, a sky tint, and foam along both banks and around
 *    the bridge piers;
 *  - lava:  flowing cooling-crust cells with HDR cracks (toneMapped off,
 *    so the bloom pass makes it glow);
 *  - ice:   static cracks with a sheen sweeping across;
 *  - chasm: a dark drop with drifting mist and sparks;
 *  - neon:  dark metal with scanlines and light pulses racing down lanes.
 *
 * Stone bank lips edge both sides. The jungle's waterfall shares the noise.
 */
import * as THREE from "three";
import { ARENA_WIDTH, BRIDGE_XS, RIVER_HALF_WIDTH, RIVER_Y } from "../../../game/arena";
import type { ArenaLook, BandKind } from "../../arenaLooks";
import { toon } from "../../characters3d";
import { toWorld } from "../common";
import { parseColor } from "./groundPaint";

const MODES: Record<BandKind, number> = { water: 0, lava: 1, ice: 2, chasm: 3, neon: 4 };
/** Bridge deck half-width (world units) where the water meets the piers. */
const PIER_HALF = 1.05;

const NOISE = /* glsl */ `
  float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float rNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), u.x),
               mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float rFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * rNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  // x: distance to the nearest cell point, y: gap to the second (0 on edges).
  vec2 rVoronoi(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = vec2(rHash(n + g), rHash(n + g + 19.19));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
  }
`;

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const RIVER_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uMode;
  uniform float uHalf;
  uniform float uFoamA;
  uniform float uNight;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uGlint;
  uniform vec3 uSky;
  uniform vec2 uPiers[2];
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    float across = clamp(abs(p.y) / uHalf, 0.0, 1.0);
    float pier = 1e3;
    for (int i = 0; i < 2; i++) pier = min(pier, abs(abs(p.x - uPiers[i].x) - uPiers[i].y));
    vec3 col;
    if (uMode < 0.5) {
      float n1 = rFbm(vec2(p.x * 0.7 - t * 0.45, p.y * 2.2));
      float n2 = rFbm(vec2(p.x * 1.6 - t * 0.8, p.y * 3.4 + t * 0.1) + 7.3);
      float shallow = smoothstep(0.15, 1.0, across);
      col = mix(uDeep, uShallow, clamp(shallow * 0.85 + (n1 - 0.5) * 0.3, 0.0, 1.0));
      float streak = smoothstep(0.58, 0.66, n1 * 0.55 + n2 * 0.45) * (1.0 - shallow * 0.6);
      col = mix(col, uGlint, streak * 0.35);
      float c = abs(sin(p.x * 2.6 + n2 * 6.0 - t * 1.2) * sin(p.y * 5.2 + n1 * 5.0 + t * 0.7));
      col += uGlint * pow(1.0 - c, 10.0) * 0.24 * (1.0 - uNight * 0.6);
      col = mix(col, uSky, 0.1 + 0.1 * shallow);
      float edgeN = rNoise(vec2(p.x * 3.0 - t * 1.4, p.y * 6.0));
      float foam = smoothstep(0.72, 0.97, across + (edgeN - 0.5) * 0.24);
      foam = max(foam, (1.0 - smoothstep(0.0, 0.3 + edgeN * 0.18, pier)) * 0.95);
      foam *= 0.6 + 0.4 * rNoise(vec2(p.x * 7.0 - t * 2.0, p.y * 9.0));
      col = mix(col, uFoam, clamp(foam * uFoamA * 1.9, 0.0, 1.0));
    } else if (uMode < 1.5) {
      vec2 q = vec2(p.x * 0.9 - t * 0.16, p.y * 1.6);
      vec2 v = rVoronoi(q * 1.4);
      float crustN = rFbm(q * 0.8 + t * 0.05);
      float cool = smoothstep(0.02, 0.17, v.y);
      float pulse = 0.75 + 0.25 * sin(t * 1.7 + crustN * 9.0);
      vec3 hot = uShallow * (2.2 + 1.3 * pulse);
      vec3 crust = uDeep * (0.5 + 0.6 * crustN);
      col = mix(hot, crust, cool * (0.62 + 0.38 * crustN));
      col += uShallow * smoothstep(0.7, 1.0, across) * 1.1;
      col += uShallow * (1.0 - smoothstep(0.0, 0.3, pier)) * 1.4;
    } else if (uMode < 2.5) {
      vec2 v = rVoronoi(p * vec2(1.1, 1.8) + 3.7);
      float crack = 1.0 - smoothstep(0.0, 0.045, v.y);
      float fr = rFbm(p * 2.2);
      col = mix(uShallow, uDeep, clamp(0.35 + fr * 0.4 + (1.0 - across) * 0.3, 0.0, 1.0));
      col = mix(col, vec3(1.0), crack * 0.6);
      float sweep = fract(p.x * 0.06 + p.y * 0.05 - t * 0.07);
      col += vec3(0.85, 0.93, 1.0) * smoothstep(0.0, 0.05, sweep) * (1.0 - smoothstep(0.05, 0.14, sweep)) * 0.4;
      col = mix(col, uSky, 0.1);
      col = mix(col, vec3(1.0), smoothstep(0.8, 1.0, across) * 0.5);
    } else if (uMode < 3.5) {
      float depth = 1.0 - across;
      col = mix(uShallow * 0.55, uDeep * 0.1, smoothstep(0.0, 0.75, depth));
      float mist = rFbm(vec2(p.x * 0.5 - t * 0.12, p.y * 1.6 + t * 0.05));
      col += uGlint * smoothstep(0.45, 0.85, mist) * 0.5 * depth;
      float spark = step(0.988, rHash(floor(p * vec2(6.0, 10.0)) + floor(t * 2.0)));
      col += uGlint * spark * depth;
      col = mix(col, uShallow, smoothstep(0.85, 1.0, across) * 0.6);
    } else {
      col = uDeep * (0.8 + 0.25 * rFbm(p * 1.5));
      col *= 0.86 + 0.14 * (0.5 + 0.5 * sin(p.y * 36.0));
      float lane = abs(fract(p.y * 1.5) - 0.5);
      float pulse = fract(p.x * 0.08 - t * 0.25 + floor(p.y * 1.5) * 0.37);
      float line = 1.0 - smoothstep(0.0, 0.035, abs(lane - 0.45));
      col += uGlint * line * (0.25 + 1.8 * smoothstep(0.85, 1.0, pulse));
      col += uFoam * smoothstep(0.86, 1.0, across) * 1.3;
      col += uFoam * (1.0 - smoothstep(0.0, 0.12, pier)) * 1.2;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const FALLS_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float n = rFbm(vec2(vUv.x * 7.0, vUv.y * 2.0 + uTime * 1.6));
    float streak = smoothstep(0.45, 0.75, rNoise(vec2(vUv.x * 18.0, vUv.y * 3.0 + uTime * 2.4)));
    vec3 col = mix(uShallow, uFoam, clamp(n * 0.6 + streak * 0.5, 0.0, 1.0));
    col = mix(col, uFoam, smoothstep(0.15, 0.0, vUv.y) * 0.9);
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    gl_FragColor = vec4(col, 0.92 * edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const colorOf = (css: string): THREE.Color => {
  const c = parseColor(css);
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
};

export interface RiverHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** The band plane and its bank lips, added to `parent`. */
export function buildRiver(parent: THREE.Object3D, look: ArenaLook): RiverHandle {
  const kind = look.band.kind;
  const fill = colorOf(look.band.fill);
  const deep = fill.clone().multiplyScalar(kind === "lava" ? 0.18 : kind === "ice" ? 0.42 : 0.55);
  const shallow = fill.clone().lerp(new THREE.Color(1, 1, 1), kind === "lava" || kind === "neon" ? 0 : 0.18);
  const piers = BRIDGE_XS.map((bx) => new THREE.Vector2(toWorld(bx, RIVER_Y).x, PIER_HALF));
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uMode: { value: MODES[kind] },
        uHalf: { value: RIVER_HALF_WIDTH },
        uFoamA: { value: look.band.foamOpacity },
        uNight: { value: 0 },
        uDeep: { value: deep },
        uShallow: { value: shallow },
        uFoam: { value: new THREE.Color(look.band.foam) },
        uGlint: { value: new THREE.Color(look.band.glint) },
        uSky: { value: new THREE.Color(look.skyHorizon) },
        uPiers: { value: piers },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: RIVER_FRAG,
    fog: true,
  });
  // Lava's cracks are HDR: skip tone mapping so the bloom pass catches them.
  material.toneMapped = kind !== "lava" && kind !== "neon";
  const geo = new THREE.PlaneGeometry(ARENA_WIDTH + 0.6, RIVER_HALF_WIDTH * 2 + 0.3, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "river";
  mesh.position.set(0, 0.03, 0);
  mesh.userData.noBatch = true;
  parent.add(mesh);

  // Stone lips along both banks (the floor paint bakes their AO strip).
  const lipColor = kind === "ice" ? 0xdcecf6 : kind === "neon" ? 0x3a4060 : kind === "lava" ? 0x3a2a2a : look.edging;
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.16, 0.22), toon(lipColor));
    lip.position.set(0, 0.05, side * (RIVER_HALF_WIDTH + 0.1));
    lip.receiveShadow = true;
    lip.name = "bank lip";
    parent.add(lip);
  }
  return { mesh, material };
}

export interface WaterfallHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** A vertical sheet of falling water (jungle kit). */
export function makeWaterfall(look: ArenaLook, w: number, h: number): WaterfallHandle {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: colorOf(look.band.fill).lerp(new THREE.Color(1, 1, 1), 0.2) },
        uFoam: { value: new THREE.Color(look.band.foam) },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FALLS_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.name = "waterfall";
  mesh.userData.noBatch = true;
  return { mesh, material };
}
