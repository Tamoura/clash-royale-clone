import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, towerSpots } from "../../../game/arena";
import { BACKDROP_KINDS, ISLAMIC_LOOKS, LOOKS, type ArenaLook } from "../../arenaLooks";
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
import { buildClassicScenery, OUTER_THEMES } from "./scenery";
import { LOT_GAP, buildGoldenSurround, townLots, townPalette } from "./golden";
import { ICE_BRIDGE, buildClassicBridges } from "./bridges";
import { buildRiver } from "./river";
import { buildTufts } from "./tufts";
import { makeCrowd, poseCrowd } from "./crowd";
import { LightPools, NIGHT_NATIVE_FLOOR, poolIntensity } from "./lightPools";
import { toon } from "../../characters3d";

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

  it("turns the set and recolours its banners for the online guest", () => {
    const bd = buildBackdrop(LOOKS.meadow, glow);
    const colors = bd.solid!.geometry.getAttribute("color");
    const [start] = bd.kit.team[0];
    bd.orient("player");
    const red = colors.getX(start);
    bd.orient("enemy");
    expect(bd.group.rotation.y).toBeCloseTo(Math.PI);
    expect(colors.getX(start)).toBeLessThan(red); // red banners became blue
    expect(colors.getZ(start)).toBeGreaterThan(colors.getX(start));
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
    const snowFloor = new THREE.Color(LOOKS.snow.floor.b).getHSL(hsl).l;
    const deck = new THREE.Color(ICE_BRIDGE.deck);
    expect(deck.getHSL(hsl).l).toBeLessThan(snowFloor - 0.2);
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
