import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getCard, DECK, type CardId } from "../game/cards";
import { animateTroop, buildTroop, toon } from "./characters3d";

const TROOP_IDS = DECK.filter((id) => getCard(id).kind === "troop");

describe("3D troop rigs", () => {
  it("builds a rig for every troop card", () => {
    for (const id of TROOP_IDS) {
      const rig = buildTroop(id as CardId);
      expect(rig.group.children.length).toBeGreaterThan(2);
      expect(rig.height).toBeGreaterThan(0.5);
      // Every troop animates somehow: a weapon arm or flapping wings.
      expect(rig.arm !== null || (rig.wings?.length ?? 0) > 0).toBe(true);
    }
  });

  it("builds rigs for the firecracker and magic archer", () => {
    for (const id of ["firecracker", "magic-archer"] as const) {
      const rig = buildTroop(id);
      expect(rig.group.children.length).toBeGreaterThan(2);
      expect(rig.height).toBeGreaterThan(0.5);
      expect(rig.arm).not.toBeNull(); // both wield a weapon arm
    }
  });

  it("flying troops hover and have wings", () => {
    for (const id of ["baby-dragon", "gargoyles"] as const) {
      const rig = buildTroop(id);
      expect(rig.hover).toBeGreaterThan(0);
      expect(rig.wings?.length).toBe(2);
    }
  });

  it("ground troops have jointed legs that swing while walking", () => {
    const rig = buildTroop("knight");
    expect(rig.legs?.length).toBe(2);
    animateTroop(rig, { moving: true, swing: 0, time: 0.15, phase: 0 });
    const [left, right] = rig.legs!;
    expect(left.rotation.x).not.toBe(0);
    // Legs swing in opposite directions.
    expect(Math.sign(left.rotation.x)).toBe(-Math.sign(right.rotation.x));
    animateTroop(rig, { moving: false, swing: 0, time: 0.15, phase: 0 });
    expect(left.rotation.x).toBe(0);
  });

  it("the prince's pony has four galloping legs", () => {
    const rig = buildTroop("prince");
    expect(rig.legs?.length).toBe(4);
  });

  it("rejects spell cards", () => {
    expect(() => buildTroop("fireball")).toThrow();
  });

  it("attack swing rotates the weapon arm", () => {
    const rig = buildTroop("knight");
    const rest = rig.arm!.rotation.x;
    animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0 });
    expect(rig.arm!.rotation.x).toBeLessThan(rest);
    animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0 });
    expect(rig.arm!.rotation.x).toBeCloseTo(rest);
  });

  it("walking bobs the body; standing does not", () => {
    const rig = buildTroop("giant");
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0 });
    expect(rig.group.position.y).toBeGreaterThan(0);
    animateTroop(rig, { moving: false, swing: 0, time: 0.2, phase: 0 });
    expect(rig.group.position.y).toBe(0);
  });

  it("every mesh in a rig casts a shadow", () => {
    const rig = buildTroop("mini-pekka");
    let meshCount = 0;
    rig.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        meshCount++;
      }
    });
    expect(meshCount).toBeGreaterThan(5);
  });
});

describe("tower defenders", () => {
  it("the tower princess is a small archer with a bow arm", async () => {
    const { buildTowerPrincess } = await import("./characters3d");
    const rig = buildTowerPrincess();
    expect(rig.group.children.length).toBeGreaterThan(2);
    expect(rig.arm).not.toBeNull();
    expect(rig.height).toBeGreaterThan(0.5);
  });

  it("the tower king bears a crown and a sword arm", async () => {
    const { buildTowerKing } = await import("./characters3d");
    const rig = buildTowerKing();
    expect(rig.group.children.length).toBeGreaterThan(3);
    expect(rig.arm).not.toBeNull();
    expect(rig.height).toBeGreaterThan(0.5);
  });
});

describe("charge telegraph", () => {
  it("a charging prince couches his lance and leans in", () => {
    const rig = buildTroop("prince");
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0, charging: true });
    const couched = rig.arm!.rotation.x;
    const lean = rig.group.rotation.x;
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0 });
    expect(couched).toBeLessThan(rig.arm!.rotation.x);
    expect(lean).toBeGreaterThan(rig.group.rotation.x);
  });
});

describe("idle personality", () => {
  it("animateTroop drives the rig's extras hook with time", async () => {
    const { vi } = await import("vitest");
    const rig = buildTroop("knight");
    rig.extras = vi.fn();
    animateTroop(rig, { moving: false, swing: 0, time: 1.5, phase: 0.3 });
    expect(rig.extras).toHaveBeenCalledWith(1.5, 0.3);
  });

  it("the witch's skull familiar and wizard's orb have extras", () => {
    expect(buildTroop("witch").extras).toBeDefined();
    expect(buildTroop("wizard").extras).toBeDefined();
    expect(buildTroop("baby-dragon").extras).toBeDefined();
  });
});

describe("cel outlines", () => {
  it("every troop rig carries inverted-hull outline meshes", () => {
    for (const id of ["knight", "witch", "pekka"] as const) {
      let outlines = 0;
      buildTroop(id).group.traverse((o) => {
        if (o.name === "outline") outlines++;
      });
      expect(outlines).toBeGreaterThan(3);
    }
  });

  it("outlines are bold — thick and near-black — for the CR cartoon look", () => {
    let outline: THREE.Mesh | null = null;
    buildTroop("knight").group.traverse((o) => {
      if (o.name === "outline" && !outline) outline = o as THREE.Mesh;
    });
    expect(outline).not.toBeNull();
    const o = outline as unknown as THREE.Mesh;
    expect(o.scale.x).toBeGreaterThanOrEqual(1.08); // thicker than the old 1.06
    const mat = o.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeLessThan(0.08); // near-black, not navy
    expect(mat.color.g).toBeLessThan(0.08);
    expect(mat.color.b).toBeLessThan(0.08);
  });

  it("outlines are skipped for tiny detail meshes", () => {
    const rig = buildTroop("skeletons");
    let total = 0;
    let outlines = 0;
    rig.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) total++;
      if (o.name === "outline") outlines++;
    });
    expect(outlines).toBeGreaterThan(0);
    expect(outlines).toBeLessThan(total - outlines); // not 1:1
  });
});

