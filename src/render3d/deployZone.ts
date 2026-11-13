/**
 * Where the held card may go, as a pure shape (no THREE, no DOM; runs in
 * node). The deploy overlay (scene/deployOverlay.ts) paints it into one small
 * signed-distance texture and draws the whole map on a single plane.
 *
 * The shape comes from the sim's exported rules: openLanes, towerSpots,
 * canDigTo's DIG_CLEARANCE, entity radii and isBuilding. Two numbers are
 * copies of the sim's private tower buffers (KING_DEPLOY_BUFFER and
 * PRINCESS_DEPLOY_BUFFER in src/game/battle.ts): KING_KEEP_CLEAR and
 * PRINCESS_KEEP_CLEAR below. They are the ONLY copied rule numbers, and
 * deployZone.grid.test.ts pins the whole drawn shape against
 * checkDeploy(...) !== "bad-spot" on a fine grid (plus a bisection of the
 * King's radius), so a sim change fails the build instead of drawing a lie.
 *
 * Coordinates are arena tiles: x 0..18, y 0..32, y = 0 the host's enemy back
 * line. "side" is the viewer: the host is "player", the online guest "enemy".
 */
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_HALF_WIDTH,
  BRIDGE_XS,
  RIVER_HALF_WIDTH,
  RIVER_Y,
  opposite,
  towerSpots,
  type OpenLanes,
  type Side,
} from "../game/arena";
import { DIG_CLEARANCE, isBuilding, openLanes, type BattleState } from "../game/battle";
import type { Card } from "../game/cards";

/** Sim KING_DEPLOY_BUFFER (private): pinned by deployZone.grid.test.ts. */
export const KING_KEEP_CLEAR = 4.5;
/** Sim PRINCESS_DEPLOY_BUFFER (private): pinned by deployZone.grid.test.ts. */
export const PRINCESS_KEEP_CLEAR = 3;
export const TEXELS_PER_TILE = 8;
export const FIELD_W = ARENA_WIDTH * TEXELS_PER_TILE; // 144
export const FIELD_H = ARENA_HEIGHT * TEXELS_PER_TILE; // 256
/** The painted distance is clamped to +-SDF_RANGE tiles. */
export const SDF_RANGE = 2;
/** Allowed rectangles run this far past the walls, so no line is drawn along a wall. */
export const PAST_WALL = 2;

export type ZoneMode = "troop" | "dig";
export type Lane = "left" | "right";

/** A troop card that tunnels to any spot (the Digger) ignores the lane rules. */
export function deploysAnywhere(card: Card | null): boolean {
  return card?.kind === "troop" && card.deployAnywhere === true;
}

