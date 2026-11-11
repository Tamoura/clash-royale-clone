import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ARABIC_LOOK, ISLAMIC_LOOKS, LOOKS, type ArenaLook } from "../../arenaLooks";
import {
  CLASSIC_LOOK_IDS,
  DAMAGE_STAGE_1,
  DAMAGE_STAGE_2,
  GOLDEN_LOOK_IDS,
  LOOK_EXTRAS,
  PLATE_CLEAR_PX,
  clampPlate,
  plateClearancePx,
  platePlacement,
  screenUp,
  towerDamageStage,
  towerFlair,
  towerStyle,
  type TowerEdition,
} from "./towerStyles";
import { KEEP_CHUNKS, STAGE_END, craftKeep, craftRuin } from "./towerCraft";
import { onionDome } from "../arena/build";

const ALL: { look: ArenaLook; edition: TowerEdition }[] = [
  ...Object.values(LOOKS).map((look) => ({ look, edition: "classic" as const })),
  ...[ARABIC_LOOK, ...Object.values(ISLAMIC_LOOKS)]
    .filter((l, i, a) => a.findIndex((m) => m.id === l.id) === i)
    .map((look) => ({ look, edition: "golden" as const })),
];

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 0 }), set: () => true });
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("tower styles cover every look", () => {
  it("knows all 22 looks, 11 per edition", () => {
    expect([...CLASSIC_LOOK_IDS].sort()).toEqual(Object.keys(LOOKS).sort());
    const golden = new Set([ARABIC_LOOK.id, ...Object.keys(ISLAMIC_LOOKS)]);
    expect([...GOLDEN_LOOK_IDS].sort()).toEqual([...golden].sort());
    expect(ALL).toHaveLength(22);
  });

  it("takes stone and colours from the look; roofs are cones in Classic, domes in the Golden Age", () => {
    for (const { look, edition } of ALL) {
      for (const ed of ["classic", "golden"] as const) {
        const s = towerStyle(look, ed);
        expect(s.wall).toEqual({ player: look.tower.player, enemy: look.tower.enemy });
        expect(s.platform).toEqual({ player: look.tower.platformPlayer, enemy: look.tower.platformEnemy });
        expect(s.plinth).toBe(look.tower.plinth);
        expect(s.battlement).toBe(look.tower.battlement);
        expect(s.roof).toBe(ed === "golden" ? "dome" : "cone");
      }
      void edition;
    }
  });

  it("dresses the look-id extras from the table, and nothing elsewhere", () => {
    const want: Record<string, string[]> = {
      snow: ["snowCaps"], ice: ["snowCaps"], atlas: ["snowCaps"],
      forge: ["emberCracks"], copper: ["emberCracks"],
      jungle: ["vines"], ghouta: ["vines"],
      neon: ["neonStrips"], bone: ["boneLintels"],
    };
    expect(LOOK_EXTRAS).toEqual(want);
    for (const { look, edition } of ALL) {
      expect([...towerStyle(look, edition).extras]).toEqual(want[look.id] ?? []);
    }
  });

  it("builds a whole keep and ruin for every look in its edition: princess and king, both teams, both viewpoints", () => {
    for (const { look, edition } of ALL) {
      const style = towerStyle(look, edition);
      let set = 0; // triangles in one battle's six towers (two of each kind per camera side)
      for (const king of [false, true]) {
        for (const camSide of [1, -1]) {
          const k = craftKeep({
            king, radius: king ? 1.28 : 0.95, height: king ? 2.7 : 2.15, team: 0x3b82f6, enemyTeam: camSide < 0,
            camSide, facing: -camSide, gun: king, flair: towerFlair(2), style, dome: onionDome,
          });
          const g = k.mesh.geometry;
          const n = g.getAttribute("position").count;
          expect(n).toBeGreaterThan(1000);
          for (const name of ["normal", "uv", "color", "aFlags", "aStage"]) expect(g.getAttribute(name).count).toBe(n);
          // Every chunk but the canopy is there; the canopy only on a king.
          for (const c of KEEP_CHUNKS) expect(k.ranges.has(c)).toBe(c === "canopy" ? king : true);
          expect(k.gunMesh !== null).toBe(king);
          expect(k.tops.length).toBeGreaterThanOrEqual(4);
          set += (n / 3 + (k.gunMesh ? k.gunMesh.geometry.getAttribute("position").count / 3 : 0)) * (king ? 1 : 2);
          k.mesh.geometry.dispose();
        }
        const ruin = craftRuin({ king, radius: king ? 1.28 : 0.95, team: 0xe53935, enemyTeam: true, camSide: 1, style, seed: 3 });
        expect(ruin.stump.geometry.getAttribute("position").count).toBeGreaterThan(200);
        expect(ruin.heap.geometry.getAttribute("position").count).toBeGreaterThan(200);
      }
      // Budget: all six towers at most 60k triangles at L0 (flair 2, look extras, ink included).
      expect(set, `${look.id} ${edition}`).toBeLessThanOrEqual(60000);
    }
  });

  it("puts team colour, ink and damage parts in the keep", () => {
    const k = craftKeep({
      king: false, radius: 0.95, height: 2.15, team: 0xe53935, enemyTeam: true, camSide: 1, facing: 1, gun: false,
      flair: towerFlair(0), style: towerStyle(LOOKS.meadow, "classic"),
    });
    const f = k.mesh.geometry.getAttribute("aFlags") as THREE.BufferAttribute;
    const st = k.mesh.geometry.getAttribute("aStage") as THREE.BufferAttribute;
    let team = 0;
    let ink = 0;
    let onlyWhole = 0;
    let stage1 = 0;
    let stage2 = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.getX(i) > 0.5) team++;
      if (f.getZ(i) > 0.5) ink++;
      if (st.getX(i) === 0 && st.getY(i) < STAGE_END) onlyWhole++;
      if (st.getX(i) === 1) stage1++;
      if (st.getX(i) === 2) stage2++;
    }
    expect(team).toBeGreaterThan(500);
    expect(ink).toBeGreaterThan(500);
    expect(onlyWhole).toBeGreaterThan(0); // merlons, banner, upright flag
    expect(stage1).toBeGreaterThan(0); // cracks, the chipped merlon, the leaning flag
    expect(stage2).toBeGreaterThan(0); // more cracks, roof hole, torn banner
    expect(k.chips[1]).toHaveLength(1);
    expect(k.chips[2]).toHaveLength(2);
  });
});

