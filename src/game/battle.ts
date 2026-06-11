import {
  canDeployTroopAt,
  inArena,
  towerSpots,
  type Side,
  type TowerKind,
} from "./arena";
import {
  DECK,
  SPEED_TILES_PER_SEC,
  getCard,
  type BuildingCard,
  type CardId,
  type TroopCard,
} from "./cards";
import { createElixir, trySpend, type ElixirState } from "./elixir";
import { createHand, playCard, type HandState } from "./hand";

export type EntityKind = "troop" | "building" | "princess-tower" | "king-tower";

/** Seconds a freshly deployed troop or building stands frozen. */
export const DEPLOY_DELAY = 1;

/** Spawners summon their first wave quickly, then every spawnInterval. */
export const FIRST_SPAWN_DELAY = 1;

export interface Entity {
  id: number;
  side: Side;
  kind: EntityKind;
  /** Which card spawned this entity (null for towers). */
  cardId: CardId | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  /** Seconds between attacks. */
  hitSpeed: number;
  attackRange: number;
  sightRange: number;
  /** Tiles per second; 0 for towers. */
  speed: number;
  targetsBuildingsOnly: boolean;
  /** Can this entity hit flying targets? */
  targetsAir: boolean;
  /** Flying entities path straight and are immune to ground-only attackers. */
  flying: boolean;
  /** Ground unit that leaps the river instead of detouring to a bridge. */
  jumpsRiver: boolean;
  /** Area damage around the struck target; 0 = single target. */
  splashRadius: number;
  /** Tiles of approach needed to charge; 0 = no charge mechanic. */
  chargeDistance: number;
  /** Distance walked toward the current target since the last hit. */
  chargeProgress: number;
  /** Seconds of post-deployment freeze remaining. */
  deployTimer: number;
  /** Seconds of stun remaining (no moving or attacking). */
  stunTimer: number;
  /** HP lost per second (deployable buildings decay; 0 otherwise). */
  decayPerSec: number;
  /** Damage dealt to nearby enemies on death (0 = none). */
  deathDamage: number;
  /** Radius of the death blast in tiles. */
  deathRadius: number;
  /** Card whose units this entity periodically summons (null = none). */
  spawnUnitId: CardId | null;
  /** Seconds between summons. */
  spawnInterval: number;
  /** Seconds until the next summon (unused when spawnUnitId is null). */
  spawnTimer: number;
  radius: number;
  /** Seconds until the next attack is ready. */
  cooldown: number;
  targetId: number | null;
  /** King towers start inactive and wake when damaged or a princess falls. */
  active: boolean;
}

export interface SideState {
  elixir: ElixirState;
  hand: HandState;
  crowns: number;
}

export interface SpellEffect {
  cardId: CardId;
  x: number;
  y: number;
  radius: number;
  /** Seconds left to display. */
  ttl: number;
}

/** A lingering area that boosts one side's troops (Rage). */
export interface BuffZone {
  side: Side;
  x: number;
  y: number;
  radius: number;
  /** Seconds of boost remaining. */
  ttl: number;
}

export interface BattleResult {
  winner: Side | "draw";
  playerCrowns: number;
  enemyCrowns: number;
}

/**
 * Gameplay moments recorded during deploys and ticks. The render/audio
 * layer drains this list each frame to trigger sounds and effects.
 */
export type BattleEvent =
  | { type: "deploy"; side: Side; cardId: CardId }
  | { type: "spell"; side: Side; cardId: CardId; x: number; y: number }
  | {
      type: "attack";
      kind: EntityKind;
      cardId: CardId | null;
      ranged: boolean;
      x: number;
      y: number;
      targetX: number;
      targetY: number;
    }
  | {
      type: "death";
      kind: EntityKind;
      cardId: CardId | null;
      side: Side;
      x: number;
      y: number;
    }
  | { type: "crown"; winner: Side }
  | { type: "finish"; winner: Side | "draw" };

export interface BattleState {
  entities: Entity[];
  player: SideState;
  enemy: SideState;
  /** Elapsed battle time in seconds. */
  time: number;
  overtime: boolean;
  result: BattleResult | null;
  effects: SpellEffect[];
  buffZones: BuffZone[];
  events: BattleEvent[];
  nextEntityId: number;
}

