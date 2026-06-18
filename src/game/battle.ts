import {
  ARENA_WIDTH,
  RIVER_Y,
  canDeployTroopAt,
  inArena,
  towerSpots,
  type OpenLanes,
  type Side,
  type TowerKind,
} from "./arena";
import {
  CARDS,
  DEFAULT_DECK,
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
  /** Projectile pierces every enemy along its flight line (false = single hit). */
  pierce: boolean;
  /** Tiles this entity hops backward (away from its target) after firing. */
  recoil: number;
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
  /** Seconds per 1 elixir generated for the owner (0 = none). */
  elixirInterval: number;
  /** Seconds until the next elixir payout. */
  elixirTimer: number;
  radius: number;
  /** Seconds until the next attack is ready. */
  cooldown: number;
  targetId: number | null;
  /** King towers start inactive and wake when damaged or a princess falls. */
  active: boolean;
}

/** Running battle statistics shown on the result screen. */
export interface SideStats {
  damageDealt: number;
  elixirSpent: number;
}

/** Card upgrade levels (absent = level 1). */
export type CardLevels = Partial<Record<CardId, number>>;

export interface SideState {
  elixir: ElixirState;
  hand: HandState;
  crowns: number;
  stats: SideStats;
  levels: CardLevels;
}

export interface SpellEffect {
  cardId: CardId;
  x: number;
  y: number;
  radius: number;
  /** Seconds left to display. */
  ttl: number;
}

/** A ranged shot in flight; damage lands on arrival. */
export interface Projectile {
  id: number;
  side: Side;
  /** Card of the shooter (null for towers). */
  cardId: CardId | null;
  /** Shooter kind, for projectile styling. */
  sourceKind: EntityKind;
  /** Launch point (for arc rendering). */
  sx: number;
  sy: number;
  x: number;
  y: number;
  targetId: number;
  /** Tiles per second. */
  speed: number;
  damage: number;
  splashRadius: number;
  /** Whether the splash may hit flyers. */
  targetsAir: boolean;
  /** Pierces straight through every enemy in its path instead of homing. */
  pierce: boolean;
  /** Unit travel direction (pierce only); normalized. */
  dirX: number;
  dirY: number;
  /** Tiles of flight remaining before the pierce shot expires. */
  range: number;
  /** Ids of entities a pierce shot has already damaged (hit each once). */
  hitIds: number[];
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
  | { type: "king-wake"; side: Side }
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
  projectiles: Projectile[];
  buffZones: BuffZone[];
  events: BattleEvent[];
  nextEntityId: number;
  /** Flat elixir-rate multiplier for game modes (1 = normal, 3 = triple, 7 = mega). */
  elixirRate: number;
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
    pierce: false,
    recoil: 0,
    deployTimer: 0,
    stunTimer: 0,
    decayPerSec: 0,
    deathDamage: 0,
    deathRadius: 0,
    spawnUnitId: null,
    spawnInterval: 0,
    spawnTimer: 0,
    elixirInterval: 0,
    elixirTimer: 0,
    radius: s.radius,
    cooldown: 0,
    targetId: null,
    active: kind !== "king",
  };
}

/** A legal battle deck: exactly 8 unique, known cards. */
export function isValidDeck(cards: CardId[]): boolean {
  return (
    cards.length === 8 &&
    new Set(cards).size === 8 &&
    cards.every((id) => CARDS[id] !== undefined)
  );
}

/** Stat multiplier for a side playing cardId: +10% per level. */
export function levelMultiplier(levels: CardLevels, cardId: CardId): number {
  return 1 + 0.1 * ((levels[cardId] ?? 1) - 1);
}

