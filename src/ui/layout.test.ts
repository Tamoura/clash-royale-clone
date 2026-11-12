import { describe, expect, it } from "vitest";
import { BATTLE_BOX, TALL_BOX, ZERO_INSETS, fitBattleFrustum, heightScale, type ContentBox, type Insets } from "../render3d/scene/fit";
import {
  CARD_ASPECT,
  CARD_TOUCH_MIN,
  SIDE_GAP,
  SIDE_MIN,
  SIDE_ROOMY,
  TALL_CARD_H_FRAC,
  TALL_CARD_MAX,
  TALL_CARD_MIN,
  TRAY_GAP,
  TRAY_GUTTER,
  battleLayout,
  cardHeight,
  handGridW,
  handPanelBudget,
  handPanelHeight,
  handPanelInnerW,
  sideMax,
  tallLayout,
  trayHeight,
  wideCardCap,
  wideLayout,
} from "./layout";

/** The content the old layout framed: the field and its edging, before the far king's crown. */
const LEGACY_BOX: ContentBox = { halfW: 9.95, height: 26.8, mid: 0.6 };

/**
 * The layout before the compact hand, verbatim (its tray: 3:4 cards filling
 * the width, at most 16% of the height tall, over a full-width elixir bar,
 * 82px of chrome; its side panels: 176 to 320px), so the sweeps below can
 * hold the new one against it screen by screen. It frames the same content
 * as today's (the board with the far king's crown and the plates' gaps), so
 * the comparison weighs the hand alone; `LEGACY_BOX` gives its own numbers.
 */
const before = {
  cardHeight: (cw: number): number => ((cw - 6) * 4) / 3 + 6,
  cardForHeight: (ch: number): number => ((ch - 6) * 3) / 4 + 6,
  tall(w: number, h: number, safe: Insets = ZERO_INSETS, box: ContentBox = TALL_BOX): { tile: number; tray: number; cardW: number } {
    const availW = Math.max(1, w - safe.left - safe.right);
    const capByHeight = 4 * before.cardForHeight(0.16 * h) + 56;
    const handW = Math.max(60, Math.floor(Math.min(availW, 560, capByHeight)));
    const cardW = (handW - 56) / 4;
    const tray = before.cardHeight(cardW) + 82 + Math.max(0, safe.bottom - 8);
    const band = (w >= 600 || w / h >= 0.47 ? 58 : 83) + safe.top;
    return { tile: Math.max(0, Math.min(w / (2 * box.halfW), heightScale(h - tray - band, box))), tray, cardW };
  },
  wide(w: number, h: number, safe: Insets = ZERO_INSETS, box: ContentBox = BATTLE_BOX): { tile: number; side: number } {
    const availW = w - safe.left - safe.right;
    const availH = Math.max(1, h - safe.top - safe.bottom);
    const fieldCol = 2 * box.halfW * heightScale(availH, box);
    const side = Math.floor(Math.max(176, Math.min(320, (availW - fieldCol) / 2 - 8)));
    const fieldW = Math.min(fieldCol, availW - 2 * (side + 8));
    return { tile: fieldW > 0 ? fieldW / (2 * box.halfW) : 0, side };
  },
  tile(w: number, h: number, safe: Insets = ZERO_INSETS): number {
    return Math.max(before.tall(w, h, safe).tile, before.wide(w, h, safe).tile);
  },
};

/** The board's real scale for a layout: fit its box between its insets (tall: under the band, over the tray). */
function realTile(w: number, h: number, safe: Insets = ZERO_INSETS): number {
  const lay = battleLayout(w, h, safe);
  if (lay.mode === "wide") {
    const f = fitBattleFrustum(w, h, lay.insets, lay.box);
    return w / (f.right - f.left);
  }
  return lay.tile;
}

/** The screens the family plays on, and the ones the acceptance table lists. */
const PHONES: [number, number][] = [
  [360, 640],
  [360, 740],
  [375, 667],
  [390, 844],
  [393, 852],
  [412, 915],
  [430, 932],
];
const TABLETS: [number, number][] = [
  [768, 1024],
  [820, 1180],
  [800, 1280],
  [1024, 1366],
];
const LANDSCAPE: [number, number][] = [
  [667, 375],
  [844, 390],
  [932, 430],
  [1024, 768],
  [1180, 820],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
];
const SAFES: Insets[] = [ZERO_INSETS, { top: 0, left: 47, right: 47, bottom: 21 }, { top: 47, left: 0, right: 0, bottom: 34 }];

