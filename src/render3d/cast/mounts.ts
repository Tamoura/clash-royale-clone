/**
 * Procedural mounts for the riders (the Prince's horse, the Hog Rider's
 * hog, the Golden Age camel), in the cast's material language: built from
 * a few big primitives, coloured per vertex over the rider's atlas (its
 * white and team tiles), with the same inked shell, and skinned to six
 * procedural bones (body, head, four legs) so they gallop. One extra draw
 * per rider; the mount shares the rider's material (flash and team uniforms).
 *
 * Facing +z like the riders, in world units (the unit's scale is undone).
 */
import * as THREE from "three";
import { registerInkGeometry, smoothedNormals } from "../outlineMaterial";
import { extraColor } from "./bake";
import { box, cone, cyl, ball, torus } from "./props";
import type { Paint } from "./types";

export type MountKind = "horse" | "hog" | "camel";

export interface MountSpec {
  kind: MountKind;
  coat: number;
  mane: number;
  hoof: number;
  /** The saddle cloth: the team colour (cloth). */
  cloth: Paint;
  /** Where the rider's seat sits above the ground (world units, before `size`). */
  seat: number;
  /** The whole mount (and so the seat) scaled by this. */
  size?: number;
  /** How far forward the seat sits (world units, +z). */
  seatZ?: number;
}

/** Bone roles of a mount skeleton. */
const BODY = 0;
const HEAD = 1;
const LEGS = [2, 3, 4, 5] as const;

interface Part {
  geo: THREE.BufferGeometry;
  bone: number;
  color: Paint;
}

/** Leg pivots (x, y, z) of each kind: front left, front right, back left, back right. */
const LEG_AT: Record<MountKind, [number, number, number][]> = {
  horse: [[0.2, 0.95, 0.55], [-0.2, 0.95, 0.55], [0.2, 0.95, -0.52], [-0.2, 0.95, -0.52]],
  hog: [[0.22, 0.46, 0.34], [-0.22, 0.46, 0.34], [0.22, 0.46, -0.34], [-0.22, 0.46, -0.34]],
  camel: [[0.22, 1.2, 0.55], [-0.22, 1.2, 0.55], [0.22, 1.2, -0.55], [-0.22, 1.2, -0.55]],
};
const HEAD_AT: Record<MountKind, [number, number, number]> = {
  horse: [0, 1.25, 0.72],
  hog: [0, 0.8, 0.6],
  camel: [0, 1.45, 0.78],
};

