/**
 * The painted playfield. A DOM-free pixel painter (pure JS, so it is
 * deterministic, byte-identical run to run and testable in node) that
 * lays down, per arena look:
 *
 *  - turf or flagstone: two-scale seeded colour noise, mown stripes and
 *    grass strokes, with the classic checker kept at ~30% so the court
 *    still reads as tiles without looking like a bathroom floor;
 *  - feathered dirt lanes with wheel ruts and pebbles along their edges
 *    (classic), or opaque Islamic lane strips with gold borders;
 *  - the Islamic zellige (eight-point khatam stars and diamonds) at
 *    48 px per tile with a glazed sheen;
 *  - look-specific scatter (confetti, pebbles, bones, embers, snow...);
 *  - baked ambient occlusion under all six tower footprints, at the bridge
 *    ends, along the river lips and where the court meets its walls.
 *
 * Images are cached per look id (a small LRU), so the home diorama and
 * the battle that follows share one paint.
 */
import * as THREE from "three";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_XS,
  RIVER_HALF_WIDTH,
  RIVER_Y,
  towerSpots,
} from "../../../game/arena";
import { stagePalette, type ArenaLook } from "../../arenaLooks";

/** Pixels per arena tile, both editions. */
export const GROUND_PX = 48;

/** Tower platform half-extents on the floor (tiles), matching views/towers.ts at its 1.1 scale. */
export const TOWER_FOOTPRINT = { princess: 1.52, king: 2.04 } as const;

/** Bridge decks reach this far (tiles) either side of the river centre. */
export const BRIDGE_REACH = 1.3;

/** An RGBA image; row 0 is arena y = 0 (the enemy back line). */
export interface GroundImage {
  width: number;
  height: number;
  pxPerUnit: number;
  data: Uint8Array;
}

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/** Parse "#rrggbb", "rgb(...)", "rgba(...)" or a bare "r,g,b" into 0..1 RGBA. */
export function parseColor(s: string): RGBA {
  const t = s.trim();
  if (t.startsWith("#")) {
    const n = parseInt(t.slice(1, 7), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const inner = t.includes("(") ? t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")) : t;
  const p = inner.split(",").map((v) => Number(v.trim()));
  return [(p[0] ?? 0) / 255, (p[1] ?? 0) / 255, (p[2] ?? 0) / 255, p.length > 3 ? p[3] : 1];
}

/** FNV-1a over a string: the look's paint seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a over the pixels, as 8 hex digits (for tests and debugging). */
export function imageHash(img: GroundImage): string {
  let h = 0x811c9dc5;
  const d = img.data;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Relative luminance (0..1) of the pixel under arena point (ax, ay). */
export function luminanceAt(img: GroundImage, ax: number, ay: number): number {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor(ax * img.pxPerUnit)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor(ay * img.pxPerUnit)));
  const i = (y * img.width + x) * 4;
  return (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
}

/** Seeded uniform PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Value noise pre-sampled every `step` pixels and read back bilinearly:
 * the per-pixel loops then cost a few multiplies instead of four hashes.
 */
class NoiseField {
  private readonly gw: number;
  private readonly v: Float32Array;
  constructor(w: number, h: number, private readonly step: number, P: number, scale: number, seed: number) {
    this.gw = Math.ceil(w / step) + 2;
    const gh = Math.ceil(h / step) + 2;
    this.v = new Float32Array(this.gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < this.gw; gx++) {
        this.v[gy * this.gw + gx] = vnoise((gx * step) / P / scale, (gy * step) / P / scale, seed);
      }
    }
  }

  at(x: number, y: number): number {
    const fx = x / this.step;
    const fy = y / this.step;
    const ix = fx | 0;
    const iy = fy | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const i = iy * this.gw + ix;
    const v = this.v;
    const a = v[i] + (v[i + 1] - v[i]) * tx;
    const b = v[i + this.gw] + (v[i + this.gw + 1] - v[i + this.gw]) * tx;
    return a + (b - a) * ty;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hsl(c: RGB): { h: number; s: number; l: number } {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

/**
 * A float RGB canvas with the handful of anti-aliased primitives the floor
 * needs. Coordinates are pixels; every shape is drawn through a signed
 * distance function over its bounding box.
 */
class Paint {
  readonly buf: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.buf = new Float32Array(w * h * 3);
  }

  blend(i: number, c: RGB | RGBA, a: number): void {
    const k = i * 3;
    const b = this.buf;
    b[k] += (c[0] - b[k]) * a;
    b[k + 1] += (c[1] - b[k + 1]) * a;
    b[k + 2] += (c[2] - b[k + 2]) * a;
  }

  scale(i: number, f: number): void {
    const k = i * 3;
    this.buf[k] *= f;
    this.buf[k + 1] *= f;
    this.buf[k + 2] *= f;
  }

  /** Fill where `sdf(x, y) < 0` (px), 1 px anti-aliased, at `alpha`. */
  shape(
    x0: number, y0: number, x1: number, y1: number,
    sdf: (x: number, y: number) => number,
    c: RGB | RGBA, alpha: number, soft = 1,
  ): void {
    const xa = Math.max(0, Math.floor(x0));
    const ya = Math.max(0, Math.floor(y0));
    const xb = Math.min(this.w - 1, Math.ceil(x1));
    const yb = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = sdf(x + 0.5, y + 0.5);
        if (d >= soft * 0.5) continue;
        const cov = Math.min(1, 0.5 - d / soft);
        this.blend(y * this.w + x, c, cov * alpha);
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB | RGBA, alpha: number, squash = 1, rot = 0): void {
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const pad = r + 1;
    this.shape(cx - pad, cy - pad, cx + pad, cy + pad, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cs + dy * sn;
      const v = (-dx * sn + dy * cs) / squash;
      return Math.sqrt(u * u + v * v) - r;
    }, c, alpha);
  }

  rect(cx: number, cy: number, hw: number, hh: number, rot: number, c: RGB | RGBA, alpha: number): void {
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const pad = Math.max(hw, hh) + 1;
    this.shape(cx - pad, cy - pad, cx + pad, cy + pad, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const u = Math.abs(dx * cs + dy * sn) - hw;
      const v = Math.abs(-dx * sn + dy * cs) - hh;
      return Math.max(u, v);
    }, c, alpha);
  }

  /** A round-capped stroke from (ax, ay) to (bx, by). */
  line(ax: number, ay: number, bx: number, by: number, hw: number, c: RGB | RGBA, alpha: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    this.shape(
      Math.min(ax, bx) - hw - 1, Math.min(ay, by) - hw - 1,
      Math.max(ax, bx) + hw + 1, Math.max(ay, by) + hw + 1,
      (x, y) => {
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
        const ex = x - ax - dx * t;
        const ey = y - ay - dy * t;
        return Math.sqrt(ex * ex + ey * ey) - hw;
      },
      c, alpha,
    );
  }

  toImage(pxPerUnit: number): GroundImage {
    const n = this.w * this.h;
    // A clamped view rounds and clamps on store; hand out a plain byte view.
    const out = new Uint8ClampedArray(n * 4);
    const b = this.buf;
    for (let i = 0, k = 0, j = 0; i < n; i++, k += 3, j += 4) {
      out[j] = b[k] * 255;
      out[j + 1] = b[k + 1] * 255;
      out[j + 2] = b[k + 2] * 255;
      out[j + 3] = 255;
    }
    return { width: this.w, height: this.h, pxPerUnit, data: new Uint8Array(out.buffer) };
  }
}

const mix3 = (a: RGB | RGBA, b: RGB | RGBA, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const mul3 = (a: RGB | RGBA, f: number): RGB => [a[0] * f, a[1] * f, a[2] * f];

/** Two 0xRRGGBB colours mixed `t` of the way from `a` to `b`. */
function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Classic lanes: centre segments in tiles (bridge columns plus the tower rows). */
const ROW_Y = [6.5, ARENA_HEIGHT - 6.5] as const;
const LANE_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [BRIDGE_XS[0], ROW_Y[0], BRIDGE_XS[0], ROW_Y[1]],
  [BRIDGE_XS[1], ROW_Y[0], BRIDGE_XS[1], ROW_Y[1]],
  [BRIDGE_XS[0], ROW_Y[0], BRIDGE_XS[1], ROW_Y[0]],
  [BRIDGE_XS[0], ROW_Y[1], BRIDGE_XS[1], ROW_Y[1]],
];
/** Lane half-width (tiles). */
const LANE_HW = 0.85;

function segDist(px: number, py: number, s: readonly [number, number, number, number]): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((px - s[0]) * dx + (py - s[1]) * dy) / len2));
  const ex = px - s[0] - dx * t;
  const ey = py - s[1] - dy * t;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Distance (tiles) from arena point (ax, ay) to the nearest classic lane centre line. */
