import * as THREE from "three";
import type { Side } from "../game/arena";
import type { TeamPalette } from "../ui/prefs";
import { teamColor, teamPalette } from "./teamColors";

/**
 * Bold team discs under every troop: a translucent team-coloured fill, a
 * solid ring from r*0.62 to r*1.08 with a dark outer edge, and — on enemy
 * discs only — three chevron notches bitten out of the ring, so the side
 * also reads by SHAPE for colour-blind players (and on any floor colour).
 *
 * The texture is drawn analytically from a pure pixel plan (testable in
 * node, no DOM canvas), once per (side, palette), and shared by every disc.
 */

export const DISC_SIZE = 64;
/** Ring inner edge as a fraction of the disc's outer radius (r*0.62 / r*1.08). */
export const RING_INNER = 0.62 / 1.08;
/** World radius of the ring's outer edge, as a multiple of the unit radius. */
export const DISC_OUTER = 1.08;
/** Swarm units still get a disc big enough to read at phone size. */
export const DISC_MIN_RADIUS = 0.45;
/** Opacity of the inner fill. */
export const FILL_ALPHA = 0.35;
const RING_ALPHA = 0.95;
/** Notch centres (radians, texture space) on enemy discs. */
export const NOTCH_ANGLES: readonly number[] = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
/** Half-width (radians) of a notch at the ring's outer edge; it narrows to a point inward. */
const NOTCH_HALF = 0.2;
/** How far into the ring a notch bites (fraction of the ring width). */
const NOTCH_DEPTH = 0.9;
/** Supersamples per pixel axis (anti-aliasing). */
const SS = 4;

type Rgba = readonly [number, number, number, number];

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function scaled(c: readonly number[], f: number): [number, number, number] {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/** Smallest absolute angle between a and b. */
function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/**
 * Colour (straight RGBA, 0..255) of one point of the disc. `u` is the
 * distance from the centre as a fraction of the outer radius, `theta` the
 * angle; `edge` is how wide the dark rim and notch outlines are, in u units.
 */
export function discSample(
  side: Side,
  palette: TeamPalette,
  u: number,
  theta: number,
  edge = 1.25 / (DISC_SIZE / 2),
): Rgba {
  if (u > 1) return [0, 0, 0, 0];
  const main = rgb(teamColor(side, "main", palette));
  const rim = scaled(rgb(teamColor(side, "dark", palette)), 0.45);
  const fill: Rgba = [main[0], main[1], main[2], FILL_ALPHA * 255];
  if (u < RING_INNER) return fill;
  // Radial position across the ring: 0 at the inner edge, 1 at the outer.
  const t = (u - RING_INNER) / (1 - RING_INNER);
  if (side === "enemy") {
    // Chevron notch: a V cut from the outer edge, narrowing inward.
    const open = (t - (1 - NOTCH_DEPTH)) / NOTCH_DEPTH; // 0 at the V's tip
    if (open > 0) {
      for (const a of NOTCH_ANGLES) {
        const half = NOTCH_HALF * open;
        const gap = (half - angDist(theta, a)) * u; // >0 inside the cut
        if (gap > 0) return fill;
        if (gap > -edge) return [rim[0], rim[1], rim[2], 255]; // outline the cut
      }
    }
  }
  if (u > 1 - edge) return [rim[0], rim[1], rim[2], 255]; // dark outer edge
  if (u < RING_INNER + edge * 0.8) {
    // Soft lit inner lip so the ring reads as a raised band.
    const lip = scaled(main, 1.18);
    return [Math.min(255, lip[0]), Math.min(255, lip[1]), Math.min(255, lip[2]), RING_ALPHA * 255];
  }
  return [main[0], main[1], main[2], RING_ALPHA * 255];
}

/**
 * The full disc as straight-alpha RGBA bytes (row 0 = bottom, as WebGL
 * uploads data textures), supersampled.
 * Transparent texels keep the rim colour so filtering never fringes grey.
 */
export function discPixels(side: Side, palette: TeamPalette, size = DISC_SIZE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  const radius = half - 0.5; // keep a half-texel margin for filtering
  const edge = 1.25 / radius;
  const rim = scaled(rgb(teamColor(side, "dark", palette)), 0.45);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - half;
          const py = y + (sy + 0.5) / SS - half; // row 0 at the bottom
          const u = Math.sqrt(px * px + py * py) / radius;
          const c = discSample(side, palette, u, Math.atan2(py, px), edge);
          const ca = c[3] / 255;
          r += c[0] * ca;
          g += c[1] * ca;
          b += c[2] * ca;
          a += ca;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = r / a;
        out[i + 1] = g / a;
        out[i + 2] = b / a;
      } else {
        out[i] = rim[0];
        out[i + 1] = rim[1];
        out[i + 2] = rim[2];
      }
      out[i + 3] = (a / (SS * SS)) * 255;
    }
  }
  return out;
}

const textures = new Map<string, THREE.DataTexture>();

/** Cached disc texture for a side in a palette (built once, shared). */
export function teamDiscTexture(side: Side, palette: TeamPalette = teamPalette()): THREE.DataTexture {
  const key = `${side}:${palette}`;
  let tex = textures.get(key);
  if (!tex) {
    tex = new THREE.DataTexture(discPixels(side, palette), DISC_SIZE, DISC_SIZE, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.userData.shared = true; // disposeDeep must skip it
    tex.needsUpdate = true;
    textures.set(key, tex);
  }
  return tex;
}

/** Shared unit plane for every disc (scaled per unit). */
let discGeo: THREE.PlaneGeometry | null = null;

/**
 * A ground disc for a unit of the given radius. The material is per unit
 * (death fades every material of a view), the texture and plane are shared.
 * Draws after the contact shadow (renderOrder -1) and never writes depth.
 */
export function makeTeamDisc(side: Side, radius: number): THREE.Mesh {
  if (!discGeo) {
    discGeo = new THREE.PlaneGeometry(1, 1);
    discGeo.userData.shared = true;
  }
  const disc = new THREE.Mesh(
    discGeo,
    new THREE.MeshBasicMaterial({
      map: teamDiscTexture(side),
      transparent: true,
      depthWrite: false,
    }),
  );
  disc.name = "teamDisc";
  disc.userData.side = side;
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.025;
  const d = Math.max(radius, DISC_MIN_RADIUS) * DISC_OUTER * 2;
  disc.scale.set(d, d, 1);
  disc.renderOrder = 0;
  return disc;
}

/** Point an existing disc at the texture for the current palette. */
export function refreshTeamDisc(disc: THREE.Mesh, palette: TeamPalette = teamPalette()): void {
  const side = disc.userData.side as Side | undefined;
  const mat = disc.material as THREE.MeshBasicMaterial;
  if (!side || !mat.map) return;
  mat.map = teamDiscTexture(side, palette);
  mat.needsUpdate = true;
}
