import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CROWN_HALF_W, FAR_EDGE, FAR_KING_TOP, KING_PLATE_H, NEAR_KING_FOOT, PLATE_GAP_PX } from "../fit";

/**
 * fit.ts frames the board around the kings' real extents. This builds the
 * towers as the battle does, in both editions, at every flair tier, with the
 * hand-built crews and with crews as tall as the cast's (the cast king
 * stands 2.063 in his tower and is the tallest; a Golden Age cannoneer
 * 1.958), from both viewpoints, and holds those numbers against the
 * geometry, so a taller roof, canopy or crew fails here instead of putting
 * the far king under the top edge again.
 */
const CAST_CREW_H: Record<string, number> = { "tower-king": 2.07 };
const CAST_OTHER_H = 1.96;

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
  describe(`the kings' extents in fit.ts hold the towers as built (${edition} edition)`, () => {
    it("far king's roofs, canopy and crew under FAR_KING_TOP; near king's gate over NEAR_KING_FOOT; the crown's width", async () => {
      vi.resetModules();
      vi.stubGlobal("localStorage", storage(edition));
      // Node test env: a no-op 2D canvas for the stone, tile, crack, pill and badge textures.
      const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 0 }), set: () => true });
      vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
      const { ARABIC } = await import("../../theme");
      expect(ARABIC).toBe(edition === "arabic");
      const towers = await import("./towers");
      const common = await import("../common");
      const { PLATE_CLEAR_PX, screenUp } = await import("./towerStyles");
      const looks = await import("../../arenaLooks");
      const castLike = {
        make: (kind: string) => ({ group: new THREE.Group(), height: CAST_CREW_H[kind] ?? CAST_OTHER_H }),
        animate: () => {},
        dispose: () => {},
      };
      // The plate's gap in fit.ts is the one the towers keep (the art bible's floor and its margin).
      expect(PLATE_GAP_PX).toBe(PLATE_CLEAR_PX + 2);
      expect(2 * towers.PLATE_HALF * towers.TOWER_SCALE).toBeLessThanOrEqual(KING_PLATE_H + 1e-9);

      const V = new THREE.Vector3();
      const look = Object.values(edition === "arabic" ? looks.ISLAMIC_LOOKS : looks.LOOKS)[0];
      common.setLook(look);
      let farTop = -Infinity;
      let nearFoot = Infinity;
      try {
        for (const view of ["player", "enemy"] as const) {
          common.setViewSide(view);
          const camSide = view === "player" ? 1 : -1;
          for (const provider of [null, castLike]) {
            towers.setTowerCrewProvider(provider as never);
            for (const flair of [0, 1, 2]) {
              towers.setTowerFlair(flair);
              for (const [kind, side, ax, ay] of [
                ["king-tower", "enemy", 9, 2.5],
                ["king-tower", "player", 9, 29.5],
                ["princess-tower", "enemy", 3.5, 6.5],
                ["princess-tower", "player", 3.5, 25.5],
              ] as const) {
                const v = towers.buildTowerMesh({ id: 1, side, kind, hp: 4000, maxHp: 4000, x: ax, y: ay, active: false } as never);
                const far = side !== view;
                const w = common.toWorld(ax, ay);
                v.root.position.set(w.x, 0, w.z);
                v.root.updateMatrixWorld(true);
                const plate = new Set<THREE.Object3D>();
                v.hpGroup.traverse((o) => plate.add(o));
                let top = -Infinity;
                let foot = Infinity;
                let wideAbove = 0;
                v.root.traverseVisible((o) => {
                  const m = o as THREE.Mesh;
                  if (plate.has(o) || !m.isMesh) return;
                  const pos = m.geometry.attributes.position;
                  for (let i = 0; i < pos.count; i++) {
                    m.getVertexPosition(i, V);
                    V.applyMatrix4(m.matrixWorld);
                    const u = screenUp(V.y, V.z, camSide);
                    top = Math.max(top, u);
                    foot = Math.min(foot, u);
                    // Screen x: the guest's camera looks from -z, so its right is world -x.
                    if (u > FAR_EDGE) wideAbove = Math.max(wideAbove, Math.abs(V.x - w.x));
                  }
                });
                const at = `${view} view, ${side} ${kind}, flair ${flair}, ${provider ? "cast-sized" : "hand-built"} crew`;
                // Where the battle puts the plate: the rig's top and foot (screen-up from the foot).
                const info = towers.towerPlateInfo(v)!;
                const footUp = screenUp(0, w.z, camSide);
                const plateTop = footUp + (info.top + 2 * towers.PLATE_HALF) * towers.TOWER_SCALE;
                if (kind === "king-tower" && far) {
                  farTop = Math.max(farTop, top);
                  expect(top, at).toBeLessThanOrEqual(FAR_KING_TOP);
                  expect(footUp + info.top * towers.TOWER_SCALE, at).toBeLessThanOrEqual(FAR_KING_TOP);
                  // What rises past the far lanterns stays inside the crown's column.
                  expect(wideAbove, at).toBeLessThan(CROWN_HALF_W);
                } else if (kind === "king-tower") {
                  nearFoot = Math.min(nearFoot, foot);
                  expect(foot, at).toBeGreaterThanOrEqual(NEAR_KING_FOOT);
                  expect(footUp + info.foot * towers.TOWER_SCALE, at).toBeGreaterThanOrEqual(NEAR_KING_FOOT);
                } else if (far) {
                  // A far princess and her plate stay under the far lanterns (the band).
                  expect(plateTop + 0.3, at).toBeLessThanOrEqual(FAR_EDGE);
                }
                if (kind === "king-tower") {
                  // The plate and its level shield fit the crown's column.
                  let half = 0;
                  v.hpGroup.traverse((o) => {
                    const p = o.getWorldPosition(new THREE.Vector3());
                    const sc = o.getWorldScale(new THREE.Vector3());
                    if ((o as THREE.Sprite).isSprite) half = Math.max(half, Math.abs(p.x - w.x) + sc.x / 2);
                  });
                  expect(half, at).toBeLessThan(CROWN_HALF_W);
                }
              }
            }
          }
        }
      } finally {
        towers.setTowerCrewProvider(null);
        towers.setTowerFlair(0);
        common.setViewSide("player");
      }
      // The numbers are the real extents (within 3 px on a laptop), not a loose margin over them.
      expect(FAR_KING_TOP - farTop).toBeLessThan(0.1);
      expect(nearFoot - NEAR_KING_FOOT).toBeLessThan(0.1);
    });
  });
}
