/**
 * The Golden Age surround (art bible section 4): arcaded sandstone galleries
 * hold the crowd down both long sides (instead of bleachers), team-striped
 * souk awnings replace the pavilions, and behind them a town edge: flat-roof
 * houses in the look's own plaster (parapets, arched doors and windows, some
 * domes or upper storeys, never overlapping), street lanterns and palms.
 * Sculpted into vertex-coloured meshes (the galleries one draw; the town,
 * its lamps and the palms one each per side); the crowd seats are returned
 * for crowd.ts.
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
import { bunting, contactShadow, setTeam } from "./scenery";

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

/** The town's tones for one look (see townPalette). */
export interface TownPalette {
  /** Wall plasters, picked per house. */
  walls: number[];
  /** Roof lips, door and window frames. */
  trim: number;
  /** The flat roof deck inside the parapet. */
  roof: number;
  /** Painted doors (souk blue, teal, green, oxblood, plain wood), picked per house. */
  doors: number[];
  /** Window glass: dark by day, lamp-lit on the night sets. */
  glass: number;
  /** Night-native set: windows glow and the walls sit back in the dark. */
  night: boolean;
}

/** "#rrggbb" or "r,g,b" (the IslamicTiles formats) as a hex number. */
function paletteHex(c: string): number {
  if (c.startsWith("#")) return parseInt(c.slice(1), 16);
  const [r, g, b] = c.split(",").map((v) => Math.round(+v) & 255);
  return (r << 16) | (g << 8) | b;
}

const MIX_A = new THREE.Color();
const MIX_B = new THREE.Color();
const mixHex = (a: number, b: number, t: number): number => MIX_A.set(a).lerp(MIX_B.set(b), t).getHex();

/** How far the town's limewash lifts the court plaster toward cream. */
const TOWN_LIFT = 0.65;
/** Night sets: walls sit back in the dark (lamp-lit windows carry them). */
const NIGHT_WALL = 0.56;

/** Kasbah earth for the snowbound Atlas: whitewash would vanish into the snow. */
const KASBAH = [0xc98a5c, 0xb87a52, 0xd59c6e];

/**
 * The town's palette for `look`: walls from the look's court plaster warmed
 * toward its lane sand (three tones), trim from its worn lane, and on the
 * night sets dimmed walls with lamp-lit windows, so no house reads as a
 * bright placeholder cube on a dark apron.
 */
export function townPalette(look: ArenaLook): TownPalette {
  const t = look.islamic;
  const plaster = t ? paletteHex(t.plaster) : 0xf0e6d0;
  const lane = t ? paletteHex(t.lane) : 0xd6b25e;
  const wear = t ? paletteHex(t.laneWear) : 0xa07c3a;
  const snow = look.ambient === "snow";
  const night = look.nightPools;
  // The court's plaster is a mid value now (calm floor, loud actors); the
  // town's limewash lifts it back toward cream, in four tints toward the
  // lane sand, so the houses stand off the apron and differ from each other.
  const limewash = mixHex(plaster, 0xf2e8d4, TOWN_LIFT);
  let walls = snow ? KASBAH : [0.04, 0.14, 0.24, 0.34].map((k) => mixHex(limewash, lane, k));
  if (night) walls = walls.map((c) => tone(c, NIGHT_WALL, 0.8));
  const trim = tone(mixHex(wear, plaster, snow ? 0.1 : 0.35), night ? 0.5 : 1);
  return {
    walls,
    trim,
    roof: snow ? 0xf4f8fc : tone(walls[1], 0.88),
    doors: [0x1f6f9b, 0x1a8a84, 0x3f7a3a, 0x8a3428, 0x5a3a24].map((c) => (night ? tone(c, 0.55) : c)),
    glass: night ? 0xffc46b : 0x2a3a5a,
    night,
  };
}

