import { describe, expect, it, vi } from "vitest";
import type * as THREE from "three";
import type { CardId } from "../game/cards";
import { isTeamPart } from "./teamColors";

/**
 * Card wave 3's own rigs (Stone Golem, Pebble Golem, Digger) in both
 * editions, and the Comet's flaming rock. ARABIC is fixed when the theme
 * module loads, so each edition gets a fresh module graph.
 */
type Mod = typeof import("./characters3d");

async function edition(arabic: boolean): Promise<Mod> {
  vi.resetModules();
  vi.doMock("./theme", async (orig) => ({ ...(await orig<typeof import("./theme")>()), ARABIC: arabic }));
  try {
    return await import("./characters3d");
  } finally {
    vi.doUnmock("./theme");
    vi.resetModules();
  }
}

function names(root: THREE.Object3D): Map<string, number> {
  const out = new Map<string, number>();
  root.traverse((o) => {
    const n = (o.userData.part as string | undefined) ?? o.name;
    out.set(n, (out.get(n) ?? 0) + 1);
  });
  return out;
}

function teamParts(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (isTeamPart(o)) n++;
  });
  return n;
}

const NEW_TROOPS: CardId[] = ["stone-golem", "pebble-golem", "digger"];

for (const arabic of [false, true]) {
  const label = arabic ? "Golden Age" : "Classic";
  describe(`card wave 3 rigs (${label})`, () => {
    it("each new troop has its own rig, not a borrowed Giant / Mini P.E.K.K.A", async () => {
      const m = await edition(arabic);
      const borrowed = new Set(["giant", "mini-pekka"].map((id) => [...names(m.buildTroop(id as CardId).group).keys()].sort().join("|")));
      for (const id of NEW_TROOPS) {
        const rig = m.buildTroop(id);
        expect(borrowed.has([...names(rig.group).keys()].sort().join("|")), id).toBe(false);
        expect(rig.arm, id).not.toBeNull();
        expect(rig.legs?.length, id).toBe(2);
        expect(teamParts(rig.group), `${id} team parts`).toBeGreaterThanOrEqual(1);
      }
    });

    it("the Stone Golem towers over its Pebble Golems, and both have glowing eye gems", async () => {
      const m = await edition(arabic);
      const golem = m.buildTroop("stone-golem");
      const pebble = m.buildTroop("pebble-golem");
      expect(golem.height).toBeGreaterThan(2.2);
      expect(pebble.height).toBeLessThan(golem.height * 0.6);
      for (const rig of [golem, pebble]) {
        const n = names(rig.group);
        expect(n.get("eye-gem")).toBe(2);
        // A stone face: no blinking human eyes.
        expect(n.get("eye") ?? 0).toBe(0);
        expect(rig.extras).toBeDefined();
      }
      if (arabic) {
        expect(names(golem.group).get("golem-dome")).toBe(1);
        expect(names(golem.group).get("girih-star")).toBe(2);
        expect(names(pebble.group).get("golem-dome")).toBe(1);
      } else {
        expect(names(golem.group).get("moss")).toBeGreaterThanOrEqual(3);
        expect(names(golem.group).get("crack")).toBeGreaterThanOrEqual(3);
        expect(names(pebble.group).get("moss")).toBe(1);
      }
    });

    it("the eye gems throb in idle", async () => {
      const m = await edition(arabic);
      const rig = m.buildTroop("stone-golem");
      const eyes = rig.group.getObjectByName("eye-gems")!;
      m.animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0 });
      const a = eyes.scale.x;
      m.animateTroop(rig, { moving: false, swing: 0, time: 0.6, phase: 0 });
      expect(eyes.scale.x).not.toBeCloseTo(a, 3);
    });

    it("the Digger is a miner (Classic) or a treasure-digger (Golden Age)", async () => {
      const m = await edition(arabic);
      const rig = m.buildTroop("digger");
      const n = names(rig.group);
      expect(n.get("brow")).toBe(2); // a human face
      expect(n.get("lamp")).toBe(1);
      if (arabic) {
        expect(n.get("shovel")).toBe(1);
        expect(n.get("treasure-sack")).toBe(1);
        expect(n.get("pickaxe") ?? 0).toBe(0);
      } else {
        expect(n.get("pickaxe")).toBe(1);
        expect(n.get("hard-hat")).toBe(1);
        expect(n.get("shovel") ?? 0).toBe(0);
      }
    });

    it("the Digger's chop swings its tool through a quick arc", async () => {
      const m = await edition(arabic);
      const rig = m.buildTroop("digger");
      m.animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0, style: "chop" });
      const rest = rig.arm!.rotation.x;
      m.animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0, style: "chop" });
      expect(rest - rig.arm!.rotation.x).toBeGreaterThan(1.5);
    });
  });
}

describe("the Comet's rock", () => {
  it("is a basalt boulder split by glowing lava veins", async () => {
    const m = await edition(false);
    const rock = m.buildCometRock(0.6);
    const n = names(rock);
    expect(n.get("comet-body")).toBe(1);
    expect(n.get("comet-vein")).toBeGreaterThanOrEqual(3);
    const vein = rock.getObjectByName("comet-vein") as THREE.Mesh;
    expect((vein.material as THREE.Material).type).toBe("MeshBasicMaterial");
  });
});
