/**
 * Primitive props of our own for the cast (horns, crowns, braids, beards,
 * turbans, muskets, scimitars...), built in the rig's rest-pose space
 * (y up, the character facing +z, about 2.4 units tall) or, for
 * hand-held props, in the hand slot's own space (`local` extras, the grip
 * at the origin, the weapon along +y after `held`).
 */
import * as THREE from "three";
import type { Extra, Paint, Variant } from "./types";

const E = new THREE.Euler();
const MAT = new THREE.Matrix4();

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  if (rx || ry || rz) g.applyMatrix4(MAT.makeRotationFromEuler(E.set(rx, ry, rz)));
  return g.translate(x, y, z);
}

export const cone = (r: number, h: number, x: number, y: number, z: number, rz = 0, rx = 0, seg = 10): THREE.BufferGeometry =>
  place(new THREE.ConeGeometry(r, h, seg), x, y, z, rx, 0, rz);
export const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry =>
  place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
export const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 10, rx = 0, rz = 0): THREE.BufferGeometry =>
  place(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, rx, 0, rz);
export const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))).scale(sx, sy, sz).translate(x, y, z);
/** The top of a sphere down to `cut` (0..1 of the half-circle from the pole): caps, helmets, domes. */
export const cap = (r: number, cut: number, x: number, y: number, z: number, sy = 1, seg = 14): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.5)), 0, Math.PI * 2, 0, Math.PI * cut).scale(1, sy, 1).translate(x, y, z);
export const torus = (r: number, t: number, x: number, y: number, z: number, rx = Math.PI / 2, seg = 16): THREE.BufferGeometry =>
  place(new THREE.TorusGeometry(r, t, 6, seg), x, y, z, rx);

/**
 * A curved piece of cloth: an elliptical band about the body's upright axis
 * between two heights, over an arc of angles (0 is +z, the front; positive
 * turns toward +x), flaring from the top radii to the bottom ones. A closed
 * shell `thick` deep with outward normals, so it shades like cloth and takes
 * the silhouette ink (tabards, sashes, veils): never a flat board.
 */
export interface DrapeSpec {
  top: number;
  bottom: number;
  /** Half-widths (x) at the top and at the bottom. */
  rx: [number, number];
  /** Half-depths (z) at the top and at the bottom. */
  rz: [number, number];
  /** Arc covered, radians from +z toward +x. A full turn makes a band. */
  arc: [number, number];
  /** Centre of the ellipse. */
  x?: number;
  z?: number;
  thick?: number;
  seg?: number;
  rows?: number;
  /** Outward bulge at mid-height, as a share of the radius (cloth over a belly). */
  belly?: number;
}

