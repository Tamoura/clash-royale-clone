import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Entity } from "../../../game/battle";
import { TEAM, isTeamPart } from "../../teamColors";
import { HP_COLOR, setViewSide, type EntityView } from "../common";
import { buildTroopMesh, hpBarVisible, teamSide, unitHpColor } from "./troops";

function view(visible = false): EntityView {
  const hpGroup = new THREE.Group();
  hpGroup.visible = visible;
  return { hpGroup } as EntityView;
}

function troop(side: "player" | "enemy", hp = 100, kind: Entity["kind"] = "troop"): Entity {
  return { side, hp, maxHp: 100, kind } as Entity;
}

describe("troop HP bars", () => {
  it("opponent troops always show a bar, even at full health", () => {
    expect(hpBarVisible(view(), troop("enemy"))).toBe(true);
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
      // plain disc, bar only once hurt; the host's wear the opponent team.
      expect(teamSide("enemy")).toBe("player");
      expect(teamSide("player")).toBe("enemy");
      expect(hpBarVisible(view(), troop("player"))).toBe(true);
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
      const v = buildTroopMesh(e, false);
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
