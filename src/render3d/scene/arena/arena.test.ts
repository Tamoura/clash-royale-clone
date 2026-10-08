import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, towerSpots } from "../../../game/arena";
import { BACKDROP_KINDS, ISLAMIC_LOOKS, LOOKS, type ArenaLook } from "../../arenaLooks";
import { AMBIENT_COUNT, buildAmbient, updateAmbient } from "./ambient";
import { buildBackdrop, screenU, yForScreen } from "./backdrop";
import {
  clearGroundCache,
  groundImage,
  groundPainter,
  imageHash,
  luminanceAt,
} from "./groundPaint";
import { KIT_TRIANGLE_BUDGET, buildKit } from "./kits";
import { LightPools, NIGHT_NATIVE_FLOOR, poolIntensity } from "./lightPools";

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
