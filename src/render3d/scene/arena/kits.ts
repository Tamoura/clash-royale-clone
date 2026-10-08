/**
 * Backdrop kits: the set piece standing behind the enemy king, one per
 * BackdropKind. Each kit is procedural low-poly (at most KIT_TRIANGLE_BUDGET
 * triangles) baked into two vertex-coloured geometries, a lit "solid" one
 * and an unlit "glow" one (windows, lanterns, embers, neon), so a whole kit
 * costs two draw calls however many props it has.
 *
 * Coordinates are world units for the host view: the enemy king stands at
 * z = -13.5, the field ends at z = -16 and the kit band runs z -17..-22.5.
 * backdrop.ts turns the whole set around for the online guest.
 */
import * as THREE from "three";
import type { ArenaLook, BackdropKind } from "../../arenaLooks";

export const KIT_TRIANGLE_BUDGET = 1200;
/** Kits are laid out against this back wall line (before KIT_SHIFT)... */
export const KIT_BACK_Z = -21;
/** ...then the whole set moves this much toward the field, so the sky shows above it. */
export const KIT_SHIFT = 0.6;
/** Where the ground ends and the sky begins. */
export const GROUND_EDGE_Z = KIT_BACK_Z + KIT_SHIFT;

export interface KitProp {
  name: string;
  x: number;
  z: number;
  /** River-side decoration allowed inside the field box. */
  tag?: "decor";
}

export interface KitLight {
  x: number;
  y: number;
  z: number;
  color: number;
  /** Ground pool radius (world units). */
  radius: number;
}

export interface KitSeat {
  x: number;
  z: number;
  /** Height of the seat surface the spectator stands on. */
  y: number;
}

export interface Xform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Uniform scale, or per-axis below. */
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const HSL = { h: 0, s: 0, l: 0 };

/** Punch saturation like toon() does, so baked colours match the toon props. */
function vivid(hex: number): THREE.Color {
  C.set(hex).getHSL(HSL);
  return C.setHSL(HSL.h, Math.min(1, HSL.s * 1.2), HSL.l);
}

