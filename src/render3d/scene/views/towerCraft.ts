/**
 * Hand-built crown towers ("Toy Tournament"), both editions.
 *
 * Classic: a battered ashlar keep on a stepped plinth, corner quoins, arrow
 * slits, an arched timber gate on the camera face, a corbelled parapet with
 * merlons, four bartizan turrets under smooth tiled team-colour cones with
 * gold finials, a team banner, a plank deck, and (king) a dais under a team
 * canopy, a crest and a banded cannon.
 *
 * Golden Age: the same massing in sandstone or marble ashlar, a horseshoe
 * gate with striped voussoirs, stepped Moorish merlons, a zellige band,
 * team onion domes on the turrets and a domed qubba over the king.
 *
 * Every tower is ONE mesh and one draw (see "The keep: one mesh, one draw"),
 * with ambient occlusion painted into the vertices: darker toward the
 * ground, under overhangs and inside recesses.
 *
 * The small Sculpt helpers at the top are shared with the arena scenery.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { paintedToon } from "../../characters3d";
import type { BrickVariant } from "../../arenaLooks";
import { INK, OUTLINE_CSS_PX, fitInk, smoothedNormals } from "../../outlineMaterial";
import { TOWER_GOLD, TOWER_GOLD_DARK, type TowerFlair, type TowerStyle, type YZ } from "./towerStyles";

const C = new THREE.Color();
const HSL = { h: 0, s: 0, l: 0 };

/** `hex` with its lightness and saturation scaled. */
export function tone(hex: number, l = 1, s = 1): number {
  C.set(hex).getHSL(HSL);
  return C.setHSL(HSL.h, Math.min(1, HSL.s * s), Math.min(1, HSL.l * l)).getHex();
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

type Shade = (x: number, y: number, z: number, ny: number) => number;

/** Accumulates painted geometry into one vertex-coloured mesh. */
export class Sculpt {
  private parts: THREE.BufferGeometry[] = [];
  verts = 0;
  constructor(private readonly shade: Shade = () => 1) {}

  /** Add `geo` (consumed) in `color` at (x, y, z), turned `ry` about Y. Returns its vertex count. */
  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, ry = 0, shade: Shade | null = null): number {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const n = pos.count;
    const col = new Float32Array(n * 3);
    C.set(color);
    const fn = shade ?? this.shade;
    for (let i = 0; i < n; i++) {
      const f = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 0);
      col[i * 3] = C.r * f;
      col[i * 3 + 1] = C.g * f;
      col[i * 3 + 2] = C.b * f;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", pos);
    if (nor) out.setAttribute("normal", nor);
    out.setAttribute("uv", g.getAttribute("uv") ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (!nor) out.computeVertexNormals();
    this.parts.push(out);
    this.verts += n;
    return n;
  }

  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, ry = 0, shade: Shade | null = null): number {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry, shade);
  }

  cyl(rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 10, shade: Shade | null = null): number {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, 0, shade);
  }

  /** One mesh for everything added so far (null when empty). */
  mesh(material: THREE.Material, name = "sculpt"): THREE.Mesh | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.userData.noBatch = true; // already one draw; the batcher would repaint it
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}

/** A lit, vertex-painted toon material (optionally textured). */
export function sculptMaterial(map: THREE.Texture | null = null): THREE.MeshToonMaterial {
  return paintedToon(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, map }));
}

/**
 * A square frustum from half-width `hb` at y0 to `ht` at y1 (non-indexed,
 * flat-shaded). With `tile` > 0 its sides carry UVs that repeat every
 * `tile` world units, continuous up stacked segments.
 */
export function frustum(hb: number, ht: number, y0: number, y1: number, tile = 0, caps = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const push = (p: number[], n: number[], u: number, v: number): void => {
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push(u, v);
  };
  const slope = (hb - ht) / (y1 - y0);
  const nl = Math.hypot(1, slope);
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const rot = (x: number, y: number, z: number): number[] => [x * cs + z * sn, y, -x * sn + z * cs];
    const a = rot(-hb, y0, hb);
    const b = rot(hb, y0, hb);
    const c = rot(ht, y1, ht);
    const d = rot(-ht, y1, ht);
    const n = rot(0, slope / nl, 1 / nl);
    const uw = tile ? (2 * hb) / tile : 1;
    const v0 = tile ? y0 / tile : 0;
    const v1 = tile ? y1 / tile : 1;
    const uo = k * 0.37;
    const uc = uo + (uw * (hb + ht)) / (2 * hb);
    const ud = uo + (uw * (hb - ht)) / (2 * hb);
    push(a, n, uo, v0); push(b, n, uo + uw, v0); push(c, n, uc, v1);
    push(a, n, uo, v0); push(c, n, uc, v1); push(d, n, ud, v1);
  }
  if (caps) {
    const up = [0, 1, 0];
    const dn = [0, -1, 0];
    const t = [[-ht, y1, ht], [ht, y1, ht], [ht, y1, -ht], [-ht, y1, -ht]];
    push(t[0], up, 0, 0); push(t[1], up, 1, 0); push(t[2], up, 1, 1);
    push(t[0], up, 0, 0); push(t[2], up, 1, 1); push(t[3], up, 0, 1);
    const q = [[-hb, y0, -hb], [hb, y0, -hb], [hb, y0, hb], [-hb, y0, hb]];
    push(q[0], dn, 0, 0); push(q[1], dn, 1, 0); push(q[2], dn, 1, 1);
    push(q[0], dn, 0, 0); push(q[2], dn, 1, 1); push(q[3], dn, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  return g;
}

// ---- Ashlar texture -----------------------------------------------------------

const STONE_BASE: Record<BrickVariant, string> = {
  sand: "#cfc6b4",
  pink: "#d873cf",
  blue: "#93a9d1",
  grey: "#b4bac4",
  marble: "#dcd6ea",
  dark: "#52525e",
  ice: "#cfe4f2",
  moss: "#8ba269",
  bone: "#e4dac4",
};
const ashlarCache = new Map<BrickVariant, THREE.CanvasTexture>();

/**
 * Painted ashlar: five courses of uneven, round-cornered blocks, each with
 * its own tone, a lit top-left bevel, a shaded bottom-right one, pits and
 * the odd mossy or chipped stone, over dark recessed mortar.
 */
export function ashlarTexture(variant: BrickVariant): THREE.CanvasTexture {
  const hit = ashlarCache.get(variant);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  let seed = 7 + variant.length * 131;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = new THREE.Color(STONE_BASE[variant]);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const css = (l: number, s = 1, dh = 0): string =>
    `hsl(${((hsl.h + dh) * 360).toFixed(1)},${(Math.min(1, hsl.s * s) * 100).toFixed(1)}%,${(Math.min(0.97, hsl.l * l) * 100).toFixed(1)}%)`;
  // Mortar bed: dark, a little cooler than the stone.
  ctx.fillStyle = css(0.42, 0.9, -0.02);
  ctx.fillRect(0, 0, S, S);
  const rows = 5;
  const rh = S / rows;
  const gap = 5;
  const rr = (x: number, y: number, w: number, h: number, r: number): void => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  };
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    // Uneven block widths that still close the row exactly (it tiles in u).
    const widths: number[] = [];
    let left = S;
    while (left > 0) {
      let w = 52 + Math.floor(rand() * 44);
      if (left - w < 40) w = left;
      widths.push(w);
      left -= w;
    }
    let x = row % 2 ? -26 : 0;
    for (const w of widths) {
      const l = 0.9 + rand() * 0.2;
      const dh = (rand() - 0.5) * 0.03;
      const mossy = rand() < 0.1;
      for (const ox of [0, S]) {
        const bx = x + ox + gap / 2;
        const by = y + gap / 2;
        const bw = w - gap;
        const bh = rh - gap;
        if (bx > S || bx + bw < 0) continue;
        // Shaded bottom-right bevel, the face, then the lit top-left bevel.
        ctx.fillStyle = css(l * 0.72, 0.95, dh);
        rr(bx, by, bw, bh, 7);
        ctx.fillStyle = css(l * 1.16, 0.8, dh);
        rr(bx, by, bw - 3, bh - 4, 7);
        ctx.fillStyle = mossy ? css(l * 0.92, 1.5, dh + 0.09) : css(l, 1, dh);
        rr(bx + 3, by + 3.5, bw - 6, bh - 7.5, 5);
      }
      x += w;
    }
  }
  // Pits and flecks: tiny darker and lighter dots keep big blocks from reading flat.
  for (let i = 0; i < 260; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 0.8 + rand() * 1.8;
    ctx.fillStyle = rand() < 0.6 ? "rgba(40,34,30,0.16)" : "rgba(255,250,240,0.2)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  ashlarCache.set(variant, tex);
  return tex;
}

// ---- The keep: one mesh, one draw -------------------------------------------------
//
// A crown tower is sculpted into ONE non-indexed mesh (KeepSculpt) drawn by
// ONE material (keepMaterial). Per-vertex flags tell the shader what each
// part is:
//   aFlags.x  share of the live team colour (roofs, domes, trim, banner, flag)
//   aFlags.y  texture slot (KEEP_TEX: ashlar, crack decal, roof tiles, zellige)
//   aFlags.z  1 on silhouette-ink hull vertices
//   aFlags.w  self-glow (ember cracks, neon strips, lit slits; below bloom)
//   aStage    the damage stages [from, to) the part shows in
// so the team repaints by a uniform (colour-blind palette included), damage
// swaps merlons, banners and roof patches by a uniform, and the ink costs no
// extra draw. Parts are grouped by collapse chunk, so a falling tower splits
// into a few rigid pieces by draw range.

/** Collapse chunks, in vertex order. "base" (plinth + lower wall) stays as the ruin's stump. */
export type KeepChunk = "base" | "upper" | "front" | "back" | "canopy";
export const KEEP_CHUNKS: readonly KeepChunk[] = ["base", "upper", "front", "back", "canopy"];

/** Texture slots a keep part samples (aFlags.y). */
export const KEEP_TEX = { none: 0, ashlar: 1, crack: 2, roof: 3, band: 4 } as const;

/** Damage stage no tower reaches: "until the end". */
export const STAGE_END = 99;

/** Silhouette ink (art bible: #1F1A2E, 1.6 CSS px, depth-pushed so only the outline survives). */
export const TOWER_INK = 0x1f1a2e;
export const TOWER_INK_PX = 1.6;
/** How far (world units) the ink hull is pushed away from the camera. */
export const TOWER_INK_DEPTH = 0.45;

export interface PartOpts {
  /** Share of the live team colour, 0..1 (the vertex colour then holds only the shade). */
  team?: number;
  /** KEEP_TEX slot. */
  tex?: number;
  /** Add a silhouette-ink hull for this part. */
  ink?: boolean;
  /** Damage stages it shows in: from <= stage < to. */
  from?: number;
  to?: number;
  /** Self-glow (0..1 of its albedo added as emission; keep under the bloom threshold). */
  glow?: number;
  /** UV scale (u, v). */
  uv?: [number, number];
}

const VERT_FLOATS = { position: 3, normal: 3, uv: 2, color: 3, aFlags: 4, aStage: 2 } as const;

