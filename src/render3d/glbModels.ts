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
  valkyrie: "Barbarian.glb",
  "mini-pekka": "Rogue.glb",
  skeletons: "Skeleton_Minion.glb",
  "skeleton-army": "Skeleton_Minion.glb",
  pekka: "Skeleton_Warrior.glb",
  prince: "Knight.glb",
  musketeer: "Rogue_Hooded.glb",
};

/**
 * Per-card model scale. KayKit characters are all human-sized, so swarm and
 * "mini" units need shrinking to read right against the bigger troops.
 */
const MODEL_SCALE: Partial<Record<string, number>> = {
  knight: 0.95,
  wizard: 0.95,
  valkyrie: 0.9,
  "mini-pekka": 0.8,
  skeletons: 0.62,
  "skeleton-army": 0.55,
  pekka: 1.5,
  prince: 1.05,
  musketeer: 0.92,
};

/**
 * Optional colour multiply applied to a model's textures at load time, so one
 * base model can stand in for several cards: a near-black steel P.E.K.K.A from
 * the Skeleton Warrior, a royal-blue Prince from the Knight.
 */
const MODEL_TINT: Partial<Record<string, number>> = {
  pekka: 0x33384a, // dark robotic steel
  prince: 0x7088e0, // royal blue
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
        const tint = MODEL_TINT[card];
        if (tint !== undefined) {
          // Tint the shared source materials once; every clone inherits it.
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
              const sm = m as THREE.MeshStandardMaterial;
              if (sm && sm.color) sm.color.setHex(tint);
            }
          });
        }
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
  valkyrie: "2H_Melee_Attack_Spinning", // her signature spin
  "mini-pekka": "Dualwield_Melee_Attack_Slice", // the Rogue's twin-blade flurry
  skeletons: "1H_Melee_Attack_Chop",
  "skeleton-army": "1H_Melee_Attack_Chop",
  pekka: "2H_Melee_Attack_Chop", // heavy two-handed sword swing
  prince: "1H_Melee_Attack_Stab", // a lance-like thrust
  musketeer: "2H_Ranged_Shoot", // shoulders and fires the musket
};

/** Cards that get a weapon prop attached to a hand slot of their model. */
const MODEL_WEAPON: Partial<Record<string, "lance" | "musket">> = {
  prince: "lance",
  musketeer: "musket",
};

/** A striped jousting/tournament lance, built from primitives. */
function buildLance(): THREE.Group {
  const g = new THREE.Group();
  const LEN = 2.7, R = 0.05;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.4, roughness: 0.5 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.7, LEN, 12), white);
  shaft.position.y = LEN / 2;
  g.add(shaft);
  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.0, 0.16, 12), red);
    band.position.y = 0.55 + i * 0.55;
    g.add(band);
  }
  const vamplate = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 12), steel);
  vamplate.position.y = 0.36;
  vamplate.rotation.x = Math.PI; // flared guard cupping the hand
  g.add(vamplate);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 12), steel);
  tip.position.y = LEN + 0.14;
  g.add(tip);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** A flintlock musket, built from primitives. Extends along +Y from the grip. */
function buildMusket(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.5, roughness: 0.4 });
  // Stock butt behind the grip, body around it, barrel reaching forward.
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.16), wood);
  stock.position.y = -0.28;
  g.add(stock);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.14), wood);
  body.position.y = 0.1;
  g.add(body);
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), brass);
  hammer.position.set(0, 0.18, 0.11);
  g.add(hammer);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.2, 12), steel);
  barrel.position.y = 0.9;
  g.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 12), steel);
  muzzle.position.y = 1.5;
  g.add(muzzle);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** Attach a card's weapon prop to its model's right-hand slot, if any. */
export function attachWeapon(group: THREE.Object3D, cardId: string): void {
  const weapon = MODEL_WEAPON[cardId];
  if (!weapon) return;
  // GLTFLoader strips dots from node names: "handslot.r" -> "handslotr".
  const slot =
    group.getObjectByName("handslotr") ?? group.getObjectByName("handslot.r");
  if (!slot) return;
  // Hide the model's baked-in hand weapons so the prop stands alone.
  for (const c of [...slot.children]) c.visible = false;
  // A two-handed musket also clears the off-hand (a stray dagger/shield).
  if (weapon === "musket") {
    const off = group.getObjectByName("handslotl") ?? group.getObjectByName("handslot.l");
    if (off) for (const c of [...off.children]) c.visible = false;
  }
  const prop = weapon === "lance" ? buildLance() : buildMusket();
  // The hand bone's local +Y points groundward; tilt so the prop reaches
  // forward (the direction the unit faces), angled slightly down — a couched
  // lance, or a levelled musket.
  prop.rotation.x = weapon === "lance" ? Math.PI + 0.5 : Math.PI + 0.95;
  slot.add(prop);
}

/** Instantiate an animated clone of a card's model, or null if not loaded. */
export function makeGlbUnit(cardId: string): GlbUnit | null {
  const src = loaded.get(cardId);
  if (!src) return null;

  const group = cloneSkinned(src.scene) as THREE.Group;
  const scale = MODEL_SCALE[cardId] ?? 0.95;
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
  attachWeapon(group, cardId);

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
