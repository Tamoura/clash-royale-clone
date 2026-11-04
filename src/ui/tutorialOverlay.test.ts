import { describe, expect, it } from "vitest";
import { controlsTop } from "./tutorialOverlay";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  width,
  height,
});

describe("controlsTop: where a bottom-docked coach bubble must end", () => {
  const span = { left: 15, right: 375 }; // a 360 px bubble centred at 390 wide

  it("is the top of the highest control in the bubble's columns, not the hand's", () => {
    const hud = rect(0, 690, 390, 154); // the hand tray
    const king = rect(332, 609, 46, 46); // floats above the tray
    const next = rect(12, 615, 44, 60);
    const emote = rect(334, 560, 44, 44);
    expect(controlsTop([hud, king, next, emote], span, 844)).toBe(560);
    expect(controlsTop([hud, king, next], span, 844)).toBe(609);
    expect(controlsTop([hud], span, 844)).toBe(690);
  });

  it("ignores hidden controls and controls beside the bubble (wide side panels)", () => {
    const hidden = rect(200, 100, 0, 0);
    const sidePanel = rect(980, 300, 260, 400); // right of a centred board
    expect(controlsTop([hidden, sidePanel], { left: 460, right: 820 }, 800)).toBe(800);
    // Touching edges do not overlap.
    expect(controlsTop([rect(820, 500, 40, 40)], { left: 460, right: 820 }, 800)).toBe(800);
  });

  it("never goes above the screen", () => {
    expect(controlsTop([rect(0, -20, 390, 40)], span, 844)).toBe(0);
  });
});
