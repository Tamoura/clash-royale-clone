/**
 * Layered set dressing for the classic edition ("handcrafted plus"
 * prototype). Everything here is sculpted into ONE vertex-coloured mesh
 * (see views/towerCraft.ts: Sculpt), so the whole surround costs a single
 * draw call however many props it holds:
 *
 *  - a kerb of dressed stone blocks around the court, with capped piers;
 *  - stepped spectator terraces down both long sides (three rows deep, so
 *    the crowd has depth), their ends faced with a team shield;
 *  - striped pavilions and tall team banners behind each terrace;
 *  - a forest edge: round-crowned trees and pines in clusters, bushes,
 *    boulders, ground patches and flower beds, denser away from the court.
 *
 * The camera looks from the south at ~49 degrees and is orthographic, so
 * only top faces and south (+z) faces are ever seen: detail is put there.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, RIVER_HALF_WIDTH } from "../../../game/arena";
import { stagePalette, type ArenaLook } from "../../arenaLooks";
import { teamColor } from "../../teamColors";
import { Sculpt, frustum, sculptMaterial, tone } from "../views/towerCraft";
import type { CrowdSeat } from "./crowd";

/** @deprecated The crowd now takes CrowdSeat (crowd.ts). */
export interface ScenerySeat {
  x: number;
  z: number;
  garb: number;
  skin: number;
  lift?: number;
}

/** Team cloth for the stands: the live team colour, a touch deeper on the set. */
export function setTeam(side: "player" | "enemy"): number {
  return tone(teamColor(side), 0.92, 0.95);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLD = 0xf2c14e;

/**
 * A string of pennants from (x0, y0, z0) to (x1, y1, z1), sagging in the
 * middle: little triangular flags alternating `a` and `b`, facing +z.
 */
export function bunting(s: Sculpt, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, a: number, b: number, sag = 0.35): void {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(3, Math.round(len / 0.42));
  const rope = new THREE.CylinderGeometry(0.012, 0.012, 1, 3, 1);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const at = (t: number): [number, number, number] => [
      x0 + (x1 - x0) * t,
      y0 + (y1 - y0) * t - sag * 4 * t * (1 - t),
      z0 + (z1 - z0) * t,
    ];
    const p0 = at(t0);
    const p1 = at(t1);
    const seg = rope.clone();
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const l = Math.hypot(dx, dy, dz);
    seg.scale(1, l, 1);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    s.add(seg, 0x5a4632, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 0, () => 1);
    // The pennant hangs from the middle of the segment.
    const m = at((t0 + t1) / 2);
    const flag = new THREE.BufferGeometry();
    const w = 0.15;
    const h = 0.26;
    flag.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, -h, 0, w, 0, 0, -w, 0, 0, 0, -h, 0], 3));
    flag.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    flag.rotateY(Math.atan2(-(z1 - z0), x1 - x0));
    s.add(flag, i % 2 ? b : a, m[0], m[1] - 0.01, m[2], 0, () => 1);
  }
  rope.dispose();
}

/** Top faces a touch lighter, undersides darker. */
const lit = (_x: number, _y: number, _z: number, ny: number): number => (ny > 0.7 ? 1.06 : ny < -0.4 ? 0.7 : 1);

