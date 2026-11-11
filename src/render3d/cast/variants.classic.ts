/**
 * The Classic edition's cast: one VARIANT per humanoid card (and the tower
 * crews), cut from the five KayKit bodies. Each must read at phone size
 * from the front AND from behind (how you see your own troops): every
 * variant names at least two back-visible silhouette features in `back`.
 *
 * Team colour only on cloth (capes, the knight's tabard, the rogues'
 * hood-and-cape swatch, cloth extras); signature colours stay fixed and
 * outside both team hue families (see rules.ts).
 */
import * as THREE from "three";
import { ball, beard, box, braids, cap, cone, crown, cyl, inHand, musket, quiver, torus, x, HEAD_TOP } from "./props";
import type { Variant } from "./types";

const GOLD = 0xf2c65a;
const STEEL = 0xb4c0d0;
const LEATHER = 0x7a4a2a;

export const CLASSIC: Record<string, Variant> = {
  knight: {
    file: "knight",
    scale: 0.92,
    props: ["Knight_Helmet", "Knight_Cape", "1H_Sword", "Badge_Shield"],
    team: /Cape/,
    paint: { "0,1": "team", "1,0": GOLD, "3,0": 0xa9b7cc, "7,0": 0xd3dcea },
    extras: [
      // A tall golden plume on the helm: the knight's head reads from every side.
      x("head", 0xffd23f, () => ball(0.13, 0, HEAD_TOP + 0.2, -0.05, 1, 2.0, 1.6, 10)),
      x("head", 0xffd23f, () => ball(0.11, 0, HEAD_TOP + 0.08, -0.34, 1, 1.4, 1.8, 10)),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Melee_Attack_Slice_Diagonal",
    strike: 0.42,
    back: ["golden plume on the helm", "sword held out past the body", "shield on the left arm"],
  },
  archers: {
    file: "rogue",
    scale: 1.0,
    props: ["Rogue_Cape"],
    team: /Cape/,
    paint: { "1,0": 0xff5fa8, "0,1": 0x2fa86a, "1,1": "team" },
    extras: [
      // A pink ponytail swinging out behind the head.
      x("head", 0xff5fa8, () => ball(0.17, 0, 2.02, -0.5, 1, 1.25, 1.1, 10)),
      x("head", 0xff5fa8, () => ball(0.12, 0, 1.76, -0.6, 1, 1.4, 1, 10)),
      x("head", 0x2fa86a, () => torus(0.12, 0.04, 0, 2.1, -0.42, 0.4, 10)),
      ...quiver(LEATHER, 0xf2ead8),
      // The bow: a long arc in the shooting hand, out past the shoulders.
      inHand(0x8a5a2e, () => new THREE.TorusGeometry(0.66, 0.05, 5, 16, Math.PI * 0.85).rotateZ(Math.PI * 0.575).rotateY(Math.PI / 2).translate(0, 0.15, -0.2)),
      inHand(0xf2ead8, () => box(0.02, 1.12, 0.02, 0, 0.15, 0.24)),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Ranged_Shoot",
    strike: 0.3,
    back: ["pink ponytail", "quiver of white-fletched arrows", "bow arc out past the shoulders"],
  },
  giant: {
    file: "barbarian",
    scale: 1.42,
    props: ["Barbarian_Cape"],
    team: /Cape/,
    cape: 0.5,
    stretch: 1.16,
    headScale: 0.94,
    paint: { "0,1": 0x8a6a4a, "1,1": 0x8a6a4a, "1,0": 0xc8701f, "7,0": 0x6a4a32, "2,1": 0xe8dcc0 },
    // A ginger fringe from ear to ear and a big ginger beard: from behind a bare head reads as an egg.
    extras: [
      x("head", 0xc8701f, () => new THREE.SphereGeometry(0.58, 16, 6, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.34, Math.PI * 0.38).translate(0, 1.7, 0.03), { open: true }),
      ...beard(0xc8701f, 1.05),
      // A leather belt with a brass buckle.
      x("hips", 0x5a3a22, () => torus(0.5, 0.07, 0, 1.0, 0.02, Math.PI / 2, 18)),
      x("hips", 0xe2b23c, () => box(0.18, 0.16, 0.06, 0, 1.0, 0.52)),
    ],
    idle: "Unarmed_Idle",
    walk: "Walking_A",
    attack: "Unarmed_Melee_Attack_Punch_A",
    strike: 0.4,
    back: ["bald head ringed by a ginger fringe", "broad bare shoulders under a short team mantle", "beard poking out past the cheeks"],
  },
  valkyrie: {
    file: "rogue",
    scale: 1.02,
    props: ["Rogue_Cape", "barbarian:2H_Axe"],
    team: /Cape/,
    paint: { "1,0": 0xffa21e, "0,1": 0x8a6a4a, "1,1": "team" },
    propPaint: { "2,2": 0x8a6a4a },
    extras: [
      ...braids(0xffa21e),
      // A winged steel cap.
      x("head", STEEL, () => cap(0.5, 0.36, 0, 1.96, 0, 1.0)),
      x("head", 0xf5f0e6, () => cone(0.09, 0.36, 0.5, 2.25, 0, -1.1, 0, 6)),
      x("head", 0xf5f0e6, () => cone(0.09, 0.36, -0.5, 2.25, 0, 1.1, 0, 6)),
    ],
    idle: "2H_Melee_Idle",
    walk: "Walking_A",
    attack: "2H_Melee_Attack_Spin",
    strike: 0.45,
    back: ["two orange braids down the back", "winged steel cap", "big axe held out past the body"],
  },
  wizard: {
    file: "mage",
    scale: 0.88,
    props: ["Mage_Hat", "Mage_Cape"],
    team: /Cape/,
    brim: 0.74,
    hairBack: "1,1",
    paint: { "0,1": 0x1f8f86, "1,1": 0x1f8f86, "7,1": 0x125a55, "5,0": 0xffb52e, "1,0": 0x6b4a2f, "2,1": "team" },
    extras: [
      // A crooked hat tip and a flame-orange orb on a short staff in the casting hand.
      x("head", 0x1f8f86, () => cone(0.16, 0.5, 0.08, HEAD_TOP + 0.62, -0.12, -0.35, -0.35, 8)),
      inHand(0x6b4a2f, () => cyl(0.045, 0.05, 1.1, 0, 0.25, 0, 6)),
      inHand(0xffa21e, () => ball(0.16, 0, 0.86, 0, 1, 1, 1, 10)),
      ...beard(0xf0ebe0, 0.6),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
    back: ["tall crooked teal hat", "staff with a flame orb out past the body", "short team cape"],
  },
  musketeer: {
    file: "rogue",
    scale: 0.96,
    props: ["Rogue_Cape"],
    team: /Cape/,
    paint: { "1,0": 0x7a52e0, "0,1": 0x55606e, "1,1": "team" },
    extras: [
      ...musket(),
      // A steel morion helmet with a brass finial, and a purple ponytail.
      x("head", 0xc3ccd6, () => cap(0.52, 0.42, 0, 1.92, -0.02, 1.0)),
      x("head", 0xc3ccd6, () => torus(0.5, 0.05, 0, 2.0, -0.02, Math.PI / 2, 16)),
      x("head", 0xe2b23c, () => cyl(0.07, 0.07, 0.18, 0, 2.48, -0.02, 8)),
      x("head", 0x7a52e0, () => ball(0.15, 0, 1.72, -0.52, 1, 1.4, 1, 10)),
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
    back: ["steel helmet with a brass finial", "musket barrel out past the shoulder", "purple ponytail"],
  },
  "mini-pekka": {
    file: "knight",
    scale: 0.92,
    props: ["Knight_Helmet", "2H_Sword"],
    paint: {
      "3,0": 0x5d5a6e, "7,0": 0x8d8aa0, "7,1": 0x34323f, "1,1": 0x8d8aa0, "2,1": 0x5d5a6e, "3,1": 0xd6dde6,
      "0,0": 0x1b1a22, "1,0": 0x1b1a22, "6,0": 0x34323f, "4,0": 0x34323f, "0,1": "team",
    },
    propPaint: { "2,2": 0x34323f },
    extras: [
      // Curled horns and a glowing cyan visor slit.
      x("head", 0xe8e0d0, () => cone(0.13, 0.55, 0.52, HEAD_TOP + 0.08, 0.02, -0.8, 0, 8)),
      x("head", 0xe8e0d0, () => cone(0.13, 0.55, -0.52, HEAD_TOP + 0.08, 0.02, 0.8, 0, 8)),
      x("head", 0x7df9ff, () => box(0.56, 0.12, 0.08, 0, 1.78, 0.5)),
    ],
    idle: "2H_Melee_Idle",
    walk: "Running_A",
    attack: "2H_Melee_Attack_Chop",
    strike: 0.42,
    back: ["two pale horns on a gunmetal helm", "big two-handed sword"],
  },
  skeletons: {
    file: "skeleton_minion",
    scale: 0.82,
    props: ["Skeleton_Blade"],
    team: /Cloak/,
    paint: { "1,1": 0xfff7ea },
    idle: "Idle",
    walk: "Running_A",
    attack: "1H_Melee_Attack_Chop",
    strike: 0.4,
    back: ["bare skull", "bone blade held out", "ragged team hood-cloak"],
  },
  witch: {
    file: "mage",
    scale: 0.92,
    props: ["Mage_Hat", "Mage_Cape", "2H_Staff"],
    team: /Cape/,
    hairBack: "1,1",
    paint: { "0,1": 0x8a48c8, "1,1": 0x7a3ab8, "7,1": 0x43206e, "1,0": 0xe9dcff, "6,2": 0xff5fe0, "5,0": GOLD, "2,2": 0x5a2d91, "2,1": "team" },
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
    back: ["tall purple hat", "pink-gem staff out past the body", "team cape"],
  },
};
CLASSIC["skeleton-army"] = CLASSIC.skeletons;

/** More of the humanoid roster, cut from the same five bodies. */
Object.assign(CLASSIC, {
  pekka: {
    file: "knight",
    scale: 1.38,
    props: ["Knight_Helmet", "2H_Sword"],
    girth: 1.1,
    paint: {
      "3,0": 0x4e4a66, "7,0": 0x7e78a6, "7,1": 0x2a2838, "1,1": 0x7e78a6, "2,1": 0x4e4a66, "3,1": 0xd6dde6,
      "0,0": 0x12121a, "1,0": 0x12121a, "6,0": 0x2a2838, "4,0": 0x2a2838, "0,1": "team",
    },
    propPaint: { "2,2": 0x2a2838 },
    extras: [
      x("head", 0xe8e0d0, () => cone(0.16, 0.75, 0.56, HEAD_TOP + 0.14, 0.02, -0.7, 0, 8)),
      x("head", 0xe8e0d0, () => cone(0.16, 0.75, -0.56, HEAD_TOP + 0.14, 0.02, 0.7, 0, 8)),
      x("head", 0xff5fe0, () => box(0.56, 0.12, 0.08, 0, 1.78, 0.5)),
      x("chest", 0x4e4a66, () => ball(0.3, 0.62, 1.65, 0, 1, 0.7, 1, 10)),
      x("chest", 0x4e4a66, () => ball(0.3, -0.62, 1.65, 0, 1, 0.7, 1, 10)),
    ],
    idle: "2H_Melee_Idle",
    walk: "Walking_A",
    attack: "2H_Melee_Attack_Chop",
    strike: 0.42,
    back: ["long curved horns", "huge pauldrons", "two-handed sword"],
  },
  "ice-wizard": {
    file: "mage",
    hairBack: "1,1",
    scale: 1.0,
    props: ["Mage_Hat", "Mage_Cape"],
    team: /Cape/,
    paint: { "0,1": 0xbfe9f5, "1,1": 0xd8f3fb, "7,1": 0x7cc6d8, "5,0": 0xffffff, "1,0": 0xf2f8ff, "2,1": "team" },
    extras: [...beard(0xf2f8ff, 0.8), x("head", 0xbfe9f5, () => cone(0.2, 0.42, 0, HEAD_TOP + 0.6, -0.05, 0, -0.2, 6))],
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
    back: ["frosty pale hat with an icicle tip", "white beard past the cheeks"],
  },
  "electro-wizard": {
    file: "mage",
    scale: 1.0,
    props: ["Mage_Cape"],
    team: /Cape/,
    paint: { "0,1": 0x2b2f3a, "1,1": 0x2b2f3a, "7,1": 0x1b1d24, "5,0": 0xffe14d, "1,0": 0xfff3a0, "2,1": "team" },
    extras: [
      // Spiky electric hair.
      ...[-0.3, 0, 0.3].map((sx) => x("head", 0xfff3a0, () => cone(0.13, 0.42, sx, HEAD_TOP + 0.08, -0.15, -sx * 0.9, -0.5, 6))),
      inHand(0x45e0ff, () => ball(0.14, 0, 0.2, 0, 1, 1, 1, 8)),
      inHand(0x45e0ff, () => ball(0.14, 0, 0.2, 0, 1, 1, 1, 8), true),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "Spellcast_Shoot",
    strike: 0.45,
    back: ["spiky pale-yellow hair", "a crackling orb in each hand"],
  },
  "magic-archer": {
    file: "rogue_hooded",
    hairBack: "1,1",
    scale: 1.0,
    props: ["Rogue_Cape", "2H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0xffe9a8, "1,1": "team", "0,1": 0x1f8f86 },
    extras: [...quiver(0x3a6a64, 0x7df9ff)],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
    back: ["pointed team hood", "glowing-cyan quiver", "crossbow out past the body"],
  },
  princess: {
    file: "rogue",
    scale: 0.95,
    props: ["Rogue_Cape"],
    team: /Cape/,
    paint: { "1,0": 0xffd24a, "0,1": 0xff7fbf, "1,1": "team" },
    extras: [
      ...crown(0xffcf3a, 0.32, HEAD_TOP - 0.02, 0xff5fa8),
      x("head", 0xffd24a, () => ball(0.2, 0, 1.6, -0.5, 1, 1.6, 1, 10)),
      inHand(0x8a5a2e, () => new THREE.TorusGeometry(0.6, 0.045, 5, 16, Math.PI * 0.85).rotateZ(Math.PI * 0.575).rotateY(Math.PI / 2).translate(0, 0.15, -0.2)),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Ranged_Shoot",
    strike: 0.3,
    back: ["gold crown", "long blonde plait", "bow out past the body"],
  },
  firecracker: {
    file: "rogue_hooded",
    hairBack: "1,1",
    scale: 0.95,
    props: ["Rogue_Cape", "2H_Crossbow"],
    team: /Cape/,
    paint: { "1,0": 0xff9a3a, "1,1": "team", "0,1": 0x8a4fe0 },
    extras: [
      // A firework tube over the shoulder.
      x("chest", 0x8a4fe0, () => cyl(0.16, 0.16, 0.9, 0.25, 1.55, -0.35, 10, -0.6, -0.2)),
      x("chest", 0xffd23f, () => cyl(0.17, 0.17, 0.08, 0.25, 1.92, -0.6, 10, -0.6, -0.2)),
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
    back: ["purple firework tube over the shoulder", "team hood"],
  },
  executioner: {
    file: "barbarian",
    scale: 1.1,
    props: ["Barbarian_Cape", "1H_Axe"],
    team: /Cape/,
    paint: { "0,1": 0x3a3f4a, "1,1": 0x3a3f4a, "7,0": 0x2e2a2a, "1,0": 0x2e2a2a },
    extras: [
      // The black executioner's hood over the head, eye holes at the front.
      x("head", 0x2a2630, () => cap(0.58, 0.62, 0, 1.78, 0, 1.15)),
      x("head", 0x2a2630, () => cone(0.2, 0.4, 0, HEAD_TOP + 0.24, -0.1, 0, -0.4, 8)),
    ],
    idle: "Idle",
    walk: "Walking_A",
    attack: "1H_Melee_Attack_Chop",
    strike: 0.42,
    back: ["pointed black hood", "big axe"],
  },
  "royal-giant": {
    file: "barbarian",
    scale: 1.36,
    props: ["Barbarian_Cape"],
    team: /Cape/,
    girth: 1.12,
    paint: { "0,1": 0x6a5a3a, "1,1": 0x6a5a3a, "1,0": 0x3a2c22, "7,0": 0x6a4a3a, "2,1": 0xe8dcc0 },
    extras: [
      ...crown(0xffcf3a, 0.36),
      ...beard(0x6a4a32, 0.95),
      x("handslotr", 0x39404d, () => cyl(0.18, 0.22, 1.2, 0, 0.52, 0, 12), { local: true }),
      x("handslotr", 0xe2b23c, () => cyl(0.24, 0.24, 0.14, 0, 1.08, 0, 12), { local: true }),
    ],
    idle: "2H_Ranged_Aiming",
    walk: "Walking_A",
    attack: "2H_Ranged_Shoot",
    strike: 0.3,
    back: ["gold crown on a bald head", "cannon barrel out past the body", "broad shoulders under a team mantle"],
  },
} satisfies Record<string, Variant>);

/** Crown-tower crews (not cards): a hooded archer on each princess tower, the king on the keep. */
CLASSIC["tower-princess"] = {
  file: "rogue_hooded",
  hairBack: "1,1",
  scale: 0.95,
  props: ["Rogue_Cape", "2H_Crossbow"],
  team: /Cape/,
  paint: { "1,0": 0xffd24a, "1,1": "team", "0,1": 0xf2ead8 },
  idle: "2H_Ranged_Aiming",
  walk: "Walking_A",
  attack: "2H_Ranged_Shoot",
  strike: 0.3,
  back: ["team hood", "crossbow over the parapet"],
};
CLASSIC["tower-king"] = {
  file: "knight",
  scale: 1.05,
  props: ["Knight_Cape", "1H_Sword"],
  team: /Cape/,
  cape: 0.8,
  paint: { "0,1": "team", "1,0": 0xf2f0ea, "3,0": 0xf0c648, "7,0": 0xffe27a },
  extras: [
    ...crown(0xffcf3a, 0.42, HEAD_TOP - 0.04, 0xff5fe0),
    ...beard(0xf2f0ea, 0.85),
  ],
  idle: "Idle",
  walk: "Walking_A",
  attack: "1H_Melee_Attack_Chop",
  strike: 0.42,
  back: ["five-point gold crown", "long team cape"],
};
CLASSIC.cannoneer = {
  file: "barbarian",
  scale: 0.95,
  props: ["Barbarian_Cape"],
  team: /Cape/,
  paint: { "0,1": 0x6a5a3a, "1,1": 0x6a5a3a, "1,0": 0x3a2c22, "7,0": 0x6a4a3a },
  extras: [x("head", 0x3a3f4a, () => cyl(0.38, 0.46, 0.34, 0, HEAD_TOP - 0.04, 0, 12)), ...beard(0x3a2c22, 0.8)],
  idle: "Unarmed_Idle",
  walk: "Walking_A",
  attack: "Unarmed_Melee_Attack_Punch_A",
  strike: 0.4,
  back: ["round iron cap", "team mantle"],
};
CLASSIC.duchess = {
  file: "mage",
  scale: 0.95,
  props: ["Mage_Cape"],
  team: /Cape/,
  paint: { "0,1": 0x8a48c8, "1,1": 0x8a48c8, "7,1": 0x43206e, "1,0": 0x3a2420, "2,1": "team" },
  extras: [...crown(0xffcf3a, 0.3, HEAD_TOP - 0.02), x("head", 0x3a2420, () => ball(0.22, 0, 2.15, -0.38, 1, 1, 1, 10))],
  idle: "Idle",
  walk: "Walking_A",
  attack: "Spellcast_Shoot",
  strike: 0.45,
  back: ["small gold crown", "dark hair bun", "team cape"],
};

