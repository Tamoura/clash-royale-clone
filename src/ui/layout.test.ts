import { describe, expect, it } from "vitest";
import { BATTLE_BOX, TALL_BOX, fitBattleFrustum } from "../render3d/scene/fit";
import { SIDE_GAP, SIDE_MIN, battleLayout } from "./layout";

describe("battleLayout", () => {
  it("keeps phones, portrait tablets and square windows tall", () => {
    for (const [w, h] of [
      [390, 844],
      [360, 740],
      [375, 667],
      [768, 1024],
      [820, 1180],
      [1000, 1000],
    ]) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("tall");
      expect(lay.box).toBe(TALL_BOX);
      expect(lay.side).toBe(0);
    }
  });

  it("puts landscape screens in wide mode with side panels", () => {
    const cases: [number, number, number][] = [
      [844, 390, 269],
      [667, 375, 186],
      [1180, 820, 278],
      [1024, 768, 219],
      [1366, 768, 320],
      [1440, 900, 320],
      [1920, 1080, 320],
    ];
    for (const [w, h, side] of cases) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("wide");
      expect(lay.side, `${w}x${h}`).toBe(side);
      expect(lay.box).toBe(BATTLE_BOX);
      expect(lay.insets).toEqual({ top: 0, bottom: 0, left: side, right: side });
    }
  });

  it("makes room for notches and the home indicator", () => {
    const lay = battleLayout(844, 390, { top: 0, left: 47, right: 47, bottom: 21 });
    expect(lay.mode).toBe("wide");
    expect(lay.insets.left).toBe(lay.side + 47);
    expect(lay.insets.right).toBe(lay.side + 47);
    expect(lay.insets.bottom).toBe(21);
  });

  it("never squeezes the panels or the board", () => {
    for (let w = 300; w <= 3000; w += 37) {
      for (let h = 300; h <= 1600; h += 41) {
        const lay = battleLayout(w, h);
        if (lay.mode !== "wide") continue;
        expect(lay.side).toBeGreaterThanOrEqual(SIDE_MIN);
        expect(lay.fieldW + 2 * (lay.side + SIDE_GAP)).toBeLessThanOrEqual(w + 1);
        // The board is height-bound in the free middle: full height, not cropped.
        const f = fitBattleFrustum(w, h, lay.insets, lay.box);
        expect(w / (f.right - f.left)).toBeCloseTo(h / BATTLE_BOX.height, 6);
      }
    }
  });

  it("only goes wide when that makes the board bigger than tall would", () => {
    for (const [w, h] of [
      [844, 390],
      [667, 375],
      [1024, 768],
      [1180, 820],
      [1440, 900],
    ]) {
      const lay = battleLayout(w, h);
      const f = fitBattleFrustum(w, h, lay.insets, lay.box);
      const wide = w / (f.right - f.left);
      // Tall at best: the full width with no tray or band at all.
      const tall = Math.min(w / (2 * TALL_BOX.halfW), h / TALL_BOX.height);
      expect(wide, `${w}x${h}`).toBeGreaterThanOrEqual(tall * 0.99);
    }
  });
});