/** Accumulates painted, flagged parts per chunk into one keep mesh. */
export class KeepSculpt {
  /** The chunk parts are added to. */
  chunk: KeepChunk = "base";
  private parts = new Map<KeepChunk, THREE.BufferGeometry[]>();
  verts = 0;
  constructor(private readonly shade: Shade = () => 1) {}

  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, ry = 0, shade: Shade | null = null, o: PartOpts = {}): number {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (ry) g.rotateY(ry);
    if (x || y || z) g.translate(x, y, z);
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const n = pos.count;
    const col = new Float32Array(n * 3);
    C.set(color);
    const fn = shade ?? this.shade;
    for (let i = 0; i < n; i++) {
      const f = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i));
      col[i * 3] = C.r * f;
      col[i * 3 + 1] = C.g * f;
      col[i * 3 + 2] = C.b * f;
    }
    const uvSrc = g.getAttribute("uv");
    const uv = new Float32Array(n * 2);
    const [us, vs] = o.uv ?? [1, 1];
    if (uvSrc) {
      for (let i = 0; i < n; i++) {
        uv[i * 2] = uvSrc.getX(i) * us;
        uv[i * 2 + 1] = uvSrc.getY(i) * vs;
      }
    }
    const from = o.from ?? 0;
    const to = o.to ?? STAGE_END;
    const body = this.part(
      new Float32Array(pos.array as ArrayLike<number>),
      new Float32Array(nor.array as ArrayLike<number>),
      uv,
      col,
      [o.team ?? 0, o.tex ?? 0, 0, o.glow ?? 0],
      [from, to],
    );
    this.push(body);
    let added = n;
    if (o.ink) {
      // The hull: the same surface wound inside out, carrying smoothed
      // normals to push along (so hard edges never tear into fins).
      const sm = smoothedNormals(g);
      const hp = new Float32Array(n * 3);
      const hn = new Float32Array(n * 3);
      for (let t = 0; t + 2 < n; t += 3) {
        for (const [dst, src] of [[t, t], [t + 1, t + 2], [t + 2, t + 1]]) {
          hp[dst * 3] = pos.getX(src);
          hp[dst * 3 + 1] = pos.getY(src);
          hp[dst * 3 + 2] = pos.getZ(src);
          hn[dst * 3] = sm[src * 3];
          hn[dst * 3 + 1] = sm[src * 3 + 1];
          hn[dst * 3 + 2] = sm[src * 3 + 2];
        }
      }
      this.push(this.part(hp, hn, new Float32Array(n * 2), new Float32Array(n * 3), [0, 0, 1, 0], [from, to]));
      added += n;
    }
    g.dispose();
    return added;
  }

  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, ry = 0, shade: Shade | null = null, o: PartOpts = {}): number {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry, shade, o);
  }

  cyl(rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 10, shade: Shade | null = null, o: PartOpts = {}): number {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, 0, shade, o);
  }

  private part(p: Float32Array, n: Float32Array, uv: Float32Array, c: Float32Array, flags: number[], stage: number[]): THREE.BufferGeometry {
    const count = p.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const f = new Float32Array(count * 4);
    const s = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      f.set(flags, i * 4);
      s.set(stage, i * 2);
    }
    g.setAttribute("aFlags", new THREE.BufferAttribute(f, 4));
    g.setAttribute("aStage", new THREE.BufferAttribute(s, 2));
    return g;
  }

  private push(g: THREE.BufferGeometry): void {
    let list = this.parts.get(this.chunk);
    if (!list) this.parts.set(this.chunk, (list = []));
    list.push(g);
    this.verts += g.getAttribute("position").count;
  }

  /** Merge everything into one geometry, chunk by chunk; ranges are in vertices. */
  build(): { geometry: THREE.BufferGeometry; ranges: Map<KeepChunk, { start: number; count: number }> } {
    const all: THREE.BufferGeometry[] = [];
    const ranges = new Map<KeepChunk, { start: number; count: number }>();
    let start = 0;
    for (const chunk of KEEP_CHUNKS) {
      const list = this.parts.get(chunk) ?? [];
      let count = 0;
      for (const g of list) count += g.getAttribute("position").count;
      if (count) ranges.set(chunk, { start, count });
      start += count;
      all.push(...list);
    }
    const merged = all.length ? mergeGeometries(all, false) : new THREE.BufferGeometry();
    for (const g of all) g.dispose();
    this.parts.clear();
    merged.computeBoundingSphere();
    return { geometry: merged!, ranges };
  }
}

/** Floats a keep vertex carries (for budgets and tests). */
export const KEEP_VERT_FLOATS = Object.values(VERT_FLOATS).reduce((a, b) => a + b, 0);

// ---- Keep textures ---------------------------------------------------------------

function canvas(w: number, h = w): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

let roofTex: THREE.CanvasTexture | null = null;

/**
 * Scalloped roof tiles as a grey multiplier (the team colour comes from the
 * shader): rounded tile ends, each a little lit on top, over a dark seam.
 * Used for the Classic cones and, as fish-scale glaze, the Golden Age domes.
 */