describe("silhouette ink", () => {
  const keep = (edition: TowerEdition, camSide: number) =>
    craftKeep({
      king: false, radius: 0.95, height: 2.15, team: 0x3b82f6, enemyTeam: false, camSide, facing: -camSide, gun: false,
      flair: towerFlair(0), style: towerStyle(edition === "golden" ? ARABIC_LOOK : LOOKS.meadow, edition), dome: onionDome,
    });

  it("closes each roof cone to one tip whose hull grows straight up (no fins splaying from the tip)", () => {
    for (const camSide of [1, -1]) {
      const g = keep("classic", camSide).mesh.geometry;
      const p = g.getAttribute("position");
      const n = g.getAttribute("normal");
      const f = g.getAttribute("aFlags");
      let top = -Infinity;
      for (let i = 0; i < p.count; i++) if (f.getZ(i) > 0.5) top = Math.max(top, p.getY(i));
      const tips = new Set<string>();
      for (let i = 0; i < p.count; i++) {
        if (f.getZ(i) < 0.5 || p.getY(i) < top - 1e-4) continue;
        tips.add(`${p.getX(i).toFixed(4)},${p.getZ(i).toFixed(4)}`);
        expect(n.getY(i)).toBeGreaterThan(0.999);
      }
      expect(tips.size).toBe(4); // one point per turret cone
    }
  });

  it("draws both faces (the depth-pushed hull shows only past the silhouette) and casts with back faces", () => {
    for (const edition of ["classic", "golden"] as const) {
      const m = keep(edition, 1).mesh.material as THREE.Material;
      expect(m.side).toBe(THREE.DoubleSide);
      expect(m.shadowSide).toBe(THREE.BackSide);
    }
  });

  it("builds the Golden Age domes at a lighter tessellation, still at least 12 segments round", () => {
    const g = keep("golden", 1).mesh.geometry;
    const f = g.getAttribute("aFlags");
    let roof = 0;
    for (let i = 0; i < f.count; i++) if (Math.round(f.getY(i)) === 3 && f.getZ(i) < 0.5) roof++;
    // Four bulbs at 12 x 10 (216 triangles) plus four 12-sided tips (24), three vertices each.
    expect(roof).toBe(4 * (216 + 24) * 3);
  });
});

