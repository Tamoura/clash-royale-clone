import { ARENA_WIDTH, BRIDGE_XS, RIVER_Y, nearestBridgeX } from "./arena";
import { deployCard, distance, type BattleState, type Entity } from "./battle";
import { getCard, type CardId } from "./cards";
import { isDoubleElixir } from "./sim";

/** Seconds between bot decisions. */
export const THINK_INTERVAL = 1.0;
/** Elixir level at which the bot starts a push of its own. */
export const PUSH_ELIXIR = 8;

/** Tuning knobs that make the bot easier or harder. */
export interface BotProfile {
  /** Seconds between decisions. */
  thinkInterval: number;
  /** Elixir level at which the bot starts a push. */
  pushAt: number;
}

export interface BotState extends BotProfile {
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

export function createBot(
  seed: number,
  profile: Partial<BotProfile> = {},
): BotState {
  return {
    rng: mulberry32(seed),
    sinceThink: 0,
    thinkInterval: profile.thinkInterval ?? THINK_INTERVAL,
    pushAt: profile.pushAt ?? PUSH_ELIXIR,
  };
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

/** HP at which a troop is heavy enough to lead (or anchor) a push. */
const TANK_HP = 1400;

/** A win-condition: a building-targeting troop (Giant, Hog, Balloon). */
function isWinCondition(id: CardId): boolean {
  const c = getCard(id);
  return c.kind === "troop" && c.unit.targetsBuildingsOnly;
}

/** A troop beefy enough to spearhead a push (win-condition or high HP). */
function isTankCard(id: CardId): boolean {
  const c = getCard(id);
  return c.kind === "troop" && (c.unit.targetsBuildingsOnly || c.unit.maxHp >= TANK_HP);
}

/** A defensive building (Cannon, Tombstone) — anything but the collector. */
function isDefensiveBuilding(id: CardId): boolean {
  const c = getCard(id);
  return c.kind === "building" && c.unit.elixirInterval === 0;
}

/** An economy building (the Elixir Collector). */
function isEconomyBuilding(id: CardId): boolean {
  const c = getCard(id);
  return c.kind === "building" && c.unit.elixirInterval > 0;
}

/** The bot's own tanks/win-conditions currently on the field. */
function botTanks(state: BattleState): Entity[] {
  return state.entities.filter(
    (e) => e.side === "enemy" && e.kind === "troop" && e.cardId !== null && isTankCard(e.cardId),
  );
}

/**
 * Which lane to attack. Beeline an open lane (the player's princess there
 * has fallen, so the path runs straight to the king); otherwise commit to
 * the lane of the player's weaker tower to finish it. Splitting pressure
 * between lanes is what stalls games out — focus closes them.
 */
function targetLaneX(state: BattleState, bot: BotState): number {
  const towers = state.entities.filter(
    (e) => e.side === "player" && e.kind === "princess-tower",
  );
  for (const bx of BRIDGE_XS) {
    if (!towers.some((t) => Math.abs(t.x - bx) < 2)) return bx; // open lane
  }
  if (towers.length === 2 && towers[0].hp !== towers[1].hp) {
    const weaker = towers[0].hp < towers[1].hp ? towers[0] : towers[1];
    return nearestBridgeX(weaker.x);
  }
  return BRIDGE_XS[bot.rng() < 0.5 ? 0 : 1];
}

/**
 * The elixir at which the bot commits to a push. In double elixir (and
 * overtime) it presses harder — sitting on elixir then just wastes it.
 */
function effectivePushAt(state: BattleState, bot: BotState): number {
  return isDoubleElixir(state) ? Math.max(5, bot.pushAt - 2) : bot.pushAt;
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

/** Heavy ground threats (Giant, P.E.K.K.A…) a building can kite and stall. */
function isHeavyGroundThreat(threat: Entity): boolean {
  return !threat.flying && (threat.targetsBuildingsOnly || threat.maxHp >= 2000);
}

function tryDefend(state: BattleState, bot: BotState): boolean {
  const invaders = playerTroops(state).filter((e) => e.y < RIVER_Y + 1);
  if (invaders.length === 0) return false;
  const threat = invaders.reduce((a, b) => (a.y < b.y ? a : b));
  // A defensive building pulls a heavy ground tank off its lane and onto
  // itself — far better elixir economy than trading troops with it.
  if (isHeavyGroundThreat(threat)) {
    const building = affordableTroops(state).find(isDefensiveBuilding);
    if (building) {
      const spot = { x: clamp(threat.x, 4, ARENA_WIDTH - 4), y: clamp(threat.y - 3, 3, RIVER_Y - 2) };
      if (deployCard(state, "enemy", building, spot.x, spot.y)) return true;
    }
  }
  const cards = defenseCandidates(state, threat);
  if (cards.length === 0) return false;
  const card = cards[Math.floor(bot.rng() * cards.length)];
  const spot = defenseSpot(threat);
  return deployCard(state, "enemy", card, spot.x, spot.y);
}

/** Cheapest first — for value support behind a tank. */
function byCostAsc(a: CardId, b: CardId): number {
  return getCard(a).cost - getCard(b).cost;
}

/**
 * Build economy when it's safe: at max elixir with nothing invading, drop
 * the collector deep on our own side rather than spilling elixir.
 */
function tryEconomy(state: BattleState, bot: BotState): boolean {
  if (state.enemy.elixir.amount < bot.pushAt) return false;
  if (playerTroops(state).some((e) => e.y < RIVER_Y + 1)) return false;
  const collector = affordableTroops(state).find(isEconomyBuilding);
  if (!collector) return false;
  // Center-back, in front of the king tower, where it's hard to snipe.
  return deployCard(state, "enemy", collector, ARENA_WIDTH / 2, 5);
}

function tryPush(state: BattleState, bot: BotState): boolean {
  if (state.enemy.elixir.amount < effectivePushAt(state, bot)) return false;
  const affordable = affordableTroops(state);
  if (affordable.length === 0) return false;

  // Already have a tank out front? Feed the cheapest support into its lane
  // so the push arrives together instead of dribbling in piecemeal.
  const tanks = botTanks(state);
  if (tanks.length > 0) {
    const lead = tanks.reduce((a, b) => (a.y > b.y ? a : b)); // furthest advanced
    const support = affordable
      .filter((id) => getCard(id).kind === "troop" && !isWinCondition(id))
      .sort(byCostAsc);
    const pick = support[0] ?? affordable[0];
    return deployCard(state, "enemy", pick, nearestBridgeX(lead.x), RIVER_Y - 4);
  }

  const lane = targetLaneX(state, bot);
  // Otherwise lead with a win-condition; failing that, commit the most
  // expensive troop we can (a meaningful unit, never a stray skeleton).
  const wincons = affordable.filter(isWinCondition);
  if (wincons.length > 0) {
    const pick = wincons.sort(byCostAsc)[wincons.length - 1];
    return deployCard(state, "enemy", pick, lane, RIVER_Y - 4);
  }
  const troops = affordable.filter((id) => getCard(id).kind === "troop");
  const pool = troops.length > 0 ? troops : affordable;
  const pick = pool.sort(byCostAsc)[pool.length - 1];
  return deployCard(state, "enemy", pick, lane, RIVER_Y - 4);
}

/** Make at most one play right now. */
export function botThink(state: BattleState, bot: BotState): void {
  if (state.result) return;
  if (trySpellCluster(state)) return;
  if (tryDefend(state, bot)) return;
  if (tryEconomy(state, bot)) return;
  tryPush(state, bot);
}

/** Throttled entry point: call every tick, thinks once per interval. */
export function tickBot(state: BattleState, bot: BotState, dt: number): void {
  bot.sinceThink += dt;
  if (bot.sinceThink < bot.thinkInterval) return;
  bot.sinceThink = 0;
  botThink(state, bot);
}
