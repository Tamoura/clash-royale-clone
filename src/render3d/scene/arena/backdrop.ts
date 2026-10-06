/**
 * The stadium backdrop: what fills the band above the enemy king and the
 * strip below your own. It owns
 *
 *  - the far ground, which stops at the kit's back wall so the sky dome
 *    shows above it;
 *  - the kit (kits.ts) behind the enemy king, as two vertex-coloured
 *    meshes (lit + glow), plus the jungle's animated waterfall;
 *  - two flat far silhouette layers (hills, peaks, domes, skyline) at
 *    z -27 and -36, placed by where they land on screen, hazed toward the
 *    horizon colour;
 *  - a low foreground lip at z +17..+19 that stays under your king.
 *
 * Everything sits in one group that turns 180 degrees for the online
 * guest, whose camera looks from the other end.
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { ArenaLook, BackdropKind } from "../../arenaLooks";
import { toon } from "../../characters3d";
import { CAM_HOME, SIDE_COLOR } from "../common";
import { hashString } from "./groundPaint";
import { GROUND_EDGE_Z, buildKit, type Kit, type KitLight, type KitSeat } from "./kits";
import { makeWaterfall, type WaterfallHandle } from "./river";

/** Camera "up" on screen for the host view: a world point's screen height is p·UP. */
const UP = new THREE.Vector3(0, CAM_HOME.z, -CAM_HOME.y).normalize();

/** World y that puts a point at depth z on screen height u (host view). */
export function yForScreen(u: number, z: number): number {
  return (u - UP.z * z) / UP.y;
}

/** Screen height (host view, camera-up units through the origin) of a world point. */
export function screenU(y: number, z: number): number {
  return UP.y * y + UP.z * z;
}

export interface Backdrop {
  group: THREE.Group;
  kit: Kit;
  /** Lights placed by the kit (host-view positions; they turn with the group). */
  lights: KitLight[];
  seats: KitSeat[];
  silhouettes: THREE.MeshBasicMaterial;
  waterfall: WaterfallHandle | null;
  solid: THREE.Mesh | null;
  /** Point the set at the side whose king it stands behind. */
  orient(view: Side): void;
}

const TMP = new THREE.Color();
const HSL = { h: 0, s: 0, l: 0 };

type Profile = (x: number, r: (i: number) => number) => number;

/** Smooth hills from three sines. */
const hills = (amp: number, ph: number): Profile => (x) =>
  amp * (0.55 * Math.sin(x * 0.21 + ph) + 0.3 * Math.sin(x * 0.47 + ph * 2.1) + 0.15 * Math.sin(x * 1.1 + ph * 3.7));

/** Saw-tooth peaks between seeded summits. */
const peaks = (amp: number, every: number): Profile => (x, r) => {
  const i = Math.floor(x / every);
  const f = x / every - i;
  const a = r(i) * amp;
  const b = r(i + 1) * amp;
  const peak = 0.35 + r(i + 101) * 0.3;
  return f < peak ? a * (1 - f / peak) + Math.max(a, b) * 1.15 * (f / peak) : Math.max(a, b) * 1.15 * (1 - (f - peak) / (1 - peak)) + b * ((f - peak) / (1 - peak));
};

/** Domes and minarets along a skyline. */
const domesProfile = (amp: number): Profile => (x, r) => {
  const i = Math.floor(x / 3);
  const f = x / 3 - i;
  const kind = r(i);
  const base = 0.35 * amp + r(i + 50) * 0.25 * amp;
  if (kind < 0.45) {
    const d = (f - 0.5) / 0.42;
    return Math.abs(d) < 1 ? base + Math.sqrt(1 - d * d) * amp * 0.75 : base;
  }
  if (kind < 0.7) return Math.abs(f - 0.5) < 0.07 ? base + amp * 1.5 : base;
  return base + (Math.abs(f - 0.5) < 0.3 ? amp * 0.25 : 0);
};

/** Blocky city towers with antenna spikes. */
const city = (amp: number): Profile => (x, r) => {
  const i = Math.floor(x / 1.6);
  const f = x / 1.6 - i;
  const h = (0.3 + r(i) * 0.9) * amp;
  return r(i + 30) > 0.7 && Math.abs(f - 0.5) < 0.05 ? h + amp * 0.5 : h;
};

/** Narrow crystal spires. */
const spires = (amp: number): Profile => (x, r) => {
  const i = Math.floor(x / 1.4);
  const f = x / 1.4 - i;
  const h = (0.4 + r(i) * 1.1) * amp;
  return h * Math.max(0, 1 - Math.abs(f - 0.5) * 2.4) + amp * 0.25;
};