/** A house footprint in the town (centre and half extents, world units). */
export interface TownLot {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/** Gap kept between neighbouring houses. */
export const LOT_GAP = 0.3;

/**
 * Lay out one side's town (sx = -1 left, 1 right): up to `count` house lots
 * between the lantern street outside the galleries and the far edge, none
 * overlapping another, none on the canal that runs through.
 */
export function townLots(sx: number, rand: () => number, count = 15): TownLot[] {
  const lots: TownLot[] = [];
  for (let tries = 0; tries < 80 && lots.length < count; tries++) {
    const k = 0.9 + rand() * 0.5;
    const hw = (0.6 + rand() * 0.4) * k;
    const hd = (0.55 + rand() * 0.3) * k;
    const lot = { x: sx * (GAL_X + GAL_DEPTH + 1.9 + hw + rand() * 6.5), z: (rand() - 0.5) * 38, hw, hd };
    if (Math.abs(lot.z) < 1.8 + hd) continue;
    const clear = lots.every(
      (o) => Math.abs(o.x - lot.x) >= o.hw + lot.hw + LOT_GAP || Math.abs(o.z - lot.z) >= o.hd + lot.hd + LOT_GAP,
    );
    if (clear) lots.push(lot);
  }
  return lots;
}

/** Door awnings: saffron, teal, green and plum stripes with cream (never a team colour off the court). */
const AWNINGS = [0xd99a2b, 0x1a8a84, 0x3f7a3a, 0x7a4a7a];

/** A small arched window on a south face, with a sill. */
function archWindow(s: Sculpt, trim: Sculpt, x: number, y: number, z: number, w: number, h: number, glass: number, sill: number): void {
  s.box(w, h, 0.02, glass, x, y, z, 0, () => 1);
  s.add(new THREE.CircleGeometry(w / 2, 8, 0, Math.PI), glass, x, y + h / 2, z, 0, () => 1);
  trim.box(w + 0.07, 0.035, 0.05, sill, x, y - h / 2 - 0.01, z + 0.01, 0, lit);
}

/**
 * A flat-roof house in the look's plaster: a roof lip and a low parapet round
 * the deck, sometimes a set-back upper storey or a dome, an arched door and a
 * pair of arched windows on its south face (lamp-lit on the night sets).
 */
function house(s: Sculpt, glow: Sculpt, lot: TownLot, pal: TownPalette, look: ArenaLook, rand: () => number): void {
  const { x, z } = lot;
  const w = lot.hw * 2;
  const d = lot.hd * 2;
  const k = Math.min(w / 1.6, 1.4);
  const h = (0.95 + rand() * 0.8) * k;
  const wall = pal.walls[Math.floor(rand() * pal.walls.length)];
  const wallLt = tone(wall, 1.05);
  s.box(w, h, d, wall, x, h / 2 - 0.05, z, 0, ao);
  // The roof: a projecting lip, then a low parapet round a sunken deck.
  s.box(w + 0.12, 0.08, d + 0.12, pal.trim, x, h, z, 0, lit);
  const ph = 0.15;
  const pt = 0.09;
  for (const sz of [-1, 1]) s.box(w + 0.04, ph, pt, wallLt, x, h + 0.04 + ph / 2, z + sz * (d / 2 - pt / 2 + 0.02), 0, lit);
  for (const sxx of [-1, 1]) s.box(pt, ph, d - 0.14, wallLt, x + sxx * (w / 2 - pt / 2 + 0.02), h + 0.04 + ph / 2, z, 0, lit);
  s.box(w - 0.14, 0.02, d - 0.14, pal.roof, x, h + 0.06, z, 0, lit);
  const roll = rand();
  if (w > 1.5 && roll < 0.35) {
    // A set-back upper storey with its own lip.
    const uw = w * 0.48;
    const ud = d * 0.5;
    const uh = h * 0.45;
    const ux = x + (rand() < 0.5 ? -1 : 1) * (w - uw) * 0.3;
    const uz = z - d * 0.2;
    s.box(uw, uh, ud, wall, ux, h + uh / 2, uz, 0, lit);
    s.box(uw + 0.1, 0.07, ud + 0.1, pal.trim, ux, h + uh, uz, 0, lit);
    archWindow(pal.night ? glow : s, s, ux, h + uh * 0.5, uz + ud / 2 + 0.012, 0.14 * k, 0.16 * k, pal.glass, pal.trim);
  } else if (roll < 0.75) {
    const r = Math.min(w, d) * 0.3;
    const dome = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    s.add(dome, rand() < 0.5 ? THEME.turquoise : tone(look.islamic?.dome ?? THEME.teal, 1.05), x, h + 0.06, z, 0, lit);
    s.add(new THREE.SphereGeometry(0.06 * k, 6, 4), THEME.gold, x, h + r + 0.08, z);
  }
  // An arched door, framed in trim, and a pair of arched windows beside it.
  const south = z + d / 2;
  const doorX = x + (rand() < 0.5 ? -1 : 1) * w * 0.18;
  horseshoe(s, doorX, 0.4 * k, south, 0.19 * k, pal.trim, pal.doors[Math.floor(rand() * pal.doors.length)]);
  if (rand() < 0.55) {
    // A striped cloth awning over the door, on two thin rods.
    const stripe = AWNINGS[Math.floor(rand() * AWNINGS.length)];
    const aw = 0.62 * k;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(aw / n, 0.03, 0.42 * k);
      g.rotateX(0.42);
      const c = i % 2 ? 0xf3ead6 : stripe;
      s.add(g, pal.night ? tone(c, 0.6) : c, doorX - aw / 2 + (i + 0.5) * (aw / n), 0.78 * k, south + 0.18 * k, 0, lit);
    }
  } else if (roll >= 0.75 && w > 1.1) {
    // Rooftop clutter on a plain flat roof: a stair hut and a water jar.
    s.box(0.36 * k, 0.32 * k, 0.36 * k, wall, x - w * 0.22, h + 0.2 * k, z - d * 0.15, 0, lit);
    s.cyl(0.09 * k, 0.12 * k, 0.24 * k, 0xa0603a, x + w * 0.25, h + 0.16 * k, z + d * 0.1, 8, lit);
  }
  const wx = x + (doorX < x ? 1 : -1) * w * 0.2;
  const wy = Math.max(0.62 * k, h * 0.62);
  for (const dx of [-0.16, 0.16]) {
    archWindow(pal.night ? glow : s, s, wx + dx * k, wy, south + 0.012, 0.15 * k, 0.22 * k, pal.glass, pal.trim);
  }
}

