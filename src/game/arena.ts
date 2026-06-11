export type Side = "player" | "enemy";

/** All coordinates are in tile units. y=0 is the enemy back line. */
export const ARENA_WIDTH = 18;
export const ARENA_HEIGHT = 32;
export const RIVER_Y = 16;
/** The river is impassable except within half a tile of a bridge. */
export const RIVER_HALF_WIDTH = 1;
export const BRIDGE_XS = [3.5, 14.5] as const;
export const BRIDGE_HALF_WIDTH = 1;

export type TowerKind = "princess" | "king";

export interface TowerSpot {
  kind: TowerKind;
  x: number;
  y: number;
}

export function towerSpots(side: Side): TowerSpot[] {
  const mirror = (y: number) => (side === "player" ? ARENA_HEIGHT - y : y);
  return [
    { kind: "princess", x: BRIDGE_XS[0], y: mirror(6.5) },
    { kind: "princess", x: BRIDGE_XS[1], y: mirror(6.5) },
    { kind: "king", x: ARENA_WIDTH / 2, y: mirror(2.5) },
  ];
}

export function opposite(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export function inArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_WIDTH && y >= 0 && y <= ARENA_HEIGHT;
}

export function inRiver(y: number): boolean {
  return Math.abs(y - RIVER_Y) < RIVER_HALF_WIDTH;
}

export function canDeployTroopAt(side: Side, x: number, y: number): boolean {
  if (!inArena(x, y) || inRiver(y)) return false;
  return side === "player" ? y > RIVER_Y : y < RIVER_Y;
}

export function nearestBridgeX(x: number): number {
  return Math.abs(x - BRIDGE_XS[0]) <= Math.abs(x - BRIDGE_XS[1])
    ? BRIDGE_XS[0]
    : BRIDGE_XS[1];
}

export function onBridge(x: number): boolean {
  return BRIDGE_XS.some((bx) => Math.abs(x - bx) <= BRIDGE_HALF_WIDTH);
}
