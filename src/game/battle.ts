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
  type CardId,
  type TroopCard,
} from "./cards";
import { createElixir, trySpend, type ElixirState } from "./elixir";
import { createHand, playCard, type HandState } from "./hand";

export type EntityKind = "troop" | "princess-tower" | "king-tower";

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

export interface BattleResult {
  winner: Side | "draw";
  playerCrowns: number;
  enemyCrowns: number;
}

export interface BattleState {
  entities: Entity[];
  player: SideState;
  enemy: SideState;
  /** Elapsed battle time in seconds. */
  time: number;
  overtime: boolean;
  result: BattleResult | null;
  effects: SpellEffect[];
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
      radius: card.unit.radius,
      cooldown: 0,
      targetId: null,
      active: true,
    });
  }
  state.entities.push(...spawned);
  return spawned;
}

export function applySpell(
  state: BattleState,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
  damage: number,
  radius: number,
): void {
  for (const e of state.entities) {
    if (e.side === side || e.hp <= 0) continue;
    if (distance(e, { x, y }) > radius + e.radius) continue;
    const factor = isBuilding(e) ? TOWER_SPELL_DAMAGE_FACTOR : 1;
    e.hp -= damage * factor;
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
    applySpell(state, side, cardId, x, y, card.damage, card.radius);
  } else {
    spawnTroops(state, side, card, x, y);
  }
  return true;
}
