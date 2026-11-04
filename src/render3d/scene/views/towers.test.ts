import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { Entity } from "../../../game/battle";
import { TEAM } from "../../teamColors";
import { HP_COLOR, SIDE_COLOR, setViewSide } from "../common";
import { buildTowerMesh, towerTeamColors } from "./towers";
import towersSource from "./towers.ts?raw";

function tower(side: Side, kind: Entity["kind"] = "princess-tower"): Entity {
  return { id: side === "player" ? 1 : 2, side, kind, hp: 1400, maxHp: 1400, x: 3.5, y: side === "player" ? 25.5 : 6.5 } as Entity;
}

/** The team colours actually built into a tower: flag cloth and HP fill. */
function built(side: Side): { cloth: number; hp: number } {
  const v = buildTowerMesh(tower(side));
  let cloth: number | null = null;
  v.root.getObjectByName("flag")!.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && m?.side === THREE.DoubleSide) cloth = m.color.getHex();
  });
  const hp = (v.hpFill.material as THREE.MeshBasicMaterial).color.getHex();
  return { cloth: cloth!, hp };
}

beforeEach(() => {
  // Node test env: a no-op 2D canvas for the brick, crack, pill and badge textures.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 0 }), set: () => true });
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});

afterEach(() => {
  setViewSide("player");
  vi.unstubAllGlobals();
});

describe("tower team colours follow the viewer (online guest)", () => {
  it("the default (host) view keeps the sim sides' colours", () => {
    expect(towerTeamColors("player")).toEqual({ team: "player", cloth: SIDE_COLOR.player, hp: HP_COLOR.player });
    expect(towerTeamColors("enemy")).toEqual({ team: "enemy", cloth: SIDE_COLOR.enemy, hp: HP_COLOR.enemy });
    expect(built("player")).toEqual({ cloth: SIDE_COLOR.player, hp: HP_COLOR.player });
    expect(built("enemy")).toEqual({ cloth: SIDE_COLOR.enemy, hp: HP_COLOR.enemy });
  });

  it("the guest's own towers (sim 'enemy') wear the player team, the host's the enemy team", () => {
    setViewSide("enemy");
    expect(towerTeamColors("enemy")).toEqual({ team: "player", cloth: SIDE_COLOR.player, hp: HP_COLOR.player });
    expect(towerTeamColors("player")).toEqual({ team: "enemy", cloth: SIDE_COLOR.enemy, hp: HP_COLOR.enemy });
    expect(built("enemy")).toEqual({ cloth: SIDE_COLOR.player, hp: HP_COLOR.player });
    expect(built("player")).toEqual({ cloth: SIDE_COLOR.enemy, hp: HP_COLOR.enemy });
  });

  it("a king tower follows the same rule", () => {
    setViewSide("enemy");
    const v = buildTowerMesh(tower("enemy", "king-tower"));
    expect((v.hpFill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(HP_COLOR.player);
  });

  it("HP bars honour the colour-blind palette, by team", () => {
    expect(towerTeamColors("player", "cb").hp).toBe(TEAM.cb.player.main);
    expect(towerTeamColors("enemy", "cb").hp).toBe(TEAM.cb.enemy.main);
    setViewSide("enemy");
    expect(towerTeamColors("enemy", "cb").hp).toBe(TEAM.cb.player.main);
    expect(towerTeamColors("player", "cb").hp).toBe(TEAM.cb.enemy.main);
  });

  it("every team cue in towers.ts goes through towerTeamColors (no raw sim-side colour)", () => {
    expect(towersSource).not.toMatch(/SIDE_COLOR\[e\.side\]/);
    expect(towersSource).not.toMatch(/HP_COLOR\[/);
    // The baked tower crew is cached per team, not per sim side.
    expect(towersSource).toMatch(/bakeRig\(defender, `[^`]*\$\{colors\.team\}/);
  });
});

describe("tower HP numbers face the viewer's camera", () => {
  /** The HP number sprite's z relative to its bar (positive = nearer the bottom of the field). */
  function textInFront(side: Side): number {
    const v = buildTowerMesh(tower(side));
    const text = v.root.children.find((o) => (o as THREE.Sprite).isSprite && o.scale.x === 1.75)!;
    return text.position.z - v.hpGroup.position.z;
  }

  it("sits on the camera side of the bar for the host (camera at +z)…", () => {
    expect(textInFront("player")).toBeGreaterThan(0);
    expect(textInFront("enemy")).toBeGreaterThan(0);
  });

  it("…and for the guest, whose camera looks from -z (the bar hid it before)", () => {
    setViewSide("enemy");
    expect(textInFront("player")).toBeLessThan(0);
    expect(textInFront("enemy")).toBeLessThan(0);
  });
});