/** Round canopy bumps. */
const canopy = (amp: number): Profile => (x, r) => {
  const i = Math.floor(x / 1.9);
  const f = x / 1.9 - i;
  const d = (f - 0.5) * 2;
  return amp * (0.45 + r(i) * 0.4) * Math.sqrt(Math.max(0, 1 - d * d * 0.8)) + amp * 0.2;
};

/** Hills studded with crenellated towers (castle country). */
const towers = (amp: number): Profile => (x, r) => {
  const base = hills(amp * 0.6, 1.3)(x, r) + amp * 0.3;
  const i = Math.floor(x / 5);
  const f = x / 5 - i;
  if (r(i) > 0.55 && f > 0.4 && f < 0.6) return base + amp * (0.9 + ((f * 20) % 2 < 1 ? 0.15 : 0));
  return base;
};

/** Cypress spikes over rolling hills (Andalusian gardens). */
const cypress = (amp: number): Profile => (x, r) => {
  const base = hills(amp * 0.5, 0.7)(x, r) + amp * 0.3;
  const i = Math.floor(x / 1.3);
  const f = x / 1.3 - i;
  return r(i) > 0.5 ? base + amp * 0.9 * Math.max(0, 1 - Math.abs(f - 0.5) * 3.2) : base;
};

/** Near and far silhouette profiles per backdrop (screen units above the base). */
const SILHOUETTES: Record<BackdropKind, [Profile, Profile]> = {
  castle: [towers(1.2), hills(1.0, 0.4)],
  bone: [peaks(1.3, 2.2), peaks(1.6, 3.4)],
  ice: [peaks(1.6, 2.6), peaks(2.2, 4.0)],
  forge: [peaks(1.2, 2.0), peaks(2.4, 6.5)],
  mystic: [spires(1.5), peaks(1.4, 3.0)],
  jungle: [canopy(1.3), hills(1.1, 2.0)],
  neon: [city(1.5), city(1.1)],
  minaret: [domesProfile(1.2), domesProfile(0.9)],
  oasis: [hills(0.8, 0.9), hills(0.7, 2.6)],
  dunes: [hills(0.9, 0.2), hills(0.8, 1.7)],
  alhambra: [cypress(1.2), peaks(1.6, 4.5)],
};

