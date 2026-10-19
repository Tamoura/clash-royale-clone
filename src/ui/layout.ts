/**
 * Battle screen layout, as pure math (layoutWire.ts applies it to the DOM).
 *
 * - "tall" (phones, portrait tablets, near-square windows): the board fills
 *   the width, the scoreboard floats over its top and the card tray sits
 *   under it, as in Clash Royale.
 * - "wide" (landscape phones and tablets, laptops, desktops): the board
 *   fills the full height in the middle, with the hand in a panel on the
 *   right and the clock, scores, King and chat on the left. Chosen only
 *   when both panels fit at a usable width beside a full-height board, so
 *   the board is always bigger than the tall layout would make it there.
 *
 * CSS and the camera both read the one result (CSS through :root's
 * data-layout and --side / --field-w), so they never disagree.
 */
import { BATTLE_BOX, TALL_BOX, ZERO_INSETS, type ContentBox, type Insets } from "../render3d/scene/fit";

/** Narrowest side panel worth having (two cards of ~60px plus padding). */
export const SIDE_MIN = 176;
/** Widest side panel: past this the cards stop growing. */
export const SIDE_MAX = 320;
/** Breathing room between the board's edging and a panel. */
export const SIDE_GAP = 8;

export type LayoutMode = "tall" | "wide";

export interface BattleLayout {
  mode: LayoutMode;
  /** Width of each side panel's column (CSS px; 0 when tall). */
  side: number;
  /** Width of the full-height board column (CSS px; 0 when tall). */
  fieldW: number;
  /** What the panels cover around the canvas (tall measures its band at runtime). */
  insets: Insets;
  box: ContentBox;
}

/** Pick the layout for a w x h viewport with the given safe-area insets. */
export function battleLayout(w: number, h: number, safe: Insets = ZERO_INSETS): BattleLayout {
  const availH = Math.max(1, h - safe.top - safe.bottom);
  // The whole board at full height is this wide (0.7425 x the height).
  const fieldCol = ((2 * BATTLE_BOX.halfW) / BATTLE_BOX.height) * availH;
  const room = (w - safe.left - safe.right - fieldCol) / 2 - SIDE_GAP;
  if (room < SIDE_MIN) return { mode: "tall", side: 0, fieldW: 0, insets: ZERO_INSETS, box: TALL_BOX };
  const side = Math.round(Math.min(SIDE_MAX, room));
  return {
    mode: "wide",
    side,
    fieldW: Math.round(fieldCol),
    box: BATTLE_BOX,
    insets: { top: safe.top, bottom: safe.bottom, left: side + safe.left, right: side + safe.right },
  };
}
