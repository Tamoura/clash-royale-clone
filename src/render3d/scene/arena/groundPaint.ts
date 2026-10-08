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
import type { ArenaLook } from "../../arenaLooks";

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

/** Classic lanes: centre segments in tiles (bridge columns plus the tower rows). */
const ROW_Y = [6.5, ARENA_HEIGHT - 6.5] as const;
const LANE_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [BRIDGE_XS[0], ROW_Y[0], BRIDGE_XS[0], ROW_Y[1]],
  [BRIDGE_XS[1], ROW_Y[0], BRIDGE_XS[1], ROW_Y[1]],
  [BRIDGE_XS[0], ROW_Y[0], BRIDGE_XS[1], ROW_Y[0]],
  [BRIDGE_XS[0], ROW_Y[1], BRIDGE_XS[1], ROW_Y[1]],
];

function segDist(px: number, py: number, s: readonly [number, number, number, number]): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((px - s[0]) * dx + (py - s[1]) * dy) / len2));
  const ex = px - s[0] - dx * t;
  const ey = py - s[1] - dy * t;
  return Math.sqrt(ex * ex + ey * ey);
}

function paintClassic(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const F = look.floor;
  const A = parseColor(F.a);
  const B = parseColor(F.b);
  const mid = mix3(A, B, 0.5);
  const tone = hsl(mid);
  const turf = tone.h > 0.17 && tone.h < 0.45 && tone.s > 0.22;
  const grid = parseColor(F.grid);
  const { w, h } = p;
  const buf = p.buf;
  const warm: RGB = [1.035, 1.0, 0.95];
  const cool: RGB = [0.97, 1.0, 1.04];

  // 1) Base: painted turf/flagstone, with the old bevelled checker at 30%.
  const bigF = new NoiseField(w, h, 8, P, 2.6, seed);
  const smallF = new NoiseField(w, h, 2, P, 0.33, seed + 7);
  const hueF = new NoiseField(w, h, 8, P, 4.1, seed + 3);
  // Per-column facts about the tile grid, so the pixel loop only looks up.
  const bev = 2 / 32;
  const colTile = new Int32Array(w);
  const colLo = new Uint8Array(w); // 1: lit bevel edge, 2: shaded edge, 0: inside
  const colHalf = new Uint8Array(w);
  const colGrid = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const ax = (x + 0.5) / P;
    const tx = Math.floor(ax);
    const fx = ax - tx;
    colTile[x] = tx;
    colLo[x] = fx < bev ? 1 : fx > 1 - bev ? 2 : 0;
    colHalf[x] = fx < 0.5 ? 1 : 0;
    colGrid[x] = fx * P < 1 ? 1 : 0;
  }
  const dA: RGB = [mid[0] + (A[0] - mid[0]) * 2.5, mid[1] + (A[1] - mid[1]) * 2.5, mid[2] + (A[2] - mid[2]) * 2.5];
  const dB: RGB = [mid[0] + (B[0] - mid[0]) * 2.5, mid[1] + (B[1] - mid[1]) * 2.5, mid[2] + (B[2] - mid[2]) * 2.5];
  const tileShade = new Float32Array(turf ? 0 : ARENA_WIDTH * ARENA_HEIGHT);
  for (let i = 0; i < tileShade.length; i++) {
    tileShade[i] = 0.97 + hash2(i % ARENA_WIDTH, Math.floor(i / ARENA_WIDTH), seed + 19) * 0.06;
  }
  for (let y = 0; y < h; y++) {
    const ay = (y + 0.5) / P;
    const ty = Math.floor(ay);
    const fy = ay - ty;
    const rowLo = fy < bev ? 1 : fy > 1 - bev ? 2 : 0;
    const rowHalf = fy < 0.5 ? 1 : 0;
    const rowGrid = fy * P < 1;
    // Mown stripes across the court, two tiles wide, soft-edged.
    const sy = ay / 2;
    const sf = sy - Math.floor(sy);
    const stripe = 1 + (Math.floor(sy) % 2 === 0 ? 1 : -1) * 0.05 * smoothstep(0, 0.12, Math.min(sf, 1 - sf));
    for (let x = 0; x < w; x++) {
      const tx = colTile[x];
      let f = 0.9 + bigF.at(x, y) * 0.16 + (smallF.at(x, y) - 0.5) * 0.08;
      // Turf gets mown stripes; each flagstone keeps its own shade.
      f *= turf ? stripe : tileShade[ty * ARENA_WIDTH + tx];
      const hueN = hueF.at(x, y);
      const pr = mid[0] * f * (cool[0] + (warm[0] - cool[0]) * hueN);
      const pg = mid[1] * f;
      const pb = mid[2] * f * (cool[2] + (warm[2] - cool[2]) * hueN);
      // The classic tile look: checker, quartered sheen, bevel and grid line.
      const T = ((tx + ty) & 1) === 0 ? dA : dB;
      let tr = T[0];
      let tg = T[1];
      let tb = T[2];
      if (colHalf[x] === rowHalf) {
        tr += (1 - tr) * 0.08;
        tg += (1 - tg) * 0.08;
        tb += (1 - tb) * 0.08;
      }
      const lo = colLo[x] === 1 || rowLo === 1 ? 1 : colLo[x] === 2 || rowLo === 2 ? 2 : 0;
      if (lo === 1) {
        tr += (1 - tr) * 0.16;
        tg += (1 - tg) * 0.16;
        tb += (1 - tb) * 0.16;
      } else if (lo === 2) {
        tr *= 0.9;
        tg *= 0.9;
        tb *= 0.9;
      }
      if (rowGrid || colGrid[x] === 1) {
        tr += (grid[0] - tr) * grid[3];
        tg += (grid[1] - tg) * grid[3];
        tb += (grid[2] - tb) * grid[3];
      }
      const k = (y * w + x) * 3;
      buf[k] = pr * 0.7 + tr * 0.3;
      buf[k + 1] = pg * 0.7 + tg * 0.3;
      buf[k + 2] = pb * 0.7 + tb * 0.3;
    }
  }

  // 2) Grass strokes over the turf: thousands of short blades.
  if (turf) {
    const light = mix3(mid, [1, 1, 0.8], 0.22);
    const dark = mul3(mid, 0.78);
    const blades = Math.round((w * h) / 110);
    for (let i = 0; i < blades; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const len = (3.5 + rand() * 4.5) * (P / 48);
      const ang = (rand() - 0.5) * 0.9;
      const c = rand() < 0.55 ? dark : light;
      p.line(x, y, x + Math.sin(ang) * len, y - Math.cos(ang) * len, 0.55 * (P / 48), c, 0.32 + rand() * 0.25);
    }
  }

  // 3) Optional crown watermark in the middle of each half.
  if (F.watermark) {
    const wm = parseColor(F.watermark);
    for (const cy of [h * 0.25, h * 0.75]) {
      const cx = w / 2;
      const R = 4.1 * P;
      const lw = 4.5 * (P / 32);
      p.shape(cx - R - lw - 1, cy - R - lw - 1, cx + R + lw + 1, cy + R + lw + 1, (x, y) => {
        return Math.abs(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - R) - lw;
      }, wm, wm[3]);
      const cw = R * 0.95;
      const ch = R * 0.7;
      const pts: Array<[number, number]> = [
        [cx - cw / 2, cy + ch * 0.4], [cx - cw / 2, cy - ch * 0.25], [cx - cw / 6, cy + ch * 0.05],
        [cx, cy - ch * 0.55], [cx + cw / 6, cy + ch * 0.05], [cx + cw / 2, cy - ch * 0.25],
        [cx + cw / 2, cy + ch * 0.4], [cx - cw / 2, cy + ch * 0.4],
      ];
      const sw = 3.5 * (P / 32);
      for (let i = 0; i + 1 < pts.length; i++) {
        p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], sw, wm, wm[3]);
      }
    }
  }

  // 4) Feathered dirt lanes with ruts and pebbled edges.
  const lane = parseColor(F.lane);
  const laneEdge = parseColor(F.laneEdge);
  const hw = 0.85;
  const x0 = Math.floor((BRIDGE_XS[0] - hw - 0.5) * P);
  const x1 = Math.ceil((BRIDGE_XS[1] + hw + 0.5) * P);
  const y0 = Math.floor((ROW_Y[0] - hw - 0.5) * P);
  const y1 = Math.ceil((ROW_Y[1] + hw + 0.5) * P);
  const wobbleF = new NoiseField(w, h, 4, P, 1 / 2.2, seed + 31);
  const dirtF = new NoiseField(w, h, 3, P, 0.45, seed + 41);
  const reach = hw + 0.5;
  const rutPhase = (seed % 628) / 100;
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
    const edge = hw + (wobbleF.at(x, y) - 0.5) * 0.22;
    if (d > edge + 0.25) return;
    const cover = 1 - smoothstep(edge - 0.18, edge + 0.2, d);
    if (cover <= 0) return;
    const i = y * w + x;
    const c = mul3(lane, 0.92 + dirtF.at(x, y) * 0.14);
    p.blend(i, c, cover * lane[3]);
    // Two wheel ruts along the lane, worn darker, with lit lips.
    const rutD = Math.abs(Math.abs(across) - 0.36) + Math.sin(along * 4.7 + rutPhase) * 0.025;
    if (rutD < 0.12) p.scale(i, 1 - 0.16 * cover * (1 - rutD / 0.12));
    else if (rutD < 0.17) p.scale(i, 1 + 0.05 * cover);
    // A thin worn border keeps the path legible against bright turf.
    const rim = Math.abs(d - edge);
    if (rim < 0.07) p.blend(i, laneEdge, laneEdge[3] * 0.7 * (1 - rim / 0.07));
  };
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    const ay = (y + 0.5) / P;
    const nearRow = Math.abs(ay - ROW_Y[0]) < reach || Math.abs(ay - ROW_Y[1]) < reach;
    if (nearRow) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) lanePixel(x, y, (x + 0.5) / P, ay);
      continue;
    }
    // Between the tower rows only the two bridge columns carry a lane.
    for (const bx of BRIDGE_XS) {
      const xa = Math.max(0, Math.floor((bx - reach) * P));
      const xb = Math.min(w, Math.ceil((bx + reach) * P));
      for (let x = xa; x < xb; x++) lanePixel(x, y, (x + 0.5) / P, ay);
    }
  }
  // Edge pebbles, scattered along both sides of every lane.
  const pebbleLight = mix3(lane, [1, 1, 1], 0.35);
  const pebbleDark = mul3(laneEdge, 0.85);
  for (const s of LANE_SEGMENTS) {
    const vertical = s[0] === s[2];
    const len = vertical ? s[3] - s[1] : s[2] - s[0];
    const n = Math.round(len * 7);
    for (let i = 0; i < n; i++) {
      const t = rand();
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (hw + (rand() - 0.4) * 0.3);
      const ax = vertical ? s[0] + off : s[0] + t * len;
      const ay = vertical ? s[1] + t * len : s[1] + off;
      if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + 0.4) continue;
      const r = (0.045 + rand() * 0.06) * P;
      p.disc(ax * P, ay * P + r * 0.25, r * 1.05, [0, 0, 0], 0.18, 0.7);
      p.disc(ax * P, ay * P, r, rand() < 0.6 ? pebbleDark : pebbleLight, 0.85, 0.75, rand() * 3);
    }
  }

  // 5) Look-specific scatter, 4x the old density.
  const scatterRect = (colors: string[], n: number, rw: number, rh: number, alpha: number): void => {
    const cols = colors.map(parseColor);
    for (let i = 0; i < n; i++) {
      const c = cols[Math.floor(rand() * cols.length)];
      p.rect(rand() * w, rand() * h, (rw * P) / 64, (rh * P) / 64, rand() * Math.PI, c, alpha * c[3]);
    }
  };
  const scatterDot = (colors: string[], n: number, r0: number, r1: number, alpha: number): void => {
    const cols = colors.map(parseColor);
    for (let i = 0; i < n; i++) {
      const r = ((r0 + rand() * (r1 - r0)) * P) / 32;
      const c = cols[Math.floor(rand() * cols.length)];
      p.disc(rand() * w, rand() * h, r, c, alpha * c[3], 0.75, rand() * 3);
    }
  };
  switch (F.scatter) {
    case "confetti":
      scatterRect(["#e0455a", "#3b6fe0", "#59d6c8", "#f2c14e", "#e055c8"], 176, 14, 4.4, 0.85);
      break;
    case "pebbles":
      scatterDot(["rgba(148,132,104,1)", "rgba(120,102,78,1)", "rgba(170,156,128,1)"], 200, 1.5, 4.5, 0.55);
      break;
    case "grass":
      for (let i = 0; i < 280; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const s = P / 32;
        const c = mul3(mid, 0.62);
        for (const dx of [-2, 0, 2]) p.line(x, y, x + dx * s, y - (5 + rand() * 3) * s, 0.8 * s, c, 0.55);
      }
      break;
    case "bones":
      scatterRect(["#f0e8d8", "#e2d8c0"], 88, 16, 3.5, 0.9);
      scatterDot(["#f0e8d8", "#d8ccb0"], 96, 2, 4, 0.9);
      break;
    case "embers":
      scatterDot(["#ff8a3a", "#ffc46b", "#ff5340"], 240, 1, 2.6, 0.85);
      break;
    case "snow":
      scatterDot(["rgba(255,255,255,1)"], 320, 1.5, 5, 0.7);
      break;
    case "crystals":
      for (let i = 0; i < 104; i++) {
        const cx = rand() * w;
        const cy = rand() * h;
        const rot = rand() * Math.PI;
        const c = parseColor(rand() < 0.5 ? "#d8c8ff" : "#b08aff");
        const r = ((4 + rand() * 4) * P) / 32;
        const cs = Math.cos(rot);
        const sn = Math.sin(rot);
        p.shape(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
          const u = Math.abs((x - cx) * cs + (y - cy) * sn);
          const v = Math.abs(-(x - cx) * sn + (y - cy) * cs);
          return (u / (r * 0.5) + v / r - 1) * r * 0.45;
        }, c, 0.85);
      }
      break;
    default:
      break;
  }
}

