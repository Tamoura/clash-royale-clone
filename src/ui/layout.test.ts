import { describe, expect, it } from "vitest";
import { BATTLE_BOX, TALL_BOX, ZERO_INSETS, fitBattleFrustum, type Insets } from "../render3d/scene/fit";
import {
  SIDE_GAP,
  SIDE_MAX,
  SIDE_MIN,
  SIDE_ROOMY,
  TALL_CARD_H_FRAC,
  battleLayout,
  cardHeight,
  handPanelBudget,
  handPanelHeight,
  handPanelInnerW,
  tallLayout,
  wideLayout,
} from "./layout";

/**
 * The board's scale (CSS px per tile) in the old phone-shaped column
 * (`#app { width: min(100vw, 52vh) }`, tray under the stage, ~95px band,
 * frameOrtho's top-inset fit). Reproduces the measured values within 1%:
 * 568x320 5.69, 800x600 12.61, 850x700 15.67, 1000x750 17.24, 360x640 13.83.
 */
function oldColumnTile(w: number, h: number): number {
  const col = Math.min(w, 0.52 * h);
  const tray = cardHeight((col - 56) / 4) + 82;
  const stage = h - tray;
  const f = Math.min(0.25, 95 / stage);
  return Math.min(col / (2 * BATTLE_BOX.halfW), (stage * (1 - f)) / BATTLE_BOX.height);
}

/** The board's real scale for a layout: fit its box between its insets (tall: under the band, over the tray). */
function realTile(w: number, h: number, safe: Insets = ZERO_INSETS): number {
  const lay = battleLayout(w, h, safe);
  if (lay.mode === "wide") {
    const f = fitBattleFrustum(w, h, lay.insets, lay.box);
    return w / (f.right - f.left);
  }
  return lay.tile;
}

