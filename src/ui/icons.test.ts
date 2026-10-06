import { describe, expect, it } from "vitest";
import { ICON_NAMES, icon, type IconName } from "./icons";

describe("icons", () => {
  it("every name renders an inline SVG", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(50);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.startsWith("<svg"), name).toBe(true);
      expect(svg.endsWith("</svg>"), name).toBe(true);
      expect(svg).not.toContain("undefined");
    }
  });

  it("includes the revamp set and all twelve crests", () => {
    const wanted: IconName[] = [
      "elixir", "check", "lock", "back", "settings", "share", "copy", "handshake", "save",
      "bolt", "wrench", "dice", "heart", "upgrade", "flag", "music", "sfx", "wifi",
      "crown-filled", "crown-empty", "skull", "wing", "snow", "trophy", "chest", "gem",
      "coin", "play", "pause", "home", "info", "star",
    ];
    for (let i = 0; i < 12; i++) wanted.push(`crest-${i}` as IconName);
    for (const name of wanted) expect(ICON_NAMES).toContain(name);
  });

  it("passes the extra class through", () => {
    expect(icon("back", "icon-back")).toContain('class="ui-icon icon-back"');
  });
});
