/**
 * A seeded stand-in for a brand-new player: every 3-5 seconds it puts a
 * random affordable card on a random legal tile. Tests use it to measure
 * how a near-random player fares against each bot tier (novice.test.ts)
 * and to drive the bot through a whole match (bot snapshot test).
 */
import { ARENA_HEIGHT, ARENA_WIDTH, RIVER_Y, type Side } from "./arena";
import { checkDeploy, deployCard, effectiveCard, sideState, type BattleState } from "./battle";
import type { CardId } from "./cards";

export interface Pilot {
  side: Side;
  rng: () => number;
  /** Seconds until the next play. */
  wait: number;
  minGap: number;
  maxGap: number;
  plays: number;
}

/** mulberry32, the same seeded PRNG the bot uses. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPilot(
  seed: number,
  side: Side = "player",
  gap: { min: number; max: number } = { min: 3, max: 5 },
): Pilot {
  const rng = seededRng(seed);
  return {
    side,
    rng,
    wait: gap.min + rng() * (gap.max - gap.min),
    minGap: gap.min,
    maxGap: gap.max,
    plays: 0,
  };
}

/** A random tile on the pilot's own half (troops) or anywhere (spells). */
function randomTile(p: Pilot, spell: boolean): { x: number; y: number } {
  const x = 0.5 + p.rng() * (ARENA_WIDTH - 1);
  if (spell) return { x, y: 0.5 + p.rng() * (ARENA_HEIGHT - 1) };
  const depth = 1.5 + p.rng() * (RIVER_Y - 3);
  return { x, y: p.side === "player" ? ARENA_HEIGHT - depth : depth };
}

/** Try one random play right now; true when a card went down. */
export function pilotPlay(state: BattleState, p: Pilot): boolean {
  const me = sideState(state, p.side);
  const affordable = me.hand.cards.filter((id) => {
    const eff = effectiveCard(state, p.side, id);
    return eff !== null && eff.cost <= me.elixir.amount;
  });
  if (affordable.length === 0) return false;
  const id: CardId = affordable[Math.floor(p.rng() * affordable.length)];
  const spell = effectiveCard(state, p.side, id)!.card.kind === "spell";
  for (let tries = 0; tries < 8; tries++) {
    const { x, y } = randomTile(p, spell);
    if (checkDeploy(state, p.side, id, x, y) === "ok") return deployCard(state, p.side, id, x, y);
  }
  return false;
}

/** Call every tick; plays when its timer runs out, then waits 3-5 s again. */
export function tickPilot(state: BattleState, p: Pilot, dt: number): void {
  if (state.result) return;
  p.wait -= dt;
  if (p.wait > 0) return;
  if (pilotPlay(state, p)) p.plays++;
  p.wait = p.minGap + p.rng() * (p.maxGap - p.minGap);
}