function laneDist(ax: number, ay: number): number {
  let d = Infinity;
  for (const s of LANE_SEGMENTS) d = Math.min(d, segDist(ax, ay, s));
  return d;
}

/** True where scatter (flowers, clover, puddles, planks, tufts) may go: clear of lanes, towers, river and kerb. */
export function openTurf(ax: number, ay: number, margin = 0.6): boolean {
  if (ax < 0.7 || ay < 0.7 || ax > ARENA_WIDTH - 0.7 || ay > ARENA_HEIGHT - 0.7) return false;
  if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + 0.9) return false;
  if (laneDist(ax, ay) < LANE_HW + margin) return false;
  for (const side of ["player", "enemy"] as const) {
    for (const t of towerSpots(side)) {
      const half = TOWER_FOOTPRINT[t.kind] + APRON + 0.25;
      if (Math.abs(ax - t.x) < half && Math.abs(ay - t.y) < half) return false;
    }
  }
  return true;
}

/**
 * Per-look floor recipes (art bible section 3). Every recipe is a calm base
 * (no checker, low-contrast value noise) plus its own texture and scatter;
 * the lanes, aprons, banks and occlusion are shared.
 */
export type FloorRecipe =
  | "lawn" | "moss" | "sand" | "snow" | "basalt" | "violet" | "earth" | "royal" | "icesheet" | "jungle" | "tiles";

export const FLOOR_RECIPES: Readonly<Record<string, FloorRecipe>> = {
  meadow: "lawn",
  swamp: "moss",
  bone: "sand",
  snow: "snow",
  forge: "basalt",
  mystic: "violet",
  workshop: "earth",
  royal: "royal",
  ice: "icesheet",
  jungle: "jungle",
  neon: "tiles",
};

/** The look's classic floor recipe (unknown looks fall back by their colour). */
export function floorRecipe(look: ArenaLook): FloorRecipe {
  const r = FLOOR_RECIPES[look.id];
  if (r) return r;
  const t = hsl(mix3(parseColor(look.floor.a), parseColor(look.floor.b), 0.5));
  return t.h > 0.17 && t.h < 0.45 && t.s > 0.22 ? "lawn" : "earth";
}

/** Recipes painted as mown grass (stripes, blades); these also grow 3D tufts. */
export const GRASSY: ReadonlySet<FloorRecipe> = new Set<FloorRecipe>(["lawn", "royal", "jungle", "moss", "violet"]);

/** Flagstone aprons reach this far (tiles) past each tower platform. */
export const APRON = 0.62;

// Voronoi scratch (no per-pixel allocation): nearest distance, edge gap, cell hash.
let vorD1 = 0;
let vorEdge = 0;
let vorId = 0;

/** Jittered-grid Voronoi at (x, y) in cell units: fills vorD1, vorEdge (0 on a seam) and vorId. */
function voronoi(x: number, y: number, seed: number): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const px = cx + 0.15 + 0.7 * hash2(cx, cy, seed);
      const py = cy + 0.15 + 0.7 * hash2(cx, cy, seed + 1);
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(cx, cy, seed + 2);
      } else if (d < d2) d2 = d;
    }
  }
  vorD1 = Math.sqrt(d1);
  vorEdge = Math.sqrt(d2) - vorD1;
  vorId = id;
}

