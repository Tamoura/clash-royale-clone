/**
 * Battle screen layout, as pure math (layoutWire.ts applies it to the DOM).
 *
 * - "tall" (phones, portrait tablets): the board fills the width, the
 *   scoreboard floats over its top and one compact tray sits under it: a
 *   slim elixir rail along the tray's top edge, then a single row of Next
 *   (over the chat bubble), the four cards and KING. Nothing of the HUD
 *   floats over the board any more. Cards are capped by the screen's
 *   height as well as its width, so the tray stays a thin strip.
 * - "wide" (landscape phones and tablets, laptops, desktops, near-square
 *   windows): the board sits in the middle between two side panels, the
 *   hand on the right and the clock, scores, King and chat on the left.
 *   With room to spare the board fills the full height; on narrower
 *   windows the panels keep their minimum width and the board gives up a
 *   little height instead (it then fills the width between them), so the
 *   board shrinks smoothly as the window narrows instead of jumping.
 *
 * Both candidates are sized from the stylesheet's own numbers and the one
 * that draws the bigger board wins. CSS and the camera both read the one
 * result (CSS through :root's data-layout / data-side / data-slim /
 * data-panel and the --side, --field-w, --card-w, --card-h, --next-w,
 * --king-w, --gutter-w, --gap-w and --hand-cols variables), so they never
 * disagree.
 */
import { BATTLE_BOX, TALL_BOX, ZERO_INSETS, heightScale, type ContentBox, type Insets } from "../render3d/scene/fit";

/** Narrowest side panel: the left one's clock + menu row needs it, the right one a column of cards. */
export const SIDE_MIN = 144;
/**
 * Side panels narrower than this are "slim": the left panel's clock drops
 * its "TIME LEFT" caption (it wrapped onto two lines beside the menu).
 */
export const SIDE_SLIM = 176;
/** Breathing room between the board's edging and a panel. */
export const SIDE_GAP = 8;
/**
 * Side panels narrower than this are "narrow": the hand panel may stack
 * Next on its own row above the hand so the elixir bar gets the panel's
 * full width (its ten segments stay readable), and the left panel's clock
 * tightens up.
 */
export const SIDE_ROOMY = 240;
/**
 * How much a squeezed elixir bar (Next beside it in a narrow panel) is worth
 * in card size: the stacked arrangement wins unless the inline one gives
 * cards more than ~18% bigger (short landscape phones).
 */
const SQUEEZED_BAR = 0.85;
/**
 * One tall column of cards runs the panel down the whole screen; the 2x2
 * block is a smaller thing beside the board. The column only wins when its
 * cards are a third bigger.
 */
const ONE_COLUMN = 0.75;

// ── Cards (styles/hud.css; keep them in step) ──
/** A hand card's art is 4:5 (cropped on the character), inside a 3px border. */
export const CARD_ASPECT = 1.25;
const CARD_BORDER = 3;
/** The smallest card a finger still hits comfortably (CSS px). */
export const CARD_TOUCH_MIN = 44;

/** A hand card's height for its width. */
export const cardHeight = (cw: number): number => (cw - 2 * CARD_BORDER) * CARD_ASPECT + 2 * CARD_BORDER;
/** The widest card at most `ch` tall. */
const cardForHeight = (ch: number): number => (ch - 2 * CARD_BORDER) / CARD_ASPECT + 2 * CARD_BORDER;

// ── The tall tray (styles/hud.css; keep them in step) ──
/** A tall-mode card is at most this share of the screen's height... */
export const TALL_CARD_H_FRAC = 0.1;
/** ...but the height cap never squeezes it under this width (short phones)... */
export const TALL_CARD_MIN = 56;
/** ...and tablets stop here: the board is the hero, not the hand. */
export const TALL_CARD_MAX = 96;
/** The tray's side gutters, and the gap between its six columns... */
export const TRAY_GUTTER = 8;
export const TRAY_GAP = 5;
/**
 * ...which a screen too narrow for four fingertip-sized cards beside Next
 * and KING (under 299px, a foldable's 280px cover screen) squeezes, only as
 * far as the cards need and to no less than this share of them.
 */
const TRAY_SQUEEZE_MIN = 0.4;
/** The Next column (a mini card over the chat bubble) and the KING column, at their narrowest... */
const NEXT_MIN = 36;
const KING_MIN = 46;
/** ...and with width to spare (tablets), as shares of a card up to these widths. */
const NEXT_SHARE = 0.56;
const NEXT_MAX = 56;
const KING_SHARE = 0.7;
const KING_MAX = 62;
/** The tall tray's bottom padding (the cost droplets hang into it), which env(safe-area-inset-bottom) replaces when larger. */
const TALL_TRAY_PAD_B = 10;
/** Tall tray minus its cards: 3px top border, 6px top padding, the 16px elixir rail, 7px to the cards, the bottom padding. */
const TALL_TRAY_CHROME = 3 + 6 + 16 + 7 + TALL_TRAY_PAD_B;
/** The scoreboard band over the board's top: one row (tablets, short phones) or two. */
const BAND_ONE_ROW = 58;
const BAND_TWO_ROWS = 83;