describe("plate tops and damage parts", () => {
  const build = (look: ArenaLook, edition: TowerEdition, king: boolean, camSide: number, flair: number) =>
    craftKeep({
      king, radius: king ? 1.28 : 0.95, height: king ? 2.7 : 2.15, team: 0x3b82f6, enemyTeam: camSide < 0, camSide,
      facing: -camSide, gun: king, flair: towerFlair(flair), style: towerStyle(look, edition), dome: onionDome, crewHeight: king ? 1.4 : 1.2,
    });
  const topOf = (k: ReturnType<typeof craftKeep>, camSide: number): number => Math.max(...k.tops.map((t) => screenUp(t.y, t.z, camSide)));

  it("the plate's tops reach the highest point of the whole keep on screen (flag and finials included)", () => {
    const looks: [ArenaLook, TowerEdition][] = [[LOOKS.meadow, "classic"], [LOOKS.snow, "classic"], [ARABIC_LOOK, "golden"], [ISLAMIC_LOOKS.atlas, "golden"]];
    for (const [look, edition] of looks) {
      for (const flair of [0, 2]) {
        for (const king of [false, true]) {
          for (const camSide of [1, -1]) {
            const k = build(look, edition, king, camSide, flair);
            const g = k.mesh.geometry;
            const p = g.getAttribute("position");
            const st = g.getAttribute("aStage");
            let body = -Infinity;
            for (let i = 0; i < (g.userData.bodyCount as number); i++) {
              if (st.getX(i) === 0) body = Math.max(body, screenUp(p.getY(i), p.getZ(i), camSide));
            }
            // A finial ball's rim shows a hair over its top point (about 1 CSS px).
            expect(body - topOf(k, camSide), `${look.id} f${flair} ${king ? "king" : "princess"} ${camSide}`).toBeLessThanOrEqual(0.05);
          }
        }
      }
    }
  });

  it("the Golden Age king stands about as tall on screen as the Classic king (his plate fits over him on a phone)", () => {
    for (const camSide of [1, -1]) {
      const golden = topOf(build(ARABIC_LOOK, "golden", true, camSide, 0), camSide);
      const classic = topOf(build(LOOKS.meadow, "classic", true, camSide, 0), camSide);
      // At most 0.3 local units (about 8 CSS px on a 390 px phone) over the Classic king.
      expect(golden - classic).toBeLessThanOrEqual(0.3);
    }
  });

  it("stage 1 knocks out the camera row's middle merlon (in view, over the banner)", () => {
    for (const camSide of [1, -1]) {
      const k = build(LOOKS.meadow, "classic", false, camSide, 0);
      expect(k.chips[1]).toHaveLength(1);
      expect(k.chips[1][0].x).toBeCloseTo(0, 6);
      expect(k.chips[1][0].z * camSide).toBeGreaterThan(0);
    }
  });

  it("the ruin leaves a scorched ring on the ground past its paving", () => {
    const R = 0.95;
    const ruin = craftRuin({ king: false, radius: R, team: 0xe53935, enemyTeam: true, camSide: 1, style: towerStyle(LOOKS.meadow, "classic"), seed: 5 });
    const p = ruin.stump.geometry.getAttribute("position");
    let far = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05 && Math.hypot(p.getX(i), p.getZ(i)) > R * 1.9) far++;
    expect(far).toBeGreaterThan(20);
  });
});

