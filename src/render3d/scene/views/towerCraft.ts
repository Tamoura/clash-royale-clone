/**
 * Hand-built classic crown towers ("handcrafted plus" prototype): a battered
 * ashlar keep on a stepped plinth, corner quoins, arrow slits, an arched
 * timber door, a corbelled parapet with merlons, four bartizan turrets under
 * tiled team-colour cones, a plank deck, a hanging team banner and (king) a
 * gold crest, a dais and a banded cannon.
 *
 * Every chunk is sculpted into one vertex-coloured mesh (plus one textured
 * wall mesh), with ambient occlusion painted into the vertices: darker
 * toward the ground, under overhangs and inside recesses. The battlement
 * mesh ends with the three merlon units damage knocks off (see towers.ts).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { paintedToon } from "../../characters3d";
import type { ArenaLook, BrickVariant } from "../../arenaLooks";

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

// ---- The keep -------------------------------------------------------------------

export interface KeepSpec {
  king: boolean;
  radius: number;
  height: number;
  /** Team cloth colour (roofs, banner, trim). */
  cloth: number;
  /** Viewer-relative enemy team (which brick variant / platform the look gives). */
  enemyTeam: boolean;
  /** +1 / -1: the z direction that faces the opposing side (door). */
  facing: number;
  /** +1 / -1: the z direction that faces the camera (banner, breakable merlons). */
  camSide: number;
  /** A cannon on the deck (the king, or a cannoneer's tower). */
  gun: boolean;
  /** Trophy-road flair tier (0..2). */
  flair: number;
  look: ArenaLook;
  chunks: { base: THREE.Group; wall: THREE.Group; battlement: THREE.Group; roof: THREE.Group };
}

export interface KeepResult {
  /** Vertices in each breakable merlon unit (the battlement mesh ends with three). */
  unitVerts: number;
  /** Where the three breakable merlons stand (first-lost first). */
  spots: THREE.Vector3[];
  /** Foot of the flag pole. */
  flagFoot: THREE.Vector3;
  /** Half-width of the wall at mid height (for the crack decals). */
  midRadius: number;
}

const GOLD = 0xf2c14e;
const GOLD_DK = 0xc9932e;
const WOOD = 0x8a5a2e;
const WOOD_DK = 0x5e3b1c;
const IRON = 0x3b404c;
const SLIT = 0x221d1b;

