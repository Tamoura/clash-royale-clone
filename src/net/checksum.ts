import type { BattleState } from "../game/battle";

/** Round to 0.1 so last-bit float noise across devices doesn't read as drift. */
function q(n: number): number {
  return Math.round(n * 10);
}

/**
 * A cheap, order-independent fingerprint of the simulation state. Two peers
 * running the identical command stream produce the same value; a divergence
 * (a missing unit, a position that has drifted past 0.1 tile) changes it, so
 * the driver can detect desync and warn the players.
 */
export function stateChecksum(state: BattleState): number {
  // FNV-1a over a canonical, position-rounded view of every entity.
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(state.nextEntityId);
  mix(q(state.time));
  // Sort by id so entity array ordering can't affect the digest.
  const sorted = [...state.entities].sort((a, b) => a.id - b.id);
  for (const e of sorted) {
    mix(e.id);
    mix(e.side === "player" ? 1 : 2);
    mix(q(e.x));
    mix(q(e.y));
    mix(Math.round(e.hp));
  }
  return h >>> 0;
}
