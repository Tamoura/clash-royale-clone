import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, towerSpots } from "../../../game/arena";
import { BACKDROP_KINDS, ISLAMIC_LOOKS, LOOKS, stagePalette, type ArenaLook } from "../../arenaLooks";
import { AMBIENT_COUNT, buildAmbient, updateAmbient } from "./ambient";
import { buildBackdrop, farGroundMaterial, screenU, yForScreen } from "./backdrop";
import {
  clearGroundCache,
  groundImage,
  groundPainter,
  imageHash,
  luminanceAt,
} from "./groundPaint";
import { KIT_TRIANGLE_BUDGET, buildKit } from "./kits";
import { FLOOR_RECIPES, floorRecipe } from "./groundPaint";
import { buildClassicScenery, OUTER_THEMES, orientSurround } from "./scenery";
import { LOT_GAP, buildGoldenSurround, townLots, townPalette } from "./golden";
import { ICE_BRIDGE, buildClassicBridges } from "./bridges";
import { buildRiver } from "./river";
import { buildTufts } from "./tufts";
import { makeCrowd, orientSeats, poseCrowd } from "./crowd";
import { LightPools, NIGHT_NATIVE_FLOOR, poolIntensity } from "./lightPools";
import { toon } from "../../characters3d";
import { setViewSide } from "../common";
import { tone } from "../views/towerCraft";
import { towerTeamColors } from "../views/towers";
import { setPrefs } from "../../../ui/prefs";
import type { Side } from "../../../game/arena";

const ALL: ArenaLook[] = [...Object.values(LOOKS), ...Object.values(ISLAMIC_LOOKS)];
const lookWith = (kind: string): ArenaLook => ALL.find((l) => l.backdrop === kind)!;
const glow = (c: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c });

describe("backdrop kits", () => {
  it.each(BACKDROP_KINDS.map((k) => [k]))("%s stays within its triangle budget", (kind) => {
    const kit = buildKit(kind, lookWith(kind));
    expect(kit.triangles).toBeGreaterThan(100);
    expect(kit.triangles).toBeLessThanOrEqual(KIT_TRIANGLE_BUDGET);
  });

  it.each(ALL.map((l) => [l.id, l] as const))("%s keeps every prop off the field", (_id, look) => {
    const bd = buildBackdrop(look, glow);
    for (const p of bd.kit.props) {
      const inside = Math.abs(p.x) < 9 && Math.abs(p.z) < 16;
      if (inside) expect(p.tag, `${p.name} at (${p.x}, ${p.z})`).toBe("decor");
    }
    // Kit lights and seats stay out of the field too.
    for (const l of bd.lights) expect(Math.abs(l.x) >= 9 || Math.abs(l.z) >= 16).toBe(true);
    for (const s of bd.seats) expect(Math.abs(s.z)).toBeGreaterThanOrEqual(16);
  });

  it("the foreground lip stays low enough to never cover the player king", () => {
    const king = towerSpots("player").find((t) => t.kind === "king")!;
    const kingBaseU = screenU(0, king.y - ARENA_HEIGHT / 2);
    for (const look of ALL) {
      const bd = buildBackdrop(look, glow);
      const geo = bd.solid!.geometry;
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) < 16.5) continue;
        expect(screenU(pos.getY(i), pos.getZ(i))).toBeLessThan(kingBaseU);
      }
    }
  });

  it("turns the set for the online guest and keeps its banners in the far king's colours", () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const hue = (c: THREE.Color): number => c.getHSL(hsl).h;
    try {
      for (const palette of ["default", "cb"] as const) {
        setPrefs({ teamPalette: palette });
        const bd = buildBackdrop(LOOKS.meadow, glow);
        const colors = bd.solid!.geometry.getAttribute("color");
        const [start] = bd.kit.team[0];
        for (const view of ["player", "enemy"] as const) {
          setViewSide(view);
          bd.orient(view);
          expect(bd.group.rotation.y).toBeCloseTo(view === "player" ? 0 : Math.PI);
          // The far king is the viewer's opponent: the sim's enemy for the
          // host, its player for the guest. His banners wear his cloth.
          const farKing = towerTeamColors(view === "player" ? "enemy" : "player");
          const banner = new THREE.Color(colors.getX(start), colors.getY(start), colors.getZ(start));
          expect(hue(banner), `${palette} ${view}`).toBeCloseTo(hue(new THREE.Color(farKing.cloth)), 2);
        }
      }
    } finally {
      setViewSide("player");
      setPrefs({ teamPalette: "default" });
    }
  });

  it("screen placement helpers invert each other", () => {
    expect(screenU(yForScreen(18.2, -27), -27)).toBeCloseTo(18.2, 6);
  });
});