describe("battleLayout", () => {
  it("keeps phones and portrait tablets tall", () => {
    for (const [w, h] of [[320, 568], ...PHONES, ...TABLETS, [800, 1000]]) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("tall");
      expect(lay.box).toBe(TALL_BOX);
      expect(lay.side).toBe(0);
      expect(lay.handCols).toBe(4);
    }
  });

  it("keeps the tall tray a thin strip: at most a sixth of a phone, a seventh of a tablet", () => {
    for (const [w, h] of PHONES) {
      const t = tallLayout(w, h);
      // 360x640 is the squattest phone in use: its cards stop at the 56px floor.
      expect(t.tray / h, `${w}x${h}`).toBeLessThanOrEqual(w / h > 0.55 ? 0.175 : 0.16);
      expect(t.tray, `${w}x${h}`).toBe(trayHeight(t.cardW));
    }
    expect(tallLayout(390, 844).tray).toBeLessThanOrEqual(135);
    for (const [w, h] of TABLETS) expect(tallLayout(w, h).tray / h, `${w}x${h}`).toBeLessThanOrEqual(0.145);
    // The home indicator only adds what it needs under the cards.
    expect(tallLayout(390, 844, { top: 47, left: 0, right: 0, bottom: 34 }).tray).toBe(tallLayout(390, 844).tray + 24);
  });

  it("never makes a tall card smaller than a fingertip, and at least 56px wide on real phones", () => {
    // From 280px: a foldable's cover screen (the original Galaxy Fold's is 280x653).
    for (let w = 280; w <= 2000; w += 7) {
      for (let h = 300; h <= 1600; h += 47) {
        const t = tallLayout(w, h);
        const at = `${w}x${h}`;
        expect(t.cardW, at).toBeGreaterThanOrEqual(CARD_TOUCH_MIN - 1e-9);
        expect(t.cardH, at).toBeGreaterThanOrEqual(CARD_TOUCH_MIN);
        if (w >= 360) expect(t.cardW, at).toBeGreaterThanOrEqual(TALL_CARD_MIN);
        expect(t.cardW, at).toBeLessThanOrEqual(TALL_CARD_MAX);
        expect(t.cardH, at).toBeCloseTo(cardHeight(t.cardW), 9);
        // 4:5 art inside the 3px border.
        expect((t.cardH - 6) / (t.cardW - 6), at).toBeCloseTo(CARD_ASPECT, 9);
      }
    }
    // Under 299px the tray's gutters and gaps give way first, only as far as
    // the cards need; wider screens keep the stylesheet's own.
    const fold = tallLayout(280, 653);
    expect(fold.cardW).toBeCloseTo(CARD_TOUCH_MIN, 9);
    expect(fold.handW).toBeCloseTo(280, 9);
    expect(fold.gutter).toBeLessThan(TRAY_GUTTER);
    expect(fold.gutter).toBeGreaterThanOrEqual(0.4 * TRAY_GUTTER);
    expect(fold.gap / fold.gutter).toBeCloseTo(TRAY_GAP / TRAY_GUTTER, 9);
    for (const w of [299, 300, 320, 360, 390]) {
      expect(tallLayout(w, 700).gutter, `${w}`).toBe(TRAY_GUTTER);
      expect(tallLayout(w, 700).gap, `${w}`).toBe(TRAY_GAP);
    }
    // No cliff where the squeeze starts: one pixel narrower, never a jump.
    for (let w = 270; w < 330; w++) {
      expect(Math.abs(tallLayout(w + 1, 700).cardW - tallLayout(w, 700).cardW), `${w}`).toBeLessThanOrEqual(0.26);
    }
  });

  it("caps tall cards by the screen's height (down to the 56px floor) and fits the tray's row in the width", () => {
    for (const safe of SAFES) {
      for (let w = 280; w <= 2000; w += 53) {
        for (let h = 300; h <= 1600; h += 47) {
          const t = tallLayout(w, h, safe);
          const at = `${w}x${h} ${JSON.stringify(safe)}`;
          expect(t.cardH, at).toBeLessThanOrEqual(Math.max(cardHeight(TALL_CARD_MIN), TALL_CARD_H_FRAC * h) + 1e-9);
          // Next, four cards, KING, five gaps and the gutters: inside the safe width.
          expect(t.handW, at).toBeLessThanOrEqual(w - safe.left - safe.right + 1e-9);
          expect(t.handW, at).toBeCloseTo(2 * t.gutter + 5 * t.gap + 4 * t.cardW + t.nextW + t.kingW, 9);
          if (w - safe.left - safe.right >= 299) expect(2 * t.gutter + 5 * t.gap, at).toBe(16 + 25);
          // Next shows a mini card and KING stays a full finger target.
          expect(t.nextW, at).toBeGreaterThanOrEqual(36);
          expect(t.kingW, at).toBeGreaterThanOrEqual(46);
          if (w - safe.left - safe.right >= 320) expect(t.nextW, at).toBeLessThan(t.cardW);
        }
      }
    }
    // Phones spend their whole width on the row; tablets keep a centred hand.
    for (const [w, h] of [[390, 844], [412, 915], [430, 932]]) expect(tallLayout(w, h).handW, `${w}x${h}`).toBeCloseTo(w, 9);
    for (const [w, h] of TABLETS) expect(tallLayout(w, h).handW, `${w}x${h}`).toBeLessThan(w * 0.75);
    // Next and KING grow with the cards where there is width to spare.
    expect(tallLayout(820, 1180).kingW).toBeGreaterThan(tallLayout(390, 844).kingW + 8);
  });

  it("puts landscape screens in wide mode with full-height boards between side panels", () => {
    for (const [w, h] of LANDSCAPE) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("wide");
      expect(lay.box).toBe(BATTLE_BOX);
      expect(lay.insets).toEqual({ top: 0, bottom: 0, left: lay.side + SIDE_GAP, right: lay.side + SIDE_GAP });
      // Full height: the far king's plate clear of the top edge, the near king's of the bottom one.
      expect(lay.tile, `${w}x${h}`).toBeCloseTo(heightScale(h, BATTLE_BOX), 6);
      // A 2x2 block of cards, never the old screen-high column.
      expect(lay.handCols, `${w}x${h}`).toBe(2);
      expect(handPanelHeight(lay.cardW, lay.handCols, lay.stacked), `${w}x${h}`).toBeLessThanOrEqual(0.62 * h + 110);
    }
  });

  it("shrinks the wide hand: smaller cards in a narrower panel than before", () => {
    const cases: [number, number, number, number][] = [
      // w, h, the old card width, the old side column
      [844, 390, 85, 269],
      [1024, 768, 99, 218],
      [1366, 768, 131, 320],
      [1440, 900, 131, 320],
      [1920, 1080, 131, 320],
    ];
    for (const [w, h, oldCard, oldSide] of cases) {
      const lay = battleLayout(w, h);
      const at = `${w}x${h}`;
      expect(before.wide(w, h, ZERO_INSETS, LEGACY_BOX).side, at).toBe(oldSide);
      expect(lay.cardW, at).toBeLessThan(oldCard);
      expect(lay.cardW, at).toBeLessThanOrEqual(wideCardCap(h));
      // Narrower than the old panels around the same board (today's, with the far king's crown).
      expect(lay.side, at).toBeLessThanOrEqual(before.wide(w, h).side);
      expect(lay.side, at).toBeLessThanOrEqual(sideMax(h));
    }
    expect(battleLayout(1440, 900).cardW).toBeLessThanOrEqual(104);
    expect(battleLayout(1920, 1080).cardW).toBeLessThanOrEqual(112);
  });

  it("keeps near-square and small landscape windows wide: the board gives up height, not the panels", () => {
    // (The board with the far king's crown is a little narrower for its
    // height than the old box, so these windows are a little narrower too.)
    for (const [w, h] of [
      [560, 400],
      [610, 480],
      [670, 560],
      [900, 900],
      [980, 1000],
    ]) {
      const lay = battleLayout(w, h);
      expect(lay.mode, `${w}x${h}`).toBe("wide");
      expect(lay.side, `${w}x${h}`).toBe(SIDE_MIN);
      expect(lay.fieldW, `${w}x${h}`).toBe(w - 2 * (SIDE_MIN + SIDE_GAP));
      // Width-bound between the panels, so the whole board still shows.
      const f = fitBattleFrustum(w, h, lay.insets, lay.box);
      expect(w / (f.right - f.left), `${w}x${h}`).toBeCloseTo(lay.fieldW / (2 * BATTLE_BOX.halfW), 6);
      expect(lay.fieldW / (2 * BATTLE_BOX.halfW)).toBeLessThanOrEqual(heightScale(h, BATTLE_BOX));
      // The slimmer panels (144px, were 176px) hand their width to the board.
      expect(lay.tile, `${w}x${h}`).toBeGreaterThan(before.tile(w, h) * 1.1);
    }
    // 568x320, 760x600 and an unfolded foldable in landscape now fit a
    // full-height board between the panels.
    for (const [w, h] of [[568, 320], [760, 600], [884, 768]]) {
      const lay = battleLayout(w, h);
      expect(lay.tile, `${w}x${h}`).toBeCloseTo(heightScale(h, BATTLE_BOX), 6);
      // (Only a little bigger: the old 176px panels nearly fit beside today's narrower board too.)
      expect(lay.tile, `${w}x${h}`).toBeGreaterThan(before.tile(w, h) * 1.005);
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
    // Portrait: the notch pushes the band down, the home indicator the cards
    // up. The board was just width-bound; the far king's crown under the band
    // now costs it a little height (less where the chips leave his column free).
    const notched = { top: 47, left: 0, right: 0, bottom: 34 };
    const tall = battleLayout(390, 844, notched);
    expect(tall.mode).toBe("tall");
    expect(tall.tile).toBeCloseTo(heightScale(844 - tall.tray - 83 - 47, TALL_BOX), 9);
    expect(tall.tile).toBeGreaterThan(0.9 * (390 / (2 * TALL_BOX.halfW)));
  });

  it("never squeezes the panels, the hand or the board", () => {
    for (const safe of SAFES) {
      for (let w = 300; w <= 3000; w += 37) {
        for (let h = 300; h <= 1600; h += 41) {
          const lay = battleLayout(w, h, safe);
          if (lay.mode !== "wide") continue;
          const at = `${w}x${h} ${JSON.stringify(safe)}`;
          expect(lay.side, at).toBeGreaterThanOrEqual(SIDE_MIN);
          expect(lay.side, at).toBeLessThanOrEqual(Math.max(SIDE_MIN, sideMax(h)));
          expect(lay.fieldW + 2 * (lay.side + SIDE_GAP), at).toBeLessThanOrEqual(w - safe.left - safe.right + 1);
          // The hand fits its panel both ways, and is a usable size.
          expect(handGridW(lay.cardW, lay.handCols), at).toBeLessThanOrEqual(handPanelInnerW(lay.side));
          expect(handPanelHeight(lay.cardW, lay.handCols, lay.stacked), at).toBeLessThanOrEqual(handPanelBudget(h, safe));
          expect(lay.cardW, at).toBeLessThanOrEqual(wideCardCap(h));
          expect(lay.cardH, at).toBeCloseTo(cardHeight(lay.cardW), 9);
          // Fingertip-sized cards on any real landscape screen (a portrait
          // notch's insets on a 300px-tall window are not one).
          if (h >= 320 && safe.top + safe.bottom <= 21) expect(lay.cardW, at).toBeGreaterThanOrEqual(CARD_TOUCH_MIN);
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

  it("never draws a smaller board than the layout before it, on any screen", () => {
    for (const safe of SAFES) {
      for (let w = 320; w <= 2000; w += 23) {
        for (let h = 320; h <= 1400; h += 19) {
          expect(realTile(w, h, safe), `${w}x${h} ${JSON.stringify(safe)}`).toBeGreaterThanOrEqual(before.tile(w, h, safe) - 1e-9);
        }
      }
    }
  });

  it("gives the hand's room to the board: the acceptance screens", () => {
    // w, h, the least the board must grow (1 = the same size: it already
    // spanned the screen's width or height before).
    const cases: [number, number, number][] = [
      [360, 640, 1.15],
      [375, 667, 1.14],
      [390, 844, 1],
      [412, 915, 1],
      [768, 1024, 1.13],
      [820, 1180, 1.09],
      [844, 390, 1],
      [1024, 768, 1],
      [1366, 768, 1],
      [1440, 900, 1],
      [1920, 1080, 1],
    ];
    for (const [w, h, gain] of cases) {
      const at = `${w}x${h}`;
      expect(realTile(w, h) / before.tile(w, h), at).toBeGreaterThanOrEqual(gain - 1e-9);
      const lay = battleLayout(w, h);
      // The hand itself is smaller on every one of them.
      if (lay.mode === "tall") {
        expect(lay.tray, at).toBeLessThan(before.tall(w, h).tray * 0.68);
        expect(lay.cardW, at).toBeLessThan(before.tall(w, h).cardW);
      }
    }
    // Width-bound phones cannot grow the board: the slimmer tray leaves
    // height over instead, which the frame spends around the board, most
    // of it on the far king's crown (his canopy and plate under the band).
    for (const [w, h] of [[390, 844], [412, 915]]) {
      const lay = battleLayout(w, h);
      expect(lay.tile, `${w}x${h}`).toBeCloseTo(w / (2 * TALL_BOX.halfW), 9);
      const crown = TALL_BOX.crown!;
      const span = crown.top - (TALL_BOX.mid - TALL_BOX.height / 2);
      const slack = h - lay.tray - 83 - (span * lay.tile + crown.padTop + (TALL_BOX.padBottom ?? 0));
      expect(slack, `${w}x${h}`).toBeGreaterThan(10);
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
