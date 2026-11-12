import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  checkSeason,
  claimAchievement,
  freshAchievements,
  isEarned,
  recordChest,
  recordMatch,
  SEASON_FLOOR,
  seasonResetTrophies,
} from "./achievements";
import { ARENAS, arenaIndexAt } from "./arenas";
import { ROAD_MAX } from "./roadRewards";

const WIN = {
  won: true,
  crowns: 3,
  cardsPlayed: 12,
  damage: 5000,
  durationSec: 100,
  deckHadChampion: true,
  trophiesAfter: 120,
};

describe("achievements", () => {
  it("accumulates lifetime counters from matches and chests", () => {
    let a = freshAchievements();
    a = recordMatch(a, WIN);
    a = recordMatch(a, { ...WIN, won: false, crowns: 0 });
    a = recordChest(a);
    expect(a.counters.wins).toBe(1);
    expect(a.counters.threeCrowns).toBe(1); // losses never count crowns
    expect(a.counters.plays).toBe(24);
    expect(a.counters.damage).toBe(10000);
    expect(a.counters.quickWins).toBe(1); // 100s < 2min, won
    expect(a.counters.championWins).toBe(1);
    expect(a.counters.chests).toBe(1);
    expect(a.counters.bestTrophies).toBe(120);
  });

  it("earns and claims each achievement exactly once", () => {
    let a = recordMatch(freshAchievements(), WIN);
    const firstWin = ACHIEVEMENTS.find((d) => d.id === "first-win")!;
    expect(isEarned(a, firstWin)).toBe(true);
    const res = claimAchievement(a, "first-win")!;
    expect(res.reward).toBe(firstWin.reward);
    a = res.state;
    expect(claimAchievement(a, "first-win")).toBeNull(); // no double dip
    expect(claimAchievement(a, "win-50")).toBeNull(); // not earned yet
  });
});

describe("seasons", () => {
  it("keeps the same month intact and tracks the best", () => {
    const s = { key: "2026-08", best: 900, history: [] };
    const roll = checkSeason(s, "2026-08", 1200);
    expect(roll.reset).toBe(false);
    expect(roll.trophies).toBe(1200);
    expect(roll.state.best).toBe(1200);
  });

  it("soft-resets above the floor on a new month and archives the season", () => {
    const s = { key: "2026-08", best: 1500, history: [] };
    const roll = checkSeason(s, "2026-09", 1250);
    expect(roll.reset).toBe(true);
    expect(roll.rolled).toBe(true);
    expect(roll.trophies).toBe(SEASON_FLOOR + 125); // 1000 + (250 / 2), still Spell Valley
    expect(roll.state.history[0]).toEqual({ key: "2026-08", best: 1500 });
  });

  it("keeps the arena: 1600 (the first step of Royal Arena) stays 1600", () => {
    const s = { key: "2026-08", best: 1600, history: [] };
    const roll = checkSeason(s, "2026-09", 1600);
    expect(roll.trophies).toBe(1600);
    expect(roll.reset).toBe(false); // nothing to trim
    expect(roll.rolled).toBe(true); // but the new season is still celebrated
    expect(arenaIndexAt(roll.trophies)).toBe(ARENAS.findIndex((a) => a.id === "royal-arena"));
  });

  it("trims toward the floor but stops at the current arena's floor", () => {
    expect(seasonResetTrophies(1900)).toBe(1600); // halving says 1450
    expect(seasonResetTrophies(2500)).toBe(2400); // halving says 1750
    expect(seasonResetTrophies(3400)).toBe(3000); // halving says 2200
    expect(seasonResetTrophies(1500)).toBe(1300); // halving says 1250
    expect(seasonResetTrophies(1200)).toBe(1100); // halving stays in Spell Valley
    expect(seasonResetTrophies(1000)).toBe(1000);
    expect(seasonResetTrophies(400)).toBe(400);
  });

  it("never lowers the arena for any trophy count from 0 to past the road's end", () => {
    for (let t = 0; t <= ROAD_MAX * 2; t++) {
      const roll = checkSeason({ key: "2026-08", best: t, history: [] }, "2026-09", t);
      expect(roll.trophies).toBeLessThanOrEqual(t);
      if (arenaIndexAt(roll.trophies) !== arenaIndexAt(t)) {
        throw new Error(`season reset at ${t} trophies dropped the arena (now ${roll.trophies})`);
      }
    }
  });

  it("leaves trophies below the floor untouched", () => {
    const s = { key: "2026-08", best: 400, history: [] };
    const roll = checkSeason(s, "2026-09", 400);
    expect(roll.reset).toBe(false);
    expect(roll.rolled).toBe(true);
    expect(roll.trophies).toBe(400);
    expect(roll.state.history).toHaveLength(1);
  });

  it("starts a first season silently for fresh profiles", () => {
    const roll = checkSeason(null, "2026-08", 0);
    expect(roll.reset).toBe(false);
    expect(roll.rolled).toBe(false);
    expect(roll.state.key).toBe("2026-08");
  });
});
