import { describe, expect, it } from "vitest";
import { DEFAULT_CHAMPION, type ChampionDef } from "../game/customcard";
import { buildChampionRig, buildTroop } from "./characters3d";

function def(overrides: Partial<ChampionDef> = {}): ChampionDef {
  const base = structuredClone(DEFAULT_CHAMPION);
  return {
    ...base,
    ...overrides,
    abilities: { ...base.abilities, ...(overrides.abilities ?? {}) },
    look: { ...base.look, ...(overrides.look ?? {}) },
  };
}

describe("buildChampionRig", () => {
  it("builds a grounded melee rig with arm, legs and off-arm", () => {
    const rig = buildChampionRig(def());
    expect(rig.group.children.length).toBeGreaterThan(5);
    expect(rig.arm).toBeTruthy();
    expect(rig.legs?.length).toBe(2);
    expect(rig.offArm).toBeTruthy();
    expect(rig.hover).toBeUndefined();
  });

  it("every headgear and weapon variant builds", () => {
    for (const headgear of ["none", "helmet", "hood", "crown", "horns", "turban"] as const) {
      for (const weapon of ["sword", "axe", "hammer", "spear", "bow", "staff", "none"] as const) {
        const rig = buildChampionRig(def({ look: { ...DEFAULT_CHAMPION.look, headgear, weapon } }));
        expect(rig.group.children.length).toBeGreaterThan(4);
      }
    }
  });

  it("flying designs hover and get flapping wings", () => {
    const rig = buildChampionRig(def({ abilities: { ...DEFAULT_CHAMPION.abilities, flying: true } }));
    expect(rig.hover).toBeGreaterThan(0);
    expect(rig.wings?.length).toBe(2);
  });

  it("squad designs shrink the rig", () => {
    const solo = buildChampionRig(def({ count: 1 }));
    const squad = buildChampionRig(def({ count: 5 }));
    expect(squad.group.scale.x).toBeLessThan(solo.group.scale.x);
    expect(squad.height).toBeLessThan(solo.height);
  });

  it("ranged designs lower the weapon rest pose", () => {
    const melee = buildChampionRig(def({ range: 0.8 }));
    const ranged = buildChampionRig(def({ range: 6 }));
    expect(ranged.armRest).toBeLessThan(melee.armRest);
  });

  it("buildTroop dispatches the champion id", () => {
    const rig = buildTroop("champion");
    expect(rig.group.children.length).toBeGreaterThan(5);
  });
});
