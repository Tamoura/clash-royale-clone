/**
 * KIT TROOPS (art-direction prototype "kit everything"): the humanoid cards
 * are real modelled, rigged characters, the CC0 KayKit Adventurers and
 * Skeletons packs by Kay Lousberg, packed by tools/troop-pack.mjs into
 * public/models/troops/ (one small GLB per character, one shared clip set:
 * every character in both packs shares the same rig).
 *
 * A card is a VARIANT of a character: which hat, cape and weapons it wears
 * (also borrowed from another character), how its palette is re-coloured
 * (pink hair for the Archers, dark steel for the Mini P.E.K.K.A, team
 * colours on robes and capes), a few primitives of our own (horns, a
 * musket) and which clips it plays. Each variant is BAKED once into a single
 * skinned geometry: the six body meshes, the rigid props (skinned to their
 * bone with weight 1) and an inside-out ink shell, so a unit is ONE draw
 * call with the same 2 px ink line the hand-built roster wears. A unit owns
 * 23 bones, a material clone (for hit flashes) and an AnimationMixer.
 *
 * So they read at the size of a phone troop: a brighter, more saturated
 * palette, a lighter cel ramp than the roster's, a strong rim, big heads
 * (the pack's proportions) and the model scaled up.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Side } from "../game/arena";
import { INK_FRAGMENT, fitInk, installInk, registerInkGeometry, smoothedNormals } from "./outlineMaterial";
import { teamColor, teamPalette } from "./teamColors";

const FILES = ["knight", "barbarian", "mage", "rogue", "rogue_hooded", "skeleton_minion"] as const;
type FileId = (typeof FILES)[number];

/** The rig's deform bones (GLTFLoader strips the dots from "upperarm.l"). */
const BONES = [
  "root", "hips", "spine", "chest", "head",
  "upperarml", "lowerarml", "wristl", "handl", "handslotl",
  "upperarmr", "lowerarmr", "wristr", "handr", "handslotr",
  "upperlegl", "lowerlegl", "footl", "toesl",
  "upperlegr", "lowerlegr", "footr", "toesr",
] as const;
const BONE_INDEX = new Map<string, number>(BONES.map((n, i) => [n, i]));

/** A swatch of a character's palette: column 0..7, row 0..3 (each is 1 x 2 cells of the 8 x 8 grid). */
type Swatch = `${number},${number}`;
/** What a swatch is repainted with: a colour, or the unit's team shade. */
type Paint = number | "team" | "teamDark";

interface Extra {
  /** Bone it rides (BONES name). */
  bone: string;
  /** Geometry in the rig's rest-pose space, or in the bone's own space with `local`. */
  geo: () => THREE.BufferGeometry;
  local?: boolean;
  color: Paint;
  /** An open shell (a crown band, a hair fringe): both faces drawn, no ink shell (its inside would show as ink). */
  open?: boolean;
}

interface Variant {
  file: FileId;
  /** Model scale on the field (the characters are ~2.4 units tall). */
  scale: number;
  /** Rigid props to wear, by node name; "file:Node" borrows another character's. */
  props: string[];
  /** Skinned body meshes to leave out (by name test). */
  drop?: RegExp;
  /** Meshes painted whole in the team colour (capes, cloaks). */
  team?: RegExp;
  /** Palette swatches repainted (hair, robes, steel...). */
  paint?: Partial<Record<Swatch, Paint>>;
  /** Paint for the swatches of a borrowed prop's palette. */
  propPaint?: Partial<Record<Swatch, Paint>>;
  extras?: Extra[];
  idle: string;
  walk: string;
  attack: string;
  /** Where in the attack clip the blow lands (0..1). */
  strike: number;
  /** Walk clip speed. */
  pace?: number;
}

const cone = (r: number, h: number, x: number, y: number, z: number, rz = 0, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.ConeGeometry(r, h, 10);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  return g;
};
const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r0, r1, h, 10);
  g.translate(x, y, z);
  return g;
};

/** A flintlock musket along +Y from the grip, in the hand slot's space. */
const MUSKET_TILT = new THREE.Matrix4().makeRotationX(Math.PI + 0.95);
const musketPart = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(MUSKET_TILT);

