/**
 * Procedural texture atlases for the VFX pools, painted once at start-up
 * (original art, no image files):
 *
 * - the particle atlas: 512x512, an 8x8 grid of 64px cells (soft disc,
 *   cartoon smoke, flame, sparkle, shockwave ring, streak, snowflake, plus,
 *   ember, petal, bolt segment, chip, swirl, flare, confetti, bone);
 * - the decal atlas: 1024x512, a 4x2 grid of 256px ground marks (scorch,
 *   frost, crack, heal glyph, crater, ring, falling shadow, rune circle).
 *
 * Shapes are painted white/grey on transparent so instance colours tint
 * them; cartoon smoke keeps a darker rim so puffs read as volumes.
 */
import * as THREE from "three";
import { makeRng } from "../../particles";

export const ATLAS_SIZE = 512;
export const ATLAS_GRID = 8;
const CELL_PX = ATLAS_SIZE / ATLAS_GRID;

/** Particle atlas cells (index = row * 8 + column, row 0 at the top). */
export const CELL = {
  SOFT: 0,
  SMOKE_A: 1,
  SMOKE_B: 2,
  SMOKE_C: 3,
  FLAME: 4,
  STAR: 5,
  RING: 6,
  STREAK: 7,
  SNOW: 8,
  PLUS: 9,
  EMBER: 10,
  PETAL: 11,
  BOLT: 12,
  CHIP: 13,
  SWIRL: 14,
  FLARE: 15,
  CONFETTI: 16,
  BONE: 17,
} as const;
export const CELL_COUNT = 18;
export const SMOKE_CELLS: readonly number[] = [CELL.SMOKE_A, CELL.SMOKE_B, CELL.SMOKE_C];

export interface CellRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * UV rectangle of cell `i` in a `grid`x`grid` atlas uploaded with flipY
 * (canvas row 0 at the top ends up at v = 1). The vertex shaders compute
 * the same thing from the cell index.
 */
export function cellRect(i: number, grid = ATLAS_GRID): CellRect {
  const col = i % grid;
  const row = Math.floor(i / grid);
  return { u0: col / grid, v0: (grid - 1 - row) / grid, u1: (col + 1) / grid, v1: (grid - row) / grid };
}

/** Decal atlas cells (4 columns x 2 rows of 256px). */
export const DECAL_CELL = {
  scorch: 0,
  frost: 1,
  crack: 2,
  heal: 3,
  crater: 4,
  ring: 5,
  shadow: 6,
  rune: 7,
} as const;
export type DecalKind = keyof typeof DECAL_CELL;
export const DECAL_COLS = 4;
export const DECAL_ROWS = 2;
const DECAL_PX = 256;

/** UV rectangle of decal cell `i` (flipY, row 0 at the top). */
export function decalRect(i: number): CellRect {
  const col = i % DECAL_COLS;
  const row = Math.floor(i / DECAL_COLS);
  return {
    u0: col / DECAL_COLS,
    v0: (DECAL_ROWS - 1 - row) / DECAL_ROWS,
    u1: (col + 1) / DECAL_COLS,
    v1: (DECAL_ROWS - row) / DECAL_ROWS,
  };
}

type Ctx = CanvasRenderingContext2D;