// ── The wide hand panel (styles/hud.css; keep them in step) ──
/** A wide-mode card is at most this share of the screen's height, between these widths. */
const WIDE_CARD_H_FRAC = 0.115;
const WIDE_CARD_LO = 72;
const WIDE_CARD_HI = 112;
/** Wide panels keep at least this far from the screen's top and bottom. */
const PANEL_MARGIN = 12;
/** A wide panel is its column minus 12px each side. */
const PANEL_INSET = 24;
/** Panel border (2 + 2) and side padding (8 + 8). */
const PANEL_CHROME_W = 20;
/** Panel border (2 + 2), top padding (12) and bottom padding (10). */
const PANEL_CHROME_H = 26;
/** Between the hand's two columns, and between its rows (the cost droplet hangs 9px below a card). */
const HAND_GAP_X = 10;
const HAND_GAP_Y = 16;
/** Inline panel: Next (a mini card over its label tab, 52px) beside the elixir bar, 14px under the hand. */
const INLINE_FOOT = 14 + 52;
/** Stacked panel: the Next row (label beside a mini card, 40px, then 8px) on top; the elixir row (30px, 14px under the hand) at the foot. */
const STACKED_HEAD = 40 + 8;
const STACKED_FOOT = 14 + 30;

export type LayoutMode = "tall" | "wide";

export interface BattleLayout {
  mode: LayoutMode;
  /** Width of each side panel's column (CSS px; 0 when tall). */
  side: number;
  /** Width of the board's column between the panels (CSS px; 0 when tall). */
  fieldW: number;
  /** What the panels cover around the canvas (tall measures its band at runtime). */
  insets: Insets;
  box: ContentBox;
  /** Hand card width and height (CSS px). */
  cardW: number;
  cardH: number;
  /** Wide: the hand's columns in its panel (2 = 2x2, 1 = one column). Tall: 4. */
  handCols: number;
  /** Wide: Next on its own row above the hand and a full-width elixir bar. */
  stacked: boolean;
  /** Tall: the tray's content width, gutters included (CSS px; 0 when wide). */
  handW: number;
  /** Tall: the Next column and the KING column (CSS px; 0 when wide). */
  nextW: number;
  kingW: number;
  /** Tall: the tray's side gutters and the gap between its columns (CSS px; 0 when wide). */
  gutter: number;
  gap: number;
  /** Tall: the tray's height (CSS px; 0 when wide, where the hand is a side panel). */
  tray: number;
  /** The board's predicted scale: CSS px per tile. */
  tile: number;
}

/** The widest card a wide hand panel shows on a `h`-tall screen. */
export function wideCardCap(h: number): number {
  return Math.max(WIDE_CARD_LO, Math.min(WIDE_CARD_HI, WIDE_CARD_H_FRAC * h));
}

/** Widest side panel on a `h`-tall screen: a 2x2 of the biggest cards and its chrome. */
export function sideMax(h: number): number {
  return Math.ceil(PANEL_INSET + PANEL_CHROME_W + HAND_GAP_X + 2 * wideCardCap(h));
}

/** The wide hand panel's height around its cards: chrome, Next and elixir, and the gaps between card rows. */
function panelChromeH(cols: number, stacked: boolean): number {
  const rows = 4 / cols;
  return PANEL_CHROME_H + (stacked ? STACKED_HEAD + STACKED_FOOT : INLINE_FOOT) + (rows - 1) * HAND_GAP_Y;
}

/** The wide hand panel's height (CSS px) for its cards' width and arrangement. */
export function handPanelHeight(cardW: number, cols: number, stacked: boolean): number {
  return panelChromeH(cols, stacked) + (4 / cols) * cardHeight(cardW);
}

/** The width a wide hand panel's cards may fill, for a side column `side` wide. */
export const handPanelInnerW = (side: number): number => side - PANEL_INSET - PANEL_CHROME_W;

/** The width `cols` columns of `cardW`-wide cards take in a wide hand panel. */
export const handGridW = (cardW: number, cols: number): number => cols * cardW + (cols - 1) * HAND_GAP_X;

/** How much height a wide hand panel may take on a `h`-tall screen. */
export function handPanelBudget(h: number, safe: Insets = ZERO_INSETS): number {
  return h - Math.max(PANEL_MARGIN, safe.top) - Math.max(PANEL_MARGIN, safe.bottom);
}

/** The tall tray's height for its cards' width. */
export function trayHeight(cardW: number, safe: Insets = ZERO_INSETS): number {
  return cardHeight(cardW) + TALL_TRAY_CHROME + Math.max(0, safe.bottom - TALL_TRAY_PAD_B);
}