/** A round-crowned tree: a trunk and a clump of leafy blobs, lit from above. */
function roundTree(s: Sculpt, x: number, z: number, k: number, look: ArenaLook, rand: () => number): void {
  const trunkH = 0.9 * k;
  s.cyl(0.11 * k, 0.17 * k, trunkH, tone(look.tree.trunk, 0.9), x, trunkH / 2, z, 7, (_x, y) => 0.7 + 0.3 * smooth(0, trunkH, y));
  const leafA = tone(look.tree.leafA, 1.0, 1.05);
  const leafB = tone(look.tree.leafB, 1.12, 1.05);
  const y0 = trunkH * 0.75;
  const top = y0 + 1.75 * k;
  const crown = (dx: number, dy: number, dz: number, r: number, c: number): void => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.86, 1);
    // Painted from a shaded underside up to a sunlit top, warmer at the crest.
    s.add(g, c, x + dx, y0 + dy, z + dz, rand() * 3, (_x, y, _z, ny) => (0.62 + 0.46 * smooth(y0, top, y)) * (ny < -0.3 ? 0.8 : 1));
  };
  crown(0, 0.75 * k, 0, 0.82 * k, leafA);
  crown(-0.5 * k, 0.5 * k, 0.25 * k, 0.56 * k, leafA);
  crown(0.48 * k, 0.55 * k, 0.2 * k, 0.6 * k, leafB);
  crown(0.1 * k, 1.18 * k, -0.1 * k, 0.56 * k, leafB);
}

/** A pine: tiers of drooping cones, each tier lighter toward its rim. */
function pineTree(s: Sculpt, x: number, z: number, k: number, look: ArenaLook): void {
  s.cyl(0.1 * k, 0.15 * k, 0.6 * k, tone(look.tree.trunk, 0.85), x, 0.3 * k, z, 6);
  const dark = tone(look.tree.leafA, 0.8, 1.0);
  const light = tone(look.tree.leafA, 1.05, 1.0);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const r = (0.78 - i * 0.17) * k;
    const h = 0.82 * k;
    const y = (0.42 + i * 0.5) * k;
    const g = new THREE.ConeGeometry(r, h, 9, 1, true);
    s.add(g, i % 2 ? light : dark, x, y + h / 2, z, i * 0.5, (_x, yy) => 0.74 + 0.34 * smooth(y, y + h, yy));
  }
}

function bush(s: Sculpt, x: number, z: number, k: number, look: ArenaLook, rand: () => number): void {
  const c = tone(look.tree.leafB, 1.08, 1.05);
  for (const [dx, dz, r] of [[0, 0, 0.5], [0.42, 0.12, 0.36], [-0.4, 0.1, 0.34]] as const) {
    const g = new THREE.IcosahedronGeometry(r * k, 1);
    g.scale(1, 0.72, 1);
    s.add(g, rand() < 0.5 ? c : tone(look.tree.leafA, 1.05), x + dx * k, r * k * 0.5, z + dz * k, rand() * 3, (_x, y) => 0.66 + 0.42 * smooth(0, r * k * 1.1, y));
  }
}

function boulder(s: Sculpt, x: number, z: number, k: number, look: ArenaLook, rand: () => number): void {
  const base = tone(look.rock, 1.0, 0.8);
  for (const [dx, dz, r] of [[0, 0, 0.42], [0.36, 0.14, 0.26], [-0.3, 0.2, 0.2]] as const) {
    const g = new THREE.IcosahedronGeometry(r * k, 0);
    g.scale(1, 0.72, 0.9);
    g.rotateY(rand() * 3);
    s.add(g, tone(base, 0.92 + rand() * 0.2), x + dx * k, r * k * 0.42, z + dz * k, 0, (_x, y, _z, ny) => (0.7 + 0.3 * smooth(0, r * k, y)) * (ny > 0.4 ? 1.12 : ny < -0.2 ? 0.75 : 0.95));
  }
}