function paintClassic(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const F = look.floor;
  const A = parseColor(F.a);
  const B = parseColor(F.b);
  const mid = mix3(A, B, 0.5);
  const recipe = floorRecipe(look);
  const grassy = GRASSY.has(recipe);
  const { w, h } = p;
  const buf = p.buf;

  // 1) The calm base: 2-tile mow stripes at +-3% (grass), an 8-tile value
  // noise at +-4%, a softer 2-tile patchiness, a fine grain and a gentle
  // warm/cool drift. No checker: the eye should land on the units.
  const bigF = new NoiseField(w, h, 8, P, 8, seed);
  const midF = new NoiseField(w, h, 4, P, 2.2, seed + 5);
  const grainF = new NoiseField(w, h, 2, P, 0.3, seed + 7);
  const hueF = new NoiseField(w, h, 8, P, 5.5, seed + 3);
  const reliefF = recipe === "snow" || recipe === "sand" ? new NoiseField(w, h, 4, P, 2.6, seed + 61) : null;
  const plateCell = recipe === "basalt" ? 1.55 : recipe === "icesheet" ? 2.3 : 0;
  // Neutral seam light (never a team colour on the floor).
  const glowSeam: RGB = [0.72, 0.86, 1];
  const ember: RGB = [1, 0.48, 0.2];
  for (let y = 0; y < h; y++) {
    const ay = (y + 0.5) / P;
    const sy = ay / 2;
    const sf = sy - Math.floor(sy);
    const stripe = grassy && recipe !== "moss" && recipe !== "violet"
      ? 1 + (Math.floor(sy) % 2 === 0 ? 0.03 : -0.03) * smoothstep(0, 0.08, Math.min(sf, 1 - sf))
      : 1;
    for (let x = 0; x < w; x++) {
      const ax = (x + 0.5) / P;
      const dEdge = Math.min(ax, ARENA_WIDTH - ax, ay, ARENA_HEIGHT - ay);
      const border = 0.95 + 0.05 * smoothstep(0, 2.5, dEdge);
      let f = stripe * border
        * (1 + (bigF.at(x, y) - 0.5) * 0.08)
        * (1 + (midF.at(x, y) - 0.5) * 0.05)
        * (1 + (grainF.at(x, y) - 0.5) * (grassy ? 0.05 : 0.04));
      const hueN = hueF.at(x, y) - 0.5;
      let r = mid[0] * (1 + hueN * 0.05);
      let g = mid[1];
      let b = mid[2] * (1 - hueN * 0.06);
      if (reliefF) {
        // Lit-from-the-upper-left relief: drifts (snow) or wind ripples (sand).
        const here = reliefF.at(x, y);
        const back = reliefF.at(Math.max(0, x - 6), Math.max(0, y - 6));
        const slope = here - back;
        if (recipe === "snow") {
          f *= 1 + slope * 0.5 + (here - 0.5) * 0.05;
          b *= 1 + Math.max(0, -slope) * 0.25; // drift shadows lean blue
        } else {
          const ripple = Math.sin(ay * 5.2 + ax * 1.3 + here * 9);
          f *= 1 + ripple * 0.018 + slope * 0.2;
        }
      }
      if (plateCell > 0) {
        voronoi(ax / plateCell, ay / plateCell, seed + 71);
        const seam = 1 - smoothstep(0.03, 0.09, vorEdge);
        if (recipe === "basalt") {
          f *= (0.95 + vorId * 0.1) * (1 - 0.3 * seam);
          // Some plates' seams smoulder (colour only: the floor never blooms).
          const hot = hash2(Math.floor(vorId * 997), 3, seed) < 0.35 ? 1 - smoothstep(0.0, 0.045, vorEdge) : 0;
          if (hot > 0) {
            const k = 0.55 * hot;
            r += (ember[0] - r) * k;
            g += (ember[1] - g) * k;
            b += (ember[2] - b) * k;
          }
        } else {
          // Ice: pale cracks with a dark lower lip.
          const crack = 1 - smoothstep(0.0, 0.035, vorEdge);
          f *= 1 + 0.12 * crack - 0.05 * (1 - smoothstep(0.035, 0.08, vorEdge)) * (1 - crack);
          f *= 0.985 + vorId * 0.03;
        }
      }
      if (recipe === "tiles") {
        // Large pale tiles (2x2 board tiles) with fine grout and glowing seams.
        const tx = ax / 2;
        const ty = ay / 2;
        const gx = Math.min(tx - Math.floor(tx), Math.ceil(tx) - tx) * 2;
        const gy = Math.min(ty - Math.floor(ty), Math.ceil(ty) - ty) * 2;
        const gd = Math.min(gx, gy);
        f *= 0.99 + hash2(Math.floor(tx), Math.floor(ty), seed + 13) * 0.02;
        if (gd < 0.05) {
          const k = (1 - gd / 0.05) * 0.28;
          r += (glowSeam[0] - r) * k;
          g += (glowSeam[1] - g) * k;
          b += (glowSeam[2] - b) * k;
        } else if (gd < 0.075) f *= 0.975;
      }
      const k = (y * w + x) * 3;
      buf[k] = r * f;
      buf[k + 1] = g * f;
      buf[k + 2] = b * f;
    }
  }

  // 2) Recipe texture: soft clumps and blades on grass, moss and patches.
  if (grassy) {
    const light = mix3(mid, [1, 1, 0.7], 0.16);
    const dark = mix3(mul3(mid, 0.78), [0.1, 0.4, 0.3], 0.2);
    const clumps = Math.round((w * h) / 3200);
    for (let i = 0; i < clumps; i++) {
      const r = (0.25 + rand() * 0.45) * P;
      p.disc(rand() * w, rand() * h, r, rand() < 0.4 ? dark : light, 0.025 + rand() * 0.03, 0.55 + rand() * 0.3, rand() * 3);
    }
    const blades = Math.round((w * h) / 700);
    for (let i = 0; i < blades; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const len = (2.5 + rand() * 3) * (P / 48);
      const ang = (rand() - 0.5) * 0.9;
      p.line(x, y, x + Math.sin(ang) * len, y - Math.cos(ang) * len, 0.55 * (P / 48), rand() < 0.45 ? dark : light, 0.12 + rand() * 0.12);
    }
  }
  if (recipe === "moss" || recipe === "violet") {
    // Moss cushions: soft irregular darker and yellower patches.
    const moss = recipe === "moss" ? mix3(mul3(mid, 0.85), [0.45, 0.5, 0.15], 0.25) : mix3(mul3(mid, 0.85), [0.35, 0.2, 0.55], 0.3);
    for (let i = 0; i < 70; i++) {
      const cx = rand() * w;
      const cy = rand() * h;
      for (let k = 0; k < 4; k++) {
        p.disc(cx + (rand() - 0.5) * P, cy + (rand() - 0.5) * P * 0.7, (0.3 + rand() * 0.35) * P, moss, 0.12, 0.7, rand() * 3);
      }
    }
  }

  // 3) Optional crown watermark, halved: a hint, never a target.
  if (F.watermark) {
    const wm = parseColor(F.watermark);
    const wa = wm[3] * 0.5;
    for (const cy of [h * 0.25, h * 0.75]) {
      const cx = w / 2;
      const R = 3.2 * P;
      const lw = 3.5 * (P / 32);
      p.shape(cx - R - lw - 1, cy - R - lw - 1, cx + R + lw + 1, cy + R + lw + 1, (x, y) => {
        return Math.abs(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - R) - lw;
      }, wm, wa);
      const cw = R * 0.95;
      const ch = R * 0.7;
      const pts: Array<[number, number]> = [
        [cx - cw / 2, cy + ch * 0.4], [cx - cw / 2, cy - ch * 0.25], [cx - cw / 6, cy + ch * 0.05],
        [cx, cy - ch * 0.55], [cx + cw / 6, cy + ch * 0.05], [cx + cw / 2, cy - ch * 0.25],
        [cx + cw / 2, cy + ch * 0.4], [cx - cw / 2, cy + ch * 0.4],
      ];
      const sw = 3 * (P / 32);
      for (let i = 0; i + 1 < pts.length; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], sw, wm, wa);
    }
  }

  // 4) Look scatter on the open turf (never on lanes, aprons or banks).
  const spots = (n: number, margin: number, each: (x: number, y: number) => void): void => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 8; tries++) {
      const ax = rand() * ARENA_WIDTH;
      const ay = rand() * ARENA_HEIGHT;
      if (!openTurf(ax, ay, margin)) continue;
      each(ax * P, ay * P);
      placed++;
    }
  };
  const s = P / 48;
  const flowerBed = (count: number, petals: RGB[]): void => {
    spots(count, 0.7, (cx, cy) => {
      const c = petals[Math.floor(rand() * petals.length)];
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const x = cx + (rand() - 0.5) * 18 * s;
        const y = cy + (rand() - 0.5) * 12 * s;
        p.disc(x + 0.8 * s, y + 1.1 * s, 2.3 * s, [0.1, 0.25, 0.1], 0.25);
        p.disc(x, y, 2.0 * s, c, 0.92);
        p.disc(x, y, 0.8 * s, [0.98, 0.72, 0.22], 0.9);
      }
    });
  };
  const clover = (count: number): void => {
    const leaf = mix3(mul3(mid, 0.8), [0.15, 0.45, 0.2], 0.3);
    spots(count, 0.6, (cx, cy) => {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rand();
        p.disc(cx + Math.cos(a) * 2.2 * s, cy + Math.sin(a) * 2.2 * s, 2.3 * s, leaf, 0.55);
      }
    });
  };
  switch (recipe) {
    case "lawn":
      clover(70);
      flowerBed(34, [[1, 1, 1], [1, 0.93, 0.45], [1, 0.74, 0.84], [0.82, 0.86, 1]]);
      break;
    case "royal":
      clover(30);
      flowerBed(26, [[1, 1, 1], [1, 0.88, 0.4], [1, 0.7, 0.75]]);
      break;
    case "jungle": {
      const litter: RGB[] = [[0.55, 0.45, 0.18], [0.42, 0.5, 0.16], [0.62, 0.52, 0.22], [0.3, 0.42, 0.14]];
      spots(260, 0.35, (x, y) => {
        const c = litter[Math.floor(rand() * litter.length)];
        p.disc(x, y, (2.6 + rand() * 1.8) * s, c, 0.55, 0.42, rand() * Math.PI);
      });
      flowerBed(12, [[1, 0.5, 0.35], [1, 0.85, 0.3]]);
      break;
    }
    case "moss": {
      // Puddles: dark still water with a sky glint and a damp rim.
      const water = mix3(mul3(mid, 0.45), [0.12, 0.28, 0.3], 0.55);
      spots(9, 1.0, (x, y) => {
        const r = (0.38 + rand() * 0.3) * P;
        const rot = rand() * 3;
        p.disc(x, y, r * 1.18, mul3(mid, 0.78), 0.55, 0.55, rot);
        p.disc(x, y, r, water, 0.85, 0.55, rot);
        p.disc(x - r * 0.25, y - r * 0.12, r * 0.35, [0.62, 0.75, 0.7], 0.35, 0.3, rot);
      });
      const cols = (F.scatter === "pebbles" ? ["#8a8468", "#6f6a52"] : ["#7a7a5a"]).map(parseColor);
      spots(110, 0.3, (x, y) => p.disc(x, y, (1.2 + rand() * 1.6) * s, cols[Math.floor(rand() * cols.length)], 0.5, 0.75, rand() * 3));
      break;
    }
    case "violet":
      spots(70, 0.4, (cx, cy) => {
        const rot = rand() * Math.PI;
        const c = parseColor(rand() < 0.5 ? "#e2d4ff" : "#b89aff");
        const r = (2.4 + rand() * 2.2) * s;
        const cs = Math.cos(rot);
        const sn = Math.sin(rot);
        p.shape(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
          const u = Math.abs((x - cx) * cs + (y - cy) * sn);
          const v = Math.abs(-(x - cx) * sn + (y - cy) * cs);
          return (u / (r * 0.45) + v / r - 1) * r * 0.45;
        }, c, 0.75);
      });
      break;
    case "sand":
      // Bleached bones, sparse and small.
      spots(34, 0.4, (x, y) => {
        const rot = rand() * Math.PI;
        const len = (5 + rand() * 4) * s;
        const dx = Math.cos(rot) * len;
        const dy = Math.sin(rot) * len;
        const c: RGB = [0.95, 0.91, 0.82];
        p.line(x - dx, y - dy, x + dx, y + dy, 1.3 * s, mul3(c, 0.7), 0.25);
        p.line(x - dx, y - dy, x + dx, y + dy, 1.1 * s, c, 0.85);
        for (const e of [-1, 1]) p.disc(x + e * dx, y + e * dy, 1.9 * s, c, 0.9);
      });
      spots(90, 0.3, (x, y) => p.disc(x, y, (1 + rand() * 1.6) * s, rand() < 0.5 ? [0.62, 0.55, 0.42] : [0.78, 0.72, 0.6], 0.5, 0.75, rand() * 3));
      break;
    case "snow":
      // Sparkle: tiny bright flecks with a cool shadow fleck beside some.
      for (let i = 0; i < 520; i++) {
        const x = rand() * w;
        const y = rand() * h;
        p.disc(x, y, (0.7 + rand() * 0.9) * s, rand() < 0.75 ? [1, 1, 1] : [0.82, 0.9, 1], 0.6 + rand() * 0.35);
      }
      break;
    case "basalt":
      for (let i = 0; i < 140; i++) p.disc(rand() * w, rand() * h, (0.8 + rand() * 1.2) * s, rand() < 0.5 ? [1, 0.6, 0.25] : [1, 0.78, 0.4], 0.45, 0.8, rand() * 3);
      break;
    case "earth": {
      // Plank inlays: little boardwalks set into the packed earth.
      const woods: RGB[] = [[0.62, 0.42, 0.22], [0.55, 0.36, 0.18], [0.68, 0.48, 0.26]];
      spots(10, 1.2, (cx, cy) => {
        const vertical = rand() < 0.5;
        const n = 3 + Math.floor(rand() * 2);
        const len = (1.1 + rand() * 0.6) * P;
        const pw = 0.2 * P;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * (pw * 2 + 1.5 * s);
          const x = vertical ? cx + off : cx + (rand() - 0.5) * 3 * s;
          const y = vertical ? cy + (rand() - 0.5) * 3 * s : cy + off;
          const hw = vertical ? pw : len / 2;
          const hh = vertical ? len / 2 : pw;
          p.rect(x + 1.5 * s, y + 2 * s, hw, hh, 0, [0.2, 0.13, 0.06], 0.35);
          p.rect(x, y, hw, hh, 0, woods[Math.floor(rand() * woods.length)], 0.92);
          p.rect(x, y - (vertical ? 0 : pw * 0.6), vertical ? pw * 0.3 : hw, vertical ? hh : pw * 0.18, 0, [0.85, 0.66, 0.4], 0.25);
          for (const e of [-1, 1]) {
            p.disc(x + (vertical ? 0 : e * (hw - 3 * s)), y + (vertical ? e * (hh - 3 * s) : 0), 0.9 * s, [0.3, 0.3, 0.32], 0.8);
          }
        }
      });
      spots(120, 0.3, (x, y) => p.disc(x, y, (1 + rand() * 1.5) * s, rand() < 0.5 ? [0.5, 0.38, 0.24] : [0.72, 0.6, 0.42], 0.5, 0.75, rand() * 3));
      break;
    }
    case "icesheet":
      for (let i = 0; i < 220; i++) p.disc(rand() * w, rand() * h, (0.7 + rand() * 1.0) * s, [1, 1, 1], 0.5 + rand() * 0.3);
      break;
    case "tiles":
      for (let i = 0; i < 46; i++) {
        const cols = ["#e0455a", "#3b6fe0", "#59d6c8", "#f2c14e", "#e055c8"].map(parseColor);
        const c = cols[Math.floor(rand() * cols.length)];
        p.rect(rand() * w, rand() * h, 5 * s, 1.6 * s, rand() * Math.PI, c, 0.6);
      }
      break;
  }

  paintLanes(look, p, P, seed, rand);
}