/** Two silhouette cards as one vertex-coloured mesh. */
function buildSilhouettes(look: ArenaLook, mat: THREE.MeshBasicMaterial): THREE.Mesh {
  const seed = hashString(`sil:${look.id}`);
  const r = (i: number): number => {
    let h = Math.imul((i + 1000) ^ seed, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  const [near, far] = SILHOUETTES[look.backdrop];
  const pos: number[] = [];
  const col: number[] = [];
  const horizon = new THREE.Color(look.skyHorizon);
  const ground = new THREE.Color(look.far);
  const layers: Array<{ z: number; base: number; profile: Profile; tint: number }> = [
    { z: -36, base: 17.1, profile: far, tint: 0.32 },
    { z: -27, base: 16.4, profile: near, tint: 0.58 },
  ];
  for (const L of layers) {
    const top = new THREE.Color().copy(horizon).lerp(ground, L.tint);
    // Keep a little of the sky's hue so the layers sit in the same air.
    top.getHSL(HSL);
    top.setHSL(HSL.h, Math.min(1, HSL.s * 0.85), HSL.l);
    const bottom = new THREE.Color().copy(top).lerp(horizon, 0.55);
    const yBottom = yForScreen(L.base - 3, L.z);
    for (let x = -42; x < 42; x += 0.5) {
      const u0 = Math.min(21.5, L.base + L.profile(x, r));
      const u1 = Math.min(21.5, L.base + L.profile(x + 0.5, r));
      const y0 = yForScreen(u0, L.z);
      const y1 = yForScreen(u1, L.z);
      pos.push(x, yBottom, L.z, x + 0.5, yBottom, L.z, x + 0.5, y1, L.z);
      pos.push(x, yBottom, L.z, x + 0.5, y1, L.z, x, y0, L.z);
      for (const c of [bottom, bottom, top, bottom, top, top]) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "silhouettes";
  mesh.frustumCulled = false;
  return mesh;
}

/** The low foreground lip below your king, styled to the backdrop. */
function addLip(k: Kit): void {
  const L = k.look;
  const z = 17.7;
  const kind = L.backdrop;
  const stone = L.edging;
  if (kind === "castle" || kind === "alhambra" || kind === "minaret") {
    k.part("lip wall", new THREE.BoxGeometry(24, 0.42, 0.7), stone, { y: 0.15, z });
    k.part("lip cap", new THREE.BoxGeometry(24.2, 0.1, 0.85), kind === "castle" ? 0xd9a93f : 0xcaa23f, { y: 0.4, z });
    for (let i = -5; i <= 5; i++) k.part("lip post", new THREE.BoxGeometry(0.42, 0.62, 0.8), stone, { x: i * 2.2, y: 0.25, z });
    for (let i = -4; i <= 4; i += 2) {
      k.part("planter", new THREE.IcosahedronGeometry(0.42, 0), L.tree.leafA, { x: i * 2.2 + 1.1, y: 0.62, z: z + 0.1, sy: 0.8 });
    }
    return;
  }
  if (kind === "neon") {
    k.part("lip rail", new THREE.BoxGeometry(24, 0.35, 0.5), 0x2e3352, { y: 0.12, z });
    k.part("lip neon", new THREE.BoxGeometry(24, 0.06, 0.06), L.neon?.player ?? 0x4f8aff, { y: 0.32, z: z - 0.26 }, { glow: true });
    return;
  }
  const mound = kind === "ice" ? 0xf4f8fc : kind === "dunes" ? L.drift : kind === "jungle" || kind === "oasis" ? L.tree.leafA : L.rock;
  const alt = kind === "jungle" || kind === "oasis" ? L.tree.leafB : new THREE.Color(mound).multiplyScalar(0.88).getHex();
  for (let i = 0; i < 12; i++) {
    const x = -11 + i * 2 + ((i * 7) % 3) * 0.3;
    k.part("lip mound", new THREE.IcosahedronGeometry(0.75, 0), i % 2 ? mound : alt, { x, y: 0.05, z: z + (i % 2) * 0.4, sx: 1.4, sy: 0.55 + (i % 3) * 0.12, sz: 0.9, ry: i });
  }
  if (kind === "mystic") {
    for (const x of [-7, -2.5, 3, 8]) k.part("lip crystal", new THREE.OctahedronGeometry(0.3, 0), 0xc8a8ff, { x, y: 0.45, z: z - 0.2, sy: 1.8 });
  }
}

/** Build the backdrop for the current look; `glow` makes the dimmable glow material. */
export function buildBackdrop(look: ArenaLook, glow: (color: number) => THREE.MeshBasicMaterial): Backdrop {
  const group = new THREE.Group();
  group.name = "backdrop";
  group.userData.batchRoot = true; // turned as a unit for the guest view

  // Far ground: out to the sides and the near end, but not past the kit.
  const farGeo = new THREE.PlaneGeometry(160, 100);
  farGeo.rotateX(-Math.PI / 2);
  farGeo.translate(0, -0.45, GROUND_EDGE_Z + 50);
  const far = new THREE.Mesh(farGeo, new THREE.MeshToonMaterial({ color: look.far }));
  far.name = "far ground";
  group.add(far);

  const kit = buildKit(look.backdrop, look);
  addLip(kit);
  let solid: THREE.Mesh | null = null;
  const solidGeo = kit.solid.build();
  if (solidGeo) {
    const mat = toon(0xffffff);
    mat.vertexColors = true;
    solid = new THREE.Mesh(solidGeo, mat);
    solid.name = "kit";
    solid.receiveShadow = true;
    solid.userData.noBatch = true;
    group.add(solid);
  }
  const glowGeo = kit.glow.build();
  if (glowGeo) {
    const mat = glow(0xffffff);
    mat.vertexColors = true;
    const m = new THREE.Mesh(glowGeo, mat);
    m.name = "kit glow";
    m.userData.noBatch = true;
    group.add(m);
  }
  let waterfall: WaterfallHandle | null = null;
  if (kit.waterfall) {
    waterfall = makeWaterfall(look, kit.waterfall.w, kit.waterfall.h);
    waterfall.mesh.position.set(kit.waterfall.x, kit.waterfall.y, kit.waterfall.z);
    group.add(waterfall.mesh);
  }

  const silMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  group.add(buildSilhouettes(look, silMat));

  const teamColor = solidGeo?.getAttribute("color") as THREE.BufferAttribute | undefined;
  return {
    group,
    kit,
    lights: kit.lights,
    seats: kit.seats,
    silhouettes: silMat,
    waterfall,
    solid,
    orient(view: Side): void {
      group.rotation.y = view === "player" ? 0 : Math.PI;
      // The banners belong to whoever owns the far king.
      if (!teamColor) return;
      TMP.set(SIDE_COLOR[view === "player" ? "enemy" : "player"]).getHSL(HSL);
      TMP.setHSL(HSL.h, Math.min(1, HSL.s * 1.2), HSL.l);
      for (const [start, count] of kit.team) {
        // Team parts hang high, above the baked ground shading.
        for (let i = start; i < start + count; i++) teamColor.setXYZ(i, TMP.r, TMP.g, TMP.b);
      }
      teamColor.needsUpdate = true;
    },
  };
}
