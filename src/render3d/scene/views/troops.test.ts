import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Entity } from "../../../game/battle";
import { TEAM } from "../../teamColors";
import { HP_COLOR, type EntityView } from "../common";
import { hpBarVisible, unitHpColor } from "./troops";

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