function radial(ctx: Ctx, cx: number, cy: number, r: number, stops: Array<[number, string]>): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function disc(ctx: Ctx, cx: number, cy: number, r: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function softGlow(ctx: Ctx, cx: number, cy: number, r: number, a = 0.45): void {
  disc(ctx, cx, cy, r, radial(ctx, cx, cy, r, [[0, `rgba(255,255,255,${a})`], [1, "rgba(255,255,255,0)"]]));
}

// --- particle cells -------------------------------------------------------

function paintSoft(ctx: Ctx, cx: number, cy: number, s: number): void {
  disc(ctx, cx, cy, s * 0.48, radial(ctx, cx, cy, s * 0.48, [
    [0, "rgba(255,255,255,1)"],
    [0.22, "rgba(255,255,255,0.85)"],
    [0.5, "rgba(255,255,255,0.38)"],
    [0.75, "rgba(255,255,255,0.1)"],
    [1, "rgba(255,255,255,0)"],
  ]));
}

/** Cartoon cloud: a lumpy silhouette with a dark rim and a lit top-left. */
function paintSmoke(ctx: Ctx, cx: number, cy: number, s: number, seed: number): void {
  const rnd = makeRng(seed);
  const blobs: Array<[number, number, number]> = [[0, 0, s * 0.27]];
  const n = 5 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const d = s * (0.13 + rnd() * 0.06);
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, s * (0.12 + rnd() * 0.07)]);
  }
  ctx.save();
  ctx.filter = "blur(1px)";
  for (const [x, y, r] of blobs) disc(ctx, cx + x, cy + y, r, "#7d7d7d"); // rim
  for (const [x, y, r] of blobs) disc(ctx, cx + x - 1, cy + y - 2, r - s * 0.055, "#d9d9d9"); // body
  for (const [x, y, r] of blobs) {
    if (y < 0 || x < 0) disc(ctx, cx + x - 3, cy + y - 4, r * 0.45, "rgba(255,255,255,0.85)"); // lit side
  }
  ctx.restore();
}

function paintFlame(ctx: Ctx, cx: number, cy: number, s: number): void {
  const h = s * 0.44;
  const w = s * 0.2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.quadraticCurveTo(cx + w * 0.4, cy - h * 0.2, cx + w, cy + h * 0.35);
  ctx.arc(cx, cy + h * 0.35, w, 0, Math.PI);
  ctx.quadraticCurveTo(cx - w * 0.4, cy - h * 0.2, cx, cy - h);
  ctx.closePath();
  ctx.fillStyle = radial(ctx, cx, cy + h * 0.3, h * 1.1, [
    [0, "rgba(255,255,255,1)"],
    [0.45, "rgba(255,255,255,0.8)"],
    [1, "rgba(255,255,255,0.15)"],
  ]);
  ctx.filter = "blur(1px)";
  ctx.fill();
  ctx.restore();
}

