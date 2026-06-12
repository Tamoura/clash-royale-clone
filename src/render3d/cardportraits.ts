import * as THREE from "three";
import { getCard, type CardId } from "../game/cards";
import { animateTroop, buildTroop, outlineRig } from "./characters3d";

/**
 * Pre-rendered 3D card portraits: each troop/building character is
 * rendered ONCE at startup into a small canvas and cached — the HUD
 * gets real model art (like CR's cards) for free at runtime.
 */
const cache = new Map<CardId, HTMLCanvasElement>();
let renderer: THREE.WebGLRenderer | null = null;

function renderPortrait(id: CardId): HTMLCanvasElement | null {
  const card = getCard(id);
  if (card.kind === "spell") return null; // spells keep painted art
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(144, 144);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
    }
    const scene = new THREE.Scene();
    const rig = buildTroop(id); // buildings reuse their troop-style rigs? no:
    outlineRig(rig.group);
    rig.group.rotation.y = 0.5; // three-quarter hero angle
    if (rig.arm) rig.arm.rotation.x = rig.armRest;
    animateTroop(rig, { moving: false, swing: 0, time: 0.6, phase: 0 });
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
    renderer.render(scene, camera);

    const out = document.createElement("canvas");
    out.width = out.height = 144;
    out.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
    return out;
  } catch {
    return null; // unknown rig (e.g. buildings without troop rigs)
  }
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
