import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { batchStatic } from "./staticBatch";

const meshCount = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

const worldBox = (root: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(root);

describe("static batching", () => {
  it("merges identical-looking props into one mesh and keeps their placement", () => {
    const root = new THREE.Group();
    const mat = () => new THREE.MeshToonMaterial({ color: 0x884422 });
    for (let i = 0; i < 10; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), mat());
      post.position.set(i * 2, 0.5, 0);
      post.castShadow = true;
      root.add(post);
    }
    const before = worldBox(root);
    expect(batchStatic(root, () => false)).toBe(9);
    expect(meshCount(root)).toBe(1);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
    expect((root.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).castShadow).toBe(true);
  });

  it("keeps different looks and shadow flags apart", () => {
    const root = new THREE.Group();
    const add = (color: number, cast: boolean) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshToonMaterial({ color }));
      m.castShadow = cast;
      root.add(m);
    };
    add(0xff0000, true);
    add(0xff0000, true);
    add(0x00ff00, true);
    add(0x00ff00, true);
    add(0xff0000, false);
    batchStatic(root, () => false);
    expect(meshCount(root)).toBe(3); // red casters, green casters, lone red non-caster
  });

  it("leaves skipped subtrees alone and batches batchRoot groups on their own", () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const animated = new THREE.Group();
    animated.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    const toggled = new THREE.Group();
    toggled.userData.batchRoot = true;
    toggled.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    root.add(animated, toggled, new THREE.Mesh(new THREE.BoxGeometry(), mat));
    batchStatic(root, (o) => o === animated);
    expect(meshCount(animated)).toBe(2); // untouched
    expect(meshCount(toggled)).toBe(1); // merged, but still inside its own group
    expect(toggled.parent).toBe(root);
  });

  it("keeps mirrored parts facing outward (winding fixed)", () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    b.scale.x = -1;
    b.position.x = 3;
    root.add(a, b);
    batchStatic(root, () => false);
    const merged = root.children[0] as THREE.Mesh;
    const pos = merged.geometry.getAttribute("position");
    // Every triangle's face normal still points +z, like the unmirrored plane.
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < pos.count; t += 3) {
      v.forEach((p, k) => p.fromBufferAttribute(pos, t + k));
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      expect(n.z).toBeGreaterThan(0);
    }
  });
});
