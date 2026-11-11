import { describe, expect, it, vi } from "vitest";
import { setPrefs } from "../../../ui/prefs";
import * as THREE from "three";
import type { Entity } from "../../../game/battle";
import { TEAM, isTeamPart } from "../../teamColors";
import { HP_COLOR, setViewSide, type EntityView } from "../common";
import { buildBuildingMesh, buildTroopMesh, hpBarVisible, makeHpBar, setHpFill, setHpFillColor, teamSide, unitHpColor } from "./troops";

function view(visible = false): EntityView {
  const hpGroup = new THREE.Group();
  hpGroup.visible = visible;
  return { hpGroup } as EntityView;
}

function troop(side: "player" | "enemy", hp = 100, kind: Entity["kind"] = "troop"): Entity {
  return { side, hp, maxHp: 100, kind } as Entity;
}

describe("troop HP bars", () => {
  it("troops of either side show a bar only once hurt (art bible: no clutter at full health)", () => {
    expect(hpBarVisible(view(), troop("enemy"))).toBe(false);
    expect(hpBarVisible(view(), troop("enemy", 99))).toBe(true);
  });

  it("your own troops show one only once hurt, and keep it", () => {
    expect(hpBarVisible(view(), troop("player"))).toBe(false);
    expect(hpBarVisible(view(), troop("player", 99))).toBe(true);
    expect(hpBarVisible(view(true), troop("player"))).toBe(true);
  });

  it("buildings and towers keep whatever their builder set", () => {
    expect(hpBarVisible(view(true), troop("enemy", 100, "building"))).toBe(true);
    expect(hpBarVisible(view(false), troop("player", 50, "building"))).toBe(false);
  });

  it("fills green/red by default and blue/orange in the colour-blind palette", () => {
    expect(unitHpColor("player", "default")).toBe(HP_COLOR.player);
    expect(unitHpColor("enemy", "default")).toBe(HP_COLOR.enemy);
    expect(unitHpColor("player", "cb")).toBe(TEAM.cb.player.main);
    expect(unitHpColor("enemy", "cb")).toBe(TEAM.cb.enemy.main);
  });
});

describe("viewer-relative team (online guest)", () => {
  it("the host sees sim sides as they are", () => {
    expect(teamSide("player")).toBe("player");
    expect(teamSide("enemy")).toBe("enemy");
  });

  it("a guest wears blue on their own units and bars the host's", () => {
    setViewSide("enemy");
    try {
      // The guest's own units (sim 'enemy') wear the player team: blue,
      // plain disc; the host's wear the opponent team. Bars show once hurt.
      expect(teamSide("enemy")).toBe("player");
      expect(teamSide("player")).toBe("enemy");
      expect(hpBarVisible(view(), troop("player"))).toBe(false);
      expect(hpBarVisible(view(), troop("enemy"))).toBe(false);
      expect(hpBarVisible(view(), troop("enemy", 99))).toBe(true);
    } finally {
      setViewSide("player");
    }
  });

  it("a guest's own knight is built in the player team colour", () => {
    // Node test env: a no-op 2D canvas for the shared contact-shadow texture.
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    });
    setViewSide("enemy");
    try {
      const e = { ...troop("enemy"), cardId: "knight", radius: 0.5 } as Entity;
      const v = buildTroopMesh(e);
      const colours = new Set<number>();
      v.root.traverse((o) => {
        if (isTeamPart(o) && o.userData.team === "main") {
          colours.add(((o as THREE.Mesh).material as THREE.MeshToonMaterial).color.getHex());
        }
      });
      expect(colours).toEqual(new Set([TEAM.default.player.main]));
      expect(v.hpGroup.visible).toBe(false);
    } finally {
      setViewSide("player");
      vi.unstubAllGlobals();
    }
  });
});

describe("swarm HP bars and the single-draw bar", () => {
  it("swarm-sized and big opponents alike show a bar only once hurt", () => {
    const small = (hp: number) => ({ ...troop("enemy", hp), radius: 0.28 }) as Entity;
    expect(hpBarVisible(view(), small(100))).toBe(false);
    expect(hpBarVisible(view(), small(40))).toBe(true);
    expect(hpBarVisible(view(), { ...troop("enemy"), radius: 0.6 } as Entity)).toBe(false);
  });

  it("a troop bar is one mesh whose fraction and colour are uniforms", () => {
    const bar = makeHpBar(0.9, 0xff0000, 1, 0.2, false);
    let meshes = 0;
    bar.group.traverse((o) => ((o as THREE.Mesh).isMesh ? meshes++ : 0));
    expect(meshes).toBe(1);
    setHpFill({ hpFill: bar.fill } as EntityView, 0.4, 0.9);
    const u = bar.fill.userData.hpBar;
    expect(u.uFrac.value).toBeCloseTo(0.4);
    setHpFillColor(bar.fill, 0x00ff00);
    expect(u.uColor.value.getHex()).toBe(0x00ff00);
  });
});

describe("card buildings (creatures-fx rigs)", () => {
  it("cannon, tombstone and collector are baked rigs: one team slot, the bar at the rig's barY, the cannon's barrel aimable", () => {
    // Node test env: a no-op 2D canvas for the shared HP-bar trough texture.
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    });
    try {
      for (const cardId of ["cannon", "tombstone", "elixir-collector"] as const) {
        for (const side of ["player", "enemy"] as const) {
          const e = { ...troop(side, 100, "building"), cardId, radius: 0.6 } as Entity;
          const v = buildBuildingMesh(e);
          expect(v.isTroop, cardId).toBe(false);
          const rig = v.root.children.find((o) => o.userData.baked);
          expect(rig, `${cardId} is baked`).toBeDefined();
          // The bar rides above the model, not inside it.
          expect(v.hpGroup.position.y, cardId).toBeGreaterThan(1.4);
          // Team colour only on the building's slot, in its viewer-relative team.
          const colours = new Set<number>();
          // (A baked team mesh holding a main and a dark part is tagged "both"; its colour is the main.)
          v.root.traverse((o) => {
            if (isTeamPart(o) && o.userData.team !== "dark") {
              colours.add(((o as THREE.Mesh).material as THREE.MeshToonMaterial).color.getHex());
            }
          });
          expect(colours, cardId).toEqual(new Set([TEAM.default[side].main]));
          if (cardId === "cannon") {
            expect(v.barrel, "barrel").toBeDefined();
            let inTree = false;
            v.root.traverse((o) => (inTree ||= o === v.barrel));
            expect(inTree).toBe(true);
          } else {
            expect(v.barrel).toBeUndefined();
          }
          expect(v.flashMats.length, `${cardId} flashes`).toBeGreaterThan(0);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a palette change repaints a live building's team slot", () => {
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    });
    const stage = new THREE.Group();
    try {
      setPrefs({ teamPalette: "default" });
      const e = { ...troop("enemy", 100, "building"), cardId: "cannon", radius: 0.6 } as Entity;
      const v = buildBuildingMesh(e);
      stage.add(v.root); // on stage: the repaint skips views that left the scene
      const slot = () => {
        let hex = -1;
        v.root.traverse((o) => {
          if (isTeamPart(o)) hex = ((o as THREE.Mesh).material as THREE.MeshToonMaterial).color.getHex();
        });
        return hex;
      };
      expect(slot()).toBe(TEAM.default.enemy.main);
      setPrefs({ teamPalette: "cb" });
      expect(slot()).toBe(TEAM.cb.enemy.main);
    } finally {
      setPrefs({ teamPalette: "default" });
      stage.clear();
      vi.unstubAllGlobals();
    }
  });
});
