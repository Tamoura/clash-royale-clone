import { describe, expect, it } from "vitest";
import { isValidDeck } from "./battle";
import { dailyDeck, dailySeed, dateKey } from "./daily";

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
});
