import { describe, expect, it } from "vitest";
import { seasonStartText } from "./seasonBanner";

describe("seasonStartText: the new season celebrates the arena kept", () => {
  it("names the arena the trophies stand in", () => {
    expect(seasonStartText("December 2026", 1600, false)).toBe("December 2026 season starts! You kept Royal Arena.");
    expect(seasonStartText("May 2027", 1350, false)).toBe("May 2027 season starts! You kept Builder's Workshop.");
    expect(seasonStartText("May 2027", 40, false)).toBe("May 2027 season starts! You kept Training Camp.");
  });

  it("uses the Golden Age arena name in Arabic, with the season name's own digits", () => {
    const line = seasonStartText("ديسمبر ٢٠٢٦", 1600, true);
    expect(line).toBe("بدأ موسم ديسمبر ٢٠٢٦! بقيت في قصر الحمراء.");
    expect(line).not.toMatch(/[0-9]/);
  });
});
