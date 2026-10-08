import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import {
  DIFFICULTIES,
  DIFF_AR,
  DIFF_BLURB,
  HISTORY_SIZE,
  ROOKIE_MATCHES,
  autoTier,
  avgDeckLevel,
  botLevel,
  botLevels,
  AUTO_KEY,
  ensureAutoState,
  freshAutoState,
  loadAutoState,
  parseAutoState,
  recordAutoResult,
  resolveTier,
  type AutoState,
} from "./difficulty";

const diffs = (...d: number[]) => d.map((crownDiff) => ({ crownDiff }));

describe("difficulty options", () => {
  it("offers auto first, then every tier weakest to strongest", () => {
    expect(Object.keys(DIFFICULTIES)).toEqual(["auto", "rookie", "easy", "normal", "hard"]);
    for (const k of Object.keys(DIFFICULTIES)) {
      expect(DIFF_AR[k]).toBeTruthy();
      expect(DIFF_BLURB[k]).toHaveLength(2);
    }
  });

  it("keeps easy, normal and hard exactly as they were", () => {
    expect(DIFFICULTIES.easy).toEqual({ thinkInterval: 1.8, pushAt: 9 });
    expect(DIFFICULTIES.normal).toEqual({ thinkInterval: 1.0, pushAt: 8 });
    expect(DIFFICULTIES.hard).toEqual({ thinkInterval: 0.55, pushAt: 6 });
  });

  it("makes the rookie slow, sloppy and polite", () => {
    const r = DIFFICULTIES.rookie;
    expect(r.allowFinisher).toBe(false);
    expect(r.mistakeRate).toBe(0.35);
    expect(r.spellIQ).toBe(2);
    expect(r.pushAt).toBe(10);
    expect(r.thinkInterval).toBeGreaterThan(DIFFICULTIES.easy.thinkInterval);
  });
});

describe("autoTier", () => {
  it("plays rookie for the first ladder matches whatever happens", () => {
    for (let n = 0; n < ROOKIE_MATCHES; n++) {
      expect(autoTier(diffs(3, 3, 3), n, "hard")).toBe("rookie");
    }
  });

  it("steps up once the last three results add up to +3", () => {
    expect(autoTier(diffs(1, 1, 1), 5, "rookie")).toBe("easy");
    expect(autoTier(diffs(-3, 0, 3), 9, "easy")).toBe("easy"); // sums to 0
    expect(autoTier(diffs(3, 3, 3, 0, 1, 0), 9, "easy")).toBe("easy"); // only the last three count
    expect(autoTier(diffs(-3, 1, 1, 1), 9, "easy")).toBe("normal");
    expect(autoTier(diffs(3, 1, 0), 9, "normal")).toBe("hard");
    expect(autoTier(diffs(3, 3, 3), 9, "hard")).toBe("hard"); // already at the top
  });

  it("steps down at -3 or less", () => {
    expect(autoTier(diffs(-1, -1, -1), 9, "normal")).toBe("easy");
    expect(autoTier(diffs(-3, -3, -3), 9, "easy")).toBe("rookie");
    expect(autoTier(diffs(-3, -3, -3), 9, "rookie")).toBe("rookie"); // floor
    expect(autoTier(diffs(-1, -1), 9, "normal")).toBe("normal"); // needs three
  });

  it("records matches as a ring and starts a fresh window after a step", () => {
    let s: AutoState = freshAutoState(0);
    for (let i = 0; i < ROOKIE_MATCHES - 1; i++) s = recordAutoResult(s, 1);
    expect(s.tier).toBe("rookie");
    s = recordAutoResult(s, 1); // match 5: leaves the rookie window on +3
    expect(s.ladderMatches).toBe(ROOKIE_MATCHES);
    expect(s.tier).toBe("easy");
    expect(s.history).toEqual([]);
    s = recordAutoResult(s, 2);
    s = recordAutoResult(s, 0);
    expect(s.tier).toBe("easy");
    s = recordAutoResult(s, 1);
    expect(s.tier).toBe("normal");
    for (let i = 0; i < 8; i++) s = recordAutoResult(s, 0);
    expect(s.history).toHaveLength(HISTORY_SIZE);
  });

  it("resolves the auto option, and passes real tiers through", () => {
    const veteran: AutoState = { v: 1, ladderMatches: 40, tier: "hard", history: [] };
    expect(resolveTier("auto", freshAutoState(0))).toBe("rookie");
    expect(resolveTier("auto", veteran)).toBe("hard");
    expect(resolveTier("easy", veteran)).toBe("easy");
    expect(resolveTier("bogus", veteran)).toBe("normal");
  });

  it("seeds an existing profile where the old default left it", () => {
    expect(freshAutoState(0).tier).toBe("rookie");
    expect(freshAutoState(420).tier).toBe("normal");
    expect(freshAutoState(420).ladderMatches).toBeGreaterThanOrEqual(ROOKIE_MATCHES);
  });

  it("parses stored state defensively", () => {
    expect(parseAutoState(null, 0)).toEqual(freshAutoState(0));
    expect(parseAutoState("{oops", 0)).toEqual(freshAutoState(0));
    expect(parseAutoState(JSON.stringify({ ladderMatches: 3, tier: "mega", history: [] }), 0)).toEqual(
      freshAutoState(0),
    );
    const s = parseAutoState(
      JSON.stringify({ v: 1, ladderMatches: 7, tier: "easy", history: [{ crownDiff: 1 }, { crownDiff: "x" }, 4, 5, 6, 7, 8] }),
      0,
    );
    expect(s.tier).toBe("easy");
    expect(s.ladderMatches).toBe(7);
    expect(s.history.every((m) => Number.isFinite(m.crownDiff))).toBe(true);
    expect(s.history.length).toBeLessThanOrEqual(HISTORY_SIZE);
  });
});

