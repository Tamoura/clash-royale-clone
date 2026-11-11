import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { Entity } from "../../../game/battle";
import { TEAM, teamColor } from "../../teamColors";
import { HP_COLOR, setViewSide } from "../common";
import { ARABIC } from "../../theme";
import {
  PLATE_HALF,
  TOWER_SCALE,
  buildTowerMesh,
  crewKindOf,
  kingSlumpTilt,
  repaintTowers,
  setTowerCrewProvider,
  towerKeepUniforms,
  towerPlateInfo,
  towerTeamColors,
  type TowerCrewProvider,
} from "./towers";
import { PLATE_CLEAR_PX, screenUp, UP_Y } from "./towerStyles";
import towersSource from "./towers.ts?raw";

function tower(side: Side, kind: Entity["kind"] = "princess-tower", troop?: Entity["towerTroop"]): Entity {
  return {
    id: side === "player" ? 1 : 2,
    side,
    kind,
    hp: 1400,
    maxHp: 1400,
    x: 3.5,
    y: side === "player" ? 25.5 : 6.5,
    active: kind !== "king-tower",
    towerTroop: troop,
  } as Entity;
}

/** The team colours actually built into a tower: the keep's team uniform and the HP fill. */
function built(side: Side): { cloth: number; hp: number } {
  const v = buildTowerMesh(tower(side));
  const hp = (v.hpFill.material as THREE.MeshBasicMaterial).color.getHex();
  return { cloth: towerKeepUniforms(v)!.uTeam.value.getHex(), hp };
}

beforeEach(() => {
  // Node test env: a no-op 2D canvas for the stone, tile, crack, pill and badge textures.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 0 }), set: () => true });
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});

afterEach(() => {
  setViewSide("player");
  setTowerCrewProvider(null);
  vi.unstubAllGlobals();
});