/** A team banner hung from a pole: the cloth faces the camera. */
function bannerPole(s: Sculpt, x: number, z: number, h: number, cloth: number): void {
  s.cyl(0.045, 0.06, h, 0x6e4a28, x, h / 2, z, 6);
  s.add(new THREE.SphereGeometry(0.09, 8, 6), GOLD, x, h + 0.05, z);
  const bw = 0.62;
  const bh = 1.25;
  const rod = new THREE.CylinderGeometry(0.025, 0.025, bw + 0.12, 6);
  rod.rotateZ(Math.PI / 2);
  s.add(rod, GOLD, x, h - 0.12, z + 0.05);
  s.box(bw, bh, 0.03, cloth, x, h - 0.14 - bh / 2, z + 0.05, 0, (_x, y) => 0.82 + 0.2 * smooth(h - 0.14 - bh, h - 0.14, y));
  s.box(bw - 0.16, bh - 0.3, 0.035, tone(cloth, 1.18, 0.9), x, h - 0.2 - bh / 2 + 0.1, z + 0.055, 0, lit);
  const gem = new THREE.OctahedronGeometry(0.13);
  gem.scale(0.9, 1.15, 0.2);
  s.add(gem, GOLD, x, h - 0.14 - bh * 0.45, z + 0.08, 0, lit);
  for (const sx of [-1, 1]) {
    const tail = new THREE.ConeGeometry(bw / 4, 0.26, 4);
    tail.rotateX(Math.PI);
    tail.rotateY(Math.PI / 4);
    tail.scale(1, 1, 0.16);
    s.add(tail, cloth, x + (sx * bw) / 4, h - 0.14 - bh - 0.12, z + 0.05, 0, lit);
  }
}

/** A round striped pavilion with a pennant. */
function pavilion(s: Sculpt, x: number, z: number, k: number, cloth: number, look: ArenaLook): void {
  const canvas = tone(stagePalette(look).awning, 1.0, 0.8);
  const wallH = 0.85 * k;
  const r = 1.05 * k;
  s.cyl(r * 0.92, r, wallH, canvas, x, wallH / 2, z, 12, (_x, y) => 0.72 + 0.28 * smooth(0, wallH, y));
  // Door flap facing the camera.
  s.box(0.42 * k, wallH * 0.8, 0.05, tone(cloth, 0.7), x, wallH * 0.4, z + r * 0.97, 0, lit);
  // Striped roof: twelve gores alternating cloth and canvas, over a scalloped eave.
  const seg = 12;
  const roofH = 1.15 * k;
  for (let i = 0; i < seg; i++) {
    const g = new THREE.CylinderGeometry(0.04, r * 1.14, roofH, 1, 1, true, (i / seg) * Math.PI * 2, (Math.PI * 2) / seg);
    s.add(g, i % 2 ? canvas : cloth, x, wallH + roofH / 2, z, 0, (_x, y) => 0.8 + 0.24 * smooth(wallH, wallH + roofH, y));
  }
  s.cyl(r * 1.16, r * 1.16, 0.09 * k, tone(cloth, 0.72), x, wallH + 0.02, z, 12, lit);
  s.cyl(0.03, 0.03, 0.7 * k, 0x6e4a28, x, wallH + roofH + 0.3 * k, z, 5);
  s.add(new THREE.SphereGeometry(0.07 * k, 8, 6), GOLD, x, wallH + roofH + 0.02, z);
  s.box(0.5 * k, 0.26 * k, 0.02, cloth, x + 0.27 * k, wallH + roofH + 0.5 * k, z, 0, lit);
}