describe("bot levels", () => {
  it("follows the deck average, shifted by tier", () => {
    expect(botLevel(5, "rookie")).toBe(3);
    expect(botLevel(5, "easy")).toBe(4);
    expect(botLevel(5, "normal")).toBe(5);
    expect(botLevel(5, "hard")).toBe(6);
    expect(botLevel(4.5, "normal")).toBe(5); // rounds half up
    expect(botLevel(4.4, "normal")).toBe(4);
  });

  it("clamps to 1..11", () => {
    expect(botLevel(1, "rookie")).toBe(1);
    expect(botLevel(2, "easy")).toBe(1);
    expect(botLevel(11, "hard")).toBe(11);
    expect(botLevel(10.6, "hard")).toBe(11);
  });

  it("is the same for every card, and the champion bonus stays capped", () => {
    const lv = botLevels(9, "normal");
    expect(new Set(Object.values(lv))).toEqual(new Set([9]));
    expect(new Set(Object.values(botLevels(9, "normal", 1)))).toEqual(new Set([10]));
    expect(new Set(Object.values(botLevels(11, "hard", 1)))).toEqual(new Set([11]));
  });

  it("averages a deck with missing levels as 1", () => {
    expect(avgDeckLevel(DEFAULT_DECK, {})).toBe(1);
    expect(avgDeckLevel(DEFAULT_DECK, { knight: 9 })).toBe(2);
    expect(avgDeckLevel([], {})).toBe(1);
  });
});

describe("ensureAutoState", () => {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", store);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("pins a brand-new profile to rookie so a tutorial payout cannot make it a veteran", () => {
    ensureAutoState(0);
    expect(mem.has(AUTO_KEY)).toBe(true);
    // the tutorial win grants trophies afterwards
    const s = loadAutoState(30);
    expect(s.tier).toBe("rookie");
    expect(s.ladderMatches).toBe(0);
    expect(resolveTier("auto", s)).toBe("rookie");
    // and a first ladder win stays in the rookie period
    const after = recordAutoResult(s, 3);
    expect(after.tier).toBe("rookie");
    expect(after.ladderMatches).toBe(1);
  });

  it("keeps a veteran (trophies or an older save) at their level", () => {
    ensureAutoState(420);
    expect(loadAutoState(420).tier).toBe("normal");
    mem.clear();
    ensureAutoState(0, true);
    expect(loadAutoState(0).tier).toBe("normal");
    expect(loadAutoState(0).ladderMatches).toBeGreaterThanOrEqual(ROOKIE_MATCHES);
  });

  it("never overwrites an existing record", () => {
    mem.set(AUTO_KEY, JSON.stringify({ v: 1, ladderMatches: 3, tier: "easy", history: [] }));
    ensureAutoState(500, true);
    expect(loadAutoState(500).tier).toBe("easy");
  });
});
