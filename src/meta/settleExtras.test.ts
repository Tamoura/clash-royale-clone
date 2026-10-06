import { describe, expect, it } from "vitest";
import { freshPass } from "./pass";
import { settleExtras, type ExtrasState, type ExtrasSummary } from "./settleExtras";

const base: ExtrasSummary = {
  kind: "ladder",
  winner: "player",
  mySide: "player",
  myCrowns: 3,
  online: false,
  replay: false,
  sandbox: false,
};

function state(over: Partial<ExtrasState> = {}): ExtrasState {
  return { pass: freshPass("2026-10"), roadClaimed: [], reached: 0, draftWins: 0, ...over };
}

describe("settleExtras", () => {
  it("a 3-crown ladder win adds 3 crowns to the pass", () => {
    const r = settleExtras(base, state());
    expect(r.passCrownsAdded).toBe(3);
    expect(r.pass.crowns).toBe(3);
    expect(r.passTierUp).toBe(false);
    expect(r.draftReward).toBeNull();
  });

  it("counts events and online matches with the local side's crowns, even losses", () => {
    expect(settleExtras({ ...base, kind: "daily", myCrowns: 1, winner: "enemy" }, state()).passCrownsAdded).toBe(1);
    expect(settleExtras({ ...base, kind: "challenge", myCrowns: 2 }, state()).passCrownsAdded).toBe(2);
    const guest = settleExtras({ ...base, online: true, mySide: "enemy", winner: "enemy", myCrowns: 2 }, state());
    expect(guest.passCrownsAdded).toBe(2);
  });

  it("skips replays and sandbox practice", () => {
    expect(settleExtras({ ...base, replay: true }, state()).passCrownsAdded).toBe(0);
    expect(settleExtras({ ...base, sandbox: true }, state()).passCrownsAdded).toBe(0);
  });

  it("reports a tier up and claimable road nodes", () => {
    const r = settleExtras(base, state({ pass: { ...freshPass("2026-10"), crowns: 8 }, reached: 120, roadClaimed: [50] }));
    expect(r.passTierUp).toBe(true);
    expect(r.roadNowClaimable.map((n) => n.at)).toEqual([100]);
    expect(settleExtras(base, state({ reached: 40 })).roadNowClaimable).toEqual([]);
  });

  it("a draft run of 3 straight wins pays a rare chest and starts a new run", () => {
    const draft = { ...base, kind: "draft" as const };
    let wins = 0;
    const rewards: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = settleExtras(draft, state({ draftWins: wins }));
      rewards.push(r.draftReward);
      wins = r.draftWins;
    }
    expect(rewards).toEqual([null, null, "rare", null]);
    expect(wins).toBe(1);
  });

  it("a draft loss ends the run; a draw keeps it; other modes leave it alone", () => {
    const draft = { ...base, kind: "draft" as const };
    expect(settleExtras({ ...draft, winner: "enemy" }, state({ draftWins: 2 })).draftWins).toBe(0);
    expect(settleExtras({ ...draft, winner: "draw" }, state({ draftWins: 2 })).draftWins).toBe(2);
    expect(settleExtras(base, state({ draftWins: 2 })).draftWins).toBe(2);
    // Replayed or online drafts never advance the run.
    expect(settleExtras({ ...draft, replay: true }, state({ draftWins: 2 })).draftReward).toBeNull();
    expect(settleExtras({ ...draft, online: true }, state({ draftWins: 2 })).draftWins).toBe(2);
  });
});