export function roofTileTexture(): THREE.CanvasTexture {
  if (roofTex) return roofTex;
  const S = 64;
  const { c, ctx } = canvas(S);
  const v = (k: number): string => `rgb(${Math.round(k * 255)},${Math.round(k * 255)},${Math.round(k * 255)})`;
  ctx.fillStyle = v(0.62);
  ctx.fillRect(0, 0, S, S);
  const rows = 2;
  const cols = 2;
  const rh = S / rows;
  const cw = S / cols;
  // Bottom row first: each tile's rounded end overlaps the row below it.
  for (let r = rows; r >= -1; r--) {
    for (let k = -1; k <= cols; k++) {
      const x = k * cw + (r % 2 ? cw / 2 : 0);
      const y = r * rh;
      const g = ctx.createLinearGradient(0, y - rh * 0.3, 0, y + rh * 0.9);
      g.addColorStop(0, v(0.84));
      g.addColorStop(0.55, v(1.0));
      g.addColorStop(1, v(0.9));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x + 1.5, y - rh * 0.4);
      ctx.lineTo(x + 1.5, y + rh * 0.45);
      ctx.arc(x + cw / 2, y + rh * 0.45, cw / 2 - 1.5, Math.PI, 0, true);
      ctx.lineTo(x + cw - 1.5, y - rh * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  roofTex = tex;
  return tex;
}

let bandTex: THREE.CanvasTexture | null = null;

/**
 * Zellige band for the Golden Age parapet and turret drums: turquoise tile
 * with gold strapwork borders and cream eight-point stars around
 * terracotta hearts (THEME colours, never a team colour).
 */
export function zelligeTexture(): THREE.CanvasTexture {
  if (bandTex) return bandTex;
  const W = 128;
  const H = 32;
  const { c, ctx } = canvas(W, H);
  const hex = (n: number): string => "#" + n.toString(16).padStart(6, "0");
  ctx.fillStyle = hex(0x168f8c);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hex(0xe2b84c);
  ctx.fillRect(0, 0, W, 5);
  ctx.fillRect(0, H - 5, W, 5);
  ctx.fillStyle = hex(0x8a6a22);
  ctx.fillRect(0, 5, W, 1);
  ctx.fillRect(0, H - 6, W, 1);
  const star = (cx: number, cy: number, r: number, fill: string): void => {
    ctx.fillStyle = fill;
    for (const rot of [0, Math.PI / 4]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.restore();
    }
  };
  for (let i = 0; i < 4; i++) {
    const cx = i * 32 + 16;
    star(cx, H / 2, 9.5, "#f4ead2");
    star(cx, H / 2, 5, hex(0xb85c38));
    // Small gold diamonds between the stars.
    ctx.fillStyle = hex(0xe2b84c);
    ctx.save();
    ctx.translate(cx + 16, H / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  bandTex = tex;
  return tex;
}

const crackCache = new Map<number, THREE.CanvasTexture>();

/**
 * A transparent sheet of branching masonry cracks: dark splits with a
 * pale chipped lip (seeded, so stable). Alpha-tested in the keep shader.
 */
export function crackTexture(seed = 17): THREE.CanvasTexture {
  const hit = crackCache.get(seed);
  if (hit) return hit;
  const S = 128;
  const { c, ctx } = canvas(S);
  let st = seed * 9973 + 1;
  const rand = (): number => {
    st = (st * 1664525 + 1013904223) >>> 0;
    return st / 4294967296;
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const crack = (x: number, y: number, angle: number, steps: number, width: number): void => {
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 1.1;
      const len = 10 + rand() * 12;
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      pts.push([x, y]);
      if (i > 1 && rand() < 0.35) crack(x, y, angle + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.5), 2 + Math.floor(rand() * 2), width * 0.6);
    }
    for (const [style, w, dx] of [["rgba(255,244,226,1)", width + 3, 1.8], ["rgba(30,20,14,1)", width, 0]] as const) {
      ctx.strokeStyle = style;
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        ctx.lineWidth = w * (1 - (i / pts.length) * 0.55);
        if (i === 0) ctx.moveTo(px + dx, py + dx);
        else ctx.lineTo(px + dx, py + dx);
      });
      ctx.stroke();
    }
  };
  // Bold splits from the top of the sheet most of the way down: walls are
  // seen small and at a slant, so hairlines would vanish.
  for (let i = 0; i < 2; i++) crack(S * (0.3 + i * 0.4) + (rand() - 0.5) * 14, 2, Math.PI / 2 + (rand() - 0.5) * 0.6, 6, 13);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Alpha-tested: mipmaps would average the thin splits away at battle zoom.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.userData.shared = true;
  crackCache.set(seed, tex);
  return tex;
}

// ---- The keep material ----------------------------------------------------------

/** Ink uniforms that are the same for every keep. */
const KEEP_SHARED = {
  uTowerInk: { value: new THREE.Color(TOWER_INK) },
  uInkScale: { value: TOWER_INK_PX / OUTLINE_CSS_PX },
  uInkDepth: { value: TOWER_INK_DEPTH },
};

export interface KeepUniforms {
  /** The live team colour roofs, domes, trim, banner and flag wear. */
  uTeam: { value: THREE.Color };
  /** Damage stage shown (0 whole, 1, 2). */
  uStage: { value: number };
}

const KEEP_VERT_PARS = /* glsl */ `
  attribute vec4 aFlags;
  attribute vec2 aStage;
  uniform float uStage;
  varying vec4 vKeep;
`;
const KEEP_HIDE = /* glsl */ `uStage < aStage.x || uStage >= aStage.y`;

/**
 * The keep's material: a painted toon (ramp + rim, like every sculpt) whose
 * shader reads the part flags (see the section header). One per tower, so
 * its team colour and damage stage are its own; every keep shares one
 * program. `depth` is the matching shadow-pass material (ink hulls and
 * decals cast nothing; lost parts stop casting).
 */
export function keepMaterial(map: THREE.Texture, team: number): { material: THREE.MeshToonMaterial; depth: THREE.MeshDepthMaterial; uniforms: KeepUniforms } {
  const uniforms: KeepUniforms = { uTeam: { value: new THREE.Color(team) }, uStage: { value: 0 } };
  const mat = sculptMaterial(map);
  const toonHook = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    toonHook(sh, r);
    Object.assign(sh.uniforms, INK, KEEP_SHARED, uniforms, {
      uRoofTex: { value: roofTileTexture() },
      uCrackTex: { value: crackTexture() },
      uBandTex: { value: zelligeTexture() },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         ${KEEP_VERT_PARS}
         uniform float uInkPx;
         uniform vec2 uInkViewport;
         uniform float uInkOn;
         uniform float uInkScale;
         uniform float uInkDepth;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
         vKeep = aFlags;
         if (${KEEP_HIDE}) {
           gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
         } else if (aFlags.z > 0.5) {
           if (uInkOn < 0.5) {
             gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
           } else {
             vec3 inkN = normalize(normalMatrix * normal);
             vec2 inkC = (projectionMatrix * vec4(inkN, 0.0)).xy;
             float inkL = length(inkC);
             if (inkL > 1e-5) gl_Position.xy += (inkC / inkL) * uInkPx * uInkScale * 2.0 / uInkViewport * gl_Position.w;
             gl_Position.z += uInkDepth * abs(projectionMatrix[2][2]) * gl_Position.w;
           }
         }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec4 vKeep;
         uniform vec3 uTeam;
         uniform vec3 uTowerInk;
         uniform sampler2D uRoofTex;
         uniform sampler2D uCrackTex;
         uniform sampler2D uBandTex;`,
      )
      .replace(
        "#include <map_fragment>",
        `{
           // Sample every slot unconditionally (no texture reads in divergent flow).
           vec4 tAsh = texture2D( map, vMapUv );
           vec4 tCrack = texture2D( uCrackTex, vMapUv );
           vec4 tRoof = texture2D( uRoofTex, vMapUv );
           vec4 tBand = texture2D( uBandTex, vMapUv );
           float code = floor( vKeep.y + 0.5 );
           if ( code == 2.0 && tCrack.a < 0.4 ) discard;
           vec3 t = vec3( 1.0 );
           t = mix( t, tAsh.rgb, float( code == 1.0 ) );
           t = mix( t, tCrack.rgb, float( code == 2.0 ) );
           t = mix( t, tRoof.rgb, float( code == 3.0 ) );
           t = mix( t, tBand.rgb, float( code == 4.0 ) );
           diffuseColor.rgb *= t;
         }`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= mix( vec3( 1.0 ), uTeam, vKeep.x );")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vKeep.w;")
      .replace("#include <dithering_fragment>", "if ( vKeep.z > 0.5 ) gl_FragColor = vec4( uTowerInk, 1.0 );\n #include <dithering_fragment>");
  };
  mat.customProgramCacheKey = () => "tower-keep-v1";

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uStage = uniforms.uStage;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${KEEP_VERT_PARS}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
         vKeep = aFlags;
         if (aFlags.z > 0.5 || abs(aFlags.y - 2.0) < 0.5 || ${KEEP_HIDE}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
      );
  };
  depth.customProgramCacheKey = () => "tower-keep-depth-v1";
  return { material: mat, depth, uniforms };
}

/** The finished keep mesh (cast and receive shadow; ink sized per renderer). */
export function keepMesh(s: KeepSculpt, map: THREE.Texture, team: number, name = "keep"): {
  mesh: THREE.Mesh;
  uniforms: KeepUniforms;
  ranges: Map<KeepChunk, { start: number; count: number }>;
} {
  const { geometry, ranges } = s.build();
  const { material, depth, uniforms } = keepMaterial(map, team);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.customDepthMaterial = depth;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.noBatch = true;
  mesh.onBeforeRender = fitInk;
  mesh.userData.keepUniforms = uniforms;
  return { mesh, uniforms, ranges };
}

// ---- Shared shapes ---------------------------------------------------------------

/** A smooth bell-cast cone (lathe): flared eave lip up to the apex. */
function bellCone(rb: number, h: number, seg = 18, rows = 6): THREE.LatheGeometry {
  const pts = [new THREE.Vector2(rb + 0.05, -0.05)];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    pts.push(new THREE.Vector2(Math.max(0.002, rb * Math.pow(1 - t, 1.15)), t * h));
  }
  return new THREE.LatheGeometry(pts, seg);
}

/** A slice of the same cone, pushed out a hair (the missing-tiles patch). */
function coneSlice(rb: number, h: number, t0: number, t1: number, phi0: number, phiLen: number, grow = 0.018): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    pts.push(new THREE.Vector2(Math.max(0.002, rb * Math.pow(1 - t, 1.15)) + grow, t * h));
  }
  return new THREE.LatheGeometry(pts, 6, phi0, phiLen);
}

/** A plane at (x, y, z) facing out from a wall face (`face` 0 +z, 1 +x, 2 -z, 3 -x), leaning with the batter. */
function facePlane(w: number, h: number, face: number, along: number, y: number, out: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (lean) g.rotateX(-lean);
  g.translate(along, y, out);
  g.rotateY((face * Math.PI) / 2);
  return g;
}

/** World-space (keep-local) point on face `face` at `along` across it and `out` from the centre. */
function onFace(face: number, along: number, out: number): [number, number] {
  const a = (face * Math.PI) / 2;
  return [along * Math.cos(a) + out * Math.sin(a), -along * Math.sin(a) + out * Math.cos(a)];
}

/** The face index (0 +z, 2 -z) toward a z sign. */
function zFace(sign: number): number {
  return sign > 0 ? 0 : 2;
}

/** A horseshoe arch outline (more than a half circle, narrower at the springing). */
function horseshoe(w: number, h: number, inset = 0): THREE.Shape {
  const r = w / 2 - inset;
  const springY = h - w / 2;
  const s = new THREE.Shape();
  const open = 0.28; // radians the horseshoe closes in below the centre line
  const nx = r * Math.cos(open);
  s.moveTo(-nx + inset * 0.2, inset);
  s.lineTo(-nx + inset * 0.2, springY - r * Math.sin(open));
  s.absarc(0, springY, r, Math.PI + open, -open, true);
  s.lineTo(nx - inset * 0.2, inset);
  s.closePath();
  return s;
}

/** Add an Object3D's meshes (baked to keep space at x, y, z, scaled) via `paint`, then dispose it. */
function addObject(
  s: KeepSculpt,
  obj: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  scale: number,
  paint: (index: number, mesh: THREE.Mesh) => { color: number; opts?: PartOpts; shade?: Shade } | null,
): void {
  obj.position.set(x, y, z);
  obj.scale.setScalar(scale);
  obj.updateMatrixWorld(true);
  let i = 0;
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const p = paint(i++, m);
    if (p) s.add(m.geometry.clone().applyMatrix4(m.matrixWorld), p.color, 0, 0, 0, 0, p.shade ?? null, p.opts ?? {});
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) mm.dispose();
  }
}

// ---- Keep spec and result -------------------------------------------------------------

export interface KeepSpec2 {
  king: boolean;
  radius: number;
  height: number;
  /** Initial team colour (the uniform repaints it live). */
  team: number;
  /** Viewer-relative enemy (which ashlar and platform the look gives). */
  enemyTeam: boolean;
  /** +1 / -1: the z direction that faces the camera (gate, banner, breakable merlons). */
  camSide: number;
  /** +1 / -1: the z direction toward the opposing side (the cannon's aim). */
  facing: number;
  /** A cannon on the deck (the king, or a cannoneer's tower). */
  gun: boolean;
  flair: TowerFlair;
  style: TowerStyle;
  /** Golden Age dome maker (arena/build.ts onionDome: drum, bulb, tip, crescent finial). */
  dome?: DomeFactory;
  /** Head-top height of the crew (local units), to size the king's canopy; CREW_SLOT when unknown. */
  crewHeight?: number;
}

/** Makes an onion dome group (children: drum, bulb, tip, finial ball, crescent). */
export type DomeFactory = (r: number, color: number) => THREE.Object3D;

export interface KeepBuild {
  mesh: THREE.Mesh;
  uniforms: KeepUniforms;
  ranges: Map<KeepChunk, { start: number; count: number }>;
  /** Where the crew stands (local): the deck or the king's dais. */
  crew: THREE.Vector3;
  /** The highest silhouette points (roof tips, finials, canopy), and the lowest (gate foot, paving edge). */
  tops: YZ[];
  feet: YZ[];
  /** Merlons that break (stage 1 chips one, stage 2 two more), for the chip FX. */
  chips: THREE.Vector3[][];
  /** Where the stage-2 smoke wisp rises (the roof patch). */
  smoke: THREE.Vector3;
  /** Half-width of the wall at mid height. */
  midRadius: number;
  /** The cannon (its own mesh on the keep's material, pivoting on its carriage), when there is one. */
  gunMesh: THREE.Mesh | null;
  /** Where the cannon's pivot sits (local). */
  gunAt: THREE.Vector3;
}

/** Crew slot height: the tallest crew a provider may hand over (world units), see shared rules 4. */
export const CREW_SLOT = 2.3;

// ---- Common keep pieces ---------------------------------------------------------------

interface Ctx {
  s: KeepSculpt;
  R: number;
  H: number;
  king: boolean;
  camSide: number;
  overhangY: number;
  wallTop: number;
  hwAt: (y: number) => number;
  stone: number;
  stoneLt: number;
  stoneDk: number;
  plat: number;
  ao: Shade;
  lit: Shade;
  flair: TowerFlair;
  style: TowerStyle;
  golden: boolean;
  dome: DomeFactory;
  /** The cannon's own sculpt (built at its pivot, facing +z). */
  gun: KeepSculpt;
  gunAt: THREE.Vector3;
  crewH: number;
}

function ctxFor(spec: KeepSpec2): Ctx {
  const { king, radius: R, height: H, camSide, flair, style } = spec;
  const golden = style.edition === "golden";
  const plat = tone(spec.enemyTeam ? style.platform.enemy : style.platform.player, 0.97, 0.6);
  const stone = tone(style.battlement, golden ? 1.3 : 1.16, golden ? 0.75 : 0.6);
  const overhangY = H - 0.36;
  const wallTop = R * 0.9;
  const ao: Shade = (_x, y, _z, ny) => {
    let f = 0.74 + 0.26 * smooth(0, 1.15, y);
    if (y > overhangY - 0.5 && y < overhangY + 0.02) f *= 0.84 + 0.16 * smooth(0.0, 0.5, overhangY - y);
    if (ny < -0.4) f *= 0.7;
    else if (ny > 0.7) f *= 1.06;
    return f;
  };
  return {
    s: new KeepSculpt(ao),
    R,
    H,
    king,
    camSide,
    overhangY,
    wallTop,
    hwAt: (y) => R + (wallTop - R) * Math.min(1, Math.max(0, y / overhangY)),
    stone,
    stoneLt: tone(stone, 1.14, 0.9),
    stoneDk: tone(style.plinth, 0.86, 0.65),
    plat,
    ao,
    lit: (_x, _y, _z, ny) => (ny < -0.4 ? 0.72 : ny > 0.7 ? 1.06 : 1),
    flair,
    style,
    golden,
    dome: spec.dome ?? ((r) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12))),
    gun: new KeepSculpt((_x, _y, _z, ny) => (ny < -0.4 ? 0.72 : ny > 0.7 ? 1.06 : 1)),
    gunAt: new THREE.Vector3(),
    crewH: spec.crewHeight ?? CREW_SLOT / TOWER_SCALE_HINT,
  };
}

const GOLD = TOWER_GOLD;
const GOLD_DK = TOWER_GOLD_DARK;
const WOOD = 0x8a5a2e;
const WOOD_DK = 0x5e3b1c;
const IRON = 0x3b404c;
const SLIT = 0x221d1b;
const LIT_SLIT = 0xffa748;
const RUBY = 0xd61f4a;
const SNOW = 0xf4f8fc;
const TEAM: PartOpts = { team: 1 };

/** The stump line: everything below stays standing as the ruin. */
export const STUMP_Y = 0.95;

/** Paving, team inlay, stepped plinth and the lower wall (chunk "base"). */
function buildBase(c: Ctx): void {
  const { s, R, plat } = c;
  s.chunk = "base";
  const pw = R * 1.45;
  const paving = tone(plat, 0.93);
  s.add(frustum(pw, pw - 0.06, 0, 0.16), paving);
  // Team inlay border with gold corner studs: whose tower this is, from above.
  const trimW = 0.15;
  const inlay = pw - 0.19;
  for (const sd of [-1, 1]) {
    s.box(inlay * 2 + trimW, 0.05, trimW, 0xe8e8e8, 0, 0.17, sd * inlay, 0, c.lit, TEAM);
    s.box(trimW, 0.05, inlay * 2 - trimW, 0xe8e8e8, sd * inlay, 0.17, 0, 0, c.lit, TEAM);
    for (const t of [-1, 1]) s.cyl(0.12, 0.14, 0.1, GOLD, sd * inlay, 0.2, t * inlay, 8, c.lit);
  }
  // Stepped ashlar plinth with a team band on its top course.
  const TILE0 = R * 2.02;
  const ash = { tex: KEEP_TEX.ashlar, ink: true };
  s.add(frustum(R * 1.2, R * 1.13, 0.16, 0.36, TILE0, true), 0xffffff, 0, 0, 0, 0, (_x, y, _z, ny) => (ny > 0.7 ? 0.96 : 0.7 + 0.2 * ((y - 0.16) / 0.2)), ash);
  s.add(frustum(R * 1.1, R * 1.0, 0.36, 0.6, TILE0, true), 0xffffff, 0, 0, 0, 0, (_x, y, _z, ny) => (ny > 0.7 ? 1.0 : 0.8 + 0.2 * ((y - 0.36) / 0.24)), ash);
  s.add(frustum(R * 1.015, R * 1.0, 0.6, 0.66, 0, false), c.flair.gildedTrim ? GOLD : 0xf0f0f0, 0, 0, 0, 0, c.lit, c.flair.gildedTrim ? {} : TEAM);
  // Lower wall, battered (the stump the ruin keeps).
  const TILE = R * 2.02;
  s.add(frustum(c.hwAt(0.3), c.hwAt(STUMP_Y), 0.3, STUMP_Y, TILE, false), 0xffffff, 0, 0, 0, 0, (_x, y) => 0.7 + 0.3 * ((y - 0.3) / (STUMP_Y - 0.3)), ash);
}

/** Upper walls with quoins and slits (chunk "upper"). */
function buildUpperWall(c: Ctx, slitFaces: (face: number) => number[], bone: boolean, litSlits: boolean): void {
  const { s, R, overhangY, hwAt, stone, stoneLt } = c;
  s.chunk = "upper";
  const TILE = R * 2.02;
  const yC = overhangY - 0.45;
  const ash = { tex: KEEP_TEX.ashlar, ink: true };
  s.add(frustum(hwAt(STUMP_Y), hwAt(yC), STUMP_Y, yC, TILE, false), 0xffffff, 0, 0, 0, 0, () => 1, ash);
  s.add(frustum(hwAt(yC), hwAt(overhangY), yC, overhangY, TILE, false), 0xffffff, 0, 0, 0, 0, (_x, y) => 1 - 0.3 * ((y - yC) / (overhangY - yC)), ash);
  // Quoins: alternating long and short corner stones standing proud.
  const quoins = c.king ? 6 : 5;
  const qh = (overhangY - 0.62) / quoins;
  for (let i = 0; i < quoins; i++) {
    const y = 0.62 + qh * (i + 0.5);
    const hw = hwAt(y) + 0.015;
    const a = i % 2 === 0 ? 0.3 : 0.2;
    if (y < STUMP_Y) s.chunk = "base";
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        s.box(a, qh * 0.88, a, i % 2 ? stoneLt : stone, sx * (hw - a / 2 + 0.03), y, sz * (hw - a / 2 + 0.03));
      }
    }
    s.chunk = "upper";
  }
  // Arrow slits with a stone surround, sill and lintel.
  const slitY = 0.62 + (overhangY - 0.62) * 0.6;
  for (let face = 0; face < 4; face++) {
    for (const off of slitFaces(face)) {
      const hw = hwAt(slitY) + 0.01;
      const ry = (face * Math.PI) / 2;
      const at = (lx: number, lz: number): [number, number] => onFace(face, lx, lz);
      const [fx, fz] = at(off, hw);
      s.box(0.26, 0.5, 0.05, stoneLt, fx, slitY, fz, ry);
      const [sx, sz] = at(off, hw + 0.02);
      s.box(0.11, 0.36, 0.05, litSlits ? LIT_SLIT : SLIT, sx, slitY, sz, ry, () => 1, litSlits ? { glow: 0.55 } : {});
      const [lx, lz] = at(off, hw + 0.03);
      s.box(0.34, 0.07, 0.1, stoneLt, lx, slitY - 0.27, lz, ry);
      s.box(0.3, 0.06, 0.08, bone ? 0xece2c6 : stone, lx, slitY + 0.27, lz, ry);
      if (bone) {
        // Bone lintel: a long bleached bone with knuckled ends over the slit.
        const [bx, bz] = at(off, hw + 0.06);
        const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8);
        shaft.rotateZ(Math.PI / 2);
        s.add(shaft, 0xf1e8d0, bx, slitY + 0.33, bz, ry, c.lit);
        for (const e of [-1, 1]) {
          const [kx, kz] = at(off + e * 0.18, hw + 0.06);
          s.add(new THREE.SphereGeometry(0.055, 8, 6), 0xf1e8d0, kx, slitY + 0.33, kz, 0, c.lit);
        }
      }
    }
  }
}

/** Battlement: corbels, team (or zellige) course, parapet, merlons with their breakable three. */
function buildBattlement(c: Ctx): { out: number; pTop: number; chips: THREE.Vector3[][] } {
  const { s, R, H, overhangY, wallTop, stone, stoneLt, stoneDk, camSide, flair, golden } = c;
  s.chunk = "upper";
  const out = R * 1.08;
  s.add(frustum(wallTop, out, overhangY, H - 0.12), stone, 0, 0, 0, 0, (_x, y, _z, ny) => (ny < -0.2 ? 0.74 + 0.26 * ((y - overhangY) / 0.24) : 1), { ink: true });
  // Machicolation corbels under the overhang.
  const corbels = c.king ? 5 : 4;
  for (let face = 0; face < 4; face++) {
    const ry = (face * Math.PI) / 2;
    for (let i = 0; i < corbels; i++) {
      const off = (i - (corbels - 1) / 2) * ((wallTop * 1.5) / corbels);
      const [x, z] = onFace(face, off, wallTop + 0.05);
      s.box(0.13, 0.2, 0.16, stoneDk, x, overhangY + 0.02, z, ry, () => 0.82);
    }
  }
  if (golden) {
    // Zellige band (turquoise and gold) instead of the plain course.
    s.add(frustum(out + 0.02, out + 0.02, H - 0.2, H - 0.02, 0, false), 0xffffff, 0, 0, 0, 0, () => 1, { tex: KEEP_TEX.band, uv: [6, 1] });
  } else {
    s.add(frustum(out + 0.02, out + 0.02, H - 0.12, H - 0.03, 0, false), 0xffffff, 0, 0, 0, 0, () => 1, TEAM);
  }
  s.add(frustum(out + 0.035, out + 0.035, H - 0.03, H + 0.0), flair.gildedTrim || golden ? GOLD : stoneLt);
  // Parapet walls between the corner turrets.
  const pTop = H + 0.24;
  for (const sd of [-1, 1]) {
    s.box(out * 2 - 0.5, pTop - H, 0.16, stone, 0, (pTop + H) / 2, sd * (out - 0.08), 0, null, { ink: true });
    s.box(0.16, pTop - H, out * 2 - 0.5, stone, sd * (out - 0.08), (pTop + H) / 2, 0, 0, null, { ink: true });
  }
  // Merlons: three a side, plain stone, gilded caps from flair 1. The camera
  // side's middle one chips at stage 1; its neighbour and a side one fall at stage 2.
  const mW = R * 0.3;
  const mH = golden ? 0.34 : 0.3;
  const step = R * 0.46;
  const cap = flair.gildedTrim ? GOLD : stone;
  const merlon = (row: "a" | "b", side: number, i: number, o: PartOpts, h = mH, broken = false): void => {
    const along = row === "a";
    const x = along ? i * step : side * (out - 0.08);
    const z = along ? side * (out - 0.08) : i * step;
    const w = along ? mW : 0.2;
    const d = along ? 0.2 : mW;
    if (golden && !broken) {
      // Stepped Moorish merlon: three courses, each narrower, and a pointed cap.
      s.box(w, h * 0.5, d, stoneLt, x, pTop + h * 0.25, z, 0, null, { ...o, ink: true });
      s.box(w * 0.7 + (along ? 0 : 0.06), h * 0.3, d * 0.7 + (along ? 0.06 : 0), stoneLt, x, pTop + h * 0.65, z, 0, null, o);
      s.add(new THREE.ConeGeometry(Math.min(w, d) * 0.42, h * 0.32, 4), cap, x, pTop + h * 0.96, z, Math.PI / 4, null, o);
      return;
    }
    s.box(w, h, d, stoneLt, x, pTop + h / 2, z, broken ? 0.3 : 0, null, { ...o, ink: !broken });
    if (!broken) s.box(w + (along ? 0.05 : 0.05), 0.06, d + 0.05, cap, x, pTop + h + 0.03, z, 0, null, o);
  };
  const breakable = [
    { row: "a" as const, side: camSide, i: -1, lost: 1 },
    { row: "a" as const, side: camSide, i: 1, lost: 2 },
    { row: "b" as const, side: 1, i: camSide, lost: 2 },
  ];
  const chips: THREE.Vector3[][] = [[], [], []];
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      for (const row of ["a", "b"] as const) {
        const b = breakable.find((k) => k.row === row && k.side === side && k.i === i);
        if (!b) {
          merlon(row, side, i, {});
          continue;
        }
        merlon(row, side, i, { to: b.lost });
        // What is left: a jagged stub.
        merlon(row, side, i, { from: b.lost }, mH * 0.42, true);
        const along = row === "a";
        chips[b.lost].push(new THREE.Vector3(along ? i * step : side * (out - 0.08), pTop + 0.2, along ? side * (out - 0.08) : i * step));
      }
    }
  }
  return { out, pTop, chips };
}

/** The team banner on the camera face; torn and darker from stage 2. Returns its rod height. */
function buildBanner(c: Ctx, emblem: (ex: number, ey: number, ez: number, o: PartOpts) => void): void {
  const { s, king, camSide, lit } = c;
  s.chunk = "upper";
  // Draped over the parapet on the camera face, clear above the gate.
  const bw = king ? 0.64 : 0.5;
  const bh = king ? 0.8 : 0.64;
  const top = c.H + 0.22;
  const z = camSide * (c.R * 1.08 + 0.045);
  const face = zFace(camSide);
  const lean = 0;
  // Whole banner (stages 0-1): cloth, a lighter field, swallow tails.
  const whole: PartOpts = { team: 1, to: 2 };
  s.add(facePlaneBox(bw, bh, 0.04, face, 0, top - bh / 2, Math.abs(z), lean), 0xe0e0e0, 0, 0, 0, 0, (_x, y) => 0.86 + 0.14 * smooth(top - bh, top, y), whole);
  s.add(facePlaneBox(bw - 0.12, bh - 0.1, 0.045, face, 0, top - bh / 2 + 0.01, Math.abs(z) + 0.004, lean), 0xffffff, 0, 0, 0, 0, lit, { team: 0.82, to: 2 });
  for (const sx of [-1, 1]) {
    const tail = new THREE.ConeGeometry(bw / 4, 0.22, 4);
    tail.rotateX(Math.PI);
    tail.rotateY(Math.PI / 4);
    tail.scale(1, 1, 0.18);
    s.add(tail, 0xe0e0e0, (sx * bw) / 4, top - bh - 0.1, z, 0, lit, whole);
  }
  emblem(0, top - bh * 0.48, z + camSide * 0.035, { to: 2 });
  // Torn banner (stage 2): a ragged, shorter, darker cloth hanging askew.
  const torn: PartOpts = { team: 0.7, from: 2 };
  const tg = facePlaneBox(bw * 0.9, bh * 0.62, 0.04, face, 0, 0, Math.abs(z), lean);
  tg.rotateZ(0.12 * camSide);
  tg.translate(0, top - bh * 0.33, 0);
  s.add(tg, 0xc8c8c8, 0, 0, 0, 0, lit, torn);
  for (const [dx, len] of [[-0.18, 0.2], [0.04, 0.34], [0.2, 0.14]] as const) {
    const rag = new THREE.ConeGeometry(0.075, len, 4);
    rag.rotateX(Math.PI);
    rag.scale(1, 1, 0.25);
    s.add(rag, 0xc8c8c8, dx * (bw / 0.56), top - bh * 0.64 - len / 2 + 0.02, z + camSide * 0.004, 0, lit, torn);
  }
  // Gold rod with ball ends (always there).
  const rod = new THREE.CylinderGeometry(0.035, 0.035, bw + 0.2, 8);
  rod.rotateZ(Math.PI / 2);
  s.add(rod, GOLD, 0, top + 0.01, z + camSide * 0.02, 0, lit);
  for (const sx of [-1, 1]) s.add(new THREE.SphereGeometry(0.055, 8, 6), GOLD, sx * (bw / 2 + 0.1), top + 0.01, z + camSide * 0.02, 0, lit);
}

/** A thin box on wall face `face`, centred `along` across it at height y, `out` from the centre. */
function facePlaneBox(w: number, h: number, d: number, face: number, along: number, y: number, out: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (lean) g.rotateX(-lean);
  g.translate(along, y, out);
  g.rotateY((face * Math.PI) / 2);
  return g;
}

/** Crack decals: two at stage 1 (camera face, a side), three more at stage 2. */
function buildCracks(c: Ctx, deckY: number): void {
  const { s, R, overhangY, hwAt, camSide } = c;
  s.chunk = "upper";
  const lean = Math.atan((R - c.wallTop) / overhangY);
  const cy = (STUMP_Y + overhangY) / 2 + 0.05;
  const h = (overhangY - STUMP_Y) * 0.95;
  const out = hwAt(cy) + 0.03;
  const cam = zFace(camSide);
  const sideA = camSide > 0 ? 1 : 3;
  const sideB = camSide > 0 ? 3 : 1;
  const decal = (face: number, along: number, w: number, from: number, flip: boolean): void => {
    const g = facePlane(w, h, face, along, cy, out, lean);
    if (flip) {
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    s.add(g, 0xffffff, 0, 0, 0, 0, () => 1, { tex: KEEP_TEX.crack, from });
  };
  // Stage 1: a big split on the camera face beside the gate, one on a side;
  // stage 2: the other side of the gate and the far side.
  decal(cam, -R * 0.5, R * 0.95, 1, false);
  decal(sideA, R * 0.1, R * 1.0, 1, true);
  decal(cam, R * 0.52, R * 0.9, 2, true);
  decal(sideB, -R * 0.15, R * 1.0, 2, false);
  // A split across the deck.
  const deck = new THREE.PlaneGeometry(R * 1.1, R * 1.1);
  deck.rotateX(-Math.PI / 2);
  s.add(deck, 0xffffff, R * 0.2, deckY + 0.045, -camSide * R * 0.15, 0, () => 1, { tex: KEEP_TEX.crack, from: 2 });
}

/** The team flag on a back turret: upright, leaning at stage 1, torn and hanging at stage 2. */
function buildFlag(c: Ctx, foot: THREE.Vector3): void {
  const { s, lit } = c;
  s.chunk = "back";
  const poses: { tilt: number; from: number; to: number; cloth: number; torn: boolean }[] = [
    { tilt: 0, from: 0, to: 1, cloth: 1, torn: false },
    { tilt: 0.32, from: 1, to: 2, cloth: 1, torn: false },
    { tilt: 0.62, from: 2, to: STAGE_END, cloth: 0.62, torn: true },
  ];
  for (const p of poses) {
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6);
    pole.translate(0, 0.4, 0);
    pole.rotateZ(p.tilt);
    s.add(pole, 0x5a4632, foot.x, foot.y, foot.z, 0, lit, { from: p.from, to: p.to });
    const cloth = new THREE.BoxGeometry(p.torn ? 0.32 : 0.55, p.torn ? 0.26 : 0.32, 0.02);
    cloth.translate(p.torn ? 0.19 : 0.3, p.torn ? 0.58 : 0.62, 0);
    if (p.torn) cloth.rotateZ(-0.5);
    cloth.rotateZ(p.tilt);
    s.add(cloth, 0xffffff, foot.x, foot.y, foot.z, 0, lit, { team: p.cloth, from: p.from, to: p.to });
  }
}

// ---- Classic keep ---------------------------------------------------------------------

/** Build a crown tower keep for either edition (see the section header). */
export function craftKeep(spec: KeepSpec2): KeepBuild {
  return spec.style.edition === "golden" ? craftGolden(spec) : craftClassic(spec);
}

function craftClassic(spec: KeepSpec2): KeepBuild {
  const c = ctxFor(spec);
  const { s, R, H, king, camSide, overhangY, hwAt, stone, stoneLt, stoneDk, lit, flair, style } = c;
  const extras = style.extras;
  buildBase(c);
  const camFace = zFace(camSide);
  buildUpperWall(
    c,
    (face) => (king ? (face === camFace ? [-R * 0.55, R * 0.55] : [-R * 0.42, R * 0.42]) : face === camFace ? [] : [0]),
    extras.has("boneLintels"),
    style.litWindows,
  );

  // Arched timber gate on the camera face: planks, iron straps, a stone arch.
  s.chunk = "upper";
  const dw = king ? 0.62 : 0.5;
  const dh = king ? 0.7 : 0.56;
  const gz = camSide * (hwAt(0.9) + 0.035);
  const y0 = 0.6;
  s.box(dw + 0.2, dh + 0.06, 0.08, stoneLt, 0, y0 + dh / 2, gz - camSide * 0.01);
  const arch = new THREE.CylinderGeometry(dw / 2 + 0.1, dw / 2 + 0.1, 0.08, 16, 1, false, 0, Math.PI);
  arch.rotateZ(Math.PI / 2);
  arch.rotateY(Math.PI / 2);
  s.add(arch, stoneLt, 0, y0 + dh, gz - camSide * 0.01);
  s.box(dw, dh, 0.07, WOOD, 0, y0 + dh / 2, gz + camSide * 0.02, 0, () => 1);
  const leaf = new THREE.CylinderGeometry(dw / 2, dw / 2, 0.07, 16, 1, false, 0, Math.PI);
  leaf.rotateZ(Math.PI / 2);
  leaf.rotateY(Math.PI / 2);
  s.add(leaf, WOOD, 0, y0 + dh, gz + camSide * 0.02, 0, () => 1);
  for (const dx of [-dw / 4, 0, dw / 4]) s.box(0.018, dh + dw * 0.3, 0.075, WOOD_DK, dx, y0 + dh / 2 + dw * 0.12, gz + camSide * 0.022, 0, () => 1);
  for (const dy of [0.2, 0.78]) s.box(dw, 0.055, 0.085, IRON, 0, y0 + dh * dy, gz + camSide * 0.024, 0, () => 1);
  s.add(new THREE.SphereGeometry(0.04, 8, 6), GOLD, dw * 0.28, y0 + dh * 0.5, gz + camSide * 0.07, 0, () => 1);
  s.box(0.14, 0.14, 0.1, extras.has("boneLintels") ? 0xf1e8d0 : stone, 0, y0 + dh + dw / 2 + 0.1, gz);
  // Steps down to the paving.
  s.box(dw + 0.3, 0.1, 0.22, stoneLt, 0, 0.55, camSide * (hwAt(0.5) + 0.12));
  s.box(dw + 0.42, 0.1, 0.22, stone, 0, 0.45, camSide * (hwAt(0.4) + 0.26));

  // Banner with its emblem: a gold five-point crown for the king, a diamond for princesses.
  buildBanner(c, (ex, ey, ez, o) => {
    if (king) {
      s.box(0.4, 0.1, 0.035, GOLD, ex, ey - 0.09, ez, 0, lit, o);
      for (const dx of [-0.16, -0.08, 0, 0.08, 0.16]) {
        const spike = new THREE.ConeGeometry(0.04, dx === 0 ? 0.2 : 0.14, 4);
        spike.scale(1, 1, 0.3);
        s.add(spike, GOLD, ex + dx, ey + (dx === 0 ? 0.05 : 0.02), ez, 0, lit, o);
      }
      s.add(new THREE.SphereGeometry(0.035, 6, 5), RUBY, ex, ey - 0.09, ez + camSide * 0.02, 0, lit, o);
    } else {
      const gem = new THREE.OctahedronGeometry(0.15);
      gem.scale(0.8, 1.1, 0.22);
      s.add(gem, GOLD, ex, ey, ez, 0, lit, o);
    }
    if (flair.jewelCrest) {
      const ruby = new THREE.OctahedronGeometry(0.075);
      s.add(ruby, RUBY, ex, ey + (king ? 0.24 : 0.24), ez + camSide * 0.03, 0, lit, o);
    }
  });

  const { out, chips } = buildBattlement(c);

  // Plank deck inside the parapet.
  s.chunk = "upper";
  const deckY = H + 0.04;
  const dHw = out - 0.14;
  s.box(dHw * 2, 0.06, dHw * 2, WOOD, 0, deckY, 0);
  const planks = king ? 7 : 5;
  for (let i = 1; i < planks; i++) s.box(0.025, 0.012, dHw * 2 - 0.04, WOOD_DK, -dHw + (i * dHw * 2) / planks, deckY + 0.032, 0, 0, () => 1);
  for (const sd of [-1, 1]) s.box(dHw * 2 - 0.04, 0.014, 0.05, tone(WOOD, 1.2), 0, deckY + 0.033, sd * dHw * 0.5, 0, () => 1);
  buildCracks(c, deckY);

  // Corner turrets: corbelled foot, drum, string course, slits, eave, smooth tiled cone, finial.
  const tr = R * (king ? 0.3 : 0.31);
  const tx = out - tr * 0.45;
  const turretTop = H + (king ? 0.62 : 0.5);
  const coneH = R * (king ? 0.95 : 0.9);
  const rb = tr + 0.12;
  const tops: YZ[] = [];
  let smoke = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      s.chunk = sz === camSide ? "front" : "back";
      const x = sx * tx;
      const z = sz * tx;
      s.add(new THREE.CylinderGeometry(tr, tr * 0.35, 0.42, 14, 1, true), stoneDk, x, overhangY - 0.03, z, 0, (_x, y) => 0.7 + 0.3 * smooth(overhangY - 0.24, overhangY + 0.18, y));
      s.add(new THREE.CylinderGeometry(tr, tr, turretTop - (overhangY + 0.18), 16, 1, true), stoneLt, x, (turretTop + overhangY + 0.18) / 2, z, 0, null, { ink: true });
      s.add(new THREE.CylinderGeometry(tr + 0.035, tr + 0.035, 0.07, 16, 1, true), flair.gildedTrim ? GOLD : stone, x, H - 0.02, z);
      s.box(0.07, 0.24, 0.04, SLIT, x, H + 0.22, z + sz * (tr - 0.005), 0, () => 1);
      s.box(0.04, 0.24, 0.07, SLIT, x + sx * (tr - 0.005), H + 0.22, z, 0, () => 1);
      // Eave ring in the dark team shade, then the cone.
      s.add(new THREE.CylinderGeometry(tr + 0.05, tr + 0.1, 0.08, 16, 1, true), 0xa0a0a0, x, turretTop + 0.02, z, 0, lit, TEAM);
      const coneY = turretTop + 0.06;
      s.add(bellCone(rb, coneH), 0xffffff, x, coneY, z, 0, (_x, y) => 0.88 + 0.12 * smooth(coneY, coneY + coneH, y), { team: 1, tex: KEEP_TEX.roof, ink: true, uv: [7, 4] });
      if (flair.goldRoofBands) {
        for (const t of [0.3, 0.62]) {
          const r = rb * Math.pow(1 - t, 1.15) + 0.012;
          s.add(new THREE.CylinderGeometry(r * 0.96, r, 0.05, 16, 1, true), GOLD, x, coneY + t * coneH, z, 0, lit);
        }
      }
      if (extras.has("snowCaps")) {
        // Snow on the eave lip and a crust round the drum's string course.
        const snow = new THREE.TorusGeometry(rb + 0.02, 0.045, 6, 18);
        snow.rotateX(Math.PI / 2);
        s.add(snow, SNOW, x, coneY + 0.02, z, 0, lit);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + sx * 0.4;
          const ice = new THREE.ConeGeometry(0.03, 0.14 + (k % 2) * 0.06, 5);
          ice.rotateX(Math.PI);
          s.add(ice, 0xdff2fb, x + Math.cos(a) * (rb + 0.02), coneY - 0.1, z + Math.sin(a) * (rb + 0.02), 0, lit);
        }
      }
      // Finial: a gold ball, or a tall gilded spire (flair 1+).
      const tipY = coneY + coneH;
      if (flair.gildedFinials) {
        s.add(new THREE.SphereGeometry(R * 0.06, 8, 6), GOLD, x, tipY + 0.02, z, 0, lit);
        s.add(new THREE.ConeGeometry(0.035, 0.32, 8), GOLD, x, tipY + 0.2, z, 0, lit);
        s.add(new THREE.SphereGeometry(0.04, 8, 6), GOLD_DK, x, tipY + 0.12, z, 0, lit);
        tops.push({ y: tipY + 0.36, z });
      } else {
        s.add(new THREE.SphereGeometry(R * 0.075, 8, 6), GOLD, x, tipY + 0.02, z, 0, lit);
        tops.push({ y: tipY + 0.1, z });
      }
      if (sz === camSide && sx === -camSide) {
        // Stage 2: tiles torn off the camera-side cone, rafters showing.
        const phiC = camSide > 0 ? 0.35 * sx : Math.PI - 0.35 * sx; // lathe phi 0 points +z
        s.add(coneSlice(rb, coneH, 0.16, 0.56, phiC - 0.55, 1.1), 0x3a2416, x, coneY, z, 0, () => 1, { from: 2 });
        for (const d of [-0.22, 0.12]) s.add(coneSlice(rb, coneH, 0.2, 0.52, phiC + d, 0.1, 0.026), 0x9a6a3a, x, coneY, z, 0, () => 1, { from: 2 });
        smoke = new THREE.Vector3(x, coneY + coneH * 0.45, z);
      }
    }
  }
  buildFlag(c, new THREE.Vector3(-tx * camSide, turretTop + 0.06 + coneH - 0.05, -camSide * tx));

  // Royal dais and canopy (king): the king stands on the dais under a team canopy.
  let crew = new THREE.Vector3(0, deckY + 0.03, 0);
  if (king) {
    const dz = -camSide * R * 0.18;
    s.chunk = "upper";
    s.cyl(R * 0.5, R * 0.56, 0.14, stoneLt, 0, deckY + 0.1, dz, 18);
    s.cyl(R * 0.52, R * 0.52, 0.035, GOLD, 0, deckY + 0.18, dz, 18);
    s.cyl(R * 0.42, R * 0.42, 0.02, 0xffffff, 0, deckY + 0.205, dz, 18, lit, TEAM);
    crew = new THREE.Vector3(0, deckY + 0.215, dz);
    tops.push(...buildCanopy(c, new THREE.Vector3(0, crew.y, dz - camSide * 0.22), false));
  }
  if (spec.gun) buildGun(c, spec, deckY, WOOD_DK, IRON, [GOLD_DK, GOLD_DK, GOLD], true);

  buildExtras(c, out);
  return finish(c, spec, { crew, tops, chips, smoke });
}

/** The king's canopy (chunk "canopy"): gold posts, a team roof with a scalloped valance. Returns its tops. */
function buildCanopy(c: Ctx, at: THREE.Vector3, golden: boolean): YZ[] {
  const { s, lit, R, flair } = c;
  s.chunk = "canopy";
  const eave = at.y + c.crewH + 0.28;
  const pr = R * 0.4;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      s.add(new THREE.CylinderGeometry(0.035, 0.045, eave - at.y, 8), golden ? 0xf0e4c8 : GOLD, at.x + sx * pr, (eave + at.y) / 2, at.z + sz * pr, 0, lit, { ink: true });
    }
  }
  if (golden) {
    // A domed qubba: a zellige drum on the posts under a team onion dome.
    s.add(frustum(pr + 0.1, pr + 0.1, eave, eave + 0.16, 0, true), 0xffffff, at.x, 0, at.z, 0, () => 1, { tex: KEEP_TEX.band, uv: [3, 1] });
    const dr = pr + 0.08;
    const domeY = eave + 0.16;
    addObject(s, c.dome(dr, 0xffffff), at.x, domeY - dr * 0.5, at.z, 1, (i) => (i === 1 || i === 2 ? { color: 0xffffff, opts: { team: 1, tex: KEEP_TEX.roof, ink: true, uv: [6, 3] } } : i === 0 ? null : { color: GOLD, opts: {}, shade: lit }));
    if (flair.goldRoofBands) {
      const ring = new THREE.TorusGeometry(dr * 0.98, 0.03, 6, 20);
      ring.rotateX(Math.PI / 2);
      s.add(ring, GOLD, at.x, domeY + dr * 0.72, at.z, 0, lit);
    }
    return [{ y: domeY + dr * 3.4, z: at.z }];
  }
  // A round pavilion: a scalloped team valance with a gold hem under a smooth tiled bell roof.
  const vr = pr + 0.16;
  const vh = 0.18;
  s.add(new THREE.CylinderGeometry(vr, vr, vh, 24, 1, true), 0xf0f0f0, at.x, eave - vh / 2, at.z, 0, lit, TEAM);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const flap = new THREE.SphereGeometry(0.075, 6, 2, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    flap.scale(1, 0.9, 0.35);
    flap.rotateY(a);
    s.add(flap, 0xf0f0f0, at.x + Math.sin(a) * vr, eave - vh, at.z + Math.cos(a) * vr, 0, lit, TEAM);
  }
  s.add(new THREE.TorusGeometry(vr + 0.005, 0.025, 6, 24).rotateX(Math.PI / 2), GOLD, at.x, eave, at.z, 0, lit);
  const roofH = 0.72;
  s.add(bellCone(vr + 0.06, roofH, 24, 8), 0xffffff, at.x, eave + 0.02, at.z, 0, (_x, y) => 0.9 + 0.1 * smooth(eave, eave + roofH, y), { team: 1, tex: KEEP_TEX.roof, ink: true, uv: [9, 4] });
  if (flair.goldRoofBands) s.add(new THREE.CylinderGeometry((vr + 0.06) * 0.62, (vr + 0.06) * 0.66, 0.05, 24, 1, true), GOLD, at.x, eave + 0.02 + roofH * 0.33, at.z, 0, lit);
  const tip = eave + 0.02 + roofH;
  s.add(new THREE.SphereGeometry(0.08, 10, 8), GOLD, at.x, tip + 0.03, at.z, 0, lit);
  if (flair.gildedFinials) s.add(new THREE.ConeGeometry(0.035, 0.3, 8), GOLD, at.x, tip + 0.22, at.z, 0, lit);
  return [{ y: tip + (flair.gildedFinials ? 0.37 : 0.11), z: at.z }];
}

/** The keep is built at this root scale (towers.ts TOWER_SCALE): crew slots are sized in world units. */
const TOWER_SCALE_HINT = 1.1;

/** Look-id extras that are not on the turrets (towerStyles.ts LOOK_EXTRAS). */
function buildExtras(c: Ctx, out: number): void {
  const { s, R, H, overhangY, hwAt, style, lit, camSide } = c;
  const ex = style.extras;
  s.chunk = "upper";
  if (ex.has("snowCaps")) {
    // Snow along the parapet and merlon tops, drifts on the plinth.
    const pTop = H + 0.24;
    for (const sd of [-1, 1]) {
      s.box(out * 2 - 0.46, 0.05, 0.2, SNOW, 0, pTop + 0.025, sd * (out - 0.08), 0, lit);
      s.box(0.2, 0.05, out * 2 - 0.46, SNOW, sd * (out - 0.08), pTop + 0.025, 0, 0, lit);
    }
    s.chunk = "base";
    for (let face = 0; face < 4; face++) {
      for (const along of [-0.55, 0.5]) {
        const [x, z] = onFace(face, along * R, R * 1.12);
        const drift = new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        drift.scale(1.4, 0.4, 0.8);
        s.add(drift, SNOW, x, 0.36, z, (face * Math.PI) / 2, lit);
      }
    }
  }
  if (ex.has("emberCracks")) {
    // Glowing seams in the lower walls (below the bloom threshold).
    s.chunk = "base";
    for (let face = 0; face < 4; face++) {
      const cam = face === zFace(camSide);
      for (const k of cam ? [-1, 1] : [0]) {
        let y = 0.36;
        let along = k * R * 0.55 + (face - 1.5) * 0.06;
        for (let seg = 0; seg < 4; seg++) {
          const len = 0.16 + (seg % 2) * 0.06;
          const ang = (seg % 2 ? 0.5 : -0.4) * (k || 1);
          const [x, z] = onFace(face, along, hwAt(y) + 0.012);
          const g = new THREE.BoxGeometry(0.04, len, 0.012);
          g.rotateZ(ang);
          s.add(g, 0xff7a2a, x, y + len / 2, z, (face * Math.PI) / 2, () => 1, { glow: 0.85 });
          y += len * Math.cos(ang) * 0.95;
          along -= Math.sin(ang) * len;
          if (y > STUMP_Y - 0.02) s.chunk = "upper";
        }
        s.chunk = "base";
      }
    }
  }
  if (ex.has("vines")) {
    // Ivy climbing two corners and over the gate: leafy clumps.
    for (const [sx, sz] of [[-1, camSide], [1, -camSide], [1, camSide]] as const) {
      let y = 0.3;
      for (let k = 0; k < 7; k++) {
        const hw = hwAt(y) + 0.06;
        const jitter = ((k * 37) % 7) / 7 - 0.5;
        s.chunk = y < STUMP_Y ? "base" : "upper";
        const leaf = new THREE.IcosahedronGeometry(0.11 + (k % 3) * 0.02, 0);
        leaf.scale(1, 0.8, 0.6);
        s.add(leaf, k % 2 ? 0x3f8f3a : 0x2f7a35, sx * (hw - 0.03 + jitter * 0.05), y, sz * (hw - 0.03), 0, lit);
        y += 0.2 + (k % 2) * 0.06;
        if (y > overhangY) break;
      }
    }
  }
  if (ex.has("neonStrips")) {
    // Team-colour light strips up the four corners and round the parapet.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const y0 = 0.62;
        const y1 = overhangY;
        const hw0 = hwAt(y0) + 0.04;
        const hw1 = hwAt(y1) + 0.04;
        const len = Math.hypot(y1 - y0, (hw0 - hw1) * Math.SQRT2);
        const g = new THREE.BoxGeometry(0.05, len, 0.05);
        g.rotateX(-Math.atan2(hw0 - hw1, y1 - y0) * sz);
        g.rotateZ(Math.atan2(hw0 - hw1, y1 - y0) * sx);
        s.chunk = "upper";
        s.add(g, 0xffffff, sx * (hw0 + hw1) / 2, (y0 + y1) / 2, sz * (hw0 + hw1) / 2, 0, () => 1, { team: 1, glow: 0.6 });
      }
    }
    s.add(frustum(out + 0.05, out + 0.05, H - 0.1, H - 0.06, 0, false), 0xffffff, 0, 0, 0, 0, () => 1, { team: 1, glow: 0.6 });
  }
}

/**
 * The cannon (king, or a cannoneer's tower): a banded barrel on a wheeled
 * carriage, built at its own pivot facing +z so towers.ts can swing it at
 * the target (and sink a sleeping king's below the parapet).
 */
function buildGun(c: Ctx, spec: KeepSpec2, deckY: number, carriage: number, metal: number, bands: number[], wheels: boolean): void {
  const g = c.gun;
  const king = spec.king;
  c.gunAt.set(c.R * 0.5, deckY + 0.06, spec.facing * c.R * 0.46);
  g.box(0.3, 0.12, 0.4, carriage, 0, 0.06, 0);
  if (wheels) {
    for (const sx of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12);
      wheel.rotateZ(Math.PI / 2);
      g.add(wheel, IRON, sx * 0.18, 0.09, 0);
    }
  } else {
    for (const sx of [-1, 1]) g.box(0.05, 0.2, 0.34, carriage, sx * 0.16, 0.12, 0);
  }
  const br = king ? 0.15 : 0.12;
  const bl = king ? 0.8 : 0.62;
  const tilt = 1.35;
  const tube = new THREE.CylinderGeometry(br * 0.86, br * 1.1, bl, 14);
  tube.rotateX(tilt);
  g.add(tube, metal, 0, 0.22, 0.12, 0, null, { ink: true });
  [-0.3, 0.12, 0.47].forEach((along, i) => {
    const band = new THREE.CylinderGeometry(br * 1.14, br * 1.14, 0.07, 14);
    band.translate(0, along * bl, 0);
    band.rotateX(tilt);
    g.add(band, bands[i], 0, 0.22, 0.12);
  });
}

/** Common tail: assemble the mesh and the placement data. */
function finish(
  c: Ctx,
  spec: KeepSpec2,
  r: { crew: THREE.Vector3; tops: YZ[]; chips: THREE.Vector3[][]; smoke: THREE.Vector3 },
): KeepBuild {
  const variant = spec.enemyTeam ? spec.style.wall.enemy : spec.style.wall.player;
  const { mesh, uniforms, ranges } = keepMesh(c.s, ashlarTexture(variant), spec.team, spec.king ? "king-keep" : "princess-keep");
  let gunMesh: THREE.Mesh | null = null;
  if (c.gun.verts > 0) {
    gunMesh = new THREE.Mesh(c.gun.build().geometry, mesh.material);
    gunMesh.name = "cannon";
    gunMesh.customDepthMaterial = mesh.customDepthMaterial;
    gunMesh.castShadow = gunMesh.receiveShadow = true;
    gunMesh.userData.noBatch = true;
    gunMesh.onBeforeRender = fitInk;
    gunMesh.position.copy(c.gunAt);
  }
  const pw = c.R * 1.45;
  return {
    mesh,
    uniforms,
    ranges,
    crew: r.crew,
    tops: r.tops,
    feet: [
      { y: 0.6, z: c.camSide * (c.hwAt(0.6) + 0.04) },
      { y: 0, z: c.camSide * pw },
    ],
    chips: r.chips,
    smoke: r.smoke,
    midRadius: c.hwAt(c.overhangY * 0.55),
    gunMesh,
    gunAt: c.gunAt.clone(),
  };
}

// ---- Golden Age keep --------------------------------------------------------------

const VOUSSOIR_A = 0xb85c38;
const VOUSSOIR_B = 0xf1e6cc;
const CEDAR = 0x6e3f1f;

function craftGolden(spec: KeepSpec2): KeepBuild {
  const c = ctxFor(spec);
  const { s, R, H, king, camSide, overhangY, hwAt, stoneLt, stoneDk, lit, flair, style } = c;
  const extras = style.extras;
  buildBase(c);
  const camFace = zFace(camSide);
  buildUpperWall(
    c,
    (face) => (king ? (face === camFace ? [-R * 0.55, R * 0.55] : [-R * 0.42, R * 0.42]) : face === camFace ? [] : [0]),
    false,
    style.litWindows,
  );

  // Horseshoe-arch gate: alternating voussoirs, a cedar door with gold studs.
  s.chunk = "upper";
  const dw = king ? 0.66 : 0.54;
  const dh = king ? 1.0 : 0.84;
  const y0 = 0.6;
  const gz = camSide * (hwAt(0.9) + 0.03);
  const ry = camSide > 0 ? 0 : Math.PI;
  const frameW = dw + 0.2;
  const frameH = dh + 0.12;
  const frame = new THREE.ShapeGeometry(horseshoe(frameW, frameH), 16);
  s.add(frame, stoneLt, 0, y0 - 0.04, gz, ry, () => 1);
  // Voussoirs: wedges round the arch.
  const springY = y0 - 0.04 + frameH - frameW / 2;
  const rO = frameW / 2 - 0.01;
  const rI = dw / 2 + 0.005;
  const n = 9;
  const a0 = -0.28;
  const a1 = Math.PI + 0.28;
  for (let k = 0; k < n; k++) {
    const ta = a0 + ((a1 - a0) * k) / n;
    const tb = a0 + ((a1 - a0) * (k + 1)) / n;
    const sh = new THREE.Shape();
    sh.moveTo(Math.cos(ta) * rI, Math.sin(ta) * rI);
    sh.lineTo(Math.cos(ta) * rO, Math.sin(ta) * rO);
    sh.absarc(0, 0, rO, ta, tb, false);
    sh.lineTo(Math.cos(tb) * rI, Math.sin(tb) * rI);
    sh.absarc(0, 0, rI, tb, ta, true);
    const g = new THREE.ShapeGeometry(sh, 3);
    g.translate(0, springY, 0.012);
    s.add(g, k % 2 ? VOUSSOIR_A : VOUSSOIR_B, 0, 0, gz, ry, () => 1);
  }
  const door = new THREE.ShapeGeometry(horseshoe(dw, dh), 16);
  door.translate(0, 0, 0.02);
  s.add(door, CEDAR, 0, y0, gz, ry, () => 1);
  for (const [dx, dy] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, 0.5], [0.12, 0.5], [0, 0.72]] as const) {
    s.add(new THREE.SphereGeometry(0.025, 6, 5), GOLD, dx, y0 + dy * dh, gz + camSide * 0.035, 0, () => 1);
  }
  // Rectangular alfiz frame round the arch, in gold.
  for (const sx of [-1, 1]) s.box(0.04, frameH + 0.1, 0.03, GOLD, sx * (frameW / 2 + 0.06), y0 + frameH / 2 + 0.01, gz + camSide * 0.015, 0, () => 1);
  s.box(frameW + 0.16, 0.04, 0.03, GOLD, 0, y0 + frameH + 0.06, gz + camSide * 0.015, 0, () => 1);
  s.box(dw + 0.34, 0.1, 0.22, stoneLt, 0, 0.55, camSide * (hwAt(0.5) + 0.12));
  s.box(dw + 0.46, 0.1, 0.22, c.stone, 0, 0.45, camSide * (hwAt(0.4) + 0.26));

  // Banner with a gold crescent (princess) or eight-point star (king).
  buildBanner(c, (ex, ey, ez, o) => {
    if (king) {
      for (const rot of [0, Math.PI / 4]) {
        const sq = new THREE.BoxGeometry(0.2, 0.2, 0.03);
        sq.rotateZ(rot);
        s.add(sq, GOLD, ex, ey, ez, 0, lit, o);
      }
      s.add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10).rotateX(Math.PI / 2), RUBY, ex, ey, ez + camSide * 0.02, 0, lit, o);
    } else {
      const cres = new THREE.TorusGeometry(0.11, 0.035, 6, 14, Math.PI * 1.35);
      cres.rotateZ(Math.PI * 0.82);
      s.add(cres, GOLD, ex, ey, ez, 0, lit, o);
    }
    if (flair.jewelCrest) s.add(new THREE.OctahedronGeometry(0.075), RUBY, ex, ey + 0.24, ez + camSide * 0.03, 0, lit, o);
  });

  const { out, chips } = buildBattlement(c);

  // A sandstone deck with a tiled star in the middle.
  s.chunk = "upper";
  const deckY = H + 0.04;
  const dHw = out - 0.14;
  s.box(dHw * 2, 0.06, dHw * 2, tone(c.plat, 0.95), 0, deckY, 0);
  const deckStar = new THREE.PlaneGeometry(dHw * 1.1, dHw * 1.1);
  deckStar.rotateX(-Math.PI / 2);
  s.add(deckStar, 0xffffff, 0, deckY + 0.032, 0, Math.PI / 4, () => 1, { tex: KEEP_TEX.band, uv: [1, 1] });
  buildCracks(c, deckY);

  // Corner turrets: round drums with a zellige ring under team onion domes.
  const tr = R * (king ? 0.29 : 0.3);
  const tx = out - tr * 0.45;
  const drumTop = H + (king ? 0.5 : 0.4);
  const dr = tr * 1.02;
  const tops: YZ[] = [];
  let smoke = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      s.chunk = sz === camSide ? "front" : "back";
      const x = sx * tx;
      const z = sz * tx;
      s.add(new THREE.CylinderGeometry(tr, tr * 0.35, 0.42, 14, 1, true), stoneDk, x, overhangY - 0.03, z, 0, (_x, y) => 0.7 + 0.3 * smooth(overhangY - 0.24, overhangY + 0.18, y));
      s.add(new THREE.CylinderGeometry(tr, tr, drumTop - (overhangY + 0.18), 16, 1, true), stoneLt, x, (drumTop + overhangY + 0.18) / 2, z, 0, null, { ink: true });
      s.add(new THREE.CylinderGeometry(tr + 0.012, tr + 0.012, 0.14, 16, 1, true), 0xffffff, x, drumTop - 0.1, z, 0, () => 1, { tex: KEEP_TEX.band, uv: [3, 1] });
      s.add(new THREE.CylinderGeometry(tr + 0.04, tr + 0.04, 0.05, 16), flair.gildedTrim ? GOLD : stoneLt, x, drumTop, z);
      // Pointed-arch window on the outer face.
      const win = new THREE.ShapeGeometry(horseshoe(0.11, 0.24), 6);
      s.add(win, style.litWindows ? LIT_SLIT : SLIT, x, H + 0.08, z + sz * (tr + 0.004), sz > 0 ? 0 : Math.PI, () => 1, style.litWindows ? { glow: 0.55 } : {});
      // The dome: onionDome's bulb and tip in the team colour, its crescent finial in gold.
      const domeY = drumTop + 0.02;
      addObject(s, c.dome(dr, 0xffffff), x, domeY - dr * 0.5, z, 1, (i) =>
        i === 0 ? null : i === 1 || i === 2 ? { color: 0xffffff, opts: { team: 1, tex: KEEP_TEX.roof, ink: true, uv: [6, 3] } } : { color: i === 3 ? GOLD : flair.gildedFinials ? 0xffd34f : GOLD, opts: {}, shade: lit },
      );
      if (flair.goldRoofBands) {
        const ring = new THREE.TorusGeometry(dr * 0.99, 0.025, 6, 20);
        ring.rotateX(Math.PI / 2);
        s.add(ring, GOLD, x, domeY + dr * 0.72, z, 0, lit);
      }
      if (extras.has("snowCaps")) {
        const snow = new THREE.SphereGeometry(dr * 1.02, 16, 6, 0, Math.PI * 2, 0, 0.6);
        snow.scale(1, 1.3, 1);
        s.add(snow, SNOW, x, domeY + dr * 0.72, z, 0, lit);
      }
      tops.push({ y: domeY + dr * 3.4, z });
      if (sz === camSide && sx === -camSide) {
        // Stage 2: glaze torn off the camera-side dome.
        const phiC = camSide > 0 ? Math.PI / 2 + 0.35 * sx : (3 * Math.PI) / 2 - 0.35 * sx; // sphere phi pi/2 points +z
        const patch = new THREE.SphereGeometry(dr * 1.02, 6, 4, phiC - 0.55, 1.1, 0.7, 0.8);
        patch.scale(1, 1.3, 1);
        s.add(patch, 0x3a2416, x, domeY + dr * 0.72, z, 0, () => 1, { from: 2 });
        smoke = new THREE.Vector3(x, domeY + dr * 1.3, z);
      }
    }
  }

  let crew = new THREE.Vector3(0, deckY + 0.03, 0);
  if (king) {
    const dz = -camSide * R * 0.18;
    s.chunk = "upper";
    s.cyl(R * 0.5, R * 0.56, 0.14, stoneLt, 0, deckY + 0.1, dz, 18);
    s.cyl(R * 0.52, R * 0.52, 0.035, GOLD, 0, deckY + 0.18, dz, 18);
    s.cyl(R * 0.42, R * 0.42, 0.02, 0xffffff, 0, deckY + 0.205, dz, 18, lit, TEAM);
    crew = new THREE.Vector3(0, deckY + 0.215, dz);
    tops.push(...buildCanopy(c, new THREE.Vector3(0, crew.y, dz - camSide * 0.22), true));
  }
  if (spec.gun) buildGun(c, spec, deckY, CEDAR, 0xb8862e, [GOLD, GOLD, GOLD], false);
  buildExtras(c, out);
  return finish(c, spec, { crew, tops, chips, smoke });
}

// ---- Ruin ---------------------------------------------------------------------------

export interface RuinSpec {
  king: boolean;
  radius: number;
  team: number;
  enemyTeam: boolean;
  camSide: number;
  style: TowerStyle;
  seed: number;
}

/**
 * What a fallen tower leaves: its paving (scorched), the stepped plinth, a
 * jagged broken stump of the keep with a dark gap where the gate was, a
 * rubble mound and the fallen team banner. Two meshes sharing one keep
 * material: the stump (there at once) and the heap (grows as chunks land).
 */
export function craftRuin(spec: RuinSpec): { stump: THREE.Mesh; heap: THREE.Mesh } {
  const golden = spec.style.edition === "golden";
  const c = ctxFor({
    king: spec.king,
    radius: spec.radius,
    height: spec.king ? 2.7 : 2.15,
    team: spec.team,
    enemyTeam: spec.enemyTeam,
    camSide: spec.camSide,
    facing: spec.camSide,
    gun: false,
    flair: { tier: 0, gildedTrim: false, gildedFinials: false, jewelCrest: false, goldRoofBands: false },
    style: spec.style,
  });
  const { s, R, hwAt, stone, stoneLt, lit, camSide } = c;
  let st = (spec.seed * 2654435761) >>> 0 || 7;
  const rand = (): number => {
    st = (st * 1664525 + 1013904223) >>> 0;
    return st / 4294967296;
  };
  // Scorched paving: the plinth and paving as they stood, darkened.
  buildBase(c);
  // A dark scorch ring on the paving round the stump.
  const ring = new THREE.RingGeometry(R * 1.05, R * 1.42, 24);
  ring.rotateX(-Math.PI / 2);
  s.chunk = "base";
  s.add(ring, 0x2a2018, 0, 0.172, 0, 0, () => 1);
  // Jagged top: broken ashlar blocks of uneven height along each face.
  const TILE = R * 2.02;
  for (let face = 0; face < 4; face++) {
    const n = 4;
    for (let k = 0; k < n; k++) {
      const hw = hwAt(STUMP_Y);
      const w = (hw * 2) / n;
      const along = -hw + w * (k + 0.5);
      // Broken courses: some stand tall, some are knocked down to the stump line.
      const h = rand() < 0.3 ? 0.04 : 0.12 + rand() * 0.5;
      if (face === zFace(camSide) && Math.abs(along) < R * 0.32) continue; // the broken gate
      const [x, z] = onFace(face, along, hw - 0.08);
      const block = new THREE.BoxGeometry(w * 0.96, h, 0.18);
      block.rotateZ((rand() - 0.5) * 0.35);
      s.add(block, 0xffffff, x, STUMP_Y + h / 2 - 0.02, z, (face * Math.PI) / 2 + (rand() - 0.5) * 0.2, () => 0.95, { tex: KEEP_TEX.ashlar, uv: [w / TILE, h / TILE], ink: true });
    }
  }
  // The keep's hollow: dark rubble fill inside the stump.
  const fill = new THREE.BoxGeometry(hwAt(STUMP_Y) * 1.8, 0.1, hwAt(STUMP_Y) * 1.8);
  s.add(fill, 0x3b3128, 0, STUMP_Y - 0.03, 0, 0, () => 1);
  // The gate: a dark gap with a broken arch stub.
  const gz = camSide * (hwAt(0.7) + 0.02);
  s.box(0.5, 0.45, 0.06, 0x1d1712, 0, 0.6 + 0.2, gz, 0, () => 1);
  s.box(0.16, 0.5, 0.1, stoneLt, -0.33, 0.85, gz, 0.1);
  s.box(0.16, 0.36, 0.1, stoneLt, 0.33, 0.78, gz, -0.15);
  const stumpBuild = keepMesh(s, ashlarTexture(spec.enemyTeam ? spec.style.wall.enemy : spec.style.wall.player), spec.team, "ruin-stump");

  // The heap: tumbled blocks round the stump, a few roof shards, the fallen banner.
  const h = new KeepSculpt((_x, y) => 0.7 + 0.3 * Math.min(1, y / 0.6));
  h.chunk = "base";
  const n = spec.king ? 30 : 22;
  const colors = [stone, stoneLt, tone(spec.style.plinth, 1.05, 0.7), c.plat];
  // A mound spilling out of the broken gate toward the camera, and a heap inside the stump.
  const mound = new THREE.SphereGeometry(R * 0.62, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1.25, 0.55, 0.9);
  h.add(mound, tone(stone, 0.9), 0, 0.12, camSide * R * 0.95, 0, null, { ink: true });
  const inner = new THREE.SphereGeometry(R * 0.7, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  inner.scale(1, 0.5, 1);
  h.add(inner, tone(stone, 0.75), 0, STUMP_Y - 0.08, 0);
  for (let i = 0; i < n; i++) {
    const size = 0.14 + rand() * 0.22;
    const g = rand() < 0.5 ? new THREE.BoxGeometry(size * 1.4, size * 0.8, size) : new THREE.DodecahedronGeometry(size * 0.6, 0);
    g.rotateY(rand() * Math.PI);
    g.rotateZ((rand() - 0.5) * 0.6);
    let x: number;
    let y: number;
    let z: number;
    if (i % 3 === 0) {
      // On the mound by the gate.
      x = (rand() - 0.5) * R * 1.4;
      z = camSide * R * (0.7 + rand() * 0.6);
      y = 0.12 + R * 0.3 * (1 - Math.abs(x) / (R * 0.9)) + size * 0.3;
    } else if (i % 3 === 1) {
      // On the heap inside the stump, poking over the broken courses.
      x = (rand() - 0.5) * R * 1.1;
      z = (rand() - 0.5) * R * 1.1;
      y = STUMP_Y + 0.1 + rand() * 0.2;
    } else {
      const a = rand() * Math.PI * 2;
      const r = R * (1.05 + rand() * 0.65);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = size * 0.35 + (r < R * 1.3 ? 0.18 : 0.02);
    }
    h.add(g, colors[i % colors.length], x, Math.max(0.02, y), z, 0, null, rand() < 0.4 ? { ink: true } : {});
  }
  // Roof shards in the team colour (cones broken into wedges).
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const shard = new THREE.ConeGeometry(0.2, 0.36, 5, 1, false, 0, 2.2);
    shard.rotateZ(1.2 + rand());
    shard.rotateY(rand() * Math.PI);
    h.add(shard, 0xe8e8e8, Math.cos(a) * R * 1.25, 0.2, Math.sin(a) * R * 1.25, 0, null, { team: 1, tex: golden ? KEEP_TEX.roof : KEEP_TEX.roof, uv: [2, 2] });
  }
  // The fallen banner: team cloth draped over the rubble in front, gold rod askew.
  const bw = spec.king ? 0.72 : 0.56;
  const bh = spec.king ? 0.92 : 0.74;
  const cloth = new THREE.PlaneGeometry(bw, bh, 2, 3);
  const p = cloth.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * 5 + p.getX(i) * 3) * 0.05);
  cloth.computeVertexNormals();
  cloth.rotateX(-Math.PI / 2 + 0.35 * camSide);
  cloth.rotateY(0.5);
  h.add(cloth, 0xe0e0e0, R * 0.55, 0.32, camSide * R * 1.2, 0, () => 1, { team: 1 });
  const rod = new THREE.CylinderGeometry(0.03, 0.03, bw + 0.2, 8);
  rod.rotateZ(Math.PI / 2);
  rod.rotateY(0.5);
  h.add(rod, GOLD, R * 0.55 - 0.05, 0.36, camSide * (R * 1.2 - bh * 0.42), 0, lit);
  const heapBuild = keepMesh(h, ashlarTexture(spec.enemyTeam ? spec.style.wall.enemy : spec.style.wall.player), spec.team, "ruin-heap");
  return { stump: stumpBuild.mesh, heap: heapBuild.mesh };
}

/** The keep uniforms of a keep or ruin mesh (for the palette repaint and damage). */
export function keepUniformsOf(mesh: THREE.Object3D): KeepUniforms | null {
  return (mesh.userData.keepUniforms as KeepUniforms | undefined) ?? null;
}
