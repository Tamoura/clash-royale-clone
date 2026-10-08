import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  INK,
  OUTLINE_MIN_RADIUS,
  ensureOutlineNormals,
  installInk,
  outlineHull,
  outlineMaterial,
  registerInkGeometry,
  setOutlinesVisible,
  smoothedNormals,
} from "./outlineMaterial";

describe("outline normals", () => {
  it("averages normals over coincident vertices so hard edges extrude together", () => {
    // A box has 24 vertices (three per corner, each with a face normal).
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const smooth = smoothedNormals(geo);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      // Every corner points diagonally out of the box: |x| = |y| = |z|.
      const x = smooth[i * 3], y = smooth[i * 3 + 1], z = smooth[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
      expect(Math.abs(x)).toBeCloseTo(Math.abs(y), 4);
      expect(Math.abs(y)).toBeCloseTo(Math.abs(z), 4);
      // ...and away from the centre, the same way as the vertex itself.
      expect(Math.sign(x)).toBe(Math.sign(pos.getX(i)));
    }
  });

  it("is added once and reused", () => {
    const geo = new THREE.SphereGeometry(0.5, 8, 6);
    ensureOutlineNormals(geo);
    const attr = geo.getAttribute("outlineNormal");
    expect(attr.count).toBe(geo.getAttribute("position").count);
    ensureOutlineNormals(geo);
    expect(geo.getAttribute("outlineNormal")).toBe(attr);
  });
});

describe("outline material", () => {
  it("is one back-face shader shared by every hull", () => {
    const a = outlineHull(new THREE.BoxGeometry(1, 1, 1));
    const b = outlineHull(new THREE.SphereGeometry(1, 6, 4));
    expect(a.material).toBe(b.material);
    expect(a.name).toBe("outline");
    const mat = outlineMaterial();
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.vertexShader).toContain("outlineNormal");
    expect(mat.vertexShader).toContain("uOutlinePx * 2.0 / uViewport");
  });

  it("switches off with the quality ladder", () => {
    setOutlinesVisible(false);
    expect(outlineMaterial().visible).toBe(false);
    expect(INK.uInkOn.value).toBe(0);
    setOutlinesVisible(true);
    expect(outlineMaterial().visible).toBe(true);
    expect(INK.uInkOn.value).toBe(1);
  });

  it("skips only the tiniest parts", () => {
    expect(OUTLINE_MIN_RADIUS).toBeLessThan(0.14); // the old hull's cut-off
    expect(OUTLINE_MIN_RADIUS).toBeGreaterThan(0);
  });

  it("installs the ink extrusion into a lit shader", () => {
    const shader = {
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader: "#include <common>",
      uniforms: {} as Record<string, { value: unknown }>,
    };
    installInk(shader);
    expect(shader.vertexShader).toContain("attribute vec3 outlineNormal");
    expect(shader.vertexShader).toContain("gl_Position.xy +=");
    expect(shader.fragmentShader).toContain("uInkColor");
    expect(shader.uniforms.uInkPx).toBe(INK.uInkPx); // shared by reference
  });
});

describe("ink draw range", () => {
  it("stops at the body when outlines are off and disposes cleanly", () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    registerInkGeometry(g, 12);
    expect(g.drawRange.count).toBe(Infinity);
    setOutlinesVisible(false);
    expect(g.drawRange.count).toBe(12);
    setOutlinesVisible(true);
    expect(g.drawRange.count).toBe(Infinity);
    g.dispose();
    setOutlinesVisible(false);
    expect(g.drawRange.count).toBe(Infinity);
    setOutlinesVisible(true);
  });
});