export function drape(s: DrapeSpec): THREE.BufferGeometry {
  const seg = s.seg ?? 10;
  const rows = s.rows ?? 3;
  const t = s.thick ?? 0.04;
  const cx = s.x ?? 0;
  const cz = s.z ?? 0;
  const pos: number[] = [];
  // Outer grid, then inner grid: (rows + 1) x (seg + 1) each.
  for (const inner of [0, 1]) {
    for (let r = 0; r <= rows; r++) {
      const k = r / rows;
      const y = s.top + (s.bottom - s.top) * k;
      const bulge = 1 + (s.belly ?? 0) * Math.sin(Math.PI * k);
      const rx = (s.rx[0] + (s.rx[1] - s.rx[0]) * k) * bulge - inner * t;
      const rz = (s.rz[0] + (s.rz[1] - s.rz[0]) * k) * bulge - inner * t;
      for (let i = 0; i <= seg; i++) {
        const a = s.arc[0] + ((s.arc[1] - s.arc[0]) * i) / seg;
        pos.push(cx + Math.sin(a) * rx, y, cz + Math.cos(a) * rz);
      }
    }
  }
  const W = seg + 1;
  const O = (r: number, i: number): number => r * W + i;
  const I = (r: number, i: number): number => (rows + 1) * W + r * W + i;
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < seg; i++) {
      idx.push(O(r, i), O(r + 1, i), O(r, i + 1), O(r, i + 1), O(r + 1, i), O(r + 1, i + 1));
      idx.push(I(r, i), I(r, i + 1), I(r + 1, i), I(r, i + 1), I(r + 1, i + 1), I(r + 1, i));
    }
  }
  for (let i = 0; i < seg; i++) {
    idx.push(O(0, i), O(0, i + 1), I(0, i), O(0, i + 1), I(0, i + 1), I(0, i));
    idx.push(O(rows, i), I(rows, i), O(rows, i + 1), O(rows, i + 1), I(rows, i), I(rows, i + 1));
  }
  // The two side edges (a full band has none: they would meet as a seam).
  if (Math.abs(s.arc[1] - s.arc[0]) < Math.PI * 2 - 1e-6) {
    for (let r = 0; r < rows; r++) {
      idx.push(O(r, 0), I(r, 0), O(r + 1, 0), O(r + 1, 0), I(r, 0), I(r + 1, 0));
      idx.push(O(r, seg), O(r + 1, seg), I(r, seg), O(r + 1, seg), I(r + 1, seg), I(r, seg));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Head-space reference points of the KayKit bodies (rest pose, before the head scale). */
export const HEAD_Y = 1.86; // middle of the head
export const HEAD_TOP = 2.32; // crown of the head
export const HEAD_R = 0.5; // half-width of the head

/** A hand-held prop's geometry tipped so it points along the hand slot's grip (+y forward out of the fist). */
const GRIP = new THREE.Matrix4().makeRotationX(Math.PI + 0.95);
export const held = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(GRIP);

/** Shorthand for a primitive extra. */
export function x(bone: string, color: Paint, geo: () => THREE.BufferGeometry, more: Partial<Extra> = {}): Extra {
  return { bone, color, geo, ...more };
}

/** A hand-held extra in the right (or left) hand slot. */
export function inHand(color: Paint, geo: () => THREE.BufferGeometry, left = false): Extra {
  return { bone: left ? "handslotl" : "handslotr", local: true, color, geo: () => held(geo()) };
}

// ------------------------------------------------------------- headgear

/**
 * A crown: a band with five short points (never a radial "sunflower"),
 * sitting on the head. Returns the band and the points as separate extras
 * (the band is an open shell, drawn two-sided without ink).
 */
export function crown(color: number, r = 0.4, y = HEAD_TOP - 0.02, jewel?: number): Extra[] {
  const out: Extra[] = [
    x("head", color, () => new THREE.CylinderGeometry(r, r * 0.92, 0.2, 16, 1, true).translate(0, y, 0), { open: true }),
    x("head", color, () => torus(r * 0.98, 0.035, 0, y - 0.09, 0)),
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    out.push(x("head", color, () => cone(0.07, 0.2, Math.sin(a) * r * 0.95, y + 0.19, Math.cos(a) * r * 0.95, 0, 0, 6)));
  }
  if (jewel !== undefined) out.push(x("head", jewel, () => ball(0.06, 0, y, r * 0.98, 1, 1, 0.6, 8)));
  return out;
}

/** Two braids hanging down the back of the head to the shoulders (the Valkyrie). */
export function braids(color: number): Extra[] {
  const out: Extra[] = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      out.push(x("head", color, () => ball(0.1 - i * 0.01, s * 0.3, 1.66 - i * 0.17, -0.34 - i * 0.03, 1, 1.15, 1, 8)));
    }
    out.push(x("head", 0xf2c65a, () => cyl(0.06, 0.06, 0.06, s * 0.3, 1.0, -0.44, 8)));
  }
  return out;
}

/** A full beard hanging under the chin, clear of the eyes (the Giant, the King, the Wizard...). */
export function beard(color: number, size = 1, y = 1.36): Extra[] {
  return [
    x("head", color, () => ball(0.3 * size, 0, y, 0.36, 1.3, 0.8, 0.7, 12)),
    x("head", color, () => cone(0.18 * size, 0.36 * size, 0, y - 0.3 * size, 0.4, Math.PI, 0, 8)),
  ];
}

