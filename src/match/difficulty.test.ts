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
  outcomeFor,
  sampleOutcome,
  TIERS,
  type AutoState,
  type MatchSample,
} from "./difficulty";

const diffs = (...d: number[]) => d.map((crownDiff) => ({ crownDiff }));

describe("difficulty options", () => {
  it("offers auto first, then every tier weakest to strongest", () => {
    expect(Object.keys(DIFFICULTIES)).toEqual(["auto", "practice", "rookie", "easy", "normal", "hard"]);
    expect(TIERS).toEqual(["practice", "rookie", "easy", "normal", "hard"]);
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
    expect(r).toEqual({ thinkInterval: 6, pushAt: 10, mistakeRate: 0.45, allowFinisher: false, spellIQ: 2.5, reactionDelay: 1.8 });
    expect(r.thinkInterval).toBeGreaterThan(DIFFICULTIES.easy.thinkInterval);
  });

  it("makes practice softer than rookie on every knob", () => {
    const p = DIFFICULTIES.practice;
    const r = DIFFICULTIES.rookie;
    expect(p).toEqual({ thinkInterval: 8, pushAt: 10, mistakeRate: 0.6, allowFinisher: false, spellIQ: 3, reactionDelay: 2.5 });
    expect(p.thinkInterval).toBeGreaterThan(r.thinkInterval);
    expect(p.mistakeRate!).toBeGreaterThan(r.mistakeRate!);
    expect(p.reactionDelay!).toBeGreaterThan(r.reactionDelay!);
    expect(p.spellIQ!).toBeGreaterThan(r.spellIQ!);
    expect(DIFF_AR.practice).toBe("تمرين");
    expect(DIFF_BLURB.practice[0].length).toBeGreaterThan(0);
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
    expect(autoTier(diffs(-3, -3, -3), 9, "practice")).toBe("practice"); // floor
    expect(autoTier(diffs(-1, -1), 9, "normal")).toBe("normal"); // needs three
    expect(autoTier(diffs(-1, -1), 9, "hard")).toBe("hard");
  });
});

describe("auto step-down to practice and back", () => {
  const loss = (crownDiff = -1): MatchSample => ({ crownDiff, outcome: "loss" });
  const win = (crownDiff = 1): MatchSample => ({ crownDiff, outcome: "win" });

  it("two straight losses at rookie or easy drop one tier at once", () => {
    expect(autoTier([loss(), loss()], 2, "rookie")).toBe("practice"); // even in the first matches
    expect(autoTier([loss(), loss()], 9, "rookie")).toBe("practice");
    expect(autoTier([loss(), loss()], 9, "easy")).toBe("rookie");
    expect(autoTier([loss()], 2, "rookie")).toBe("rookie"); // one loss is not a streak
    expect(autoTier([loss(), win(), loss()], 9, "easy")).toBe("easy"); // not straight
  });

  it("counts a 0-0 tiebreak defeat as a loss", () => {
    expect(autoTier([loss(0), loss(0)], 1, "rookie")).toBe("practice");
    // Older saves have no outcome: the crown difference decides.
    expect(autoTier(diffs(-1, -2), 9, "easy")).toBe("rookie");
    expect(autoTier(diffs(0, 0), 9, "easy")).toBe("easy");
  });

  it("normal and hard keep the three-match window", () => {
    expect(autoTier([loss(), loss()], 9, "normal")).toBe("normal");
    expect(autoTier([loss(), loss(), loss()], 9, "normal")).toBe("easy");
  });

  it("a win at practice returns to rookie; other results stay", () => {
    expect(autoTier([win()], 2, "practice")).toBe("rookie");
    expect(autoTier([win(0)], 9, "practice")).toBe("rookie"); // a tiebreak win counts
    expect(autoTier([loss()], 2, "practice")).toBe("practice");
    expect(autoTier([loss(), loss(), loss()], 9, "practice")).toBe("practice");
    expect(autoTier([{ crownDiff: 0, outcome: "draw" }], 9, "practice")).toBe("practice");
  });

  it("the first matches never climb above rookie, but practice stays practice", () => {
    expect(autoTier([], 0, "practice")).toBe("practice");
    expect(autoTier([], 3, "easy")).toBe("rookie");
    expect(resolveTier("auto", { v: 1, ladderMatches: 2, tier: "practice", history: [] })).toBe("practice");
  });

  it("records the outcome and steps: rookie -> practice -> rookie", () => {
    let s = freshAutoState(0);
    s = recordAutoResult(s, -1, "loss");
    expect(s.tier).toBe("rookie");
    s = recordAutoResult(s, 0, "loss"); // a tiebreak defeat
    expect(s.tier).toBe("practice");
    expect(s.history).toEqual([]);
    expect(resolveTier("auto", s)).toBe("practice");
    s = recordAutoResult(s, -1, "loss");
    expect(s.tier).toBe("practice");
    s = recordAutoResult(s, 1, "win");
    expect(s.tier).toBe("rookie");
    expect(s.history).toEqual([]);
    expect(resolveTier("auto", s)).toBe("rookie");
  });

  it("outcomeFor reads the winner from my side", () => {
    expect(outcomeFor("player", "player")).toBe("win");
    expect(outcomeFor("enemy", "player")).toBe("loss");
    expect(outcomeFor("player", "enemy")).toBe("loss");
    expect(outcomeFor("draw", "player")).toBe("draw");
    expect(sampleOutcome({ crownDiff: 2 })).toBe("win");
    expect(sampleOutcome({ crownDiff: 0, outcome: "loss" })).toBe("loss");
  });

  it("parses stored outcomes and drops junk ones", () => {
    const s = parseAutoState(
      JSON.stringify({ v: 1, ladderMatches: 2, tier: "practice", history: [{ crownDiff: 0, outcome: "loss" }, { crownDiff: 1, outcome: "meh" }] }),
      0,
    );
    expect(s.tier).toBe("practice");
    expect(s.history).toEqual([{ crownDiff: 0, outcome: "loss" }, { crownDiff: 1 }]);
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
    expect(botLevel(5, "practice")).toBe(3);
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