/**
 * Packed warm dirt lanes: feathered edges, darker worn borders, two faint
 * wheel ruts, and a kerb of flat pebbles along both sides (gold-edged on
 * the royal lawn).
 */
function paintLanes(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const F = look.floor;
  const recipe = floorRecipe(look);
  const { w, h } = p;
  const lane = parseColor(F.lane);
  const laneEdge = parseColor(F.laneEdge);
  const hw = LANE_HW;
  const x0 = Math.floor((BRIDGE_XS[0] - hw - 0.5) * P);
  const x1 = Math.ceil((BRIDGE_XS[1] + hw + 0.5) * P);
  const y0 = Math.floor((ROW_Y[0] - hw - 0.5) * P);
  const y1 = Math.ceil((ROW_Y[1] + hw + 0.5) * P);
  const wobbleF = new NoiseField(w, h, 4, P, 1 / 2.2, seed + 31);
  const dirtF = new NoiseField(w, h, 3, P, 0.45, seed + 41);
  const reach = hw + 0.5;
  const rutPhase = (seed % 628) / 100;
  const royal = recipe === "royal";
  const gold: RGB = [0.86, 0.68, 0.26];
  const lanePixel = (x: number, y: number, ax: number, ay: number): void => {
    let d = Infinity;
    let along = 0;
    let across = 0;
    for (const s of LANE_SEGMENTS) {
      const sd = segDist(ax, ay, s);
      if (sd < d) {
        d = sd;
        const vertical = s[0] === s[2];
        across = vertical ? ax - s[0] : ay - s[1];
        along = vertical ? ay : ax;
      }
    }
    const edge = hw + (wobbleF.at(x, y) - 0.5) * (royal ? 0.06 : 0.2);
    if (d > edge + 0.25) return;
    const cover = 1 - smoothstep(edge - 0.16, edge + 0.16, d);
    if (cover <= 0) return;
    const i = y * w + x;
    // Lighter, packed crown; darker, worn shoulders.
    const crown = 1 - smoothstep(0.1, edge, d) * 0.1;
    const c = mul3(lane, (0.93 + dirtF.at(x, y) * 0.12) * crown);
    p.blend(i, c, cover * lane[3]);
    // Two faint wheel ruts.
    const rutD = Math.abs(Math.abs(across) - 0.36) + Math.sin(along * 4.7 + rutPhase) * 0.025;
    if (rutD < 0.1) p.scale(i, 1 - 0.09 * cover * (1 - rutD / 0.1));
    else if (rutD < 0.14) p.scale(i, 1 + 0.03 * cover);
    const rim = Math.abs(d - edge);
    if (royal) {
      if (rim < 0.055) p.blend(i, gold, 0.85 * (1 - rim / 0.055));
    } else if (rim < 0.09) p.blend(i, laneEdge, laneEdge[3] * 0.6 * (1 - rim / 0.09));
  };
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    const ay = (y + 0.5) / P;
    const nearRow = Math.abs(ay - ROW_Y[0]) < reach || Math.abs(ay - ROW_Y[1]) < reach;
    if (nearRow) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) lanePixel(x, y, (x + 0.5) / P, ay);
      continue;
    }
    for (const bx of BRIDGE_XS) {
      const xa = Math.max(0, Math.floor((bx - reach) * P));
      const xb = Math.min(w, Math.ceil((bx + reach) * P));
      for (let x = xa; x < xb; x++) lanePixel(x, y, (x + 0.5) / P, ay);
    }
  }
  if (royal) return; // the gold edge is the royal kerb
  // Pebble edging: a kerb of flat fieldstones along every lane, in stone
  // tones pulled toward the look's rock colour.
  const rock = parseColor(`#${look.rock.toString(16).padStart(6, "0")}`);
  const kerbA = mix3([0.8, 0.78, 0.72], rock, 0.35);
  const kerbB = mix3([0.66, 0.65, 0.62], rock, 0.45);
  const under = mix3(mul3(parseColor(F.a), 0.5), [0.1, 0.1, 0.1], 0.4);
  for (const s of LANE_SEGMENTS) {
    const vertical = s[0] === s[2];
    const len = vertical ? s[3] - s[1] : s[2] - s[0];
    for (const side of [-1, 1]) {
      for (let t = 0.12; t < len; t += 0.32 + rand() * 0.14) {
        const off = side * (hw + 0.03 + (rand() - 0.5) * 0.08);
        const ax = vertical ? s[0] + off : s[0] + t;
        const ay = vertical ? s[1] + t : s[1] + off;
        if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + 0.45) continue;
        // Leave the crossings between lanes open.
        if (vertical && (Math.abs(ay - ROW_Y[0]) < hw + 0.1 || Math.abs(ay - ROW_Y[1]) < hw + 0.1)) continue;
        if (!vertical && (Math.abs(ax - BRIDGE_XS[0]) < hw + 0.1 || Math.abs(ax - BRIDGE_XS[1]) < hw + 0.1) && side * (ay - RIVER_Y) < 0) continue;
        if (insideApron(ax, ay)) continue;
        const r = (0.095 + rand() * 0.05) * P;
        const rot = (vertical ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.5;
        const c = rand() < 0.5 ? kerbA : kerbB;
        p.disc(ax * P + r * 0.2, ay * P + r * 0.32, r * 1.1, under, 0.35, 0.72, rot);
        p.disc(ax * P, ay * P, r, mul3(c, 0.9 + rand() * 0.14), 0.95, 0.7, rot);
        p.disc(ax * P - r * 0.15, ay * P - r * 0.2, r * 0.55, [1, 1, 0.96], 0.18, 0.6, rot);
      }
    }
  }
}