/** A wrapped turban: three stacked rolls and a crown cap, with an optional plume or jewel at the front. */
export function turban(color: number, wrap: number, y = HEAD_TOP - 0.18, r = 0.5, jewel?: number): Extra[] {
  const out: Extra[] = [
    x("head", color, () => torus(r, 0.13, 0, y, 0, Math.PI / 2, 18)),
    x("head", wrap, () => torus(r * 0.86, 0.12, 0, y + 0.17, 0, Math.PI / 2 - 0.08, 18)),
    x("head", color, () => cap(r * 0.82, 0.5, 0, y + 0.2, 0, 0.9)),
  ];
  if (jewel !== undefined) out.push(x("head", jewel, () => ball(0.08, 0, y + 0.14, r * 1.05, 1, 1.2, 0.6, 8)));
  return out;
}

/** A pointed turban helmet: a steel dome with a spike over a cloth wrap (Golden Age soldiers). */
export function turbanHelmet(steel: number, wrap: number, spike: number): Extra[] {
  return [
    x("head", wrap, () => torus(0.5, 0.13, 0, HEAD_TOP - 0.22, 0, Math.PI / 2, 18)),
    x("head", steel, () => cap(0.47, 0.5, 0, HEAD_TOP - 0.18, 0, 1.15)),
    x("head", spike, () => cone(0.07, 0.26, 0, HEAD_TOP + 0.42, 0, 0, 0, 8)),
  ];
}

/** A keffiyeh-style head cloth: a cap over the head and a drape down the back of the neck (cloth: team-able). */
export function headCloth(color: Paint, cord: number): Extra[] {
  const cloth = color === "team" || color === "teamDark";
  return [
    x("head", color, () => cap(0.55, 0.55, 0, HEAD_Y + 0.02, 0, 1.0), { cloth }),
    // The drape hangs round the back of the head to the nape: a curved shell, not a board.
    x("head", color, () => drape({ top: HEAD_Y, bottom: 1.3, rx: [0.53, 0.58], rz: [0.5, 0.6], z: -0.03, arc: [Math.PI - 1.55, Math.PI + 1.55], thick: 0.06, seg: 12, rows: 3, belly: 0.06 }), { cloth }),
    x("head", cord, () => torus(0.5, 0.05, 0, HEAD_TOP - 0.2, 0, Math.PI / 2, 16)),
  ];
}

// ------------------------------------------------------------- weapons

/** A flintlock musket in the hand slot: stock, barrel and a gold muzzle band. */
export function musket(wood = 0x7a5230, steel = 0x39404d, brass = 0xe2b23c): Extra[] {
  return [
    inHand(wood, () => box(0.13, 0.5, 0.17, 0, -0.28, 0)),
    inHand(wood, () => box(0.12, 0.44, 0.15, 0, 0.1, 0)),
    inHand(steel, () => cyl(0.05, 0.055, 1.25, 0, 0.92, 0, 8)),
    inHand(brass, () => cyl(0.075, 0.075, 0.12, 0, 1.55, 0, 8)),
  ];
}

/** A curved scimitar in the hand slot: grip, guard and a bent blade held out past the body. */
export function scimitar(steel = 0xd8e2ec, hilt = 0xe2b23c, left = false): Extra[] {
  return [
    inHand(0x5a3a22, () => cyl(0.045, 0.045, 0.3, 0, 0, 0, 6), left),
    inHand(hilt, () => box(0.32, 0.06, 0.08, 0, 0.17, 0), left),
    inHand(steel, () => box(0.07, 0.62, 0.16, 0, 0.5, 0.03, 0.12), left),
    inHand(steel, () => box(0.07, 0.36, 0.2, 0, 0.93, 0.13, 0.42), left),
  ];
}

/** A long bow held upright in the left hand, its arc out past the body (the Archers' back read). */
export function bow(wood = 0x8a5a2e, string = 0xf2ead8): Extra[] {
  const arc = (): THREE.BufferGeometry => new THREE.TorusGeometry(0.62, 0.045, 5, 14, Math.PI * 0.82).rotateZ(Math.PI * 0.59).rotateY(Math.PI / 2);
  return [
    { bone: "handslotl", local: true, color: wood, geo: () => arc().translate(0, 0, -0.25) },
    { bone: "handslotl", local: true, color: string, geo: () => box(0.02, 1.0, 0.02, 0, 0, 0.22) },
  ];
}

