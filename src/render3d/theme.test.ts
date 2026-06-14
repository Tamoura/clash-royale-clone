import { describe, expect, it } from "vitest";
import { THEME, hexStr } from "./theme";

describe("Moorish / Islamic-art theme palette", () => {
  it("defines the core jewel-tone colors", () => {
    for (const key of ["turquoise", "deepBlue", "gold", "terracotta", "cream", "sand"] as const) {
      expect(typeof THEME[key]).toBe("number");
    }
  });

  it("colors are distinct", () => {
    const vals = Object.values(THEME);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it("hexStr renders a CSS hex string", () => {
    expect(hexStr(0x1aa3a0)).toBe("#1aa3a0");
    expect(hexStr(0x000000)).toBe("#000000");
    expect(hexStr(0xffffff)).toBe("#ffffff");
  });
});
