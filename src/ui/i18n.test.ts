import { describe, expect, it } from "vitest";
import { fmtNum, fmtTime, formatNum, formatTime } from "./i18n";

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