describe("battleLayout", () => {
  it("keeps phones and portrait tablets tall", () => {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
      [360, 740],
      [375, 667],
      [768, 1024],
      [820, 1180],
      [800, 1000],
    ]) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("tall");
      expect(lay.box).toBe(TALL_BOX);
      expect(lay.side).toBe(0);
    }
  });

  it("leaves portrait phones' trays exactly as wide as the screen", () => {
    for (const [w, h] of [
      [320, 568],
      [360, 640],
      [375, 667],
      [390, 844],
      [430, 932],
    ]) {
      expect(tallLayout(w, h).handW, `${w}x${h}`).toBe(w);
    }
  });

  it("caps the tall tray's cards by the screen's height and gives tablets big cards", () => {
    for (let w = 300; w <= 2000; w += 53) {
      for (let h = 300; h <= 1600; h += 47) {
        const t = tallLayout(w, h);
        expect(cardHeight(t.cardW), `${w}x${h}`).toBeLessThanOrEqual(TALL_CARD_H_FRAC * h + 1);
        expect(t.handW).toBeLessThanOrEqual(w);
      }
    }
    // An iPad Air in portrait keeps cards close to its old 136px.
    expect(tallLayout(820, 1180).cardW).toBeGreaterThanOrEqual(120);
  });

  it("puts landscape screens in wide mode with full-height boards between side panels", () => {
    const cases: [number, number, number][] = [
      [844, 390, 269],
      [667, 375, 186],
      [1180, 820, 277],
      [1024, 768, 218],
      [1366, 768, 320],
      [1440, 900, 320],
      [1920, 1080, 320],
    ];
    for (const [w, h, side] of cases) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("wide");
      expect(lay.side, `${w}x${h}`).toBe(side);
      expect(lay.box).toBe(BATTLE_BOX);
      expect(lay.insets).toEqual({ top: 0, bottom: 0, left: side + SIDE_GAP, right: side + SIDE_GAP });
      expect(lay.tile, `${w}x${h}`).toBeCloseTo(h / BATTLE_BOX.height, 6);
    }
  });

  it("keeps near-square and small landscape windows wide: the board gives up height, not the panels", () => {
    for (const [w, h] of [
      [568, 320],
      [600, 400],
      [640, 480],
      [700, 500],
      [800, 600],
      [850, 700],
      [900, 900],
      [1000, 1000],
    ]) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("wide");
      expect(lay.side, `${w}x${h}`).toBe(SIDE_MIN);
      expect(lay.fieldW, `${w}x${h}`).toBe(w - 2 * (SIDE_MIN + SIDE_GAP));
      // Width-bound between the panels, so the whole board still shows.
      const f = fitBattleFrustum(w, h, lay.insets, lay.box);
      expect(w / (f.right - f.left), `${w}x${h}`).toBeCloseTo(lay.fieldW / (2 * BATTLE_BOX.halfW), 6);
      expect(lay.fieldW / (2 * BATTLE_BOX.halfW)).toBeLessThanOrEqual(h / BATTLE_BOX.height);
    }
  });

  it("makes room for notches and the home indicator", () => {
    const safe = { top: 0, left: 47, right: 47, bottom: 21 };
    const lay = battleLayout(844, 390, safe);
    expect(lay.mode).toBe("wide");
    expect(lay.insets.left).toBe(lay.side + SIDE_GAP + 47);
    expect(lay.insets.right).toBe(lay.side + SIDE_GAP + 47);
    expect(lay.insets.bottom).toBe(21);
    // The hand panel clears the home indicator and the top edge.
    expect(handPanelHeight(lay.cardW, lay.handCols, lay.stacked)).toBeLessThanOrEqual(390 - 12 - 21);
    expect(handPanelBudget(390, safe)).toBe(390 - 12 - 21);
  });

  it("never squeezes the panels, the hand or the board", () => {
    const safes: Insets[] = [ZERO_INSETS, { top: 0, left: 47, right: 47, bottom: 21 }, { top: 47, left: 0, right: 0, bottom: 34 }];
    for (const safe of safes) {
      for (let w = 300; w <= 3000; w += 37) {
        for (let h = 300; h <= 1600; h += 41) {
          const lay = battleLayout(w, h, safe);
          if (lay.mode !== "wide") continue;
          const at = `${w}x${h} ${JSON.stringify(safe)}`;
          expect(lay.side, at).toBeGreaterThanOrEqual(SIDE_MIN);
          expect(lay.side, at).toBeLessThanOrEqual(SIDE_MAX);
          expect(lay.fieldW + 2 * (lay.side + SIDE_GAP), at).toBeLessThanOrEqual(w - safe.left - safe.right + 1);
          // The hand fits its panel both ways, and is a usable size.
          expect(lay.handCols * lay.cardW + (lay.handCols - 1) * 12, at).toBeLessThanOrEqual(handPanelInnerW(lay.side));
          expect(handPanelHeight(lay.cardW, lay.handCols, lay.stacked), at).toBeLessThanOrEqual(handPanelBudget(h, safe));
          // Fingertip-sized cards on any real landscape screen (a portrait
          // notch's insets on a 300px-tall window are not one).
          if (h >= 320 && safe.top + safe.bottom <= 21) expect(lay.cardW, at).toBeGreaterThanOrEqual(44);
          if (lay.side >= SIDE_ROOMY) {
            expect(lay.handCols, at).toBe(2);
            expect(lay.stacked, at).toBe(false);
          }
          // The predicted scale is the camera's: the whole board, between the panels.
          const f = fitBattleFrustum(w, h, lay.insets, lay.box);
          expect(w / (f.right - f.left), at).toBeCloseTo(lay.tile, 6);
        }
      }
    }
  });

  it("picks whichever layout draws the bigger board", () => {
    for (let w = 320; w <= 2000; w += 29) {
      for (let h = 320; h <= 1400; h += 31) {
        const lay = battleLayout(w, h);
        const wide = wideLayout(w, h);
        expect(lay.tile, `${w}x${h}`).toBeGreaterThanOrEqual(Math.max(tallLayout(w, h).tile, wide?.tile ?? 0));
      }
    }
  });

  it("never draws a smaller board than the old phone column", () => {
    // Every screen at least 568px on its long side (the smallest phone in
    // use, an iPhone SE, is 320x568); tinier windows are cramped either way.
    for (let w = 320; w <= 2000; w += 23) {
      for (let h = 320; h <= 1400; h += 19) {
        if (Math.max(w, h) < 568) continue;
        expect(realTile(w, h), `${w}x${h}`).toBeGreaterThanOrEqual(oldColumnTile(w, h) * 0.99);
      }
    }
    // The landscape windows that used to fall back to a cramped tall layout.
    for (const [w, h, atLeast] of [
      [568, 320, 1.7],
      [600, 400, 1.5],
      [640, 480, 1.4],
      [700, 500, 1.6],
      [800, 600, 1.7],
      [850, 700, 1.5],
    ]) {
      expect(realTile(w, h) / oldColumnTile(w, h), `${w}x${h}`).toBeGreaterThanOrEqual(atLeast);
    }
  });

  it("has no cliff: widening a window by a pixel never shrinks the board noticeably", () => {
    for (const h of [320, 360, 400, 480, 600, 700, 768, 900, 1000, 1180]) {
      let prev = battleLayout(Math.round(h * 0.45), h).tile;
      for (let w = Math.round(h * 0.45) + 1; w <= h * 2.5; w++) {
        const tile = battleLayout(w, h).tile;
        expect(tile, `${w}x${h}`).toBeGreaterThanOrEqual(prev * 0.995);
        prev = tile;
      }
    }
  });
});
