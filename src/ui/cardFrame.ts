/**
 * Shared card-art canvas renderer.
 *
 * Consolidates the duplicate implementations in hud.ts (80 px radial-backdrop)
 * and main.ts (128 px flat-color tile) so both the battle hand and deck-builder
 * tiles receive identical portrait framing and lighting.
 */
import type { CardId } from "../game/cards";
import { CARD_COLOR } from "../render/cardcolors";
import { drawCardArt } from "../render/characters";
import { cardPortrait } from "../render3d/cardportraits";

export type CardFrameStyle =
  /** Flat base-colour fill; used for deck-builder collection tiles. */
  | "tile"
  /** Radial gradient jewel backdrop; used for battle hand cards. */
  | "hud";

export interface CardFrameOptions {
  /**
   * Canvas resolution in pixels (width = height).
   * Defaults to 128 for "tile", 80 for "hud".
   */
  size?: number;
  /**
   * Visual style:
   * - "tile" – solid colour fill with rounded clip (deck builder).
   * - "hud"  – radial gradient backdrop centred on the portrait (battle HUD).
   */
  style?: CardFrameStyle;
}

/**
 * Renders a card-portrait canvas:
 *   1. Coloured/gradient backdrop clipped to a rounded rectangle.
 *   2. Subtle inner highlight rim.
 *   3. Pre-rendered 3-D portrait for troops/buildings; 2-D icon art for spells.
 *
 * The returned canvas is a fresh element every call — callers own its lifetime.
 */
export function makeCardCanvas(id: CardId, opts: CardFrameOptions = {}): HTMLCanvasElement {
  const style = opts.style ?? "tile";
  const S = opts.size ?? (style === "hud" ? 80 : 128);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const base = CARD_COLOR[id];

  // Clip path shared by fill and rim stroke.
  ctx.beginPath();
  ctx.roundRect(1, 1, S - 2, S - 2, S * 0.12);

  if (style === "hud") {
    const cx = S * 0.5;
    const cy = S * 0.55;
    const g = ctx.createRadialGradient(cx, cy * 0.55, S * 0.06, cx, cy, S * 0.65);
    g.addColorStop(0, "#ffffff33");
    g.addColorStop(0.25, base);
    g.addColorStop(1, "#0a0e16");
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill();

  // Subtle inner highlight rim so cards pop from dark backgrounds.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const portrait = cardPortrait(id);
  if (portrait) {
    if (style === "hud") {
      // Bleed portrait slightly outside the tile for a dynamic crop.
      ctx.drawImage(portrait, -6, -2, S + 12, S + 12);
    } else {
      const m = S * 0.04;
      ctx.drawImage(portrait, m, 0, S - m * 2, S - m * 2);
    }
  } else {
    drawCardArt(ctx, id, S / 2, S * 0.54, S * 0.5);
  }

  return canvas;
}