export function createBattle(
  playerDeck: CardId[] = DEFAULT_DECK,
  enemyDeck: CardId[] = DEFAULT_DECK,
  levels: { player?: CardLevels; enemy?: CardLevels } = {},
  elixirRate = 1,
): BattleState {
  const state: BattleState = {
    entities: [],
    player: {
      elixir: createElixir(),
      hand: createHand(playerDeck),
      crowns: 0,
      stats: { damageDealt: 0, elixirSpent: 0 },
      levels: levels.player ?? {},
    },
    enemy: {
      elixir: createElixir(),
      hand: createHand(enemyDeck),
      crowns: 0,
      stats: { damageDealt: 0, elixirSpent: 0 },
      levels: levels.enemy ?? {},
    },
    time: 0,
    overtime: false,
    result: null,
    effects: [],
    projectiles: [],
    buffZones: [],
    events: [],
    nextEntityId: 1,
    elixirRate,
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
 * Spawn offsets for a multi-unit card. Small counts use the hand-tuned
 * presets; bigger swarms (Bats, Skeleton Army…) pack into an even,
 * deterministic phyllotaxis spiral so they don't all stack on one tile.
 */
function spawnOffsets(count: number): Array<[number, number]> {
  const preset = SPAWN_OFFSETS[count];
  if (preset) return preset;
  const out: Array<[number, number]> = [];
  const spacing = 0.42;
  for (let i = 0; i < count; i++) {
    const r = spacing * Math.sqrt(i);
    const a = i * 2.399963; // golden angle, for even packing
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

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
  const mult = levelMultiplier(sideState(state, side).levels, card.id);
  const offsets = spawnOffsets(card.count);
  const spawned: Entity[] = [];
  for (const [dx, dy] of offsets) {
    spawned.push({
      id: state.nextEntityId++,
      side,
      kind: "troop",
      cardId: card.id,
      x: x + dx,
      y: y + dy,
      hp: card.unit.maxHp * mult,
      maxHp: card.unit.maxHp * mult,
      damage: card.unit.damage * mult,
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
      pierce: card.unit.pierce,
      recoil: card.unit.recoil,
      deployTimer: DEPLOY_DELAY,
      stunTimer: 0,
      radius: card.unit.radius,
      decayPerSec: 0,
      deathDamage: card.unit.deathDamage * mult,
      deathRadius: card.unit.deathRadius,
      spawnUnitId: card.unit.spawnUnitId,
      spawnInterval: card.unit.spawnInterval,
      spawnTimer: FIRST_SPAWN_DELAY,
      elixirInterval: 0,
      elixirTimer: 0,
      cooldown: 0,
      targetId: null,
      active: true,
    });
  }
  state.entities.push(...spawned);
  return spawned;
}

function spawnBuilding(state: BattleState, side: Side, card: BuildingCard, x: number, y: number): void {
  const mult = levelMultiplier(sideState(state, side).levels, card.id);
  const u = card.unit;
  state.entities.push({
    id: state.nextEntityId++,
    side,
    kind: "building",
    cardId: card.id,
    x,
    y,
    hp: u.maxHp * mult,
    maxHp: u.maxHp * mult,
    damage: u.damage * mult,
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
    pierce: false,
    recoil: 0,
    deployTimer: DEPLOY_DELAY,
    stunTimer: 0,
    decayPerSec: (u.maxHp * mult) / card.lifetime,
    deathDamage: u.deathDamage,
    deathRadius: u.deathRadius,
    spawnUnitId: u.spawnUnitId,
    spawnInterval: u.spawnInterval,
    spawnTimer: FIRST_SPAWN_DELAY,
    elixirInterval: u.elixirInterval,
    elixirTimer: u.elixirInterval,
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
  knockback = 0,
): void {
  for (const e of state.entities) {
    if (e.side === side || e.hp <= 0) continue;
    if (distance(e, { x, y }) > radius + e.radius) continue;
    // Only crown towers resist spells; deployed buildings take full damage.
    const isCrownTower = e.kind === "princess-tower" || e.kind === "king-tower";
    const dealt = damage * (isCrownTower ? TOWER_SPELL_DAMAGE_FACTOR : 1);
    e.hp -= dealt;
    sideState(state, side).stats.damageDealt += dealt;
    e.stunTimer = Math.max(e.stunTimer, stunSeconds);
    // Surviving troops get shoved away from the blast center.
    if (knockback > 0 && e.kind === "troop" && e.hp > 0) {
      const d = Math.max(0.1, distance(e, { x, y }));
      e.x += ((e.x - x) / d) * knockback;
      e.y += ((e.y - y) / d) * knockback;
    }
  }
  state.effects.push({ cardId, x, y, radius, ttl: 0.6 });
}

/** Why a deploy would be rejected (or "ok" if it would succeed). */
export type DeployCheck = "ok" | "finished" | "not-in-hand" | "bad-spot" | "no-elixir";

/**
 * Lanes where `side` may push into enemy territory — opened wherever
 * the opponent's princess tower on that side has been destroyed (CR).
 */
export function openLanes(state: BattleState, side: Side): OpenLanes {
  const opp = side === "player" ? "enemy" : "player";
  const has = (left: boolean): boolean =>
    state.entities.some(
      (e) =>
        e.side === opp &&
        e.kind === "princess-tower" &&
        e.x < ARENA_WIDTH / 2 === left,
    );
  return { left: !has(true), right: !has(false) };
}

/**
 * Clearance (tiles, from tower centre) a troop deploy must keep from a
 * surviving enemy tower. The king needs a wide buffer so opening a lane
 * doesn't let you drop units straight onto it.
 */
const KING_DEPLOY_BUFFER = 4.5;
const PRINCESS_DEPLOY_BUFFER = 3;

/** Is (x, y) too close to a surviving enemy tower to deploy a troop? */
function nearEnemyTower(state: BattleState, side: Side, x: number, y: number): boolean {
  // Only enemy territory is restricted; your own half always has its clearance.
  const inEnemyHalf = side === "player" ? y < RIVER_Y : y > RIVER_Y;
  if (!inEnemyHalf) return false;
  const opp = side === "player" ? "enemy" : "player";
  return state.entities.some((e) => {
    if (e.side !== opp) return false;
    if (e.kind === "king-tower") return distance(e, { x, y }) < KING_DEPLOY_BUFFER;
    if (e.kind === "princess-tower") return distance(e, { x, y }) < PRINCESS_DEPLOY_BUFFER;
    return false;
  });
}

/** Dry-run of deployCard, used for UI validity feedback. */
export function checkDeploy(
  state: BattleState,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): DeployCheck {
  if (state.result) return "finished";
  const me = sideState(state, side);
  if (!me.hand.cards.includes(cardId)) return "not-in-hand";
  const card = getCard(cardId);
  const validSpot =
    card.kind === "spell"
      ? inArena(x, y)
      : canDeployTroopAt(side, x, y, openLanes(state, side));
  if (!validSpot) return "bad-spot";
  // Even once a lane opens, troops can't be dropped right on the enemy's
  // towers — push-ins need a buffer (especially around the king tower).
  if (card.kind !== "spell" && nearEnemyTower(state, side, x, y)) return "bad-spot";
  if (!trySpend(me.elixir, card.cost)) return "no-elixir";
  return "ok";
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
  if (checkDeploy(state, side, cardId, x, y) !== "ok") return false;
  const me = sideState(state, side);
  const card = getCard(cardId);
  me.elixir = trySpend(me.elixir, card.cost)!;
  me.stats.elixirSpent += card.cost;
  me.hand = playCard(me.hand, cardId);
  if (card.kind === "spell") {
    state.events.push({ type: "spell", side, cardId, x, y });
    if (card.rageSeconds > 0) {
      state.buffZones.push({ side, x, y, radius: card.radius, ttl: card.rageSeconds });
      state.effects.push({ cardId, x, y, radius: card.radius, ttl: card.rageSeconds });
    } else {
      applySpell(
        state,
        side,
        cardId,
        x,
        y,
        card.damage * levelMultiplier(me.levels, card.id),
        card.radius,
        card.stunSeconds,
        card.knockback,
      );
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
