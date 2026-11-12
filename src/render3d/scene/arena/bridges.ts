/**
 * Classic crossings by BridgeStyle (art bible section 3), each sculpted into
 * one vertex-coloured mesh for both bridges:
 *
 *  - timber: C's uneven planks over dark bearers, stone abutments and
 *    post-and-rope rails (build.ts keeps it);
 *  - stone:  a flagstone deck between low ashlar parapets with capstones,
 *            four end piers with ball finials, and an arch ring on the
 *            camera-facing (south) end;
 *  - ice:    one thick glacier-blue slab (bluer and darker than snow, so it
 *            reads as a crossing on white) between blue-grey kerbs with a
 *            frost rim, low snow-capped posts, icicles down the camera face;
 *  - gate:   a small gatehouse: two pylons with a high lintel (clear of the
 *            troops crossing under it) on a slate deck with the gold buckle.
 *
 * The camera looks from the south at ~49 degrees, so detail sits on the top
 * and south faces.
 */
import * as THREE from "three";
import { BRIDGE_XS, RIVER_Y } from "../../../game/arena";
import type { ArenaLook } from "../../arenaLooks";
import { toWorld } from "../common";
import { Sculpt, sculptMaterial, tone } from "../views/towerCraft";

const lit = (_x: number, _y: number, _z: number, ny: number): number => (ny > 0.7 ? 1.06 : ny < -0.4 ? 0.7 : 1);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Deck half-length along z (world units) and half-width in x. */
const HALF_LEN = 1.3;
const HALF_W = 1.0;

function stoneBridge(s: Sculpt, x: number, look: ArenaLook, rand: () => number): void {
  const stone = tone(look.tower.plinth, 1.08, 0.7);
  const deckC = tone(look.tower.platformPlayer, 0.95, 0.7);
  const cap = tone(look.edging, 1.05, 0.9);
  // Deck slab, then flagstones laid in two staggered courses.
  s.box(HALF_W * 2 + 0.1, 0.22, HALF_LEN * 2, tone(stone, 0.8), x, 0.08, 0, 0, lit);
  for (let row = 0; row < 7; row++) {
    const z = -HALF_LEN + 0.2 + row * 0.37;
    let x0 = x - 0.78 + (row % 2) * 0.18;
    while (x0 < x + 0.78) {
      const w = Math.min(x + 0.8 - x0, 0.36 + rand() * 0.24);
      s.box(w - 0.04, 0.05, 0.33, tone(deckC, 0.9 + rand() * 0.16), x0 + w / 2, 0.215, z, 0, lit);
      x0 += w;
    }
  }
  for (const side of [-1, 1]) {
    const px = x + side * 0.94;
    // Ashlar parapet: blocks of uneven length under a capstone run.
    let z = -HALF_LEN - 0.1;
    while (z < HALF_LEN + 0.1) {
      const len = Math.min(HALF_LEN + 0.1 - z, 0.4 + rand() * 0.25);
      s.box(0.22, 0.34, len - 0.03, tone(stone, 0.92 + rand() * 0.14), px, 0.38, z + len / 2, 0, lit);
      z += len;
    }
    s.box(0.3, 0.07, HALF_LEN * 2 + 0.3, cap, px, 0.58, 0, 0, lit);
    for (const ez of [-1, 1]) {
      const pz = ez * (HALF_LEN + 0.12);
      s.box(0.36, 0.62, 0.36, tone(stone, 0.96), px, 0.36, pz, 0, lit);
      s.box(0.42, 0.06, 0.42, cap, px, 0.7, pz, 0, lit);
      s.add(new THREE.SphereGeometry(0.13, 10, 8), cap, px, 0.85, pz, 0, lit);
    }
  }
  // Abutment steps where the deck meets each bank.
  for (const ez of [-1, 1]) s.box(HALF_W * 2 + 0.5, 0.16, 0.3, tone(stone, 0.9), x, 0.06, ez * (HALF_LEN + 0.12), 0, lit);
}

/**
 * Glacier-ice colours. The deck and body are clearly bluer and darker than
 * any snow or ice floor, and blue-grey kerbs and posts outline the long
 * edges, so the crossing reads on white.
 */
export const ICE_BRIDGE = {
  body: 0x3f74a8,
  deck: 0x6aaedc,
  crack: 0x4f8cc0,
  kerb: 0x435d7c,
  post: 0x3a5270,
  frost: 0xf4fbff,
  icicle: 0xcfe8f6,
} as const;

