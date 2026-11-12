import { describe, expect, it } from "vitest";
import { SEASON_TOAST_MS, seasonStartText } from "./seasonBanner";

const en = (e: string): string => e;
const ar = (_: string, a: string): string => a;

describe("seasonStartText: the new season celebrates the arena kept", () => {
  it("names the arena the trophies stand in", () => {
    expect(seasonStartText("December 2026", 1600, en)).toBe("December 2026 season starts! You kept Royal Arena.");
    expect(seasonStartText("May 2027", 1350, en)).toBe("May 2027 season starts! You kept Builder's Workshop.");
    expect(seasonStartText("May 2027", 40, en)).toBe("May 2027 season starts! You kept Training Camp.");
  });

  it("uses the Golden Age arena name in Arabic, with the season name's own digits", () => {
    const line = seasonStartText("ديسمبر ٢٠٢٦", 1600, ar);
    expect(line).toBe("بدأ موسم ديسمبر ٢٠٢٦! بقيت في قصر الحمراء.");
    expect(line).not.toMatch(/[0-9]/);
  });

  it("stays up long enough for a young reader (the usual toast is 2.4 s)", () => {
    expect(SEASON_TOAST_MS).toBeGreaterThanOrEqual(5000);
    expect(SEASON_TOAST_MS).toBeLessThanOrEqual(8000);
  });
});
