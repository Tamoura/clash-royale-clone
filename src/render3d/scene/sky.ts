/**
 * The living sky: the light rig, the sky dome, the per-frame day-to-night
 * grade of sky, lights and glow materials, the overtime lightning, and
 * ambient bird flyovers.
 *
 * The battle camera is orthographic and looks down at ~49 degrees, so a
 * world-anchored sky would only ever show its underside. The dome is an
 * inverted hemisphere carried in front of the camera instead, its pole
 * along the camera's up axis, drawn first and without depth: zenith at
 * the top of the screen, the horizon just above the backdrop's far wall,
 * and a fog-matched band below it. gradeSky retints its vertex colours in
 * place. Night-native looks (souk, medina, copper) add a moon and stars,
 * and every look gets them as the living sky reaches night.
 */
import * as THREE from "three";
import { BRIDGE_XS, RIVER_Y } from "../../game/arena";
import * as quality from "../quality";
import type { Battle3D } from "../scene3d";
import { LOOK, arabic, toWorld } from "./common";
import { poolIntensity } from "./arena/lightPools";

// gradeSky scratch colours (no per-frame allocation).
const SKY = new THREE.Color();
const NIGHT = new THREE.Color();
const MOON_HEMI = new THREE.Color(0x4a5a9a);
const MOON_GROUND = new THREE.Color(0x141a30);
const SUNSET = new THREE.Color(0xffb070);
const MOON = new THREE.Color(0x8fa8ff);
const WHITE = new THREE.Color(0xffffff);
const SKY_LUM = new THREE.Color();
const HSL = { h: 0, s: 0, l: 0 };
const ZEN = new THREE.Color();
const HOR = new THREE.Color();
const FOG = new THREE.Color();
const NIGHT_ZEN = new THREE.Color();
const NIGHT_HOR = new THREE.Color();
const FWD = new THREE.Vector3();
const UPV = new THREE.Vector3();

/** Dome layout in camera-up units: where the fog band ends, the horizon, the zenith. */
const DOME_CENTRE_U = 14.8;
const HORIZON_AT = 1.6;
const ZENITH_AT = 6;
const DOME_HEIGHT = 20;
const DOME_WIDTH = 60;
const DOME_DISTANCE = 70;

interface SkyRig {
  group: THREE.Group;
  colors: THREE.BufferAttribute;
  /** Per vertex: fog-to-horizon and horizon-to-zenith mix weights. */
  toHorizon: Float32Array;
  toZenith: Float32Array;
  stars: THREE.ShaderMaterial;
  moon: THREE.ShaderMaterial;
  starPoints: THREE.Points;
  moonMesh: THREE.Mesh;
  /** Last graded state (phase, flash), to skip unchanged frames. */
  key: number;
  time: number;
  bridgeLights: THREE.PointLight[];
}
const RIGS = new WeakMap<Battle3D, SkyRig>();

const STAR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPx;
  attribute vec2 aStar;
  varying float vA;
  void main() {
    vA = uIntensity * (0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (0.8 + aStar.y * 2.2) + aStar.x * 40.0)));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, (0.05 + aStar.y * 0.07) * uPx);
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.0) * vA;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.88) * a * 1.4, a);
  }
`;
const MOON_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const MOON_FRAG = /* glsl */ `
  uniform float uIntensity;
  uniform float uCrescent;
  uniform vec3 uColor;
  varying vec2 vP;
  void main() {
    float r = 0.8;
    float d = length(vP);
    float disc = smoothstep(r, r - 0.04, d);
    float bite = smoothstep(r * 0.92, r * 0.88, length(vP - vec2(0.36, 0.14)));
    float moon = disc * (1.0 - bite * uCrescent);
    float craters = 1.0 - 0.12 * (1.0 - uCrescent) * smoothstep(0.22, 0.18, length(vP - vec2(-0.2, 0.15)));
    float halo = exp(-max(0.0, d - r * 0.6) * 2.2) * 0.4;
    vec3 col = uColor * moon * 1.35 * craters + uColor * halo * 0.6;
    float a = max(moon, halo) * uIntensity;
    gl_FragColor = vec4(col * uIntensity, a);
  }
