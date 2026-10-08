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

  it("skips noBatch subtrees", () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    const flag = new THREE.Group();
    flag.userData.noBatch = true;
    flag.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    root.add(flag, new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    batchStatic(root, () => false);
    expect(meshCount(flag)).toBe(2);
    expect(meshCount(root)).toBe(3);
  });
});

describe("tinted batching", () => {
  it("merges parts that differ only in colour and keeps each colour per vertex", () => {
    const root = new THREE.Group();
    const colors = [0xff0000, 0x00ff00, 0x0000ff];
    colors.forEach((c, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshToonMaterial({ color: c }));
      m.position.x = i * 3;
      root.add(m);
    });
    expect(batchStatic(root, () => false, { tint: true })).toBe(2);
    const merged = root.children[0] as THREE.Mesh;
    const mat = merged.material as THREE.MeshToonMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.color.getHex()).toBe(0xffffff);
    const pos = merged.geometry.getAttribute("position");
    const col = merged.geometry.getAttribute("color");
    expect(col.count).toBe(pos.count);
    // Every vertex keeps the colour of the box it came from.
    for (let i = 0; i < pos.count; i++) {
      const box = Math.round(pos.getX(i) / 3);
      const want = new THREE.Color(colors[box]);
      expect(col.getX(i)).toBeCloseTo(want.r);
      expect(col.getY(i)).toBeCloseTo(want.g);
      expect(col.getZ(i)).toBeCloseTo(want.b);
    }
  });

  it("carries shader hooks over to the merged material and leaves the originals alone", () => {
    const root = new THREE.Group();
    const shared = new THREE.MeshToonMaterial({ color: 0x884422 });
    const hook = (): void => undefined;
    shared.onBeforeCompile = hook;
    shared.customProgramCacheKey = () => "rim";
    const other = new THREE.MeshToonMaterial({ color: 0x224488 });
    other.onBeforeCompile = hook;
    other.customProgramCacheKey = () => "rim";
    const keep = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    keep.userData.noBatch = true;
    root.add(keep, new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), other));
    batchStatic(root, () => false, { tint: true });
    const merged = root.children.find((c) => c.name === "batched") as THREE.Mesh;
    const mat = merged.material as THREE.MeshToonMaterial;
    expect(mat).not.toBe(shared);
    expect(mat.onBeforeCompile).toBe(hook);
    expect(mat.customProgramCacheKey()).toBe("rim");
    expect(shared.color.getHex()).toBe(0x884422); // the unbatched part still uses it
    expect(shared.vertexColors).toBe(false);
  });

  it("still keeps different textures apart", () => {
    const root = new THREE.Group();
    const tex = new THREE.Texture();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial({ color: 0xff0000, map: tex })),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial({ color: 0x00ff00, map: tex })),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial({ color: 0x0000ff })),
    );
    batchStatic(root, () => false, { tint: true });
    expect(meshCount(root)).toBe(2);
  });
});

describe("root-local batching (rigs)", () => {
  /** A tiny rig: torso parts on the body, an arm group with two parts, a head with an eye. */
  function rig(): { body: THREE.Group; arm: THREE.Group; head: THREE.Mesh; eye: THREE.Mesh; outline: THREE.Material } {
    const body = new THREE.Group();
    const outline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    const part = (color: number, x: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshToonMaterial({ color }));
      m.position.set(x, y, 0);
      const hull = new THREE.Mesh(m.geometry, outline);
      hull.name = "outline";
      hull.scale.setScalar(1.075);
      m.add(hull);
      return m;
    };
    body.add(part(0xff0000, 0, 0.3), part(0x00ff00, 0, 0.7));
    const head = part(0xffcc99, 0, 1.2);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial());
    eye.name = "eye";
    head.add(eye);
    body.add(head);
    const team = part(0x3b82f6, 0.3, 0.5);
    team.name = "team";
    body.add(team);
    const arm = new THREE.Group();
    arm.position.set(0.4, 0.8, 0);
    const shoulder = part(0xffcc99, 0, 0);
    shoulder.name = "joint-shoulder"; // articulate()'s balls move with their limb
    arm.add(part(0xffcc99, 0, -0.1), part(0x888888, 0, -0.4), shoulder);
    body.add(arm);
    return { body, arm, head, eye, outline };
  }

  it("merges each node's own parts and outline hulls, never across groups", () => {
    const { body, arm, head, eye } = rig();
    const before = worldBox(body);
    batchStatic(body, () => false, { tint: true, local: true });
    const direct = (g: THREE.Object3D, name: string) => g.children.filter((c) => c.name === name).length;
    // body: one merged torso + one merged hull; the head (has an eye) and the team part stay.
    expect(direct(body, "batched")).toBe(1);
    expect(direct(body, "outline")).toBe(1);
    expect(head.parent).toBe(body);
    expect(eye.parent).toBe(head);
    expect(body.getObjectByName("team")).toBeDefined();
    // The arm is still its own group, with its two parts merged inside it.
    expect(arm.parent).toBe(body);
    expect(direct(arm, "batched")).toBe(1);
    expect(direct(arm, "outline")).toBe(1);
    expect(meshCount(arm)).toBe(2);
    const after = worldBox(body);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
  });

  it("keeps the arm's parts moving with the arm", () => {
    const { body, arm } = rig();
    batchStatic(body, () => false, { tint: true, local: true });
    const merged = arm.children.find((c) => c.name === "batched")!;
    const a = worldBox(merged);
    arm.rotation.x = Math.PI / 2;
    body.updateMatrixWorld(true);
    const b = worldBox(merged);
    expect(b.max.z - b.min.z).toBeGreaterThan(a.max.z - a.min.z + 0.2);
  });
});
