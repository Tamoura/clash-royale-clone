/**
 * The Golden Age surround (art bible section 4): arcaded sandstone galleries
 * hold the crowd down both long sides (instead of bleachers), team-striped
 * souk awnings replace the pavilions, and behind them domed flat-roof houses
 * and palms make a town edge. Sculpted into one vertex-coloured mesh (one
 * draw); the crowd seats are returned for crowd.ts.
 *
 * The camera looks from the south at ~49 degrees: the galleries' tops, their
 * south end faces (a horseshoe arcade) and the awnings carry the detail.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../../game/arena";
import { stagePalette, type ArenaLook } from "../../arenaLooks";
import { THEME } from "../../theme";
import { Sculpt, sculptMaterial, tone } from "../views/towerCraft";
import type { CrowdSeat } from "./crowd";
import { bunting, setTeam } from "./scenery";

const lit = (_x: number, _y: number, _z: number, ny: number): number => (ny > 0.7 ? 1.06 : ny < -0.4 ? 0.7 : 1);
const ao = (_x: number, y: number, _z: number, ny: number): number => (0.72 + 0.28 * Math.min(1, Math.max(0, y / 1.4))) * (ny > 0.7 ? 1.05 : 1);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gallery inner face x (the field side) and depth. */
const GAL_X = ARENA_WIDTH / 2 + 2.2;
const GAL_DEPTH = 2.0;
const GAL_H = 1.15;

/** A horseshoe arch head (an upright disc cut low) facing +z, dark inside a light ring. */
function horseshoe(s: Sculpt, x: number, y: number, z: number, r: number, ring: number, dark: number): void {
  const head = new THREE.CircleGeometry(r, 14, -Math.PI * 0.18, Math.PI * 1.36);
  s.add(head, dark, x, y, z + 0.005, 0, () => 1);
  const torus = new THREE.TorusGeometry(r + 0.04, 0.045, 4, 14, Math.PI * 1.36);
  torus.rotateZ(-Math.PI * 0.18);
  s.add(torus, ring, x, y, z + 0.02, 0, lit);
  s.box(r * 2 * 0.86, y, 0.01, dark, x, y / 2, z + 0.005, 0, () => 1);
}

/** One gallery: an arcaded block with a stepped-merlon parapet, crowd on top, souk awning behind. */
function gallery(s: Sculpt, sx: number, zc: number, len: number, side: "player" | "enemy", look: ArenaLook, seats: CrowdSeat[], rand: () => number): void {
  const stone = tone(look.edging, 1.0, 0.55);
  const stoneLt = tone(stone, 1.12);
  const team = setTeam(side);
  const gold = THEME.gold;
  const x = sx * (GAL_X + GAL_DEPTH / 2);
  s.box(GAL_DEPTH, GAL_H, len, stone, x, GAL_H / 2 - 0.05, zc, 0, ao);
  // A zellige band and a gold fillet along the gallery's lip.
  s.box(0.1, 0.12, len, THEME.turquoise, sx * (GAL_X - 0.04), GAL_H - 0.2, zc, 0, lit);
  s.box(0.12, 0.04, len, gold, sx * (GAL_X - 0.05), GAL_H - 0.11, zc, 0, lit);
  // Stepped Moorish merlons along the field-side parapet.
  for (let z = zc - len / 2 + 0.25; z < zc + len / 2; z += 0.5) {
    s.box(0.16, 0.18, 0.3, stoneLt, sx * (GAL_X + 0.08), GAL_H + 0.09, z, 0, lit);
    s.box(0.16, 0.12, 0.14, stoneLt, sx * (GAL_X + 0.08), GAL_H + 0.24, z, 0, lit);
  }
  // The south end: a horseshoe arcade with a team banner over it.
  const endZ = zc + len / 2;
  for (const dx of [-0.5, 0.5]) horseshoe(s, x + dx * sx, 0.55, endZ, 0.3, gold, 0x2a2018);
  s.box(0.5, 0.42, 0.04, team, x, GAL_H - 0.3, endZ + 0.03, 0, lit);
  // Crowd: two rows on the gallery top, the front row behind the parapet.
  for (let row = 0; row < 2; row++) {
    const cx = sx * (GAL_X + 0.42 + row * 0.55);
    const n = Math.floor((len - 0.5) / 0.62);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.1) continue;
      seats.push({
        x: cx,
        z: zc - len / 2 + 0.4 + i * 0.62 + (rand() - 0.5) * 0.15 + row * 0.2,
        y: GAL_H + row * 0.12,
        face: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
        side,
      });
    }
  }
  // Behind the crowd: a striped souk awning, team and cream, on slim poles.
  const ax = sx * (GAL_X + GAL_DEPTH - 0.2);
  const stripes = Math.floor(len / 0.5);
  for (let i = 0; i < stripes; i++) {
    const z = zc - len / 2 + (i + 0.5) * (len / stripes);
    const g = new THREE.BoxGeometry(0.9, 0.05, len / stripes);
    g.rotateZ(sx * 0.45);
    s.add(g, i % 2 ? stagePalette(look).awning : team, ax, GAL_H + 1.2, z, 0, lit);
  }
  for (let z = zc - len / 2 + 0.1; z <= zc + len / 2; z += len / 3) {
    s.cyl(0.035, 0.035, 1.25, 0x6e4a28, sx * (GAL_X + GAL_DEPTH - 0.05), GAL_H + 0.6, z, 5);
  }
  bunting(s, sx * (GAL_X + 0.1), GAL_H + 0.95, zc - len / 2, sx * (GAL_X + 0.1), GAL_H + 0.95, zc + len / 2, team, gold, 0.22);
}

