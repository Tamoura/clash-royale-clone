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

describe("Battle3D.reset after shatter deaths", () => {
  it("leaves no meshes behind and frees every shattered piece", async () => {
    const { Battle3D } = await import("./scene3d");
    const { beginDeath, updateTroopDeath } = await import("./scene/views/animate");
    const { buildTroop } = await import("./characters3d");
    const { bakeRig } = await import("./rigBake");
    const { ARABIC } = await import("./theme");
    const { HitStopController } = await import("./hitstop");
    const { ShakeController } = await import("./shake");
    type View = import("./scene/common").EntityView;

    // A Battle3D without a GPU: only the fields reset() and the death
    // animation touch (the constructor needs WebGL, which node lacks).
    const scene = new THREE.Scene();
    const fx = { emit: () => {}, decal: () => {}, update: () => {}, reset: () => {} };
    const b = Object.assign(Object.create(Battle3D.prototype), {
      scene,
      fx,
      views: new Map(),
      effects: [],
      dying: [],
      ghost: null,
      rubble: [],
      projViews: new Map(),
      hitStop: new HitStopController(),
      shakeCtl: new ShakeController(),
      sparks: { particles: [] },
      sparkMesh: { count: 0 },
      camera: new THREE.OrthographicCamera(),
      syncState: { time: 3 },
    }) as InstanceType<typeof Battle3D>;

    const mats = new Set<THREE.Material>();
    const sharedGeos = new Set<THREE.BufferGeometry>();
    for (let i = 0; i < 6; i++) {
      const rig = buildTroop("skeletons");
      // Units are baked in the game: their merged geometry is shared by every
      // skeleton and must survive any one of them being disposed.
      bakeRig(rig, `skeletons:player:${ARABIC ? "arabic" : "normal"}:default`);
      const root = new THREE.Group();
      root.add(rig.group);
      const hpGroup = new THREE.Group();
      root.add(hpGroup);
      root.position.set(i - 3, 0, 2);
      scene.add(root);
      rig.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !m.userData.shared) mats.add(m);
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g?.userData.shared) sharedGeos.add(g);
      });
      const view = {
        root,
        rig,
        hpGroup,
        hpFill: new THREE.Mesh(),
        flashMats: [],
        lastHp: 0,
        flashT: 0,
        spawnT: 1,
        isTroop: true,
        // A faceless skeleton (the classic edition's): it shatters.
        anim: { cardId: "skeletons", face: null, recoilX: 1, recoilZ: 0, recoilAt: 3, blink: { seed: i } },
      } as unknown as View;
      beginDeath(b, view);
    }
    expect(b.dying.every((d) => d.anim?.motion === "shatter")).toBe(true);
    expect(b.dying.reduce((n, d) => n + (d.anim?.parts?.length ?? 0), 0)).toBeGreaterThan(20);
    // A baked body breaks into its node meshes: 4 to 8 chunks, not 40 bones.
    for (const d of b.dying) {
      expect(d.anim!.parts!.length).toBeGreaterThanOrEqual(4);
      expect(d.anim!.parts!.length).toBeLessThanOrEqual(8);
    }
    // Mid-flight: pieces are scattered but still under their unit's root.
    for (const d of b.dying) updateTroopDeath(d, 0.3, 0.05);
    for (const d of b.dying) {
      for (const p of d.anim!.parts!) expect(p.obj.parent).toBe(d.view.root);
    }
    const spies = [...mats].map((m) => vi.spyOn(m, "dispose"));
    const geoSpies = [...sharedGeos].map((g) => vi.spyOn(g, "dispose"));

    b.reset();

    expect(b.dying.length).toBe(0);
    let meshes = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(0);
    for (const s of spies) expect(s).toHaveBeenCalled();
    // No leaked or double-freed shared geometry: the baked meshes were
    // reparented onto each unit's root and flew, yet reset() left the shared
    // geometry alone for the next skeleton.
    expect(sharedGeos.size).toBeGreaterThan(0);
    for (const s of geoSpies) expect(s).not.toHaveBeenCalled();
  });
});