/** The stone kerb around the court: dressed blocks, a cap, piers with pyramid caps. */
function kerb(s: Sculpt, look: ArenaLook): void {
  const stone = tone(stagePalette(look).kerb, 1.0, 0.55);
  const dark = tone(stone, 0.8);
  const hw = ARENA_WIDTH / 2 + 0.45;
  const hd = ARENA_HEIGHT / 2 + 0.2;
  const rand = mulberry(911);
  const ao = (_x: number, y: number, _z: number, ny: number): number => (0.68 + 0.32 * smooth(-0.1, 0.34, y)) * (ny > 0.7 ? 1.06 : 1);
  // Long sides: blocks of uneven length, leaving the river mouths open.
  for (const sx of [-1, 1]) {
    let z = -hd;
    while (z < hd) {
      const len = Math.min(hd - z, 0.8 + rand() * 0.7);
      const mid = z + len / 2;
      if (Math.abs(mid) > RIVER_HALF_WIDTH + 0.35) {
        const h = 0.36 + rand() * 0.07;
        s.box(0.56, h, len - 0.05, tone(stone, 0.93 + rand() * 0.14), sx * hw, h / 2 - 0.08, mid, 0, ao);
      }
      z += len;
    }
    // River mouths: a low culvert arch stone each side of the water.
    for (const sz of [-1, 1]) s.box(0.7, 0.5, 0.36, dark, sx * hw, 0.14, sz * (RIVER_HALF_WIDTH + 0.3), 0, ao);
  }
  for (const sz of [-1, 1]) {
    let x = -hw;
    while (x < hw) {
      const len = Math.min(hw - x, 0.8 + rand() * 0.7);
      const h = 0.36 + rand() * 0.07;
      s.box(len - 0.05, h, 0.56, tone(stone, 0.93 + rand() * 0.14), x + len / 2, h / 2 - 0.08, sz * hd, 0, ao);
      x += len;
    }
  }
  // Piers at the corners and along the sides, capped with little pyramids.
  const pier = (x: number, z: number, team: number | null): void => {
    s.add(frustum(0.44, 0.38, -0.1, 0.72), stone, x, 0, z, 0, ao);
    s.add(frustum(0.46, 0.46, 0.72, 0.8), dark, x, 0, z, 0, lit);
    s.add(frustum(0.42, 0.04, 0.8, 1.06), team ?? tone(stone, 1.1), x, 0, z, 0, lit);
    if (team !== null) s.add(new THREE.SphereGeometry(0.08, 8, 6), GOLD, x, 1.1, z);
  };
  for (const sx of [-1, 1]) {
    for (const z of [-hd, -8.2, 8.2, hd]) pier(sx * hw, z, z < 0 ? setTeam("enemy") : setTeam("player"));
  }
}

/** One spectator terrace: three rising rows, faced ends, pavilions and banners behind. */
function terrace(s: Sculpt, sx: number, zc: number, len: number, cloth: number, look: ArenaLook, seats: CrowdSeat[], rand: () => number): void {
  const stone = tone(look.standWall, 1.12, 0.6);
  const x0 = ARENA_WIDTH / 2 + 2.3;
  const rows = 3;
  const depth = 0.86;
  const ao = (_x: number, y: number, _z: number, ny: number): number => (0.7 + 0.3 * smooth(0, 1.2, y)) * (ny > 0.7 ? 1.05 : 1);
  for (let k = 0; k < rows; k++) {
    const h = 0.5 + k * 0.44;
    const x = sx * (x0 + k * depth);
    s.box(depth, h, len, tone(stone, k % 2 ? 0.94 : 1.04), x, h / 2 - 0.06, zc, 0, ao);
    // Bench plank along the back of each row.
    s.box(depth * 0.3, 0.07, len - 0.3, 0x9a6a3a, x + sx * 0.24, h - 0.03, zc, 0, lit);
    const n = Math.floor((len - 0.6) / 0.72);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.12) continue; // an empty seat here and there
      seats.push({
        x: x - sx * 0.12,
        z: zc - len / 2 + 0.5 + i * 0.72 + (rand() - 0.5) * 0.2,
        y: h - 0.06,
        face: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
        side: zc < 0 ? "enemy" : "player",
      });
    }
  }
  // Team-coloured front rail and end caps (the south end faces the camera).
  const railX = sx * (x0 - depth / 2 - 0.06);
  s.box(0.14, 0.62, len + 0.2, tone(cloth, 0.9), railX, 0.25, zc, 0, ao);
  s.box(0.2, 0.07, len + 0.24, GOLD, railX, 0.58, zc, 0, lit);
  const backX = sx * (x0 + (rows - 0.5) * depth + 0.14);
  const backH = 0.5 + rows * 0.44 + 0.25;
  s.box(0.28, backH, len + 0.2, tone(stone, 0.86), backX, backH / 2 - 0.06, zc, 0, ao);
  s.box(0.36, 0.09, len + 0.26, tone(cloth, 0.9), backX, backH - 0.02, zc, 0, lit);
  for (const end of [-1, 1]) {
    const z = zc + end * (len / 2 + 0.16);
    const w = rows * depth + 0.5;
    const cx = sx * (x0 + ((rows - 1) * depth) / 2 + 0.05);
    s.box(w, backH, 0.3, tone(stone, 0.96), cx, backH / 2 - 0.06, z, 0, ao);
    s.box(w + 0.1, 0.1, 0.38, tone(cloth, 0.9), cx, backH - 0.02, z, 0, lit);
    if (end > 0) {
      // Shield on the camera-facing end wall.
      s.box(0.62, 0.7, 0.05, cloth, cx, backH * 0.52, z + 0.17, 0, lit);
      const gem = new THREE.OctahedronGeometry(0.2);
      gem.scale(0.9, 1.1, 0.16);
      s.add(gem, GOLD, cx, backH * 0.52, z + 0.2, 0, lit);
    }
  }
  // Pennant strings along the front, between the rail's end posts.
  bunting(s, railX, 1.25, zc - len / 2, railX, 1.25, zc + len / 2, cloth, GOLD, 0.25);
  // Behind the top row: banners between striped pavilions.
  const bx = sx * (x0 + rows * depth + 1.5);
  const spots = Math.max(2, Math.round(len / 4.2));
  for (let i = 0; i < spots; i++) {
    const z = zc - len / 2 + (len * (i + 0.5)) / spots;
    pavilion(s, bx + sx * (i % 2) * 0.5, z, 0.92 + (i % 2) * 0.12, cloth, look);
  }
  for (let i = 0; i <= spots; i++) {
    const z = zc - len / 2 + (len * i) / spots;
    bannerPole(s, sx * (x0 + rows * depth + 0.55), z, 3.0 + (i % 2) * 0.25, cloth);
  }
}

