import { describe, expect, it } from "vitest";
import { DEFAULT_DECK, type CardId } from "../game/cards";
import { checkSeason, onSeasonRollover, type SeasonRollover } from "./achievements";
import { memoryKV } from "./kv";
import {
  CROWNS_PER_TIER,
  PASS_KEY,
  PASS_TIERS,
  addCrowns,
  claimTier,
  claimableTiers,
  emotesUnlocked,
  ensurePassSeason,
  freshPass,
  loadPass,
  passProgress,
  passRewards,
  savePass,
  seasonDaysLeft,
  seasonPayout,
  shardChoices,
  tierOf,
  towerFlairUnlocked,
  unlockNextEmote,
  unlockTowerFlair,
} from "./pass";

describe("crown pass maths", () => {
  it("opens one tier per 10 crowns, 30 tiers in all", () => {
    expect(CROWNS_PER_TIER).toBe(10);
    expect(PASS_TIERS).toBe(30);
    expect(tierOf(0)).toBe(0);
    expect(tierOf(9)).toBe(0);
    expect(tierOf(10)).toBe(1);
    expect(tierOf(29)).toBe(2);
    expect(tierOf(300)).toBe(30);
    expect(tierOf(999)).toBe(30);
    expect(tierOf(-5)).toBe(0);
  });

  it("adds a match's crowns and reports progress to the next tier", () => {
    let p = freshPass("2026-10");
    p = addCrowns(p, 3);
    expect(p.crowns).toBe(3);
    expect(passProgress(p)).toEqual({ tier: 0, into: 3, need: 10, maxed: false });
    p = addCrowns(p, 8);
    expect(passProgress(p)).toEqual({ tier: 1, into: 1, need: 10, maxed: false });
    expect(addCrowns(p, 0)).toBe(p);
    expect(addCrowns(p, -3)).toBe(p);
    p = addCrowns(p, 5000);
    expect(p.crowns).toBe(300);
    expect(passProgress(p).maxed).toBe(true);
  });

  it("lets each opened tier be claimed exactly once", () => {
    let p = addCrowns(freshPass("2026-10"), 25);
    expect(claimableTiers(p)).toEqual([1, 2]);
    expect(claimTier(p, 3)).toBeNull(); // still locked
    const one = claimTier(p, 2)!;
    expect(one.rewards).toEqual(passRewards(2));
    p = one.state;
    expect(claimTier(p, 2)).toBeNull(); // already paid
    expect(claimableTiers(p)).toEqual([1]);
    p = claimTier(p, 1)!.state;
    expect(claimableTiers(p)).toEqual([]);
    expect(p.claimed).toEqual([1, 2]);
    expect(claimTier(p, 0)).toBeNull();
    expect(claimTier(p, 1.5)).toBeNull();
  });

  it("pays gems every 5 tiers and cosmetics at 10, 20 and 30", () => {
    for (let t = 1; t <= PASS_TIERS; t++) {
      const kinds = passRewards(t).map((r) => r.kind);
      expect(kinds.length, `tier ${t}`).toBeGreaterThan(0);
      expect(kinds.includes("gems"), `tier ${t}`).toBe(t % 5 === 0);
    }
    expect(passRewards(10)).toContainEqual({ kind: "flair", tier: 1 });
    expect(passRewards(20)).toContainEqual({ kind: "emote" });
    expect(passRewards(30)).toContainEqual({ kind: "flair", tier: 2 });
    const all = Array.from({ length: PASS_TIERS }, (_, i) => passRewards(i + 1)).flat();
    for (const k of ["gold", "chest", "shards"]) expect(all.some((r) => r.kind === k)).toBe(true);
    expect(all).toContainEqual({ kind: "chest", chest: "rare" });
    expect(passRewards(0)).toEqual([]);
    expect(passRewards(31)).toEqual([]);
  });

  it("season payout is 100 + best/10", () => {
    expect(seasonPayout(0)).toBe(100);
    expect(seasonPayout(1234)).toBe(223);
    expect(seasonPayout(-5)).toBe(100);
  });

  it("counts the days left in the month", () => {
    expect(seasonDaysLeft(new Date(2026, 9, 6, 12))).toBe(26);
    expect(seasonDaysLeft(new Date(2026, 9, 31, 23))).toBe(1);
  });
});

