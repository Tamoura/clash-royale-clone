import { describe, expect, it } from "vitest";
import { ARENAS } from "../../meta/arenas";
import { FEATURES, featureArena } from "../../meta/unlocks";
import { difficultyKeys, lockArena, lockCaption } from "./battleSetup";

describe("lock captions name the arena and its trophies", () => {
  it("sandbox opens at Goblin Stadium (100)", () => {
    expect(lockArena("sandbox").trophies).toBe(100);
    expect(lockCaption("sandbox")).toEqual([`${ARENAS[1].name} · 100`, `${ARENAS[1].ar} · 100`]);
  });

  it("every feature maps to a real arena, never 'Arena N'", () => {
    for (const f of FEATURES) {
      const a = lockArena(f);
      expect(ARENAS).toContain(a);
      expect(a.trophies).toBe(ARENAS[featureArena(f)].trophies);
      const [en, ar] = lockCaption(f);
      expect(en).not.toMatch(/^Arena \d/);
      expect(en).toContain(String(a.trophies));
      expect(ar).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("difficulty options", () => {
  it("offer practice between auto and rookie", () => {
    const keys = difficultyKeys("auto");
    expect(keys.slice(0, 3)).toEqual(["auto", "practice", "rookie"]);
    expect(keys).toContain("hard");
  });
});
