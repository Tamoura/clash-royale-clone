import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ARABIC } from "./theme";

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
  "electro-wizard": "Mage.glb",
  "ice-wizard": "Mage.glb",
  witch: "Mage.glb",
  archers: "Rogue.glb",
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
  "electro-wizard": 0.95,
  "ice-wizard": 0.95,
  witch: 0.95,
  archers: 0.85,
};

/**
 * Optional colour multiply applied to a model's textures (per clone), so one
 * base model can stand in for several cards: a near-black steel P.E.K.K.A from
 * the Skeleton Warrior, a royal-blue Prince and a cyan Electro Wizard, etc.
 * Note: a multiply can only deepen existing hues, not invent new ones.
 */
const MODEL_TINT: Partial<Record<string, number>> = {
  pekka: 0x33384a, // dark robotic steel
  prince: 0x7088e0, // royal blue
  "electro-wizard": 0x6fd0ff, // electric blue (from the Mage's purple)
  "ice-wizard": 0xbfe6ff, // pale frost
  witch: 0x7a4aa8, // deep witch purple
};

function url(file: string): string {
  return `${import.meta.env.BASE_URL}models/kaykit/${file}`;
}

/**
 * Kick off loading the models we have; safe to call repeatedly. Keyed by file
 * so several cards can share one base model without re-parsing it.
 */
export function preloadGlbModels(): void {
  // The western KayKit models clash with the Arabic (crescent) art direction,
  // which dresses the hand-built rigs in turbans. Only load them in the normal
  // theme; the Arabic theme keeps its themed primitive rigs.
  if (ARABIC) return;
  const loader = new GLTFLoader();
  for (const file of new Set(Object.values(MODEL_FILE))) {
    if (!file || loaded.has(file) || loading.has(file)) continue;
    loading.add(file);
    loader.load(
      url(file),
      (gltf) => {
        loaded.set(file, { scene: gltf.scene as THREE.Group, animations: gltf.animations });
        loading.delete(file);
      },
      undefined,
      () => loading.delete(file), // on error, fall back to the primitive rig
    );
  }
}

export function hasGlbModel(cardId: string): boolean {
  if (ARABIC) return false; // Arabic theme uses the turbaned primitive rigs
  const file = MODEL_FILE[cardId];
  return !!file && loaded.has(file);
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
  "electro-wizard": "Spellcast_Shoot",
  "ice-wizard": "Spellcast_Shoot",
  witch: "Spellcast_Shoot",
  archers: "1H_Ranged_Shoot", // looses a bolt
};

/** Cards that get a custom weapon prop built and attached to a hand slot. */
const MODEL_WEAPON: Partial<Record<string, "lance" | "musket">> = {
  prince: "lance",
  musketeer: "musket",
};

/**
 * Cards that instead reveal one of the model's *baked-in* hand weapons (by node
 * name) and hide the rest — e.g. the Rogue ships with a crossbow already posed.
 */
const MODEL_KEEP_WEAPON: Partial<Record<string, string>> = {
  archers: "1H_Crossbow",
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

/** Both hand-slot nodes of a KayKit rig (dots are stripped by GLTFLoader). */
function handSlots(group: THREE.Object3D): THREE.Object3D[] {
  return [
    group.getObjectByName("handslotr") ?? group.getObjectByName("handslot.r"),
    group.getObjectByName("handslotl") ?? group.getObjectByName("handslot.l"),
  ].filter(Boolean) as THREE.Object3D[];
}

/** Attach/select a card's hand weapon, if any. */
export function attachWeapon(group: THREE.Object3D, cardId: string): void {
  // Reveal-a-baked-weapon path: show only the named mesh, hide other props.
  const keep = MODEL_KEEP_WEAPON[cardId];
  if (keep) {
    for (const slot of handSlots(group)) {
      for (const c of slot.children) c.visible = c.name === keep;
    }
    return;
  }

  const weapon = MODEL_WEAPON[cardId];
  if (!weapon) return;
  const slot = handSlots(group)[0];
  if (!slot) return;
  // Hide the model's baked-in hand weapons so the custom prop stands alone.
  for (const c of [...slot.children]) c.visible = false;
  // A two-handed musket also clears the off-hand (a stray dagger/shield).
  if (weapon === "musket") {
    const off = group.getObjectByName("handslotl") ?? group.getObjectByName("handslot.l");
    if (off) for (const c of [...off.children]) c.visible = false;
  }
  const prop = weapon === "lance" ? buildLance() : buildMusket();
  // The hand bone's local +Y points groundward; tilt so the prop reaches
  // forward (the direction the unit faces), angled slightly down.
  prop.rotation.x = weapon === "lance" ? Math.PI + 0.5 : Math.PI + 0.95;
  slot.add(prop);
}

/** Instantiate an animated clone of a card's model, or null if not loaded. */
export function makeGlbUnit(cardId: string): GlbUnit | null {
  const file = MODEL_FILE[cardId];
  const src = file ? loaded.get(file) : undefined;
  if (!src) return null;

  const group = cloneSkinned(src.scene) as THREE.Group;
  const scale = MODEL_SCALE[cardId] ?? 0.95;
  group.scale.setScalar(scale);
  const tint = MODEL_TINT[cardId];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Geometry is always shared across clones; flag it so disposeDeep keeps it.
    if (mesh.geometry) mesh.geometry.userData.shared = true;
    const orig = mesh.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(orig) ? orig : [orig];
    const out = list.map((m) => {
      if (tint !== undefined) {
        // Tinted cards clone the shared material so the colour is per-card.
        const c = (m as THREE.MeshStandardMaterial).clone();
        if (c.color) c.color.setHex(tint);
        c.userData.shared = false;
        return c;
      }
      m.userData.shared = true;
      return m;
    });
    mesh.material = Array.isArray(orig) ? out : out[0];
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
