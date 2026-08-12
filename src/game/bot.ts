import { ARENA_WIDTH, BRIDGE_XS, RIVER_Y, nearestBridgeX } from "./arena";
import {
  deployCard,
  distance,
  levelMultiplier,
  TOWER_SPELL_DAMAGE_FACTOR,
  type BattleState,
  type Entity,
} from "./battle";
import { getCard, type CardId } from "./cards";

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
  for (const id of ["fireball", "tornado", "arrows", "zap"] as const) {
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

/**
 * Cast freeze on a dense player cluster threatening a tower (3+ troops).
 * Prefer clusters already past the river onto our half.
 */
function tryFreeze(state: BattleState): boolean {
  if (!state.enemy.hand.cards.includes("freeze")) return false;
  const card = getCard("freeze");
  if (card.kind !== "spell" || card.cost > state.enemy.elixir.amount) return false;
  const invaders = playerTroops(state).filter((e) => e.y < RIVER_Y + 2);
  if (invaders.length < 3) return false;
  const cluster = findCluster(state, card.radius, 3, card.cost * 0.6);
  if (!cluster) return false;
  // Prefer freezing clusters that are already on our half.
  if (cluster.y > RIVER_Y + 1.5) return false;
  return deployCard(state, "enemy", "freeze", cluster.x, cluster.y);
}

/**
 * Cast rage on our own push when a win-con/tank is advancing with support.
 */
function tryRage(state: BattleState): boolean {
  if (!state.enemy.hand.cards.includes("rage")) return false;
  const card = getCard("rage");
  if (card.kind !== "spell" || card.cost > state.enemy.elixir.amount) return false;
  if (state.enemy.elixir.amount < 8) return false;
  const ours = state.entities.filter((e) => e.side === "enemy" && e.kind === "troop");
  if (ours.length < 2) return false;
  const hasWinCon = ours.some((e) => e.cardId !== null && isWinCondition(e.cardId));
  if (!hasWinCon) return false;
  // Center the rage on the furthest-advanced friendly troop.
  const lead = ours.reduce((a, b) => (a.y > b.y ? a : b));
  const nearby = ours.filter((t) => distance(lead, t) <= card.radius);
  if (nearby.length < 2) return false;
  return deployCard(state, "enemy", "rage", lead.x, lead.y);
}

/**
 * When ahead on elixir with no threat, cycle a cheap card in the back
 * rather than leaking at 10.
 */
function tryCycle(state: BattleState): boolean {
  const advantage = state.enemy.elixir.amount - state.player.elixir.amount;
  if (advantage < 5) return false;
  if (playerTroops(state).some((e) => e.y < RIVER_Y + 1)) return false;
  if (state.enemy.elixir.amount < 9) return false;
  const cheap = state.enemy.hand.cards
    .filter((id) => {
      const c = getCard(id);
      return (c.kind === "troop" || c.kind === "building") && c.cost <= 3 && c.cost <= state.enemy.elixir.amount;
    })
    .sort(byCostAsc);
  if (cheap.length === 0) return false;
  // Drop deep on our side, not at the bridge.
  return deployCard(state, "enemy", cheap[0], ARENA_WIDTH / 2, 4.5);
}

/** Heavy ground threats (Giant, P.E.K.K.A…) a building can kite and stall. */
function isHeavyGroundThreat(threat: Entity): boolean {
  return !threat.flying && (threat.targetsBuildingsOnly || threat.maxHp >= 2000);
}

/** Heal a wounded friendly cluster mid-push (2+ troops missing real HP). */
function tryHeal(state: BattleState): boolean {
  if (!state.enemy.hand.cards.includes("heal")) return false;
  const card = getCard("heal");
  if (card.kind !== "spell" || card.cost > state.enemy.elixir.amount) return false;
  const wounded = state.entities.filter(
    (e) => e.side === "enemy" && e.kind === "troop" && e.hp > 0 && e.maxHp - e.hp > 200,
  );
  if (wounded.length < 2) return false;
  const center = wounded.reduce((a, b) => (a.maxHp > b.maxHp ? a : b));
  const near = wounded.filter((t) => distance(center, t) <= card.radius);
  if (near.length < 2) return false;
  return deployCard(state, "enemy", "heal", center.x, center.y);
}

/** Chip the weakest player tower with a Skeleton Barrel when flush. */
function tryBarrel(state: BattleState, bot: BotState): boolean {
  if (!state.enemy.hand.cards.includes("skeleton-barrel")) return false;
  const card = getCard("skeleton-barrel");
  if (card.kind !== "spell" || card.cost > state.enemy.elixir.amount) return false;
  if (state.enemy.elixir.amount < bot.pushAt) return false;
  const towers = state.entities.filter(
    (e) => e.side === "player" && (e.kind === "princess-tower" || e.kind === "king-tower"),
  );
  const princesses = towers.filter((t) => t.kind === "princess-tower");
  const pool = princesses.length > 0 ? princesses : towers;
  if (pool.length === 0) return false;
  const target = pool.reduce((a, b) => (a.hp < b.hp ? a : b));
  return deployCard(state, "enemy", "skeleton-barrel", target.x, target.y);
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
  if (state.enemy.elixir.amount < bot.pushAt) return false;
  const affordable = affordableTroops(state);
  if (affordable.length === 0) return false;

  // Already have a tank out front? Feed support into its lane so the push
  // arrives together instead of dribbling in piecemeal. A flying win-con
  // (Balloon) is the prime escort — it rides the tank's aggro to the tower.
  const tanks = botTanks(state);
  if (tanks.length > 0) {
    const lead = tanks.reduce((a, b) => (a.y > b.y ? a : b)); // furthest advanced
    const flyer = affordable.find((id) => {
      const c = getCard(id);
      return c.kind === "troop" && c.unit.targetsBuildingsOnly && c.unit.flying;
    });
    const support = affordable
      .filter((id) => getCard(id).kind === "troop" && !isWinCondition(id))
      .sort(byCostAsc);
    const pick = flyer ?? support[0] ?? affordable[0];
    return deployCard(state, "enemy", pick, nearestBridgeX(lead.x), RIVER_Y - 4);
  }

  const lane = BRIDGE_XS[bot.rng() < 0.5 ? 0 : 1];
  // Otherwise lead with a win-condition; failing that, commit the most
  // expensive troop we can (a meaningful unit, never a stray skeleton).
  const wincons = affordable.filter(isWinCondition);
  if (wincons.length > 0) {
    // Random among win-cons: a fixed tie-break (e.g. always the priciest)
    // left equal-cost cards rotting in hand for whole matches.
    const pick = wincons[Math.floor(bot.rng() * wincons.length)];
    return deployCard(state, "enemy", pick, lane, RIVER_Y - 4);
  }
  const troops = affordable.filter((id) => getCard(id).kind === "troop");
  const pool = troops.length > 0 ? troops : affordable;
  const pick = pool.sort(byCostAsc)[pool.length - 1];
  return deployCard(state, "enemy", pick, lane, RIVER_Y - 4);
}

/**
 * The rudest play in the game: when a player tower is low enough that a
 * direct-damage spell finishes it outright, cast it at the tower — no
 * cluster value needed, towers don't dodge.
 */
function tryFinisher(state: BattleState): boolean {
  const towers = state.entities.filter(
    (e) =>
      e.side === "player" &&
      (e.kind === "princess-tower" || e.kind === "king-tower") &&
      e.hp > 0,
  );
  if (towers.length === 0) return false;
  for (const id of state.enemy.hand.cards) {
    const card = getCard(id);
    if (card.kind !== "spell" || card.damage <= 0) continue;
    if (card.cost > state.enemy.elixir.amount) continue;
    const dealt =
      card.damage * levelMultiplier(state.enemy.levels, id) * TOWER_SPELL_DAMAGE_FACTOR;
    const kill = towers.find((t) => t.hp <= dealt);
    if (kill && deployCard(state, "enemy", id, kill.x, kill.y)) return true;
  }
  return false;
}

/**
 * Split pressure: sitting at max elixir with a push already committed,
 * drop a cheap troop at the OTHER bridge so the player must answer both
 * lanes at once.
 */
function trySplit(state: BattleState): boolean {
  if (state.enemy.elixir.amount < 9.5) return false;
  const tanks = botTanks(state);
  if (tanks.length === 0) return false;
  const lead = tanks.reduce((a, b) => (a.y > b.y ? a : b));
  const otherLane = BRIDGE_XS.find((x) => x !== nearestBridgeX(lead.x));
  if (otherLane === undefined) return false;
  const cheap = state.enemy.hand.cards
    .filter((id) => {
      const c = getCard(id);
      return c.kind === "troop" && c.cost <= 3 && !c.unit.targetsBuildingsOnly;
    })
    .sort(byCostAsc);
  if (cheap.length === 0) return false;
  return deployCard(state, "enemy", cheap[0], otherLane, RIVER_Y - 4);
}

/**
 * Double down with the Mirror: right after committing a tank/win-con to a
 * push, replay it into the same lane if the +1 price is still affordable.
 */
function tryMirror(state: BattleState): boolean {
  if (!state.enemy.hand.cards.includes("mirror")) return false;
  const last = state.enemy.lastPlayed;
  if (!last || !isTankCard(last)) return false;
  if (state.enemy.elixir.amount < getCard(last).cost + 1) return false;
  const tanks = botTanks(state);
  if (tanks.length === 0) return false;
  const lead = tanks.reduce((a, b) => (a.y > b.y ? a : b));
  // Only pile on while the push is still building on our half.
  if (lead.y > RIVER_Y + 6) return false;
  return deployCard(state, "enemy", "mirror", nearestBridgeX(lead.x), RIVER_Y - 4);
}

/** Make at most one play right now. */
export function botThink(state: BattleState, bot: BotState): void {
  if (state.result) return;
  if (tryFinisher(state)) return;
  if (tryFreeze(state)) return;
  if (trySpellCluster(state)) return;
  if (tryDefend(state, bot)) return;
  if (tryHeal(state)) return;
  if (tryRage(state)) return;
  if (tryBarrel(state, bot)) return;
  if (tryMirror(state)) return;
  if (tryEconomy(state, bot)) return;
  if (tryPush(state, bot)) return;
  // Still flush after (or unable to) push? Pressure the other lane.
  if (trySplit(state)) return;
  tryCycle(state);
}

/** Throttled entry point: call every tick, thinks once per interval. */
export function tickBot(state: BattleState, bot: BotState, dt: number): void {
  bot.sinceThink += dt;
  if (bot.sinceThink < bot.thinkInterval) return;
  bot.sinceThink = 0;
  botThink(state, bot);
}