/** True inside any tower's platform-plus-apron square. */
function insideApron(ax: number, ay: number): boolean {
  for (const side of ["player", "enemy"] as const) {
    for (const t of towerSpots(side)) {
      const half = TOWER_FOOTPRINT[t.kind] + APRON;
      if (Math.abs(ax - t.x) < half && Math.abs(ay - t.y) < half) return true;
    }
  }
  return false;
}

/**
 * Flagstone aprons around every tower platform (the towers draw their own
 * plinth on top): irregular stones in the look's platform tone with dark
 * grout, a lit upper-left lip on each stone, and a soft shadow ring.
 */
function paintAprons(p: Paint, P: number, seed: number, stoneHex: number): void {
  const { w } = p;
  const stone = parseColor(`#${stoneHex.toString(16).padStart(6, "0")}`);
  const grout = mul3(stone, 0.74);
  for (const side of ["player", "enemy"] as const) {
    for (const t of towerSpots(side)) {
      const inner = TOWER_FOOTPRINT[t.kind] - 0.15;
      const outer = TOWER_FOOTPRINT[t.kind] + APRON;
      const x0 = Math.max(0, Math.floor((t.x - outer - 0.2) * P));
      const x1 = Math.min(w, Math.ceil((t.x + outer + 0.2) * P));
      const y0 = Math.max(0, Math.floor((t.y - outer - 0.2) * P));
      const y1 = Math.min(p.h, Math.ceil((t.y + outer + 0.2) * P));
      for (let y = y0; y < y1; y++) {
        const ay = (y + 0.5) / P;
        for (let x = x0; x < x1; x++) {
          const ax = (x + 0.5) / P;
          // Rounded-square distance from the tower centre.
          const qx = Math.abs(ax - t.x);
          const qy = Math.abs(ay - t.y);
          const rr = 0.35;
          const ex = Math.max(qx - (outer - rr), 0);
          const ey = Math.max(qy - (outer - rr), 0);
          const dOut = Math.sqrt(ex * ex + ey * ey) - rr; // < 0 inside the apron's outer edge
          if (dOut > 0.05) continue;
          if (Math.max(qx, qy) < inner) continue;
          const i = y * w + x;
          const cover = Math.min(1, (0.05 - dOut) / 0.05);
          voronoi(ax / 0.42, ay / 0.42, seed + 97 + (side === "player" ? 1 : 0));
          const seamK = 1 - smoothstep(0.03, 0.085, vorEdge);
          const shade = 0.94 + vorId * 0.1;
          // A lit lip toward the upper left of each stone.
          const c = mul3(stone, shade);
          p.blend(i, mix3(c, grout, seamK), 0.96 * cover);
          // Outer rim: a darker worn edge where the stones meet the turf.
          if (dOut > -0.06) p.scale(i, 1 - 0.12 * (1 + dOut / 0.06) * cover);
        }
      }
    }
  }
}