/** A street lantern: a bronze post with a bracket and a hanging lamp (its core in the glow mesh). */
function streetLantern(s: Sculpt, glow: Sculpt, x: number, z: number, toward: number, color: number): void {
  const bronze = 0x3a2a1c;
  s.cyl(0.055, 0.08, 1.9, bronze, x, 0.9, z, 6);
  s.box(0.11, 0.08, 0.11, THEME.gold, x, 1.86, z, 0, lit);
  s.box(0.44, 0.045, 0.045, bronze, x + toward * 0.2, 1.8, z, 0, lit);
  const lx = x + toward * 0.38;
  s.add(new THREE.ConeGeometry(0.16, 0.17, 6), THEME.gold, lx, 1.68, z, 0, lit);
  glow.add(new THREE.CylinderGeometry(0.12, 0.1, 0.28, 6), color, lx, 1.47, z);
  s.add(new THREE.ConeGeometry(0.11, 0.11, 6).rotateX(Math.PI), THEME.gold, lx, 1.28, z, 0, lit);
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

/**
 * Build the Golden Age surround into `parent`; returns the gallery crowd
 * seats. `glow` makes the dimmable glow material for the lantern cores and
 * the lamp-lit windows (without it they are sculpted lit).
 */
export function buildGoldenSurround(parent: THREE.Object3D, look: ArenaLook, glow?: (color: number) => THREE.Material): CrowdSeat[] {
  const s = new Sculpt(lit);
  // Per side, so a portrait phone culls them whole: the houses and street
  // lanterns are the outer ring (hidden below L2), the palms the fallback
  // that always stays.
  const town = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const lamps = { [-1]: new Sculpt(() => 1), [1]: new Sculpt(() => 1) } as Record<number, Sculpt>;
  const palms = { [-1]: new Sculpt(lit), [1]: new Sculpt(lit) } as Record<number, Sculpt>;
  const rand = mulberry(31337);
  const seats: CrowdSeat[] = [];
  const hd = ARENA_HEIGHT / 2;
  const len = hd - 4.6;
  const pal = townPalette(look);
  const lampColors = look.lanterns ?? [0xffc46b];
  for (const sx of [-1, 1]) {
    gallery(s, sx, -hd / 2 - 1.1, len, "enemy", look, seats, rand);
    gallery(s, sx, hd / 2 + 1.1, len, "player", look, seats, rand);
    // Souk stalls by the gallery ends, near the river.
    for (const sz of [-1, 1]) contactShadow(s, sx * (GAL_X + 1), sz * 2.6, 0.9, 0.55, look.apron, 1.3);
    stall(s, sx * (GAL_X + 1), -2.6, "enemy", rand);
    stall(s, sx * (GAL_X + 1), 2.6, "player", rand);
    // The ground first: a packed-earth street along the galleries, alleys
    // out to the edge, and broad soft patches, so the town is not one flat plane.
    const streetX = sx * (GAL_X + GAL_DEPTH + 0.95);
    const street = tone(look.apron, 0.86, 0.85);
    town[sx].box(1.5, 0.02, 40, street, streetX, -0.05, 0, 0, () => 1);
    for (const az of [-12.5, -6.8, 6.8, 12.5]) {
      town[sx].box(9.5, 0.02, 0.9, street, sx * (GAL_X + GAL_DEPTH + 5.6), -0.051, az, 0, () => 1);
    }
    for (let i = 0; i < 10; i++) {
      const g = new THREE.CircleGeometry(1, 14);
      g.rotateX(-Math.PI / 2);
      g.scale(1.4 + rand() * 2.2, 1, 1 + rand() * 1.6);
      town[sx].add(g, tone(look.apron, rand() < 0.5 ? 0.9 : 1.08), sx * (GAL_X + GAL_DEPTH + 2 + rand() * 9), -0.054, (rand() - 0.5) * 40, rand() * 3, () => 1);
    }
    // The town edge beyond: houses that never overlap, then palms between them.
    const glowTo = glow ? lamps[sx] : town[sx];
    const lots = townLots(sx, mulberry(7919 + sx));
    for (const lot of lots) {
      contactShadow(town[sx], lot.x, lot.z, lot.hw * 1.12 + 0.2, lot.hd * 1.12 + 0.2, look.apron, 1.4);
      house(town[sx], glowTo, lot, pal, look, rand);
    }
    // Street lanterns along the lane between the galleries and the houses.
    [-15.5, -10, -4.6, 4.6, 10, 15.5].forEach((z, i) => streetLantern(town[sx], glowTo, streetX, z, -sx, lampColors[i % lampColors.length]));
    for (let i = 0; i < 12; i++) {
      const x = sx * (GAL_X + GAL_DEPTH + 0.8 + rand() * 7.5);
      const z = (rand() - 0.5) * 38;
      const k = 0.9 + rand() * 0.5;
      if (Math.abs(z) < 1.6) continue;
      if (Math.abs(x - streetX) < 0.5) continue;
      if (lots.some((o) => Math.abs(o.x - x) < o.hw + 0.3 && Math.abs(o.z - z) < o.hd + 0.3)) continue;
      contactShadow(palms[sx], x, z, 0.62 * k, 0.5 * k, look.apron, 2 * k);
      if (look.tree.kind === "palm") palm(palms[sx], x, z, k, look, rand);
      else cypress(palms[sx], x, z, k, look);
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
    if (glow) {
      const mat = glow(0xffffff);
      (mat as THREE.MeshBasicMaterial).vertexColors = true;
      const m = lamps[sx].mesh(mat, "golden-town-lamps");
      if (m) {
        m.castShadow = m.receiveShadow = false;
        m.userData.dressing = "outer";
        parent.add(m);
      }
    }
  }
  return seats;
}