function starPath(ctx: Ctx, cx: number, cy: number, points: number, outer: number, inner: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintStar(ctx: Ctx, cx: number, cy: number, s: number): void {
  softGlow(ctx, cx, cy, s * 0.36, 0.5);
  starPath(ctx, cx, cy, 4, s * 0.47, s * 0.07);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

function paintRing(ctx: Ctx, cx: number, cy: number, s: number): void {
  disc(ctx, cx, cy, s * 0.48, radial(ctx, cx, cy, s * 0.48, [
    [0, "rgba(255,255,255,0)"],
    [0.55, "rgba(255,255,255,0.06)"],
    [0.76, "rgba(255,255,255,0.35)"],
    [0.87, "rgba(255,255,255,1)"],
    [0.94, "rgba(255,255,255,0.45)"],
    [1, "rgba(255,255,255,0)"],
  ]));
}

/** Horizontal glow streak with its hot head at +x (velocity-aligned sparks). */
function paintStreak(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.2);
  disc(ctx, 0, 0, s * 0.47, radial(ctx, 0, 0, s * 0.47, [
    [0, "rgba(255,255,255,1)"],
    [0.6, "rgba(255,255,255,0.75)"],
    [1, "rgba(255,255,255,0)"],
  ]));
  ctx.restore();
  // Fade the tail: keep the head (+x) bright.
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const g = ctx.createLinearGradient(cx - s / 2, 0, cx + s / 2, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.75, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  ctx.restore();
}

function paintSnow(ctx: Ctx, cx: number, cy: number, s: number): void {
  softGlow(ctx, cx, cy, s * 0.3, 0.35);
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  const r = s * 0.4;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * r, cy + dy * r);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    for (const f of [0.5, 0.75]) {
      const bx = cx + dx * r * f;
      const by = cy + dy * r * f;
      for (const side of [-1, 1]) {
        const ba = a + side * 0.75;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * r * 0.25, by + Math.sin(ba) * r * 0.25);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function plusPath(ctx: Ctx, cx: number, cy: number, arm: number, thick: number): void {
  roundRect(ctx, cx - thick / 2, cy - arm, thick, arm * 2, thick * 0.3);
  roundRect(ctx, cx - arm, cy - thick / 2, arm * 2, thick, thick * 0.3);
}

function paintPlus(ctx: Ctx, cx: number, cy: number, s: number): void {
  softGlow(ctx, cx, cy, s * 0.46, 0.4);
  ctx.save();
  ctx.fillStyle = "#a8a8a8"; // rim
  plusPath(ctx, cx, cy, s * 0.34, s * 0.25);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  plusPath(ctx, cx, cy, s * 0.29, s * 0.16);
  ctx.fill();
  ctx.restore();
}

function paintEmber(ctx: Ctx, cx: number, cy: number, s: number): void {
  disc(ctx, cx, cy, s * 0.45, radial(ctx, cx, cy, s * 0.45, [
    [0, "rgba(255,255,255,1)"],
    [0.18, "rgba(255,255,255,1)"],
    [0.38, "rgba(255,255,255,0.4)"],
    [1, "rgba(255,255,255,0)"],
  ]));
}

function paintPetal(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.6);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.4);
  ctx.bezierCurveTo(s * 0.3, -s * 0.2, s * 0.22, s * 0.3, 0, s * 0.4);
  ctx.bezierCurveTo(-s * 0.22, s * 0.3, -s * 0.3, -s * 0.2, 0, -s * 0.4);
  ctx.fillStyle = radial(ctx, -s * 0.06, -s * 0.1, s * 0.45, [[0, "#ffffff"], [1, "#b9b9b9"]]);
  ctx.fill();
  ctx.restore();
}

/** A bolt segment: tileable along x, hot core band with a wide glow. */
function paintBolt(ctx: Ctx, x0: number, y0: number, s: number): void {
  const img = ctx.getImageData(x0, y0, s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) {
    const v = Math.abs((y + 0.5) / s - 0.5) * 2; // 0 centre → 1 edge
    const core = v < 0.2 ? 1 : v < 0.32 ? 1 - (v - 0.2) / 0.12 : 0;
    const glow = Math.max(0, 1 - v) ** 2 * 0.55;
    const a = Math.min(1, core + glow);
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const end = Math.min(1, Math.min(u, 1 - u) / 0.08); // soft caps blend joints
      const i = (y * s + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * a * end);
    }
  }
  ctx.putImageData(img, x0, y0);
}

function paintChip(ctx: Ctx, cx: number, cy: number, s: number): void {
  const pts: Array<[number, number]> = [
    [-0.3, -0.18], [0.02, -0.36], [0.33, -0.12], [0.26, 0.26], [-0.08, 0.34], [-0.36, 0.1],
  ];
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(cx + x * s, cy + y * s) : ctx.lineTo(cx + x * s, cy + y * s)));
  ctx.closePath();
  ctx.fillStyle = "#8f8f8f";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#5c5c5c";
  ctx.stroke();
  // Lit top face.
  ctx.beginPath();
  ctx.moveTo(cx - 0.3 * s, cy - 0.18 * s);
  ctx.lineTo(cx + 0.02 * s, cy - 0.36 * s);
  ctx.lineTo(cx + 0.33 * s, cy - 0.12 * s);
  ctx.lineTo(cx + 0.02 * s, cy + 0.02 * s);
  ctx.closePath();
  ctx.fillStyle = "#e6e6e6";
  ctx.fill();
  ctx.restore();
}

function paintSwirl(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const r = s * (0.2 + k * 0.1);
    const a0 = k * 2.1;
    for (let i = 0; i < 12; i++) {
      const f = i / 12;
      ctx.strokeStyle = `rgba(255,255,255,${(0.15 + 0.85 * f).toFixed(3)})`;
      ctx.lineWidth = 1.5 + 3 * f;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0 + f * 2.6, a0 + (f + 1 / 12) * 2.6 + 0.02);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintFlare(ctx: Ctx, cx: number, cy: number, s: number): void {
  paintSoft(ctx, cx, cy, s);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.scale(1, 0.06);
    disc(ctx, 0, 0, s * 0.48, radial(ctx, 0, 0, s * 0.48, [[0, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]]));
    ctx.restore();
  }
  ctx.restore();
}

