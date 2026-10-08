import { describe, expect, it } from "vitest";
import { isValidDeck } from "./battle";
import { CARDS } from "./cards";
import { DAILY_MAX_SPELLS, dailyDeck, dailyDeckKey, dailySeed, dateKey, isFairDailyDeck, isWinCondition } from "./daily";

describe("daily challenge", () => {
  it("formats a stable local date key", () => {
    expect(dateKey(new Date(2026, 6, 11, 9, 30))).toBe("2026-07-11");
    expect(dateKey(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });

  it("derives a deterministic seed that changes day to day", () => {
    expect(dailySeed("2026-07-11")).toBe(dailySeed("2026-07-11"));
    expect(dailySeed("2026-07-11")).not.toBe(dailySeed("2026-07-12"));
  });

  it("deals a legal deck of the day, same all day, fresh tomorrow", () => {
    const today = dailyDeck("2026-07-11");
    expect(isValidDeck(today)).toBe(true);
    expect(dailyDeck("2026-07-11")).toEqual(today);
    expect(dailyDeck("2026-07-12")).not.toEqual(today);
  });

  it("versions the seed key so the new rules deal a fresh deck", () => {
    expect(dailyDeckKey("2026-10-06")).toBe("v2:2026-10-06");
    expect(dailySeed(dailyDeckKey("2026-10-06"))).not.toBe(dailySeed("2026-10-06"));
  });

  it("knows the building-targeting win conditions", () => {
    expect(isWinCondition("giant")).toBe(true);
    expect(isWinCondition("hog-rider")).toBe(true);
    expect(isWinCondition("knight")).toBe(false);
    expect(isWinCondition("cannon")).toBe(false);
  });

  it("365 days from 2026-10-06: no Champion, a win condition, at most 3 spells", () => {
    const start = new Date(2026, 9, 6, 12);
    const seen = new Set<string>();
    for (let d = 0; d < 365; d++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 12);
      const key = dateKey(day);
      seen.add(key);
      const deck = dailyDeck(key);
      expect(isValidDeck(deck), key).toBe(true);
      expect(deck, key).not.toContain("champion");
      expect(deck.some((id) => CARDS[id].kind === "troop" && CARDS[id].unit.targetsBuildingsOnly), key).toBe(true);
      expect(deck.filter((id) => CARDS[id].kind === "spell").length, key).toBeLessThanOrEqual(DAILY_MAX_SPELLS);
      expect(isFairDailyDeck(deck), key).toBe(true);
    }
    expect(seen.size).toBe(365);
  });
});