/** A whitewashed flat-roof house, sometimes domed, with an arched door on its south face. */
function house(s: Sculpt, x: number, z: number, k: number, look: ArenaLook, rand: () => number): void {
  const wall = tone(look.islamic ? 0xf0e6d0 : 0xe8dcc0, 0.94 + rand() * 0.08, 0.6);
  const w = (1.2 + rand() * 0.8) * k;
  const h = (1.0 + rand() * 0.9) * k;
  const d = (1.1 + rand() * 0.6) * k;
  s.box(w, h, d, wall, x, h / 2 - 0.05, z, 0, ao);
  s.box(w + 0.1, 0.1, d + 0.1, tone(wall, 0.9), x, h, z, 0, lit);
  s.box(0.3 * k, 0.5 * k, 0.03, 0x5a3a24, x + (rand() - 0.5) * w * 0.4, 0.22 * k, z + d / 2 + 0.01, 0, () => 1);
  s.box(0.22 * k, 0.22 * k, 0.03, 0x2a3a5a, x + w * 0.25, h * 0.65, z + d / 2 + 0.01, 0, () => 1);
  if (rand() < 0.45) {
    const r = Math.min(w, d) * 0.32;
    const dome = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    s.add(dome, rand() < 0.5 ? THEME.turquoise : tone(look.islamic?.dome ?? THEME.teal, 1.05), x, h + 0.04, z, 0, lit);
    s.add(new THREE.SphereGeometry(0.06 * k, 6, 4), THEME.gold, x, h + r + 0.06, z);
  }
}

/** A palm: a leaning ringed trunk and a crown of drooping fronds. */
function palm(s: Sculpt, x: number, z: number, k: number, look: ArenaLook, rand: () => number): void {
  const lean = (rand() - 0.5) * 0.3;
  const h = 2.1 * k;
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.1 * k, 0.13 * k, h / 5, 7);
    g.rotateZ(lean);
    s.add(g, tone(look.tree.trunk, i % 2 ? 0.92 : 1.05), x - Math.sin(lean) * (i + 0.5) * (h / 5), (i + 0.5) * (h / 5), z, 0, lit);
  }
  const tx = x - Math.sin(lean) * h;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.3;
    const g = new THREE.ConeGeometry(0.2 * k, 1.2 * k, 4);
    g.scale(1, 1, 0.3);
    g.translate(0, 0.6 * k, 0);
    g.rotateX(Math.PI / 2 + 0.55);
    g.rotateY(-a + Math.PI / 2);
    s.add(g, i % 2 ? look.tree.leafA : look.tree.leafB, tx, h, z, 0, lit);
  }
}

