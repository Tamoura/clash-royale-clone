import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Real rigged character models (CC0 KayKit) shared with the Unity edition,
 * loaded as glTF and animated with an AnimationMixer. The native build uses its
 * hand-built primitive rigs by default; specific cards opt into a GLB model.
 */

interface LoadedGlb {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const loaded = new Map<string, LoadedGlb>();
const loading = new Set<string>();

/** Card -> GLB filename (under public/models/kaykit/). Extend as models land. */
const MODEL_FILE: Partial<Record<string, string>> = {
  knight: "Knight.glb",
  wizard: "Mage.glb",
};

function url(file: string): string {
  return `${import.meta.env.BASE_URL}models/kaykit/${file}`;
}

/** Kick off loading the models we have; safe to call repeatedly. */
export function preloadGlbModels(): void {
  const loader = new GLTFLoader();
  for (const [card, file] of Object.entries(MODEL_FILE)) {
    if (loaded.has(card) || loading.has(card)) continue;
    loading.add(card);
    loader.load(
      url(file!),
      (gltf) => {
        loaded.set(card, { scene: gltf.scene as THREE.Group, animations: gltf.animations });
        loading.delete(card);
      },
      undefined,
      () => loading.delete(card), // on error, fall back to the primitive rig
    );
  }
}

export function hasGlbModel(cardId: string): boolean {
  return loaded.has(cardId);
}

export interface GlbUnit {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<"idle" | "walk" | "attack", THREE.AnimationAction>>;
  /** Approx height in world units after scaling, for HP-bar/label placement. */
  height: number;
}

const ATTACK_CLIP: Record<string, string> = {
  knight: "1H_Melee_Attack_Slice_Diagonal",
  wizard: "Spellcast_Shoot", // the Mage's casting throw, for the fire-orb attack
};

/** Instantiate an animated clone of a card's model, or null if not loaded. */
export function makeGlbUnit(cardId: string): GlbUnit | null {
  const src = loaded.get(cardId);
  if (!src) return null;

  const group = cloneSkinned(src.scene) as THREE.Group;
  const scale = 0.95;
  group.scale.setScalar(scale);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Clones share geometry/material; flag them so disposeDeep won't free
      // resources still used by other clones of the same model.
      if (mesh.geometry) mesh.geometry.userData.shared = true;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => (m.userData.shared = true));
      else if (mat) mat.userData.shared = true;
    }
  });

  const mixer = new THREE.AnimationMixer(group);
  const clip = (name: string): THREE.AnimationAction | undefined => {
    const c = src.animations.find((a) => a.name === name);
    return c ? mixer.clipAction(c) : undefined;
  };

  const actions = {
    idle: clip("Idle"),
    walk: clip("Walking_A"),
    attack: clip(ATTACK_CLIP[cardId] ?? "1H_Melee_Attack_Chop"),
  };
  actions.idle?.play();

  return { group, mixer, actions, height: 1.8 * scale };
}

/** Crossfade the mixer to a named action over ~0.15s. */
export function playGlbAction(
  unit: { actions: GlbUnit["actions"]; current?: string },
  name: "idle" | "walk" | "attack",
): void {
  if (name === unit.current) return;
  const next = unit.actions[name];
  if (!next) return;
  const prev = unit.current ? unit.actions[unit.current as "idle"] : undefined;
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.play();
  if (prev && prev !== next) prev.crossFadeTo(next, 0.15, false);
  unit.current = name;
}
