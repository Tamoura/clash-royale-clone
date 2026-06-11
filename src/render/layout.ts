import { ARENA_HEIGHT, ARENA_WIDTH } from "../game/arena";

export const TILE = 24;
export const TOP_BAR = 48;
export const BOTTOM_BAR = 132;
export const ARENA_PX_W = ARENA_WIDTH * TILE;
export const ARENA_PX_H = ARENA_HEIGHT * TILE;
export const CANVAS_W = ARENA_PX_W;
export const CANVAS_H = TOP_BAR + ARENA_PX_H + BOTTOM_BAR;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function arenaToCanvas(x: number, y: number): { x: number; y: number } {
  return { x: x * TILE, y: TOP_BAR + y * TILE };
}

export function canvasToArena(px: number, py: number): { x: number; y: number } {
  return { x: px / TILE, y: (py - TOP_BAR) / TILE };
}

export function inArenaPixels(py: number): boolean {
  return py >= TOP_BAR && py <= TOP_BAR + ARENA_PX_H;
}

/** The four card slots in the bottom HUD, left of the next-card preview. */
export function cardRects(): Rect[] {
  const pad = 10;
  const w = 78;
  const h = 96;
  const y = TOP_BAR + ARENA_PX_H + 28;
  const totalW = 4 * w + 3 * pad;
  const x0 = (CANVAS_W - totalW - 56) / 2 + 56; // leave room for next-card
  return [0, 1, 2, 3].map((i) => ({ x: x0 + i * (w + pad), y, w, h }));
}

export function nextCardRect(): Rect {
  const cards = cardRects();
  return { x: cards[0].x - 56, y: cards[0].y + 30, w: 44, h: 56 };
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