function iceBridge(s: Sculpt, x: number, rand: () => number): void {
  const C = ICE_BRIDGE;
  // One thick slab of glacier ice: a deep-blue body under a clear-blue deck.
  s.box(HALF_W * 2 + 0.2, 0.3, HALF_LEN * 2 + 0.1, C.body, x, 0.07, 0, 0, lit);
  s.box(HALF_W * 2 - 0.1, 0.08, HALF_LEN * 2 - 0.1, C.deck, x, 0.25, 0, 0, lit);
  for (const side of [-1, 1]) {
    const kx = x + side * (HALF_W - 0.02);
    // A blue-grey kerb along each long edge (its top is what the camera
    // sees, so the frost rim is only a thin line on the outer edge).
    s.box(0.24, 0.16, HALF_LEN * 2 + 0.1, C.kerb, kx, 0.3, 0, 0, lit);
    s.box(0.05, 0.03, HALF_LEN * 2 + 0.06, C.frost, kx + side * 0.1, 0.39, 0, 0, lit);
    // Low posts at the ends and the middle, each under a small snow cap
    // that leaves the dark post top showing round it.
    for (const pz of [-(HALF_LEN - 0.02), 0, HALF_LEN - 0.02]) {
      s.box(0.28, 0.44, 0.28, C.post, kx, 0.4, pz, 0, lit);
      const cap = new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.6, 1);
      s.add(cap, C.frost, kx, 0.62, pz, 0, lit);
    }
  }
  // The camera face: a frosted lip with icicles hanging off it.
  s.box(HALF_W * 2 + 0.2, 0.08, 0.14, C.frost, x, 0.24, HALF_LEN + 0.03, 0, lit);
  for (let i = 0; i < 9; i++) {
    const h = 0.16 + rand() * 0.2;
    const g = new THREE.ConeGeometry(0.05, h, 5);
    g.rotateX(Math.PI);
    s.add(g, i % 2 ? C.icicle : C.frost, x - 0.9 + i * 0.225, 0.2 - h / 2, HALF_LEN + 0.08, 0, lit);
  }
  // Cracks and frost chips on the deck.
  for (let i = 0; i < 10; i++) {
    const c = i % 2 ? C.crack : C.frost;
    s.box(0.18 + rand() * 0.2, 0.012, 0.03, c, x + (rand() - 0.5) * 1.4, 0.295, (rand() - 0.5) * 2.2, rand() * 3, () => 1);
  }
}

function gatehouse(s: Sculpt, x: number, glow: Sculpt, look: ArenaLook): void {
  const SLATE = 0x343a52;
  const SLATEDK = 0x23283c;
  const GOLD = 0xd9a93f;
  const GOLDLT = 0xf2c14e;
  s.box(2.1, 0.24, HALF_LEN * 2, SLATE, x, 0.1, 0, 0, lit);
  // A tiled slate deck framed in thin gold strips (two flat gold slabs
  // read as yellow UI squares in black frames).
  s.box(1.7, 0.08, 2.0, 0x4a5172, x, 0.25, 0, 0, lit);
  s.box(1.15, 0.09, 1.3, 0x5c6488, x, 0.27, 0, 0, lit);
  for (const sx of [-1, 1]) s.box(0.06, 0.1, 2.0, GOLD, x + sx * 0.85, 0.26, 0, 0, lit);
  for (const sz of [-1, 1]) s.box(1.15, 0.1, 0.05, GOLDLT, x, 0.28, sz * 0.65, 0, lit);
  for (const sz of [-1, 1]) {
    for (const dx of [-0.38, 0, 0.38]) {
      const g = new THREE.ConeGeometry(0.14, 0.3, 4);
      g.rotateY(Math.PI / 4);
      s.add(g, GOLDLT, x + dx, 0.32, sz * 0.85, 0, lit);
    }
  }
  // Two pylons at the far end and a high lintel: the gatehouse frames the
  // crossing without hiding the troops on it.
  const pz = -HALF_LEN + 0.15;
  for (const sx of [-1, 1]) {
    const px = x + sx * 1.08;
    s.box(0.36, 2.5, 0.42, SLATEDK, px, 1.25, pz, 0, lit);
    s.box(0.46, 0.12, 0.52, GOLD, px, 2.56, pz, 0, lit);
    s.box(0.44, 0.1, 0.5, GOLD, px, 0.08, pz, 0, lit);
    glow.box(0.05, 2.1, 0.05, look.neon ? look.neon.enemy : 0xff4fd8, px - sx * 0.19, 1.3, pz + 0.2);
  }
  s.box(2.6, 0.26, 0.4, SLATEDK, x, 2.72, pz, 0, lit);
  s.box(2.7, 0.08, 0.46, GOLD, x, 2.89, pz, 0, lit);
  const crest = new THREE.OctahedronGeometry(0.22);
  crest.scale(1, 1.2, 0.3);
  s.add(crest, GOLDLT, x, 3.15, pz, 0, lit);
  glow.box(2.4, 0.05, 0.05, look.neon ? look.neon.player : 0x4f8aff, x, 2.6, pz + 0.21);
  // The near-end posts stay low.
  for (const sx of [-1, 1]) {
    s.box(0.34, 0.5, 0.34, SLATEDK, x + sx * 1.0, 0.3, HALF_LEN - 0.1, 0, lit);
    s.box(0.4, 0.09, 0.4, GOLD, x + sx * 1.0, 0.58, HALF_LEN - 0.1, 0, lit);
  }
}

/**
 * Both classic bridges for `look` (not timber, which build.ts sculpts), as
 * one lit mesh plus, for the gatehouse, one glow mesh (`glow` makes the
 * dimmable material). Returns the meshes it added.
 */
export function buildClassicBridges(parent: THREE.Object3D, look: ArenaLook, glow: (c: number) => THREE.Material): THREE.Mesh[] {
  const style = look.band.bridge;
  if (style === "timber") return [];
  const s = new Sculpt(lit);
  const g = new Sculpt(() => 1);
  const rand = rng(4242);
  for (const bx of BRIDGE_XS) {
    const w = toWorld(bx, RIVER_Y);
    if (style === "ice") iceBridge(s, w.x, rand);
    else if (style === "gate") gatehouse(s, w.x, g, look);
    else stoneBridge(s, w.x, look, rand);
  }
  const out: THREE.Mesh[] = [];
  const mesh = s.mesh(sculptMaterial(), `${style}-bridges`);
  if (mesh) out.push(mesh);
  const glowMat = glow(0xffffff);
  glowMat.vertexColors = true;
  const glowMesh = g.mesh(glowMat, "bridge-glow");
  if (glowMesh) {
    glowMesh.castShadow = glowMesh.receiveShadow = false;
    out.push(glowMesh);
  }
  for (const m of out) parent.add(m);
  return out;
}
