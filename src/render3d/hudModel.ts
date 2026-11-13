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
import { ABILITIES, type AbilityId } from "../game/abilities";
import { ARENA_HEIGHT, ARENA_WIDTH, canDeployTroopAt, inRiver, onBridge, type Side } from "../game/arena";
import {
  checkDeploy,
  effectiveCard,
  isBuilding,
  openLanes,
  type BattleEvent,
  type BattleState,
  type DeployCheck,
  type Entity,
} from "../game/battle";
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
import { KING_KEEP_CLEAR, enemyKingSpot } from "./deployZone";

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

/**
 * What the clock counts: the match clock, or a challenge's survive goal
 * ("SURVIVE 0:45", counting down to the win).
 */
export type ClockMode = { kind: "match" } | { kind: "survive"; seconds: number };

export const MATCH_CLOCK: ClockMode = Object.freeze({ kind: "match" }) as ClockMode;

export interface HudModel {
  clockText: string;
  overtime: boolean;
  /** The clock counts down a challenge's survive goal. */
  survive: boolean;
  /** A short line under the clock (overtime: how a tie is broken), or null. */
  hint: string | null;
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
export function hudModel(state: BattleState, side: Side, pendingSpend = 0, clock: ClockMode = MATCH_CLOCK): HudModel {
  const me = side === "player" ? state.player : state.enemy;
  const foe = side === "player" ? state.enemy : state.player;
  const survive = clock.kind === "survive";
  const time = fmtTime(survive ? surviveSecondsLeft(state, clock.seconds) : clockSeconds(state));
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
    clockText: survive
      ? `${tr("SURVIVE", "اصمد")} ${time}`
      : state.overtime
        ? `${tr("OVERTIME", "وقت إضافي")} ${time}`
        : time,
    overtime: state.overtime && !survive,
    survive,
    hint: !survive && state.overtime && !state.result ? overtimeHint() : null,
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

// ---- Challenge goal ----------------------------------------------------------

/**
 * The clock for a challenge with this survive goal. Goals that fit inside a
 * match count down; anything else (the tutorial's never-ending 1e9, a bad
 * value) keeps the normal match clock.
 */
export function challengeClock(surviveFor: number | null | undefined): ClockMode {
  return typeof surviveFor === "number" && Number.isFinite(surviveFor) && surviveFor > 0 && surviveFor < BATTLE_DURATION
    ? { kind: "survive", seconds: surviveFor }
    : MATCH_CLOCK;
}

/** Whole seconds still to survive (0 once the goal is reached). */
export function surviveSecondsLeft(state: BattleState, seconds: number): number {
  return Math.max(0, Math.ceil(seconds - state.time));
}

/** The banner at the start of a survive challenge. */
export function goalText(seconds: number): string {
  const t = fmtTime(seconds);
  return tr(`Keep all 3 towers standing for ${t}!`, `أبقِ أبراجك الثلاثة صامدة لمدة ${t}!`);
}

/** The local side has lost a tower (the challenge rule: any fallen tower loses). */
export function towerFell(state: BattleState, side: Side): boolean {
  let standing = 0;
  for (const e of state.entities) {
    if (e.side === side && (e.kind === "princess-tower" || e.kind === "king-tower") && e.hp > 0) standing++;
  }
  return standing < 3;
}

// ---- Tiebreak ------------------------------------------------------------------

/** The hint under the clock in overtime. */
export function overtimeHint(): string {
  return tr("Tie? Weakest tower loses", "تعادل؟ يخسر صاحب أضعف برج");
}

/**
 * HP of a side's weakest tower, by the sim's own tiebreak rule (towerHpTiebreak
 * in game/sim.ts: the lowest building with no card, i.e. a tower). Null when
 * the side has no tower left.
 */
export function weakestTowerHp(state: BattleState, side: Side): number | null {
  let low = Infinity;
  for (const e of state.entities) {
    if (e.side === side && isBuilding(e) && e.cardId === null) low = Math.min(low, e.hp);
  }
  return low === Infinity ? null : low;
}

/**
 * A finished match decided on tower HP (crowns tied when overtime ran out):
 * each side's weakest tower, read from the battle at the finish. Null for
 * any other ending (crowns, a forfeit, a match still running).
 */
export function tiebreakInfo(state: BattleState, side: Side): { mine: number; theirs: number } | null {
  const r = state.result;
  if (!r || r.playerCrowns !== r.enemyCrowns) return null;
  if (!state.overtime || state.time < BATTLE_DURATION + OVERTIME_DURATION - 1e-6) return null;
  const mine = weakestTowerHp(state, side);
  const theirs = weakestTowerHp(state, side === "player" ? "enemy" : "player");
  if (mine === null || theirs === null) return null;
  return { mine, theirs };
}

/** "Crowns tied: your weakest tower had N HP, theirs had M" (a draw reads the same). */
export function tiebreakText(t: { mine: number; theirs: number }): string {
  // A tower on 0.3 HP is still standing: round up, never show 0.
  const n = fmtNum(Math.max(1, Math.ceil(t.mine)));
  const m = fmtNum(Math.max(1, Math.ceil(t.theirs)));
  return tr(
    `Crowns tied: your weakest tower had ${n} HP, theirs had ${m}`,
    `تعادل في التيجان: أضعف أبراجك كان فيه ${n} نقطة صحة، وأضعف أبراجهم ${m}`,
  );
}

/**
 * Why the match ended the way it did, for the result screen: a challenge's
 * goal ("You held on!" / a tower fell) or a tower-HP tiebreak. Null when the
 * crowns already tell the story.
 */
export function resultReason(state: BattleState, side: Side, clock: ClockMode = MATCH_CLOCK): string | null {
  const r = resultModel(state, side);
  if (!r) return null;
  if (clock.kind === "survive") {
    if (r.outcome === "win") return tr("You held on!", "صمدت حتى النهاية!");
    if (r.outcome === "loss" && towerFell(state, side)) {
      return tr("A tower fell! Keep every tower standing", "سقط برج! أبقِ كل أبراجك قائمة");
    }
    return null;
  }
  const tb = tiebreakInfo(state, side);
  return tb ? tiebreakText(tb) : null;
}

// ---- King's ability ------------------------------------------------------------

/** Whole seconds until the side's ability is charged; null with no ability chosen. */
export function abilitySecondsLeft(state: BattleState, side: Side): number | null {
  const me = side === "player" ? state.player : state.enemy;
  if (!me.ability) return null;
  const left = (1 - clamp01(me.abilityCharge)) * ABILITIES[me.ability].chargeSeconds;
  return Math.max(0, Math.ceil(left - 1e-9));
}

/** The bubble over a KING that is not ready yet. */
export function chargingText(seconds: number): string {
  return tr(`Charging… ${fmtNum(seconds)}s`, `يشحن… ${fmtNum(seconds)} ث`);
}

// ---- Refused drops -------------------------------------------------------------

export type BadSpotReason = "side" | "lane" | "river" | "king" | "tower" | "dig";

/**
 * Why a troop or building cannot go down at (x, y), in the kid's words,
 * mirroring checkDeploy (the placement map draws the same rule):
 *   - the Digger: in the water off the bridges ("river"), else on a tower
 *     or building body ("dig");
 *   - outside the deployable area: with no enemy lane open yet, the enemy
 *     half and the river are "side"; once one is open, the river is "river"
 *     and the other, still-closed lane is "lane" (knock its tower down first);
 *   - inside it, a standing enemy tower's clearance: the King's ("king") or a
 *     princess's ("tower").
 * Null when the spot is fine or the refusal is not about the spot (spells, a
 * Mirror with nothing to copy).
 */
export function badSpotReason(state: BattleState, side: Side, cardId: CardId, x: number, y: number): BadSpotReason | null {
  if (checkDeploy(state, side, cardId, x, y) !== "bad-spot") return null;
  const eff = effectiveCard(state, side, cardId);
  if (!eff || eff.card.kind === "spell") return null;
  if (eff.card.kind === "troop" && eff.card.deployAnywhere === true) return inRiver(y) && !onBridge(x) ? "river" : "dig";
  const open = openLanes(state, side);
  if (!canDeployTroopAt(side, x, y, open)) {
    if (!open.left && !open.right) return "side";
    return inRiver(y) ? "river" : "lane";
  }
  const king = enemyKingSpot(side);
  const dx = x - king.x;
  const dy = y - king.y;
  return Math.sqrt(dx * dx + dy * dy) < KING_KEEP_CLEAR ? "king" : "tower";
}

export function badSpotText(reason: BadSpotReason): string {
  switch (reason) {
    case "side":
      return tr("Your side only!", "في جهتك فقط!");
    case "lane":
      return tr("Knock down this tower first!", "أسقط هذا البرج أولًا!");
    case "river":
      return tr("Not in the water!", "ليس في الماء!");
    case "king":
      return tr("Too close to the King!", "قريب جدًا من الملك!");
    case "dig":
      return tr("Can't dig here!", "لا يمكن الحفر هنا!");
    default:
      return tr("Too close to a tower!", "قريب جدًا من البرج!");
  }
}

// ---- Placement: the verdict pip and the "lane opened" label -------------------

/** What the pip over the finger says about the spot: yes, no, or wait (the spot is fine, the elixir is not). */
export type PlaceVerdict = "yes" | "no" | "wait";

/** The spot verdict from checkDeploy: too little elixir is "wait", never "no". */
export function placeVerdict(check: DeployCheck | null): PlaceVerdict | null {
  return check === "ok" ? "yes" : check === "no-elixir" ? "wait" : check === "bad-spot" ? "no" : null;
}

/** The pip's diameter (CSS px) per verdict: different shapes AND sizes. */
export const PIP_SIZE: Readonly<Record<PlaceVerdict, number>> = { yes: 26, no: 34, wait: 30 };
/** How far above the pointer the pip floats: clear of a fingertip, closer to a mouse arrow. */
export const PIP_LIFT_TOUCH = 62;
export const PIP_LIFT_MOUSE = 40;

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the pip's centre goes for a pointer at (x, y): lifted above it (a
 * finger would hide it), kept inside the field; near the field's top a
 * finger's pip moves beside it instead, toward the middle.
 */
export function pipPlacement(x: number, y: number, pointerType: string, field: ScreenRect, size: number): { x: number; y: number } {
  const touch = pointerType !== "mouse";
  const inset = size / 2 + 2;
  const clampX = (v: number): number => Math.max(field.x + inset, Math.min(field.x + field.w - inset, v));
  const top = field.y + inset;
  const lifted = y - (touch ? PIP_LIFT_TOUCH : PIP_LIFT_MOUSE);
  if (lifted >= top) return { x: clampX(x), y: lifted };
  if (!touch) return { x: clampX(x), y: top };
  const toward = x < field.x + field.w / 2 ? 1 : -1;
  return { x: clampX(x + toward * (size / 2 + 30)), y: Math.max(top, y - 10) };
}

/** Keep the lane label at least this far inside the field's top and bottom (px). */
export const LANE_PILL_INSET = 24;

/**
 * The "Drop troops here now!" label's box: centred on the lane on screen,
 * never wider than the pocket (less 8 px, so it wraps instead of spilling
 * into the other lane), its centre kept inside the field.
 */
export function lanePillBox(
  anchor: { x: number; y: number },
  edgeA: { x: number; y: number },
  edgeB: { x: number; y: number },
  field: ScreenRect,
): { x: number; y: number; maxW: number } {
  const y = Math.max(field.y + LANE_PILL_INSET, Math.min(field.y + field.h - LANE_PILL_INSET, anchor.y));
  return { x: anchor.x, y, maxW: Math.max(0, Math.abs(edgeA.x - edgeB.x) - 8) };
}

export function laneLabelText(): string {
  return tr("Drop troops here now!", "ضع جنودك هنا الآن!");
}

/**
 * The label's words as two lines broken at the most even word gap, for a
 * pocket too narrow for one line: the pill then shrink-wraps the longer
 * line instead of filling the pocket's whole width with a balanced
 * paragraph. One word: one line ("" second).
 */
export function balancedLines(text: string): [string, string] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return [words.join(" "), ""];
  let best = 1;
  let bestLen = Infinity;
  for (let i = 1; i < words.length; i++) {
    const len = Math.max(words.slice(0, i).join(" ").length, words.slice(i).join(" ").length);
    if (len < bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/**
 * The held card's preview on screen around the pointer at (x, y): the hover
 * disc or a spell's aim ring (`radius` tiles) and, for a troop, its ghost
 * standing up from the disc. The lane label steps off this box. The field
 * rect gives the scale: px per tile across (w / 18) and down (h / 32, the
 * camera's tilt shortens it).
 */
export function previewBox(x: number, y: number, radius: number, ghost: boolean, field: ScreenRect): ScreenRect {
  const across = field.w / ARENA_WIDTH;
  const down = field.h / ARENA_HEIGHT;
  const halfW = Math.max(radius, 0.8) * across;
  const below = Math.max(radius * down, 0.5 * across);
  const above = Math.max(radius * down, (ghost ? 1.5 : 0.5) * across);
  return { x: x - halfW, y: y - above, w: 2 * halfW, h: above + below };
}

/** The lane label keeps this far (px) off the held card's preview. */
export const LANE_PILL_GAP = 4;

/**
 * Where the lane label's centre y goes so it does not hide the held card's
 * preview (`avoid`: the ghost, the hover disc, a spell's aim ring): its
 * usual spot when that is clear; else the top or the bottom of `room` (the
 * pocket band between the King's keep-clear and the river, screen y),
 * whichever hides less of the preview (the one farther from it on a tie).
 * Only three places, so the label steps aside once instead of sliding after
 * the finger; it stays put when stepping aside would not help. `w` x `h` is
 * the label's size.
 */
export function lanePillY(
  box: { x: number; y: number },
  w: number,
  h: number,
  room: { top: number; bottom: number } | null,
  avoid: ScreenRect | null,
): number {
  if (!room || !avoid || w <= 0 || h <= 0) return box.y;
  const acrossOverlap = Math.min(box.x + w / 2, avoid.x + avoid.w) - Math.max(box.x - w / 2, avoid.x);
  if (acrossOverlap <= 0) return box.y;
  const hidden = (cy: number): number =>
    Math.max(0, Math.min(cy + h / 2 + LANE_PILL_GAP, avoid.y + avoid.h) - Math.max(cy - h / 2 - LANE_PILL_GAP, avoid.y));
  const here = hidden(box.y);
  if (here === 0) return box.y;
  const top = room.top + h / 2;
  const bottom = room.bottom - h / 2;
  if (top > bottom) return box.y; // the band is shorter than the label: nowhere to go
  const a = hidden(top);
  const b = hidden(bottom);
  if (Math.min(a, b) >= here) return box.y;
  if (a !== b) return a < b ? top : bottom;
  const mid = avoid.y + avoid.h / 2;
  return Math.abs(top - mid) >= Math.abs(bottom - mid) ? top : bottom;
}

/** The refused-drop label never runs closer than this to a screen edge (px). */
export const DROP_HINT_GUTTER = 16;

/**
 * Where the refused-drop label's centre goes: right over the finger
 * (clientX) whenever the label fits there, else slid in just far enough to
 * keep a gutter to the screen edge. labelWidth is the label's real width.
 */
export function dropHintCenterX(clientX: number, labelWidth: number, viewportWidth: number): number {
  const half = Math.max(0, Math.min(labelWidth / 2, viewportWidth / 2 - DROP_HINT_GUTTER));
  return Math.max(DROP_HINT_GUTTER + half, Math.min(viewportWidth - DROP_HINT_GUTTER - half, clientX));
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
  private readonly towers: Entity[] = [];

  reset(): void {
    this.bySide.player = {};
    this.bySide.enemy = {};
    this.hp.clear();
    this.recent = [];
    this.towers.length = 0;
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
    if (this.recent.length && time - this.recent[0].t > ATTACKER_WINDOW) {
      this.recent = this.recent.filter((r) => time - r.t <= ATTACKER_WINDOW);
    }
    // Runs every frame: reuse the arrays, allocate nothing on a quiet frame.
    this.towers.length = 0;
    for (const e of state.entities) if (isTower(e)) this.towers.push(e);
    for (const t of this.towers) {
      const before = this.hp.get(t.id);
      if (before !== undefined && t.hp < before) this.credit(t.id, before - t.hp);
      this.hp.set(t.id, t.hp);
    }
    if (this.hp.size > this.towers.length) {
      // A tower that vanished lost the rest of its HP.
      for (const [id, before] of this.hp) {
        if (this.towers.some((t) => t.id === id)) continue;
        if (before > 0) this.credit(id, before);
        this.hp.delete(id);
      }
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