interface TowerStats {
  hp: number;
  damage: number;
  hitSpeed: number;
  range: number;
  radius: number;
}

const TOWER_STATS: Record<TowerKind, TowerStats> = {
  princess: { hp: 1400, damage: 110, hitSpeed: 0.8, range: 7.5, radius: 1.0 },
  king: { hp: 2600, damage: 110, hitSpeed: 1.0, range: 7.0, radius: 1.3 },
};

/** Spells hit crown towers for a fraction of their listed damage. */
export const TOWER_SPELL_DAMAGE_FACTOR = 0.4;

function makeTower(state: BattleState, side: Side, kind: TowerKind, x: number, y: number): Entity {
  const s = TOWER_STATS[kind];
  return {
    id: state.nextEntityId++,
    side,
    kind: kind === "king" ? "king-tower" : "princess-tower",
    cardId: null,
    x,
    y,
    hp: s.hp,
    maxHp: s.hp,
    damage: s.damage,
    hitSpeed: s.hitSpeed,
    attackRange: s.range,
    sightRange: s.range,
    speed: 0,
    targetsBuildingsOnly: false,
    targetsAir: true,
    flying: false,
    jumpsRiver: false,
    splashRadius: 0,
    chargeDistance: 0,
    chargeProgress: 0,
    deployTimer: 0,
    stunTimer: 0,
    decayPerSec: 0,
    deathDamage: 0,
    deathRadius: 0,
    spawnUnitId: null,
    spawnInterval: 0,
    spawnTimer: 0,
    radius: s.radius,
    cooldown: 0,
    targetId: null,
    active: kind !== "king",
  };
}

export function createBattle(): BattleState {
  const state: BattleState = {
    entities: [],
    player: { elixir: createElixir(), hand: createHand(DECK), crowns: 0 },
    enemy: { elixir: createElixir(), hand: createHand(DECK), crowns: 0 },
    time: 0,
    overtime: false,
    result: null,
    effects: [],
    buffZones: [],
    events: [],
    nextEntityId: 1,
  };
  for (const side of ["player", "enemy"] as const) {
    for (const spot of towerSpots(side)) {
      state.entities.push(makeTower(state, side, spot.kind, spot.x, spot.y));
    }
  }
  return state;
}

export function sideState(state: BattleState, side: Side): SideState {
  return side === "player" ? state.player : state.enemy;
}

export function isBuilding(e: Entity): boolean {
  return e.kind !== "troop";
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Spawn offsets so multi-unit cards don't stack on one point. */
const SPAWN_OFFSETS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-0.7, 0],
    [0.7, 0],
  ],
  3: [
    [0, -0.6],
    [-0.7, 0.5],
    [0.7, 0.5],
  ],
};

/**
 * Spawn the units of a troop card directly, bypassing hand/elixir/zone
 * checks. Used by deployCard and by tests.
 */
export function spawnUnits(
  state: BattleState,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): Entity[] {
  const card = getCard(cardId);
  if (card.kind !== "troop") throw new Error(`${cardId} is not a troop card`);
  return spawnTroops(state, side, card, x, y);
}

function spawnTroops(state: BattleState, side: Side, card: TroopCard, x: number, y: number): Entity[] {
  const offsets = SPAWN_OFFSETS[card.count] ?? [[0, 0]];
  const spawned: Entity[] = [];
  for (const [dx, dy] of offsets) {
    spawned.push({
      id: state.nextEntityId++,
      side,
      kind: "troop",
      cardId: card.id,
      x: x + dx,
      y: y + dy,
      hp: card.unit.maxHp,
      maxHp: card.unit.maxHp,
      damage: card.unit.damage,
      hitSpeed: card.unit.hitSpeed,
      attackRange: card.unit.attackRange,
      sightRange: card.unit.sightRange,
      speed: SPEED_TILES_PER_SEC[card.unit.speed],
      targetsBuildingsOnly: card.unit.targetsBuildingsOnly,
      targetsAir: card.unit.targetsAir,
      flying: card.unit.flying,
      jumpsRiver: card.unit.jumpsRiver,
      splashRadius: card.unit.splashRadius,
      chargeDistance: card.unit.chargeDistance,
      chargeProgress: 0,
      deployTimer: DEPLOY_DELAY,
      stunTimer: 0,
      radius: card.unit.radius,
      decayPerSec: 0,
      deathDamage: card.unit.deathDamage,
      deathRadius: card.unit.deathRadius,
      spawnUnitId: card.unit.spawnUnitId,
      spawnInterval: card.unit.spawnInterval,
      spawnTimer: FIRST_SPAWN_DELAY,
      cooldown: 0,
      targetId: null,
      active: true,
    });
  }
  state.entities.push(...spawned);
  return spawned;
}

