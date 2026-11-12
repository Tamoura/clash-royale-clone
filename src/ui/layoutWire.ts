/**
 * Applies the battle layout (layout.ts) to the page while a battle is on
 * screen: :root[data-layout] / [data-side] / [data-slim] / [data-panel]
 * with --side, --field-w, --card-w, --card-h, --next-w, --king-w,
 * --gutter-w, --gap-w and --hand-cols for the CSS (styles/hud.css), --band
 * (tall: the measured scoreboard band), and the matching frame for the
 * camera. Menus and the
 * home diorama keep their phone-width column (no data-layout at all, and
 * the tray falls back to the stylesheet's own sizes).
 *
 * Tall mode measures the scoreboard band floating over the top of the
 * board and frames the board under it (a little below the middle of what
 * is left over the tray, see TALL_ALIGN_Y). The far king's column (the
 * box's crown: his canopy and HP plate) only has to clear the chips that
 * sit over it, so where the band leaves the middle free (tablets) he rises
 * between them instead of shrinking the board. Wherever he may rise into the
 * band's box (between the chips on a tablet, under shorter chips than the
 * clock on a short phone), its shading stays off his column
 * (:root[data-crown="free"], --crown-l / --crown-r), so his canopy and HP
 * plate keep their full brightness. Wide mode frames the board between the
 * two side panels.
 */
import type { Battle3D } from "../render3d/scene3d";
import { BAND_GAP_PX, TALL_ALIGN_Y, TALL_BOX, TRAY_MARK_PX, ZERO_INSETS, type Insets } from "../render3d/scene/fit";
import { setEdgeShade } from "../render3d/scene/post";
import { SIDE_ROOMY, SIDE_SLIM, battleLayout } from "./layout";

export interface LayoutControl {
  /** A battle is (or is no longer) on screen: lay out and re-size the canvas now. */
  setBattle(on: boolean): void;
}

/** The parts of the scoreboard band; the board may start just under them. */
const BAND_PARTS = ".crowns, .clock, .menu-toggle";
/** Gap between the band and the board's far edging (CSS px). */
const BAND_GAP = BAND_GAP_PX;
/** The CSS variables a battle layout sets on :root (cleared between battles). */
const LAYOUT_VARS = ["--side", "--field-w", "--card-w", "--card-h", "--next-w", "--king-w", "--gutter-w", "--gap-w", "--hand-cols", "--band", "--crown-l", "--crown-r"] as const;

/**
 * The far king's column (the tall box's crown: his canopy and HP plate) on a
 * stage `width` px wide, as [left, right] px from the stage's left edge. At
 * its widest, a width-bound board, so it holds him on any board: the chips
 * that overlap it hold the crown down, and wherever he may rise into the band
 * (crownTop under the band's inset) its shading stays off this column.
 */
export function crownColumn(width: number): [number, number] {
  const half = (TALL_BOX.crown?.halfW ?? 0) * (width / (2 * TALL_BOX.halfW));
  return [width / 2 - half, width / 2 + half];
}