/**
 * The band's banks on the floor paint: sand for water, basalt for lava,
 * snow for ice, a rocky drop for a chasm and a chrome kerb for neon.
 */
function paintBanks(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const { w, h } = p;
  const recipe = floorRecipe(look);
  const wintry = recipe === "snow" || recipe === "icesheet";
  // Water banks are sand, except in winter, where they are snow.
  const kind = look.band.kind === "water" && wintry ? "ice" : look.band.kind;
  const reeds = look.band.kind === "water" && GRASSY.has(recipe);
  const bankF = new NoiseField(w, h, 4, P, 0.7, seed + 53);
  const floorMid = mix3(parseColor(look.floor.a), parseColor(look.floor.b), 0.5);
  let near: RGB;
  let far: RGB;
  let reachBase = 0.42;
  switch (kind) {
    case "lava":
      near = [0.16, 0.12, 0.13];
      far = [0.3, 0.26, 0.28];
      reachBase = 0.5;
      break;
    case "ice":
      near = [0.86, 0.92, 0.98];
      far = [0.97, 0.99, 1];
      reachBase = 0.5;
      break;
    case "chasm":
      near = mul3(floorMid, 0.45);
      far = mul3(floorMid, 0.85);
      reachBase = 0.55;
      break;
    case "neon":
      near = [0.55, 0.58, 0.68];
      far = [0.82, 0.85, 0.92];
      reachBase = 0.3;
      break;
    default: {
      const pal = stagePalette(look);
      near = mix3(parseColor(pal.bankNear), [0, 0, 0], 0);
      far = mix3(parseColor(pal.bankFar), floorMid, 0.15);
    }
  }
  for (const sgn of [-1, 1]) {
    const lip = RIVER_Y + sgn * RIVER_HALF_WIDTH;
    const ya = Math.floor((sgn < 0 ? lip - 1.1 : lip) * P);
    const yb = Math.ceil((sgn < 0 ? lip : lip + 1.1) * P);
    for (let y = Math.max(0, ya); y < Math.min(h, yb); y++) {
      const d = Math.abs((y + 0.5) / P - lip);
      for (let x = 0; x < w; x++) {
        const reach = kind === "neon" ? reachBase : reachBase + (bankF.at(x, y) - 0.5) * 0.45;
        if (d > reach + 0.12) continue;
        const cover = 1 - smoothstep(reach - (kind === "neon" ? 0.02 : 0.14), reach + (kind === "neon" ? 0.02 : 0.1), d);
        if (cover <= 0) continue;
        const i = y * w + x;
        p.blend(i, mix3(near, far, smoothstep(0.04, 0.32, d)), cover * 0.94);
        const rim = Math.abs(d - reach);
        if (kind === "neon") {
          if (rim < 0.03) p.blend(i, [1, 1, 1], 0.5 * (1 - rim / 0.03));
        } else if (rim < 0.05) p.scale(i, 1 - 0.12 * (1 - rim / 0.05));
      }
    }
    if (kind === "neon") continue;
    // Shingle, then (water) reeds and lily-side tufts by the lip.
    const pebA: RGB = kind === "ice" ? [0.78, 0.86, 0.94] : kind === "lava" ? [0.2, 0.17, 0.18] : [0.72, 0.7, 0.66];
    const pebB: RGB = kind === "ice" ? [0.9, 0.95, 1] : kind === "lava" ? [0.34, 0.3, 0.32] : [0.56, 0.55, 0.54];
    for (let i = 0; i < 70; i++) {
      const ax = rand() * ARENA_WIDTH;
      const ay = lip + sgn * (0.08 + rand() * 0.34);
      const r = (0.04 + rand() * 0.07) * P;
      p.disc(ax * P + r * 0.2, ay * P + r * 0.3, r * 1.1, [0.2, 0.16, 0.1], 0.25, 0.7);
      p.disc(ax * P, ay * P, r, rand() < 0.5 ? pebA : pebB, 0.9, 0.7, rand() * 3);
    }
    if (kind === "lava") {
      // A thin glowing seam right at the lip (colour only).
      for (let x = 0; x < w; x++) {
        const y = Math.round((lip + sgn * 0.04) * P);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy >= 0 && yy < h) p.blend(yy * w + x, [1, 0.5, 0.18], dy === 0 ? 0.55 : 0.25);
        }
      }
    }
    if (reeds) {
      for (let i = 0; i < 16; i++) {
        const ax = rand() * ARENA_WIDTH;
        const ay = lip + sgn * (0.3 + rand() * 0.25);
        if (Math.abs(ax - BRIDGE_XS[0]) < 1.5 || Math.abs(ax - BRIDGE_XS[1]) < 1.5) continue;
        for (let k = 0; k < 5; k++) {
          const dx = (k - 2) * 0.05 * P;
          p.line(ax * P + dx * 0.4, ay * P, ax * P + dx, ay * P - (0.22 + rand() * 0.16) * P, 0.03 * P, k % 2 ? [0.2, 0.46, 0.2] : [0.3, 0.58, 0.24], 0.9);
        }
      }
    }
  }
}


/** Zellige border bands (tiles): along the court edge and the canal. */
export const ZELLIGE_BAND = 0.9;

