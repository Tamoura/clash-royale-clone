/**
 * Battle screen layout, as pure math (layoutWire.ts applies it to the DOM).
 *
 * - "tall" (phones, portrait tablets): the board fills the width, the
 *   scoreboard floats over its top and the card tray sits under it, as in
 *   Clash Royale. The tray's cards are capped by the screen's height as
 *   well as its width, so the tray never eats a short screen.
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
 * result (CSS through :root's data-layout / data-side / data-panel and the --side,
 * --field-w, --card-w, --hand-cols and --hand-w variables), so they never
 * disagree.
 */
import { BATTLE_BOX, TALL_BOX, ZERO_INSETS, type ContentBox, type Insets } from "../render3d/scene/fit";

/** Narrowest side panel: the left one's clock + menu row and name pills need it. */
export const SIDE_MIN = 176;
/** Widest side panel: past this the cards stop growing. */
export const SIDE_MAX = 320;
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
/** Widest tall-mode hand (CSS px): tablets keep big cards, not giant ones. */
export const TALL_HAND_MAX = 560;
/** A tall-mode card is never taller than this share of the screen's height. */
export const TALL_CARD_H_FRAC = 0.16;

// ── The stylesheet's numbers (styles/hud.css; keep them in step) ──
/** Tall hand row: 16px gutters + 3 gaps of 8px. */
const TALL_HAND_CHROME = 56;
/** Tall tray minus its cards: 4px top border, 12px top padding, 16px elixir margin, 42px droplet, 8px bottom padding. */
const TALL_TRAY_CHROME = 82;
/** The tall tray's bottom padding, which env(safe-area-inset-bottom) replaces when larger. */
const TALL_TRAY_PAD_B = 8;
/** The scoreboard band over the board's top: one row (tablets, short phones) or two. */
const BAND_ONE_ROW = 58;
const BAND_TWO_ROWS = 83;
/** Wide panels keep at least this far from the screen's top and bottom. */
const PANEL_MARGIN = 12;
/** A wide panel is its column minus 12px each side. */
const PANEL_INSET = 24;
/** Panel border (3 + 3) and side padding (8 + 8). */
const PANEL_CHROME_W = 22;
/** Panel border (3 + 3), top padding (16) and bottom padding (12). */
const PANEL_CHROME_H = 34;
/** Between the hand's two columns, and between its rows (the cost droplet hangs 12px below a card). */
const HAND_GAP_X = 12;
const HAND_GAP_Y = 22;
/** Inline panel: Next (label over a mini card, 68px) beside the elixir bar, 18px under the hand. */
const INLINE_FOOT = 18 + 68;
/** Stacked panel: the Next row (label beside a mini card, 50px, then 10px) on top; the elixir row (42px, 18px under the hand) at the foot. */
const STACKED_HEAD = 50 + 10;
const STACKED_FOOT = 18 + 42;

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
  /** Hand card width (CSS px). */
  cardW: number;
  /** Wide: the hand's columns in its panel (2 = 2x2, 1 = one column). Tall: 4. */
  handCols: number;
  /** Wide: Next on its own row above the hand and a full-width elixir bar. */
  stacked: boolean;
  /** Tall: the hand row's width (CSS px; 0 when wide). */
  handW: number;
  /** The board's predicted scale: CSS px per tile. */
  tile: number;
}

/** A hand card's height for its width: 3:4 art inside a 3px border. */
export const cardHeight = (cw: number): number => ((cw - 6) * 4) / 3 + 6;
/** The widest card at most `ch` tall. */
const cardForHeight = (ch: number): number => ((ch - 6) * 3) / 4 + 6;

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

/** How much height a wide hand panel may take on a `h`-tall screen. */
export function handPanelBudget(h: number, safe: Insets = ZERO_INSETS): number {
  return h - Math.max(PANEL_MARGIN, safe.top) - Math.max(PANEL_MARGIN, safe.bottom);
}

/** The tall candidate: the board spans the width, over a tray sized by width and height. */
export function tallLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout {
  const availW = Math.max(1, w - safe.left - safe.right);
  const capByHeight = 4 * cardForHeight(TALL_CARD_H_FRAC * h) + TALL_HAND_CHROME;
  const handW = Math.max(TALL_HAND_CHROME + 4, Math.floor(Math.min(availW, TALL_HAND_MAX, capByHeight)));
  const cardW = (handW - TALL_HAND_CHROME) / 4;
  const tray = cardHeight(cardW) + TALL_TRAY_CHROME + Math.max(0, safe.bottom - TALL_TRAY_PAD_B);
  // styles/hud.css: the one-row band is (min-width: 600px), (min-aspect-ratio: 47/100).
  const band = (w >= 600 || w / h >= 0.47 ? BAND_ONE_ROW : BAND_TWO_ROWS) + safe.top;
  // The tile is one world unit across (the field's 18 tiles span x = -9..9).
  const tile = Math.max(0, Math.min(w / (2 * TALL_BOX.halfW), (h - tray - band) / TALL_BOX.height));
  return { mode: "tall", side: 0, fieldW: 0, insets: ZERO_INSETS, box: TALL_BOX, cardW, handCols: 4, stacked: false, handW, tile };
}

/** The wide candidate (null when the panels would leave no board at all). */
export function wideLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout | null {
  const availW = w - safe.left - safe.right;
  const availH = Math.max(1, h - safe.top - safe.bottom);
  // The whole board at full height is this wide (0.7425 x the height).
  const fieldCol = ((2 * BATTLE_BOX.halfW) / BATTLE_BOX.height) * availH;
  const room = (availW - fieldCol) / 2 - SIDE_GAP;
  const side = Math.floor(Math.max(SIDE_MIN, Math.min(SIDE_MAX, room)));
  // Full height when both panels fit beside it, else the width between them.
  const fieldW = Math.min(fieldCol, availW - 2 * (side + SIDE_GAP));
  if (fieldW <= 0) return null;

  // The hand panel's height budget, clear of the screen edges and the safe area.
  const panelH = handPanelBudget(h, safe);
  const inner = handPanelInnerW(side);
  // The widest card that fits `cols` columns (4 / cols rows) in the panel.
  const fit = (cols: number, stacked: boolean): number => {
    const free = panelH - panelChromeH(cols, stacked);
    return Math.max(0, Math.min((inner - (cols - 1) * HAND_GAP_X) / cols, cardForHeight(free / (4 / cols))));
  };
  // Roomy panels keep the 2x2 hand with Next beside the elixir bar. Narrow
  // ones take whichever arrangement gives the biggest cards: near-square
  // windows have height to spare but little width, so there one tall column
  // of cards beats a squeezed 2x2.
  const narrow = side < SIDE_ROOMY;
  let best = { cols: 2, stacked: false, cw: fit(2, false), score: 0 };
  for (const cols of narrow ? [2, 1] : [2]) {
    for (const stacked of narrow ? [false, true] : [false]) {
      const cw = fit(cols, stacked);
      const score = cw * (stacked || !narrow ? 1 : SQUEEZED_BAR);
      if (score > best.score) best = { cols, stacked, cw, score };
    }
  }
  return {
    mode: "wide",
    side,
    fieldW: Math.round(fieldW),
    box: BATTLE_BOX,
    // The board's column: everything but the panels and their gaps.
    insets: { top: safe.top, bottom: safe.bottom, left: side + SIDE_GAP + safe.left, right: side + SIDE_GAP + safe.right },
    cardW: Math.floor(best.cw),
    handCols: best.cols,
    stacked: best.stacked,
    handW: 0,
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
