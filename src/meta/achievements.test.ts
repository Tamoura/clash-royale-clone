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
} from "./achievements";

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
    const roll = checkSeason(s, "2026-09", 1600);
    expect(roll.reset).toBe(true);
    expect(roll.trophies).toBe(SEASON_FLOOR + 300); // 1000 + (600 / 2)
    expect(roll.state.history[0]).toEqual({ key: "2026-08", best: 1600 });
  });

  it("leaves trophies below the floor untouched (no banner)", () => {
    const s = { key: "2026-08", best: 400, history: [] };
    const roll = checkSeason(s, "2026-09", 400);
    expect(roll.reset).toBe(false);
    expect(roll.trophies).toBe(400);
    expect(roll.state.history).toHaveLength(1);
  });

  it("starts a first season silently for fresh profiles", () => {
    const roll = checkSeason(null, "2026-08", 0);
    expect(roll.reset).toBe(false);
    expect(roll.state.key).toBe("2026-08");
  });
});
