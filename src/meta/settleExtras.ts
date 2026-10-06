/**
 * Pure match-end bookkeeping for the reward loop, on top of the built-in
 * settlement: Crown Pass crowns, Trophy Road nodes the match unlocked, and
 * the Draft run (3 wins in a row pays a rare chest). The rewards wire
 * applies the result to storage and shows it on the result screen.
 */
import type { MatchEndPayload } from "../app/hooks";
import { addCrowns, passProgress, type PassState } from "./pass";
import { claimable } from "./road";
import type { RoadNode } from "./roadRewards";

/** Draft wins in a row that pay a rare chest. */
export const DRAFT_RUN_WINS = 3;

export type ExtrasSummary = Pick<
  MatchEndPayload,
  "kind" | "winner" | "mySide" | "myCrowns" | "online" | "replay" | "sandbox"
>;

export interface ExtrasState {
  pass: PassState;
  roadClaimed: readonly number[];
  /** Best trophies ever reached, including this match. */
  reached: number;
  /** Draft wins in the current run before this match. */
  draftWins: number;
}

export interface SettleExtras {
  /** Crowns this match added to the pass (0 when it does not count). */
  passCrownsAdded: number;
  pass: PassState;
  /** The pass opened at least one new tier. */
  passTierUp: boolean;
  /** Trophy Road nodes waiting to be claimed after this match. */
  roadNowClaimable: RoadNode[];
  /** A rare chest when this win completed a Draft run. */
  draftReward: "rare" | null;
  /** Draft run wins after this match. */
  draftWins: number;
}

/** Real matches the player played: not a watched replay, not sandbox practice. */
export function countsForRewards(s: ExtrasSummary): boolean {
  return !s.replay && !s.sandbox;
}

export function settleExtras(s: ExtrasSummary, state: ExtrasState): SettleExtras {
  const counts = countsForRewards(s);
  const passCrownsAdded = counts ? Math.max(0, Math.floor(s.myCrowns)) : 0;
  const pass = addCrowns(state.pass, passCrownsAdded);
  const passTierUp = passProgress(pass).tier > passProgress(state.pass).tier;

  let draftWins = state.draftWins;
  let draftReward: "rare" | null = null;
  if (counts && !s.online && s.kind === "draft") {
    if (s.winner === s.mySide) {
      draftWins += 1;
      if (draftWins >= DRAFT_RUN_WINS) {
        draftReward = "rare";
        draftWins = 0;
      }
    } else if (s.winner !== "draw") {
      draftWins = 0; // a loss ends the run
    }
  }

  return {
    passCrownsAdded,
    pass,
    passTierUp,
    roadNowClaimable: claimable(state.reached, state.roadClaimed),
    draftReward,
    draftWins,
  };
}