/** Build the classic keep's static chunks (see the file header). */
export function craftClassicKeep(spec: KeepSpec): KeepResult {
  const { king, radius: R, height: H, cloth, facing, camSide, look } = spec;
  const variant = spec.enemyTeam ? look.tower.enemy : look.tower.player;
  const platform = tone(spec.enemyTeam ? look.tower.platformEnemy : look.tower.platformPlayer, 1.02, 0.55);
  const stone = tone(look.tower.battlement, 1.16, 0.6);
  const stoneLt = tone(stone, 1.14, 0.9);
  const stoneDk = tone(look.tower.plinth, 0.86, 0.65);
  const roofA = tone(cloth, 1.0, 1.05);
  const roofB = tone(cloth, 0.78, 1.05);
  const roofDk = tone(cloth, 0.6, 1.0);

  // Painted occlusion: the ground and the overhang darken what is near them.
  const overhangY = H - 0.36;
  const ao: Shade = (_x, y, _z, ny) => {
    let f = 0.74 + 0.26 * smooth(0, 1.15, y);
    if (y > overhangY - 0.5 && y < overhangY + 0.02) f *= 0.84 + 0.16 * smooth(0.0, 0.5, overhangY - y);
    if (ny < -0.4) f *= 0.7;
    else if (ny > 0.7) f *= 1.06;
    return f;
  };
  const lit: Shade = (_x, _y, _z, ny) => (ny < -0.4 ? 0.72 : ny > 0.7 ? 1.06 : 1);

  const wallTop = R * 0.9; // half-width of the keep where it meets the corbels
  const hwAt = (y: number): number => R + (wallTop - R) * Math.min(1, Math.max(0, y / overhangY));

  // ---- Base: team-trimmed platform, stepped plinth -------------------------------
  const base = new Sculpt(ao);
  const pw = R * 1.45;
  base.add(frustum(pw, pw - 0.05, 0, 0.16), platform);
  // Team inlay border with gold corner studs: whose tower this is, from above.
  const trimW = 0.16;
  for (const s of [-1, 1]) {
    base.box(pw * 2 - 0.18, 0.05, trimW, tone(cloth, 0.95), 0, 0.17, s * (pw - 0.2), 0, lit);
    base.box(trimW, 0.05, pw * 2 - 0.18 - trimW * 2, tone(cloth, 0.95), s * (pw - 0.2), 0.17, 0, 0, lit);
    for (const t of [-1, 1]) base.cyl(0.11, 0.13, 0.09, GOLD, s * (pw - 0.2), 0.19, t * (pw - 0.2), 8, lit);
  }
  // Flagstone joints scored into the platform's top.
  for (const t of [-0.5, 0.5]) {
    base.box(pw * 2 - 0.6, 0.012, 0.03, tone(platform, 0.78), 0, 0.166, t * pw * 0.9, 0, lit);
    base.box(0.03, 0.012, pw * 2 - 0.6, tone(platform, 0.78), t * pw * 0.9, 0.166, 0, 0, lit);
  }
  base.add(frustum(R * 1.2, R * 1.14, 0.16, 0.34), stoneDk);
  base.add(frustum(R * 1.12, R * 1.0, 0.34, 0.62), tone(stoneDk, 1.12));

  // ---- Wall: battered ashlar, quoins, slits, door, banner ------------------------
  const wallTex = new Sculpt();
  const TILE = R * 2.02; // one texture tile spans a face: four chunky blocks
  const wallShade = (lo: number, hi: number): Shade => (_x, y) => lo + (hi - lo) * ((y - 0.3) / (overhangY - 0.3));
  const yA = 0.3;
  const yB = 0.95;
  const yC = overhangY - 0.45;
  wallTex.add(frustum(hwAt(yA), hwAt(yB), yA, yB, TILE, false), 0xffffff, 0, 0, 0, 0, (_x, y) => 0.66 + 0.34 * ((y - yA) / (yB - yA)));
  wallTex.add(frustum(hwAt(yB), hwAt(yC), yB, yC, TILE, false), 0xffffff, 0, 0, 0, 0, wallShade(1, 1));
  wallTex.add(frustum(hwAt(yC), hwAt(overhangY), yC, overhangY, TILE, false), 0xffffff, 0, 0, 0, 0, (_x, y) => 1 - 0.3 * ((y - yC) / (overhangY - yC)));

  const wall = new Sculpt(ao);
  // Quoins: alternating long and short corner stones standing proud of the wall.
  const quoins = king ? 6 : 5;
  const qh = (overhangY - 0.62) / quoins;
  for (let i = 0; i < quoins; i++) {
    const y = 0.62 + qh * (i + 0.5);
    const hw = hwAt(y) + 0.015;
    const long = i % 2 === 0;
    const a = long ? 0.3 : 0.2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        wall.box(a, qh * 0.88, a, i % 2 ? stoneLt : stone, sx * (hw - a / 2 + 0.03), y, sz * (hw - a / 2 + 0.03));
      }
    }
  }
  // Arrow slits with a stone surround and sill on every face the door leaves free.
  const slit = (face: number, off: number, y: number): void => {
    const hw = hwAt(y) + 0.01;
    const ry = (face * Math.PI) / 2;
    const cs = Math.cos(ry);
    const sn = Math.sin(ry);
    const at = (lx: number, lz: number): [number, number] => [lx * cs + lz * sn, -lx * sn + lz * cs];
    const [fx, fz] = at(off, hw);
    wall.box(0.26, 0.5, 0.05, stoneLt, fx, y, fz, ry);
    const [sx, sz] = at(off, hw + 0.02);
    wall.box(0.11, 0.36, 0.05, SLIT, sx, y, sz, ry, () => 1);
    const [lx, lz] = at(off, hw + 0.03);
    wall.box(0.34, 0.07, 0.1, stoneLt, lx, y - 0.27, lz, ry);
    wall.box(0.3, 0.06, 0.08, stone, lx, y + 0.27, lz, ry);
  };
  const slitY = 0.62 + (overhangY - 0.62) * 0.6;
  for (let face = 0; face < 4; face++) {
    // face 0 = +z, 1 = +x, 2 = -z, 3 = -x
    const isDoor = (face === 0 && facing > 0) || (face === 2 && facing < 0);
    const isBanner = (face === 0 && camSide > 0) || (face === 2 && camSide < 0);
    if (isBanner) continue; // the banner hangs here
    if (king) {
      slit(face, -R * 0.42, slitY);
      slit(face, R * 0.42, slitY);
    } else if (!isDoor) {
      slit(face, 0, slitY);
    } else {
      slit(face, 0, slitY + 0.12);
    }
  }
  // Arched timber door facing the enemy: planks, iron straps, a stone arch.
  {
    const dw = king ? 0.66 : 0.5;
    const dh = king ? 0.78 : 0.62;
    const z = facing * (hwAt(0.9) + 0.035);
    const y0 = 0.36;
    wall.box(dw + 0.2, dh + 0.06, 0.08, stoneLt, 0, y0 + dh / 2, z - facing * 0.01);
    const archGeo = new THREE.CylinderGeometry(dw / 2 + 0.1, dw / 2 + 0.1, 0.08, 14, 1, false, 0, Math.PI);
    archGeo.rotateZ(Math.PI / 2);
    archGeo.rotateY(Math.PI / 2);
    wall.add(archGeo, stoneLt, 0, y0 + dh, z - facing * 0.01);
    wall.box(dw, dh, 0.07, WOOD, 0, y0 + dh / 2, z + facing * 0.02, 0, () => 1);
    const leaf = new THREE.CylinderGeometry(dw / 2, dw / 2, 0.07, 14, 1, false, 0, Math.PI);
    leaf.rotateZ(Math.PI / 2);
    leaf.rotateY(Math.PI / 2);
    wall.add(leaf, WOOD, 0, y0 + dh, z + facing * 0.02, 0, () => 1);
    for (const dx of [-dw / 4, 0, dw / 4]) wall.box(0.018, dh + dw * 0.3, 0.075, WOOD_DK, dx, y0 + dh / 2 + dw * 0.12, z + facing * 0.022, 0, () => 1);
    for (const dy of [0.2, 0.78]) wall.box(dw, 0.055, 0.085, IRON, 0, y0 + dh * dy, z + facing * 0.024, 0, () => 1);
    wall.add(new THREE.SphereGeometry(0.04, 8, 6), GOLD, dw * 0.28, y0 + dh * 0.5, z + facing * 0.07, 0, () => 1);
    // Keystone.
    wall.box(0.14, 0.14, 0.1, stone, 0, y0 + dh + dw / 2 + 0.1, z);
  }
  // The team banner on the camera's side: cloth on a gold rod, swallow-tailed.
  {
    const bw = king ? 0.72 : 0.56;
    const bh = king ? 1.0 : 0.82;
    const top = overhangY - 0.12;
    const z = camSide * (hwAt(top - bh / 2) + 0.05);
    wall.box(bw, bh, 0.04, roofA, 0, top - bh / 2, z, 0, (_x, y) => 0.86 + 0.14 * smooth(top - bh, top, y));
    wall.box(bw - 0.12, bh - 0.1, 0.045, tone(cloth, 1.12, 0.95), 0, top - bh / 2 + 0.01, z + camSide * 0.004, 0, lit);
    for (const sx of [-1, 1]) {
      const tail = new THREE.ConeGeometry(bw / 4, 0.22, 4);
      tail.rotateX(Math.PI);
      tail.rotateY(Math.PI / 4);
      tail.scale(1, 1, 0.18);
      wall.add(tail, roofA, (sx * bw) / 4, top - bh - 0.1, z, 0, lit);
    }
    const rod = new THREE.CylinderGeometry(0.035, 0.035, bw + 0.2, 8);
    rod.rotateZ(Math.PI / 2);
    wall.add(rod, GOLD, 0, top + 0.01, z + camSide * 0.02, 0, lit);
    for (const sx of [-1, 1]) wall.add(new THREE.SphereGeometry(0.055, 8, 6), GOLD, sx * (bw / 2 + 0.1), top + 0.01, z + camSide * 0.02, 0, lit);
    // Emblem: a gold crown for the king, a gold diamond for the princesses.
    const ez = z + camSide * 0.035;
    const ey = top - bh * 0.48;
    if (king) {
      wall.box(0.4, 0.11, 0.035, GOLD, 0, ey - 0.08, ez, 0, lit);
      for (const dx of [-0.15, 0, 0.15]) {
        const spike = new THREE.ConeGeometry(0.075, dx === 0 ? 0.24 : 0.18, 4);
        spike.scale(1, 1, 0.3);
        wall.add(spike, GOLD, dx, ey + (dx === 0 ? 0.08 : 0.05), ez, 0, lit);
      }
      wall.add(new THREE.SphereGeometry(0.035, 6, 5), 0xe0314a, 0, ey - 0.08, ez + camSide * 0.02, 0, lit);
    } else {
      const gem = new THREE.OctahedronGeometry(0.15);
      gem.scale(0.8, 1.1, 0.22);
      wall.add(gem, GOLD, 0, ey, ez, 0, lit);
    }
    if (spec.flair >= 2) {
      const ruby = new THREE.OctahedronGeometry(0.09);
      wall.add(ruby, 0xe0314a, 0, top - bh - 0.3, z, 0, lit);
    }
  }

  // ---- Battlement: corbels, team string course, parapet, merlons -------------------
  const bat = new Sculpt(lit);
  const out = R * 1.08; // parapet half-width
  bat.add(frustum(wallTop, out, overhangY, H - 0.12), stone, 0, 0, 0, 0, (_x, y, _z, ny) => (ny < -0.2 ? 0.74 + 0.26 * ((y - overhangY) / 0.24) : 1));
  // Machicolation corbels under the overhang.
  const corbels = king ? 5 : 4;
  for (let face = 0; face < 4; face++) {
    const ry = (face * Math.PI) / 2;
    const cs = Math.cos(ry);
    const sn = Math.sin(ry);
    for (let i = 0; i < corbels; i++) {
      const off = (i - (corbels - 1) / 2) * ((wallTop * 1.5) / corbels);
      const lz = wallTop + 0.05;
      bat.box(0.13, 0.2, 0.16, stoneDk, off * cs + lz * sn, overhangY + 0.02, -off * sn + lz * cs, ry, () => 0.82);
    }
  }
  bat.add(frustum(out + 0.02, out + 0.02, H - 0.12, H - 0.03), roofA);
  bat.add(frustum(out + 0.035, out + 0.035, H - 0.03, H + 0.0), GOLD);
  // Parapet walls between the corner turrets.
  const pTop = H + 0.24;
  for (const s of [-1, 1]) {
    bat.box(out * 2 - 0.5, pTop - H, 0.16, stone, 0, (pTop + H) / 2, s * (out - 0.08));
    bat.box(0.16, pTop - H, out * 2 - 0.5, stone, s * (out - 0.08), (pTop + H) / 2, 0);
  }
  // Merlons: three a side, each capped; the camera-side breakables go last.
  const mW = R * 0.3;
  const mH = 0.3;
  const step = R * 0.46;
  const gild = spec.flair >= 1;
  const merlon = (s: Sculpt, row: "a" | "b", side: number, i: number): number => {
    const along = row === "a";
    const x = along ? i * step : side * (out - 0.08);
    const z = along ? side * (out - 0.08) : i * step;
    let n = s.box(along ? mW : 0.2, mH, along ? 0.2 : mW, stoneLt, x, pTop + mH / 2, z);
    n += s.box(along ? mW + 0.05 : 0.25, 0.06, along ? 0.25 : mW + 0.05, gild ? GOLD : stone, x, pTop + mH + 0.03, z);
    return n;
  };
  const breakable = [
    { row: "a" as const, side: camSide, i: 1 },
    { row: "a" as const, side: camSide, i: -1 },
    { row: "b" as const, side: -1, i: camSide },
  ];
  const spots: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      for (const row of ["a", "b"] as const) {
        if (breakable.some((c) => c.row === row && c.side === side && c.i === i)) continue;
        merlon(bat, row, side, i);
      }
    }
  }
  let unitVerts = 0;
  for (let k = breakable.length - 1; k >= 0; k--) {
    const c = breakable[k];
    unitVerts = merlon(bat, c.row, c.side, c.i);
    const along = c.row === "a";
    spots[k] = new THREE.Vector3(along ? c.i * step : c.side * (out - 0.08), pTop + 0.2, along ? c.side * (out - 0.08) : c.i * step);
  }

  // ---- Roof: bartizan turrets under tiled cones, the plank deck, dais, cannon --------
  const roof = new Sculpt(lit);
  const tr = R * (king ? 0.3 : 0.31);
  const tx = out - tr * 0.45;
  const turretTop = H + (king ? 0.62 : 0.5);
  const coneH = R * (king ? 0.95 : 0.9);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * tx;
      const z = sz * tx;
      // Corbelled foot, drum, string course, eave and the tiled cone.
      roof.cyl(tr, tr * 0.35, 0.42, stoneDk, x, overhangY - 0.03, z, 10, (_x, y) => 0.7 + 0.3 * smooth(overhangY - 0.24, overhangY + 0.18, y));
      roof.cyl(tr, tr, turretTop - (overhangY + 0.18), stoneLt, x, (turretTop + overhangY + 0.18) / 2, z, 12);
      roof.cyl(tr + 0.035, tr + 0.035, 0.07, stone, x, H - 0.02, z, 12);
      // A slit on each turret's outer faces.
      roof.box(0.07, 0.24, 0.04, SLIT, x, H + 0.22, z + sz * (tr - 0.005), 0, () => 1);
      roof.box(0.04, 0.24, 0.07, SLIT, x + sx * (tr - 0.005), H + 0.22, z, 0, () => 1);
      roof.cyl(tr + 0.05, tr + 0.14, 0.08, roofDk, x, turretTop + 0.02, z, 12);
      const tiers = 3;
      for (let j = 0; j < tiers; j++) {
        const t0 = j / tiers;
        const t1 = (j + 1) / tiers;
        const rb = (tr + 0.12) * (1 - t0) + (j > 0 ? 0.035 : 0);
        const rt = Math.max(0.002, (tr + 0.12) * (1 - t1));
        roof.add(new THREE.CylinderGeometry(rt, rb, coneH / tiers, 12, 1, true), j % 2 ? roofB : roofA, x, turretTop + 0.06 + coneH * (t0 + t1) / 2, z);
      }
      roof.add(new THREE.SphereGeometry(R * 0.075, 8, 6), GOLD, x, turretTop + 0.06 + coneH + 0.02, z);
    }
  }
  // Plank deck inside the parapet.
  const deckY = H + 0.04;
  const dHw = out - 0.14;
  roof.box(dHw * 2, 0.06, dHw * 2, WOOD, 0, deckY, 0);
  const planks = king ? 7 : 5;
  for (let i = 1; i < planks; i++) {
    roof.box(0.025, 0.012, dHw * 2 - 0.04, WOOD_DK, -dHw + (i * dHw * 2) / planks, deckY + 0.032, 0, 0, () => 1);
  }
  for (const s of [-1, 1]) roof.box(dHw * 2 - 0.04, 0.014, 0.05, tone(WOOD, 1.2), 0, deckY + 0.033, s * dHw * 0.5, 0, () => 1);
  if (king) {
    // The royal dais: a stone drum, a gold rim and a team carpet.
    const dz = -facing * R * 0.34;
    roof.cyl(R * 0.6, R * 0.68, 0.14, stoneLt, 0, deckY + 0.1, dz, 10);
    roof.cyl(R * 0.62, R * 0.62, 0.035, GOLD, 0, deckY + 0.18, dz, 10);
    roof.cyl(R * 0.5, R * 0.5, 0.02, roofA, 0, deckY + 0.205, dz, 10);
  }
  if (spec.gun) {
    // A banded cannon on a wheeled carriage, aimed downlane.
    const gx = R * 0.5;
    const gz = facing * R * 0.46;
    const gy = deckY + 0.06;
    roof.box(0.3, 0.12, 0.4, WOOD_DK, gx, gy + 0.06, gz);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10);
      wheel.rotateZ(Math.PI / 2);
      roof.add(wheel, IRON, gx + sx * 0.18, gy + 0.09, gz);
    }
    const br = king ? 0.15 : 0.12;
    const bl = king ? 0.8 : 0.62;
    const tilt = facing * 1.35;
    const tube = new THREE.CylinderGeometry(br * 0.86, br * 1.1, bl, 12);
    tube.rotateX(tilt);
    roof.add(tube, IRON, gx, gy + 0.22, gz + facing * 0.12);
    for (const along of [-0.3, 0.12, 0.47]) {
      const band = new THREE.CylinderGeometry(br * 1.14, br * 1.14, 0.07, 12);
      band.translate(0, along * bl, 0);
      band.rotateX(tilt);
      roof.add(band, along > 0.4 ? GOLD : GOLD_DK, gx, gy + 0.22, gz + facing * 0.12);
    }
  }

  // ---- Into the chunks ------------------------------------------------------------
  const add = (g: THREE.Group, m: THREE.Mesh | null): void => {
    if (m) g.add(m);
  };
  add(spec.chunks.base, base.mesh(sculptMaterial(), "keep-base"));
  add(spec.chunks.wall, wallTex.mesh(sculptMaterial(ashlarTexture(variant)), "keep-ashlar"));
  add(spec.chunks.wall, wall.mesh(sculptMaterial(), "keep-wall"));
  add(spec.chunks.battlement, bat.mesh(sculptMaterial(), "keep-battlement"));
  add(spec.chunks.roof, roof.mesh(sculptMaterial(), "keep-roof"));

  return {
    unitVerts,
    spots,
    flagFoot: new THREE.Vector3(-tx, turretTop + 0.06 + coneH - 0.05, -camSide * tx),
    midRadius: hwAt(overhangY * 0.55),
  };
}
