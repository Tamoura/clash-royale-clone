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