describe("flair tiers", () => {
  it("0 plain, 1 gilded trim and finials, 2 adds the jewel crest and gold roof bands", () => {
    expect(towerFlair(0)).toEqual({ tier: 0, gildedTrim: false, gildedFinials: false, jewelCrest: false, goldRoofBands: false });
    expect(towerFlair(1)).toEqual({ tier: 1, gildedTrim: true, gildedFinials: true, jewelCrest: false, goldRoofBands: false });
    expect(towerFlair(2)).toEqual({ tier: 2, gildedTrim: true, gildedFinials: true, jewelCrest: true, goldRoofBands: true });
    expect(towerFlair(7).tier).toBe(2);
    expect(towerFlair(-1).tier).toBe(0);
    expect(towerFlair(Number.NaN).tier).toBe(0);
  });
});

describe("damage stages", () => {
  it("turn at 70% and 40% HP", () => {
    expect(DAMAGE_STAGE_1).toBe(0.7);
    expect(DAMAGE_STAGE_2).toBe(0.4);
    expect(towerDamageStage(1000, 1000)).toBe(0);
    expect(towerDamageStage(700, 1000)).toBe(0);
    expect(towerDamageStage(699, 1000)).toBe(1);
    expect(towerDamageStage(400, 1000)).toBe(1);
    expect(towerDamageStage(399, 1000)).toBe(2);
    expect(towerDamageStage(1, 1000)).toBe(2);
    expect(towerDamageStage(0, 0)).toBe(2);
  });
});

describe("HP plate maths", () => {
  const top = 4.2;
  const foot = -1.4;
  const half = 0.3;
  const ppu = 23; // CSS px per local unit on a 390 px phone
  const clear = PLATE_CLEAR_PX / ppu;

  it("screen-up rises with height and falls toward the camera", () => {
    expect(screenUp(1, 0, 1)).toBeGreaterThan(0);
    expect(screenUp(0, 1, 1)).toBeLessThan(0);
    expect(screenUp(0, 1, -1)).toBeGreaterThan(0); // the guest looks from -z
  });

  it("puts far plates above the tallest tip and near plates under the foot, clear by 4 px", () => {
    const far = platePlacement(top, foot, half, clear, true);
    const near = platePlacement(top, foot, half, clear, false);
    expect(far.above).toBe(true);
    expect(near.above).toBe(false);
    expect(plateClearancePx(far, top, foot, half, ppu)).toBeCloseTo(PLATE_CLEAR_PX, 6);
    expect(plateClearancePx(near, top, foot, half, ppu)).toBeCloseTo(PLATE_CLEAR_PX, 6);
  });

  it("keeps a plate that fits, flips one that would leave the screen, pins one that fits nowhere", () => {
    const want = platePlacement(top, foot, half, clear, true);
    expect(clampPlate(want, top, foot, half, clear, 20, -20)).toEqual(want);
    // A squat screen: no room above the far king, room under him.
    const flipped = clampPlate(want, top, foot, half, clear, top + 0.3, -10);
    expect(flipped.above).toBe(false);
    expect(plateClearancePx(flipped, top, foot, half, ppu)).toBeGreaterThanOrEqual(PLATE_CLEAR_PX - 1e-6);
    // No room on either side: pinned inside the screen.
    const pinned = clampPlate(want, top, foot, half, clear, top + 0.3, foot + 0.1);
    expect(pinned.s + half).toBeLessThanOrEqual(top + 0.3 + 1e-9);
  });
});
