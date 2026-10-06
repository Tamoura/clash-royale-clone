import type { BattleState, SideState } from "../game/battle";

/** Round to 0.1 so last-bit float noise across devices doesn't read as drift. */
function q(n: number): number {
  return Math.round(n * 10);
}

// Scratch view for mixing a float's exact bit pattern (fixed byte order).
const bits = new DataView(new ArrayBuffer(8));

/**
 * A cheap, order-independent fingerprint of the simulation state. Two peers
 * running the identical command stream produce the same value; a divergence
 * (a missing unit, a position that has drifted past 0.1 tile, a different
 * hand or elixir bar) changes it, so the driver can detect desync and warn
 * the players. Render-only data (events, effects, stats) is left out.
 */
export function stateChecksum(state: BattleState): number {
  // FNV-1a over a canonical, position-rounded view of every entity.
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  const mixStr = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    mix(0); // terminator, so "ab"+"c" differs from "a"+"bc"
  };
  const mixExact = (n: number): void => {
    bits.setFloat64(0, n, true);
    mix(bits.getUint32(0, true));
    mix(bits.getUint32(4, true));
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
  // Per side: the bar, the crowns, the hand and its next card, and the
  // side's unrounded total hp (the sim is engine-exact, so any bit counts).
  const mixSide = (side: SideState, tag: "player" | "enemy"): void => {
    mix(Math.round(side.elixir.amount * 1000));
    mix(side.crowns);
    for (const id of side.hand.cards) mixStr(id);
    mixStr(side.hand.queue[0] ?? "");
    let hp = 0;
    for (const e of sorted) if (e.side === tag) hp += e.hp;
    mixExact(hp);
  };
  mixSide(state.player, "player");
  mixSide(state.enemy, "enemy");
  mix(state.projectiles.length);
  mix(state.buffZones.length);
  const w = state.result?.winner;
  mix(w === "player" ? 1 : w === "enemy" ? 2 : w === "draw" ? 3 : 0);
  mix(state.overtime ? 1 : 0);
  return h >>> 0;
}