function paintIslamic(look: ArenaLook, p: Paint, P: number, seed: number, rand: () => number): void {
  const Z = look.islamic!;
  const { w, h } = p;
  const buf = p.buf;
  const plaster = parseColor(Z.plaster);
  const star = parseColor(Z.star);
  const diamondC = parseColor(Z.diamond);
  const strap = parseColor(Z.strap);
  const cell = P * 4; // one star motif every 4 tiles
  const R = cell * 0.46;
  const s = R / Math.SQRT2; // khatam: two squares of half-size s
  const dia = cell * 0.2;
  const glaze = 1.6; // the stronger glaze: deeper tile colour plus a sheen
  const starA = Math.min(0.75, star[3] * glaze);
  const diaA = Math.min(0.75, diamondC[3] * glaze);
  const strapW = P * 0.035;

  const bigF = new NoiseField(w, h, 8, P, 3, seed);
  const smallF = new NoiseField(w, h, 2, P, 0.4, seed + 7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = 0.965 + bigF.at(x, y) * 0.05 + (smallF.at(x, y) - 0.5) * 0.03;
      let r = plaster[0] * f;
      let g = plaster[1] * f;
      let b = plaster[2] * f;
      // Diamonds on the lattice points.
      const lx = x + 0.5 - Math.round((x + 0.5) / cell) * cell;
      const ly = y + 0.5 - Math.round((y + 0.5) / cell) * cell;
      const dd = (Math.abs(lx) + Math.abs(ly) - dia) / Math.SQRT2;
      // Khatam stars in the cell centres.
      const sx = x + 0.5 - (Math.floor((x + 0.5) / cell) + 0.5) * cell;
      const sy = y + 0.5 - (Math.floor((y + 0.5) / cell) + 0.5) * cell;
      const sq = Math.max(Math.abs(sx), Math.abs(sy)) - s;
      const rot = (Math.abs(sx) + Math.abs(sy)) / Math.SQRT2 - s;
      const sd = Math.min(sq, rot);
      if (sd < 0.5) {
        const cov = Math.min(1, 0.5 - sd);
        // Glaze sheen: brighter toward the upper-left of each star.
        const sheen = Math.max(0, 0.5 - (sx + sy) / (2 * R)) * 0.22 * cov;
        r += (star[0] - r) * starA * cov + (1 - r) * sheen;
        g += (star[1] - g) * starA * cov + (1 - g) * sheen;
        b += (star[2] - b) * starA * cov + (1 - b) * sheen;
      }
      if (dd < 0.5) {
        const cov = Math.min(1, 0.5 - dd);
        r += (diamondC[0] - r) * diaA * cov;
        g += (diamondC[1] - g) * diaA * cov;
        b += (diamondC[2] - b) * diaA * cov;
      }
      // Gold strapwork outlining both motifs, and the faint lattice.
      const sEdge = Math.abs(sd) - strapW;
      const dEdge = Math.abs(dd) - strapW * 0.8;
      let sa = 0;
      if (sEdge < 0.5) sa = Math.max(sa, Math.min(1, 0.5 - sEdge) * 0.42);
      if (dEdge < 0.5) sa = Math.max(sa, Math.min(1, 0.5 - dEdge) * 0.32);
      const lat = Math.min(Math.abs(sx), Math.abs(sy)) - P * 0.02;
      if (lat < 0.5) sa = Math.max(sa, Math.min(1, 0.5 - lat) * 0.08);
      if (sa > 0) {
        r += (strap[0] - r) * sa;
        g += (strap[1] - g) * sa;
        b += (strap[2] - b) * sa;
      }
      const k = (y * w + x) * 3;
      buf[k] = r;
      buf[k + 1] = g;
      buf[k + 2] = b;
    }
  }

  // Opaque lane strips with gold borders, straight from each bridge.
  const laneC = parseColor(Z.lane);
  const wear = parseColor(Z.laneWear);
  const dirtF = new NoiseField(w, h, 3, P, 0.5, seed + 41);
  const hw = 2.35 / 2;
  const top = 0.6;
  const bottom = ARENA_HEIGHT - 0.6;
  for (const bx of BRIDGE_XS) {
    for (let y = Math.floor(top * P); y < Math.ceil(bottom * P); y++) {
      const ay = (y + 0.5) / P;
      const endFade = smoothstep(top, top + 0.4, ay) * (1 - smoothstep(bottom - 0.4, bottom, ay));
      for (let x = Math.floor((bx - hw) * P); x < Math.ceil((bx + hw) * P); x++) {
        const ax = (x + 0.5) / P;
        const u = Math.abs(ax - bx) / hw; // 0 centre .. 1 edge
        if (u >= 1) continue;
        const i = y * w + x;
        const dirt = 0.93 + dirtF.at(x, y) * 0.12;
        const alpha = (u < 0.82 ? 0.97 : 0.97 * (1 - smoothstep(0.82, 1, u))) * endFade;
        p.blend(i, mul3(laneC, dirt), alpha);
        // Centre rut for lane readability.
        if (Math.abs(ax - bx) < 0.05) p.blend(i, wear, 0.3 * endFade);
        // Gold border just inside each edge.
        const border = Math.abs(u - 0.86) * hw;
        if (border < 0.045) p.blend(i, strap, 0.85 * (1 - border / 0.045) * endFade);
      }
    }
    // Worn speckle and light flecks along the strip.
    for (let n = 0; n < 260; n++) {
      const ax = bx + (rand() - 0.5) * hw * 1.5;
      const ay = top + 0.3 + rand() * (bottom - top - 0.6);
      if (Math.abs(ay - RIVER_Y) < RIVER_HALF_WIDTH + 0.2) continue;
      const light = rand() < 0.4;
      p.disc(ax * P, ay * P, (light ? 0.8 : 1.2) * (P / 32), light ? [1, 0.93, 0.67] : wear, light ? 0.4 : 0.55, 0.7, rand() * 3);
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
    if (islamic && look.islamic) paintIslamic(look, p, P, seed, rand);
    else paintClassic(look, p, P, seed, rand);
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
