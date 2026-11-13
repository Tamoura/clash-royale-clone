/**
 * The see-through ghost under the finger while a card is held. main.ts now
 * re-judges the preview every frame, so a ghost that throws would end the
 * game loop (review round 1: holding a Cannon froze the battle for good).
 * Only troops have a ghost rig; buildings and spells must clear it quietly.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CARDS, type CardId } from "../../game/cards";
import { BUILDING_IDS } from "../characters3d";
import { buildGhost, hasGhost } from "./views/troops";

const ALL = Object.keys(CARDS) as CardId[];

describe("deploy preview ghosts", () => {
  it("exist for troops only", () => {
    for (const id of ALL) expect(hasGhost(id), id).toBe(CARDS[id].kind === "troop");
    for (const id of BUILDING_IDS) expect(hasGhost(id), id).toBe(false);
  });

  it("build for every troop card (so a held troop never throws either)", () => {
    for (const id of ALL.filter(hasGhost)) {
      const rig = buildGhost(id);
      expect(rig.group, id).toBeInstanceOf(THREE.Object3D);
    }
  });

  it("holding a building or a spell over the field builds nothing and never throws", async () => {
    const { Battle3D } = await import("../scene3d");
    // A Battle3D without a GPU: setGhost touches only its scene and ghost.
    const scene = new THREE.Scene();
    const b = Object.assign(Object.create(Battle3D.prototype), { scene, ghost: null }) as InstanceType<typeof Battle3D>;
    const at = { x: 9, y: 24 };
    for (const id of [...BUILDING_IDS, "fireball", "mirror"] as CardId[]) {
      // Every frame, as main.ts's refreshPreview calls it (dim on a "no" spot too).
      expect(() => b.setGhost(id, at)).not.toThrow();
      expect(() => b.setGhost(id, at, true)).not.toThrow();
    }
    expect(scene.children.length).toBe(0);

    b.setGhost("knight", at);
    expect(scene.children.length).toBe(1);
    const knight = scene.children[0];
    expect(knight.visible).toBe(true);
    // Switching to a building hides the troop's ghost instead of building one.
    b.setGhost("cannon", at);
    expect(scene.children.length).toBe(1);
    expect(knight.visible).toBe(false);
  });
});