function paintConfetti(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cx - s * 0.3, cy - s * 0.14, s * 0.6, s * 0.28, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(cx - s * 0.3, cy + s * 0.04, s * 0.6, s * 0.1);
}

function paintBone(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.5);
  const len = s * 0.3;
  const knob = s * 0.09;
  const draw = (fill: string, grow: number): void => {
    ctx.fillStyle = fill;
    ctx.fillRect(-len, -s * 0.06 - grow, len * 2, s * 0.12 + grow * 2);
    for (const x of [-len, len]) for (const y of [-knob * 0.9, knob * 0.9]) disc(ctx, x, y, knob + grow, fill);
  };
  draw("#8c8577", 2.5);
  draw("#ffffff", 0);
  ctx.restore();
}

/** Paint every particle cell into a 512x512 context (cleared first). */
export function paintParticleAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const at = (i: number): [number, number, number, number] => {
    const x0 = (i % ATLAS_GRID) * CELL_PX;
    const y0 = Math.floor(i / ATLAS_GRID) * CELL_PX;
    return [x0, y0, x0 + CELL_PX / 2, y0 + CELL_PX / 2];
  };
  const s = CELL_PX;
  const cell = (i: number, paint: (cx: number, cy: number) => void): void => {
    const [x0, y0, cx, cy] = at(i);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, s, s);
    ctx.clip();
    paint(cx, cy);
    ctx.restore();
  };
  cell(CELL.SOFT, (cx, cy) => paintSoft(ctx, cx, cy, s));
  cell(CELL.SMOKE_A, (cx, cy) => paintSmoke(ctx, cx, cy, s, 11));
  cell(CELL.SMOKE_B, (cx, cy) => paintSmoke(ctx, cx, cy, s, 23));
  cell(CELL.SMOKE_C, (cx, cy) => paintSmoke(ctx, cx, cy, s, 37));
  cell(CELL.FLAME, (cx, cy) => paintFlame(ctx, cx, cy, s));
  cell(CELL.STAR, (cx, cy) => paintStar(ctx, cx, cy, s));
  cell(CELL.RING, (cx, cy) => paintRing(ctx, cx, cy, s));
  cell(CELL.STREAK, (cx, cy) => paintStreak(ctx, cx, cy, s));
  cell(CELL.SNOW, (cx, cy) => paintSnow(ctx, cx, cy, s));
  cell(CELL.PLUS, (cx, cy) => paintPlus(ctx, cx, cy, s));
  cell(CELL.EMBER, (cx, cy) => paintEmber(ctx, cx, cy, s));
  cell(CELL.PETAL, (cx, cy) => paintPetal(ctx, cx, cy, s));
  const [bx, by] = at(CELL.BOLT);
  paintBolt(ctx, bx, by, s);
  cell(CELL.CHIP, (cx, cy) => paintChip(ctx, cx, cy, s));
  cell(CELL.SWIRL, (cx, cy) => paintSwirl(ctx, cx, cy, s));
  cell(CELL.FLARE, (cx, cy) => paintFlare(ctx, cx, cy, s));
  cell(CELL.CONFETTI, (cx, cy) => paintConfetti(ctx, cx, cy, s));
  cell(CELL.BONE, (cx, cy) => paintBone(ctx, cx, cy, s));
}

// --- decal cells -----------------------------------------------------------