const VARIANTS: Partial<Record<string, Variant>> = {
  knight: {
    file: "knight",
    scale: 1.1,
    props: ["Knight_Helmet", "Knight_Cape", "1H_Sword", "Badge_Shield"],
    team: /Cape/,
    paint: { "0,1": "team", "1,0": 0xf2c65a, "3,0": 0xa9b7cc, "7,0": 0xd3dcea, "6,2": "team" },
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Melee_Attack_Slice_Diagonal",
    strike: 0.42,
  },
  giant: {
    file: "barbarian",
    scale: 1.75,
    props: [],
    paint: { "0,1": "team", "1,1": "team", "1,0": 0xd9822b, "7,0": 0x8a6a4a },
    // A ginger fringe from ear to ear: from behind (how you see your own Giant) a bare head reads as an egg.
    extras: [
      { bone: "head", color: 0xc8701f, open: true, geo: () => new THREE.SphereGeometry(0.565, 14, 6, Math.PI * 0.93, Math.PI * 1.14, Math.PI * 0.36, Math.PI * 0.36).translate(0, 1.68, 0.03) },
    ],
    idle: "Unarmed_Idle",
    walk: "Walking_A",
    attack: "Unarmed_Melee_Attack_Punch_A",
    strike: 0.4,
    pace: 0.8,
  },
  valkyrie: {
    file: "rogue",
    scale: 1.1,
    props: ["Rogue_Cape", "barbarian:2H_Axe"],
    team: /Cape/,
    paint: { "1,0": 0xff8a1e, "0,1": "teamDark", "1,1": "team" },
    propPaint: { "2,2": "team" },
    idle: "2H_Melee_Idle",
    walk: "Walking_A",
    attack: "2H_Melee_Attack_Spin",
    strike: 0.45,
  },
  archers: {
    file: "rogue_hooded",
    scale: 1.0,
    props: ["Rogue_Cape", "1H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0xff5fa8, "1,1": 0x2fc46a, "0,1": 0x1f9a58 },
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Ranged_Shoot",
    strike: 0.3,
  },
  wizard: {
    file: "mage",
    scale: 1.08,
    props: ["Mage_Hat", "Mage_Cape"],
    paint: { "0,1": "team", "1,1": "team", "7,1": "teamDark", "2,1": 0xff9a1f, "5,0": 0xffb52e, "1,0": 0x6b4a2f },
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
  },
  witch: {
    file: "mage",
    scale: 1.08,
    props: ["Mage_Hat", "Mage_Cape", "2H_Staff"],
    team: /Cape/,
    paint: { "0,1": 0x8a48c8, "1,1": 0x7a3ab8, "7,1": 0x43206e, "1,0": 0xe9dcff, "6,2": 0xff5fe0, "5,0": "team", "2,2": 0x5a2d91 },
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
  },
  musketeer: {
    file: "rogue",
    scale: 1.08,
    props: ["Rogue_Cape"],
    team: /Cape/,
    paint: { "1,0": 0x6a45d8, "0,1": "teamDark", "1,1": "team" },
    extras: [
      { bone: "handslotr", local: true, color: 0x7a5230, geo: () => musketPart(box(0.13, 0.5, 0.17, 0, -0.28, 0)) },
      { bone: "handslotr", local: true, color: 0x7a5230, geo: () => musketPart(box(0.12, 0.44, 0.15, 0, 0.1, 0)) },
      { bone: "handslotr", local: true, color: 0x39404d, geo: () => musketPart(cyl(0.05, 0.055, 1.25, 0, 0.92, 0)) },
      { bone: "handslotr", local: true, color: 0xe2b23c, geo: () => musketPart(cyl(0.075, 0.075, 0.12, 0, 1.55, 0)) },
      { bone: "head", color: 0xc3ccd6, geo: () => new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(0, 1.86, -0.02) },
      { bone: "head", color: 0xe2b23c, geo: () => cyl(0.07, 0.07, 0.16, 0, 2.4, -0.02) },
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
  },
  "mini-pekka": {
    file: "knight",
    scale: 0.95,
    props: ["Knight_Helmet", "2H_Sword"],
    paint: {
      "3,0": 0x53679c, "7,0": 0x7f93c8, "7,1": 0x2c3a66, "1,1": 0x7f93c8, "2,1": 0x53679c, "3,1": 0xc3ccd6,
      "0,0": 0x141a2e, "1,0": 0x141a2e, "0,1": "team", "6,0": 0x2c3a66, "4,0": 0x2c3a66, "2,2": "team",
    },
    extras: [
      { bone: "head", color: "team", geo: () => cone(0.13, 0.5, 0.52, 2.42, 0.02, -0.75) },
      { bone: "head", color: "team", geo: () => cone(0.13, 0.5, -0.52, 2.42, 0.02, 0.75) },
      { bone: "head", color: 0x7df9ff, geo: () => box(0.56, 0.12, 0.08, 0, 1.78, 0.5) },
    ],
    idle: "2H_Melee_Idle",
    walk: "Running_A",
    attack: "2H_Melee_Attack_Chop",
    strike: 0.42,
    pace: 0.9,
  },
  skeletons: {
    file: "skeleton_minion",
    scale: 0.8,
    props: ["Skeleton_Blade"],
    team: /Cloak/,
    paint: { "1,1": 0xfff7ea },
    idle: "Idle",
    walk: "Running_A",
    attack: "1H_Melee_Attack_Chop",
    strike: 0.4,
    pace: 0.9,
  },
};
VARIANTS["skeleton-army"] = VARIANTS.skeletons;

/** More of the humanoid roster, cut from the same five bodies (not in the standard scene; lightly tuned). */
Object.assign(VARIANTS, {
  pekka: {
    file: "knight",
    scale: 1.55,
    props: ["Knight_Helmet", "2H_Sword"],
    paint: {
      "3,0": 0x4b4a8c, "7,0": 0x7a78c2, "7,1": 0x29285a, "1,1": 0x7a78c2, "2,1": 0x4b4a8c, "3,1": 0xc3ccd6,
      "0,0": 0x12122a, "1,0": 0x12122a, "0,1": "team", "6,0": 0x29285a, "4,0": 0x29285a, "2,2": "team",
    },
    extras: [
      { bone: "head", color: "team", geo: () => cone(0.16, 0.7, 0.56, 2.48, 0.02, -0.7) },
      { bone: "head", color: "team", geo: () => cone(0.16, 0.7, -0.56, 2.48, 0.02, 0.7) },
      { bone: "head", color: 0xff5fe0, geo: () => box(0.56, 0.12, 0.08, 0, 1.78, 0.5) },
    ],
    idle: "2H_Melee_Idle",
    walk: "Walking_A",
    attack: "2H_Melee_Attack_Chop",
    strike: 0.42,
    pace: 0.7,
  },
  "ice-wizard": {
    file: "mage",
    scale: 1.05,
    props: ["Mage_Hat", "Mage_Cape"],
    team: /Cape/,
    paint: { "0,1": 0x6cc8ff, "1,1": 0x8fdcff, "7,1": 0x3f8fd0, "5,0": 0xffffff, "1,0": 0xf2f8ff },
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
    pace: 0.85,
  },
  "electro-wizard": {
    file: "mage",
    scale: 1.05,
    props: ["Mage_Cape"],
    team: /Cape/,
    paint: { "0,1": 0x2f6fe0, "1,1": 0x2f6fe0, "7,1": 0x1c3f8f, "5,0": 0xffe14d, "1,0": 0x45d2ff },
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
  },
  "magic-archer": {
    file: "rogue_hooded",
    scale: 1.02,
    props: ["Rogue_Cape", "2H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0xffe9a8, "1,1": 0x35b8a6, "0,1": 0x1f8f86 },
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
  },
  princess: {
    file: "rogue",
    scale: 1.0,
    props: ["Rogue_Cape", "2H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0xffd24a, "1,1": 0xff7fbf, "0,1": 0xe0559a },
    extras: [
      { bone: "head", color: 0xffcf3a, open: true, geo: () => new THREE.CylinderGeometry(0.3, 0.26, 0.2, 10, 1, true).translate(0, 2.3, 0) },
      { bone: "head", color: 0xff5fa8, geo: () => new THREE.SphereGeometry(0.25, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 2.3, 0) },
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
  },
  firecracker: {
    file: "rogue_hooded",
    scale: 1.0,
    props: ["Rogue_Cape", "2H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0x8a4fe0, "1,1": 0xff6fae, "0,1": 0xd9488a },
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
  },
  executioner: {
    file: "barbarian",
    scale: 1.2,
    props: ["Barbarian_Hat", "1H_Axe"],
    paint: { "0,1": "team", "1,1": "team", "7,0": 0x3a3f4a, "1,0": 0x2e2a2a },
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Melee_Attack_Chop",
    strike: 0.42,
    pace: 0.85,
  },
  "royal-giant": {
    file: "barbarian",
    scale: 1.68,
    props: ["Barbarian_Hat", "Barbarian_Cape"],
    team: /Cape/,
    paint: { "0,1": "team", "1,1": "team", "1,0": 0x3a2c22, "7,0": 0x6a4a3a },
    extras: [
      { bone: "handslotr", local: true, color: 0x39404d, geo: () => musketPart(cyl(0.16, 0.2, 1.1, 0, 0.5, 0)) },
      { bone: "handslotr", local: true, color: 0xe2b23c, geo: () => musketPart(cyl(0.22, 0.22, 0.14, 0, 1.05, 0)) },
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
    pace: 0.75,
  },
} satisfies Record<string, Variant>);

/** Crown-tower crews (not cards): a hooded crossbow archer on each princess tower, a crowned king on the keep. */
VARIANTS["tower-princess"] = {
  file: "rogue_hooded",
  scale: 0.95,
  props: ["Rogue_Cape", "2H_Crossbow"],
  team: /Cape/,
  paint: { "1,0": 0xffd24a, "1,1": "team", "0,1": "teamDark" },
  idle: "2H_Ranged_Aiming",
  walk: "Walking_A",
  attack: "2H_Ranged_Shoot",
  strike: 0.3,
};
VARIANTS["tower-king"] = {
  file: "knight",
  scale: 1.12,
  props: ["Knight_Cape", "1H_Sword", "Badge_Shield"],
  team: /Cape/,
  paint: { "0,1": "team", "1,0": 0xf2c65a, "3,0": 0xf0c648, "7,0": 0xffe27a, "6,2": "team" },
  extras: [
    { bone: "head", color: 0xffcf3a, open: true, geo: () => new THREE.CylinderGeometry(0.47, 0.42, 0.26, 12, 1, true).translate(0, 2.32, 0) },
    ...[0, 1, 2, 3, 4, 5].map((i): Extra => ({
      bone: "head",
      color: 0xffcf3a,
      geo: () => cone(0.11, 0.3, Math.cos((i / 6) * Math.PI * 2) * 0.44, 2.56, Math.sin((i / 6) * Math.PI * 2) * 0.44),
    })),
    { bone: "head", color: "team", geo: () => new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 2.3, 0) },
  ],
  idle: "Idle",
  walk: "Walking_A",
  attack: "1H_Melee_Attack_Chop",
  strike: 0.42,
};

interface Source {
  rig: THREE.Object3D;
  image: CanvasImageSource;
  /** Deform bones of the source rig, by BONES index. */
  bones: THREE.Bone[];
  inverses: THREE.Matrix4[];
  /** Source skeleton joint -> BONES index (unknown joints ride the root). */
  remap: number[];
}

const sources = new Map<FileId, Source>();
const clips = new Map<string, THREE.AnimationClip>();
let loading: Promise<boolean> | null = null;
let ready = false;

/** Off in node (tests) and with `?troops=rigs` (A/B against the hand-built roster). */
export function kitTroopsWanted(): boolean {
  try {
    if (typeof document === "undefined") return false;
    return new URLSearchParams(location.search).get("troops") !== "rigs";
  } catch {
    return false;
  }
}

/** Start (or join) the one load of the character pack; resolves false if it failed. */
export function loadKitTroops(): Promise<boolean> {
  if (!kitTroopsWanted()) return Promise.resolve(false);
  loading ??= (async () => {
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/troops/`;
    const [anims, ...chars] = await Promise.all([
      loader.loadAsync(`${base}anims.glb`),
      ...FILES.map((f) => loader.loadAsync(`${base}${f}.glb`)),
    ]);
    for (const clip of anims.animations) clips.set(clip.name, clip);
    chars.forEach((gltf, i) => {
      const rig = gltf.scene;
      rig.updateMatrixWorld(true);
      let skinned: THREE.SkinnedMesh | null = null;
      let image: CanvasImageSource | null = null;
      rig.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && !skinned) skinned = m;
        const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map;
        if (map && !image) image = map.image as CanvasImageSource;
      });
      if (!skinned || !image) throw new Error(`kit troops: ${FILES[i]} has no skinned mesh or palette`);
      const skeleton = (skinned as THREE.SkinnedMesh).skeleton;
      const bones: THREE.Bone[] = [];
      const inverses: THREE.Matrix4[] = [];
      const remap = skeleton.bones.map((bone, j) => {
        const at = BONE_INDEX.get(bone.name);
        if (at === undefined) return 0;
        bones[at] = bone;
        inverses[at] = skeleton.boneInverses[j];
        return at;
      });
      if (bones.filter(Boolean).length !== BONES.length) throw new Error(`kit troops: ${FILES[i]} is missing rig bones`);
      sources.set(FILES[i], { rig, image, bones, inverses, remap });
    });
    ready = true;
    return true;
  })().catch((err) => {
    console.warn("kit troops: pack failed to load, keeping the hand-built roster", err);
    return false;
  });
  return loading;
}

/** True when this card has a modelled character and the pack is in. */
export function hasKitTroop(cardId: string): boolean {
  return ready && VARIANTS[cardId] !== undefined;
}

// ---------------------------------------------------------------- palette

/** Atlas tile size: the packs' 1024 px palettes are flat gradient swatches. */
const TILE = 256;
const HSL = { h: 0, s: 0, l: 0 };
const COL = new THREE.Color();

function hslOf(hex: number): { h: number; s: number; l: number } {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(out, THREE.SRGBColorSpace);
  return out;
}

function paintHex(p: Paint, team: Side): number {
  return p === "team" ? teamColor(team, "main") : p === "teamDark" ? teamColor(team, "dark") : p;
}

/** Skin swatches of the human palettes, repainted a warm peach (the lift alone washes them to egg white). */
const SKIN = 0xee9c68;
const SKIN_SWATCHES: Partial<Record<FileId, Swatch[]>> = {
  knight: ["0,0"],
  barbarian: ["0,0"],
  mage: ["0,0", "7,2"],
  rogue: ["0,0"],
  rogue_hooded: ["0,0"],
};

/** Re-grade one palette tile in place: brighter and more saturated, with the variant's repaints. */
function gradeTile(px: Uint8ClampedArray, width: number, x0: number, file: FileId, paint: Variant["paint"], team: Side): void {
  const cell = TILE / 8;
  const targets = new Map<string, { h: number; s: number; l: number }>();
  for (const k of SKIN_SWATCHES[file] ?? []) targets.set(k, hslOf(SKIN));
  for (const [k, p] of Object.entries(paint ?? {})) targets.set(k, hslOf(paintHex(p as Paint, team)));
  // The lightest pixel of each swatch: a repaint keeps the swatch's own gradient under it.
  const top = new Map<string, number>();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * width + x0 + x) * 4;
        COL.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255).getHSL(HSL);
        const key = `${Math.floor(x / cell)},${Math.floor(y / cell) >> 1}`;
        if (pass === 0) {
          top.set(key, Math.max(top.get(key) ?? 0, HSL.l));
          continue;
        }
        const t = targets.get(key);
        if (t) {
          const k = HSL.l / Math.max(0.05, top.get(key) ?? 1);
          COL.setHSL(t.h, t.s, Math.min(0.94, t.l * (0.52 + 0.56 * k)));
        } else if (HSL.s < 0.12) {
          // Steel, bone and cloth greys: lifted, a touch cool.
          COL.setHSL(0.6, 0.1 + HSL.s, Math.min(0.95, Math.pow(HSL.l, 0.72)));
        } else {
          COL.setHSL(HSL.h, Math.min(1, HSL.s * 1.3 + 0.04), Math.min(0.9, Math.pow(HSL.l, 0.86)));
        }
        px[i] = Math.round(COL.r * 255);
        px[i + 1] = Math.round(COL.g * 255);
        px[i + 2] = Math.round(COL.b * 255);
      }
    }
  }
}

const textures = new Map<string, THREE.Texture>();

/**
 * A variant's atlas for one team: its character's palette, a borrowed
 * prop's palette, a team-colour tile (capes) and a white tile (our own
 * primitives, coloured per vertex), side by side.
 */
function atlas(cardId: string, v: Variant, team: Side): THREE.Texture {
  const key = `${cardId}:${team}:${teamPalette()}`;
  let tex = textures.get(key);
  if (tex) return tex;
  const files = atlasFiles(v);
  const tiles = files.length + 2;
  const c = document.createElement("canvas");
  c.width = tiles * TILE;
  c.height = TILE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  files.forEach((f, i) => ctx.drawImage(sources.get(f)!.image, i * TILE, 0, TILE, TILE));
  const data = ctx.getImageData(0, 0, c.width, c.height);
  files.forEach((f, i) => gradeTile(data.data, c.width, i * TILE, f, i === 0 ? v.paint : v.propPaint, team));
  ctx.putImageData(data, 0, 0);
  // Team tile: four swatch rows, each light at the top like the packs' own.
  const main = new THREE.Color(teamColor(team, "main"));
  const dark = new THREE.Color(teamColor(team, "dark"));
  const light = main.clone().lerp(new THREE.Color(0xffffff), 0.1);
  for (let r = 0; r < 4; r++) {
    const g = ctx.createLinearGradient(0, r * (TILE / 4), 0, (r + 1) * (TILE / 4));
    g.addColorStop(0, `#${light.getHexString()}`);
    g.addColorStop(0.3, `#${main.getHexString()}`);
    g.addColorStop(1, `#${dark.getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(files.length * TILE, r * (TILE / 4), TILE, TILE / 4);
    // A gold hem: the packs map a cape's lower edge to the foot of its swatch.
    ctx.fillStyle = "#ffd65a";
    ctx.fillRect(files.length * TILE, (r + 1) * (TILE / 4) - TILE / 28, TILE, TILE / 28);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect((files.length + 1) * TILE, 0, TILE, TILE);
  tex = new THREE.CanvasTexture(c);
  tex.flipY = false; // glTF convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false; // flat swatches: mips would bleed one into the next
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.userData.shared = true;
  textures.set(key, tex);
  return tex;
}

/** The palettes a variant's atlas holds: its own, then any borrowed prop's. */
function atlasFiles(v: Variant): FileId[] {
  const files: FileId[] = [v.file];
  for (const p of v.props) {
    const from = p.includes(":") ? (p.split(":")[0] as FileId) : v.file;
    if (!files.includes(from)) files.push(from);
  }
  return files;
}

// ------------------------------------------------------------------- bake

interface Baked {
  geometry: THREE.BufferGeometry;
  /** Index count of the body (the ink shell follows it). */
  bodyCount: number;
  /** The same buffers without the shell, for the see-through deploy ghost. */
  ghost?: THREE.BufferGeometry;
  /** Top of the model in rig units (before the variant scale). */
  top: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  /** Rigid parts: the transform into skin space and the bone they ride. */
  matrix: THREE.Matrix4 | null;
  bone: number;
  remap: number[] | null;
  /** Atlas tile, or -1 team tile, -2 white tile. */
  tile: number;
  color: THREE.Color | null;
  twoSided: boolean;
  /** Our own primitives carry no palette UVs: one flat texel. */
  flat?: boolean;
  /** Capes are cut to this share of their length (the top edge stays on the shoulders). */
  crop?: number;
  /** Hats are narrowed about the head's axis by this factor. */
  squeeze?: number;
}

/**
 * The packs' capes reach the heels and hide the whole figure from behind,
 * which is how you see your own troops: they are cut to a short mantle so
 * belt, legs and boots show under the team colour.
 */
const CAPE_LENGTH = 0.56;
/** The Mage's hat brim hides the whole wizard from the battle camera: it is narrowed to show the shoulders. */
const HAT_BRIM = 0.8;

const baked = new Map<string, Baked>();
const M = new THREE.Matrix4();
const V3 = new THREE.Vector3();
const N3 = new THREE.Vector3();
const NM = new THREE.Matrix3();

/** Where a rigid node sits in skin space, riding `bone` of its own character. */
function rigidMatrix(src: Source, bone: number, world: THREE.Matrix4): THREE.Matrix4 {
  // skinned = boneWorld * boneInverse * v, so v = boneInverse^-1 * boneWorldRest^-1 * world * p.
  return new THREE.Matrix4()
    .copy(src.inverses[bone])
    .invert()
    .multiply(M.copy(src.bones[bone].matrixWorld).invert())
    .multiply(world);
}

function boneAbove(o: THREE.Object3D): number {
  for (let p = o.parent; p; p = p.parent) {
    const at = BONE_INDEX.get(p.name);
    if (at !== undefined && (p as THREE.Bone).isBone) return at;
  }
  return 0;
}

function bake(cardId: string, v: Variant): Baked {
  const hit = baked.get(cardId);
  if (hit) return hit;
  const src = sources.get(v.file)!;
  const files = atlasFiles(v);
  const parts: Part[] = [];

  src.rig.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || v.drop?.test(m.name)) return;
    const glow = ((m.material as THREE.MeshStandardMaterial).map ?? null) === null;
    parts.push({
      geo: m.geometry,
      matrix: null,
      bone: 0,
      remap: src.remap,
      tile: glow ? -2 : v.team?.test(m.name) ? -1 : 0,
      color: glow ? new THREE.Color(0xbfff6a) : null,
      twoSided: /Cape|Cloak/.test(m.name),
    });
  });
  for (const p of v.props) {
    const [file, node] = p.includes(":") ? (p.split(":") as [FileId, string]) : [v.file, p];
    const from = sources.get(file)!;
    const mesh = from.rig.getObjectByName(node) as THREE.Mesh | undefined;
    if (!mesh?.isMesh) {
      console.warn(`kit troops: ${cardId} prop ${p} not found`);
      continue;
    }
    const bone = boneAbove(mesh);
    parts.push({
      geo: mesh.geometry,
      matrix: rigidMatrix(from, bone, mesh.matrixWorld),
      bone,
      remap: null,
      tile: v.team?.test(node) ? -1 : files.indexOf(file),
      color: null,
      twoSided: /Cape|Cloak/.test(node),
      crop: /Cape/.test(node) ? CAPE_LENGTH : undefined,
      squeeze: /Mage_Hat/.test(node) ? HAT_BRIM : undefined,
    });
  }
  for (const x of v.extras ?? []) {
    const bone = BONE_INDEX.get(x.bone) ?? 0;
    const world = x.local ? src.bones[bone].matrixWorld.clone() : new THREE.Matrix4();
    parts.push({
      geo: x.geo(),
      matrix: rigidMatrix(src, bone, world),
      bone,
      remap: null,
      tile: x.color === "team" || x.color === "teamDark" ? -1 : -2,
      color: typeof x.color === "number" ? new THREE.Color(x.color) : null,
      twoSided: x.open === true,
      flat: true,
    });
  }

  let verts = 0;
  for (const p of parts) verts += p.geo.getAttribute("position").count;
  // Body vertices first, then the same again as the ink shell.
  const position = new Float32Array(verts * 2 * 3);
  const normal = new Float32Array(verts * 2 * 3);
  const uv = new Float32Array(verts * 2 * 2);
  const color = new Float32Array(verts * 2 * 3).fill(1);
  const skinIndex = new Uint16Array(verts * 2 * 4);
  const skinWeight = new Float32Array(verts * 2 * 4);
  const outlineNormal = new Float32Array(verts * 2 * 3);
  const index: number[] = [];
  const hull: number[] = [];
  const tiles = files.length + 2;
  let at = 0;
  let top = 0;
  for (const p of parts) {
    const pos = p.geo.getAttribute("position");
    const nor = p.geo.getAttribute("normal");
    const tex = p.geo.getAttribute("uv");
    const si = p.geo.getAttribute("skinIndex");
    const sw = p.geo.getAttribute("skinWeight");
    if (p.matrix) NM.getNormalMatrix(p.matrix);
    let capeTop = -Infinity;
    if (p.crop && p.matrix) {
      for (let i = 0; i < pos.count; i++) capeTop = Math.max(capeTop, V3.fromBufferAttribute(pos, i).applyMatrix4(p.matrix).y);
    }
    for (let i = 0; i < pos.count; i++) {
      const o = at + i;
      V3.fromBufferAttribute(pos, i);
      N3.fromBufferAttribute(nor, i);
      if (p.matrix) {
        V3.applyMatrix4(p.matrix);
        N3.applyMatrix3(NM).normalize();
      }
      if (p.crop) V3.y = capeTop - (capeTop - V3.y) * p.crop;
      if (p.squeeze) {
        V3.x *= p.squeeze;
        V3.z *= p.squeeze;
      }
      position.set([V3.x, V3.y, V3.z], o * 3);
      normal.set([N3.x, N3.y, N3.z], o * 3);
      top = Math.max(top, V3.y);
      const tile = p.tile === -1 ? files.length : p.tile === -2 ? files.length + 1 : p.tile;
      const u = p.tile < 0 || !tex ? 0.5 : tex.getX(i);
      const w = p.flat ? 0.3 : p.tile === -2 || !tex ? 0.5 : tex.getY(i);
      uv.set([(tile + u) / tiles, w], o * 2);
      if (p.color) color.set([p.color.r, p.color.g, p.color.b], o * 3);
      if (p.remap && si && sw) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const weight = sw.getComponent(i, k);
          skinIndex[o * 4 + k] = weight > 0 ? p.remap[si.getComponent(i, k)] : 0;
          skinWeight[o * 4 + k] = weight;
          sum += weight;
        }
        if (sum > 0) for (let k = 0; k < 4; k++) skinWeight[o * 4 + k] /= sum;
      } else {
        skinIndex[o * 4] = p.bone;
        skinWeight[o * 4] = 1;
      }
    }
    const idx = p.geo.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = at + (idx ? idx.getX(i) : i);
      const b = at + (idx ? idx.getX(i + 1) : i + 1);
      const c = at + (idx ? idx.getX(i + 2) : i + 2);
      index.push(a, b, c);
      // A cape is one sheet: its back face is drawn too (the shell rules out a double-sided material).
      if (p.twoSided) index.push(a, c, b);
      else hull.push(a + verts, c + verts, b + verts);
    }
    at += pos.count;
  }

  // The ink shell: every body vertex again, pushed out along a normal smoothed over coincident vertices.
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.BufferAttribute(position.subarray(0, verts * 3), 3));
  body.setAttribute("normal", new THREE.BufferAttribute(normal.subarray(0, verts * 3), 3));
  const smooth = smoothedNormals(body);
  position.copyWithin(verts * 3, 0, verts * 3);
  normal.copyWithin(verts * 3, 0, verts * 3);
  uv.copyWithin(verts * 2, 0, verts * 2);
  skinIndex.copyWithin(verts * 4, 0, verts * 4);
  skinWeight.copyWithin(verts * 4, 0, verts * 4);
  outlineNormal.set(smooth, verts * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(outlineNormal, 3));
  geometry.setIndex([...index, ...hull]);
  geometry.userData.shared = true;
  registerInkGeometry(geometry, index.length);
  // Posed far from the rest pose every frame: a fixed, generous sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 3.2);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-3, -0.5, -3), new THREE.Vector3(3, 3.6, 3));
  const out: Baked = { geometry, top, bodyCount: index.length };
  baked.set(cardId, out);
  return out;
}

// --------------------------------------------------------------- material

/**
 * The troops' cel ramp: three bands like the roster's, but the shadow band
 * is lighter and warmer, so a small character seen from above never sinks
 * into a dark blob.
 */
let ramp: THREE.DataTexture | null = null;
function troopRamp(): THREE.DataTexture {
  if (!ramp) {
    const data = new Uint8Array([
      128, 124, 176, 255,
      206, 200, 226, 255,
      255, 252, 244, 255,
      255, 252, 244, 255,
    ]);
    ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    ramp.minFilter = THREE.LinearFilter;
    ramp.magFilter = THREE.LinearFilter;
    ramp.colorSpace = THREE.NoColorSpace;
    ramp.userData.shared = true;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/** A unit's own toon material over its variant's atlas: coloured ramp, rim light and the skinned ink shell. */
function troopMaterial(map: THREE.Texture): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ map, color: 0xffffff, vertexColors: true, gradientMap: troopRamp() });
  mat.onBeforeCompile = (sh) => {
    installInk(sh);
    // The shell rides the bones too: skin its normal before pushing it out.
    sh.vertexShader = sh.vertexShader.replace(
      "vec3 nView = normalize(normalMatrix * outlineNormal);",
      `#ifdef USE_SKINNING
         vec3 nView = normalize(normalMatrix * (skinMatrix * vec4(outlineNormal, 0.0)).xyz);
       #else
         vec3 nView = normalize(normalMatrix * outlineNormal);
       #endif`,
    );
    // Hit, rage and freeze glows ride the emissive: on these light palettes the roster's
    // full-white flash blooms the whole figure away, so it lands at about a quarter strength.
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n totalEmissiveRadiance *= 0.28;",
    );
    // A finer line than the chunky roster's: the models carry their own detail.
    sh.vertexShader = sh.vertexShader.replace("* uInkPx * 2.0 / uInkViewport", "* uInkPx * 1.6 / uInkViewport");
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <gradientmap_pars_fragment>",
      `uniform sampler2D gradientMap;
       vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
         float dotNL = dot( normal, lightDirection );
         return texture2D( gradientMap, vec2( dotNL * 0.5 + 0.5, 0.0 ) ).rgb;
       }`,
    );
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `${INK_FRAGMENT}
         float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
         _rim = smoothstep(0.62, 1.0, _rim) * 0.34;
         gl_FragColor.rgb += _rim * vec3(0.62, 0.72, 0.9);
       }
       #include <dithering_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => "kit-troop-v1";
  return mat;
}

// ------------------------------------------------------------------- unit

export interface KitUnit {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; attack: THREE.AnimationAction };
  /** Blend weights of idle / walk / attack. */
  weights: [number, number, number];
  /** Height of the scaled model, for the HP bar and name chip. */
  height: number;
  strike: number;
  pace: number;
  /** The variant's resting scale (the view layers its entrance and hit squash on it). */
  scale: number;
  skeleton: THREE.Skeleton;
}

/** A posed, animated unit of a card for a team, or null without the pack. */
export function makeKitTroop(cardId: string, team: Side): KitUnit | null {
  const v = VARIANTS[cardId];
  if (!ready || !v) return null;
  const src = sources.get(v.file)!;
  const { geometry, top } = bake(cardId, v);

  const group = new THREE.Group();
  group.name = "kitTroop";
  group.scale.setScalar(v.scale);
  const bones = src.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.copy(b.position);
    bone.quaternion.copy(b.quaternion);
    bone.scale.copy(b.scale);
    return bone;
  });
  src.bones.forEach((b, i) => {
    const parent = b.parent ? BONE_INDEX.get(b.parent.name) : undefined;
    if (parent !== undefined && (b.parent as THREE.Bone).isBone) bones[parent].add(bones[i]);
    else group.add(bones[i]);
  });
  const skeleton = new THREE.Skeleton(bones, src.inverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(geometry, troopMaterial(atlas(cardId, v, team)));
  mesh.name = "kitBody";
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.onBeforeRender = fitInk;
  group.add(mesh);

  const mixer = new THREE.AnimationMixer(group);
  const action = (name: string): THREE.AnimationAction => {
    const clip = clips.get(name) ?? clips.get("Idle")!;
    const a = mixer.clipAction(clip);
    a.play();
    return a;
  };
  const actions = { idle: action(v.idle), walk: action(v.walk), attack: action(v.attack) };
  actions.attack.paused = true; // posed from the sim's attack timer, never by the mixer clock
  actions.walk.setEffectiveWeight(0);
  actions.attack.setEffectiveWeight(0);
  actions.idle.time = Math.random() * actions.idle.getClip().duration;
  mixer.update(0);
  return {
    group,
    mixer,
    actions,
    weights: [1, 0, 0],
    height: top * v.scale,
    strike: v.strike,
    pace: v.pace ?? 1,
    scale: v.scale,
    skeleton,
  };
}

export interface KitPose {
  moving: boolean;
  attacking: boolean;
  /** Seconds until the next blow lands, and the seconds between blows. */
  cooldown: number;
  hitSpeed: number;
  /** Walk / swing speed multiplier (slow, rage). */
  rate: number;
  frozen: boolean;
}

/** Drive a unit's clips from its combat state: walk and idle on the clock, the attack locked to the sim's timer. */
export function animateKitTroop(u: KitUnit, s: KitPose, dt: number): void {
  if (s.frozen) return; // stunned: the whole body holds its pose
  const want = s.attacking ? 2 : s.moving ? 1 : 0;
  const k = Math.min(1, dt / 0.14);
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    u.weights[i] += ((i === want ? 1 : 0) - u.weights[i]) * k;
    sum += u.weights[i];
  }
  const { idle, walk, attack } = u.actions;
  idle.setEffectiveWeight(u.weights[0] / sum);
  walk.setEffectiveWeight(u.weights[1] / sum);
  attack.setEffectiveWeight(u.weights[2] / sum);
  walk.setEffectiveTimeScale(u.pace * s.rate);

  // The clip's blow lands exactly when the sim's does: wind up into it, follow through after.
  const d = attack.getClip().duration;
  const hs = Math.max(0.05, s.hitSpeed);
  const speed = Math.max(1, d / hs);
  const pre = (u.strike * d) / speed;
  const post = ((1 - u.strike) * d) / speed;
  const since = hs - s.cooldown;
  let t = 0;
  if (s.attacking) {
    if (s.cooldown <= pre) t = u.strike * d - s.cooldown * speed;
    else if (since <= post) t = u.strike * d + since * speed;
  }
  attack.time = Math.max(0, Math.min(d - 1e-3, t));
  u.mixer.update(dt);
}

/** The translucent deploy preview of a card's character (yours), or null without the pack. */
export function makeKitGhost(cardId: string): { group: THREE.Group; height: number } | null {
  const unit = makeKitTroop(cardId, "player");
  const v = VARIANTS[cardId];
  if (!unit || !v) return null;
  const b = bake(cardId, v);
  if (!b.ghost) {
    // The ink shell cannot blend: the ghost draws the body's index range only, over the same buffers.
    b.ghost = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(b.geometry.attributes)) b.ghost.setAttribute(name, attr);
    b.ghost.setIndex(b.geometry.index);
    b.ghost.setDrawRange(0, b.bodyCount);
    b.ghost.boundingSphere = b.geometry.boundingSphere;
    b.ghost.userData.shared = true;
  }
  const mesh = unit.group.getObjectByName("kitBody") as THREE.SkinnedMesh;
  mesh.geometry = b.ghost;
  const mat = mesh.material as THREE.MeshToonMaterial;
  mat.transparent = true;
  mat.opacity = 0.55;
  return { group: unit.group, height: unit.height };
}

/** Free a unit's bone texture (its geometry and atlas are shared, its material is disposed with the view). */
export function disposeKitTroop(u: KitUnit): void {
  u.mixer.stopAllAction();
  u.skeleton.dispose();
}

/** For the contact sheet and tools: the cards that have a modelled character. */
export function kitTroopCards(): string[] {
  return Object.keys(VARIANTS);
}