function spawnBuilding(state: BattleState, side: Side, card: BuildingCard, x: number, y: number): void {
  const u = card.unit;
  state.entities.push({
    id: state.nextEntityId++,
    side,
    kind: "building",
    cardId: card.id,
    x,
    y,
    hp: u.maxHp,
    maxHp: u.maxHp,
    damage: u.damage,
    hitSpeed: u.hitSpeed,
    attackRange: u.attackRange,
    sightRange: u.attackRange,
    speed: 0,
    targetsBuildingsOnly: false,
    targetsAir: u.targetsAir,
    flying: false,
    jumpsRiver: false,
    splashRadius: u.splashRadius,
    chargeDistance: 0,
    chargeProgress: 0,
    deployTimer: DEPLOY_DELAY,
    stunTimer: 0,
    decayPerSec: u.maxHp / card.lifetime,
    deathDamage: u.deathDamage,
    deathRadius: u.deathRadius,
    spawnUnitId: u.spawnUnitId,
    spawnInterval: u.spawnInterval,
    spawnTimer: FIRST_SPAWN_DELAY,
    radius: u.radius,
    cooldown: 0,
    targetId: null,
    active: true,
  });
}

export function applySpell(
  state: BattleState,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
  damage: number,
  radius: number,
  stunSeconds = 0,
): void {
  for (const e of state.entities) {
    if (e.side === side || e.hp <= 0) continue;
    if (distance(e, { x, y }) > radius + e.radius) continue;
    // Only crown towers resist spells; deployed buildings take full damage.
    const isCrownTower = e.kind === "princess-tower" || e.kind === "king-tower";
    e.hp -= damage * (isCrownTower ? TOWER_SPELL_DAMAGE_FACTOR : 1);
    e.stunTimer = Math.max(e.stunTimer, stunSeconds);
  }
  state.effects.push({ cardId, x, y, radius, ttl: 0.6 });
}

/**
 * Attempt to play a card for `side` at (x, y).
 * Returns false (with no state change) if the card is not in hand,
 * unaffordable, or the position is invalid.
 */
export function deployCard(
  state: BattleState,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): boolean {
  if (state.result) return false;
  const me = sideState(state, side);
  if (!me.hand.cards.includes(cardId)) return false;
  const card = getCard(cardId);
  const validSpot =
    card.kind === "spell" ? inArena(x, y) : canDeployTroopAt(side, x, y);
  if (!validSpot) return false;
  const spent = trySpend(me.elixir, card.cost);
  if (!spent) return false;

  me.elixir = spent;
  me.hand = playCard(me.hand, cardId);
  if (card.kind === "spell") {
    state.events.push({ type: "spell", side, cardId, x, y });
    if (card.rageSeconds > 0) {
      state.buffZones.push({ side, x, y, radius: card.radius, ttl: card.rageSeconds });
      state.effects.push({ cardId, x, y, radius: card.radius, ttl: card.rageSeconds });
    } else {
      applySpell(state, side, cardId, x, y, card.damage, card.radius, card.stunSeconds);
    }
  } else if (card.kind === "building") {
    state.events.push({ type: "deploy", side, cardId });
    spawnBuilding(state, side, card, x, y);
  } else {
    state.events.push({ type: "deploy", side, cardId });
    spawnTroops(state, side, card, x, y);
  }
  return true;
}
