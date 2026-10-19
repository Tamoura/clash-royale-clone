/**
 * The battle camera: the orthographic fit around the HUD insets, the home
 * diorama framing and sway, trauma shake, the king-tower KO zoom, and the
 * depth fog per look (fitted so it never reaches the playfield).
 */
import * as THREE from "three";
import type { Battle3D } from "../scene3d";
import { fitFog, viewMatrixAt } from "../fogfit";
import { reducedMotion } from "../../ui/prefs";
import { CAM_HOME, LOOK, cameraZForView, toWorld } from "./common";
import { BATTLE_BOX, ZERO_INSETS, fitBattleFrustum, type ContentBox, type Frustum, type Insets } from "./fit";

/**
 * Where the battle board must stay visible: the HUD's insets on each side
 * of the canvas (CSS px) and the content box to fit between them. Set by
 * the layout (ui/layoutWire.ts); null frames the whole board with no insets.
 */
export interface Framing {
  insets: Insets;
  box: ContentBox;
}

/** Distance fog in the sky colour (gradeSky re-tints it every frame). */
export function initFog(b: Battle3D): void {
  b.scene.fog = new THREE.Fog(LOOK.sky, LOOK.fogNear, LOOK.fogFar);
}

/** Re-fog a new arena look. */
export function applyLookFog(b: Battle3D): void {
  const fog = b.scene.fog as THREE.Fog;
  fog.color.set(LOOK.sky);
  applyFogRange(b);
}

const VIEW = new THREE.Matrix4();

/**
 * Battle: fog starts just past the playfield as the resting camera sees it
 * (fogfit.ts), so the far half is as crisp as the near half. The home
 * diorama keeps the look's own distances for its hazy, framed-in-a-window
 * feel.
 */
export function applyFogRange(b: Battle3D): void {
  const fog = b.scene?.fog as THREE.Fog | null | undefined;
  if (!fog) return;
  if (b.showcase) {
    fog.near = LOOK.fogNear;
    fog.far = LOOK.fogFar;
    return;
  }
  const fit = fitFog(viewMatrixAt(CAM_HOME.x, CAM_HOME.y, cameraZForView(), VIEW), LOOK);
  fog.near = fit.near;
  fog.far = fit.far;
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
    applyFogRange(b);
  } else {
    frameOrtho(b);
    b.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    b.camera.lookAt(0, 0, 0);
  }
}

/**
 * Re-fit when the HUD's insets or the content box change (sub-pixel
 * jitter from layout rounding is ignored).
 */
export function applyFraming(b: Battle3D, f: Framing): void {
  const cur = b.framing;
  if (cur && cur.box === f.box) {
    const a = cur.insets;
    const n = f.insets;
    const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.5;
    if (near(a.top, n.top) && near(a.right, n.right) && near(a.bottom, n.bottom) && near(a.left, n.left)) return;
  }
  b.framing = f;
  frameOrtho(b);
}

/** The resting battle frustum (before any KO zoom), per camera. */
const restFrustum = new WeakMap<THREE.OrthographicCamera, Frustum>();

/**
 * Fit the arena to the viewport with an orthographic frustum (fit.ts).
 * The shallow camera foreshortens the field, so the frame zooms in; the
 * frustum always matches the canvas aspect (a fixed min-width once
 * stretched phones ~8% sideways). The board is fitted edge to edge into
 * what the HUD leaves free; squat screens fit its depth instead.
 */
export function frameOrtho(b: Battle3D): void {
  if (b.showcase) {
    showcase(b, true, b.showcaseWindow);
    return;
  }
  const w = b.container.clientWidth || 1;
  const h = b.container.clientHeight || 1;
  const fr = b.framing ?? { insets: ZERO_INSETS, box: BATTLE_BOX };
  restFrustum.set(b.camera, fitBattleFrustum(w, h, fr.insets, fr.box));
  applyFrustum(b);
  applyFogRange(b);
}

// ---- King-tower KO zoom -----------------------------------------------------

/** The frustum shrinks to this share at the height of the pulse. */
export const KO_ZOOM = 0.92;
/** Seconds the push-in and release take together. */
export const KO_ZOOM_TIME = 0.4;

interface KoZoom {
  t: number;
  /** The tower's position in camera space (the zoom's fixed point). */
  px: number;
  py: number;
}
const koZooms = new WeakMap<Battle3D, KoZoom>();
const KO_POINT = new THREE.Vector3();

/** 0 → 1 → 0 over u in [0, 1]: a quick push in, then a soft release. */
export function koPulse(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  if (u < 0.3) {
    const k = 1 - u / 0.3;
    return 1 - k * k * k; // ease out
  }
  const k = (u - 0.3) / 0.7;
  return 1 - k * k * (3 - 2 * k); // smooth release
}

/**
 * The camera leans in on a fallen king tower: the frustum shrinks to
 * KO_ZOOM around it and eases back over KO_ZOOM_TIME. Skipped entirely
 * under reduced motion (the frustum never changes).
 */
export function startKoZoom(b: Battle3D, ax: number, ay: number): void {
  if (reducedMotion() || b.showcase) return;
  const w = toWorld(ax, ay);
  KO_POINT.set(w.x, 1.5, w.z).applyMatrix4(viewMatrixAt(CAM_HOME.x, CAM_HOME.y, cameraZForView(), VIEW));
  koZooms.set(b, { t: 0, px: KO_POINT.x, py: KO_POINT.y });
}

/** True while the KO zoom moves the frame (pointer picks are ignored). */
export function koZoomActive(b: Battle3D): boolean {
  return koZooms.has(b);
}

/** The resting frustum, scaled about the KO point while the zoom runs. */
function applyFrustum(b: Battle3D): void {
  const rest = restFrustum.get(b.camera);
  if (!rest) return;
  const z = koZooms.get(b);
  const s = z ? 1 - (1 - KO_ZOOM) * koPulse(z.t / KO_ZOOM_TIME) : 1;
  const px = z?.px ?? 0;
  const py = z?.py ?? 0;
  b.camera.left = px + (rest.left - px) * s;
  b.camera.right = px + (rest.right - px) * s;
  b.camera.top = py + (rest.top - py) * s;
  b.camera.bottom = py + (rest.bottom - py) * s;
  b.camera.updateProjectionMatrix();
}

function updateKoZoom(b: Battle3D, dt: number): void {
  const z = koZooms.get(b);
  if (!z) return;
  z.t += dt;
  if (z.t >= KO_ZOOM_TIME || b.showcase) koZooms.delete(b);
  if (!b.showcase) applyFrustum(b);
}

/** Kick the camera; trauma stacks but is clamped (and ignored under reduced motion). */
export function addShake(b: Battle3D, amount: number): void {
  b.shakeCtl.add(amount);
}

/**
 * Per-frame camera motion: trauma² jitter around the fixed viewpoint, and
 * the KO zoom's frustum pulse.
 */
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
  updateKoZoom(b, dt);
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