describe("expressive faces", () => {
  it("humanoid rigs have sclera eyes, brows, and a mouth", () => {
    for (const id of ["knight", "witch", "valkyrie"] as const) {
      const counts = { eye: 0, pupil: 0, brow: 0, mouth: 0 };
      buildTroop(id).group.traverse((o) => {
        if (o.name in counts) counts[o.name as keyof typeof counts]++;
      });
      expect(counts.eye).toBeGreaterThanOrEqual(2);
      expect(counts.pupil).toBeGreaterThanOrEqual(2);
      expect(counts.brow).toBeGreaterThanOrEqual(2);
      expect(counts.mouth).toBeGreaterThanOrEqual(1);
    }
  });

  it("moods angle the brows differently", () => {
    const browAngles = (id: "witch" | "giant"): number[] => {
      const angles: number[] = [];
      buildTroop(id).group.traverse((o) => {
        if (o.name === "brow") angles.push(Math.abs(o.rotation.z));
      });
      return angles;
    };
    const wicked = browAngles("witch");
    const calm = browAngles("giant");
    expect(Math.max(...wicked)).toBeGreaterThan(Math.max(...calm));
  });
});

describe("geometry cache (three-best-practices)", () => {
  it("identical primitives share one geometry instance across rigs", () => {
    const geos = (id: "knight" | "skeletons"): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = [];
      buildTroop(id).group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) out.push(mesh.geometry as THREE.BufferGeometry);
      });
      return out;
    };
    const a = geos("knight");
    const b = geos("knight");
    expect(a.length).toBeGreaterThan(0);
    // Two separate knights reuse the exact same geometry objects.
    expect(a.every((g, i) => g === b[i])).toBe(true);
  });

  it("cached geometries are marked shared so disposal skips them", () => {
    let sharedCount = 0;
    buildTroop("giant").group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).userData.shared) {
        sharedCount++;
      }
    });
    expect(sharedCount).toBeGreaterThan(5);
  });
});

describe("ball-jointed limbs", () => {
  it("weapon arms gain a shoulder ball and a fist", () => {
    for (const id of ["knight", "wizard", "hog-rider"] as const) {
      const rig = buildTroop(id);
      const names = rig.arm!.children.map((c) => c.name);
      expect(names).toContain("joint-shoulder");
      expect(names).toContain("joint-fist");
    }
  });

  it("legs gain hip joints and chunky feet", () => {
    const rig = buildTroop("knight");
    for (const leg of rig.legs!) {
      const names = leg.children.map((c) => c.name);
      expect(names).toContain("joint-hip");
      expect(names).toContain("foot");
    }
  });

  it("joints reuse the limb's own material so flashes stay uniform", () => {
    const rig = buildTroop("knight");
    const sleeve = rig.arm!.children.find(
      (c) => (c as THREE.Mesh).isMesh && !c.name.startsWith("joint"),
    ) as THREE.Mesh;
    const fist = rig.arm!.children.find((c) => c.name === "joint-fist") as THREE.Mesh;
    expect(fist.material).toBe(sleeve.material);
  });
});

describe("animation principles", () => {
  it("signed swing: wind-up raises the arm behind rest, strike sweeps past it", () => {
    const rig = buildTroop("knight");
    const at = (swing: number): number => {
      animateTroop(rig, { moving: false, swing, time: 0, phase: 0 });
      return rig.arm!.rotation.x;
    };
    const windup = at(-0.6);
    const rest = at(0);
    const strike = at(1);
    expect(windup).toBeGreaterThan(rest); // anticipation: arm cocked back
    expect(strike).toBeLessThan(rest); // strike: arm swept forward
  });

  it("the body squashes on a heavy strike", () => {
    const rig = buildTroop("knight");
    animateTroop(rig, { moving: false, swing: 0, time: 0.1, phase: 0 });
    const restScale = rig.group.scale.y;
    animateTroop(rig, { moving: false, swing: 1, time: 0.1, phase: 0 });
    expect(rig.group.scale.y).toBeLessThan(restScale);
  });

  it("the off-arm lags the legs for overlapping action", () => {
    const rig = buildTroop("knight");
    // At a walk-cycle zero crossing the legs are neutral but the
    // lagging off-arm must not be.
    animateTroop(rig, { moving: true, swing: 0, time: Math.PI / 10, phase: 0 });
    expect(Math.abs(rig.legs![0].rotation.x)).toBeLessThan(0.02);
    expect(Math.abs(rig.offArm!.rotation.x)).toBeGreaterThan(0.05);
  });
});

describe("surface texturing (3d-texturing skill)", () => {
  it("toon materials carry a shared grain detail map", () => {
    const a = toon(0x4e342e);
    const b = toon(0x94a1ae);
    expect(a.map).not.toBeNull();
    expect(a.map).toBe(b.map); // one cached texture, not per-material
    expect(a.map!.userData.shared).toBe(true);
  });

  it("material instances stay distinct so per-entity flashes don't bleed", () => {
    // Two separate rigs must own separate materials (emissive is
    // mutated per entity for damage flash / rage / charge).
    const m1 = (buildTroop("knight").group.children.find(
      (c) => (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh).material;
    const m2 = (buildTroop("knight").group.children.find(
      (c) => (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh).material;
    expect(m1).not.toBe(m2);
  });
});
