/**
 * Shared card-art canvas renderer.
 *
 * Consolidates the duplicate implementations in hud.ts (80 px radial-backdrop)
 * and main.ts (128 px flat-color tile) so both the battle hand and deck-builder
 * tiles receive identical portrait framing and lighting.
 */
import "./styles/legendary.css";
import { getCard, type CardId, type Rarity } from "../game/cards";
import { CARD_COLOR } from "../render/cardcolors";
import { drawCardArt } from "../render/characters";
import { cardPortrait } from "../render3d/cardportraits";
import { ARABIC } from "../render3d/theme";

// ---- Legendary frame ------------------------------------------------------------
//
// The animated part of the legendary frame is CSS (styles/legendary.css,
// keyed on the rarity class every tile already carries: .rarity-legendary,
// .rw-card--legendary...). The canvas adds what must survive anywhere a card
// is drawn, even with motion off: a warm halo behind the portrait, a gold
// inner rim and a few twinkles.

export function isLegendaryRarity(r: Rarity): boolean {
  return r === "legendary";
}

export interface Twinkle {
  /** Centre, 0..1 of the tile. */
  x: number;
  y: number;
  /** Arm length, 0..1 of the tile. */
  r: number;
}

/**
 * Where the twinkles sit on a legendary tile: near the corners and edges,
 * clear of the portrait's face, the same every time for a card (seeded by
 * its id) so a redraw never jumps.
 */
export function legendaryTwinkles(id: string, count = 4): Twinkle[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  // Four bands round the edge: top-left, top-right, bottom-right, left.
  const anchors: [number, number][] = [
    [0.16, 0.14],
    [0.84, 0.16],
    [0.86, 0.8],
    [0.14, 0.62],
  ];
  const out: Twinkle[] = [];
  for (let i = 0; i < count; i++) {
    const [ax, ay] = anchors[i % anchors.length];
    out.push({ x: ax + (next() - 0.5) * 0.1, y: ay + (next() - 0.5) * 0.1, r: 0.05 + next() * 0.035 });
  }
  return out;
}

/** A four-point twinkle star. */
function twinkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const w = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + w, y - w, x + r, y);
  ctx.quadraticCurveTo(x + w, y + w, x, y + r);
  ctx.quadraticCurveTo(x - w, y + w, x - r, y);
  ctx.quadraticCurveTo(x - w, y - w, x, y - r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Legendary backdrop: a warm halo where the portrait stands (drawn before it). */
function legendaryHalo(ctx: CanvasRenderingContext2D, S: number): void {
  const halo = ctx.createRadialGradient(S * 0.5, S * 0.46, S * 0.04, S * 0.5, S * 0.5, S * 0.6);
  halo.addColorStop(0, ARABIC ? "rgba(255, 236, 180, 0.75)" : "rgba(255, 240, 170, 0.75)");
  halo.addColorStop(0.45, ARABIC ? "rgba(31, 194, 184, 0.28)" : "rgba(255, 196, 64, 0.3)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fill();
}

/** Legendary finish over the portrait: gold inner rim and twinkles. */
function legendaryFinish(ctx: CanvasRenderingContext2D, id: CardId, S: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(1.5, 1.5, S - 3, S - 3, S * 0.12);
  ctx.strokeStyle = ARABIC ? "rgba(242, 198, 73, 0.95)" : "rgba(255, 213, 74, 0.95)";
  ctx.lineWidth = Math.max(1.5, S * 0.025);
  ctx.stroke();
  for (const t of legendaryTwinkles(id)) {
    twinkle(ctx, t.x * S, t.y * S, t.r * S * 1.5, "rgba(255, 245, 200, 0.35)");
    twinkle(ctx, t.x * S, t.y * S, t.r * S, "#fffbe6");
  }
  ctx.restore();
}

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
  // Supersample for retina: the canvas is CSS-sized by its container, so
  // doubling the backing store just makes the art crisp on phones.
  const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  canvas.width = canvas.height = Math.round(S * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const base = CARD_COLOR[id];

  const legendary = isLegendaryRarity(getCard(id).rarity);

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
  if (legendary) legendaryHalo(ctx, S);

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
  if (legendary) legendaryFinish(ctx, id, S);

  return canvas;
}
