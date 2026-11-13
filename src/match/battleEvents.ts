/**
 * Playing a frame's battle events so that one glitch never costs a result.
 *
 * main.ts drains the battle's event list once a frame. Each event goes
 * through a list of steps (sounds, effects, the hooks, the HUD's bookkeeping)
 * and each step runs on its own through the crash shield's guard
 * (app/crashShield.ts): a step that throws is recorded and counted toward a
 * storm, and the next step, the next event and the settle all still run.
 * Before this, one throw anywhere in the fan-out lost the rest of the
 * frame's events, the "finish" among them: the kid saw VICTORY, nothing was
 * paid out, and the next launch charged the left-match loss.
 *
 * MatchSettler settles each battle exactly once: on its "finish" event, or,
 * as a safety net, on the first frame that finds the battle decided but
 * never settled (its "finish" event lost). A battle left as no contest
 * after a glitch (match/noContest.ts) is marked so it is never settled.
 */
import type { Side } from "../game/arena";
import type { BattleEvent } from "../game/battle";

export type Winner = Side | "draw";

/** One thing an event does on this device (a sound, an effect, a hook...). */
export type EventStep = (ev: BattleEvent) => void;

/** Run `work`; a throw is handled (recorded, counted) and never stops the caller. */
export type Guard = (where: string, work: () => void) => void;

/** The parts of a BattleState this module reads (and drains). */
export interface EventBattle {
  events: BattleEvent[];
  result: { winner: Winner } | null;
}

/** Settles each battle (by object) exactly once. */
export class MatchSettler {
  private readonly done = new WeakSet<object>();

  /** `settle`: main.ts finishMatch (rewards, quests, streaks, the matchEnd hook). */
  constructor(private readonly settle: (winner: Winner) => void) {}

  /**
   * Settle `battle` as won by `winner`, unless it already was (or was left
   * as no contest). It counts as settled before `settle` runs, so a settle
   * that throws halfway is never repeated (no double pay-out). Returns
   * whether it settled now.
   */
  once(battle: object, winner: Winner): boolean {
    if (this.done.has(battle)) return false;
    this.done.add(battle);
    this.settle(winner);
    return true;
  }

  /** Settled already (or no contest). */
  settled(battle: object): boolean {
    return this.done.has(battle);
  }

  /** Back to menu after a glitch: this battle is never settled, whatever turns up later. */
  noContest(battle: object): void {
    this.done.add(battle);
  }
}

/**
 * Drain and play the battle's events: every step of every event runs on
 * its own (guarded), a "finish" settles the match, and a battle that is
 * decided but was never settled settles now (the safety net).
 */
export function playBattleEvents(
  battle: EventBattle,
  steps: readonly EventStep[],
  settler: MatchSettler,
  guard: Guard,
): void {
  for (const ev of battle.events.splice(0)) {
    const where = `battle event '${ev.type}'`;
    for (const step of steps) guard(where, () => step(ev));
    if (ev.type === "finish") guard("settling the match", () => settler.once(battle, ev.winner));
  }
  // The safety net: decided, but its "finish" never reached the settle.
  const result = battle.result;
  if (result && !settler.settled(battle)) guard("settling the match", () => settler.once(battle, result.winner));
}
