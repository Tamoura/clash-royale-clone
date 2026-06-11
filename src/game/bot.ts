import { BRIDGE_XS, RIVER_Y } from "./arena";
import { deployCard, distance, type BattleState, type Entity } from "./battle";
import { getCard, type CardId } from "./cards";

/** Seconds between bot decisions. */
export const THINK_INTERVAL = 1.0;
/** Elixir level at which the bot starts a push of its own. */
export const PUSH_ELIXIR = 8;

export interface BotState {
  rng: () => number;
  sinceThink: number;
}

/** Deterministic PRNG (mulberry32) so battles are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBot(seed: number): BotState {
  return { rng: mulberry32(seed), sinceThink: 0 };
}

function playerTroops(state: BattleState): Entity[] {
  return state.entities.filter(
    (e) => e.side === "player" && e.kind === "troop",
  );
}

function affordableTroops(state: BattleState): CardId[] {
  return state.enemy.hand.cards.filter((id) => {
    const card = getCard(id);
    return (
      (card.kind === "troop" || card.kind === "building") &&
      card.cost <= state.enemy.elixir.amount
    );
  });
}

/**
 * Cards that can actually fight `threat`: no building-seekers (they
 * stroll right past invaders) and, against flyers, air-targeters only.
 */
function defenseCandidates(state: BattleState, threat: Entity): CardId[] {
  return affordableTroops(state).filter((id) => {
    const card = getCard(id);
    if (card.kind !== "troop" && card.kind !== "building") return false;
    if (card.unit.targetsBuildingsOnly) return false;
    if (threat.flying && !card.unit.targetsAir) return false;
    return true;
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A spot on the bot's half, between the threat and its towers. */
function defenseSpot(threat: Entity): { x: number; y: number } {
  return {
    x: clamp(threat.x, 1, 17),
    y: clamp(threat.y - 2.5, 3, RIVER_Y - 1.5),
  };
}

/** Rough elixir value of one unit: its card's cost split across the count. */
function unitValue(t: Entity): number {
  if (!t.cardId) return 0;
  const card = getCard(t.cardId);
  return card.kind === "troop" ? card.cost / card.count : card.cost;
}

/**
 * Find a point where a spell of this radius would hit `minCount`
 * player troops worth more elixir than the spell costs, or null.
 * A human never arrows a 1-elixir skeleton pack.
 */
function findCluster(
  state: BattleState,
  radius: number,
  minCount: number,
  minValue: number,
): { x: number; y: number } | null {
  const troops = playerTroops(state);
  for (const center of troops) {
    const hit = troops.filter((t) => distance(center, t) <= radius);
    const value = hit.reduce((s, t) => s + unitValue(t), 0);
    if (hit.length >= minCount && value > minValue) {
      return {
        x: hit.reduce((s, t) => s + t.x, 0) / hit.length,
        y: hit.reduce((s, t) => s + t.y, 0) / hit.length,
      };
    }
  }
  return null;
}

function trySpellCluster(state: BattleState): boolean {
  for (const id of ["fireball", "arrows", "zap"] as const) {
    if (!state.enemy.hand.cards.includes(id)) continue;
    const card = getCard(id);
    if (card.kind !== "spell" || card.cost > state.enemy.elixir.amount) continue;
    const cluster = findCluster(state, card.radius, 3, card.cost);
    if (cluster && deployCard(state, "enemy", id, cluster.x, cluster.y)) {
      return true;
    }
  }
  return false;
}

function tryDefend(state: BattleState, bot: BotState): boolean {
  const invaders = playerTroops(state).filter((e) => e.y < RIVER_Y + 1);
  if (invaders.length === 0) return false;
  const threat = invaders.reduce((a, b) => (a.y < b.y ? a : b));
  const cards = defenseCandidates(state, threat);
  if (cards.length === 0) return false;
  const card = cards[Math.floor(bot.rng() * cards.length)];
  const spot = defenseSpot(threat);
  return deployCard(state, "enemy", card, spot.x, spot.y);
}

function tryPush(state: BattleState, bot: BotState): boolean {
  if (state.enemy.elixir.amount < PUSH_ELIXIR) return false;
  const cards = affordableTroops(state);
  if (cards.length === 0) return false;
  const card = cards[Math.floor(bot.rng() * cards.length)];
  const lane = BRIDGE_XS[bot.rng() < 0.5 ? 0 : 1];
  // Deploy behind the bridge so the push builds up on the way in.
  return deployCard(state, "enemy", card, lane, RIVER_Y - 4);
}

/** Make at most one play right now. */
export function botThink(state: BattleState, bot: BotState): void {
  if (state.result) return;
  if (trySpellCluster(state)) return;
  if (tryDefend(state, bot)) return;
  tryPush(state, bot);
}

/** Throttled entry point: call every tick, thinks once per interval. */
export function tickBot(state: BattleState, bot: BotState, dt: number): void {
  bot.sinceThink += dt;
  if (bot.sinceThink < THINK_INTERVAL) return;
  bot.sinceThink = 0;
  botThink(state, bot);
}