/** The tall candidate: the board spans the width, over a tray sized by width and height. */
export function tallLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout {
  const availW = Math.max(1, w - safe.left - safe.right);
  // Gutters and the five gaps between Next, the four cards and KING; on the
  // narrowest screens they give way first, so the cards stay finger-sized.
  const fullChrome = 2 * TRAY_GUTTER + 5 * TRAY_GAP;
  const room = availW - NEXT_MIN - KING_MIN;
  const fixed = Math.min(fullChrome, Math.max(TRAY_SQUEEZE_MIN * fullChrome, room - 4 * CARD_TOUCH_MIN));
  const squeeze = fixed / fullChrome;
  const byWidth = (room - fixed) / 4;
  const byHeight = Math.max(TALL_CARD_MIN, cardForHeight(TALL_CARD_H_FRAC * h));
  const cardW = Math.max(1, Math.min(byWidth, byHeight, TALL_CARD_MAX));
  // Width the cards leave over (tablets) lets Next and KING grow with them.
  const spare = Math.max(0, availW - fixed - 4 * cardW - NEXT_MIN - KING_MIN);
  const grow = (min: number, share: number, max: number): number =>
    min + Math.min(spare / 2, Math.max(0, Math.min(max, share * cardW) - min));
  const nextW = grow(NEXT_MIN, NEXT_SHARE, NEXT_MAX);
  const kingW = grow(KING_MIN, KING_SHARE, KING_MAX);
  const tray = trayHeight(cardW, safe);
  // styles/hud.css: the one-row band is (min-width: 600px), (min-aspect-ratio: 47/100).
  const band = (w >= 600 || w / h >= 0.47 ? BAND_ONE_ROW : BAND_TWO_ROWS) + safe.top;
  // The tile is one world unit across (the field's 18 tiles span x = -9..9).
  // The far king's column counts under the whole band here; the camera lets
  // it rise between the chips where they leave the middle free (tablets).
  const tile = Math.max(0, Math.min(w / (2 * TALL_BOX.halfW), heightScale(h - tray - band, TALL_BOX)));
  return {
    mode: "tall",
    side: 0,
    fieldW: 0,
    insets: ZERO_INSETS,
    box: TALL_BOX,
    cardW,
    cardH: cardHeight(cardW),
    handCols: 4,
    stacked: false,
    handW: fixed + 4 * cardW + nextW + kingW,
    nextW,
    kingW,
    gutter: TRAY_GUTTER * squeeze,
    gap: TRAY_GAP * squeeze,
    tray,
    tile,
  };
}

/** The wide candidate (null when the panels would leave no board at all). */
export function wideLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout | null {
  const availW = w - safe.left - safe.right;
  const availH = Math.max(1, h - safe.top - safe.bottom);
  // The whole board at full height (the far king's plate clear of the top
  // edge, the near king's of the bottom one) is this wide: just under 0.71 x the height.
  const fieldCol = 2 * BATTLE_BOX.halfW * heightScale(availH, BATTLE_BOX);
  const room = (availW - fieldCol) / 2 - SIDE_GAP;
  const side = Math.floor(Math.max(SIDE_MIN, Math.min(sideMax(h), room)));
  // Full height when both panels fit beside it, else the width between them.
  const fieldW = Math.min(fieldCol, availW - 2 * (side + SIDE_GAP));
  if (fieldW <= 0) return null;

  // The hand panel's height budget, clear of the screen edges and the safe area.
  const panelH = handPanelBudget(h, safe);
  const inner = handPanelInnerW(side);
  const cap = wideCardCap(h);
  // The widest card that fits `cols` columns (4 / cols rows) in the panel.
  const fit = (cols: number, stacked: boolean): number => {
    const free = panelH - panelChromeH(cols, stacked);
    return Math.max(0, Math.min(cap, (inner - (cols - 1) * HAND_GAP_X) / cols, cardForHeight(free / (4 / cols))));
  };
  // Roomy panels keep the 2x2 hand with Next beside the elixir bar. Narrow
  // ones take whichever arrangement scores best: bigger cards, a readable
  // elixir bar, and the compact 2x2 block over one screen-high column.
  const narrow = side < SIDE_ROOMY;
  let best = { cols: 2, stacked: false, cw: fit(2, false), score: 0 };
  for (const cols of narrow ? [2, 1] : [2]) {
    for (const stacked of narrow ? [false, true] : [false]) {
      const cw = fit(cols, stacked);
      const score = cw * (stacked || !narrow ? 1 : SQUEEZED_BAR) * (cols === 1 ? ONE_COLUMN : 1);
      if (score > best.score) best = { cols, stacked, cw, score };
    }
  }
  const cardW = Math.floor(best.cw);
  return {
    mode: "wide",
    side,
    fieldW: Math.round(fieldW),
    box: BATTLE_BOX,
    // The board's column: everything but the panels and their gaps.
    insets: { top: safe.top, bottom: safe.bottom, left: side + SIDE_GAP + safe.left, right: side + SIDE_GAP + safe.right },
    cardW,
    cardH: cardHeight(cardW),
    handCols: best.cols,
    stacked: best.stacked,
    handW: 0,
    nextW: 0,
    kingW: 0,
    gutter: 0,
    gap: 0,
    tray: 0,
    tile: fieldW / (2 * BATTLE_BOX.halfW),
  };
}

/**
 * Pick the layout for a w x h viewport with the given safe-area insets:
 * whichever of tall and wide draws the bigger board.
 */
export function battleLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout {
  const tall = tallLayout(w, h, safe);
  const wide = wideLayout(w, h, safe);
  return wide && wide.tile > tall.tile ? wide : tall;
}