/**
 * Build the classic surround into `parent`; returns the terrace crowd seats.
 * `phoneReach` is how far past the court a portrait phone sees (bushes there).
 */
/** Outer-ring theme per look (art bible section 4). */
export type OuterTheme = "village" | "chalets" | "spires" | "basalt" | "crystal" | "city";
export const OUTER_THEMES: Readonly<Record<string, OuterTheme>> = {
  meadow: "village", swamp: "village", jungle: "village", workshop: "village", royal: "village",
  snow: "chalets", ice: "chalets", bone: "spires", forge: "basalt", mystic: "crystal", neon: "city",
};

/** Where the outer ring's set pieces stand: clear of the river, spread along the side. */
const OUTER_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [17.6, -13.5], [19.6, -10.2], [17.4, -7.2], [19.8, -4.6], [17.9, 5.0], [20.0, 8.2], [17.5, 11.0], [19.4, 14.2],
];

/** A cottage: cream walls, a gabled roof in an earthy (never team) colour, a door and a window. */
function cottage(s: Sculpt, x: number, z: number, k: number, roof: number, wall: number, rand: () => number): void {
  const w = 1.5 * k;
  const d = 1.2 * k;
  const h = 0.9 * k;
  s.box(w, h, d, wall, x, h / 2 - 0.05, z, 0, (_x, y) => 0.72 + 0.28 * smooth(0, h, y));
  const prism = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.2, 3, 1);
  prism.rotateZ(Math.PI / 2);
  prism.rotateX(Math.PI / 6);
  prism.scale(1, 0.75, 1);
  s.add(prism, roof, x, h + d * 0.22, z, 0, lit);
  s.box(0.24 * k, 0.42 * k, 0.03, 0x6b4520, x - w * 0.2, 0.18 * k, z + d / 2 + 0.01, 0, () => 1);
  s.box(0.24 * k, 0.2 * k, 0.03, 0x37506e, x + w * 0.22, h * 0.55, z + d / 2 + 0.01, 0, () => 1);
  if (rand() < 0.5) s.box(0.16 * k, 0.4 * k, 0.16 * k, tone(wall, 0.8), x + w * 0.3, h + d * 0.4, z - d * 0.1, 0, lit);
}