/** A cypress (or a snowy cedar on a white apron): the trees of the looks without palms. */
function cypress(s: Sculpt, x: number, z: number, k: number, look: ArenaLook): void {
  s.cyl(0.08 * k, 0.11 * k, 0.4 * k, look.tree.trunk, x, 0.2 * k, z, 6);
  const g = new THREE.ConeGeometry(0.42 * k, 2.2 * k, 9);
  s.add(g, look.tree.leafA, x, 0.3 * k + 1.1 * k, z, 0, (_x, y) => 0.7 + 0.35 * Math.min(1, y / (2.4 * k)));
  if (look.ambient === "snow") s.add(new THREE.ConeGeometry(0.26 * k, 0.7 * k, 9), 0xf4f8fc, x, 2.05 * k, z, 0, lit);
}

/** A souk stall: a striped team awning on four poles over a counter of goods. */
function stall(s: Sculpt, x: number, z: number, side: "player" | "enemy", rand: () => number): void {
  const team = setTeam(side);
  s.box(1.4, 0.5, 0.7, 0x8a5a2a, x, 0.25, z, 0, ao);
  for (let i = 0; i < 5; i++) {
    s.add(new THREE.SphereGeometry(0.1, 6, 4), [0xe8a33a, 0xc0392b, 0x7cb342, 0xf2c14e][Math.floor(rand() * 4)], x - 0.5 + i * 0.25, 0.56, z + (rand() - 0.5) * 0.3);
  }
  for (const dx of [-0.65, 0.65]) for (const dz of [-0.35, 0.35]) s.cyl(0.03, 0.03, 1.3, 0x6e4a28, x + dx, 0.65, z + dz, 5);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.3, 0.05, 1.0);
    g.rotateX(-0.25);
    s.add(g, i % 2 ? 0xf3ead6 : team, x - 0.6 + i * 0.3, 1.35, z, 0, lit);
  }
}

/** Build the Golden Age surround into `parent`; returns the gallery crowd seats. */
export function buildGoldenSurround(parent: THREE.Object3D, look: ArenaLook): CrowdSeat[] {
  const s = new Sculpt(lit);
  // Per side, so a portrait phone culls them whole: the houses are the outer
  // ring (hidden below L2), the palms the fallback that always stays.
  const town = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const palms = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const rand = mulberry(31337);
  const seats: CrowdSeat[] = [];
  const hd = ARENA_HEIGHT / 2;
  const len = hd - 4.6;
  for (const sx of [-1, 1]) {
    gallery(s, sx, -hd / 2 - 1.1, len, "enemy", look, seats, rand);
    gallery(s, sx, hd / 2 + 1.1, len, "player", look, seats, rand);
    // Souk stalls by the gallery ends, near the river.
    stall(s, sx * (GAL_X + 1), -2.6, "enemy", rand);
    stall(s, sx * (GAL_X + 1), 2.6, "player", rand);
    // The town edge beyond: houses, domes and palms, thicker further out.
    for (let i = 0; i < 16; i++) {
      const x = sx * (GAL_X + GAL_DEPTH + 1.6 + rand() * 7);
      const z = (rand() - 0.5) * 38;
      if (Math.abs(z) < 1.8) continue;
      house(town[sx], x, z, 0.9 + rand() * 0.5, look, rand);
    }
    for (let i = 0; i < 12; i++) {
      const x = sx * (GAL_X + GAL_DEPTH + 0.8 + rand() * 7.5);
      const z = (rand() - 0.5) * 38;
      if (Math.abs(z) < 1.6) continue;
      if (look.tree.kind === "palm") palm(palms[sx], x, z, 0.9 + rand() * 0.5, look, rand);
      else cypress(palms[sx], x, z, 0.9 + rand() * 0.5, look);
    }
  }
  const mesh = s.mesh(sculptMaterial(), "golden-galleries");
  if (mesh) parent.add(mesh);
  for (const sx of [-1, 1]) {
    for (const [sc, name, tier] of [[town[sx], "golden-town", "outer"], [palms[sx], "golden-palms", "forest"]] as const) {
      const m = sc.mesh(sculptMaterial(), name);
      if (!m) continue;
      m.castShadow = false;
      m.userData.dressing = tier;
      parent.add(m);
    }
  }
  return seats;
}
