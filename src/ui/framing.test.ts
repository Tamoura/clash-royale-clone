import { describe, expect, it } from "vitest";
import {
  BAND_GAP_PX,
  CROWN_HALF_W,
  EDGE_GAP_PX,
  FAR_EDGE,
  FAR_KING_TOP,
  KING_PLATE_H,
  NEAR_KING_FOOT,
  PLATE_GAP_PX,
  TALL_ALIGN_Y,
  TRAY_MARK_PX,
  ZERO_INSETS,
  fitBattleFrustum,
  type Insets,
} from "../render3d/scene/fit";
import { battleLayout } from "./layout";

/**
 * The battle frame on the screens the art round was checked on, end to end:
 * the layout (layout.ts), the insets layoutWire.ts hands the camera, and the
 * frustum (fit.ts). The kings' extents come from fit.ts, which
 * kingExtents.test.ts pins to the towers as built.
 */
const SIZES: [number, number][] = [
  [1440, 900],
  [1366, 768],
  [1920, 1080],
  [1280, 720],
  [1024, 768],
  [844, 390],
  [768, 1024],
  [390, 844],
  [360, 640],
  [412, 915],
];
const NOTCHED: Insets = { top: 47, left: 0, right: 0, bottom: 34 };

interface Frame {
  mode: "tall" | "wide";
  /** The canvas: the whole screen (wide) or the stage over the tray (tall). */
  w: number;
  h: number;
  ins: Insets;
  /** Where the chips over the far king end (tall) or the screen's top edge (wide). */
  chipBottom: number;
  /** What a near plate must stay over: the screen's bottom edge (wide) or the tray's ornament (tall). */
  floor: number;
  /** Camera-up → canvas px. */
  y: (u: number) => number;
  x: (u: number) => number;
  /** CSS px per world unit. */
  s: number;
}

/**
 * The frame a w x h screen gets. Tall: the band as layout.ts predicts it
 * plus `bandExtra` (a taller band: names, the Golden Age clock); the chips
 * over the far king either sit in the band (`crownFree` false) or leave his
 * column free (tablets).
 */
function frame(w: number, h: number, safe: Insets = ZERO_INSETS, bandExtra = 0, crownFree = false): Frame {
  const lay = battleLayout(w, h, safe);
  let ins: Insets;
  let ch: number;
  let alignY = 0.5;
  let chipBottom: number;
  let floor: number;
  if (lay.mode === "wide") {
    ins = lay.insets;
    ch = h;
    chipBottom = ins.top;
    floor = h - ins.bottom - EDGE_GAP_PX;
  } else {
    const band = (w >= 600 || w / h >= 0.47 ? 58 : 83) + safe.top + bandExtra + BAND_GAP_PX;
    const crownTop = crownFree ? safe.top + BAND_GAP_PX : band;
    ins = { ...ZERO_INSETS, top: band, crownTop };
    ch = h - lay.tray;
    alignY = TALL_ALIGN_Y;
    chipBottom = crownTop - BAND_GAP_PX;
    floor = ch - TRAY_MARK_PX;
  }
  const f = fitBattleFrustum(w, ch, ins, lay.box, alignY);
  const s = w / (f.right - f.left);
  return { mode: lay.mode, w, h: ch, ins, chipBottom, floor, s, y: (u) => (f.top - u) * s, x: (u) => (u - f.left) * s };
}

/** The kings on screen: the far king's top and plate, the near king's plate (canvas px). */
function kings(fr: Frame): { farTop: number; farPlateTop: number; nearPlateBottom: number } {
  const farTop = fr.y(FAR_KING_TOP);
  return {
    farTop,
    farPlateTop: farTop - PLATE_GAP_PX - KING_PLATE_H * fr.s,
    nearPlateBottom: fr.y(NEAR_KING_FOOT) + PLATE_GAP_PX + KING_PLATE_H * fr.s,
  };
}

describe("the kings stay on screen, clear of the HUD", () => {
  const eps = 1e-6;
  const variants: [string, Insets, number, boolean][] = [
    ["", ZERO_INSETS, 0, false],
    [" (a taller band)", ZERO_INSETS, 20, false],
    [" (the chips leave the far king's column free)", ZERO_INSETS, 0, true],
    [" (notch and home indicator)", NOTCHED, 0, false],
  ];
  for (const [w, h] of SIZES) {
    for (const [name, safe, bandExtra, crownFree] of variants) {
      it(`${w}x${h}${name}: the far king's roofs and plate, the near king's plate`, () => {
        const fr = frame(w, h, safe, bandExtra, crownFree);
        const k = kings(fr);
        // The far king whole, his plate over his roofs, 6 px under the
        // chips over him or the screen's top edge.
        expect(k.farTop).toBeGreaterThan(fr.chipBottom);
        expect(k.farPlateTop).toBeGreaterThanOrEqual(fr.chipBottom + EDGE_GAP_PX - eps);
        // The rest of the board's top (the far lanterns) under the whole band.
        expect(fr.y(FAR_EDGE)).toBeGreaterThanOrEqual(fr.ins.top - eps);
        // The near king's plate over the tray's ornament, or 6 px over the screen's bottom edge.
        expect(k.nearPlateBottom).toBeLessThanOrEqual(fr.floor + eps);
        // His column stays between the side panels.
        expect(fr.x(-CROWN_HALF_W)).toBeGreaterThanOrEqual(fr.ins.left - eps);
        expect(fr.x(CROWN_HALF_W)).toBeLessThanOrEqual(fr.w - fr.ins.right + eps);
      });
    }
  }

  it("gives up no more board than the kings need: a height-bound board is tight on them", () => {
    for (const [w, h] of SIZES) {
      for (const crownFree of [false, true]) {
        const fr = frame(w, h, ZERO_INSETS, 0, crownFree);
        const k = kings(fr);
        const widthBound = Math.abs(fr.x(fr.mode === "wide" ? 9.95 : 9.25) - fr.x(fr.mode === "wide" ? -9.95 : -9.25) - (fr.w - fr.ins.left - fr.ins.right)) < 1e-6;
        if (widthBound) continue;
        // Height-bound: the near plate sits exactly on its floor, and either
        // the far plate exactly 6 px under what covers it, or the far lanterns
        // exactly under the band.
        expect(k.nearPlateBottom, `${w}x${h}`).toBeCloseTo(fr.floor, 6);
        const plateTight = Math.abs(k.farPlateTop - (fr.chipBottom + EDGE_GAP_PX)) < 1e-6;
        const boardTight = Math.abs(fr.y(FAR_EDGE) - fr.ins.top) < 1e-6;
        expect(plateTight || boardTight, `${w}x${h}`).toBe(true);
      }
    }
  });

  it("lets the far king rise between the chips on a tablet instead of shrinking the board", () => {
    const under = frame(768, 1024, ZERO_INSETS, 0, false);
    const between = frame(768, 1024, ZERO_INSETS, 0, true);
    expect(between.s).toBeGreaterThan(under.s * 1.05);
    // Width-bound phones keep their board either way: the spare height takes the crown.
    for (const [w, h] of [[390, 844], [412, 915]]) {
      expect(frame(w, h).s, `${w}x${h}`).toBeCloseTo(w / 18.5, 9);
    }
  });
});