/** A windmill: a tapered tower, a cap and four sails facing the camera. */
function windmill(s: Sculpt, x: number, z: number, k: number, look: ArenaLook): void {
  s.cyl(0.42 * k, 0.62 * k, 2.4 * k, 0xece2cc, x, 1.15 * k, z, 10, (_x, y) => 0.72 + 0.3 * smooth(0, 2.4 * k, y));
  s.add(new THREE.ConeGeometry(0.55 * k, 0.6 * k, 10), 0x8a5a3a, x, 2.65 * k, z, 0, lit);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(0.2 * k, 1.5 * k, 0.03);
    g.translate(0, 0.8 * k, 0);
    g.rotateZ((i * Math.PI) / 2 + 0.4);
    s.add(g, 0xf3ead6, x, 2.2 * k, z + 0.62 * k, 0, () => 1);
  }
  s.box(0.24 * k, 0.4 * k, 0.03, 0x6b4520, x, 0.2 * k, z + 0.6 * k, 0, () => 1);
  void look;
}

/** A small orchard: two rows of round fruit trees. */
function orchard(s: Sculpt, x: number, z: number, look: ArenaLook, rand: () => number): void {
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const tx = x + (c - 1) * 1.1;
      const tz = z + r * 1.1;
      s.cyl(0.07, 0.1, 0.5, look.tree.trunk, tx, 0.25, tz, 6);
      const crown = new THREE.IcosahedronGeometry(0.45, 1);
      s.add(crown, tone(look.tree.leafB, 1.05), tx, 0.8, tz, rand() * 3, (_x, y) => 0.7 + 0.4 * smooth(0.4, 1.2, y));
      for (let f = 0; f < 3; f++) s.add(new THREE.SphereGeometry(0.06, 5, 4), rand() < 0.5 ? 0xe53935 : 0xf2a03a, tx + (rand() - 0.5) * 0.6, 0.85 + rand() * 0.25, tz + 0.35);
    }
  }
}

/** A market stall with a neutral striped awning (no team colours off the court). */
function marketStall(s: Sculpt, x: number, z: number, stripe: number, rand: () => number): void {
  s.box(1.3, 0.45, 0.6, 0x8a5a2a, x, 0.22, z, 0, lit);
  for (let i = 0; i < 4; i++) s.add(new THREE.SphereGeometry(0.1, 6, 4), [0xf2c14e, 0x7cb342, 0xe8a33a][Math.floor(rand() * 3)], x - 0.45 + i * 0.3, 0.5, z);
  for (const dx of [-0.6, 0.6]) s.cyl(0.03, 0.03, 1.2, 0x6e4a28, x + dx, 0.6, z - 0.25, 5);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.28, 0.04, 0.9);
    g.rotateX(-0.3);
    s.add(g, i % 2 ? 0xf3ead6 : stripe, x - 0.56 + i * 0.28, 1.25, z, 0, lit);
  }
}

