import { describe, expect, it } from "vitest";
import { ARENAS } from "./arenas";
import {
  FEATURES,
  FEATURE_ARENA,
  FEATURE_LABEL,
  SEEN_UNLOCKS_KEY,
  featureArena,
  featureUnlocked,
  isNew,
  loadSeen,
  markSeen,
  markToasted,
  modeFeature,
  parseSeen,
  pendingToasts,
  reachedArenaIndex,
  unlockedFeatures,
  type SeenStorage,
} from "./unlocks";

function memStorage(init: Record<string, string> = {}): SeenStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("feature unlock thresholds", () => {
  it("opens each feature at its arena", () => {
    expect(FEATURE_ARENA).toEqual({
      sandbox: 1,
      challenges: 1,
      towerTroops: 2,
      abilities: 3,
      triple: 4,
      mirror: 4,
      mega: 5,
      crazy: 5,
      draft: 5,
    });
    for (const f of FEATURES) {
      expect(featureUnlocked(f, featureArena(f) - 1)).toBe(false);
      expect(featureUnlocked(f, featureArena(f))).toBe(true);
      expect(featureUnlocked(f, ARENAS.length - 1)).toBe(true);
    }
  });

  it("locks everything on a fresh profile; Crazy and Draft need arena 5", () => {
    expect(unlockedFeatures(0)).toEqual([]);
    expect(featureUnlocked("crazy", 0)).toBe(false);
    expect(featureUnlocked("draft", 0)).toBe(false);
    expect(featureArena("crazy")).toBe(5);
    expect(featureArena("draft")).toBe(5);
  });

  it("lists features in a stable order as arenas rise", () => {
    expect(unlockedFeatures(1)).toEqual(["sandbox", "challenges"]);
    expect(unlockedFeatures(3)).toEqual(["sandbox", "challenges", "towerTroops", "abilities"]);
    expect(unlockedFeatures(5)).toEqual(FEATURES);
  });

  it("maps game modes to their features", () => {
    expect(modeFeature("classic")).toBeNull();
    expect(modeFeature("sandbox")).toBe("sandbox");
    expect(modeFeature("triple")).toBe("triple");
    expect(modeFeature("mega")).toBe("mega");
    expect(modeFeature("mirror")).toBe("mirror");
    expect(modeFeature("crazy")).toBe("crazy");
    expect(modeFeature("nonsense")).toBeNull();
  });

  it("keeps features open after trophies drop below the gate", () => {
    const gate = ARENAS[5].trophies;
    expect(reachedArenaIndex(gate - 50, gate + 10)).toBe(5);
    expect(reachedArenaIndex(0, 0)).toBe(0);
    expect(reachedArenaIndex(ARENAS[2].trophies)).toBe(2);
  });

  it("has a label in both languages for every feature", () => {
    for (const f of FEATURES) {
      const [en, ar] = FEATURE_LABEL[f];
      expect(en.length).toBeGreaterThan(0);
      expect(ar).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("seen unlocks (toast + NEW badge)", () => {
  it("seeds an old save with everything it already has", () => {
    const s = parseSeen(null, 4);
    expect(s.toasted).toEqual(unlockedFeatures(4));
    expect(pendingToasts(s, 4)).toEqual([]);
    expect(FEATURES.some((f) => isNew(f, s, 4))).toBe(false);
    // ...but the arena-5 features still arrive as new.
    expect(pendingToasts(s, 5)).toEqual(["mega", "crazy", "draft"]);
    expect(isNew("draft", s, 5)).toBe(true);
  });

  it("seeds a fresh profile empty, so later unlocks toast once", () => {
    let s = parseSeen(null, 0);
    expect(s).toEqual({ toasted: [], seen: [] });
    expect(pendingToasts(s, 1)).toEqual(["sandbox", "challenges"]);
    s = markToasted(s, pendingToasts(s, 1));
    expect(pendingToasts(s, 1)).toEqual([]);
    expect(isNew("challenges", s, 1)).toBe(true);
    s = markSeen(s, ["challenges"], 1);
    expect(isNew("challenges", s, 1)).toBe(false);
    expect(isNew("sandbox", s, 1)).toBe(true);
  });

  it("never marks a locked feature as seen", () => {
    const s = markSeen({ toasted: [], seen: [] }, ["draft", "sandbox"], 1);
    expect(s.seen).toEqual(["sandbox"]);
    expect(isNew("draft", s, 5)).toBe(true);
  });

  it("drops unknown and corrupt entries", () => {
    expect(parseSeen('{"toasted":["crazy","bogus",3],"seen":"x"}', 0)).toEqual({ toasted: ["crazy"], seen: [] });
    expect(parseSeen("not json", 1).toasted).toEqual(["sandbox", "challenges"]);
  });

  it("persists the seed on first load and round-trips", () => {
    const st = memStorage();
    const s = loadSeen(st, 2);
    expect(JSON.parse(st.data[SEEN_UNLOCKS_KEY])).toEqual(s);
    const again = loadSeen(st, 5);
    expect(again).toEqual(s);
    expect(pendingToasts(again, 5)).toEqual(["abilities", "triple", "mirror", "mega", "crazy", "draft"]);
  });

  it("survives storage that throws", () => {
    const bad: SeenStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => loadSeen(bad, 3)).not.toThrow();
    expect(loadSeen(null, 0)).toEqual({ toasted: [], seen: [] });
  });
});
