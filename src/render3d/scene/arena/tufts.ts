/**
 * Instanced grass tufts on the grassy floors (art bible section 3: the top
 * three quality levels). One draw: a few hundred little fans of blades,
 * seeded, kept off the lanes, aprons, banks and kerb, tinted a shade either
 * side of the turf so they read as texture, never as clutter.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../../game/arena";
import type { ArenaLook } from "../../arenaLooks";
import { toon } from "../../characters3d";
import { GRASSY, floorRecipe, hashString, openTurf, parseColor } from "./groundPaint";

/** Tufts per look (fewer on the moss and violet floors). */
export const TUFT_COUNT = 360;

/** A fan of five blades (thin triangles), about 0.22 tall. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.32;
    const h = 0.16 + (i % 2) * 0.07;
    const bx = (i - 2) * 0.03;
    const tx = bx + Math.sin(a) * h;
    const ty = Math.cos(a) * h;
    pos.push(bx - 0.018, 0, 0, bx + 0.018, 0, 0, tx, ty, 0.01 * (i - 2));
    for (let k = 0; k < 3; k++) nor.push(0, 0.6, 0.8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** The look's tufts, or null for floors that grow none. */
export function buildTufts(look: ArenaLook): THREE.InstancedMesh | null {
  const recipe = floorRecipe(look);
  if (look.islamic || !GRASSY.has(recipe)) return null;
  let seed = hashString(`tufts:${look.id}`);
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = recipe === "moss" || recipe === "violet" ? Math.round(TUFT_COUNT * 0.6) : TUFT_COUNT;
  const mat = toon(0xffffff);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, n);
  mesh.name = "tufts";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noBatch = true;
  mesh.userData.dressing = "tufts";
  const A = parseColor(look.floor.a);
  const base = new THREE.Color().setRGB(A[0], A[1], A[2], THREE.SRGBColorSpace);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 10; tries++) {
    const ax = rand() * ARENA_WIDTH;
    const ay = rand() * ARENA_HEIGHT;
    if (!openTurf(ax, ay, 0.35)) continue;
    e.set(0, rand() * Math.PI * 2, 0);
    q.setFromEuler(e);
    p.set(ax - ARENA_WIDTH / 2, 0, ay - ARENA_HEIGHT / 2);
    const k = 0.8 + rand() * 0.6;
    sc.set(k, k * (0.85 + rand() * 0.3), k);
    m.compose(p, q, sc);
    mesh.setMatrixAt(placed, m);
    c.copy(base).multiplyScalar(rand() < 0.5 ? 0.82 : 1.1);
    mesh.setColorAt(placed, c);
    placed++;
  }
  mesh.count = placed;
  mesh.computeBoundingSphere();
  return mesh;
}
