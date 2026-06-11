import { describe, expect, it } from "vitest";
import { getCard, DECK, type CardId } from "../game/cards";
import { animateTroop, buildTroop } from "./characters3d";

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