function paintScorch(ctx: Ctx, cx: number, cy: number, s: number): void {
  const rnd = makeRng(91);
  // Soot streaks radiating out of the blast.
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const len = s * (0.3 + rnd() * 0.17);
    ctx.strokeStyle = `rgba(28,18,12,${(0.25 + rnd() * 0.3).toFixed(3)})`;
    ctx.lineWidth = 3 + rnd() * 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * s * 0.1, cy + Math.sin(a) * s * 0.1);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * s * 0.2;
    const r = s * (0.12 + rnd() * 0.16);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    disc(ctx, x, y, r, radial(ctx, x, y, r, [[0, "rgba(22,14,10,0.55)"], [1, "rgba(22,14,10,0)"]]));
  }
  disc(ctx, cx, cy, s * 0.24, radial(ctx, cx, cy, s * 0.24, [[0, "rgba(12,8,6,0.85)"], [1, "rgba(12,8,6,0)"]]));
  // Glowing cinders left in the middle.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * s * 0.16;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + rnd() * 3, "rgba(255,140,40,0.85)");
  }
}

function paintFrost(ctx: Ctx, cx: number, cy: number, s: number): void {
  const rnd = makeRng(57);
  disc(ctx, cx, cy, s * 0.47, radial(ctx, cx, cy, s * 0.47, [
    [0, "rgba(225,246,255,0.42)"],
    [0.7, "rgba(210,240,255,0.55)"],
    [0.9, "rgba(240,252,255,0.9)"],
    [1, "rgba(240,252,255,0)"],
  ]));
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
    const len = s * (0.3 + rnd() * 0.15);
    ctx.lineWidth = 2 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * s * 0.06, cy + Math.sin(a) * s * 0.06);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
    for (const f of [0.55, 0.8]) {
      const bx = cx + Math.cos(a) * len * f;
      const by = cy + Math.sin(a) * len * f;
      for (const side of [-1, 1]) {
        const ba = a + side * 0.6;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * s * 0.05, by + Math.sin(ba) * s * 0.05);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function paintCrack(ctx: Ctx, cx: number, cy: number, s: number): void {
  const rnd = makeRng(73);
  disc(ctx, cx, cy, s * 0.16, radial(ctx, cx, cy, s * 0.16, [[0, "rgba(20,16,12,0.7)"], [1, "rgba(20,16,12,0)"]]));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    let px = x;
    let py = y;
    const steps = 4;
    ctx.strokeStyle = "rgba(24,18,14,0.85)";
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.7;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
      ctx.lineTo(px, py);
      if (depth > 0 && rnd() < 0.35) branch(px, py, a + (rnd() < 0.5 ? -0.8 : 0.8), len * 0.45, w * 0.6, depth - 1);
    }
    ctx.stroke();
  };
  for (let i = 0; i < 7; i++) branch(cx, cy, (i / 7) * Math.PI * 2 + rnd() * 0.4, s * (0.32 + rnd() * 0.12), 5, 2);
  ctx.restore();
}

function paintHeal(ctx: Ctx, cx: number, cy: number, s: number, arabic: boolean): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    disc(ctx, cx + Math.cos(a) * s * 0.385, cy + Math.sin(a) * s * 0.385, 4, "rgba(255,255,255,0.95)");
  }
  if (arabic) {
    // An eight-point star rosette for the Islamic edition.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    starPath(ctx, cx, cy, 8, s * 0.3, s * 0.2);
    ctx.fill();
  } else {
    softGlow(ctx, cx, cy, s * 0.3, 0.3);
  }
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  plusPath(ctx, cx, cy, s * 0.17, s * 0.11);
  ctx.fill();
  ctx.restore();
}

function paintCrater(ctx: Ctx, cx: number, cy: number, s: number): void {
  const rnd = makeRng(29);
  disc(ctx, cx, cy, s * 0.46, radial(ctx, cx, cy, s * 0.46, [
    [0, "rgba(30,24,18,0.85)"],
    [0.55, "rgba(48,38,28,0.75)"],
    [0.75, "rgba(150,130,104,0.75)"],
    [0.88, "rgba(120,100,78,0.45)"],
    [1, "rgba(120,100,78,0)"],
  ]));
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const d = s * (0.33 + rnd() * 0.12);
    const r = 3 + rnd() * 6;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, "rgba(92,78,62,0.9)");
    disc(ctx, cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1.5, r * 0.6, "rgba(176,158,130,0.9)");
  }
}

