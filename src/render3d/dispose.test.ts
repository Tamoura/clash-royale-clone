import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeDeep } from "./scene3d";

describe("disposeDeep (three-best-practices: memory-dispose)", () => {
  it("disposes private geometry, material, and texture", () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    root.add(new THREE.Mesh(geo, mat));
    const geoSpy = vi.spyOn(geo, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    const texSpy = vi.spyOn(tex, "dispose");
    disposeDeep(root);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    expect(texSpy).toHaveBeenCalled();
  });

  it("spares resources marked shared", () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.userData.shared = true;
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    tex.userData.shared = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sharedMat = new THREE.MeshBasicMaterial();
    sharedMat.userData.shared = true;
    root.add(new THREE.Mesh(geo, mat));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat));
    const geoSpy = vi.spyOn(geo, "dispose");
    const texSpy = vi.spyOn(tex, "dispose");
    const sharedMatSpy = vi.spyOn(sharedMat, "dispose");
    disposeDeep(root);
    expect(geoSpy).not.toHaveBeenCalled();
    expect(texSpy).not.toHaveBeenCalled();
    expect(sharedMatSpy).not.toHaveBeenCalled();
  });

  it("never touches a sprite's globally-shared plane geometry", () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    const geoSpy = vi.spyOn(sprite.geometry, "dispose");
    disposeDeep(sprite);
    expect(geoSpy).not.toHaveBeenCalled();
  });
});