/** Which map the held card shows: troops and buildings the lane map, the Digger the dig map, spells none. */
export function zoneModeFor(card: Card | null): ZoneMode | null {
  if (!card || card.kind === "spell") return null;
  return deploysAnywhere(card) ? "dig" : "troop";
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Hole {
  x: number;
  y: number;
  r: number;
}
export interface ZoneShape {
  mode: ZoneMode;
  side: Side;
  rects: Rect[];
  /** Troop keep-clear circles: they bite only into the viewer's enemy half. */
  holes: Hole[];
  /** Digger collars around tower and building bodies (either side's, not clipped). */
  digHoles: Hole[];
}

const L = -PAST_WALL;
const R = ARENA_WIDTH + PAST_WALL;
const T = -PAST_WALL;
const B = ARENA_HEIGHT + PAST_WALL;
const MID = ARENA_WIDTH / 2;
/** Last dry row on each side of the river (inRiver is |y - RIVER_Y| < RIVER_HALF_WIDTH). */
const NEAR = RIVER_Y - RIVER_HALF_WIDTH; // 15
const FAR = RIVER_Y + RIVER_HALF_WIDTH; // 17

function ownHalf(side: Side): Rect {
  return side === "player" ? { x0: L, y0: FAR, x1: R, y1: B } : { x0: L, y0: T, x1: R, y1: NEAR };
}

function enemyHalf(side: Side, x0: number, x1: number): Rect {
  return side === "player" ? { x0, y0: T, x1, y1: NEAR } : { x0, y0: FAR, x1, y1: B };
}

/**
 * The troop / building map for `side` with these lanes open: its own dry
 * half, plus each open lane's dry enemy half (ONE rectangle when both are
 * open, so no seam), minus the enemy King's keep-clear and the keep-clear of
 * each enemy princess still standing (a princess stands exactly when its lane
 * is closed). Exact for any battle: towers sit at towerSpots and the King
 * stands until the match ends.
 */
export function troopShapeFor(side: Side, open: OpenLanes): ZoneShape {
  const rects = [ownHalf(side)];
  if (open.left && open.right) rects.push(enemyHalf(side, L, R));
  else if (open.left) rects.push(enemyHalf(side, L, MID));
  else if (open.right) rects.push(enemyHalf(side, MID, R));
  const holes: Hole[] = [];
  for (const t of towerSpots(opposite(side))) {
    if (t.kind === "king") holes.push({ x: t.x, y: t.y, r: KING_KEEP_CLEAR });
    else if (!(t.x < MID ? open.left : open.right)) holes.push({ x: t.x, y: t.y, r: PRINCESS_KEEP_CLEAR });
  }
  return { mode: "troop", side, rects, holes, digHoles: [] };
}

/** The Digger's map: every dry tile and both bridges, minus a collar round every tower and building body. */
export function digShape(state: BattleState, side: Side): ZoneShape {
  const rects: Rect[] = [
    { x0: L, y0: T, x1: R, y1: NEAR },
    { x0: L, y0: FAR, x1: R, y1: B },
    // Each bridge across the water (onBridge), overlapping the dry banks by a tile so no seam is drawn.
    ...BRIDGE_XS.map((bx) => ({ x0: bx - BRIDGE_HALF_WIDTH, y0: NEAR - 1, x1: bx + BRIDGE_HALF_WIDTH, y1: FAR + 1 })),
  ];
  const digHoles: Hole[] = [];
  for (const e of state.entities) {
    if (isBuilding(e) && e.hp > 0) digHoles.push({ x: e.x, y: e.y, r: e.radius + DIG_CLEARANCE });
  }
  return { mode: "dig", side, rects, holes: [], digHoles };
}

export function zoneShape(state: BattleState, side: Side, mode: ZoneMode): ZoneShape {
  return mode === "dig" ? digShape(state, side) : troopShapeFor(side, openLanes(state, side));
}

/** Signed distance to a rectangle, positive inside. */
function rectSd(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x0 - x, x - r.x1);
  const dy = Math.max(r.y0 - y, y - r.y1);
  if (dx <= 0 && dy <= 0) return -Math.max(dx, dy);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return -Math.sqrt(ox * ox + oy * oy); // not Math.hypot: much slower in V8
}

/** Signed distance (tiles) to the nearest edge of the map: > 0 allowed, < 0 not. */
export function zoneSd(s: ZoneShape, x: number, y: number): number {
  let d = -Infinity;
  for (const r of s.rects) {
    const v = rectSd(r, x, y);
    if (v > d) d = v;
  }
  if (s.holes.length > 0) {
    // > 0 on the viewer's enemy half: the sim's tower buffers apply only there.
    const enemySd = s.side === "player" ? RIVER_Y - y : y - RIVER_Y;
    for (const h of s.holes) {
      const hx = x - h.x;
      const hy = y - h.y;
      const v = Math.max(Math.sqrt(hx * hx + hy * hy) - h.r, -enemySd);
      if (v < d) d = v;
    }
  }
  for (const h of s.digHoles) {
    const hx = x - h.x;
    const hy = y - h.y;
    const v = Math.sqrt(hx * hx + hy * hy) - h.r;
    if (v < d) d = v;
  }
  return d;
}

/**
 * Paint the map into an R8 field (FIELD_W x FIELD_H, row 0 = arena y 0,
 * upload with flipY false). Texel (i, j) holds the distance at its centre,
 * x = (i + 0.5) / 8, y = (j + 0.5) / 8, clamped to +-SDF_RANGE.
 */
