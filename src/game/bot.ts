import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_XS,
  RIVER_Y,
  nearestBridgeX,
  opposite,
  type Side,
} from "./arena";
import {
  checkDeploy,
  deployCard,
  distance,
  effectiveCard,
  levelMultiplier,
  sideState,
  TOWER_SPELL_DAMAGE_FACTOR,
  UNIT_CIRCLE,
  type BattleState,
  type Entity,
  type SideState,
} from "./battle";
import { getCard, type CardId } from "./cards";
import { useAbility } from "./abilities";

/** Seconds between bot decisions. */
export const THINK_INTERVAL = 1.0;
/** Elixir level at which the bot starts a push of its own. */
export const PUSH_ELIXIR = 8;

/**
 * Tuning knobs that make the bot easier or harder. Only the first two are
 * required: saved replays from before the optional knobs existed carry
 * just those, and every optional knob defaults to the classic bot.
 */
export interface BotProfile {
  /** Seconds between decisions. */
  thinkInterval: number;
  /** Elixir level at which the bot starts a push. */
  pushAt: number;
  /** The side the bot plays (default "enemy", the top half). */
  side?: Side;
  /** Seconds an invader must have been on the bot's half before it reacts (default 0). */
  reactionDelay?: number;
  /** Chance (0..1) that a play is a slip: the wrong card, or a misplaced one (default 0). */
  mistakeRate?: number;
  /** A spell must hit this many times its cost in troop value (default 1). */
  spellIQ?: number;
  /** May finish a low tower with a spell (default true). */
  allowFinisher?: boolean;
}

/** Every knob resolved: what createBot fills in for a missing field. */
export const BOT_PROFILE_DEFAULTS: Readonly<Required<Omit<BotProfile, "thinkInterval" | "pushAt">>> = {
  side: "enemy",
  reactionDelay: 0,
  mistakeRate: 0,
  spellIQ: 1,
  allowFinisher: true,
};

export interface BotState extends Required<BotProfile> {
  rng: () => number;
  sinceThink: number;
  /** Invader id -> battle time the bot first noticed it on its half (reactionDelay). */
  noticed: Map<number, number>;
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
    noticed: new Map(),
    thinkInterval: profile.thinkInterval ?? THINK_INTERVAL,
    pushAt: profile.pushAt ?? PUSH_ELIXIR,
    side: profile.side ?? BOT_PROFILE_DEFAULTS.side,
    reactionDelay: profile.reactionDelay ?? BOT_PROFILE_DEFAULTS.reactionDelay,
    mistakeRate: profile.mistakeRate ?? BOT_PROFILE_DEFAULTS.mistakeRate,
    spellIQ: profile.spellIQ ?? BOT_PROFILE_DEFAULTS.spellIQ,
    allowFinisher: profile.allowFinisher ?? BOT_PROFILE_DEFAULTS.allowFinisher,
  };
}

/**
 * One decision's view of the board. The bot reasons in its own frame: y
 * grows from its back line (0) toward the opponent, exactly as the board
 * reads for the top ("enemy") side. For the bottom side every y is
 * mirrored on the way in and out, so the same plays work from either half.
 */
interface Ctx {
  s: BattleState;
  bot: BotState;
  side: Side;
  opp: Side;
  me: SideState;
  them: SideState;
}

function makeCtx(state: BattleState, bot: BotState): Ctx {
  const opp = opposite(bot.side);
  return { s: state, bot, side: bot.side, opp, me: sideState(state, bot.side), them: sideState(state, opp) };
}

/** Board y <-> the bot's own frame (its own inverse; identity for "enemy"). */
function fy(c: Ctx, y: number): number {
  return c.side === "enemy" ? y : ARENA_HEIGHT - y;
}

function oppTroops(c: Ctx): Entity[] {
  return c.s.entities.filter((e) => e.side === c.opp && e.kind === "troop");
}

function affordableTroops(c: Ctx): CardId[] {
  return c.me.hand.cards.filter((id) => {
    const card = getCard(id);
    return (
      (card.kind === "troop" || card.kind === "building") &&
      card.cost <= c.me.elixir.amount
    );
  });
}

/**
 * Cards that can actually fight `threat`: no building-seekers (they
 * stroll right past invaders) and, against flyers, air-targeters only.
 */
