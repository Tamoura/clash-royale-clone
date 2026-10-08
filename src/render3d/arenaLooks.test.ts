import { describe, expect, it } from "vitest";
import {
  AMBIENT_KINDS,
  BACKDROP_KINDS,
  BAND_KINDS,
  ISLAMIC_LOOKS,
  LOOKS,
  lookForArena,
  type ArenaLook,
} from "./arenaLooks";

const ALL: ArenaLook[] = [...Object.values(LOOKS), ...Object.values(ISLAMIC_LOOKS)];

describe("arena looks", () => {
  it("has 22 distinct looks, 11 per edition", () => {
    expect(Object.keys(LOOKS)).toHaveLength(11);
    expect(Object.keys(ISLAMIC_LOOKS)).toHaveLength(11);
    expect(new Set(ALL.map((l) => l.id)).size).toBe(22);
  });

  it.each(ALL.map((l) => [l.id, l] as const))("%s has a valid backdrop, ambient, band and sky", (_id, look) => {
    expect(BACKDROP_KINDS).toContain(look.backdrop);
    expect(AMBIENT_KINDS).toContain(look.ambient);
    expect(BAND_KINDS).toContain(look.band.kind);
    expect(typeof look.nightPools).toBe("boolean");
    for (const c of [look.skyTop, look.skyHorizon]) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("night-native sets are the souk, the medina and the copper citadel", () => {
    const night = ALL.filter((l) => l.nightPools).map((l) => l.id).sort();
    expect(night).toEqual(["copper", "medina", "souk"]);
  });

  it("lava glows in the forge and the copper citadel", () => {
    expect(LOOKS.forge.band.kind).toBe("lava");
    expect(ISLAMIC_LOOKS.copper.band.kind).toBe("lava");
  });

  it("every edition stages its own backdrops", () => {
    expect(lookForArena("training-camp").backdrop).toBe("castle");
    expect(lookForArena("barbarian-bowl", true).backdrop).toBe("minaret");
    expect(lookForArena("royal-arena", true).backdrop).toBe("alhambra");
  });
});
