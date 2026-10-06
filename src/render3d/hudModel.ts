/**
 * The battle HUD as plain data. hudModel() turns the sim state into the
 * handful of values the HUD shows, quantised so they only change when the
 * player could see the difference; Hud.update diffs one model against the
 * last and touches only the DOM that changed.
 *
 * Also here, because they are pure and tested: the end-of-match stats, the
 * tower timeline merge, the loss tip and the tower-damage attribution that
 * feeds it. Nothing in this file touches the DOM.
 */
import type { AbilityId } from "../game/abilities";
import type { Side } from "../game/arena";
import { effectiveCard, type BattleEvent, type BattleState, type Entity } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { ELIXIR_MAX } from "../game/elixir";
import {
  BATTLE_DURATION,
  OVERTIME_DURATION,
  SANDBOX_ELIXIR_RATE,
  effectiveElixirMultiplier,
} from "../game/sim";
import { cardDisplayName } from "../render/cardNames";
import { fmtNum, fmtTime, tr } from "../ui/i18n";

export interface HandSlotModel {
  id: CardId;
  /** What playing it costs now; null for a Mirror with nothing to copy. */
  cost: number | null;
  affordable: boolean;
  /** Charge toward the cost, 0..100 in whole percent (100 once affordable). */
  chargePct: number;
  /** Whole elixir still missing (0 once affordable). */
  need: number;
}

export type Outcome = "win" | "loss" | "draw";

export interface ResultModel {
  outcome: Outcome;
  myCrowns: number;
  theirCrowns: number;
}

export interface HudModel {
  clockText: string;
  overtime: boolean;
  crowns: { me: number; them: number };
  elixirInt: number;
  /** Bar fill, 0..100, in 0.5% steps. */
  elixirPct: number;
  /** Elixir multiplier label: "x2", "x3"; "" at 1x; the sandbox reads as infinite. */
  mult: string;
  /** Sitting on a full bar (and the match is still on). */
  leak: boolean;
  ability: { id: AbilityId | null; pct: number; ready: boolean };
  hand: HandSlotModel[];
  next: CardId | null;
  result: ResultModel | null;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Elixir fill as a percentage of the bar, quantised to half a percent. */
export function quantiseElixirPct(amount: number): number {
  return Math.round(clamp01(amount / ELIXIR_MAX) * 200) / 2;
}

/** The time left on the match clock, in whole seconds. */
export function clockSeconds(state: BattleState): number {
  const total = state.overtime ? BATTLE_DURATION + OVERTIME_DURATION : BATTLE_DURATION;
  return Math.max(0, Math.ceil(total - state.time));
}

/**
 * The HUD for `side` (the local player). `pendingSpend` is elixir already
 * promised to plays that have not executed yet (online lockstep), so a card
 * the player cannot actually afford never lights up.
 */
export function hudModel(state: BattleState, side: Side, pendingSpend = 0): HudModel {
  const me = side === "player" ? state.player : state.enemy;
  const foe = side === "player" ? state.enemy : state.player;
  const time = fmtTime(clockSeconds(state));
  const amount = me.elixir.amount;
  const available = Math.max(0, amount - Math.max(0, pendingSpend));
  const multValue = effectiveElixirMultiplier(state);
  const hand = me.hand.cards.map((id): HandSlotModel => {
    const eff = effectiveCard(state, side, id);
    if (!eff) return { id, cost: null, affordable: false, chargePct: 0, need: 0 };
    const affordable = eff.cost <= available;
    return {
      id,
      cost: eff.cost,
      affordable,
      chargePct: affordable ? 100 : Math.floor(clamp01(available / eff.cost) * 100),
      need: affordable ? 0 : Math.ceil(eff.cost - available),
    };
  });
  return {
    clockText: state.overtime ? `${tr("OVERTIME", "وقت إضافي")} ${time}` : time,
    overtime: state.overtime,
    crowns: { me: me.crowns, them: foe.crowns },
    elixirInt: Math.floor(amount),
    elixirPct: quantiseElixirPct(amount),
    mult: multValue >= SANDBOX_ELIXIR_RATE ? "∞" : multValue >= 2 && !state.result ? `x${multValue}` : "",
    leak: amount >= ELIXIR_MAX && !state.result,
    ability: me.ability
      ? { id: me.ability, pct: Math.floor(clamp01(me.abilityCharge) * 100), ready: me.abilityCharge >= 1 }
      : { id: null, pct: 0, ready: false },
    hand,
    next: me.hand.queue[0] ?? null,
    result: resultModel(state, side),
  };
}

/** The finished match from `side`'s point of view, or null while it runs. */
export function resultModel(state: BattleState, side: Side): ResultModel | null {
  const r = state.result;
  if (!r) return null;
  const outcome: Outcome = r.winner === "draw" ? "draw" : r.winner === side ? "win" : "loss";
  return {
    outcome,
    myCrowns: side === "player" ? r.playerCrowns : r.enemyCrowns,
    theirCrowns: side === "player" ? r.enemyCrowns : r.playerCrowns,
  };
}

// ---- Tower damage attribution ----------------------------------------------
// The sim credits damage per card but not per target, so the loss tip works
// out who hurt the towers from the presentation side: every attack or spell
// aimed at a tower marks its card as a recent attacker of that tower, and
// each tower's HP drop is split between its recent attackers.

const ATTACKER_WINDOW = 2.5; // seconds a hit stays "recent" (covers projectile flight)

type TowerDamage = Record<Side, Partial<Record<CardId, number>>>;

const isTower = (e: Entity): boolean => e.kind === "princess-tower" || e.kind === "king-tower";

export class TowerDamageTracker {
  /** Damage dealt TO the other side's towers, keyed by the attacking side. */
  readonly bySide: TowerDamage = { player: {}, enemy: {} };
  private readonly hp = new Map<number, number>();
  private recent: { tower: number; side: Side; cardId: CardId; t: number }[] = [];
  private towers: Entity[] = [];

