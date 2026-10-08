/**
 * Trophy Road reward table: a node every 50 trophies up to 3000. Gold ramps
 * from 50 to 400 along the road, every 250 trophies adds gems, and each
 * arena gate pays a rare chest. Gates are keyed by arena id from ARENAS,
 * so the arena list (arenas.ts) stays the single source of names and
 * thresholds and is never edited for rewards.
 */
import { ARENAS, type ArenaDef } from "./arenas";

export type RoadChest = "free" | "rare";

export interface RoadNode {
  /** Trophy threshold that unlocks the node (also its permanent id). */
  at: number;
  gold?: number;
  gems?: number;
  chest?: RoadChest;
  /** Arena id when this node is that arena's gate. */
  gate?: string;
}

export const ROAD_STEP = 50;
export const ROAD_MAX = 3000;
const GOLD_FIRST = 50;
const GOLD_LAST = 400;
export const ROAD_GEMS_EVERY = 250;

/** Arena id -> the trophy count that opens it (Training Camp excluded). */
export const ROAD_GATES: Readonly<Record<string, number>> = Object.fromEntries(
  ARENAS.filter((a) => a.trophies > 0).map((a) => [a.id, a.trophies]),
);

const gateAt = new Map<number, string>(ARENAS.filter((a) => a.trophies > 0).map((a) => [a.trophies, a.id]));

/** Free chests sprinkled between gates: the very first node, then every 300. */
function freeChestAt(at: number): boolean {
  return at === ROAD_STEP || at % 300 === 150;
}

function buildRoad(): RoadNode[] {
  const count = ROAD_MAX / ROAD_STEP;
  const out: RoadNode[] = [];
  for (let i = 0; i < count; i++) {
    const at = (i + 1) * ROAD_STEP;
    const ramp = GOLD_FIRST + ((GOLD_LAST - GOLD_FIRST) * i) / (count - 1);
    const node: RoadNode = { at, gold: Math.round(ramp / 5) * 5 };
    if (at % ROAD_GEMS_EVERY === 0) node.gems = 5 * (1 + Math.floor(at / 1000));
    const gate = gateAt.get(at);
    if (gate) {
      node.gate = gate;
      node.chest = "rare";
    } else if (freeChestAt(at)) {
      node.chest = "free";
    }
    out.push(node);
  }
  return out;
}

/** Every road node, low to high. */
export const ROAD: readonly RoadNode[] = buildRoad();

export function roadNode(at: number): RoadNode | undefined {
  return ROAD.find((n) => n.at === at);
}

/** The arena a node's trophies stand in (a gate node opens its own arena). */
export function arenaOfNode(node: RoadNode): ArenaDef {
  let cur = ARENAS[0];
  for (const a of ARENAS) if (node.at >= a.trophies) cur = a;
  return cur;
}

/** The road split into arena sections, low to high, for the road screen. */
export function roadSections(): { arena: ArenaDef; nodes: RoadNode[] }[] {
  return ARENAS.map((arena) => ({
    arena,
    nodes: ROAD.filter((n) => arenaOfNode(n).id === arena.id),
  })).filter((s) => s.nodes.length > 0);
}