/** Accumulates transformed, coloured triangles into one geometry. */
export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];

  constructor(private readonly groundShade: boolean) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** Bake `geo` (consumed) at transform `t` in colour `color`; returns its vertex range. */
  add(geo: THREE.BufferGeometry, color: number, t: Xform): [number, number] {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    E.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
    Q.setFromEuler(E);
    P.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    S.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
    M.compose(P, Q, S);
    g.applyMatrix4(M);
    if (M.determinant() < 0) {
      // Mirrored: swap two corners of every triangle to keep the winding.
      const swap = (a: THREE.BufferAttribute): void => {
        for (let i = 0; i + 2 < a.count; i += 3) {
          for (let k = 0; k < a.itemSize; k++) {
            const v = a.array[(i + 1) * a.itemSize + k];
            a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
            a.array[(i + 2) * a.itemSize + k] = v;
          }
        }
      };
      swap(g.getAttribute("position") as THREE.BufferAttribute);
      swap(g.getAttribute("normal") as THREE.BufferAttribute);
    }
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = vivid(color);
    const start = this.vertexCount;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      this.pos.push(p.getX(i), y, p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      // Baked contact occlusion: everything darkens toward the ground.
      const k = this.groundShade ? 0.7 + 0.3 * Math.min(1, Math.max(0, y / 1.3)) : 1;
      this.col.push(c.r * k, c.g * k, c.b * k);
    }
    g.dispose();
    return [start, p.count];
  }

  build(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A kit under construction, plus everything the arena needs from it. */
export class Kit {
  readonly solid = new GeoBuilder(true);
  readonly glow = new GeoBuilder(false);
  readonly props: KitProp[] = [];
  readonly lights: KitLight[] = [];
  readonly seats: KitSeat[] = [];
  /** Vertex ranges in `solid` painted in the backdrop owner's team colour. */
  readonly team: Array<[number, number]> = [];
  /** An animated waterfall sheet: centre and size (jungle). */
  waterfall: { x: number; y: number; z: number; w: number; h: number } | null = null;

  /** Added to every z while the kit builds (see KIT_SHIFT). */
  zShift = 0;

  constructor(readonly look: ArenaLook) {}

  part(name: string, geo: THREE.BufferGeometry, color: number, t: Xform, opts: { glow?: boolean; team?: boolean; tag?: "decor" } = {}): void {
    const z = (t.z ?? 0) + this.zShift;
    const range = (opts.glow ? this.glow : this.solid).add(geo, color, { ...t, z });
    if (opts.team && !opts.glow) this.team.push(range);
    this.props.push({ name, x: t.x ?? 0, z, tag: opts.tag });
  }

  light(x: number, y: number, z: number, color: number, radius = 2.2): void {
    this.lights.push({ x, y, z: z + this.zShift, color, radius });
  }

  seat(x: number, z: number, y: number): void {
    this.seats.push({ x, z: z + this.zShift, y });
  }

  get triangles(): number {
    return this.solid.triangles + this.glow.triangles;
  }
}

// --- Primitive shorthands (low segment counts on purpose) -----------------

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg, 1);
const ball = (r: number, w = 8, h = 6): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
const dome = (r: number, w = 10, h = 5): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
const rock = (r: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, 0);
const gem = (r: number): THREE.BufferGeometry => new THREE.OctahedronGeometry(r, 0);
/** An upright half-disc (an arch head) facing ±z. */
const archHead = (r: number, depth: number, seg = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(r, r, depth, seg, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
/** A half-ring arch in the x-y plane, feet on y = 0. */
const arc = (r: number, tube: number, radial = 3, tubular = 8): THREE.BufferGeometry =>
  new THREE.TorusGeometry(r, tube, radial, tubular, Math.PI);

function shade(hex: number, f: number): number {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return c.getHex();
}

const GOLD = 0xd9a93f;
const DARK = 0x231a1c;

/** Team red until backdrop.ts recolours the team ranges for the viewpoint. */
const TEAM = 0xef4444;

// --- The kits ---------------------------------------------------------------

function castle(k: Kit): void {
  const L = k.look;
  const stone = L.standWall;
  const stoneDk = shade(stone, 0.8);
  const roof = L.standRoofEnemy;
  const wood = L.fencePost;
  const Z = KIT_BACK_Z - 0.5;
  k.part("curtain wall", box(26, 1.7, 1), stone, { y: 0.79, z: Z });
  for (let i = -6; i <= 6; i++) k.part("merlon", box(0.9, 0.5, 1), stoneDk, { x: i * 2, y: 1.88, z: Z });
  // Gatehouse: a deep arch with a portcullis between two round towers.
  k.part("gate block", box(3.6, 3.4, 1.4), stone, { y: 1.64, z: Z + 0.6 });
  k.part("gate", box(1.7, 2.0, 0.1), DARK, { y: 0.94, z: Z + 1.32 });
  k.part("gate arch", archHead(0.85, 0.1), DARK, { y: 1.94, z: Z + 1.32 });
  for (const x of [-0.5, 0, 0.5]) k.part("portcullis", box(0.07, 2.5, 0.06), 0x3a3a44, { x, y: 1.2, z: Z + 1.38 });
  for (const sx of [-1, 1]) {
    const x = sx * 2.5;
    k.part("gate tower", cyl(1.05, 1.2, 4.0), stone, { x, y: 1.94, z: Z + 0.8 });
    k.part("tower ring", cyl(1.25, 1.25, 0.4), stoneDk, { x, y: 4.1, z: Z + 0.8 });
    k.part("tower roof", cone(1.45, 1.7), roof, { x, y: 5.15, z: Z + 0.8 });
    k.part("flagpole", cyl(0.04, 0.04, 1, 4), wood, { x, y: 6.4, z: Z + 0.8 });
    k.part("flag", box(0.7, 0.4, 0.04), TEAM, { x: x + 0.36, y: 6.65, z: Z + 0.8 }, { team: true });
    k.part("tower window", box(0.24, 0.5, 0.05), 0xffc86b, { x, y: 3.1, z: Z + 1.98 }, { glow: true });
    // Two hanging banners flank the gate.
    k.part("banner", box(0.75, 1.9, 0.06), TEAM, { x: sx * 1.25, y: 2.2, z: Z + 1.34 }, { team: true });
    k.part("banner tip", cone(0.38, 0.4, 4), TEAM, { x: sx * 1.25, y: 1.05, z: Z + 1.34, rx: Math.PI, ry: Math.PI / 4 }, { team: true });
    // Braziers at the foot of the stands.
    k.part("brazier", cyl(0.24, 0.14, 0.8, 6), 0x3a3236, { x: sx * 3.5, y: 0.34, z: -17.5 });
    k.part("brazier fire", cone(0.2, 0.45, 6), 0xffa040, { x: sx * 3.5, y: 0.96, z: -17.5 }, { glow: true });
    k.light(sx * 3.5, 1.0, -17.5, 0xffa040, 2.6);
    // A short tiered stand of spectators either side of the gate.
    for (let tier = 0; tier < 3; tier++) {
      const h = 0.45 + 0.45 * tier;
      const z = -17.75 - 0.95 * tier;
      k.part("stand tier", box(6, h, 0.95), tier % 2 ? stoneDk : stone, { x: sx * 6.9, y: h / 2 - 0.06, z });
      for (let i = 0; i < 8; i++) k.seat(sx * (4.25 + i * 0.75 + (tier % 2) * 0.3), z, h - 0.06);
    }
    k.part("stand rail", box(6, 0.1, 0.08), GOLD, { x: sx * 6.9, y: 0.52, z: -17.24 });
    k.part("awning", box(6.4, 0.12, 1.5), roof, { x: sx * 6.9, y: 2.75, z: -19.4, rx: 0.28 });
    for (const dx of [-3, 3]) k.part("awning pole", cyl(0.05, 0.05, 2.8, 4), wood, { x: sx * 6.9 + dx, y: 1.34, z: -18.7 });
  }
}

function bone(k: Kit): void {
  const L = k.look;
  const boneC = 0xe8dcc0;
  const rockC = L.rock;
  for (let i = 0; i < 7; i++) {
    const x = -12 + i * 4;
    k.part("ridge rock", rock(1), i % 2 ? rockC : shade(rockC, 0.85), { x, y: 0.7, z: KIT_BACK_Z - 0.7, sx: 2.6, sy: 1.8 + (i % 3) * 0.5, sz: 1.4, ry: i });
  }
  // A ribcage arch over the far gate, shrinking toward the back.
  for (let i = 0; i < 5; i++) {
    const s = 1 - i * 0.06;
    k.part("rib", arc(3.3, 0.2, 4, 8), i % 2 ? boneC : shade(boneC, 0.92), { y: -0.06, z: -18.6 - i * 0.75, s });
  }
  k.part("spine", cyl(0.22, 0.22, 3.4, 6), boneC, { y: 3.25, z: -20.1, rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) k.part("vertebra", gem(0.3), shade(boneC, 0.9), { y: 3.45, z: -18.7 - i * 0.95 });
  // Two great skulls with glowing eye sockets.
  for (const sx of [-1, 1]) {
    const x = sx * 6.2;
    const z = -19.2;
    k.part("skull", ball(1.0), boneC, { x, y: 1.15, z, sy: 0.92 });
    k.part("jaw", box(1.15, 0.38, 0.8), shade(boneC, 0.9), { x, y: 0.3, z: z + 0.18 });
    for (const ex of [-0.34, 0.34]) {
      k.part("eye socket", gem(0.24), L.lanterns?.[0] ?? 0xc88aff, { x: x + ex, y: 1.2, z: z + 0.86 }, { glow: true });
    }
    k.part("nose", box(0.16, 0.22, 0.1), DARK, { x, y: 0.88, z: z + 0.95 });
    for (let t = 0; t < 4; t++) k.part("tooth", box(0.14, 0.18, 0.1), 0xfff8e8, { x: x - 0.33 + t * 0.22, y: 0.56, z: z + 0.58 });
    k.light(x, 1.2, z + 1.0, L.lanterns?.[0] ?? 0xc88aff, 1.8);
  }
  // Loose bones at the foot of the set.
  for (const [x, z, r] of [[-8.6, -17.6, 0.4], [-3.8, -17.8, -0.6], [3.9, -17.5, 1.1], [8.8, -17.9, -0.2]] as const) {
    k.part("bone", box(1.0, 0.14, 0.14), boneC, { x, y: 0.02, z, ry: r });
    for (const e of [-0.5, 0.5]) {
      k.part("bone knob", gem(0.16), boneC, { x: x + Math.cos(r) * e, y: 0.04, z: z - Math.sin(r) * e });
    }
  }
}

function ice(k: Kit): void {
  const L = k.look;
  const iceA = 0xe6f4ff;
  const iceB = 0x9fd0f0;
  for (let i = 0; i < 9; i++) {
    const x = -12 + i * 3;
    k.part("ice cliff", rock(1), i % 2 ? iceA : iceB, { x, y: 0.6, z: KIT_BACK_Z - 0.6 - (i % 2) * 0.5, sx: 2.0, sy: 1.6 + ((i * 5) % 4) * 0.4, sz: 1.6, ry: i * 1.3 });
  }
  for (const sx of [-1, 1]) {
    k.part("ice spire", gem(1), iceA, { x: sx * 2.2, y: 2.2, z: -20.5, sx: 0.9, sy: 3.4, sz: 0.9 });
    k.part("ice glint", gem(0.32), 0xbfe8ff, { x: sx * 2.2, y: 2.4, z: -19.7 }, { glow: true });
  }
  for (const [x, z, r] of [[-3.5, -17.6, 0.3], [4.4, -17.9, -0.4], [-6.8, -18.4, 1.0], [7.6, -18.2, 0.6], [0.4, -18.6, 0.2]] as const) {
    k.part("ice shard", gem(1), iceB, { x, y: 0.6, z, sx: 0.45, sy: 1.5, sz: 0.45, rz: r * 0.3, ry: r });
  }
  // Snowy pines.
  const pines: Array<[number, number, number]> = [
    [-9.6, -18.6, 1.15], [-7.6, -19.6, 1.0], [-5.0, -18.9, 0.9], [-10.6, -20.2, 1.3],
    [5.2, -19.0, 0.95], [7.9, -18.5, 1.1], [9.9, -19.8, 1.25], [10.8, -18.0, 0.85],
  ];
  for (const [x, z, s] of pines) {
    k.part("pine trunk", cyl(0.14, 0.18, 0.6, 5), L.tree.trunk, { x, y: 0.25 * s, z, s });
    for (let i = 0; i < 3; i++) {
      k.part("pine", cone(0.75 - i * 0.17, 0.85, 5), i % 2 ? L.tree.leafA : L.tree.leafB, { x, y: (0.75 + i * 0.5) * s, z, s });
    }
    k.part("pine snow", cone(0.3, 0.4, 5), 0xf8fcff, { x, y: 2.0 * s, z, s });
  }
}

function forge(k: Kit): void {
  const L = k.look;
  const stone = shade(L.standWall, 0.9);
  const metal = 0x4a4650;
  const lava = L.band.kind === "lava" ? L.torch : 0xff7a36;
  const Z = KIT_BACK_Z - 0.5;
  k.part("forge wall", box(26, 1.6, 1), stone, { y: 0.74, z: Z });
  for (let i = -3; i <= 3; i++) k.part("buttress", box(0.8, 2.1, 1.4), shade(stone, 0.8), { x: i * 3.8, y: 0.99, z: Z + 0.1 });
  // The furnace: a glowing mouth under a pyramid hood.
  k.part("furnace", box(3.6, 2.6, 1.8), shade(stone, 0.75), { y: 1.24, z: Z + 0.7 });
  k.part("furnace mouth", box(1.6, 1.0, 0.1), lava, { y: 0.86, z: Z + 1.64 }, { glow: true });
  k.part("furnace hood", cone(2.1, 1.3, 4), metal, { y: 3.2, z: Z + 0.7, ry: Math.PI / 4 });
  k.light(0, 0.9, Z + 2.0, lava, 3.0);
  for (const sx of [-1, 1]) {
    const x = sx * 3.4;
    k.part("chimney", cyl(0.55, 0.72, 5.4), shade(stone, 0.7), { x, y: 2.64, z: Z - 0.2 });
    k.part("chimney rim", cyl(0.72, 0.72, 0.3), metal, { x, y: 5.4, z: Z - 0.2 });
    k.part("chimney fire", cyl(0.5, 0.5, 0.06), lava, { x, y: 5.57, z: Z - 0.2 }, { glow: true });
    k.part("brazier", cyl(0.26, 0.15, 0.8, 6), metal, { x: sx * 8.8, y: 0.34, z: -19.0 });
    k.part("brazier fire", cone(0.22, 0.5, 6), lava, { x: sx * 8.8, y: 0.98, z: -19.0 }, { glow: true });
    k.light(sx * 8.8, 1.0, -19.0, lava, 2.6);
  }
  // Anvils, ingots and barrels in the yard.
  for (const [x, z, r] of [[-6.4, -18.0, 0.3], [5.8, -17.9, -0.2], [8.2, -18.6, 0.5]] as const) {
    k.part("anvil foot", box(0.4, 0.5, 0.35), metal, { x, y: 0.19, z, ry: r });
    k.part("anvil", box(0.9, 0.22, 0.4), shade(metal, 0.8), { x, y: 0.55, z, ry: r });
    k.part("anvil horn", cone(0.13, 0.42, 4), shade(metal, 0.8), { x: x + Math.cos(r) * 0.62, y: 0.55, z: z - Math.sin(r) * 0.62, rz: -Math.PI / 2, ry: r });
  }
  for (let i = 0; i < 6; i++) {
    k.part("ingot", box(0.5, 0.16, 0.24), i % 2 ? 0xd88a3a : 0xc0c4cc, { x: -3.6 + (i % 3) * 0.55, y: 0.02 + Math.floor(i / 3) * 0.17, z: -17.7 });
  }
  for (const [x, z] of [[2.8, -18.2], [3.5, -18.6], [-9.0, -18.4]] as const) {
    k.part("barrel", cyl(0.32, 0.3, 0.8), 0x6a4a2a, { x, y: 0.34, z });
  }
}

function mystic(k: Kit): void {
  const L = k.look;
  const rockC = shade(L.far, 1.6);
  const crystal = 0xc8a8ff;
  const glowC = L.lanterns?.[0] ?? 0xb08aff;
  for (let i = 0; i < 7; i++) {
    k.part("violet rock", rock(1), i % 2 ? rockC : shade(rockC, 0.8), { x: -12 + i * 4, y: 0.8, z: KIT_BACK_Z - 0.6, sx: 2.4, sy: 2.0 + (i % 3) * 0.7, sz: 1.5, ry: i * 2 });
  }
  for (const sx of [-1, 1]) {
    k.part("stone arch", arc(2.0, 0.26, 4, 8), shade(rockC, 1.1), { x: sx * 6, y: -0.06, z: -20.4 });
  }
  const plinths: Array<[number, number, boolean]> = [[-8, -18.6, false], [-4.4, -19.4, true], [0, -18.4, false], [4.4, -19.4, true], [8, -18.6, false]];
  for (const [x, z, lit] of plinths) {
    k.part("plinth", cyl(0.6, 0.75, 0.6, 6), shade(rockC, 1.15), { x, y: 0.24, z });
    k.part("floating crystal", gem(1), lit ? glowC : crystal, { x, y: 2.3 + (lit ? 0.5 : 0), z, sx: 0.5, sy: 1.3, sz: 0.5, ry: x }, { glow: lit });
    for (const a of [0, 2.1, 4.2]) {
      k.part("orbiting shard", gem(0.16), crystal, { x: x + Math.cos(a + x) * 0.9, y: 1.6 + Math.sin(a) * 0.3, z: z + Math.sin(a + x) * 0.5 });
    }
    if (lit) k.light(x, 2.6, z, glowC, 2.2);
  }
  k.part("great crystal", gem(1), crystal, { y: 4.4, z: -21.4, sx: 1.2, sy: 3.0, sz: 1.2 });
  k.part("great crystal core", gem(1), glowC, { y: 4.4, z: -20.9, sx: 0.55, sy: 1.6, sz: 0.55 }, { glow: true });
  k.part("rune ring", new THREE.TorusGeometry(1.25, 0.06, 3, 16), glowC, { y: 0.0, z: -18.5, rx: Math.PI / 2 }, { glow: true });
}

function jungle(k: Kit): void {
  const L = k.look;
  const moss = 0x4a6a3a;
  for (let i = 0; i < 7; i++) {
    k.part("mossy rock", rock(1), i % 2 ? moss : shade(moss, 0.8), { x: -12 + i * 4, y: 0.7, z: KIT_BACK_Z - 0.6, sx: 2.4, sy: 1.8 + (i % 3) * 0.6, sz: 1.5, ry: i });
  }
  // A waterfall pouring into a pool between framing rocks.
  k.waterfall = { x: 0, y: 2.5, z: KIT_BACK_Z - 0.25 + k.zShift, w: 2.4, h: 5 };
  for (const sx of [-1, 1]) {
    k.part("falls rock", rock(1), shade(moss, 0.7), { x: sx * 1.9, y: 2.2, z: KIT_BACK_Z - 0.3, sx: 1.0, sy: 2.6, sz: 1.0, ry: sx });
  }
  k.part("falls crest", rock(1), shade(moss, 0.9), { y: 5.0, z: KIT_BACK_Z - 0.6, sx: 2.6, sy: 0.8, sz: 1.0 });
  k.part("pool", cyl(1.9, 1.9, 0.08, 12), L.band.glint, { y: 0.0, z: -19.6, sz: 0.55 });
  k.part("pool rim", new THREE.TorusGeometry(1.9, 0.14, 3, 12), shade(moss, 0.9), { y: 0.02, z: -19.6, rx: Math.PI / 2, sy: 0.55 });
  // Big trees with hanging vines.
  for (const [x, z, s] of [[-8.4, -19.4, 1.2], [-4.6, -20.2, 1.0], [5.0, -20.0, 1.05], [8.8, -19.2, 1.25]] as const) {
    k.part("jungle trunk", cyl(0.3, 0.45, 4.2, 6), L.tree.trunk, { x, y: 2.0 * s, z, s });
    k.part("canopy", rock(1), L.tree.leafA, { x, y: 4.3 * s, z, sx: 2.0 * s, sy: 1.1 * s, sz: 1.5 * s, ry: x });
    k.part("canopy", rock(1), L.tree.leafB, { x: x + 0.8, y: 3.7 * s, z: z + 0.5, sx: 1.4 * s, sy: 0.9 * s, sz: 1.2 * s, ry: z });
    for (const dx of [-1.1, -0.3, 0.6, 1.3]) {
      const len = 1.4 + Math.abs(dx) * 0.8;
      k.part("vine", box(0.06, len, 0.06), 0x3f8f45, { x: x + dx * s, y: (3.6 - len / 2) * s, z: z + 0.8 });
    }
  }
  const fronds: Array<[number, number, number]> = [[-6.6, -17.6, 0.8], [-2.8, -17.9, -0.7], [2.6, -17.7, 0.5], [6.6, -17.5, -0.9], [-10, -17.8, 0.2], [10.2, -17.7, -0.3]];
  for (const [x, z, r] of fronds) {
    for (const a of [-0.7, 0, 0.7]) {
      k.part("frond", cone(0.35, 1.3, 4), a === 0 ? L.tree.leafB : L.tree.leafA, { x, y: 0.4, z, rz: a + r * 0.2, rx: -0.4 });
    }
  }
}

function neon(k: Kit): void {
  const L = k.look;
  const metal = 0x2e3352;
  const pink = L.neon?.enemy ?? 0xff4fd8;
  const cyan = 0x59d6ff;
  const Z = KIT_BACK_Z - 0.6;
  k.part("grandstand", box(26, 2.0, 1.2), metal, { y: 0.94, z: Z });
  for (let t = 0; t < 2; t++) {
    k.part("grandstand tier", box(26, 0.8 + t * 0.6, 0.9), shade(metal, 1.2 - t * 0.1), { y: (0.8 + t * 0.6) / 2 - 0.06, z: Z + 1.5 - t * 0.9 });
  }
  for (let t = 0; t < 3; t++) {
    k.part("neon trim", box(26, 0.07, 0.07), t % 2 ? cyan : pink, { y: [0.76, 1.36, 1.96][t], z: [Z + 1.97, Z + 1.07, Z + 0.62][t] }, { glow: true });
  }
  for (const x of [-9, -4.2, 4.2, 9]) {
    k.part("pylon", box(0.5, 5.6, 0.5), shade(metal, 0.8), { x, y: 2.74, z: -19.4 });
    for (let i = 0; i < 3; i++) k.part("pylon stripe", box(0.54, 0.1, 0.54), i % 2 ? cyan : pink, { x, y: 1.4 + i * 1.4, z: -19.4 }, { glow: true });
    k.part("pylon cap", gem(0.32), cyan, { x, y: 5.8, z: -19.4 }, { glow: true });
    k.light(x, 3, -19.4, x < 0 ? pink : cyan, 2.0);
  }
  k.part("neon arch", arc(2.4, 0.11, 4, 12), pink, { y: -0.06, z: -20.4 }, { glow: true });
  for (const sx of [-1, 1]) {
    k.part("arch post", box(0.3, 0.6, 0.3), metal, { x: sx * 2.4, y: 0.24, z: -20.4 });
    k.part("screen", box(2.4, 1.3, 0.1), 0x15182a, { x: sx * 6.6, y: 3.9, z: -20.2 });
    k.part("screen glow", box(2.1, 1.0, 0.05), sx < 0 ? pink : cyan, { x: sx * 6.6, y: 3.9, z: -20.12 }, { glow: true });
  }
}

function minaret(k: Kit): void {
  const L = k.look;
  const plaster = 0xe8dcc0;
  const sand = L.tower.plinth;
  const domeC = L.islamic?.domeKing ?? 0x1aa3a0;
  const lantern = L.lanterns?.[0] ?? 0xffc46b;
  const Z = KIT_BACK_Z - 0.5;
  k.part("arcade wall", box(26, 2.3, 1), plaster, { y: 1.09, z: Z });
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    k.part("merlon", box(0.55, 0.45, 1), sand, { x: i * 2.2, y: 2.46, z: Z });
  }
  // Horseshoe arcade with a lantern in every arch.
  for (const x of [-9, -6, -3, 3, 6, 9]) {
    k.part("arch recess", box(1.4, 1.4, 0.06), shade(sand, 0.45), { x, y: 0.66, z: Z + 0.52 });
    k.part("arch head", archHead(0.7, 0.06), shade(sand, 0.45), { x, y: 1.36, z: Z + 0.52 });
    k.part("keystone", box(0.22, 0.22, 0.08), GOLD, { x, y: 2.1, z: Z + 0.54 });
    k.part("lantern", gem(0.17), lantern, { x, y: 1.2, z: Z + 0.62, sy: 1.3 }, { glow: true });
    k.light(x, 1.2, Z + 0.8, lantern, 1.9);
  }
  // The great gate under a gold horseshoe.
  k.part("gate recess", box(2.6, 2.0, 0.08), shade(sand, 0.4), { y: 0.96, z: Z + 0.53 });
  k.part("gate head", archHead(1.3, 0.08, 10), shade(sand, 0.4), { y: 1.96, z: Z + 0.53 });
  k.part("gate rim", arc(1.42, 0.1, 3, 10), GOLD, { y: 1.96, z: Z + 0.6 });
  k.part("drum", cyl(1.6, 1.6, 0.8, 10), plaster, { y: 2.6, z: Z - 0.6 });
  k.part("great dome", dome(1.7), domeC, { y: 3.0, z: Z - 0.6, sy: 1.15 });
  // Two minarets.
  for (const sx of [-1, 1]) {
    const x = sx * 5.6;
    const z = Z - 0.4;
    k.part("minaret base", box(1.3, 1.0, 1.3), sand, { x, y: 0.44, z });
    k.part("minaret", cyl(0.48, 0.56, 6.4), plaster, { x, y: 4.1, z });
    k.part("balcony", cyl(0.78, 0.78, 0.22), GOLD, { x, y: 6.1, z });
    k.part("minaret top", cyl(0.36, 0.42, 1.6), plaster, { x, y: 7.1, z });
    k.part("minaret dome", ball(0.48), domeC, { x, y: 8.05, z, sy: 1.3 });
    k.part("finial", cone(0.12, 0.5, 6), GOLD, { x, y: 8.85, z });
  }
}

function palm(k: Kit, x: number, z: number, s: number): void {
  const L = k.look;
  k.part("palm trunk", cyl(0.13, 0.2, 2.8, 5), L.tree.trunk, { x, y: 1.34 * s, z, s, rz: 0.06 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.part("frond", cone(0.22, 1.4, 4), i % 2 ? L.tree.leafA : L.tree.leafB, {
      x: x + Math.cos(a) * 0.55 * s, y: 2.75 * s, z: z + Math.sin(a) * 0.55 * s, s,
      rx: Math.PI / 2 - 0.55, ry: -a + Math.PI / 2,
    });
  }
}

function oasis(k: Kit): void {
  const L = k.look;
  const adobe = 0xd8b888;
  const Z = KIT_BACK_Z - 0.4;
  k.part("adobe wall", box(26, 1.4, 0.9), adobe, { y: 0.64, z: Z });
  for (let i = -4; i <= 4; i++) k.part("merlon", box(0.7, 0.4, 0.9), shade(adobe, 0.9), { x: i * 2.8, y: 1.5, z: Z });
  k.part("pool", cyl(2.4, 2.4, 0.08, 14), L.band.glint, { y: 0.0, z: -18.9, sz: 0.5 });
  k.part("pool rim", new THREE.TorusGeometry(2.4, 0.13, 3, 14), 0xc9b48a, { y: 0.02, z: -18.9, rx: Math.PI / 2, sy: 0.5 });
  for (const [x, z, s] of [[-7.8, -19.6, 1.15], [-4.4, -18.4, 0.95], [-2.6, -20.2, 1.25], [3.0, -20.0, 1.1], [4.8, -18.2, 0.9], [8.4, -19.4, 1.2]] as const) {
    palm(k, x, z, s);
  }
  for (const [x, z] of [[-1.9, -18.3], [-1.4, -18.2], [1.6, -18.4], [2.1, -18.3]] as const) {
    k.part("reed", cone(0.06, 0.7, 3), 0x5a8a3a, { x, y: 0.3, z });
  }
  k.part("tent", cone(1.3, 1.3, 6), 0xc8503a, { x: 10.2, y: 1.2, z: -18.6 });
  k.part("tent wall", cyl(1.0, 1.1, 0.7, 6), 0xf0e0c0, { x: 10.2, y: 0.3, z: -18.6 });
  for (const sx of [-1, 1]) {
    k.part("lantern post", box(0.12, 1.4, 0.12), 0x6e4a28, { x: sx * 2.9, y: 0.64, z: -17.6 });
    k.part("lantern", gem(0.18), L.lanterns?.[0] ?? 0xffe08a, { x: sx * 2.9, y: 1.45, z: -17.6, sy: 1.3 }, { glow: true });
    k.light(sx * 2.9, 1.45, -17.6, L.lanterns?.[0] ?? 0xffe08a, 2.0);
  }
}

function dunes(k: Kit): void {
  const L = k.look;
  const sand = L.drift;
  for (let i = 0; i < 5; i++) {
    k.part("dune", dome(1, 12, 4), i % 2 ? sand : shade(sand, 0.92), { x: -11 + i * 5.5, y: -0.06, z: KIT_BACK_Z - 0.5 - (i % 2) * 0.6, sx: 3.6, sy: 1.8 + (i % 3) * 0.6, sz: 1.8 });
  }
  for (const x of [-3.4, 7.6]) k.part("dune", dome(1, 12, 4), shade(sand, 1.06), { x, y: -0.06, z: -19.0, sx: 2.6, sy: 0.9, sz: 1.3 });
  // A small kasbah.
  const mud = 0xc89058;
  k.part("kasbah", box(2.6, 2.2, 1.8), mud, { x: -6, y: 1.04, z: -20.4 });
  for (const [dx, dz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]] as const) {
    k.part("kasbah tower", box(0.6, 2.9, 0.6), shade(mud, 0.9), { x: -6 + dx, y: 1.39, z: -20.4 + dz });
  }
  for (let i = 0; i < 5; i++) k.part("crenel", box(0.32, 0.3, 0.3), shade(mud, 0.85), { x: -6.9 + i * 0.45, y: 2.3, z: -19.5 });
  k.part("kasbah door", box(0.6, 0.9, 0.05), DARK, { x: -6, y: 0.4, z: -19.48 });
  k.part("kasbah window", box(0.3, 0.3, 0.05), L.lanterns?.[0] ?? 0xffb050, { x: -6, y: 1.5, z: -19.48 }, { glow: true });
  palm(k, -2.0, -19.8, 1.1);
  palm(k, 3.4, -20.2, 1.25);
  k.part("tent", cone(1.3, 1.4, 6), 0xb85c38, { x: 6.2, y: 1.25, z: -18.8 });
  k.part("tent wall", cyl(1.0, 1.1, 0.7, 6), 0xf0e0c0, { x: 6.2, y: 0.3, z: -18.8 });
  for (const sx of [-1, 1]) {
    k.part("brazier", cyl(0.24, 0.14, 0.8, 6), 0x5a4030, { x: sx * 9.2, y: 0.34, z: -18.0 });
    k.part("brazier fire", cone(0.2, 0.45, 6), 0xffa040, { x: sx * 9.2, y: 0.96, z: -18.0 }, { glow: true });
    k.light(sx * 9.2, 1.0, -18.0, 0xffa040, 2.4);
  }
}

function alhambra(k: Kit): void {
  const L = k.look;
  const stucco = 0xe2b896;
  const red = 0xa8323a;
  const teal = L.islamic?.dome ?? 0x1aa3a0;
  const Z = KIT_BACK_Z - 0.5;
  k.part("palace wall", box(26, 2.2, 1), stucco, { y: 1.04, z: Z });
  k.part("tile dado", box(26, 0.5, 0.06), teal, { y: 0.2, z: Z + 0.53 });
  // An arcade of slender columns under muqarnas arches.
  const cols = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
  for (const x of cols) {
    k.part("column", cyl(0.12, 0.12, 1.9, 6), 0xfaf0e4, { x, y: 0.89, z: Z + 1.3 });
    k.part("capital", box(0.34, 0.16, 0.34), GOLD, { x, y: 1.9, z: Z + 1.3 });
  }
  for (let i = 0; i + 1 < cols.length; i++) {
    const x = (cols[i] + cols[i + 1]) / 2;
    k.part("arch", arc(1.32, 0.13, 3, 8), stucco, { x, y: 1.96, z: Z + 1.3, sy: 1.15 });
    // Muqarnas: stepped honeycomb tiers hanging in the arch.
    for (let t = 0; t < 3; t++) {
      k.part("muqarnas", box(1.4 - t * 0.42, 0.14, 0.4), t % 2 ? red : GOLD, { x, y: 3.16 - t * 0.18, z: Z + 1.3 });
    }
  }
  k.part("arcade roof", box(23, 0.24, 1.2), shade(stucco, 0.9), { y: 3.4, z: Z + 0.9 });
  for (const sx of [-1, 1]) {
    k.part("palace tower", box(2.0, 4.6, 1.8), shade(stucco, 0.95), { x: sx * 12, y: 2.24, z: Z - 0.4 });
    for (const dx of [-0.66, 0, 0.66]) k.part("tower merlon", box(0.4, 0.4, 0.4), red, { x: sx * 12 + dx, y: 4.74, z: Z + 0.4 });
    k.part("lantern", gem(0.17), L.lanterns?.[0] ?? 0xffd27a, { x: sx * 3, y: 1.55, z: Z + 1.3, sy: 1.3 }, { glow: true });
    k.part("lantern", gem(0.17), L.lanterns?.[1] ?? 0xff9a8a, { x: sx * 9, y: 1.55, z: Z + 1.3, sy: 1.3 }, { glow: true });
    k.light(sx * 3, 1.55, Z + 1.6, L.lanterns?.[0] ?? 0xffd27a, 2.0);
    k.light(sx * 9, 1.55, Z + 1.6, L.lanterns?.[1] ?? 0xff9a8a, 2.0);
  }
  // Dark cypresses in front of the arcade, as in the palace gardens.
  for (const x of [-8.2, -5.2, 5.2, 8.2]) {
    k.part("cypress", cone(0.42, 2.6, 6), 0x2a5a34, { x, y: 1.24, z: -17.9 });
    k.part("cypress trunk", cyl(0.07, 0.09, 0.3, 4), 0x5a4028, { x, y: 0.1, z: -17.9 });
  }
  k.part("reflecting pool", box(5, 0.06, 1.1), L.band.glint, { y: 0.0, z: -18.4 });
  k.part("pool edge", box(5.4, 0.1, 1.5), shade(stucco, 0.85), { y: -0.04, z: -18.4 });
}

const KITS: Record<BackdropKind, (k: Kit) => void> = {
  castle, bone, ice, forge, mystic, jungle, neon, minaret, oasis, dunes, alhambra,
};

/** Build the kit for `kind`, dressed in the look's palette. */
export function buildKit(kind: BackdropKind, look: ArenaLook): Kit {
  const k = new Kit(look);
  k.zShift = KIT_SHIFT;
  KITS[kind](k);
  k.zShift = 0;
  return k;
}
