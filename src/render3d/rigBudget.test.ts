import { afterEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";

/**
 * The mesh budget every baked troop must meet, in both editions: at most 14
 * meshes (outline ink rides inside the body meshes) and 5 distinct materials
 * (the shared outline material aside). The edition is fixed when the theme
 * module loads, so each edition gets a fresh module graph.
 */
function storage(edition: string): Storage {
  const data = new Map<string, string>([["cr-clone-arena-theme", edition]]);
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

for (const edition of ["normal", "arabic"] as const) {
  describe(`rig budget (${edition} edition)`, () => {
    it("every troop bakes to 14 meshes or fewer and 5 materials or fewer", async () => {
      vi.resetModules();
      vi.stubGlobal("localStorage", storage(edition));
      const { CARDS } = await import("../game/cards");
      const { buildTroop } = await import("./characters3d");
      const { bakeRig, countMeshes, MESH_BUDGET } = await import("./rigBake");
      const { ARABIC } = await import("./theme");
      expect(ARABIC).toBe(edition === "arabic");

      const troops = Object.values(CARDS).filter((c) => c.kind === "troop");
      expect(troops.length).toBeGreaterThan(20);
      const report: string[] = [];
      for (const card of troops) {
        const rig = buildTroop(card.id, "player");
        const before = countMeshes(rig.group, false);
        const stats = bakeRig(rig, `${card.id}:player:${edition}:default`);
        const materials = new Set<THREE.Material>();
        let hulls = 0;
        rig.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          if (m.name === "outline") hulls++;
          else materials.add(m.material as THREE.Material);
        });
        expect(stats.baked, `${card.id} baked`).toBe(true);
        // Ink rides inside the body or team meshes; only a node with neither
        // (glow parts alone) gets a hull mesh of its own.
        expect(hulls, `${card.id} separate hulls`).toBeLessThanOrEqual(2);
        if (stats.parts > MESH_BUDGET || materials.size > 5) {
          report.push(`${card.id}: ${stats.parts} meshes (was ${before}), ${materials.size} materials`);
        }
      }
      expect(report, report.join("; ")).toEqual([]);
    });

    it("the Knight drops from its hand-built mesh count to the budget", async () => {
      vi.resetModules();
      vi.stubGlobal("localStorage", storage(edition));
      const { buildTroop } = await import("./characters3d");
      const { bakeRig, countMeshes, MESH_BUDGET } = await import("./rigBake");
      const rig = buildTroop("knight", "player");
      const before = countMeshes(rig.group);
      bakeRig(rig, `knight:player:${edition}:default`);
      expect(before).toBeGreaterThan(80);
      expect(countMeshes(rig.group, false)).toBeLessThanOrEqual(MESH_BUDGET);
    });
  });
}