describe("light pools", () => {
  it("are dark by day and fully lit at night", () => {
    expect(poolIntensity(0)).toBe(0);
    expect(poolIntensity(1)).toBe(1);
    expect(poolIntensity(0.5)).toBeGreaterThan(0);
    expect(poolIntensity(0.5)).toBeLessThan(1);
  });

  it("night-native sets are lit from the start", () => {
    expect(poolIntensity(0, true)).toBe(NIGHT_NATIVE_FLOOR);
    expect(poolIntensity(1, true)).toBe(1);
  });

  it("hide by day and show at night", () => {
    const pools = new LightPools([{ x: 0, y: 1, z: -18, color: 0xffc46b, radius: 2 }], false);
    expect(pools.update(0, undefined)).toBe(0);
    expect(pools.group.children.every((m) => !m.visible)).toBe(true);
    expect(pools.update(1, undefined)).toBe(1);
    expect(pools.group.children.every((m) => m.visible)).toBe(true);
  });
});

describe("ground paint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearGroundCache();
  });

  it("is byte-identical run to run", () => {
    const a = groundPainter.paint(LOOKS.meadow, false);
    const b = groundPainter.paint(LOOKS.meadow, false);
    expect(imageHash(a)).toBe(imageHash(b));
    expect(a.width).toBe(ARENA_WIDTH * a.pxPerUnit);
    expect(a.height).toBe(ARENA_HEIGHT * a.pxPerUnit);
  });

  it("differs per look", () => {
    expect(imageHash(groundPainter.paint(LOOKS.meadow, false))).not.toBe(
      imageHash(groundPainter.paint(LOOKS.jungle, false)),
    );
  });

  it.each([
    ["classic meadow", LOOKS.meadow, false],
    ["classic forge", LOOKS.forge, false],
    ["islamic souk", ISLAMIC_LOOKS.souk, true],
  ] as const)("bakes occlusion under all six towers (%s)", (_n, look, islamic) => {
    const img = groundPainter.paint(look, islamic);
    for (const side of ["player", "enemy"] as const) {
      for (const t of towerSpots(side)) {
        // A free tile 4 units away, diagonally clear of lanes and rows.
        const dx = t.x < ARENA_WIDTH / 2 ? 2.83 : -2.83;
        const dy = t.y < ARENA_HEIGHT / 2 ? 2.83 : -2.83;
        expect(luminanceAt(img, t.x, t.y)).toBeLessThan(luminanceAt(img, t.x + dx, t.y + dy));
      }
    }
  });

  it("serves a repeat paint of the same look from the cache", () => {
    const spy = vi.spyOn(groundPainter, "paint");
    const a = groundImage(ISLAMIC_LOOKS.oasis, true);
    const b = groundImage(ISLAMIC_LOOKS.oasis, true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });
});