function partsOf(spec: MountSpec): Part[] {
  const { coat, mane, hoof, cloth } = spec;
  const p: Part[] = [];
  const add = (bone: number, color: Paint, geo: THREE.BufferGeometry): void => {
    p.push({ geo, bone, color });
  };
  const legs = LEG_AT[spec.kind];
  if (spec.kind === "horse") {
    add(BODY, coat, ball(0.36, 0, 1.08, 0, 0.82, 0.86, 2.15, 14));
    add(BODY, coat, ball(0.3, 0, 1.12, -0.6, 0.9, 0.9, 1.0, 10));
    add(BODY, mane, cone(0.1, 0.62, 0, 1.0, -0.98, 0, -2.4, 6));
    add(HEAD, coat, box(0.3, 0.62, 0.34, 0, 1.55, 0.92, -0.55));
    add(HEAD, coat, box(0.28, 0.28, 0.56, 0, 1.78, 1.18, 0.5));
    add(HEAD, 0x3a2a24, box(0.2, 0.12, 0.08, 0, 1.68, 1.44, 0.5));
    add(HEAD, mane, box(0.1, 0.58, 0.2, 0, 1.68, 0.86, -0.55));
    add(HEAD, coat, cone(0.06, 0.18, 0.1, 2.0, 1.0, 0, 0, 5));
    add(HEAD, coat, cone(0.06, 0.18, -0.1, 2.0, 1.0, 0, 0, 5));
    // Saddle cloth over the back, draping down both flanks.
    add(BODY, cloth, box(0.64, 0.08, 0.62, 0, 1.42, -0.05));
    add(BODY, cloth, box(0.06, 0.4, 0.58, 0.33, 1.22, -0.05));
    add(BODY, cloth, box(0.06, 0.4, 0.58, -0.33, 1.22, -0.05));
    add(BODY, 0xe2b23c, box(0.7, 0.06, 0.1, 0, 1.48, 0.3));
    legs.forEach(([x, y, z], i) => {
      add(LEGS[i], coat, cyl(0.1, 0.08, 0.78, x, y - 0.4, z, 8));
      add(LEGS[i], hoof, cyl(0.1, 0.11, 0.14, x, y - 0.86, z, 8));
    });
  } else if (spec.kind === "hog") {
    // A HOG, not a pony: a round barrel low on short thick legs, a flat pink snout disc with up-curved tusks,
    // floppy ears over the eyes, a bristle ridge and a curly tail.
    add(BODY, coat, ball(0.5, 0, 0.76, -0.02, 1.0, 0.8, 1.18, 14));
    add(BODY, coat, ball(0.36, 0, 0.8, -0.38, 1.12, 1.0, 0.9, 10));
    add(BODY, mane, box(0.1, 0.12, 0.86, 0, 1.13, -0.06));
    add(BODY, coat, torus(0.075, 0.03, 0, 0.92, -0.66, 0.4, 8));
    add(HEAD, coat, ball(0.34, 0, 0.8, 0.62, 1.0, 0.9, 1.0, 12));
    add(HEAD, 0xd4a196, cyl(0.18, 0.17, 0.14, 0, 0.74, 0.94, 12, Math.PI / 2));
    add(HEAD, 0x5a2e2a, ball(0.035, 0.06, 0.75, 1.02, 1, 1.3, 0.6, 6));
    add(HEAD, 0x5a2e2a, ball(0.035, -0.06, 0.75, 1.02, 1, 1.3, 0.6, 6));
    add(HEAD, 0x2a2024, ball(0.04, 0.14, 0.92, 0.88, 1, 1, 0.6, 6));
    add(HEAD, 0x2a2024, ball(0.04, -0.14, 0.92, 0.88, 1, 1, 0.6, 6));
    for (const s of [1, -1]) {
      add(HEAD, 0xf2e8d2, cone(0.05, 0.26, s * 0.17, 0.8, 0.9, -s * 0.35, 0.35, 6));
      add(HEAD, coat, new THREE.SphereGeometry(0.14, 8, 6).scale(1, 0.3, 1.35).rotateX(0.75).rotateZ(-s * 0.55).translate(s * 0.24, 1.0, 0.68));
    }
    add(BODY, cloth, box(0.74, 0.08, 0.56, 0, 1.15, -0.05));
    add(BODY, cloth, box(0.06, 0.32, 0.52, 0.43, 0.98, -0.05));
    add(BODY, cloth, box(0.06, 0.32, 0.52, -0.43, 0.98, -0.05));
    legs.forEach(([x, y, z], i) => {
      add(LEGS[i], coat, cyl(0.14, 0.12, 0.34, x, y - 0.2, z, 8));
      add(LEGS[i], hoof, cyl(0.12, 0.13, 0.1, x, y - 0.41, z, 8));
    });
  } else {
    add(BODY, coat, ball(0.38, 0, 1.38, 0, 0.8, 0.75, 1.9, 14));
    add(BODY, coat, ball(0.32, 0, 1.68, -0.25, 0.85, 0.85, 1.0, 12));
    add(BODY, mane, cone(0.08, 0.5, 0, 1.25, -0.82, 0, -2.6, 6));
    add(HEAD, coat, cyl(0.12, 0.15, 0.8, 0, 1.75, 0.98, 8, 0.5));
    add(HEAD, coat, box(0.24, 0.24, 0.5, 0, 2.12, 1.25, 0.15));
    add(HEAD, mane, box(0.26, 0.08, 0.3, 0, 2.18, 1.1, 0.15));
    add(BODY, cloth, box(0.72, 0.08, 0.5, 0, 1.62, 0.32));
    add(BODY, cloth, box(0.06, 0.42, 0.46, 0.36, 1.4, 0.32));
    add(BODY, cloth, box(0.06, 0.42, 0.46, -0.36, 1.4, 0.32));
    add(BODY, 0xe2b23c, torus(0.3, 0.04, 0, 1.62, 0.32, Math.PI / 2, 12));
    legs.forEach(([x, y, z], i) => {
      add(LEGS[i], coat, cyl(0.08, 0.07, 1.1, x, y - 0.56, z, 8));
      add(LEGS[i], hoof, cyl(0.1, 0.11, 0.12, x, y - 1.14, z, 8));
    });
  }
  return p;
}

/** Every fixed colour a mount wears (its team cloth aside): the team-rule test checks them. */
export function mountColors(spec: MountSpec): number[] {
  const parts = partsOf(spec);
  for (const p of parts) p.geo.dispose();
  return [...new Set(parts.map((p) => p.color).filter((c): c is number => typeof c === "number"))];
}

const baked = new Map<string, { geometry: THREE.BufferGeometry; bodyCount: number }>();

