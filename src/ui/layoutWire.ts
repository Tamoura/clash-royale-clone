/**
 * Applies the battle layout (layout.ts) to the page while a battle is on
 * screen: :root[data-layout] / [data-side] / [data-slim] / [data-panel]
 * with --side, --field-w, --card-w, --card-h, --next-w, --king-w and
 * --hand-cols for the CSS (styles/hud.css), --band (tall: the measured
 * scoreboard band), and the matching frame for the camera. Menus and the
 * home diorama keep their phone-width column (no data-layout at all, and
 * the tray falls back to the stylesheet's own sizes).
 *
 * Tall mode measures the scoreboard band floating over the top of the
 * board and frames the board under it (a little below the middle of what
 * is left over the tray, see TALL_ALIGN_Y); wide mode frames it between the
 * two side panels.
 */
import type { Battle3D } from "../render3d/scene3d";
import { TALL_ALIGN_Y, TALL_BOX, ZERO_INSETS, type Insets } from "../render3d/scene/fit";
import { setEdgeShade } from "../render3d/scene/post";
import { SIDE_ROOMY, SIDE_SLIM, battleLayout } from "./layout";

export interface LayoutControl {
  /** A battle is (or is no longer) on screen: lay out and re-size the canvas now. */
  setBattle(on: boolean): void;
}

/** The parts of the scoreboard band; the board may start just under them. */
const BAND_PARTS = ".crowns, .clock, .menu-toggle";
/** Gap between the band and the board's far edging (CSS px). */
const BAND_GAP = 4;
/** The CSS variables a battle layout sets on :root (cleared between battles). */
const LAYOUT_VARS = ["--side", "--field-w", "--card-w", "--card-h", "--next-w", "--king-w", "--hand-cols", "--band"] as const;

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
  // A high-water mark per match: the band never shrinks mid-battle, so the
  // board does not jump when "OVERTIME" replaces the clock's digits.
  let band = 0;
  const bandInset = (): number => {
    const top = stage.getBoundingClientRect().top;
    let bottom = top;
    topbar.querySelectorAll<HTMLElement>(BAND_PARTS).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom);
    });
    band = Math.max(band, bottom - top + BAND_GAP);
    return band;
  };

  const relayout = (): void => {
    if (!battle) {
      delete root.dataset.layout;
      delete root.dataset.side;
      delete root.dataset.panel;
      delete root.dataset.slim;
      for (const name of LAYOUT_VARS) root.style.removeProperty(name);
      setEdgeShade(scene, 0);
      return;
    }
    const lay = battleLayout(window.innerWidth, window.innerHeight, readSafeArea());
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
    // The tray's Next and KING columns (tall only; a side panel keeps the stylesheet's sizes).
    for (const [name, v] of [["--next-w", lay.nextW], ["--king-w", lay.kingW]] as const) {
      if (lay.mode === "tall") root.style.setProperty(name, px(v));
      else root.style.removeProperty(name);
    }
    root.style.setProperty("--hand-cols", String(lay.handCols));
    // Wide mode shades the world past the stands (drawn by the final pass).
    setEdgeShade(scene, lay.mode === "wide" ? lay.fieldW : 0);
    if (lay.mode === "wide") {
      root.style.removeProperty("--band");
      scene.setFraming({ insets: lay.insets, box: lay.box });
      return;
    }
    // Tall: the board goes under the band; so do the stage's own top-corner
    // controls (the sandbox reset), which the band would otherwise cover.
    const top = bandInset();
    root.style.setProperty("--band", px(top));
    scene.setFraming({ insets: { ...ZERO_INSETS, top }, box: TALL_BOX, alignY: TALL_ALIGN_Y });
  };

  window.addEventListener("resize", () => {
    band = 0; // a new screen size measures its band afresh
    relayout();
  });
  // Names, badges and the clock change the band's size (clock ticks do not).
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(relayout).observe(topbar);

  return {
    setBattle(on: boolean): void {
      battle = on;
      band = 0;
      relayout();
      // Size the canvas for the new layout before the next frame draws
      // (the container's own observer would only catch up after it).
      scene.resize();
    },
  };
}
