/**
 * Trophy Road claims. A node is claimable once the player has reached its
 * threshold (their best ever, so a monthly soft reset never takes a reached
 * reward away) and is claimed at most once, forever: claims are stored per
 * threshold in 'cr-clone-road', so dropping below and climbing back can
 * never pay a node twice.
 */
import { defaultKV, readJson, writeJson, type KV } from "./kv";
import { ROAD, type RoadNode } from "./roadRewards";

export const ROAD_KEY = "cr-clone-road";

export interface RoadState {
  /** Thresholds already paid out. */
  claimed: number[];
}

export function freshRoad(): RoadState {
  return { claimed: [] };
}

export function loadRoad(kv: KV | null = defaultKV()): RoadState {
  const raw = readJson<Partial<RoadState> | null>(ROAD_KEY, null, kv);
  const valid = new Set(ROAD.map((n) => n.at));
  const claimed = Array.isArray(raw?.claimed)
    ? [...new Set(raw.claimed.filter((n): n is number => typeof n === "number" && valid.has(n)))]
    : [];
  return { claimed: claimed.sort((a, b) => a - b) };
}

export function saveRoad(state: RoadState, kv: KV | null = defaultKV()): void {
  writeJson(ROAD_KEY, state, kv);
}

/** Nodes reached (at or below `reached` trophies) and not yet claimed, low to high. */
export function claimable(reached: number, claimed: readonly number[]): RoadNode[] {
  const done = new Set(claimed);
  return ROAD.filter((n) => n.at <= reached && !done.has(n.at));
}

export function isClaimed(state: RoadState, at: number): boolean {
  return state.claimed.includes(at);
}

/** The first node above `trophies`, or null at the end of the road. */
export function nextRoadNode(trophies: number): RoadNode | null {
  return ROAD.find((n) => n.at > trophies) ?? null;
}

/**
 * Claim the node at threshold `at`. Returns the new state and the node's
 * reward, or null when the node does not exist, is not reached yet, or was
 * already claimed (claims are idempotent).
 */
export function claim(state: RoadState, at: number, reached: number): { state: RoadState; node: RoadNode } | null {
  const node = ROAD.find((n) => n.at === at);
  if (!node || node.at > reached || state.claimed.includes(at)) return null;
  return { state: { claimed: [...state.claimed, at].sort((a, b) => a - b) }, node };
}
