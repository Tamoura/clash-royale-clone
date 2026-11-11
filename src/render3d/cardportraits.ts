import * as THREE from "three";
import { getCard, type CardId } from "../game/cards";
import { animateTroop, buildCometRock, buildTroop, outlineRig } from "./characters3d";
import { disposeDeep } from "./scene/common";
import { animateKitTroop, hasKitTroop, makeKitTroop } from "./cast/index";

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

/** Spells with a 3D portrait instead of painted art (the Comet's flaming rock). */
export const SPELL_PORTRAITS: ReadonlySet<CardId> = new Set<CardId>(["comet"]);

/**
 * The Comet's card art: the basalt rock diving toward the lower left with a
 * flame tail streaming up and right behind it (unlit glow shells, no bloom
 * here, so the bands of colour do the work) and a few embers.
 */
function cometSubject(): { group: THREE.Group; height: number } {
  const g = new THREE.Group();
  const rock = buildCometRock(0.52);
  rock.position.set(-0.18, 0.62, 0);
  rock.rotation.set(0.4, 0.6, 0.2);
  g.add(rock);
  const tail = new THREE.Group();
  tail.position.copy(rock.position);
  tail.rotation.z = -0.75; // stream toward the upper right
  const flame = (color: number, r: number, h: number, y: number): void => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false });
    mat.toneMapped = false;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 18, 1, true), mat);
    cone.position.y = y;
    cone.rotation.x = Math.PI; // wide end at the rock
    tail.add(cone);
  };
  flame(0xff5a1f, 0.62, 1.5, 0.7);
  flame(0xff9a2a, 0.5, 1.15, 0.55);
  flame(0xffe08a, 0.36, 0.75, 0.38);
  tail.renderOrder = -1;
  g.add(tail);
  const ember = new THREE.MeshBasicMaterial({ color: 0xffc061 });
  ember.toneMapped = false;
  for (const [x, y, r] of [[0.5, 1.25, 0.05], [0.72, 1.0, 0.04], [0.3, 1.45, 0.035], [0.84, 1.36, 0.03]] as const) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), ember);
    e.position.set(x, y, 0.1);
    g.add(e);
  }
  outlineRig(rock);
  return { group: g, height: 1.5 };
}

/** The posed subject for a troop or building card (the HUD shows your own side). */
function troopSubject(id: CardId): { group: THREE.Group; height: number; cast: boolean } {
  // The cast: the card shows the modelled character the battle fields, in this edition's look.
  const kit = hasKitTroop(id) ? makeKitTroop(id, "player", undefined, false) : null;
  if (kit) {
    for (let i = 0; i < 6; i++) animateKitTroop(kit, { moving: false, attacking: false, cooldown: 1, hitSpeed: 1, rate: 1, frozen: false }, 0.05);
    kit.actions.idle.time = 0.2;
    kit.mixer.update(0);
    kit.group.rotation.y = 0.45; // three-quarter front
    // Framed from the knees up: the big head and the weapon are the card. Riders show their mount.
    const knee = kit.mount ? 0.06 : 0.16;
    kit.group.position.y = -kit.height * knee;
    const holder = new THREE.Group();
    holder.add(kit.group);
    return { group: holder, height: kit.height * (1 - knee * 1.25), cast: true };
  }
  const rig = buildTroop(id, "player");
  // Portraits are not baked (one capture, then gone): per-mesh ink hulls.
  outlineRig(rig.group);
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  animateTroop(rig, { moving: false, swing: 0, time: 0.6, phase: 0 });
  // After animateTroop (which owns body yaw): three-quarter hero angle.
  rig.group.rotation.y = 0.5;
  return { group: rig.group, height: (rig.hover ?? 0) + rig.height, cast: false };
}

function renderPortrait(id: CardId): HTMLCanvasElement | null {
  const card = getCard(id);
  if (card.kind === "spell" && !SPELL_PORTRAITS.has(id)) return null; // spells keep painted art
  let scene: THREE.Scene | null = null;
  let rigGroup: THREE.Group | null = null;
  try {
    const gl = acquireRenderer();
    scene = new THREE.Scene();
    const subject = card.kind === "spell" ? { ...cometSubject(), cast: false } : troopSubject(id);
    rigGroup = subject.group;
    scene.add(subject.group);
    // The cast's bright palettes wash out under the rigs' studio light (the "pale knight"): softer for them.
    const k = subject.cast ? 0.72 : 1;
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5070, 1.3 * k));
    const key = new THREE.DirectionalLight(0xfff2d8, 2.2 * k);
    key.position.set(3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb6ff, 1.2 * k);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const h = subject.height;
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

/** Cached 3D portrait for a card, or null for painted spells/unrenderables. */
export function cardPortrait(id: CardId): HTMLCanvasElement | null {
  if (!cache.has(id)) {
    const c = renderPortrait(id);
    if (c) cache.set(id, c);
    else return null;
  }
  return cache.get(id) ?? null;
}