/**
 * Golden Age courtyard (art bible section 3): sandstone or plaster
 * flagstones in a running bond, zellige border bands round the court and
 * along the canal (eight-point khatam stars in the look's tile colours,
 * gold strapwork), packed ochre sand lanes with pebble edging. The crescent
 * emblems are 3D inlays (build.ts) at a quarter of their old contrast.
 */
function paintIslamic(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const Z = look.islamic!;
  const { w, h } = p;
  const buf = p.buf;
  const plaster = parseColor(Z.plaster);
  const star = parseColor(Z.star);
  const diamondC = parseColor(Z.diamond);
  const strap = parseColor(Z.strap);
  const turq: RGB = [0.1, 0.64, 0.63];
  // Tile colours at full glaze for the borders (the floor field is calm).
  const starTile = mix3(plaster, star, 0.85);
  const diaTile = mix3(plaster, diamondC, 0.8);
  const grout = mul3(plaster, 0.86);

  // 1) Flagstones: rows of 1.5 x 1 tile stones in a running bond, each with
  // its own shade, thin grout, and a soft value noise over everything.
  const bigF = new NoiseField(w, h, 8, P, 7, seed);
  const smallF = new NoiseField(w, h, 2, P, 0.35, seed + 7);
  const SW = 1.5;
  const SH = 1.0;
  for (let y = 0; y < h; y++) {
    const ay = (y + 0.5) / P;
    const row = Math.floor(ay / SH);
    const fy = ay / SH - row;
    const off = (row % 2) * SW * 0.5;
    for (let x = 0; x < w; x++) {
      const ax = (x + 0.5) / P;
      const col = Math.floor((ax + off) / SW);
      const fx = (ax + off) / SW - col;
      const stoneShade = 0.97 + hash2(col, row, seed + 5) * 0.06;
      let f = stoneShade * (1 + (bigF.at(x, y) - 0.5) * 0.06) * (1 + (smallF.at(x, y) - 0.5) * 0.035);
      // Grout: 0.035 tile lines, with a faint lit lip on each stone's top-left.
      const gx = Math.min(fx * SW, (1 - fx) * SW);
      const gy = Math.min(fy * SH, (1 - fy) * SH);
      const gd = Math.min(gx, gy);
      let r = plaster[0];
      let g = plaster[1];
      let b = plaster[2];
      if (gd < 0.03) {
        const k = 1 - gd / 0.03;
        r += (grout[0] - r) * k * 0.8;
        g += (grout[1] - g) * k * 0.8;
        b += (grout[2] - b) * k * 0.8;
      } else if (gd < 0.07 && (fx * SW < 0.07 || fy * SH < 0.07)) f *= 1.02;
      const k = (y * w + x) * 3;
      buf[k] = r * f;
      buf[k + 1] = g * f;
      buf[k + 2] = b * f;
    }
  }

  // 2) Zellige border bands: the court's edge and both canal banks.
  const band = ZELLIGE_BAND;
  const cell = band * P; // one star per band height
  const R = cell * 0.4;
  const sq = R / Math.SQRT2;
  const strapW = P * 0.03;
  const inBand = (ax: number, ay: number): { u: number; v: number; d: number } | null => {
    // Distance into the band and coordinates along it.
    const dEdge = Math.min(ax, ARENA_WIDTH - ax, ay, ARENA_HEIGHT - ay);
    if (dEdge < band) return { u: ax, v: ay, d: dEdge };
    const dc = Math.abs(ay - RIVER_Y) - RIVER_HALF_WIDTH;
    if (dc >= 0 && dc < band * 0.75) return { u: ax, v: ay, d: dc };
    return null;
  };
  for (let y = 0; y < h; y++) {
    const ay = (y + 0.5) / P;
    for (let x = 0; x < w; x++) {
      const ax = (x + 0.5) / P;
      const bnd = inBand(ax, ay);
      if (!bnd) continue;
      const i = y * w + x;
      // Band ground: a glazed ivory tile.
      p.blend(i, mix3(plaster, [1, 0.98, 0.92], 0.35), 0.92);
      // Khatam stars and diamonds on a grid aligned to the band.
      const px = x + 0.5;
      const py = y + 0.5;
      const sx = px - (Math.floor(px / cell) + 0.5) * cell;
      const sy = py - (Math.floor(py / cell) + 0.5) * cell;
      const sqd = Math.max(Math.abs(sx), Math.abs(sy)) - sq;
      const rot = (Math.abs(sx) + Math.abs(sy)) / Math.SQRT2 - sq;
      const sd = Math.min(sqd, rot);
      const lx = px - Math.round(px / cell) * cell;
      const ly = py - Math.round(py / cell) * cell;
      const dd = (Math.abs(lx) + Math.abs(ly) - cell * 0.18) / Math.SQRT2;
      if (sd < 0.5) p.blend(i, starTile, Math.min(1, 0.5 - sd) * 0.95);
      if (dd < 0.5) p.blend(i, diaTile, Math.min(1, 0.5 - dd) * 0.9);
      const se = Math.abs(sd) - strapW;
      if (se < 0.5) p.blend(i, strap, Math.min(1, 0.5 - se) * 0.75);
      // Gold fillets frame the band; a turquoise rule runs inside them.
      const edgeIn = Math.abs(bnd.d - (bnd.d < band * 0.5 ? 0.04 : band - 0.04));
      if (edgeIn < 0.03) p.blend(i, strap, 0.9 * (1 - edgeIn / 0.03));
      const rule = Math.abs(bnd.d - band * 0.12);
      if (rule < 0.025 && bnd.d < band) p.blend(i, turq, 0.55 * (1 - rule / 0.025));
    }
  }

  // 3) Lanes of packed ochre sand, straight from each bridge, with pebble edging.
  const laneC = parseColor(Z.lane);
  const wear = parseColor(Z.laneWear);
  const dirtF = new NoiseField(w, h, 3, P, 0.5, seed + 41);
  const wobbleF = new NoiseField(w, h, 4, P, 1 / 2.2, seed + 31);
  const hw = 0.95;
  const top = band + 0.25;
  const bottom = ARENA_HEIGHT - band - 0.25;
  for (const bx of BRIDGE_XS) {
    for (let y = Math.floor(top * P); y < Math.ceil(bottom * P); y++) {
      const ay = (y + 0.5) / P;
      if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + band * 0.75) continue;
      const endFade = smoothstep(top, top + 0.3, ay) * (1 - smoothstep(bottom - 0.3, bottom, ay));
      for (let x = Math.floor((bx - hw - 0.3) * P); x < Math.ceil((bx + hw + 0.3) * P); x++) {
        const ax = (x + 0.5) / P;
        const edge = hw + (wobbleF.at(x, y) - 0.5) * 0.12;
        const d = Math.abs(ax - bx);
        const cover = (1 - smoothstep(edge - 0.1, edge + 0.08, d)) * endFade;
        if (cover <= 0) continue;
        const i = y * w + x;
        const crown = 1 - smoothstep(0.1, edge, d) * 0.08;
        p.blend(i, mul3(laneC, (0.93 + dirtF.at(x, y) * 0.12) * crown), cover * 0.96);
        const rut = Math.abs(d - 0.38);
        if (rut < 0.08) p.blend(i, wear, 0.18 * cover * (1 - rut / 0.08));
      }
    }
    for (let i = 0; i < 70; i++) {
      const ax = bx + (rand() - 0.5) * hw * 1.6;
      const ay = top + 0.3 + rand() * (bottom - top - 0.6);
      if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + band) continue;
      p.disc(ax * P, ay * P, (0.7 + rand() * 0.6) * (P / 32), wear, 0.45, 0.7, rand() * 3);
    }
    // Pebble edging down both sides.
    const kerbA = mix3(plaster, [0.62, 0.55, 0.45], 0.5);
    const kerbB = mix3(plaster, [0.8, 0.74, 0.62], 0.4);
    for (const side of [-1, 1]) {
      for (let ay = top + 0.15; ay < bottom; ay += 0.3 + rand() * 0.12) {
        if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + band) continue;
        if (insideApron(bx, ay)) continue;
        const ax = bx + side * (hw + 0.04 + (rand() - 0.5) * 0.06);
        const r = (0.09 + rand() * 0.04) * P;
        const rot = Math.PI / 2 + (rand() - 0.5) * 0.5;
        p.disc(ax * P + r * 0.2, ay * P + r * 0.3, r * 1.1, mul3(plaster, 0.55), 0.3, 0.72, rot);
        p.disc(ax * P, ay * P, r, rand() < 0.5 ? kerbA : kerbB, 0.95, 0.7, rot);
        p.disc(ax * P - r * 0.15, ay * P - r * 0.2, r * 0.5, [1, 1, 0.96], 0.2, 0.6, rot);
      }
    }
  }
}