/** A quiver on the back, arrow fletchings poking up over the shoulder. */
export function quiver(leather = 0x7a4a2a, fletch = 0xf2ead8): Extra[] {
  return [
    x("chest", leather, () => cyl(0.13, 0.11, 0.62, 0.18, 1.32, -0.34, 8, -0.35, -0.35)),
    x("chest", fletch, () => cone(0.07, 0.18, 0.31, 1.7, -0.48, -0.35, -0.35, 4)),
    x("chest", fletch, () => cone(0.07, 0.18, 0.22, 1.73, -0.43, -0.35, -0.35, 4)),
  ];
}

/** A round backpack or bedroll on the back. */
export function pack(color: number, strap = 0x5a3a22): Extra[] {
  return [
    x("chest", color, () => ball(0.3, 0, 1.25, -0.38, 1.1, 0.95, 0.7, 10)),
    x("chest", strap, () => box(0.62, 0.07, 0.07, 0, 1.43, -0.6)),
  ];
}

// ------------------------------------------------------------- team cloth

/**
 * A team TABARD: a cloth panel down the chest and belly, so the side reads
 * from the FRONT as well as from behind (the cape hides behind the body
 * when a unit walks toward the camera). `back` adds the back panel for a
 * body without a cape; `bottom` lifts the hem clear of a rider's lap.
 */
export function tabard(o: { bottom?: number; back?: boolean; half?: number } = {}): Extra[] {
  const half = o.half ?? 0.75;
  const panel = (mid: number): Extra =>
    x(
      "chest",
      "team",
      () => drape({ top: 1.14, bottom: o.bottom ?? 0.5, rx: [0.33, 0.42], rz: [0.34, 0.42], arc: [mid - half, mid + half], thick: 0.05, belly: 0.03 }),
      { cloth: true },
    );
  return o.back ? [panel(0), panel(Math.PI)] : [panel(0)];
}

/**
 * A team CAPELET: a short round cape over both shoulders, for a unit whose
 * weapon is held across its belly (a two-handed sword, an axe, a crossbow):
 * the shoulders still show its side from the front.
 */
export function capelet(): Extra[] {
  return [
    x("chest", "team", () => drape({ top: 1.3, bottom: 1.0, rx: [0.3, 0.56], rz: [0.28, 0.48], arc: [-Math.PI, Math.PI], seg: 18, rows: 2, thick: 0.05, belly: 0.06 }), {
      cloth: true,
    }),
  ];
}

/** A team SASH: a broad band round the waist, knotted at the left hip with two tails hanging (bare-chested bodies). */
export function sash(y = 0.74): Extra[] {
  return [
    x("spine", "team", () => drape({ top: y + 0.14, bottom: y - 0.13, rx: [0.43, 0.45], rz: [0.39, 0.41], arc: [-Math.PI, Math.PI], seg: 18, rows: 2, thick: 0.05, belly: 0.03 }), { cloth: true }),
    x("spine", "team", () => ball(0.1, 0.27, y + 0.01, 0.37, 1.2, 1, 0.8, 8), { cloth: true }),
    x("spine", "team", () => box(0.13, 0.36, 0.05, 0.22, y - 0.24, 0.41, 0.1, 0, 0.2), { cloth: true }),
    x("spine", "team", () => box(0.12, 0.3, 0.05, 0.35, y - 0.2, 0.36, 0.1, 0, -0.15), { cloth: true }),
  ];
}

/**
 * The front-visible team cloth a variant wears unless its roster gives it its
 * own: a sash on the bare-chested barbarian body, a tabard on the others
 * (short over a rider's lap; front and back on a body without a cape).
 */
export function teamFront(v: Pick<Variant, "file" | "mount" | "team" | "props">): Extra[] {
  if (v.file === "barbarian") return sash();
  const caped = v.team !== undefined && v.props.some((p) => v.team!.test(p));
  return tabard({ bottom: v.mount ? 0.66 : undefined, back: !caped });
}

/** Dress every variant of a roster in its front team cloth (once per variant: aliases share one object). */
export function dressTeamFront(roster: Record<string, Variant>, own: Record<string, Extra[]> = {}): void {
  const done = new Set<Variant>();
  for (const [id, v] of Object.entries(roster)) {
    if (done.has(v)) continue;
    done.add(v);
    v.extras = [...(v.extras ?? []), ...(own[id] ?? teamFront(v))];
  }
}
