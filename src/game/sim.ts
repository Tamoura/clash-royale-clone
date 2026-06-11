import {
  BRIDGE_HALF_WIDTH,
  RIVER_HALF_WIDTH,
  RIVER_Y,
  nearestBridgeX,
} from "./arena";
import {
  distance,
  isBuilding,
  sideState,
  type BattleResult,
  type BattleState,
  type Entity,
} from "./battle";
import { tickElixir } from "./elixir";

/** Regular time length; the final minute of it is double elixir. */
export const BATTLE_DURATION = 180;
export const DOUBLE_ELIXIR_AT = 120;
/** Sudden-death overtime length after a tied regular time. */
export const OVERTIME_DURATION = 60;

export function isDoubleElixir(state: BattleState): boolean {
  return state.overtime || state.time >= DOUBLE_ELIXIR_AT;
}

function livingEnemiesOf(state: BattleState, e: Entity): Entity[] {
  return state.entities.filter((o) => o.side !== e.side && o.hp > 0);
}

/** Distance between hull edges, used for both range and sight checks. */
function gap(a: Entity, b: Entity): number {
  return distance(a, b) - a.radius - b.radius;
}

function nearest(from: Entity, candidates: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = distance(from, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function findById(state: BattleState, id: number | null): Entity | null {
  if (id === null) return null;
  const e = state.entities.find((o) => o.id === id);
  return e && e.hp > 0 ? e : null;
}

function acquireTarget(state: BattleState, e: Entity): Entity | null {
  const enemies = livingEnemiesOf(state, e);
  if (isBuilding(e)) {
    // Towers only shoot troops, and only within range.
    const inRange = enemies.filter(
      (o) => o.kind === "troop" && gap(e, o) <= e.attackRange,
    );
    return nearest(e, inRange);
  }
  if (e.targetsBuildingsOnly) {
    return nearest(e, enemies.filter(isBuilding));
  }
  const troopsInSight = enemies.filter(
    (o) => o.kind === "troop" && gap(e, o) <= e.sightRange,
  );
  return nearest(e, troopsInSight) ?? nearest(e, enemies.filter(isBuilding));
}

function retarget(state: BattleState, e: Entity): Entity | null {
  const current = findById(state, e.targetId);
  if (isBuilding(e)) {
    // Towers drop targets that leave range.
    if (current && current.kind === "troop" && gap(e, current) <= e.attackRange) {
      return current;
    }
    return acquireTarget(state, e);
  }
  // Troops stay locked onto enemy troops, but a troop that is merely
  // walking toward a building re-checks for closer threats.
  if (current && current.kind === "troop") return current;
  return acquireTarget(state, e);
}

/**
 * Where should a troop walk to reach its target? Straight at it on the
 * same half; via the nearest bridge when the river is in the way.
 */
export function moveGoal(e: Entity, target: Entity): { x: number; y: number } {
  const crossesRiver =
    (e.y - RIVER_Y) * (target.y - RIVER_Y) < 0 ||
    Math.abs(e.y - RIVER_Y) < RIVER_HALF_WIDTH;
  if (!crossesRiver) return target;
  const bx = nearestBridgeX(e.x);
  const towardEnemy = target.y < e.y ? -1 : 1;
  const exitY = RIVER_Y + towardEnemy * (RIVER_HALF_WIDTH + 0.4);
  if (Math.abs(e.x - bx) <= BRIDGE_HALF_WIDTH) {
    // In the bridge corridor: walk straight across to the far bank.
    return { x: bx, y: exitY };
  }
  // Not lined up yet: walk to the bridge entrance on our own bank.
  return { x: bx, y: RIVER_Y - towardEnemy * (RIVER_HALF_WIDTH + 0.4) };
}

function moveToward(e: Entity, goal: { x: number; y: number }, dt: number): void {
  const d = distance(e, goal);
  if (d < 1e-6) return;
  const step = Math.min(e.speed * dt, d);
  e.x += ((goal.x - e.x) / d) * step;
  e.y += ((goal.y - e.y) / d) * step;
}

function actEntity(state: BattleState, e: Entity, dt: number): void {
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (!e.active) return;

  const target = retarget(state, e);
  e.targetId = target?.id ?? null;
  if (!target) return;

  if (gap(e, target) <= e.attackRange) {
    if (e.cooldown === 0) {
      target.hp -= e.damage;
      e.cooldown = e.hitSpeed;
    }
  } else if (e.kind === "troop") {
    moveToward(e, moveGoal(e, target), dt);
  }
}

function processDeaths(state: BattleState): void {
  for (const e of state.entities) {
    if (e.hp > 0) continue;
    if (e.kind === "princess-tower") {
      const winnerSide = e.side === "player" ? state.enemy : state.player;
      winnerSide.crowns += 1;
      wakeKing(state, e.side);
    } else if (e.kind === "king-tower") {
      const winner = e.side === "player" ? "enemy" : "player";
      sideState(state, winner).crowns = 3;
      finish(state, winner);
    }
  }
  state.entities = state.entities.filter((e) => e.hp > 0);
}

function wakeKing(state: BattleState, side: Entity["side"]): void {
  for (const e of state.entities) {
    if (e.side === side && e.kind === "king-tower") e.active = true;
  }
}

function wakeDamagedKings(state: BattleState): void {
  for (const e of state.entities) {
    if (e.kind === "king-tower" && e.hp < e.maxHp) e.active = true;
  }
}

/** Advance the battle by dt seconds. No-op once a result is set. */
export function tick(state: BattleState, dt: number): void {
  if (state.result) return;
  state.time += dt;

  const double = isDoubleElixir(state);
  state.player.elixir = tickElixir(state.player.elixir, dt, double);
  state.enemy.elixir = tickElixir(state.enemy.elixir, dt, double);

  for (const effect of state.effects) effect.ttl -= dt;
  state.effects = state.effects.filter((f) => f.ttl > 0);

  wakeDamagedKings(state);
  for (const e of [...state.entities]) {
    if (e.hp > 0) actEntity(state, e, dt);
  }
  wakeDamagedKings(state);
  processDeaths(state);
  checkClock(state);
}

function finish(state: BattleState, winner: BattleResult["winner"]): void {
  state.result = {
    winner,
    playerCrowns: state.player.crowns,
    enemyCrowns: state.enemy.crowns,
  };
}

function checkClock(state: BattleState): void {
  if (state.result) return;
  const crownDiff = state.player.crowns - state.enemy.crowns;
  if (!state.overtime) {
    if (state.time < BATTLE_DURATION) return;
    if (crownDiff !== 0) finish(state, crownDiff > 0 ? "player" : "enemy");
    else state.overtime = true;
    return;
  }
  // Sudden death: the tie broke the moment anyone took a crown.
  if (crownDiff !== 0) {
    finish(state, crownDiff > 0 ? "player" : "enemy");
  } else if (state.time >= BATTLE_DURATION + OVERTIME_DURATION) {
    finish(state, "draw");
  }
}