/** One outer-ring set piece of `theme` at (x, z). */
function outerPiece(s: Sculpt, theme: OuterTheme, i: number, x: number, z: number, look: ArenaLook, rand: () => number): void {
  const roofs = [0x9a5a3a, 0x7a4a32, 0x8c6a3a, 0x5a6a7a];
  switch (theme) {
    case "village":
      if (i === 2) windmill(s, x, z, 1.0, look);
      else if (i === 5) orchard(s, x, z, look, rand);
      else if (i === 3 || i === 4) marketStall(s, x - 0.8, z + 0.8, [0x2e7d32, 0xf2a03a, 0x8e44ad][i % 3], rand);
      else cottage(s, x, z, 0.9 + rand() * 0.3, roofs[i % roofs.length], 0xf0e6d0, rand);
      break;
    case "chalets":
      cottage(s, x, z, 0.95 + rand() * 0.3, 0xf4f8fc, 0x9a6a3a, rand);
      pineTree(s, x + 1.3, z - 0.8, 1.1, look);
      s.add(new THREE.ConeGeometry(0.42, 0.5, 9), 0xf4f8fc, x + 1.3, 2.05, z - 0.8);
      break;
    case "spires":
      for (let k = 0; k < 3; k++) {
        const g = new THREE.ConeGeometry(0.5 - k * 0.1, 2.2 + k * 0.8, 6);
        s.add(g, tone(look.rock, 0.9 + k * 0.08), x + (k - 1) * 0.7, (2.2 + k * 0.8) / 2, z + (k % 2) * 0.5, rand() * 3, (_x, y) => 0.7 + 0.35 * smooth(0, 3, y));
      }
      break;
    case "basalt":
      for (let k = 0; k < 4; k++) {
        const g = new THREE.CylinderGeometry(0.42, 0.5, 1.2 + k * 0.5, 6);
        s.add(g, tone(0x2e2628, 0.9 + rand() * 0.2), x + (k - 1.5) * 0.75, (1.2 + k * 0.5) / 2, z + (k % 2) * 0.4, rand(), lit);
      }
      s.box(1.0, 0.7, 0.8, 0x3a3236, x, 0.35, z + 1.2, 0, lit);
      s.box(0.5, 0.25, 0.04, 0xff8a3a, x, 0.35, z + 1.61, 0, () => 1);
      break;
    case "crystal":
      for (let k = 0; k < 4; k++) {
        const g = new THREE.OctahedronGeometry(0.4);
        g.scale(0.7, 2.4 + k * 0.6, 0.7);
        s.add(g, k % 2 ? 0xc8a8ff : 0x9a7ae0, x + (k - 1.5) * 0.55, 0.9 + k * 0.25, z + (k % 2) * 0.4, rand(), lit);
      }
      break;
    case "city": {
      const h = 2.2 + rand() * 2.4;
      s.box(1.4, h, 1.2, 0x2a2f48, x, h / 2, z, 0, lit);
      for (let r = 0; r < Math.floor(h / 0.5); r++) {
        s.box(1.1, 0.12, 0.03, r % 2 ? 0x59d6ff : 0xff6ad8, x, 0.4 + r * 0.5, z + 0.61, 0, () => 1);
      }
      break;
    }
  }
}