describe("tower team colours follow the viewer (online guest)", () => {
  it("the default (host) view keeps the sim sides' colours", () => {
    expect(towerTeamColors("player")).toEqual({ team: "player", cloth: teamColor("player"), hp: HP_COLOR.player });
    expect(towerTeamColors("enemy")).toEqual({ team: "enemy", cloth: teamColor("enemy"), hp: HP_COLOR.enemy });
    expect(built("player")).toEqual({ cloth: teamColor("player"), hp: HP_COLOR.player });
    expect(built("enemy")).toEqual({ cloth: teamColor("enemy"), hp: HP_COLOR.enemy });
  });

  it("the guest's own towers (sim 'enemy') wear the player team, the host's the enemy team", () => {
    setViewSide("enemy");
    expect(towerTeamColors("enemy")).toEqual({ team: "player", cloth: teamColor("player"), hp: HP_COLOR.player });
    expect(towerTeamColors("player")).toEqual({ team: "enemy", cloth: teamColor("enemy"), hp: HP_COLOR.enemy });
    expect(built("enemy")).toEqual({ cloth: teamColor("player"), hp: HP_COLOR.player });
    expect(built("player")).toEqual({ cloth: teamColor("enemy"), hp: HP_COLOR.enemy });
  });

  it("a king tower follows the same rule", () => {
    setViewSide("enemy");
    const v = buildTowerMesh(tower("enemy", "king-tower"));
    expect((v.hpFill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(HP_COLOR.player);
    expect(towerKeepUniforms(v)!.uTeam.value.getHex()).toBe(teamColor("player"));
  });

  it("roofs and HP bars honour the colour-blind palette, by team", () => {
    expect(towerTeamColors("player", "cb")).toMatchObject({ cloth: TEAM.cb.player.main, hp: TEAM.cb.player.main });
    expect(towerTeamColors("enemy", "cb")).toMatchObject({ cloth: TEAM.cb.enemy.main, hp: TEAM.cb.enemy.main });
    setViewSide("enemy");
    expect(towerTeamColors("enemy", "cb").cloth).toBe(TEAM.cb.player.main);
    expect(towerTeamColors("player", "cb").cloth).toBe(TEAM.cb.enemy.main);
  });

  it("repaints standing towers live when the palette changes", () => {
    const scene = new THREE.Scene();
    const enemy = buildTowerMesh(tower("enemy"));
    const mine = buildTowerMesh(tower("player", "king-tower"));
    scene.add(enemy.root, mine.root);
    repaintTowers("cb");
    expect(towerKeepUniforms(enemy)!.uTeam.value.getHex()).toBe(TEAM.cb.enemy.main);
    expect(towerKeepUniforms(mine)!.uTeam.value.getHex()).toBe(TEAM.cb.player.main);
    expect((enemy.hpFill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(TEAM.cb.enemy.main);
    repaintTowers("default");
    expect(towerKeepUniforms(enemy)!.uTeam.value.getHex()).toBe(TEAM.default.enemy.main);
  });

  it("every team cue in towers.ts goes through towerTeamColors or the viewer team (no raw sim-side colour)", () => {
    expect(towersSource).not.toMatch(/SIDE_COLOR\[/);
    expect(towersSource).not.toMatch(/HP_COLOR\[/);
    // The baked hand-built crew is cached per viewer team, not per sim side.
    expect(towersSource).toMatch(/bakeRig\(rig, `[^`]*\$\{team\}/);
  });
});

describe("the keep is one draw", () => {
  it("a princess tower is one keep mesh; a king adds only his cannon", () => {
    const meshes = (v: ReturnType<typeof buildTowerMesh>): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      v.root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        for (let p: THREE.Object3D | null = o; p && p !== v.root; p = p.parent) {
          if (p.name === "defenderMount" || p === v.hpGroup) return;
        }
        out.push(o as THREE.Mesh);
      });
      return out;
    };
    expect(meshes(buildTowerMesh(tower("player"))).map((m) => m.name)).toEqual(["princess-keep"]);
    expect(meshes(buildTowerMesh(tower("enemy", "king-tower"))).map((m) => m.name).sort()).toEqual(["cannon", "king-keep"]);
  });
});

describe("tower HP plates", () => {
  /** The HP number sprite's z relative to its bar (positive = nearer the bottom of the field). */
  function textInFront(side: Side): number {
    const v = buildTowerMesh(tower(side));
    const text = v.root.children.find((o) => (o as THREE.Sprite).isSprite && o.scale.x === 1.75)!;
    return text.position.z - v.hpGroup.position.z;
  }

  it("the number sits on the camera side of the bar for the host (camera at +z)…", () => {
    expect(textInFront("player")).toBeGreaterThan(0);
    expect(textInFront("enemy")).toBeGreaterThan(0);
  });

  it("…and for the guest, whose camera looks from -z", () => {
    setViewSide("enemy");
    expect(textInFront("player")).toBeLessThan(0);
    expect(textInFront("enemy")).toBeLessThan(0);
  });

  /** 390 px phone: the field's 18 tiles span about 380 px. */
  const PX_PER_LOCAL = (380 / 18) * TOWER_SCALE;

  for (const view of ["player", "enemy"] as const) {
    it(`far towers carry it above the roofs, near ones under the gate, clear by ${PLATE_CLEAR_PX} px (${view} view)`, () => {
      setViewSide(view);
      for (const kind of ["princess-tower", "king-tower"] as const) {
        for (const side of ["player", "enemy"] as const) {
          const v = buildTowerMesh(tower(side, kind));
          const info = towerPlateInfo(v)!;
          const s = screenUp(v.hpGroup.position.y, v.hpGroup.position.z, info.camSide);
          expect(s).toBeCloseTo(info.spot.s, 5);
          const far = side !== view;
          expect(info.spot.above).toBe(far);
          const gap = far ? s - PLATE_HALF - info.top : info.foot - (s + PLATE_HALF);
          expect(gap * PX_PER_LOCAL).toBeGreaterThanOrEqual(PLATE_CLEAR_PX);
        }
      }
    });
  }

  it("floats the plate toward the camera, in front of the keep", () => {
    const v = buildTowerMesh(tower("player"));
    // Depth toward the camera: y·UP_Z + z·UP_Y for the host.
    const depth = v.hpGroup.position.y * (30 / Math.hypot(30, 26)) + v.hpGroup.position.z * UP_Y;
    expect(depth).toBeGreaterThan(3);
  });
});

describe("tower crew seam", () => {
  it("without a provider the towers keep the hand-built crew", () => {
    const v = buildTowerMesh(tower("player"));
    expect(v.defender).toBeTruthy();
    expect(v.defenderMount!.children).toContain(v.defender!.group);
  });

  it("a registered provider makes the crew (viewer team, edition) and the tower mounts it", () => {
    const made: unknown[][] = [];
    const provider: TowerCrewProvider = {
      make: (kind, side, edition) => {
        made.push([kind, side, edition]);
        const group = new THREE.Group();
        group.name = "providedCrew";
        return { group, height: 2.1 };
      },
      animate: () => {},
      dispose: () => {},
    };
    setTowerCrewProvider(provider);
    setViewSide("enemy");
    const v = buildTowerMesh(tower("player", "king-tower"));
    expect(made).toEqual([["tower-king", "enemy", ARABIC ? "golden" : "classic"]]);
    expect(v.defender).toBeUndefined();
    const crew = v.defenderMount!.getObjectByName("providedCrew")!;
    expect(crew).toBeTruthy();
    // Sized in world units: the tower's own scale is undone.
    expect(crew.scale.x * TOWER_SCALE).toBeCloseTo(1, 5);
  });

  it("falls back when the provider cannot make a kind", () => {
    setTowerCrewProvider({ make: () => null, animate: () => {}, dispose: () => {} });
    const v = buildTowerMesh(tower("enemy", "princess-tower", "cannoneer"));
    expect(v.defender).toBeTruthy();
  });

  it("a sleeping king nods toward the camera from both viewpoints (never back under his canopy)", () => {
    for (const camSide of [1, -1]) {
      for (const provider of [false, true]) {
        const tilt = kingSlumpTilt(1, camSide, provider);
        // The mount's idle yaw faces the camera, then the slump tilts it (Euler XYZ).
        const head = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(tilt, camSide > 0 ? 0 : Math.PI, 0));
        expect(Math.sign(head.z)).toBe(camSide);
        expect(Math.abs(tilt)).toBeCloseTo(provider ? 0.3 : 0.45, 6);
        expect(kingSlumpTilt(0, camSide, provider)).toBeCloseTo(0, 9);
      }
    }
    expect(towersSource).toMatch(/mount\.rotation\.x = kingSlumpTilt\(rig\.slump, rig\.camSide/);
  });

  it("names the crew kind from the tower", () => {
    expect(crewKindOf({ kind: "king-tower", towerTroop: undefined })).toBe("tower-king");
    expect(crewKindOf({ kind: "princess-tower", towerTroop: "cannoneer" })).toBe("cannoneer");
    expect(crewKindOf({ kind: "princess-tower", towerTroop: "duchess" })).toBe("duchess");
    expect(crewKindOf({ kind: "princess-tower", towerTroop: undefined })).toBe("tower-princess");
  });
});
