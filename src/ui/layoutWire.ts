/**
 * Applies the battle layout (layout.ts) to the page while a battle is on
 * screen: :root[data-layout] with --side / --field-w for the CSS
 * (styles/hud.css), and the matching frame for the camera. Menus and the
 * home diorama keep their phone-width column (no data-layout at all).
 *
 * Tall mode measures the scoreboard band floating over the top of the
 * board and frames the board just under it; wide mode frames it between
 * the two side panels.
 */
import type { Battle3D } from "../render3d/scene3d";
import { TALL_BOX, ZERO_INSETS, type Insets } from "../render3d/scene/fit";
import { battleLayout } from "./layout";

export interface LayoutControl {
  /** A battle is (or is no longer) on screen: lay out and re-size the canvas now. */
  setBattle(on: boolean): void;
}

/** The parts of the scoreboard band; the board may start just under them. */
const BAND_PARTS = ".crowns, .clock, .menu-toggle";
/** Gap between the band and the board's far edging (CSS px). */
const BAND_GAP = 4;

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
      return;
    }
    const lay = battleLayout(window.innerWidth, window.innerHeight, readSafeArea());
    // Set the mode first: the band's own size depends on it.
    root.dataset.layout = lay.mode;
    root.style.setProperty("--side", `${lay.side}px`);
    root.style.setProperty("--field-w", `${lay.fieldW}px`);
    scene.setFraming(
      lay.mode === "wide"
        ? { insets: lay.insets, box: lay.box }
        : { insets: { ...ZERO_INSETS, top: bandInset() }, box: TALL_BOX },
    );
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