  reset(): void {
    this.bySide.player = {};
    this.bySide.enemy = {};
    this.hp.clear();
    this.recent = [];
    this.towers = [];
  }

  /** Feed a battle event (call before observe() for the same frame). */
  noteEvent(ev: BattleEvent, time: number): void {
    if (ev.type === "attack" && ev.cardId) {
      // Attacks carry no side; whoever owns the struck tower was the target.
      const tower = this.towerAt(ev.targetX, ev.targetY, 0.6);
      if (tower) this.mark(tower, tower.side === "player" ? "enemy" : "player", ev.cardId, time);
    } else if (ev.type === "spell") {
      const card = getCard(ev.cardId);
      const radius = card.kind === "spell" ? card.radius : 0;
      for (const t of this.towers) {
        if (t.side === ev.side) continue;
        const dx = t.x - ev.x;
        const dy = t.y - ev.y;
        if (Math.sqrt(dx * dx + dy * dy) <= radius + t.radius) this.mark(t, ev.side, ev.cardId, time);
      }
    }
  }

  /** Compare tower HP with the last frame and credit each drop. */
  observe(state: BattleState): void {
    const time = state.time;
    this.recent = this.recent.filter((r) => time - r.t <= ATTACKER_WINDOW);
    const alive = new Set<number>();
    this.towers = state.entities.filter(isTower);
    for (const t of this.towers) {
      alive.add(t.id);
      const before = this.hp.get(t.id);
      if (before !== undefined && t.hp < before) this.credit(t.id, before - t.hp);
      this.hp.set(t.id, t.hp);
    }
    // A tower that vanished lost the rest of its HP.
    for (const [id, before] of this.hp) {
      if (alive.has(id)) continue;
      if (before > 0) this.credit(id, before);
      this.hp.delete(id);
    }
  }

  private towerAt(x: number, y: number, slack: number): Entity | null {
    for (const t of this.towers) {
      const dx = t.x - x;
      const dy = t.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= t.radius + slack) return t;
    }
    return null;
  }

  private mark(tower: Entity, side: Side, cardId: CardId, t: number): void {
    this.recent.push({ tower: tower.id, side, cardId, t });
  }

  private credit(towerId: number, amount: number): void {
    const hits = this.recent.filter((r) => r.tower === towerId);
    if (hits.length === 0) return; // abilities, death blasts: no card to name
    const share = amount / hits.length;
    for (const h of hits) {
      const table = this.bySide[h.side];
      table[h.cardId] = (table[h.cardId] ?? 0) + share;
    }
  }
}

// ---- End-of-match stats -----------------------------------------------------

export interface SideSummary {
  damage: number;
  spent: number;
  leaked: number;
  collected: number;
}

export interface ResultStats {
  me: SideSummary;
  them: SideSummary;
  /** The local player's top damage dealers, best first (at most 3). */
  leaders: { id: CardId; damage: number }[];
  /** Damage dealt to towers, keyed by the attacking side. */
  towerDamage: TowerDamage;
}

function summarise(s: BattleState["player"]): SideSummary {
  return {
    damage: Math.round(s.stats.damageDealt),
    spent: Math.round(s.stats.elixirSpent),
    leaked: Math.round(s.stats.elixirLeaked),
    collected: Math.round(s.stats.elixirCollected),
  };
}

