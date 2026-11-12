/**
 * The battle frame as pure math: fit a content box (the field plus a bit
 * of its edging, in camera space) into the canvas minus the HUD's insets
 * on any side. The frustum still covers the whole canvas, so the arena
 * scenery fills the space behind the HUD; only the content box is
 * guaranteed to stay clear of it. No THREE here, so it is unit-tested
 * directly (fit.test.ts) and shared with the layout code (ui/layout.ts).
 *
 * The box is sized from the towers as built (kingExtents.test.ts pins the
 * numbers below to their geometry): the board from the near king's HP
 * plate to the far lanterns, and over its middle a "crown", the far king's
 * column, which rises past the lanterns with his canopy and his HP plate
 * on top. The crown is the tallest thing on the board; on a portrait phone
 * only the scoreboard chips that sit over it hold it down (Insets.crownTop).
 * The gaps a plate keeps to its tower and to the tray are pixels (pads);
 * its gap to the screen's edge grows with the board (EDGE_GAP).
 */

/** CSS pixels the HUD covers along each edge of the canvas. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /**
   * What covers the crown's column (ContentBox.crown) from the top, where
   * that is less than `top` (tall: only the scoreboard chips over the far
   * king, not the whole band). Defaults to `top`.
   */
  crownTop?: number;
}

/** An orthographic frustum (camera-space units). */
export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A column over the content box's middle that rises past its top edge. */
export interface Crown {
  /** Half its width about the centre line (camera-space units). */
  halfW: number;
  /** Its top, in camera-up units. */
  top: number;
  /** CSS px kept clear over it. */
  padTop: number;
}