describe("crown pass seasons", () => {
  it("resets on a new season key and keeps the archive", () => {
    let p = addCrowns(freshPass("2026-09"), 47);
    p = claimTier(p, 1)!.state;
    const same = ensurePassSeason(p, "2026-09");
    expect(same.rolled).toBe(false);
    expect(same.state).toBe(p);
    const next = ensurePassSeason(p, "2026-10");
    expect(next.rolled).toBe(true);
    expect(next.state.key).toBe("2026-10");
    expect(next.state.crowns).toBe(0);
    expect(next.state.claimed).toEqual([]);
    expect(next.state.archive).toEqual([{ key: "2026-09", crowns: 47, tier: 4 }]);
    // A third month stacks newest first.
    const third = ensurePassSeason(addCrowns(next.state, 12), "2026-11").state;
    expect(third.archive.map((a) => a.key)).toEqual(["2026-10", "2026-09"]);
    // The new season's tier 1 can be claimed again: it is a new pass.
    expect(claimTier(addCrowns(next.state, 10), 1)).not.toBeNull();
  });

  it("loadPass rolls an old saved pass over and persists the archive", () => {
    const kv = memoryKV();
    savePass(addCrowns(freshPass("2026-09"), 33), kv);
    const p = loadPass("2026-10", kv);
    expect(p.key).toBe("2026-10");
    expect(p.archive[0]).toEqual({ key: "2026-09", crowns: 33, tier: 3 });
    expect(JSON.parse(kv.data[PASS_KEY]).key).toBe("2026-10");
    kv.setItem(PASS_KEY, "garbage");
    expect(loadPass("2026-10", kv)).toEqual(freshPass("2026-10"));
    expect(loadPass("2026-10", null)).toEqual(freshPass("2026-10"));
  });

  it("checkSeason tells rollover listeners about the season that ended", () => {
    const seen: SeasonRollover[] = [];
    const off = onSeasonRollover((r) => seen.push(r));
    const bad = onSeasonRollover(() => {
      throw new Error("listener bug");
    });
    checkSeason(null, "2026-09", 500); // first season ever: nothing ended
    checkSeason({ key: "2026-09", best: 900, history: [] }, "2026-09", 950); // same month
    expect(seen).toEqual([]);
    const res = checkSeason({ key: "2026-09", best: 1200, history: [] }, "2026-10", 1100);
    expect(res.state.key).toBe("2026-10");
    expect(seen).toHaveLength(1);
    expect(seen[0].ended.key).toBe("2026-09");
    expect(seen[0].ended.best).toBe(1200);
    expect(seen[0].nextKey).toBe("2026-10");
    off();
    bad();
    checkSeason({ key: "2026-10", best: 0, history: [] }, "2026-11", 0);
    expect(seen).toHaveLength(1);
  });
});

describe("crown pass picks and unlocks", () => {
  it("offers three owned cards, deck first, stable per season and tier", () => {
    const owned: CardId[] = [...DEFAULT_DECK, "zap", "cannon"];
    const a = shardChoices(owned, DEFAULT_DECK, "2026-10", 3);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(owned).toContain(id);
    expect(a.filter((id) => DEFAULT_DECK.includes(id))).toHaveLength(2);
    expect(shardChoices(owned, DEFAULT_DECK, "2026-10", 3)).toEqual(a);
    expect(shardChoices(["knight", "archers"], [], "2026-10", 3)).toHaveLength(2);
  });

  it("keeps tower flair and emotes as permanent unlocks", () => {
    const kv = memoryKV();
    expect(towerFlairUnlocked(kv)).toBe(0);
    expect(unlockTowerFlair(2, kv)).toBe(2);
    expect(unlockTowerFlair(1, kv)).toBe(2); // never downgrades
    expect(emotesUnlocked(kv)).toEqual([]);
    const first = unlockNextEmote(kv)!;
    const second = unlockNextEmote(kv)!;
    expect(first.id).not.toBe(second.id);
    expect(emotesUnlocked(kv)).toEqual([first.id, second.id]);
  });
});
