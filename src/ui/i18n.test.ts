import { describe, expect, it } from "vitest";
import { fmtNum, fmtTime, formatNum, formatTime, sparks, sparksAr, sparksEn } from "./i18n";

describe("number and time formatting", () => {
  it("groups thousands in the Classic edition", () => {
    expect(formatNum(1234567, false)).toBe("1,234,567");
    expect(formatNum(42, false)).toBe("42");
  });

  it("uses Arabic-Indic digits in the Islamic edition", () => {
    expect(formatNum(1250, true)).toBe("١٬٢٥٠");
  });

  it("formats seconds as m:ss", () => {
    expect(formatTime(179, false)).toBe("2:59");
    expect(formatTime(65.9, false)).toBe("1:05");
    expect(formatTime(0, false)).toBe("0:00");
    expect(formatTime(-3, false)).toBe("0:00");
    expect(formatTime(600, false)).toBe("10:00");
    expect(formatTime(179, true)).toBe("٢:٥٩");
  });

  it("the edition-bound helpers agree with one of the editions", () => {
    expect([formatNum(1250, false), formatNum(1250, true)]).toContain(fmtNum(1250));
    expect([formatTime(61, false), formatTime(61, true)]).toContain(fmtTime(61));
  });
});

describe("counting Sparks (the battle resource)", () => {
  it("says 1 spark and N sparks in English", () => {
    expect(sparksEn(1)).toBe("1 spark");
    expect(sparksEn(0)).toBe("0 sparks");
    expect(sparksEn(4)).toBe("4 sparks");
    expect(sparksEn(10)).toBe("10 sparks");
  });

  it("agrees with the number in Arabic, in Arabic-Indic digits", () => {
    expect(sparksAr(1)).toBe("شرارة واحدة");
    expect(sparksAr(2)).toBe("شرارتان");
    expect(sparksAr(2, "acc")).toBe("شرارتين");
    expect(sparksAr(3)).toBe("٣ شرارات");
    expect(sparksAr(10)).toBe("١٠ شرارات");
    expect(sparksAr(11)).toBe("١١ شرارة");
    expect(sparksAr(12)).toBe("١٢ شرارة");
    expect(sparksAr(0)).toBe("٠ شرارة");
    expect(sparksAr(103)).toBe("١٠٣ شرارات");
    for (const n of [1, 2, 3, 7, 10, 11, 25]) expect(sparksAr(n)).not.toMatch(/[0-9]/);
  });

  it("the edition-bound helper agrees with one of the editions", () => {
    expect([sparksEn(3), sparksAr(3)]).toContain(sparks(3));
  });
});
