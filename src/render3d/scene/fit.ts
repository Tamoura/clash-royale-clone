/**
 * The battle frame as pure math: fit a content box (the field plus a bit
 * of its edging, in camera space) into the canvas minus the HUD's insets
 * on any side. The frustum still covers the whole canvas, so the arena
 * scenery fills the space behind the HUD; only the content box is
 * guaranteed to stay clear of it. No THREE here, so it is unit-tested
 * directly (fit.test.ts) and shared with the layout code (ui/layout.ts).
 */

/** CSS pixels the HUD covers along each edge of the canvas. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** An orthographic frustum (camera-space units). */
export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Content to keep on screen, in camera-space units (x: right, y: camera-up). */
export interface ContentBox {
  /** Half its width, about the camera's centre line. */
  halfW: number;
  /** Its screen-space depth. */
  height: number;
  /** Its centre, in camera-up units. */
  mid: number;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The whole board: field half-width + edging; screen-space depth from the
 * near fence to the far lanterns; its centre. (The shallow camera
 * foreshortens the field, which is why the depth is under 32 tiles.)
 */
export const BATTLE_BOX: ContentBox = { halfW: 9.95, height: 26.8, mid: 0.6 };

/**
 * Portrait: the field is ±9 wide; keep a 0.25-unit sliver of edging so the
 * boundary still reads. Narrow screens are width-bound, so every bit of
 * edging given up here goes straight into bigger troops.
 */
export const TALL_BOX: ContentBox = { ...BATTLE_BOX, halfW: 9.25 };

/** The top inset never takes more than this share of the canvas. */
export const MAX_TOP_FRAC = 0.25;

/**
 * Fit `box` into the canvas (w × h CSS px) minus `ins`, as large as it
 * goes, centred in the free rectangle. The frustum covers the whole canvas
 * at that scale (it always matches the canvas aspect, so nothing stretches).
 */
export function fitBattleFrustum(w: number, h: number, ins: Insets, box: ContentBox = BATTLE_BOX): Frustum {
  w = Math.max(1, w);
  h = Math.max(1, h);
  const top = Math.min(Math.max(0, ins.top), MAX_TOP_FRAC * h);
  const aw = Math.max(1, w - ins.left - ins.right);
  const ah = Math.max(1, h - top - ins.bottom);
  const s = Math.min(aw / (2 * box.halfW), ah / box.height); // px per world unit
  // The box centre goes to the middle of the free rectangle.
  const cx = ins.left + aw / 2;
  const cy = top + ah / 2;
  const left = -cx / s;
  const t = box.mid + cy / s;
  return { left, right: left + w / s, top: t, bottom: t - h / s };
}
