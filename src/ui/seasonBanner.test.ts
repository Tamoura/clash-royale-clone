import { describe, expect, it } from "vitest";
import { seasonStartText } from "./seasonBanner";

describe("seasonStartText: the season-start banner celebrates the arena kept", () => {
  it("names the arena and the trophies in English", () => {
    expect(seasonStartText("December 2026", 1600, false)).toBe(
      "December 2026 season starts! You kept Royal Arena with 1,600 trophies.",
    );
    expect(seasonStartText("May 2027", 1, false)).toBe("May 2027 season starts! You kept Training Camp with 1 trophy.");
  });

  it("uses the Golden Age arena name and Arabic-Indic digits in Arabic", () => {
    const line = seasonStartText("ديسمبر ٢٠٢٦", 1600, true);
    expect(line).toContain("قصر الحمراء");
    expect(line).toContain("١٬٦٠٠");
    expect(line).not.toMatch(/[0-9]/);
  });
});
