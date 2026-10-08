import * as THREE from "three";
import { getCard, type CardId } from "../game/cards";
import { animateTroop, buildTroop, outlineRig } from "./characters3d";
import { disposeDeep } from "./scene/common";

/**
 * Pre-rendered 3D card portraits: each troop/building character is
 * rendered ONCE (on first request) into a small canvas and cached — the HUD
 * gets real model art (like CR's cards) for free at runtime.
 *
 * The WebGL context behind it is a cost too (browsers cap live contexts and
 * each holds GPU memory), so one offscreen renderer serves every capture and
 * is released a few seconds after the last one; the rig and scene of each
 * capture are disposed as soon as the pixels are copied out.
 */
const cache = new Map<CardId, HTMLCanvasElement>();
let renderer: THREE.WebGLRenderer | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Milliseconds after the last capture before the renderer is released. */
export const PORTRAIT_IDLE_MS = 4000;

function acquireRenderer(): THREE.WebGLRenderer {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(320, 320); // retina-crisp when drawn into card frames
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
  }
  return renderer;
}

/** Let go of the offscreen renderer (and its GL context) once nothing is capturing. */
export function releasePortraitRenderer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
  }
}

/** Whether the offscreen renderer is currently alive (for tests). */
export function portraitRendererAlive(): boolean {
  return renderer !== null;
}

function scheduleRelease(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(releasePortraitRenderer, PORTRAIT_IDLE_MS);
}

function renderPortrait(id: CardId): HTMLCanvasElement | null {
  const card = getCard(id);
  if (card.kind === "spell") return null; // spells keep painted art
  let scene: THREE.Scene | null = null;
  let rigGroup: THREE.Group | null = null;
  try {
    const gl = acquireRenderer();
    scene = new THREE.Scene();
    const rig = buildTroop(id, "player"); // the HUD shows your own cards
    rigGroup = rig.group;
    // Portraits are not baked (one capture, then gone): per-mesh ink hulls.
    outlineRig(rig.group);
    if (rig.arm) rig.arm.rotation.x = rig.armRest;
    animateTroop(rig, { moving: false, swing: 0, time: 0.6, phase: 0 });
    // After animateTroop (which owns body yaw): three-quarter hero angle.
    rig.group.rotation.y = 0.5;
    scene.add(rig.group);
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5070, 1.3));
    const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
    key.position.set(3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb6ff, 1.2);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const h = (rig.hover ?? 0) + rig.height;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0, h * 0.6, h * 2.45);
    camera.lookAt(0, h * 0.5, 0);
    gl.render(scene, camera);

    const out = document.createElement("canvas");
    out.width = out.height = 320;
    out.getContext("2d")!.drawImage(gl.domElement, 0, 0);
    return out;
  } catch {
    return null; // unknown rig (e.g. buildings without troop rigs)
  } finally {
    // The pixels are copied out: free this capture's meshes, materials and scene.
    if (rigGroup) disposeDeep(rigGroup);
    scene?.clear();
    scheduleRelease();
  }
}

/** Drop a cached portrait (e.g. after the Studio redesigns the champion). */
export function invalidatePortrait(id: CardId): void {
  cache.delete(id);
}

/** Cached 3D portrait for a card, or null for spells/unrenderables. */
export function cardPortrait(id: CardId): HTMLCanvasElement | null {
  if (!cache.has(id)) {
    const c = renderPortrait(id);
    if (c) cache.set(id, c);
    else return null;
  }
  return cache.get(id) ?? null;
}