function defenseCandidates(c: Ctx, threat: Entity): CardId[] {
  return affordableTroops(c).filter((id) => {
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
function botTanks(c: Ctx): Entity[] {
  return c.s.entities.filter(
    (e) => e.side === c.side && e.kind === "troop" && e.cardId !== null && isTankCard(e.cardId),
  );
}

/** The furthest-advanced of `units` (largest y in the bot's frame). */
function leadOf(c: Ctx, units: Entity[]): Entity {
  return units.reduce((a, b) => (fy(c, a.y) > fy(c, b.y) ? a : b));
}

/** A spot on the bot's half (own frame), between the threat and its towers. */
function defenseSpot(c: Ctx, threat: Entity): { x: number; y: number } {
  return {
    x: clamp(threat.x, 1, 17),
    y: clamp(fy(c, threat.y) - 2.5, 3, RIVER_Y - 1.5),
  };
}

/** Rough elixir value of one unit: its card's cost split across the count. */
function unitValue(t: Entity): number {
  if (!t.cardId) return 0;
  const card = getCard(t.cardId);
  return card.kind === "troop" ? card.cost / card.count : card.cost;
}

// ---- Placement (and the occasional slip) -----------------------------------

/** Directions a misplaced card drifts in. */
const SLIP_DIRS = UNIT_CIRCLE[8];

/**
 * A rookie's slip-up on the play it meant to make: half the time a random
 * affordable card instead, otherwise the right card 2-4 tiles off. The
 * slip is pulled back onto the bot's legal ground (checkDeploy) or dropped.
 */
function slip(c: Ctx, id: CardId, x: number, y: number): { id: CardId; x: number; y: number } | null {
  const rng = c.bot.rng;
  let card = id;
  let px = x;
  let py = y;
  if (rng() < 0.5) {
    const pool = c.me.hand.cards.filter((h) => {
      const eff = effectiveCard(c.s, c.side, h);
      return eff !== null && eff.cost <= c.me.elixir.amount;
    });
    if (pool.length > 0) card = pool[Math.floor(rng() * pool.length)];
  } else {
    const [dx, dy] = SLIP_DIRS[Math.floor(rng() * SLIP_DIRS.length)];
    const dist = 2 + rng() * 2;
    px = x + dx * dist;
    py = y + dy * dist;
  }
  if (checkDeploy(c.s, c.side, card, px, py) === "ok") return { id: card, x: px, y: py };
  const spell = effectiveCard(c.s, c.side, card)?.card.kind === "spell";
  px = clamp(px, 0.5, ARENA_WIDTH - 0.5);
  py = spell ? clamp(py, 0.5, ARENA_HEIGHT - 0.5) : fy(c, clamp(fy(c, py), 1, RIVER_Y - 1.5));
  return checkDeploy(c.s, c.side, card, px, py) === "ok" ? { id: card, x: px, y: py } : null;
}

/** Every bot play goes through here (board coordinates). */
function place(c: Ctx, id: CardId, x: number, y: number): boolean {
  if (c.bot.mistakeRate && c.bot.rng() < c.bot.mistakeRate) {
    const s = slip(c, id, x, y);
    if (s && deployCard(c.s, c.side, s.id, s.x, s.y)) return true;
  }
  return deployCard(c.s, c.side, id, x, y);
}

/**
 * Find a point where a spell of this radius would hit `minCount`
 * opposing troops worth more elixir than the spell costs, or null.
 * A human never arrows a 1-elixir skeleton pack.
 */
function findCluster(
  c: Ctx,
  radius: number,
  minCount: number,
  minValue: number,
): { x: number; y: number } | null {
  const troops = oppTroops(c);
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

function trySpellCluster(c: Ctx): boolean {
  for (const id of ["fireball", "tornado", "arrows", "zap"] as const) {
    if (!c.me.hand.cards.includes(id)) continue;
    const card = getCard(id);
    if (card.kind !== "spell" || card.cost > c.me.elixir.amount) continue;
    const cluster = findCluster(c, card.radius, 3, card.cost * c.bot.spellIQ);
    if (cluster && place(c, id, cluster.x, cluster.y)) {
      return true;
    }
  }
  return false;
}

/**
 * Cast freeze on a dense opposing cluster threatening a tower (3+ troops).
 * Prefer clusters already past the river onto our half.
 */
function tryFreeze(c: Ctx): boolean {
  if (!c.me.hand.cards.includes("freeze")) return false;
  const card = getCard("freeze");
  if (card.kind !== "spell" || card.cost > c.me.elixir.amount) return false;
  const invaders = oppTroops(c).filter((e) => fy(c, e.y) < RIVER_Y + 2);
  if (invaders.length < 3) return false;
  const cluster = findCluster(c, card.radius, 3, card.cost * 0.6 * c.bot.spellIQ);
  if (!cluster) return false;
  // Prefer freezing clusters that are already on our half.
  if (fy(c, cluster.y) > RIVER_Y + 1.5) return false;
  return place(c, "freeze", cluster.x, cluster.y);
}

/**
 * Cast rage on our own push when a win-con/tank is advancing with support.
 */
function tryRage(c: Ctx): boolean {
  if (!c.me.hand.cards.includes("rage")) return false;
  const card = getCard("rage");
  if (card.kind !== "spell" || card.cost > c.me.elixir.amount) return false;
  if (c.me.elixir.amount < 8) return false;
  const ours = c.s.entities.filter((e) => e.side === c.side && e.kind === "troop");
  if (ours.length < 2) return false;
  const hasWinCon = ours.some((e) => e.cardId !== null && isWinCondition(e.cardId));
  if (!hasWinCon) return false;
  // Center the rage on the furthest-advanced friendly troop.
  const lead = leadOf(c, ours);
  const nearby = ours.filter((t) => distance(lead, t) <= card.radius);
  if (nearby.length < 2) return false;
  return place(c, "rage", lead.x, lead.y);
}

/**
 * When ahead on elixir with no threat, cycle a cheap card in the back
 * rather than leaking at 10.
 */
function tryCycle(c: Ctx): boolean {
  const advantage = c.me.elixir.amount - c.them.elixir.amount;
  if (advantage < 5) return false;
  if (oppTroops(c).some((e) => fy(c, e.y) < RIVER_Y + 1)) return false;
  if (c.me.elixir.amount < 9) return false;
  const cheap = c.me.hand.cards
    .filter((id) => {
      const card = getCard(id);
      return (card.kind === "troop" || card.kind === "building") && card.cost <= 3 && card.cost <= c.me.elixir.amount;
    })
    .sort(byCostAsc);
  if (cheap.length === 0) return false;
  // Drop deep on our side, not at the bridge.
  return place(c, cheap[0], ARENA_WIDTH / 2, fy(c, 4.5));
}

/** Heavy ground threats (Giant, P.E.K.K.A…) a building can kite and stall. */
function isHeavyGroundThreat(threat: Entity): boolean {
  return !threat.flying && (threat.targetsBuildingsOnly || threat.maxHp >= 2000);
}

/** Heal a wounded friendly cluster mid-push (2+ troops missing real HP). */
function tryHeal(c: Ctx): boolean {
  if (!c.me.hand.cards.includes("heal")) return false;
  const card = getCard("heal");
  if (card.kind !== "spell" || card.cost > c.me.elixir.amount) return false;
  const wounded = c.s.entities.filter(
    (e) => e.side === c.side && e.kind === "troop" && e.hp > 0 && e.maxHp - e.hp > 200,
  );
  if (wounded.length < 2) return false;
  const center = wounded.reduce((a, b) => (a.maxHp > b.maxHp ? a : b));
  const near = wounded.filter((t) => distance(center, t) <= card.radius);
  if (near.length < 2) return false;
  return place(c, "heal", center.x, center.y);
}

/** Chip the weakest opposing tower with a Skeleton Barrel when flush. */
function tryBarrel(c: Ctx): boolean {
  if (!c.me.hand.cards.includes("skeleton-barrel")) return false;
  const card = getCard("skeleton-barrel");
  if (card.kind !== "spell" || card.cost > c.me.elixir.amount) return false;
  if (c.me.elixir.amount < c.bot.pushAt) return false;
  const towers = c.s.entities.filter(
    (e) => e.side === c.opp && (e.kind === "princess-tower" || e.kind === "king-tower"),
  );
  const princesses = towers.filter((t) => t.kind === "princess-tower");
  const pool = princesses.length > 0 ? princesses : towers;
  if (pool.length === 0) return false;
  const target = pool.reduce((a, b) => (a.hp < b.hp ? a : b));
  return place(c, "skeleton-barrel", target.x, target.y);
}

/**
 * A slow bot reacts late: each invader is ignored until it has been on the
 * bot's half for reactionDelay seconds of battle time.
 */
function noticedInvaders(c: Ctx, invaders: Entity[]): Entity[] {
  const seen = c.bot.noticed;
  const now = c.s.time;
  for (const id of [...seen.keys()]) {
    if (!invaders.some((e) => e.id === id)) seen.delete(id);
  }
  return invaders.filter((e) => {
    const first = seen.get(e.id);
    if (first === undefined) {
      seen.set(e.id, now);
      return false;
    }
    return now - first >= c.bot.reactionDelay;
  });
}

function tryDefend(c: Ctx): boolean {
  let invaders = oppTroops(c).filter((e) => fy(c, e.y) < RIVER_Y + 1);
  if (c.bot.reactionDelay) invaders = noticedInvaders(c, invaders);
  if (invaders.length === 0) return false;
  const threat = invaders.reduce((a, b) => (fy(c, a.y) < fy(c, b.y) ? a : b));
  // A defensive building pulls a heavy ground tank off its lane and onto
  // itself — far better elixir economy than trading troops with it.
  if (isHeavyGroundThreat(threat)) {
    const building = affordableTroops(c).find(isDefensiveBuilding);
    if (building) {
      const spot = { x: clamp(threat.x, 4, ARENA_WIDTH - 4), y: clamp(fy(c, threat.y) - 3, 3, RIVER_Y - 2) };
      if (place(c, building, spot.x, fy(c, spot.y))) return true;
    }
  }
  const cards = defenseCandidates(c, threat);
  if (cards.length === 0) return false;
  const card = cards[Math.floor(c.bot.rng() * cards.length)];
  const spot = defenseSpot(c, threat);
  return place(c, card, spot.x, fy(c, spot.y));
}

/** Cheapest first — for value support behind a tank. */
function byCostAsc(a: CardId, b: CardId): number {
  return getCard(a).cost - getCard(b).cost;
}

/**
 * Build economy when it's safe: at max elixir with nothing invading, drop
 * the collector deep on our own side rather than spilling elixir.
 */
function tryEconomy(c: Ctx): boolean {
  if (c.me.elixir.amount < c.bot.pushAt) return false;
  if (oppTroops(c).some((e) => fy(c, e.y) < RIVER_Y + 1)) return false;
  const collector = affordableTroops(c).find(isEconomyBuilding);
  if (!collector) return false;
  // Center-back, in front of the king tower, where it's hard to snipe.
  return place(c, collector, ARENA_WIDTH / 2, fy(c, 5));
}

function tryPush(c: Ctx): boolean {
  if (c.me.elixir.amount < c.bot.pushAt) return false;
  const affordable = affordableTroops(c);
  if (affordable.length === 0) return false;
  const bridgeY = fy(c, RIVER_Y - 4);

  // Already have a tank out front? Feed support into its lane so the push
  // arrives together instead of dribbling in piecemeal. A flying win-con
  // (Balloon) is the prime escort — it rides the tank's aggro to the tower.
  const tanks = botTanks(c);
  if (tanks.length > 0) {
    const lead = leadOf(c, tanks);
    const flyer = affordable.find((id) => {
      const card = getCard(id);
      return card.kind === "troop" && card.unit.targetsBuildingsOnly && card.unit.flying;
    });
    const support = affordable
      .filter((id) => getCard(id).kind === "troop" && !isWinCondition(id))
      .sort(byCostAsc);
    const pick = flyer ?? support[0] ?? affordable[0];
    return place(c, pick, nearestBridgeX(lead.x), bridgeY);
  }

  const lane = BRIDGE_XS[c.bot.rng() < 0.5 ? 0 : 1];
  // Otherwise lead with a win-condition; failing that, commit the most
  // expensive troop we can (a meaningful unit, never a stray skeleton).
  const wincons = affordable.filter(isWinCondition);
  if (wincons.length > 0) {
    // Random among win-cons: a fixed tie-break (e.g. always the priciest)
    // left equal-cost cards rotting in hand for whole matches.
    const pick = wincons[Math.floor(c.bot.rng() * wincons.length)];
    return place(c, pick, lane, bridgeY);
  }
  const troops = affordable.filter((id) => getCard(id).kind === "troop");
  const pool = troops.length > 0 ? troops : affordable;
  const pick = pool.sort(byCostAsc)[pool.length - 1];
  return place(c, pick, lane, bridgeY);
}

/**
 * King's Ability: fire it the moment it's charged AND the situation suits
 * it — a rally behind a push, a restore when a tower is hurting, a salvo
 * when the opponent's troops crowd our king.
 */
function tryAbility(c: Ctx): boolean {
  const me = c.me;
  if (!me.ability || me.abilityCharge < 1) return false;
  if (me.ability === "rally") {
    const lead = botTanks(c).reduce<Entity | null>((a, b) => (!a || fy(c, b.y) > fy(c, a.y) ? b : a), null);
    if (!lead || fy(c, lead.y) < RIVER_Y - 3) return false;
  } else if (me.ability === "restore") {
    const hurt = c.s.entities.some(
      (e) =>
        e.side === c.side &&
        (e.kind === "princess-tower" || e.kind === "king-tower") &&
        e.hp > 0 &&
        e.hp < e.maxHp * 0.55,
    );
    if (!hurt) return false;
  } else {
    const king = c.s.entities.find((e) => e.side === c.side && e.kind === "king-tower");
    if (!king) return false;
    const near = oppTroops(c).filter((t) => distance(t, king) < 10).length;
    if (near < 2) return false;
  }
  return useAbility(c.s, c.side);
}

/**
 * The rudest play in the game: when an opposing tower is low enough that a
 * direct-damage spell finishes it outright, cast it at the tower — no
 * cluster value needed, towers don't dodge.
 */
function tryFinisher(c: Ctx): boolean {
  const towers = c.s.entities.filter(
    (e) =>
      e.side === c.opp &&
      (e.kind === "princess-tower" || e.kind === "king-tower") &&
      e.hp > 0,
  );
  if (towers.length === 0) return false;
  for (const id of c.me.hand.cards) {
    const card = getCard(id);
    if (card.kind !== "spell" || card.damage <= 0) continue;
    if (card.cost > c.me.elixir.amount) continue;
    const dealt =
      card.damage * levelMultiplier(c.me.levels, id) * TOWER_SPELL_DAMAGE_FACTOR;
    const kill = towers.find((t) => t.hp <= dealt);
    if (kill && place(c, id, kill.x, kill.y)) return true;
  }
  return false;
}

/**
 * Split pressure: sitting at max elixir with a push already committed,
 * drop a cheap troop at the OTHER bridge so the opponent must answer both
 * lanes at once.
 */
function trySplit(c: Ctx): boolean {
  if (c.me.elixir.amount < 9.5) return false;
  const tanks = botTanks(c);
  if (tanks.length === 0) return false;
  const lead = leadOf(c, tanks);
  const otherLane = BRIDGE_XS.find((x) => x !== nearestBridgeX(lead.x));
  if (otherLane === undefined) return false;
  const cheap = c.me.hand.cards
    .filter((id) => {
      const card = getCard(id);
      return card.kind === "troop" && card.cost <= 3 && !card.unit.targetsBuildingsOnly;
    })
    .sort(byCostAsc);
  if (cheap.length === 0) return false;
  return place(c, cheap[0], otherLane, fy(c, RIVER_Y - 4));
}

/**
 * Double down with the Mirror: right after committing a tank/win-con to a
 * push, replay it into the same lane if the +1 price is still affordable.
 */
function tryMirror(c: Ctx): boolean {
  if (!c.me.hand.cards.includes("mirror")) return false;
  const last = c.me.lastPlayed;
  if (!last || !isTankCard(last)) return false;
  if (c.me.elixir.amount < getCard(last).cost + 1) return false;
  const tanks = botTanks(c);
  if (tanks.length === 0) return false;
  const lead = leadOf(c, tanks);
  // Only pile on while the push is still building on our half.
  if (fy(c, lead.y) > RIVER_Y + 6) return false;
  return place(c, "mirror", nearestBridgeX(lead.x), fy(c, RIVER_Y - 4));
}

/** Make at most one play right now. */
export function botThink(state: BattleState, bot: BotState): void {
  if (state.result) return;
  const c = makeCtx(state, bot);
  if (bot.allowFinisher && tryFinisher(c)) return;
  if (tryAbility(c)) return;
  if (tryFreeze(c)) return;
  if (trySpellCluster(c)) return;
  if (tryDefend(c)) return;
  if (tryHeal(c)) return;
  if (tryRage(c)) return;
  if (tryBarrel(c)) return;
  if (tryMirror(c)) return;
  if (tryEconomy(c)) return;
  if (tryPush(c)) return;
  // Still flush after (or unable to) push? Pressure the other lane.
  if (trySplit(c)) return;
  tryCycle(c);
}

/** Throttled entry point: call every tick, thinks once per interval. */
export function tickBot(state: BattleState, bot: BotState, dt: number): void {
  bot.sinceThink += dt;
  if (bot.sinceThink < bot.thinkInterval) return;
  bot.sinceThink = 0;
  botThink(state, bot);
}
