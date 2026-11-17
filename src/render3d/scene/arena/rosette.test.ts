import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { toon } from "../../characters3d";
import { LOOK } from "../common";
import { EMBLEM_CONTRAST, ROSETTE_FOLD, makeRosetteEmblem, rosetteShapes } from "./build";

/** The crescent this replaced: 97 outline points, one mesh of 95 triangles, 1.55 across its disc. */
const CRESCENT_TRIANGLES = 95;
const CRESCENT_RADIUS = 1.55;

const meshes = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

describe("Golden Age floor emblem: a ten-fold rosette, not a crescent", () => {
  it("is one flat mesh with one material, so it still merges into the static batch", () => {
    const m = meshes(makeRosetteEmblem(8.5));
    expect(m).toHaveLength(1);
    expect(Array.isArray(m[0].material)).toBe(false);
    expect(m[0].receiveShadow).toBe(true);
    expect(m[0].rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(m[0].position.toArray()).toEqual([0, 0.03, 8.5]);
  });

  it("costs no more triangles than the crescent did, at the same size", () => {
    const geo = meshes(makeRosetteEmblem(0))[0].geometry;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    expect(tris).toBeLessThanOrEqual(CRESCENT_TRIANGLES);
    geo.computeBoundingSphere();
    expect(geo.boundingSphere!.radius).toBeCloseTo(CRESCENT_RADIUS, 2);
  });

  it("keeps the inlay colour: the floor plaster a quarter of the way to the look's emblem gold", () => {
    const want = new THREE.Color(LOOK.islamic?.plaster ?? "#efe7cf").lerp(new THREE.Color(LOOK.islamic?.emblem ?? 0xe8b948), EMBLEM_CONTRAST);
    const mat = meshes(makeRosetteEmblem(0))[0].material as THREE.MeshToonMaterial;
    // The same toon() material the crescent used (it lifts saturation a little).
    expect(mat.color.getHex()).toBe(toon(want.getHex()).color.getHex());
  });

  it("has ten points (never 5, 6, 8 or 9), ten petals and a rim, with plaster at its heart", () => {
    expect(ROSETTE_FOLD).toBe(10);
    const [star, ...rest] = rosetteShapes();
    expect(star.getPoints().length).toBeGreaterThanOrEqual(20);
    expect(star.holes).toHaveLength(1);
    const petals = rest.filter((s) => s.holes.length === 0);
    expect(petals).toHaveLength(10);
    const rims = rest.filter((s) => s.holes.length === 1);
    expect(rims).toHaveLength(1);
    // One star point aims down the board's long axis (at a King), so both
    // players see the same motif.
    const tip = star.getPoints().reduce((a, b) => (b.length() > a.length() ? b : a));
    expect(Math.abs(tip.x)).toBeLessThan(1e-6);
  });
});
