/**
 * The battle camera: the orthographic fit around the HUD inset, the home
 * diorama framing and sway, trauma shake, and the depth fog per look.
 */
import * as THREE from "three";
import type { Battle3D } from "../scene3d";
import { CAM_HOME, LOOK, cameraZForView } from "./common";

/** Distance fog in the sky colour (gradeSky re-tints it every frame). */
export function initFog(b: Battle3D): void {
  b.scene.fog = new THREE.Fog(LOOK.sky, LOOK.fogNear, LOOK.fogFar);
}

/** Re-fog a new arena look. */
export function applyLookFog(b: Battle3D): void {
  const fog = b.scene.fog as THREE.Fog;
  fog.color.set(LOOK.sky);
  fog.near = LOOK.fogNear;
  fog.far = LOOK.fogFar;
}

/**
 * Home-screen diorama: frame the arena small inside the top window of
 * the home screen and let the camera sway slowly around it. Any battle
 * start (setViewpoint) turns it off again.
 */
export function showcase(b: Battle3D, on: boolean, windowFrac = 0.5): void {
  b.showcase = on;
  b.showcaseWindow = windowFrac;
  if (on) {
    b.dayPhase = b.phaseOverride ?? 0.15;
    const w = b.container.clientWidth || 1;
    const h = b.container.clientHeight || 1;
    const aspect = w / h;
    // Whole arena inside ~90% of the window height, centred in it.
    const V = Math.max(28 / (windowFrac * 0.9), (22 / aspect) * 1.0);
    const top = 0.6 + V * (windowFrac / 2);
    b.camera.left = (-V / 2) * aspect;
    b.camera.right = (V / 2) * aspect;
    b.camera.top = top;
    b.camera.bottom = top - V;
    b.camera.updateProjectionMatrix();
  } else {
    frameOrtho(b);
    b.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    b.camera.lookAt(0, 0, 0);
  }
}

/** The HUD overlay height; the frame keeps the arena clear of it. */
export function applyTopInset(b: Battle3D, px: number): void {
  if (Math.abs(px - b.topInsetPx) < 0.5) return;
  b.topInsetPx = px;
  frameOrtho(b);
}

/** Fit the arena to the viewport with an orthographic frustum. */
export function frameOrtho(b: Battle3D): void {
  if (b.showcase) {
    showcase(b, true, b.showcaseWindow);
    return;
  }
  const w = b.container.clientWidth || 1;
  const h = b.container.clientHeight || 1;
  const aspect = w / h;
  // World-units of half-height the view must cover so the whole
  // board (incl. towers + edging) fits; width follows the aspect.
  // The shallower camera foreshortens the field, so the frame zooms
  // in — characters render ~15% larger than under the old angle.
  // The frustum always matches the canvas aspect (an older fixed
  // min-width stretched phones ~8% sideways). Fit the field's width
  // edge to edge; on squat screens fit its depth instead. The HUD
  // overlay covers `f` of the top, so centre the arena in what's left.
  const NEED_HALF_W = 9.95; // field half-width + edging
  const CONTENT_H = 26.8; // screen-space depth: near fence to far lanterns
  const CONTENT_MID = 0.6; // its centre, in camera-up units
  const f = Math.min(0.25, b.topInsetPx / h);
  const halfH = Math.max(NEED_HALF_W / aspect, CONTENT_H / 2 / (1 - f));
  const halfW = halfH * aspect;
  const V = halfH * 2;
  const top = CONTENT_MID + (V * (1 + f)) / 2;
  b.camera.left = -halfW;
  b.camera.right = halfW;
  b.camera.top = top;
  b.camera.bottom = top - V;
  b.camera.updateProjectionMatrix();
}

/** Kick the camera; trauma stacks but is clamped. */
export function addShake(b: Battle3D, amount: number): void {
  b.shakeCtl.add(amount);
}

/** Camera shake: trauma² jitter around the fixed viewpoint. */
export function applyShake(b: Battle3D, dt: number): void {
  if (b.shakeCtl.active) {
    b.shakeTime += dt;
    const s = b.shakeCtl.intensity * 0.7;
    b.camera.position.set(
      Math.sin(b.shakeTime * 53) * s,
      CAM_HOME.y + Math.sin(b.shakeTime * 61) * s * 0.6,
      cameraZForView() + Math.cos(b.shakeTime * 47) * s,
    );
    b.shakeCtl.update(dt, 1.8);
    if (!b.shakeCtl.active) {
      b.camera.position.set(0, CAM_HOME.y, cameraZForView());
    }
  }
}

/**
 * Home diorama: a slow swaying orbit that frames the whole arena in the
 * window at the top of the home screen.
 */
export function updateShowcase(b: Battle3D, dt: number): void {
  if (b.showcase) {
    b.showcaseT += dt;
    const yaw = Math.sin(b.showcaseT * 0.18) * 0.32;
    b.camera.position.set(Math.sin(yaw) * 26, 30, Math.cos(yaw) * 26);
    b.camera.lookAt(0, 0, 0);
  }
}