describe("ambient weather", () => {
  it("builds 20-60 particles for every look with weather", () => {
    for (const look of ALL) {
      const a = buildAmbient(look, 7);
      if (look.ambient === "none") {
        expect(a).toBeNull();
        continue;
      }
      expect(a!.count).toBeGreaterThanOrEqual(20);
      expect(a!.count).toBeLessThanOrEqual(60);
      expect(a!.count).toBe(Math.max(20, Math.min(60, AMBIENT_COUNT[look.ambient])));
    }
  });

  it("updates without allocating or re-uploading anything", () => {
    const a = buildAmbient(LOOKS.snow, 7)!;
    const u = a.material.uniforms;
    const before = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.value]));
    const versions = Object.values(a.points.geometry.attributes).map((at) => (at as THREE.BufferAttribute).version);
    const spies = [
      vi.spyOn(THREE.Color.prototype, "clone"),
      vi.spyOn(THREE.Vector3.prototype, "clone"),
      vi.spyOn(THREE.BufferAttribute.prototype, "clone"),
      vi.spyOn(THREE.Material.prototype, "clone"),
    ];
    for (let i = 0; i < 1000; i++) updateAmbient(a, i / 60, 40, i % 2 === 0);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    // Uniform objects are mutated in place, never replaced.
    for (const [k, v] of Object.entries(before)) {
      if (typeof v === "object") expect(u[k].value).toBe(v);
    }
    expect(Object.values(a.points.geometry.attributes).map((at) => (at as THREE.BufferAttribute).version)).toEqual(versions);
    expect(a.material.version).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("toy tournament stage (all 22 looks)", () => {
  afterEach(() => clearGroundCache());

  const classic = Object.values(LOOKS);
  const golden = Object.values(ISLAMIC_LOOKS);

  /** Mean luminance of each whole tile of open turf, split by checker parity. */
  function parityMeans(look: ArenaLook, islamic: boolean): [number, number] {
    const img = groundPainter.paint(look, islamic);
    const sums = [0, 0];
    const counts = [0, 0];
    for (let ty = 1; ty < ARENA_HEIGHT - 1; ty++) {
      for (let tx = 1; tx < ARENA_WIDTH - 1; tx++) {
        // Skip tiles that hold lanes, banks or aprons: sample open floor only.
        if (Math.abs(ty + 0.5 - 16) < 2.2 || Math.abs(tx + 0.5 - 3.5) < 1.6 || Math.abs(tx + 0.5 - 14.5) < 1.6) continue;
        if (Math.abs(ty + 0.5 - 6.5) < 2.4 || Math.abs(ty + 0.5 - 25.5) < 2.4 || ty < 5 || ty > 26) continue;
        let sum = 0;
        for (let k = 0; k < 16; k++) sum += luminanceAt(img, tx + 0.125 + (k % 4) * 0.25, ty + 0.125 + Math.floor(k / 4) * 0.25);
        const par = (tx + ty) & 1;
        sums[par] += sum / 16;
        counts[par]++;
      }
    }
    return [sums[0] / counts[0], sums[1] / counts[1]];
  }

  it.each(classic.map((l) => [l.id, l] as const))("%s floor has no checkerboard", (_id, look) => {
    const [even, odd] = parityMeans(look, false);
    // The old painter's checker was a +-4.5% swing; tiles now differ by noise only.
    expect(Math.abs(even - odd) / ((even + odd) / 2)).toBeLessThan(0.012);
  });

  it("every classic look has its own floor recipe", () => {
    for (const look of classic) expect(FLOOR_RECIPES[look.id]).toBe(floorRecipe(look));
    expect(new Set(classic.map((l) => floorRecipe(l))).size).toBe(11);
  });

  /** Mean painted luma (sRGB) over 0.5-tile patches at fixed points. */
  function patchLuma(img: ReturnType<typeof groundPainter.paint>, pts: readonly (readonly [number, number])[]): number {
    let sum = 0;
    for (const [x, y] of pts) {
      for (let k = 0; k < 25; k++) sum += luminanceAt(img, x - 0.25 + (k % 5) * 0.125, y - 0.25 + Math.floor(k / 5) * 0.125);
    }
    return sum / (pts.length * 25);
  }
  const FIELD_PTS = [[9, 10.5], [9, 21.5], [6.5, 11.5], [11.5, 20.5], [7, 22], [11, 10]] as const;
  const LANE_PTS = [[3.5, 10.5], [14.5, 21.5], [3.5, 21], [14.5, 11]] as const;

  it.each(ALL.map((l) => [`${l.islamic ? "golden" : "classic"} ${l.id}`, l] as const))(
    "%s keeps a mid-value court with lanes that read",
    (_id, look) => {
      // Calm floor, loud actors: a near-white court sinks white and cream
      // units and erases the lanes (snow, neon and the Golden Age courts
      // painted 0.83-0.93). The lit court reads about 1.09x its paint on
      // screen, so the paint stays at or under 0.65 (screen 0.70 at most)
      // and the lanes sit at least 0.06 away from it, darker or lighter.
      const img = groundPainter.paint(look, !!look.islamic);
      const field = patchLuma(img, FIELD_PTS);
      const lane = patchLuma(img, LANE_PTS);
      expect(field).toBeLessThanOrEqual(0.65);
      expect(Math.abs(field - lane)).toBeGreaterThanOrEqual(0.06);
    },
  );

  it("gives each Golden Age court its own floor, the night courts about 30% darker", () => {
    expect(new Set(golden.map((l) => l.islamic!.plaster)).size).toBe(golden.length);
    const fieldOf = (l: ArenaLook): number => patchLuma(groundPainter.paint(l, true), FIELD_PTS);
    const night = golden.filter((l) => l.nightPools).map(fieldOf);
    const day = golden.filter((l) => !l.nightPools).map(fieldOf);
    expect(night.length).toBe(3);
    // The court shares the night town's exposure instead of a noon grade.
    expect(Math.max(...night)).toBeLessThan(Math.min(...day) * 0.85);
  });

  it.each(classic.map((l) => [l.id, l] as const))("%s builds its surround, bridges, river and crowd", (_id, look) => {
    const parent = new THREE.Group();
    const seats = buildClassicScenery(parent, look);
    expect(seats.length).toBeGreaterThan(120);
    const names = parent.children.map((c) => c.name);
    expect(names).toContain("classic-scenery");
    expect(names.filter((n) => n === "classic-forest")).toHaveLength(2);
    expect(names.filter((n) => n === "outer-ring")).toHaveLength(2);
    expect(OUTER_THEMES[look.id]).toBeDefined();
    const bridges = buildClassicBridges(parent, look, () => new THREE.MeshBasicMaterial());
    if (look.band.bridge !== "timber") expect(bridges.length).toBeGreaterThan(0);
    const river = buildRiver(parent, look);
    expect(river.mesh.name).toBe("river");
    const crowd = makeCrowd(seats)!;
    expect(crowd.bodies.count).toBe(seats.length);
    poseCrowd(crowd, 1.2, 1, 1, 1);
    // The forest and outer ring never cast: the per-frame shadow pass skips them.
    for (const c of parent.children) if (c.userData.dressing) expect((c as THREE.Mesh).castShadow).toBe(false);
  });

  it.each(golden.map((l) => [l.id, l] as const))("%s builds its galleries, town and canal", (_id, look) => {
    const parent = new THREE.Group();
    const seats = buildGoldenSurround(parent, look);
    expect(seats.length).toBeGreaterThan(80);
    const names = parent.children.map((c) => c.name);
    expect(names).toContain("golden-galleries");
    expect(names.filter((n) => n === "golden-town")).toHaveLength(2);
    expect(names.filter((n) => n === "golden-palms")).toHaveLength(2);
    expect(buildRiver(parent, look).mesh.name).toBe("river");
    expect(buildTufts(look)).toBeNull();
    const img = groundPainter.paint(look, true);
    expect(img.width).toBe(ARENA_WIDTH * img.pxPerUnit);
  });

  it.each(golden.map((l) => [l.id, l] as const))("%s lamps its town when given the glow material", (_id, look) => {
    const parent = new THREE.Group();
    buildGoldenSurround(parent, look, glow);
    const lamps = parent.children.filter((c) => c.name === "golden-town-lamps") as THREE.Mesh[];
    expect(lamps).toHaveLength(2);
    for (const m of lamps) {
      expect(m.userData.dressing).toBe("outer");
      expect(m.castShadow).toBe(false);
    }
  });

  it("lays the Golden Age town out with no overlapping houses and none on the canal", () => {
    for (const seed of [1, 7, 7918, 7920, 31337]) {
      for (const sx of [-1, 1]) {
        let a = seed >>> 0;
        const rand = (): number => {
          a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
          return a / 4294967296;
        };
        const lots = townLots(sx, rand);
        expect(lots.length).toBeGreaterThanOrEqual(10);
        for (const [i, p] of lots.entries()) {
          expect(Math.sign(p.x)).toBe(sx);
          expect(Math.abs(p.z) - p.hd).toBeGreaterThan(1.7);
          for (const q of lots.slice(i + 1)) {
            const apart = Math.abs(p.x - q.x) >= p.hw + q.hw + LOT_GAP || Math.abs(p.z - q.z) >= p.hd + q.hd + LOT_GAP;
            expect(apart, `lots at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) and (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`).toBe(true);
          }
        }
      }
    }
  });

  it("tints the town per look, and never paints bright cubes on the night sets or white walls on snow", () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const light = (c: number): number => new THREE.Color(c).getHSL(hsl).l;
    const firstWalls = new Set(golden.map((l) => townPalette(l).walls[0]));
    expect(firstWalls.size).toBeGreaterThanOrEqual(10);
    for (const look of golden) {
      const pal = townPalette(look);
      expect(pal.walls.length).toBeGreaterThanOrEqual(3);
      for (const w of pal.walls) {
        // Walls stand apart from the apron they sit on.
        expect(Math.abs(light(w) - light(look.apron)), look.id).toBeGreaterThan(0.08);
        if (look.nightPools) expect(light(w), look.id).toBeLessThan(0.35); // the old whitewash: 0.75
      }
      expect(pal.glass).toBe(look.nightPools ? 0xffc46b : 0x2a3a5a);
    }
  });

  it("continues the sand apron into the far ground in the Golden Age (no green lawn corners)", () => {
    for (const look of golden) {
      const far = farGroundMaterial(look);
      expect(far.color.getHex(), look.id).toBe(toon(look.apron).color.getHex());
    }
    for (const look of classic) expect(farGroundMaterial(look).color.getHex()).toBe(new THREE.Color(look.far).getHex());
  });

  it("builds ice bridges that read on white: a blue deck and blue-grey kerbs and posts", () => {
    const hsl = { h: 0, s: 0, l: 0 };
    // The snow court is packed blue-grey snow now; the bridge lands on the white banks.
    const snowBank = new THREE.Color(stagePalette(LOOKS.snow).bankNear).getHSL(hsl).l;
    const deck = new THREE.Color(ICE_BRIDGE.deck);
    expect(deck.getHSL(hsl).l).toBeLessThan(snowBank - 0.2);
    expect(deck.b).toBeGreaterThan(deck.r * 1.4);
    for (const c of [ICE_BRIDGE.kerb, ICE_BRIDGE.post, ICE_BRIDGE.body]) expect(new THREE.Color(c).getHSL(hsl).l).toBeLessThan(0.3);
    const parent = new THREE.Group();
    const meshes = buildClassicBridges(parent, LOOKS.snow, glow);
    expect(meshes.map((m) => m.name)).toEqual(["ice-bridges"]);
  });

  it("grows tufts on the grassy floors only", () => {
    expect(buildTufts(LOOKS.meadow)!.count).toBeGreaterThan(200);
    expect(buildTufts(LOOKS.forge)).toBeNull();
    expect(buildTufts(LOOKS.neon)).toBeNull();
  });

  it("biases each half's crowd toward its team colour", () => {
    const seats = Array.from({ length: 200 }, (_, i) => ({ x: i, z: -5, y: 1, face: 0, side: "enemy" as const }));
    const crowd = makeCrowd(seats)!;
    const c = new THREE.Color();
    let reds = 0;
    for (let i = 0; i < 200; i++) {
      crowd.bodies.getColorAt(i, c);
      if (c.r > c.g * 1.6 && c.r > c.b * 1.6) reds++;
    }
    expect(reds).toBeGreaterThan(50);
  });
});

