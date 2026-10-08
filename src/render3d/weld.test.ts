import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { weldVertices } from "./weld";

describe("weldVertices", () => {
  it("welds a non-indexed box down to its 24 distinct corners and keeps its shape", () => {
    const box = new THREE.BoxGeometry(1, 2, 3).toNonIndexed();
    expect(box.getAttribute("position").count).toBe(36);
    const welded = weldVertices(box);
    expect(welded.getAttribute("position").count).toBe(24); // 8 corners x 3 face normals
    expect(welded.index!.count).toBe(36);
    // Every original triangle corner is still where it was.
    const p = welded.getAttribute("position");
    const idx = welded.index!;
    const orig = box.getAttribute("position");
    for (let i = 0; i < 36; i++) {
      const j = idx.getX(i);
      expect(p.getX(j)).toBeCloseTo(orig.getX(i), 5);
      expect(p.getY(j)).toBeCloseTo(orig.getY(i), 5);
      expect(p.getZ(j)).toBeCloseTo(orig.getZ(i), 5);
    }
  });

  it("agrees with BufferGeometryUtils.mergeVertices on a rounded sphere with every attribute", () => {
    const sphere = new THREE.SphereGeometry(0.5, 12, 8).toNonIndexed();
    const n = sphere.getAttribute("position").count;
    sphere.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
    const mine = weldVertices(sphere);
    const theirs = mergeVertices(sphere);
    expect(mine.getAttribute("position").count).toBe(theirs.getAttribute("position").count);
    expect(mine.index!.count).toBe(theirs.index!.count);
    expect(Object.keys(mine.attributes).sort()).toEqual(Object.keys(theirs.attributes).sort());
  });

  it("keeps vertices apart when any attribute differs and uses 32-bit indices for big meshes", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 0.5, 0, 0]), 2));
    const w = weldVertices(g);
    expect(w.getAttribute("position").count).toBe(3); // same position, different uv: not welded
    const big = new THREE.PlaneGeometry(1, 1, 300, 300).toNonIndexed();
    const wb = weldVertices(big);
    expect(wb.getAttribute("position").count).toBe(301 * 301);
    expect(wb.index!.array).toBeInstanceOf(Uint32Array);
  });
});