export function buildClassicScenery(parent: THREE.Object3D, look: ArenaLook): CrowdSeat[] {
  const s = new Sculpt(lit);
  // The forest and the outer ring, per side: off-screen on a portrait phone
  // (frustum-culled whole), and they never cast (their shadows would fall off
  // the court, and the per-frame troop-shadow pass would redraw them).
  const forest = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const outer = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const rand = mulberry(20261111);
  const seats: CrowdSeat[] = [];
  const hw = ARENA_WIDTH / 2;
  const hd = ARENA_HEIGHT / 2;

  kerb(s, look);

  // Terraces: red on the enemy half, blue on the player's, both long sides.
  const tLen = hd - 4.2;
  for (const sx of [-1, 1]) {
    terrace(s, sx, -hd / 2 - 0.9, tLen, setTeam("enemy"), look, seats, rand);
    terrace(s, sx, hd / 2 + 0.9, tLen, setTeam("player"), look, seats, rand);
  }

  // Ground patches on the apron: worn earth by the terraces, lighter and
  // darker turf further out, so the surround is not one flat green.
  const apron = tone(look.apron, 1.0, 1.0);
  const patch = (x: number, z: number, rx: number, rz: number, c: number): void => {
    const g = new THREE.CircleGeometry(1, 14);
    g.rotateX(-Math.PI / 2);
    g.scale(rx, 1, rz);
    forest[Math.sign(x) || 1].add(g, c, x, -0.052, z, rand() * 3, () => 1);
  };
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      patch(sx * (hw + 3 + rand() * 9), (rand() - 0.5) * 40, 1.2 + rand() * 2.2, 1 + rand() * 1.8, tone(apron, rand() < 0.5 ? 0.86 : 1.13));
    }
  }

  // Shrubs, stones and flowers hugging the kerb: what a portrait phone sees
  // of the surround, so it gets the closest attention.
  for (const sx of [-1, 1]) {
    for (let z = -hd + 0.6; z < hd; z += 1.5 + rand() * 1.3) {
      if (Math.abs(z) < 1.9) continue; // keep the river mouth clear
      const x = sx * (hw + 1.02 + rand() * 0.2);
      const roll = rand();
      if (roll < 0.55) bush(s, x, z, 0.7 + rand() * 0.45, look, rand);
      else if (roll < 0.8) boulder(s, x, z, 0.7 + rand() * 0.5, look, rand);
      else {
        for (let k = 0; k < 4; k++) {
          s.add(new THREE.SphereGeometry(0.09, 6, 5), [0xffffff, 0xfff176, 0xf48fb1][k % 3], x + (rand() - 0.5) * 0.5, 0.05, z + (rand() - 0.5) * 0.7, 0, () => 1);
        }
      }
    }
    // Reeds and a boulder where the river leaves the court.
    boulder(s, sx * (hw + 1.2), -1.7, 1.0, look, rand);
    boulder(s, sx * (hw + 1.5), 1.75, 0.8, look, rand);
  }

  // The forest edge: clusters that thicken away from the court. Kept clear
  // of the terraces' front so their shadows stay off the playfield.
  const pine = look.tree.kind === "pine";
  const theme = OUTER_THEMES[look.id] ?? "village";
  for (const sx of [-1, 1]) {
    const f = forest[sx];
    OUTER_SPOTS.forEach(([ox, oz], i) => outerPiece(outer[sx], theme, i, sx * ox, oz * (sx > 0 ? 1 : -1), look, rand));
    const inner = hw + 7.9;
    for (let i = 0; i < 40; i++) {
      const band = rand();
      const x = sx * (inner + band * band * 9 + rand() * 1.5);
      const z = (rand() - 0.5) * 46;
      if (Math.abs(z) < 2.4) continue; // the river runs on through the trees
      // Leave the outer ring's set pieces standing in clearings.
      if (OUTER_SPOTS.some(([ox, oz]) => Math.abs(Math.abs(x) - ox) < 1.6 && Math.abs(z - oz * sx) < 1.6)) continue;
      const k = 0.95 + rand() * 0.75 + band * 0.3;
      if (pine && rand() < 0.45) pineTree(f, x, z, k * 1.15, look);
      else roundTree(f, x, z, k, look, rand);
      if (rand() < 0.5) bush(f, x + (rand() - 0.5) * 2.2, z + 1.0 + rand(), 0.8 + rand() * 0.5, look, rand);
      if (rand() < 0.22) boulder(f, x + (rand() - 0.5) * 2.4, z + 1.2, 0.9 + rand() * 0.8, look, rand);
    }
    // A few trees by the corners, in front of and behind the terraces' ends.
    for (const [dx, z, k] of [[5.4, -hd - 2.2, 1.2], [6.2, hd + 1.6, 1.1], [5.2, -3.4, 1.0], [6.4, 3.6, 1.25]] as const) {
      roundTree(f, sx * (hw + dx), z, k, look, rand);
    }
  }

  const mesh = s.mesh(sculptMaterial(), "classic-scenery");
  if (mesh) parent.add(mesh);
  for (const sx of [-1, 1]) {
    const fm = forest[sx].mesh(sculptMaterial(), "classic-forest");
    if (fm) {
      fm.castShadow = false;
      fm.userData.dressing = "forest";
      parent.add(fm);
    }
    const om = outer[sx].mesh(sculptMaterial(), "outer-ring");
    if (om) {
      om.castShadow = false;
      om.userData.dressing = "outer";
      parent.add(om);
    }
  }
  return seats;
}
