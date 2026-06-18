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
  spawnUnits,
  type BattleResult,
  type BattleState,
  type Entity,
  type Projectile,
} from "./battle";
import { ELIXIR_MAX, tickElixir } from "./elixir";

/** Regular time length; the final minute of it is double elixir. */
export const BATTLE_DURATION = 180;
export const DOUBLE_ELIXIR_AT = 120;
/** Sudden-death overtime length (CR: 2 minutes, last one at 3x). */
export const OVERTIME_DURATION = 120;

/**
 * CR's elixir curve: 1x for the first two minutes, 2x for the last
 * regular minute and the first overtime minute, 3x after that.
 */
export function elixirMultiplier(state: BattleState): 1 | 2 | 3 {
  if (state.overtime && state.time >= BATTLE_DURATION + OVERTIME_DURATION / 2) {
    return 3;
  }
  if (state.overtime || state.time >= DOUBLE_ELIXIR_AT) return 2;
  return 1;
}

export function isDoubleElixir(state: BattleState): boolean {
  return effectiveElixirMultiplier(state) >= 2;
}

/**
 * The elixir rate actually applied. A game-mode rate (3x triple, 7x mega) is a
 * flat override of the normal time-based curve; otherwise the curve applies.
 */
export function effectiveElixirMultiplier(state: BattleState): number {
  return state.elixirRate > 1 ? state.elixirRate : elixirMultiplier(state);
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

/** Ground-only attackers cannot touch flyers. */
function canHit(e: Entity, o: Entity): boolean {
  return !o.flying || e.targetsAir;
}

function acquireTarget(state: BattleState, e: Entity): Entity | null {
  const enemies = livingEnemiesOf(state, e);
  if (isBuilding(e)) {
    // Towers/buildings only shoot troops, and only within range.
    const inRange = enemies.filter(
      (o) => o.kind === "troop" && canHit(e, o) && gap(e, o) <= e.attackRange,
    );
    return nearest(e, inRange);
  }
  if (e.targetsBuildingsOnly) {
    return nearest(e, enemies.filter(isBuilding));
  }
  // Head for the genuinely nearest enemy: any troop within sight plus
  // every building/tower (which troops always march toward).
  const candidates = enemies.filter(
    (o) =>
      canHit(e, o) &&
      (isBuilding(o) || (o.kind === "troop" && gap(e, o) <= e.sightRange)),
  );
  return nearest(e, candidates);
}

function retarget(state: BattleState, e: Entity): Entity | null {
  const current = findById(state, e.targetId);
  // Once engaged (the current target is within attack range), stay locked
  // onto it until it dies or leaves range — a newly deployed nearer enemy
  // can't pull an attacker off the foe it's already trading blows with.
  if (current && canHit(e, current) && gap(e, current) <= e.attackRange) {
    return current;
  }
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
  if (e.flying || e.jumpsRiver) return target; // straight over the river
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

function moveToward(e: Entity, goal: { x: number; y: number }, dt: number): number {
  const d = distance(e, goal);
  if (d < 1e-6) return 0;
  const step = Math.min(e.speed * dt, d);
  e.x += ((goal.x - e.x) / d) * step;
  e.y += ((goal.y - e.y) / d) * step;
  return step;
}

/** Tiles per second a ranged shot travels. */
export const PROJECTILE_SPEED = 9;

function dealDamage(state: BattleState, e: Entity, target: Entity): void {
  const charged = e.chargeDistance > 0 && e.chargeProgress >= e.chargeDistance;
  const damage = e.damage * (charged ? 2 : 1);
  const ranged = e.attackRange > 1;
  if (ranged) {
    // The shot must fly there first; damage lands on arrival.
    const d = Math.max(1e-6, distance(e, target));
    state.projectiles.push({
      id: state.nextEntityId++,
      side: e.side,
      cardId: e.cardId,
      sourceKind: e.kind,
      sx: e.x,
      sy: e.y,
      x: e.x,
      y: e.y,
      targetId: target.id,
      speed: PROJECTILE_SPEED,
      damage,
      splashRadius: e.splashRadius,
      targetsAir: e.targetsAir,
      pierce: e.pierce,
      // A pierce shot flies straight along the firing line for its full
      // range, damaging everything it passes; a normal shot homes in.
      dirX: (target.x - e.x) / d,
      dirY: (target.y - e.y) / d,
      range: e.attackRange,
      hitIds: [],
    });
  } else {
    const myStats = sideState(state, e.side).stats;
    target.hp -= damage;
    myStats.damageDealt += damage;
    if (e.splashRadius > 0) {
      for (const o of livingEnemiesOf(state, e)) {
        if (o === target || !canHit(e, o)) continue;
        if (distance(o, target) <= e.splashRadius + o.radius) {
          o.hp -= damage;
          myStats.damageDealt += damage;
        }
      }
    }
  }
  e.chargeProgress = 0;
  e.cooldown = e.hitSpeed;
  // Recoil: the shooter kicks itself backward, away from its target.
  if (e.recoil > 0) {
    const d = Math.max(1e-6, distance(e, target));
    e.x += ((e.x - target.x) / d) * e.recoil;
    e.y += ((e.y - target.y) / d) * e.recoil;
  }
  state.events.push({
    type: "attack",
    kind: e.kind,
    cardId: e.cardId,
    ranged,
    x: e.x,
    y: e.y,
    targetX: target.x,
    targetY: target.y,
  });
}

/** Half-width of a pierce shot's hit corridor, in tiles. */
export const PIERCE_HALF_WIDTH = 0.5;

/** Shortest distance from point p to the segment a->b. */
function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Advance a piercing shot along its fixed firing line, damaging every
 * enemy whose body the segment crosses (each hit once), until spent.
 */
function tickPierce(state: BattleState, p: Projectile, dt: number): boolean {
  const step = Math.min(p.speed * dt, p.range);
  const fromX = p.x;
  const fromY = p.y;
  p.x += p.dirX * step;
  p.y += p.dirY * step;
  p.range -= step;
  const myStats = sideState(state, p.side).stats;
  for (const o of state.entities) {
    if (o.side === p.side || o.hp <= 0 || p.hitIds.includes(o.id)) continue;
    if (o.flying && !p.targetsAir) continue;
    if (segmentDistance(fromX, fromY, p.x, p.y, o.x, o.y) <= o.radius + PIERCE_HALF_WIDTH) {
      o.hp -= p.damage;
      myStats.damageDealt += p.damage;
      p.hitIds.push(o.id);
    }
  }
  return p.range > 1e-6; // keep flying until its range is used up
}

/** Fly each shot toward its (moving) target; impact on arrival. */
function tickProjectiles(state: BattleState, dt: number): void {
  state.projectiles = state.projectiles.filter((p) => {
    if (p.pierce) return tickPierce(state, p, dt);
    const target = state.entities.find((o) => o.id === p.targetId);
    if (!target || target.hp <= 0) return false; // fizzle mid-air
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (d <= step + target.radius * 0.5) {
      // Impact: damage the target, splash around it.
      const myStats = sideState(state, p.side).stats;
      target.hp -= p.damage;
      myStats.damageDealt += p.damage;
      if (p.splashRadius > 0) {
        for (const o of state.entities) {
          if (o.side === p.side || o.hp <= 0 || o === target) continue;
          if (o.flying && !p.targetsAir) continue;
          if (distance(o, target) <= p.splashRadius + o.radius) {
            o.hp -= p.damage;
            myStats.damageDealt += p.damage;
          }
        }
      }
      return false;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    return true;
  });
}

/** Speed/attack-rate multiplier for troops inside a friendly rage zone. */
export const RAGE_BOOST = 1.35;

/** Is this entity currently inside a friendly rage zone? */
export function isRaged(state: BattleState, e: Entity): boolean {
  return state.buffZones.some(
    (z) => z.side === e.side && distance(e, z) <= z.radius + e.radius,
  );
}

function rageBoost(state: BattleState, e: Entity): number {
  return isRaged(state, e) ? RAGE_BOOST : 1;
}

/** Spawner troops (e.g. the Witch) summon a wave every spawnInterval. */
function tickSpawner(state: BattleState, e: Entity, dt: number): void {
  if (!e.spawnUnitId) return;
  e.spawnTimer -= dt;
  if (e.spawnTimer > 0) return;
  const toward = e.side === "player" ? -1 : 1;
  spawnUnits(state, e.side, e.spawnUnitId, e.x, e.y + toward * (e.radius + 0.5));
  e.spawnTimer += e.spawnInterval;
}

/** Elixir collectors pay their owner 1 elixir every elixirInterval. */
function tickCollector(state: BattleState, e: Entity, dt: number): void {
  if (e.elixirInterval <= 0) return;
  e.elixirTimer -= dt;
  if (e.elixirTimer > 0) return;
  e.elixirTimer += e.elixirInterval;
  const owner = sideState(state, e.side);
  owner.elixir = { amount: Math.min(ELIXIR_MAX, owner.elixir.amount + 1) };
  // Purple payout ring for the renderer.
  state.effects.push({ cardId: e.cardId!, x: e.x, y: e.y, radius: 0.8, ttl: 0.5 });
}

function actEntity(state: BattleState, e: Entity, dt: number): void {
  // Raged units recover from attacks and cover ground faster.
  const boostedDt = dt * rageBoost(state, e);
  e.cooldown = Math.max(0, e.cooldown - boostedDt);
  if (!e.active) return;

  // Stunned units stand helpless until the stun wears off.
  if (e.stunTimer > 0) {
    e.stunTimer -= dt;
    return;
  }

  const target = retarget(state, e);
  e.targetId = target?.id ?? null;

  // Freshly deployed units pick targets (and face them) but act later.
  if (e.deployTimer > 0) {
    e.deployTimer -= dt;
    return;
  }
  tickSpawner(state, e, dt);
  tickCollector(state, e, dt);
  if (!target) return;

  if (gap(e, target) <= e.attackRange) {
    if (e.cooldown === 0) dealDamage(state, e, target);
  } else if (e.kind === "troop") {
    const step = moveToward(e, moveGoal(e, target), boostedDt);
    if (e.chargeDistance > 0) e.chargeProgress += step;
  }
}

/** Death-bomb units (e.g. the Balloon) blast nearby enemies as they die. */
function explodeOnDeath(state: BattleState, e: Entity): void {
  if (e.deathDamage <= 0) return;
  for (const o of livingEnemiesOf(state, e)) {
    if (distance(o, e) <= e.deathRadius + o.radius) {
      o.hp -= e.deathDamage;
      sideState(state, e.side).stats.damageDealt += e.deathDamage;
    }
  }
  state.effects.push({
    cardId: e.cardId ?? "fireball",
    x: e.x,
    y: e.y,
    radius: e.deathRadius,
    ttl: 0.6,
  });
}

/** Bodies can squeeze a little, like CR's soft crowds. */
const COLLISION_SLACK = 0.9;

/**
 * Soft collision: overlapping bodies shove apart. Troops push each
 * other (heavier shoves lighter), buildings and towers never move,
 * and air/ground occupy separate planes. Two relaxation passes keep
 * dense crowds stable without a physics engine.
 */
function resolveCollisions(state: BattleState): void {
  const solids = state.entities.filter((e) => e.hp > 0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i];
        const b = solids[j];
        if (a.flying !== b.flying) continue;
        const minDist = (a.radius + b.radius) * COLLISION_SLACK;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          // Perfectly stacked: nudge apart deterministically.
          dx = 0.01 * (((a.id + b.id) % 7) - 3 || 1);
          dy = 0.01 * (((a.id * 3 + b.id) % 5) - 2 || 1);
          d = Math.hypot(dx, dy);
        }
        const overlap = minDist - d;
        const nx = dx / d;
        const ny = dy / d;
        const aMoves = a.kind === "troop";
        const bMoves = b.kind === "troop";
        if (aMoves && bMoves) {
          const aShare = b.radius / (a.radius + b.radius); // big shoves small
          a.x -= nx * overlap * aShare;
          a.y -= ny * overlap * aShare;
          b.x += nx * overlap * (1 - aShare);
          b.y += ny * overlap * (1 - aShare);
        } else if (aMoves) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else if (bMoves) {
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }
  }
}

function processDeaths(state: BattleState): void {
  for (const e of state.entities) {
    if (e.hp > 0) continue;
    explodeOnDeath(state, e);
    state.events.push({
      type: "death",
      kind: e.kind,
      cardId: e.cardId,
      side: e.side,
      x: e.x,
      y: e.y,
    });
    if (e.kind === "princess-tower") {
      const winner = e.side === "player" ? "enemy" : "player";
      sideState(state, winner).crowns += 1;
      state.events.push({ type: "crown", winner });
      wakeKing(state, e.side);
    } else if (e.kind === "king-tower") {
      const winner = e.side === "player" ? "enemy" : "player";
      sideState(state, winner).crowns = 3;
      state.events.push({ type: "crown", winner });
      finish(state, winner);
    }
  }
  state.entities = state.entities.filter((e) => e.hp > 0);
}

function wakeKing(state: BattleState, side: Entity["side"]): void {
  for (const e of state.entities) {
    if (e.side === side && e.kind === "king-tower" && !e.active) {
      e.active = true;
      state.events.push({ type: "king-wake", side: e.side });
    }
  }
}

function wakeDamagedKings(state: BattleState): void {
  for (const e of state.entities) {
    if (e.kind === "king-tower" && e.hp < e.maxHp && !e.active) {
      wakeKing(state, e.side);
    }
  }
}

/** Advance the battle by dt seconds. No-op once a result is set. */
export function tick(state: BattleState, dt: number): void {
  if (state.result) return;
  state.time += dt;

  const mult = effectiveElixirMultiplier(state);
  state.player.elixir = tickElixir(state.player.elixir, dt, mult);
  state.enemy.elixir = tickElixir(state.enemy.elixir, dt, mult);

  for (const effect of state.effects) effect.ttl -= dt;
  state.effects = state.effects.filter((f) => f.ttl > 0);

  for (const zone of state.buffZones) zone.ttl -= dt;
  state.buffZones = state.buffZones.filter((z) => z.ttl > 0);

  // Deployed buildings decay over their lifetime.
  for (const e of state.entities) {
    if (e.kind === "building") e.hp -= e.decayPerSec * dt;
  }

  wakeDamagedKings(state);
  for (const e of [...state.entities]) {
    if (e.hp > 0) actEntity(state, e, dt);
  }
  tickProjectiles(state, dt);
  resolveCollisions(state);
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
  state.events.push({ type: "finish", winner });
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
    finish(state, towerHpTiebreak(state));
  }
}

/**
 * CR's last resort when overtime ends still tied on crowns: whoever's
 * most-damaged tower is healthier wins; identical damage is a draw.
 */
function towerHpTiebreak(state: BattleState): BattleResult["winner"] {
  const worst = (side: Entity["side"]): number =>
    Math.min(
      ...state.entities
        .filter((e) => e.side === side && isBuilding(e) && e.cardId === null)
        .map((e) => e.hp),
    );
  const p = worst("player");
  const en = worst("enemy");
  if (p === en) return "draw";
  return p > en ? "player" : "enemy";
}