/** Content to keep on screen, in camera-space units (x: right, y: camera-up). */
export interface ContentBox {
  /** Half its width, about the camera's centre line. */
  halfW: number;
  /** Its screen-space depth. */
  height: number;
  /** Its centre, in camera-up units. */
  mid: number;
  /** CSS px kept clear over its top edge and under its bottom one (default 0). */
  padTop?: number;
  padBottom?: number;
  /** The far king's column, if it rises past the top edge. */
  crown?: Crown;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// ── The kings, as built (camera-up units of the host's view; the guest's camera is its mirror image) ──
/**
 * The far king's top: his canopy's tip, which rides on the king under it.
 * With the cast king (2.063 tall in his tower) the Golden Age qubba reaches
 * 15.107, the Classic pavilion 14.90 (15.06 with the gilded finials of flair
 * tier 1 and up); this holds a king up to 2.07 tall.
 */
export const FAR_KING_TOP = 15.12;
/** A king's HP plate: its level shield stands PLATE_HALF (0.3) either side of its centre, at TOWER_SCALE 1.1. */
export const KING_PLATE_H = 0.66;
/** The near king's gate foot (-11.745): his plate hangs under it. */
export const NEAR_KING_FOOT = -11.75;
/**
 * What rises past the far lanterns, about the centre line: his roofs and
 * canopy (1.67) and his plate, whose level shield reaches 2.06 to the left;
 * then a little room (about 5 px on a phone) to the chips beside it.
 */
export const CROWN_HALF_W = 2.3;
/** The far lanterns: the board's top edge beside the crown (the box before the crown). */
export const FAR_EDGE = 14;
/**
 * Between an HP plate and the screen's edge, or the scoreboard chips over
 * the far king, in camera-space units, so it grows with the board: about
 * 10 px on a laptop (a plate there reads as framed, not pressed against the
 * edge), 4 px on a landscape phone, whose every pixel goes to the board.
 */
export const EDGE_GAP = 0.32;

// ── Pixel gaps (they do not scale with the board) ──
/** CSS px between an HP plate and the roofs or gate it labels (towers.ts: PLATE_CLEAR_PX and a 2 px margin). */
export const PLATE_GAP_PX = 6;
/** CSS px the tall band's inset already keeps under its chips (layoutWire.ts). */
export const BAND_GAP_PX = 4;
/**
 * CSS px a near HP plate keeps over the tall tray's top edge: the tray's
 * ornament stands about 6 px above it, then a 4 px gap.
 */
export const TRAY_MARK_PX = 10;

/** The far king's column: his plate's top (and its gap) over his canopy, its own gap to his roofs in px. */
const CROWN: Crown = { halfW: CROWN_HALF_W, top: FAR_KING_TOP + KING_PLATE_H + EDGE_GAP, padTop: PLATE_GAP_PX };
/** The near king's plate's bottom edge under his gate (its gap to the gate in px). */
const NEAR_PLATE = NEAR_KING_FOOT - KING_PLATE_H;

/** A box from `bottom` to the far lanterns, `halfW` wide, with the far king's crown over it. */
function boardBox(halfW: number, bottom: number, padBottom: number): ContentBox {
  return { halfW, height: FAR_EDGE - bottom, mid: (FAR_EDGE + bottom) / 2, padBottom, crown: CROWN };
}

/**
 * Wide (side panels): the whole board, field half-width + edging, from the
 * near king's plate (its edge gap under it) to the far lanterns, and the far
 * king's column over them, his plate clear of the screen's top edge.
 */
export const BATTLE_BOX: ContentBox = boardBox(9.95, NEAR_PLATE - EDGE_GAP, PLATE_GAP_PX);

/**
 * Portrait: the field is ±9 wide; keep a 0.25-unit sliver of edging so the
 * boundary still reads. Narrow screens are width-bound, so every bit of
 * edging given up here goes straight into bigger troops. The near plate
 * clears the tray's ornament under the board.
 */
export const TALL_BOX: ContentBox = boardBox(9.25, NEAR_PLATE, PLATE_GAP_PX + TRAY_MARK_PX);

/** The top inset never takes more than this share of the canvas. */
export const MAX_TOP_FRAC = 0.25;

/**
 * Where the board sits when the free rectangle is taller than it (portrait
 * phones are width-bound, so a slimmer tray leaves height over): this share
 * of the slack goes above it. A little over half: the far towers stand
 * clear of the scoreboard and the far stands show, while the player's own
 * half stays close to the hand.
 */
export const TALL_ALIGN_Y = 0.6;

/** The box's bottom edge, in camera-up units. */
const bottomOf = (box: ContentBox): number => box.mid - box.height / 2;

/**
 * The content's parts as [room, span]: the px each has between its own top
 * line (its inset and pad) and the box's lowest allowed bottom edge, and how
 * many camera-up units it rises over that edge. The board's top edge always;
 * the crown when there is one.
 */
function parts(floor: number, top: number, crownTop: number, box: ContentBox): [number, number][] {
  const out: [number, number][] = [[floor - top - (box.padTop ?? 0), box.height]];
  const c = box.crown;
  if (c) out.push([floor - crownTop - c.padTop, c.top - bottomOf(box)]);
  return out;
}

/** The largest scale (px per unit) at which every part fits its room. */
function scaleFor(ps: [number, number][], cap: number): number {
  let s = cap;
  for (const [room, span] of ps) s = Math.min(s, Math.max(1, room) / span);
  return s;
}

/**
 * The scale (CSS px per unit) `box` fits at in `availH` px of height (between
 * a top inset and a bottom one, with nothing narrower over its crown), pads
 * and crown included. The layout predicts the board with it.
 */
export function heightScale(availH: number, box: ContentBox): number {
  return scaleFor(parts(availH - (box.padBottom ?? 0), 0, 0, box), Infinity);
}

/**
 * Fit `box` into the canvas (w × h CSS px) minus `ins`, as large as it
 * goes: its board under the top inset, its crown under `ins.crownTop`, both
 * with their pads, its bottom edge over the bottom inset and its pad. It is
 * centred across the free rectangle; `alignY` moves it along a free
 * rectangle taller than it (0 = against the top, 1 = against the bottom).
 * The frustum covers the whole canvas at that scale (it always matches the
 * canvas aspect, so nothing stretches).
 */
export function fitBattleFrustum(w: number, h: number, ins: Insets, box: ContentBox = BATTLE_BOX, alignY = 0.5): Frustum {
  w = Math.max(1, w);
  h = Math.max(1, h);
  const cap = (v: number): number => Math.min(Math.max(0, v), MAX_TOP_FRAC * h);
  const aw = Math.max(1, w - ins.left - ins.right);
  // The lowest the box's bottom edge may go, on screen.
  const floor = h - ins.bottom - (box.padBottom ?? 0);
  const ps = parts(floor, cap(ins.top), cap(ins.crownTop ?? ins.top), box);
  const s = scaleFor(ps, aw / (2 * box.halfW)); // px per world unit
  // The bottom edge's screen y: as high as every part allows, then along the slack.
  let hi = -Infinity;
  for (const [room, span] of ps) hi = Math.max(hi, floor - room + span * s);
  const slack = Math.max(0, floor - hi);
  const yBottom = hi + Math.min(1, Math.max(0, alignY)) * slack;
  const cx = ins.left + aw / 2;
  const left = -cx / s;
  const t = bottomOf(box) + yBottom / s;
  return { left, right: left + w / s, top: t, bottom: t - h / s };
}
