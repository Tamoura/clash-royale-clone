/**
 * The living sky: the light rig, the scene background, the per-frame
 * day-to-night grade of sky, lights and glow materials, the overtime
 * lightning, and ambient bird flyovers.
 */
import * as THREE from "three";
import type { Battle3D } from "../scene3d";
import { LOOK } from "./common";

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

/** The sky colour as the scene background (fog follows it in camera.ts). */
export function initSky(b: Battle3D): void {
  b.scene.background = new THREE.Color(LOOK.sky);
}

/** Re-sky a new arena look. */
export function applyLookSky(b: Battle3D): void {
  (b.scene.background as THREE.Color).set(LOOK.sky);
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
  if (b.lightningT > 0) {
    b.lightningT -= dt;
    const flash = Math.sin(b.lightningT * 40) > 0.3 ? 1 : 0;
    if (flash) {
      (b.scene.background as THREE.Color).lerp(WHITE, 0.7);
      b.sun.intensity = 4;
      b.hemi.intensity = 2.2;
    }
  }
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