describe("the ring wears the viewer's colours (online guest, ?viewpoint=enemy)", () => {
  /**
   * The team tones a stand built for `cloth` paints (scenery.ts setTeam and
   * what the stands derive from it), as chromaticity: a vertex's colour is
   * one of them times its baked shading.
   */
  const tones = (cloth: number): number[][] => {
    const base = tone(cloth, 0.92, 0.95);
    return [base, tone(base, 0.9), tone(base, 0.72), tone(base, 0.7), tone(base, 1.18, 0.9)].map((hex) => {
      const c = new THREE.Color(hex);
      const m = Math.max(c.r, c.g, c.b);
      return [c.r / m, c.g / m, c.b / m];
    });
  };
  const wears = (r: number, g: number, b: number, set: number[][]): boolean => {
    const m = Math.max(r, g, b);
    if (m < 0.02) return false;
    return set.some(([tr, tg, tb]) => Math.abs(r / m - tr) < 0.015 && Math.abs(g / m - tg) < 0.015 && Math.abs(b / m - tb) < 0.015);
  };
  /** Team-toned vertices of every sculpt under `root`, per end of the court (far/near from `view`'s camera). */
  const census = (root: THREE.Object3D, view: Side): Record<"far" | "near", Record<"opp" | "own", number>> => {
    const farKing = towerTeamColors(view === "player" ? "enemy" : "player").cloth;
    const nearKing = towerTeamColors(view).cloth;
    const opp = tones(farKing);
    const own = tones(nearKing);
    const out = { far: { opp: 0, own: 0 }, near: { opp: 0, own: 0 } };
    const camZ = view === "player" ? 1 : -1;
    const v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const col = mesh.isMesh ? (mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined) : undefined;
      if (!col) return;
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.z) < 1) continue; // the river mouths
        const end = v.z * camZ < 0 ? out.far : out.near;
        const [r, g, b] = [col.getX(i), col.getY(i), col.getZ(i)];
        if (wears(r, g, b, opp)) end.opp++;
        else if (wears(r, g, b, own)) end.own++;
      }
    });
    return out;
  };
  const cases: [string, (parent: THREE.Object3D) => unknown][] = [
    ["Classic meadow", (p) => buildClassicScenery(p, LOOKS.meadow)],
    ["Golden Age", (p) => buildGoldenSurround(p, Object.values(ISLAMIC_LOOKS)[0])],
  ];
  for (const palette of ["default", "cb"] as const) {
    for (const [name, build] of cases) {
      it(`${name} (${palette} palette): the far stands in the far king's cloth, the near ones in the viewer's`, () => {
        try {
          setPrefs({ teamPalette: palette });
          for (const view of ["player", "enemy"] as const) {
            setViewSide(view);
            const surround = new THREE.Group();
            build(surround);
            orientSurround(surround, view);
            const n = census(surround, view);
            expect(n.far.opp, `${view}: far stands in the opponent's colours`).toBeGreaterThan(200);
            expect(n.near.own, `${view}: near stands in the viewer's colours`).toBeGreaterThan(200);
            expect(n.far.own, `${view}: none of the viewer's colours at the far end`).toBe(0);
            expect(n.near.opp, `${view}: none of the opponent's colours at the near end`).toBe(0);
          }
        } finally {
          setViewSide("player");
          setPrefs({ teamPalette: "default" });
        }
      });
    }
  }

  it("the crowd turns with its stands: the opponent's fans at the far end, facing the court", () => {
    const parent = new THREE.Group();
    const seats = buildClassicScenery(parent, LOOKS.meadow);
    const home = seats.map((st) => ({ x: st.x, z: st.z, face: st.face }));
    for (const view of ["player", "enemy"] as const) {
      orientSeats(seats, home, view);
      const camZ = view === "player" ? 1 : -1;
      for (const [i, seat] of seats.entries()) {
        // Shirts follow seat.side in the sim's terms; "enemy" fans wear the
        // red the far king wears for the host, and for the guest the far
        // king is the host, whom the guest sees in red as well.
        expect(seat.z * camZ < 0, `seat ${i}`).toBe(seat.side === "enemy");
        // Facing the court: toward x = 0.
        expect(Math.sin(seat.face) * Math.sign(seat.x), `seat ${i}`).toBeLessThan(0);
      }
    }
  });
});