`;

function buildSkyRig(b: Battle3D): SkyRig {
  const group = new THREE.Group();
  group.name = "sky";
  // Pole along +y (camera up); a skirt reaches a little below the rim.
  const geo = new THREE.SphereGeometry(1, 32, 44, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const toHorizon = new Float32Array(n);
  const toZenith = new Float32Array(n);
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const u = pos.getY(i) * DOME_HEIGHT;
    toHorizon[i] = smooth(0, HORIZON_AT, u);
    toZenith[i] = Math.pow(Math.min(1, Math.max(0, (u - HORIZON_AT) / (ZENITH_AT - HORIZON_AT))), 0.8);
  }
  const colors = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  geo.setAttribute("color", colors);
  const dome = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthTest: false, depthWrite: false }),
  );
  dome.scale.set(DOME_WIDTH, DOME_HEIGHT, DOME_WIDTH);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.name = "sky dome";
  group.add(dome);

  // Stars across the top band (camera-aligned, so always "up").
  const count = 70;
  const sp = new Float32Array(count * 3);
  const sa = new Float32Array(count * 2);
  let s = 1234567;
  const rand = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    sp[i * 3] = (rand() - 0.5) * 30;
    sp[i * 3 + 1] = 1.2 + rand() * 10;
    sp[i * 3 + 2] = 40;
    sa[i * 2] = rand();
    sa[i * 2 + 1] = rand();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  sg.setAttribute("aStar", new THREE.BufferAttribute(sa, 2));
  const stars = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uPx: { value: 20 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const starPoints = new THREE.Points(sg, stars);
  starPoints.renderOrder = -999;
  starPoints.frustumCulled = false;
  group.add(starPoints);

  // The moon: a crescent in the Islamic edition, full in the classic one.
  const moon = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uCrescent: { value: arabic ? 1 : 0 },
      uColor: { value: new THREE.Color(0xfff4d8) },
    },
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), moon);
  moonMesh.position.set(0.3, 19.0 - DOME_CENTRE_U, 41);
  moonMesh.renderOrder = -998;
  moonMesh.frustumCulled = false;
  group.add(moonMesh);

  b.scene.add(group);
  return { group, colors, toHorizon, toZenith, stars, moon, starPoints, moonMesh, key: -1, time: 0, bridgeLights: [] };
}

/** The sky colour as the clear colour (fog follows it in camera.ts), plus the dome. */
export function initSky(b: Battle3D): void {
  b.scene.background = new THREE.Color(LOOK.sky);
  RIGS.set(b, buildSkyRig(b));
}

/** Re-sky a new arena look. */
export function applyLookSky(b: Battle3D): void {
  (b.scene.background as THREE.Color).set(LOOK.sky);
  const rig = RIGS.get(b);
  if (rig) rig.key = -1;
}

/** The quality level index, from the quality module when it exports one. */
function qualityIndex(b: Battle3D): number {
  const q = quality as unknown as { qualityIndex?: () => number; currentQualityIndex?: () => number };
  const f = q.qualityIndex ?? q.currentQualityIndex;
  return typeof f === "function" ? f() : b.quality.index;
}

export function buildLights(b: Battle3D): void {
  b.hemi = new THREE.HemisphereLight(LOOK.hemiSky, LOOK.hemiGround, LOOK.hemiIntensity);
  b.lightGroup.add(b.hemi);
  const sun = new THREE.DirectionalLight(LOOK.sun, 1.7);
  b.sun = sun;
  sun.position.set(10, 22, 8);
  sun.castShadow = true;
  const mobile =
    b.container.clientWidth < 720 || window.matchMedia("(pointer: coarse)").matches;
  const shadowSize = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 60;
  sun.shadow.radius = 5; // softer contact shadows
  sun.shadow.bias = -0.0004;
  b.lightGroup.add(sun);
  // Cool back-rim light to separate troops from the ground and pair
  // with the material rim highlight.
  const backRim = new THREE.DirectionalLight(0x9fc4ff, 0.6);
  backRim.position.set(-8, 10, -14);
  b.lightGroup.add(backRim);
  // Soft fill from the player's side so shadowed faces keep color.
  const fill = new THREE.DirectionalLight(LOOK.fill, 0.3);
  fill.position.set(-6, 8, 14);
  b.fillLight = fill;
  b.lightGroup.add(fill);
  // Top quality only: two short-range lamps warm the bridges at night.
  // They stay in the rig (intensity 0 when off) so no shader recompiles.
  const rig = RIGS.get(b);
  if (rig) {
    rig.bridgeLights = [];
    if (qualityIndex(b) === 0) {
      for (const bx of BRIDGE_XS) {
        const w = toWorld(bx, RIVER_Y);
        const lamp = new THREE.PointLight(LOOK.torch, 0, 5.5, 1.6);
        lamp.position.set(w.x + 1.3, 1.5, 0);
        b.lightGroup.add(lamp);
        rig.bridgeLights.push(lamp);
      }
    }
  }
}

/** Keep the dome in front of the camera, pole along its up axis. */
function followCamera(b: Battle3D, rig: SkyRig): void {
  const cam = b.camera;
  FWD.set(0, 0, -1).applyQuaternion(cam.quaternion);
  UPV.set(0, 1, 0).applyQuaternion(cam.quaternion);
  rig.group.position.copy(cam.position).addScaledVector(FWD, DOME_DISTANCE).addScaledVector(UPV, DOME_CENTRE_U);
  rig.group.quaternion.copy(cam.quaternion);
  // Drawing-buffer pixels per world unit, for star sizes.
  const h = b.renderer.domElement.height || 1;
  rig.stars.uniforms["uPx"].value = h / Math.max(1e-3, cam.top - cam.bottom);
}

/** Night sky colours for the look: a deep zenith and a dim, cool horizon. */
function nightColors(): void {
  NIGHT_ZEN.set(LOOK.nightSky).multiplyScalar(0.6);
  NIGHT_HOR.set(LOOK.nightSky).lerp(HOR.set(LOOK.skyHorizon), 0.22);
}

/** Per-frame sky/light/lantern grade for the current day phase. */
export function gradeSky(b: Battle3D, dt: number): void {
  const p = b.dayPhase;
  const sky = SKY.set(LOOK.sky).lerp(NIGHT.set(LOOK.nightSky), p);
  (b.scene.background as THREE.Color).copy(sky);
  (b.scene.fog as THREE.Fog).color.copy(sky);
  // Hemisphere: cools and dims toward a moonlit blue.
  b.hemi.color.set(LOOK.hemiSky).lerp(MOON_HEMI, p);
  b.hemi.groundColor.set(LOOK.hemiGround).lerp(MOON_GROUND, p);
  b.hemi.intensity = LOOK.hemiIntensity * (1 - 0.4 * p);
  // Sun: warm daylight -> amber sunset (mid) -> cool moonlight.
  if (p < 0.5) b.sun.color.set(LOOK.sun).lerp(SUNSET, p * 2);
  else b.sun.color.copy(SUNSET).lerp(MOON, (p - 0.5) * 2);
  b.sun.intensity = 1.7 - 0.9 * p;
  b.fillLight.intensity = 0.3 - 0.15 * p;
  // Lanterns/neon: dim by day (unless the look is already a night set),
  // fully lit by night.
  const skyLum = SKY_LUM.set(LOOK.sky).getHSL(HSL).l;
  const dayGlow = skyLum > 0.35 ? 0.3 : 0.8;
  const glow = dayGlow + (1 - dayGlow) * p;
  for (const g of b.glowMats) g.mat.color.copy(g.base).multiplyScalar(glow);
  // Lightning: two hard white flickers as overtime begins.
  let flash = 0;
  if (b.lightningT > 0) {
    b.lightningT -= dt;
    flash = Math.sin(b.lightningT * 40) > 0.3 ? 1 : 0;
    if (flash) {
      (b.scene.background as THREE.Color).lerp(WHITE, 0.7);
      b.sun.intensity = 4;
      b.hemi.intensity = 2.2;
    }
  }

  const rig = RIGS.get(b);
  if (!rig) return;
  rig.time += dt;
  followCamera(b, rig);
  const lit = poolIntensity(p, LOOK.nightPools);
  for (const lamp of rig.bridgeLights) lamp.intensity = qualityIndex(b) === 0 ? 3 * lit : 0;
  // Moon and stars: always over night-native sets, otherwise from dusk.
  const night = LOOK.nightPools ? 1 : lit;
  rig.stars.uniforms["uTime"].value = rig.time;
  rig.stars.uniforms["uIntensity"].value = night * (1 - flash);
  rig.moon.uniforms["uIntensity"].value = night;
  rig.starPoints.visible = night > 0.01;
  rig.moonMesh.visible = night > 0.01;

  // Retint the dome only when the phase (or a flash) changed.
  const key = Math.round(p * 1000) + flash * 10000;
  if (key === rig.key) return;
  rig.key = key;
  nightColors();
  ZEN.set(LOOK.skyTop).lerp(NIGHT_ZEN, p);
  HOR.set(LOOK.skyHorizon).lerp(NIGHT_HOR, p);
  FOG.copy(sky);
  if (flash) {
    ZEN.lerp(WHITE, 0.6);
    HOR.lerp(WHITE, 0.7);
    FOG.lerp(WHITE, 0.7);
  }
  const c = rig.colors.array as Float32Array;
  for (let i = 0; i < rig.toHorizon.length; i++) {
    const a = rig.toHorizon[i];
    const z = rig.toZenith[i];
    const r = FOG.r + (HOR.r - FOG.r) * a;
    const g = FOG.g + (HOR.g - FOG.g) * a;
    const bl = FOG.b + (HOR.b - FOG.b) * a;
    c[i * 3] = r + (ZEN.r - r) * z;
    c[i * 3 + 1] = g + (ZEN.g - g) * z;
    c[i * 3 + 2] = bl + (ZEN.b - bl) * z;
  }
  rig.colors.needsUpdate = true;
}

/** The sky's current horizon colour (for the river's sky tint). */
export function skyHorizon(target: THREE.Color): THREE.Color {
  return target.copy(HOR);
}

/** Ambient bird flyovers keep the sky alive. */
export function updateBirds(b: Battle3D, dt: number): void {
  b.birdTimer -= dt;
  if (b.birdTimer <= 0) {
    b.birdTimer = 9 + ((b.waterTime * 7) % 8);
    const dir = b.waterTime % 2 < 1 ? 1 : -1;
    const z = -12 + ((b.waterTime * 13) % 22);
    const bird = new THREE.Group();
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.04, 0.16),
        new THREE.MeshBasicMaterial({ color: 0xf4f6fa }),
      );
      wing.position.x = s * 0.26;
      bird.add(wing);
    }
    const startX = -dir * 22;
    b.addEffect(bird, 6, (frac) => {
      const t = 1 - frac;
      bird.position.set(startX + dir * t * 44, 7.5 + Math.sin(t * 9) * 0.4, z);
      bird.children.forEach((w, wi) => {
        w.rotation.z = (wi === 0 ? 1 : -1) * Math.sin(t * 40) * 0.7;
      });
    });
  }
}