/** Everything the result screen reports, built once when the match ends. */
export function buildResultStats(state: BattleState, side: Side, towerDamage?: TowerDamage): ResultStats {
  const me = side === "player" ? state.player : state.enemy;
  const foe = side === "player" ? state.enemy : state.player;
  const leaders = (Object.entries(me.stats.damageByCard) as [CardId, number][])
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, damage]) => ({ id, damage: Math.round(damage) }));
  return {
    me: summarise(me),
    them: summarise(foe),
    leaders,
    towerDamage: {
      player: { ...(towerDamage?.player ?? {}) },
      enemy: { ...(towerDamage?.enemy ?? {}) },
    },
  };
}

// ---- Tower timeline ---------------------------------------------------------

export interface TimelineEntry {
  /** Battle time in seconds. */
  t: number;
  /** The tower that fell was the local player's. */
  mine: boolean;
  tower: "princess" | "king";
}

export interface TimelineLine {
  text: string;
  mine: boolean;
}

/** Falls of the same kind this close together read as one line. */
const MERGE_WINDOW = 8;

function towerFellText(mine: boolean, tower: TimelineEntry["tower"], n: number): string {
  const count = fmtNum(n);
  if (tower === "king") {
    return mine ? tr("Your King tower fell", "سقط برج ملكك") : tr("Enemy King tower fell", "سقط برج ملك الخصم");
  }
  if (n === 1) {
    return mine
      ? tr("Your Princess tower fell", "سقط برج أميرتك")
      : tr("Enemy Princess tower fell", "سقط برج أميرة الخصم");
  }
  return mine
    ? tr(`${count} of your Princess towers fell`, `سقط ${count} من أبراج أميراتك`)
    : tr(`${count} enemy Princess towers fell`, `سقط ${count} من أبراج أميرات الخصم`);
}

/**
 * The tower report: consecutive falls of the same tower kind on the same
 * side within a few seconds merge into one counted line, stamped with the
 * first fall's time, e.g. "2 enemy Princess towers fell · 0:06".
 */
export function mergeTimeline(entries: readonly TimelineEntry[]): TimelineLine[] {
  const groups: { first: TimelineEntry; last: TimelineEntry; n: number }[] = [];
  for (const e of [...entries].sort((a, b) => a.t - b.t)) {
    const g = groups[groups.length - 1];
    if (g && g.last.mine === e.mine && g.last.tower === e.tower && e.t - g.last.t <= MERGE_WINDOW) {
      g.n++;
      g.last = e;
    } else {
      groups.push({ first: e, last: e, n: 1 });
    }
  }
  return groups.map((g) => ({
    text: `${towerFellText(g.first.mine, g.first.tower, g.n)} · ${fmtTime(g.first.t)}`,
    mine: g.first.mine,
  }));
}

// ---- Loss tip ------------------------------------------------------------------

/**
 * After a loss: name the enemy card that did the most damage to the local
 * player's towers and suggest a counter that fits how that card targets.
 * Null when no enemy card touched a tower.
 */
export function lossTip(stats: ResultStats, side: Side): string | null {
  const foeSide: Side = side === "player" ? "enemy" : "player";
  const top = (Object.entries(stats.towerDamage[foeSide]) as [CardId, number][])
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const id = top[0];
  const name = cardDisplayName(id);
  const card = getCard(id);
  if (card.kind === "spell") {
    return tr(
      `Their ${name} chipped your towers. Keep a spell of your own to trade back.`,
      `${name} الخصم أصاب أبراجك. احتفظ بتعويذة لترد عليه.`,
    );
  }
  if (card.kind === "building") {
    return tr(
      `Their ${name} hit your towers. Drop a tank or a spell on it early.`,
      `${name} الخصم ضرب أبراجك. أسقط عليه وحدة قوية أو تعويذة مبكرًا.`,
    );
  }
  const u = card.unit;
  if (u.targetsBuildingsOnly) {
    return tr(
      `Their ${name} went straight for your towers. Pull it with a building or swarm it with cheap troops.`,
      `${name} الخصم اتجه مباشرة إلى أبراجك. اسحبه ببناء أو حاصره بوحدات رخيصة.`,
    );
  }
  if (u.flying) {
    return tr(
      `Their ${name} flew over your defence. Keep a troop that hits air ready.`,
      `${name} الخصم طار فوق دفاعك. جهّز وحدة تصيب الطائرين.`,
    );
  }
  if (u.attackRange >= 3) {
    return tr(
      `Their ${name} shot your towers from range. Close in with a fast melee troop or a spell.`,
      `${name} الخصم رمى أبراجك من بعيد. هاجمه بوحدة سريعة قريبة أو بتعويذة.`,
    );
  }
  return tr(
    `Their ${name} did the most damage to your towers. Swarm it with cheap troops before it reaches them.`,
    `${name} الخصم أحدث أكبر ضرر بأبراجك. حاصره بوحدات رخيصة قبل أن يصل إليها.`,
  );
}
