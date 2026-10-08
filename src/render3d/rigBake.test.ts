import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { CardId } from "../game/cards";
import { archetypeFor, setRigArchetype } from "./anim/archetypes";
import { faceOf, poseFace } from "./anim/face";
import { animateTroop, bakedToon, buildTroop, type TroopRig } from "./characters3d";
import { bakeCacheSize, bakeRig, clearBakeCache, countMeshes, MESH_BUDGET } from "./rigBake";
import { collectFlashMats } from "./scene/views/troops";
import { disposeDeep } from "./scene/common";
import { ARABIC } from "./theme";
import { TEAM, applyTeam, isTeamPart } from "./teamColors";

const edition = ARABIC ? "arabic" : "normal";
const keyOf = (id: string, side = "player", palette = "default"): string => `${id}:${side}:${edition}:${palette}`;

function baked(id: CardId, side: "player" | "enemy" = "player"): TroopRig {
  const rig = buildTroop(id, side);
  bakeRig(rig, keyOf(id, side));
  return rig;
}

/** Every visible vertex of the rig in world space (outline hulls and ink excluded). */
function worldPoints(rig: TroopRig): THREE.Vector3[] {
  rig.group.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  rig.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === "outline" || !mesh.visible) return;
    const pos = mesh.geometry.getAttribute("position");
    // Baked bodies carry hull vertices (non-zero outlineNormal); skip those.
    const ink = (mesh.material as THREE.Material).userData.baked ? mesh.geometry.getAttribute("outlineNormal") : null;
    for (let i = 0; i < pos.count; i++) {
      if (ink && ink.getX(i) ** 2 + ink.getY(i) ** 2 + ink.getZ(i) ** 2 > 0.25) continue; // ink vertex
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

/** Largest distance from any point of `a` to its nearest point in `b` (grid lookup). */
function maxNearest(a: THREE.Vector3[], b: THREE.Vector3[]): number {
  const cell = 0.05;
  const grid = new Map<string, THREE.Vector3[]>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (const v of b) {
    const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell));
    const list = grid.get(k);
    if (list) list.push(v);
    else grid.set(k, [v]);
  }
  let worst = 0;
  for (const v of a) {
    const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
    let best = Infinity;
    for (let r = 1; r <= 8 && best > r * cell; r++) {
      for (let x = cx - r; x <= cx + r; x++) {
        for (let y = cy - r; y <= cy + r; y++) {
          for (let z = cz - r; z <= cz + r; z++) {
            for (const w of grid.get(key(x, y, z)) ?? []) best = Math.min(best, w.distanceTo(v));
          }
        }
      }
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

describe("bakeRig", () => {
  beforeEach(() => clearBakeCache());

  it("folds a Knight's 100-odd meshes into one body mesh per animated node", () => {
    const rig = buildTroop("knight", "player");
    const before = countMeshes(rig.group, false);
    const withHulls = countMeshes(rig.group);
    const stats = bakeRig(rig, keyOf("knight"));
    expect(before).toBeGreaterThan(40);
    expect(withHulls).toBeGreaterThan(80); // every part also had an ink hull
    expect(stats.baked).toBe(true);
    expect(stats.parts).toBeLessThanOrEqual(MESH_BUDGET);
    // The ink rides inside each body mesh: no separate hull meshes remain.
    let hulls = 0;
    rig.group.traverse((o) => {
      if (o.name === "outline") hulls++;
    });
    expect(hulls).toBe(0);
    expect(rig.group.userData.baked).toBe(true);
    // Baking twice is a no-op.
    expect(bakeRig(rig, keyOf("knight")).parts).toBe(stats.parts);
  });

  it("body meshes carry vertex colours and their ink triangles", () => {
    const rig = baked("knight");
    let bodies = 0;
    rig.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === "team" || mesh.name === "eye") return;
      const geo = mesh.geometry;
      const ink = geo.getAttribute("outlineNormal");
      if (!ink) return;
      bodies++;
      expect(geo.getAttribute("color")).toBeDefined();
      let hull = 0;
      for (let i = 0; i < ink.count; i++) if (ink.getX(i) ** 2 + ink.getY(i) ** 2 + ink.getZ(i) ** 2 > 0.25) hull++;
      expect(hull).toBeGreaterThan(0);
      expect(hull).toBeLessThan(ink.count);
    });
    expect(bodies).toBeGreaterThanOrEqual(4);
  });

  it("team meshes stay separate, named 'team', and still recolour per side and palette", () => {
    const rig = baked("knight", "player");
    const teams: THREE.Mesh[] = [];
    rig.group.traverse((o) => {
      if (isTeamPart(o)) teams.push(o as THREE.Mesh);
    });
    expect(teams.length).toBeGreaterThanOrEqual(2);
    for (const palette of ["default", "cb"] as const) {
      for (const side of ["player", "enemy"] as const) {
        applyTeam(rig.group, side, palette);
        for (const t of teams) {
          const mat = t.material as THREE.MeshToonMaterial;
          const dark = new THREE.Color(TEAM[palette][side].dark).getHex();
          const main = new THREE.Color(TEAM[palette][side].main).getHex();
          const kind = t.userData.team as string;
          expect(["main", "dark", "both"]).toContain(kind);
          // A merged mesh paints its main shade on the material and its dark
          // parts from teamDark; a single-shade mesh only needs the one.
          expect(mat.color.getHex()).toBe(kind === "dark" ? dark : main);
          expect((mat.userData.teamDark as THREE.Color).getHex()).toBe(dark);
        }
      }
    }
  });

  it("flash and rage glow the per-unit clone, never the shared template or another unit", () => {
    const a = baked("knight");
    const b = baked("knight");
    const flashA = collectFlashMats(a.group);
    const flashB = collectFlashMats(b.group);
    expect(flashA.length).toBeLessThanOrEqual(4);
    expect(flashA.length).toBeGreaterThan(0);
    for (const f of flashA) f.mat.emissive.setRGB(1, 1, 1);
    for (const f of flashB) expect(f.mat.emissive.getHex()).toBe(0);
    expect(bakedToon().emissive.getHex()).toBe(0);
    // The clones are distinct materials; the template is not among them.
    expect(flashA.some((f) => flashB.some((g) => g.mat === f.mat))).toBe(false);
    expect(flashA.some((f) => f.mat === bakedToon())).toBe(false);
  });

  it("the face is still found by name and still animates", () => {
    const rig = baked("knight");
    const face = faceOf(rig.group);
    expect(face).not.toBeNull();
    expect(face!.eyes.length).toBeGreaterThanOrEqual(1);
    expect(face!.brows.length).toBe(2);
    expect(face!.mouths.length).toBe(1);
    poseFace(face!, { blink: true, squint: 0, anger: 0, ko: false });
    const shut = face!.eyes[0].scale.y;
    poseFace(face!, { blink: false, squint: 0, anger: 0, ko: false });
    expect(face!.eyes[0].scale.y).toBeGreaterThan(shut);
    // A knockout draws one X over each of the two eyes.
    poseFace(face!, { blink: false, squint: 0, anger: 0, ko: true });
    expect(face!.xEyes!.length).toBe(2);
    expect(face!.xEyes!.every((x) => x.visible)).toBe(true);
  });

  it("two bakes of one key share their geometry by reference", () => {
    const a = baked("musketeer");
    const b = baked("musketeer");
    const geos = (rig: TroopRig): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = [];
      rig.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.name !== "brow" && m.name !== "mouth") out.push(m.geometry);
      });
      return out;
    };
    const ga = geos(a);
    const gb = geos(b);
    expect(ga.length).toBe(gb.length);
    ga.forEach((g, i) => expect(g).toBe(gb[i]));
    expect(ga.some((g) => g.userData.shared === true)).toBe(true);
    const n = bakeCacheSize();
    baked("musketeer", "enemy"); // the other side reuses them too
    expect(bakeCacheSize()).toBe(n);
  });

  it("disposing a baked unit frees its own material and spares the shared geometry", () => {
    const rig = baked("knight");
    const shared = new Set<THREE.BufferGeometry>();
    const own = new Set<THREE.Material>();
    rig.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.geometry.userData.shared) shared.add(m.geometry);
      const mat = m.material as THREE.Material;
      if (!mat.userData.shared) own.add(mat);
    });
    const geoSpies = [...shared].map((g) => vi.spyOn(g, "dispose"));
    const matSpies = [...own].map((m) => vi.spyOn(m, "dispose"));
    disposeDeep(rig.group);
    expect(shared.size).toBeGreaterThan(0);
    for (const s of geoSpies) expect(s).not.toHaveBeenCalled();
    for (const s of matSpies) expect(s).toHaveBeenCalled();
  });

  it("looks the same as the hand-built rig in every pose (nothing animated got baked into a static mesh)", () => {
    const poses = [
      { moving: false, swing: 0, time: 0.9, phase: 0.1 },
      { moving: true, swing: 0, time: 1.3, phase: 0.4, stride: 1.1 },
      { moving: true, swing: 0, time: 2.1, phase: 0.4, stride: 2.9 },
      { moving: false, swing: -0.5, time: 3.3, phase: 0.1 },
      { moving: false, swing: 0.9, time: 4.7, phase: 0.1 },
    ];
    // Cards whose nodes all stay (a bake that folds a tail or an ear for the
    // budget is checked separately below).
    for (const id of ["knight", "musketeer", "witch", "baby-dragon", "skeleton-army", "valkyrie", "wizard"] as CardId[]) {
      const raw = buildTroop(id, "player");
      const rig = baked(id);
      const arch = archetypeFor(id, { arabic: ARABIC });
      setRigArchetype(raw, arch);
      setRigArchetype(rig, arch);
      for (const pose of poses) {
        animateTroop(raw, pose);
        animateTroop(rig, pose);
        const a = worldPoints(rig);
        const b = worldPoints(raw);
        expect(maxNearest(a, b), `${id} baked -> raw`).toBeLessThan(0.01);
        expect(maxNearest(b, a), `${id} raw -> baked`).toBeLessThan(0.01);
      }
    }
  });

  it("folds only quiet nodes when it must: any drift stays under half a unit", () => {
    const pose = { moving: true, swing: 0, time: 2.1, phase: 0.4, stride: 2.9 };
    for (const id of ["giant", "hog-rider", "ice-wizard", "prince", "pekka"] as CardId[]) {
      const raw = buildTroop(id, "player");
      const rig = baked(id);
      const arch = archetypeFor(id, { arabic: ARABIC });
      setRigArchetype(raw, arch);
      setRigArchetype(rig, arch);
      animateTroop(raw, pose);
      animateTroop(rig, pose);
      expect(maxNearest(worldPoints(rig), worldPoints(raw)), id).toBeLessThan(0.5);
    }
  });

  it("leaves the Studio champion's geometry out of the shared cache", () => {
    const n = bakeCacheSize();
    const rig = buildTroop("champion", "player");
    bakeRig(rig, keyOf("champion"));
    expect(bakeCacheSize()).toBe(n);
  });

  it("does not disturb the scale a view sets after baking", () => {
    const rig = buildTroop("knight", "player");
    bakeRig(rig, keyOf("knight"));
    rig.group.scale.setScalar(1.25);
    animateTroop(rig, { moving: false, swing: 0, time: 0.5, phase: 0 });
    expect(rig.group.scale.x).toBeCloseTo(1.25, 1);
  });
});