/** Ambient occlusion: towers, bridge ends, river lips and the court's walls. */
function paintOcclusion(p: Paint, P: number): void {
  const { w, h } = p;
  // Where the court meets its edging.
  const edge = 1.1;
  const band = Math.ceil(edge * P);
  for (let y = 0; y < h; y++) {
    const ay = (y + 0.5) / P;
    const inner = y >= band && y < h - band;
    for (let x = 0; x < w; x++) {
      if (inner && x === band) x = w - band; // skip the middle of the court
      const ax = (x + 0.5) / P;
      const d = Math.min(ax, ARENA_WIDTH - ax, ay, ARENA_HEIGHT - ay);
      if (d < edge) {
        const t = 1 - d / edge;
        p.scale(y * w + x, 1 - 0.2 * t * t);
      }
    }
  }
  // Soft radial AO under all six tower footprints.
  for (const side of ["player", "enemy"] as const) {
    for (const t of towerSpots(side)) {
      const half = TOWER_FOOTPRINT[t.kind];
      const reach = 1.0;
      const x0 = Math.floor((t.x - half - reach) * P);
      const x1 = Math.ceil((t.x + half + reach) * P);
      const y0 = Math.floor((t.y - half - reach) * P);
      const y1 = Math.ceil((t.y + half + reach) * P);
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        const ay = (y + 0.5) / P;
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
          const ax = (x + 0.5) / P;
          // Rounded-square distance outside the platform (corner radius 0.6).
          const qx = Math.abs(ax - t.x) - half + 0.6;
          const qy = Math.abs(ay - t.y) - half + 0.6;
          const mx = qx > 0 ? qx : 0;
          const my = qy > 0 ? qy : 0;
          const out = Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - 0.6;
          const fall = 1 - smoothstep(0, reach, out);
          const ao = out <= 0 ? 0.42 : 0.34 * fall * fall;
          if (ao > 0.001) p.scale(y * w + x, 1 - ao);
        }
      }
    }
  }
  // River lips and the bridge ends.
  const lipTop = RIVER_Y - RIVER_HALF_WIDTH;
  const lipBottom = RIVER_Y + RIVER_HALF_WIDTH;
  for (let y = Math.floor((lipTop - 0.7) * P); y < Math.ceil((lipBottom + 0.7) * P); y++) {
    const ay = (y + 0.5) / P;
    const d = Math.max(lipTop - ay, ay - lipBottom);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d < 0) p.scale(i, 0.5); // the river bed under the water
      else if (d < 0.7) {
        const t = 1 - d / 0.7;
        p.scale(i, 1 - 0.3 * t * t);
      }
    }
  }
  for (const bx of BRIDGE_XS) {
    for (const ey of [RIVER_Y - BRIDGE_REACH, RIVER_Y + BRIDGE_REACH]) {
      const rx = 1.5;
      const ry = 0.55;
      for (let y = Math.floor((ey - ry) * P); y < Math.ceil((ey + ry) * P); y++) {
        const ay = (y + 0.5) / P;
        for (let x = Math.floor((bx - rx) * P); x < Math.ceil((bx + rx) * P); x++) {
          const ax = (x + 0.5) / P;
          const q = Math.sqrt(((ax - bx) / rx) ** 2 + ((ay - ey) / ry) ** 2);
          if (q < 1) p.scale(y * w + x, 1 - 0.26 * (1 - q) * (1 - q * 0.5));
        }
      }
    }
  }
}

/**
 * The painter, as an object so tests can spy on it. `paint` always paints;
 * `groundImage` below goes through the cache.
 */
export const groundPainter = {
  paint(look: ArenaLook, islamic: boolean): GroundImage {
    const P = GROUND_PX;
    const p = new Paint(ARENA_WIDTH * P, ARENA_HEIGHT * P);
    const seed = hashString(`${islamic ? "islamic" : "classic"}:${look.id}`);
    const rand = rng(seed);
    if (islamic && look.islamic) {
      paintIslamic(look, p, P, seed, rand);
      const Z = parseColor(look.islamic.plaster);
      const stone = ((Math.round(Z[0] * 0.92 * 255) << 16) | (Math.round(Z[1] * 0.88 * 255) << 8) | Math.round(Z[2] * 0.8 * 255)) >>> 0;
      paintAprons(p, P, seed, stone);
    } else {
      paintClassic(look, p, P, seed, rand);
      paintBanks(look, p, P, seed, rand);
      paintAprons(p, P, seed, mixHex(look.tower.platformPlayer, look.tower.plinth, 0.45));
    }
    paintOcclusion(p, P);
    return p.toImage(P);
  },
};

const CACHE_MAX = 4;
const cache = new Map<string, GroundImage>();

/** The look's floor image, painted once and then served from a small LRU. */
export function groundImage(look: ArenaLook, islamic: boolean): GroundImage {
  const key = `${islamic ? "i" : "c"}:${look.id}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const img = groundPainter.paint(look, islamic);
  cache.set(key, img);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return img;
}

/** Forget every cached floor (tests). */
export function clearGroundCache(): void {
  cache.clear();
}

/**
 * The floor as a mipmapped, anisotropic texture. Row 0 of the image is
 * arena y = 0, which sits at v = 0, so the mesh's UVs must run v = 0 at
 * the enemy back line (see build.ts).
 */
export function groundTexture(look: ArenaLook, islamic: boolean, anisotropy: number): THREE.DataTexture {
  const img = groundImage(look, islamic);
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}