export function installLayout(scene: Battle3D, topbar: HTMLElement): LayoutControl {
  const root = document.documentElement;
  const stage = scene.container;

  // env(safe-area-inset-*) can only be read back through a styled element.
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const readSafeArea = (): Insets => {
    const cs = getComputedStyle(probe);
    const px = (v: string): number => parseFloat(v) || 0;
    return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  };

  let battle = false;
  // High-water marks per match: the band never shrinks mid-battle, so the
  // board does not jump when "OVERTIME" replaces the clock's digits. `crown`
  // is the same for the chips over the far king's column only.
  let band = 0;
  let crown = 0;
  const bandInset = (safeTop: number): { top: number; crownTop: number; column: [number, number] } => {
    const r = stage.getBoundingClientRect();
    const [c0, c1] = crownColumn(r.width);
    let bottom = r.top;
    let over = r.top + safeTop;
    topbar.querySelectorAll<HTMLElement>(BAND_PARTS).forEach((el) => {
      const q = el.getBoundingClientRect();
      if (q.height <= 0) return;
      bottom = Math.max(bottom, q.bottom);
      if (q.right > r.left + c0 && q.left < r.left + c1) over = Math.max(over, q.bottom);
    });
    band = Math.max(band, bottom - r.top + BAND_GAP);
    crown = Math.max(crown, over - r.top + BAND_GAP);
    return { top: band, crownTop: Math.min(crown, band), column: [r.left + c0, r.left + c1] };
  };
  /**
   * While the far king may rise into the band's box, keep its shading off his
   * column (`column` in client px; the CSS reads it in the band's px).
   */
  const shadeWindow = (column: [number, number] | null): void => {
    if (!column) {
      delete root.dataset.crown;
      root.style.removeProperty("--crown-l");
      root.style.removeProperty("--crown-r");
      return;
    }
    const left = topbar.getBoundingClientRect().left;
    root.dataset.crown = "free";
    root.style.setProperty("--crown-l", `${Math.round(column[0] - left)}px`);
    root.style.setProperty("--crown-r", `${Math.round(column[1] - left)}px`);
  };

  const relayout = (): void => {
    if (!battle) {
      delete root.dataset.layout;
      delete root.dataset.side;
      delete root.dataset.panel;
      delete root.dataset.slim;
      delete root.dataset.crown;
      for (const name of LAYOUT_VARS) root.style.removeProperty(name);
      setEdgeShade(scene, 0);
      return;
    }
    const safe = readSafeArea();
    const lay = battleLayout(window.innerWidth, window.innerHeight, safe);
    // Set the mode first: the band's own size depends on it.
    root.dataset.layout = lay.mode;
    root.dataset.side = lay.side >= SIDE_ROOMY ? "roomy" : "narrow";
    root.dataset.panel = lay.stacked ? "stacked" : "inline";
    if (lay.mode === "wide" && lay.side < SIDE_SLIM) root.dataset.slim = "";
    else delete root.dataset.slim;
    root.style.setProperty("--side", `${lay.side}px`);
    root.style.setProperty("--field-w", `${lay.fieldW}px`);
    const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
    root.style.setProperty("--card-w", px(lay.cardW));
    root.style.setProperty("--card-h", px(lay.cardH));
    // The tray's Next and KING columns, its gutters and gaps (tall only; a
    // side panel keeps the stylesheet's sizes).
    const tray = [["--next-w", lay.nextW], ["--king-w", lay.kingW], ["--gutter-w", lay.gutter], ["--gap-w", lay.gap]] as const;
    for (const [name, v] of tray) {
      if (lay.mode === "tall") root.style.setProperty(name, px(v));
      else root.style.removeProperty(name);
    }
    root.style.setProperty("--hand-cols", String(lay.handCols));
    // Wide mode shades the world past the stands (drawn by the final pass).
    setEdgeShade(scene, lay.mode === "wide" ? lay.fieldW : 0);
    if (lay.mode === "wide") {
      root.style.removeProperty("--band");
      shadeWindow(null);
      scene.setFraming({ insets: lay.insets, box: lay.box });
      return;
    }
    // Tall: the board goes under the band; so do the stage's own top-corner
    // controls (the sandbox reset), which the band would otherwise cover.
    // The near plates keep clear of the tray's ornament under the board.
    const { top, crownTop, column } = bandInset(safe.top);
    root.style.setProperty("--band", px(top));
    shadeWindow(crownTop < top ? column : null);
    scene.setFraming({ insets: { ...ZERO_INSETS, top, crownTop }, box: TALL_BOX, alignY: TALL_ALIGN_Y, plateFloor: TRAY_MARK_PX });
  };

  window.addEventListener("resize", () => {
    band = crown = 0; // a new screen size measures its band afresh
    relayout();
  });
  // Names, badges and the clock change the band's size (clock ticks do not).
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(relayout).observe(topbar);

  return {
    setBattle(on: boolean): void {
      battle = on;
      band = crown = 0;
      relayout();
      // Size the canvas for the new layout before the next frame draws
      // (the container's own observer would only catch up after it).
      scene.resize();
    },
  };
}