function paintDecalRing(ctx: Ctx, cx: number, cy: number, s: number): void {
  disc(ctx, cx, cy, s * 0.48, radial(ctx, cx, cy, s * 0.48, [
    [0, "rgba(255,255,255,0.1)"],
    [0.7, "rgba(255,255,255,0.16)"],
    [0.8, "rgba(255,255,255,0.55)"],
    [0.86, "rgba(255,255,255,1)"],
    [0.94, "rgba(255,255,255,1)"],
    [1, "rgba(255,255,255,0)"],
  ]));
}

function paintShadow(ctx: Ctx, cx: number, cy: number, s: number): void {
  disc(ctx, cx, cy, s * 0.48, radial(ctx, cx, cy, s * 0.48, [
    [0, "rgba(0,0,0,0.85)"],
    [0.6, "rgba(0,0,0,0.6)"],
    [1, "rgba(0,0,0,0)"],
  ]));
}

function paintRune(ctx: Ctx, cx: number, cy: number, s: number, arabic: boolean): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  if (arabic) {
    ctx.lineWidth = 3;
    starPath(ctx, cx, cy, 8, s * 0.34, s * 0.25, Math.PI / 8);
    ctx.stroke();
  } else {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = s * 0.37;
      const r1 = s * (i % 3 === 0 ? 0.43 : 0.41);
      ctx.lineWidth = i % 3 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  disc(ctx, cx, cy, s * 0.34, radial(ctx, cx, cy, s * 0.34, [[0, "rgba(255,255,255,0.05)"], [1, "rgba(255,255,255,0.22)"]]));
  ctx.restore();
}

/** Paint the 1024x512 decal atlas (cleared first). */
export function paintDecalAtlas(ctx: Ctx, arabic: boolean): void {
  ctx.clearRect(0, 0, DECAL_COLS * DECAL_PX, DECAL_ROWS * DECAL_PX);
  const s = DECAL_PX;
  const cell = (i: number, paint: (cx: number, cy: number) => void): void => {
    const x0 = (i % DECAL_COLS) * s;
    const y0 = Math.floor(i / DECAL_COLS) * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, s, s);
    ctx.clip();
    paint(x0 + s / 2, y0 + s / 2);
    ctx.restore();
  };
  cell(DECAL_CELL.scorch, (cx, cy) => paintScorch(ctx, cx, cy, s));
  cell(DECAL_CELL.frost, (cx, cy) => paintFrost(ctx, cx, cy, s));
  cell(DECAL_CELL.crack, (cx, cy) => paintCrack(ctx, cx, cy, s));
  cell(DECAL_CELL.heal, (cx, cy) => paintHeal(ctx, cx, cy, s, arabic));
  cell(DECAL_CELL.crater, (cx, cy) => paintCrater(ctx, cx, cy, s));
  cell(DECAL_CELL.ring, (cx, cy) => paintDecalRing(ctx, cx, cy, s));
  cell(DECAL_CELL.shadow, (cx, cy) => paintShadow(ctx, cx, cy, s));
  cell(DECAL_CELL.rune, (cx, cy) => paintRune(ctx, cx, cy, s, arabic));
}

function canvasTexture(w: number, h: number, paint: (ctx: Ctx) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (ctx) paint(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.userData.shared = true;
  return tex;
}

/** The particle atlas texture (created once, at FX init). */
export function makeParticleAtlas(): THREE.CanvasTexture {
  return canvasTexture(ATLAS_SIZE, ATLAS_SIZE, paintParticleAtlas);
}

/** The decal atlas texture (created once, at FX init). */
export function makeDecalAtlas(arabic: boolean): THREE.CanvasTexture {
  return canvasTexture(DECAL_COLS * DECAL_PX, DECAL_ROWS * DECAL_PX, (ctx) => paintDecalAtlas(ctx, arabic));
}