export function paintZoneField(s: ZoneShape, out: Uint8Array = new Uint8Array(FIELD_W * FIELD_H)): Uint8Array {
  const k = 255 / (2 * SDF_RANGE);
  for (let j = 0; j < FIELD_H; j++) {
    const y = (j + 0.5) / TEXELS_PER_TILE;
    const row = j * FIELD_W;
    for (let i = 0; i < FIELD_W; i++) {
      const d = zoneSd(s, (i + 0.5) / TEXELS_PER_TILE, y);
      const c = d > SDF_RANGE ? SDF_RANGE : d < -SDF_RANGE ? -SDF_RANGE : d;
      out[row + i] = Math.round((c + SDF_RANGE) * k);
    }
  }
  return out;
}

/** What the GPU reads at (x, y): bilinear between texel centres, clamped to the edge, decoded to tiles. */
export function sampleField(data: Uint8Array, x: number, y: number): number {
  const fx = Math.max(0, Math.min(FIELD_W - 1, x * TEXELS_PER_TILE - 0.5));
  const fy = Math.max(0, Math.min(FIELD_H - 1, y * TEXELS_PER_TILE - 0.5));
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = Math.min(FIELD_W - 1, i0 + 1);
  const j1 = Math.min(FIELD_H - 1, j0 + 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const a = data[j0 * FIELD_W + i0];
  const b = data[j0 * FIELD_W + i1];
  const c = data[j1 * FIELD_W + i0];
  const d = data[j1 * FIELD_W + i1];
  const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  return (v / 255 - 0.5) * 2 * SDF_RANGE;
}

/** A number naming a troop map (viewer + open lanes): 8 distinct values, no allocation. */
export function troopKey(side: Side, open: OpenLanes): number {
  return (side === "player" ? 1 : 0) | (open.left ? 2 : 0) | (open.right ? 4 : 0);
}

/** A string naming a dig map: the bodies a Digger must keep clear of. Built only while a Digger is held. */
export function digKey(state: BattleState): string {
  const ids: number[] = [];
  for (const e of state.entities) if (isBuilding(e) && e.hp > 0) ids.push(e.id);
  ids.sort((a, b) => a - b);
  return "dig|" + ids.join(",");
}

/** Where the fallen enemy princess of `lane` stood, seen by `side`. */
export function ruinSpot(side: Side, lane: Lane): { x: number; y: number } {
  const t = towerSpots(opposite(side)).find((s) => s.kind === "princess" && s.x < MID === (lane === "left"))!;
  return { x: t.x, y: t.y };
}

/** The centre of `lane`'s enemy-half pocket for `side`: the "Drop troops here now!" label's anchor. */
export function laneAnchor(side: Side, lane: Lane): { x: number; y: number } {
  return { x: lane === "left" ? 4.5 : 13.5, y: side === "player" ? 11 : ARENA_HEIGHT - 11 };
}

/** The enemy King's centre seen by `side`. */
export function enemyKingSpot(side: Side): { x: number; y: number } {
  const t = towerSpots(opposite(side)).find((s) => s.kind === "king")!;
  return { x: t.x, y: t.y };
}

/** The label keeps this far (tiles) off the King's keep-clear and off the river bank. */
export const LABEL_BAND_MARGIN = { king: 0.2, river: 0.3 };

/**
 * The band of an opened pocket the "Drop troops here now!" label may use,
 * as arena y for `side` (either lane: they mirror across the middle seam):
 * `far` just below the King's keep-clear, which reaches deepest at the seam,
 * and `near` just above the river bank. The label steps along it to keep off
 * a held card's preview, and never onto the King's striped bite.
 */
export function laneLabelBand(side: Side): { far: number; near: number } {
  const king = enemyKingSpot(side);
  const sign = side === "player" ? 1 : -1; // toward the river, in arena y
  return {
    far: king.y + sign * (KING_KEEP_CLEAR + LABEL_BAND_MARGIN.king),
    near: (side === "player" ? NEAR : FAR) - sign * LABEL_BAND_MARGIN.river,
  };
}