/** One mount geometry per kind, colours and atlas layout (shared by every rider of the card). */
function bakeMount(key: string, spec: MountSpec, tiles: number, teamTile: number, whiteTile: number): { geometry: THREE.BufferGeometry; bodyCount: number } {
  const hit = baked.get(key);
  if (hit) return hit;
  const parts = partsOf(spec);
  let verts = 0;
  for (const p of parts) verts += p.geo.getAttribute("position").count;
  const position = new Float32Array(verts * 2 * 3);
  const normal = new Float32Array(verts * 2 * 3);
  const uv = new Float32Array(verts * 2 * 2);
  const color = new Float32Array(verts * 2 * 3).fill(1);
  const teamA = new Float32Array(verts * 2);
  const skinIndex = new Uint16Array(verts * 2 * 4);
  const skinWeight = new Float32Array(verts * 2 * 4);
  const outlineNormal = new Float32Array(verts * 2 * 3);
  const index: number[] = [];
  const hull: number[] = [];
  const c = new THREE.Color();
  let at = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo : p.geo;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const team = p.color === "team" ? 1 : p.color === "teamDark" ? 2 : 0;
    if (typeof p.color === "number") extraColor(p.color, c);
    for (let i = 0; i < pos.count; i++) {
      const o = at + i;
      position.set([pos.getX(i), pos.getY(i), pos.getZ(i)], o * 3);
      normal.set([nor.getX(i), nor.getY(i), nor.getZ(i)], o * 3);
      uv.set([((team ? teamTile : whiteTile) + 0.5) / tiles, 0.3], o * 2);
      if (!team) color.set([c.r, c.g, c.b], o * 3);
      teamA[o] = team;
      skinIndex[o * 4] = p.bone;
      skinWeight[o * 4] = 1;
    }
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = at + (idx ? idx.getX(i) : i);
      const b = at + (idx ? idx.getX(i + 1) : i + 1);
      const d = at + (idx ? idx.getX(i + 2) : i + 2);
      index.push(a, b, d);
      hull.push(a + verts, d + verts, b + verts);
    }
    at += pos.count;
    p.geo.dispose();
  }
  // Ground occlusion on the hooves, as on the riders.
  for (let o = 0; o < verts; o++) {
    const k = Math.min(1, Math.max(0, position[o * 3 + 1] / 0.3));
    const ao = 1 - 0.15 * (1 - k);
    for (let j = 0; j < 3; j++) color[o * 3 + j] *= ao;
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.BufferAttribute(position.subarray(0, verts * 3), 3));
  body.setAttribute("normal", new THREE.BufferAttribute(normal.subarray(0, verts * 3), 3));
  const smooth = smoothedNormals(body);
  position.copyWithin(verts * 3, 0, verts * 3);
  normal.copyWithin(verts * 3, 0, verts * 3);
  uv.copyWithin(verts * 2, 0, verts * 2);
  color.copyWithin(verts * 3, 0, verts * 3);
  teamA.copyWithin(verts, 0, verts);
  skinIndex.copyWithin(verts * 4, 0, verts * 4);
  skinWeight.copyWithin(verts * 4, 0, verts * 4);
  outlineNormal.set(smooth, verts * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("teamCode", new THREE.BufferAttribute(teamA, 1));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(outlineNormal, 3));
  geometry.setIndex([...index, ...hull]);
  geometry.userData.shared = true;
  registerInkGeometry(geometry, index.length);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.6);
  const out = { geometry, bodyCount: index.length };
  baked.set(key, out);
  return out;
}

export interface Mount {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  kind: MountKind;
  /** Gallop phase (radians). */
  phase: number;
}

/**
 * A mount for one rider, sharing the rider's material. `key` caches the
 * geometry (card + edition); `tiles`, `teamTile`, `whiteTile` describe the
 * rider's atlas.
 */
export function makeMount(key: string, spec: MountSpec, material: THREE.Material, tiles: number, teamTile: number, whiteTile: number): Mount {
  const { geometry } = bakeMount(key, spec, tiles, teamTile, whiteTile);
  const group = new THREE.Group();
  group.name = "mount";
  const body = new THREE.Bone();
  body.name = "mountBody";
  const head = new THREE.Bone();
  head.name = "mountHead";
  head.position.set(...HEAD_AT[spec.kind]);
  body.add(head);
  const legs = LEG_AT[spec.kind].map(([x, y, z], i) => {
    const b = new THREE.Bone();
    b.name = `mountLeg${i}`;
    b.position.set(x, y, z);
    body.add(b);
    return b;
  });
  group.add(body);
  group.updateMatrixWorld(true);
  const bones = [body, head, ...legs];
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "mountBody";
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  group.add(mesh);
  return { group, mesh, bones, skeleton, kind: spec.kind, phase: 0 };
}

/** Stride length (world units) of one gallop cycle, per kind. */
const STRIDE: Record<MountKind, number> = { horse: 2.9, hog: 1.7, camel: 3.1 };

/** Gallop (legs in pairs, body bob, head nod) at the ground speed, or stand and breathe. */
export function animateMount(m: Mount, moving: boolean, speed: number, dt: number, time: number): void {
  if (moving) m.phase += (dt * speed * Math.PI * 2) / STRIDE[m.kind];
  const amp = moving ? (m.kind === "hog" ? 0.75 : 0.6) : 0;
  const [body, head, ...legs] = m.bones;
  const s = Math.sin(m.phase);
  legs[0].rotation.x = s * amp;
  legs[3].rotation.x = s * amp;
  legs[1].rotation.x = -s * amp;
  legs[2].rotation.x = -s * amp;
  body.position.y = moving ? Math.abs(Math.cos(m.phase)) * 0.07 : Math.sin(time * 2) * 0.012;
  body.rotation.x = moving ? Math.sin(m.phase * 2) * 0.04 : 0;
  head.rotation.x = moving ? Math.sin(m.phase * 2 + 0.6) * 0.1 : Math.sin(time * 1.3) * 0.03;
}
