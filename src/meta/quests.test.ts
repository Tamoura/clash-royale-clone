import { describe, expect, it } from "vitest";
import {
  QUEST_POOL,
  claimQuest,
  isComplete,
  questDef,
  recordMatch,
  rollQuests,
} from "./quests";

describe("daily quests", () => {
  it("rolls three distinct quests deterministically per day", () => {
    const a = rollQuests("2026-07-20");
    const b = rollQuests("2026-07-20");
    expect(a.active).toEqual(b.active);
    expect(new Set(a.active).size).toBe(3);
    for (const id of a.active) expect(questDef(id)).toBeDefined();
    // A different day usually rolls a different set.
    const c = rollQuests("2026-07-21");
    expect(c.active.length).toBe(3);
  });

  it("accumulates progress per measure and caps at target", () => {
    let s = rollQuests("2026-07-20");
    s = { ...s, active: ["win2", "play20", "dmg30"] };
    s = recordMatch(s, { won: true, cardsPlayed: 12, damage: 20000 });
    expect(s.progress.win2).toBe(1);
    expect(s.progress.play20).toBe(12);
    expect(s.progress.dmg30).toBe(20000);
    s = recordMatch(s, { won: true, cardsPlayed: 30, damage: 50000 });
    expect(s.progress.win2).toBe(2);
    expect(s.progress.play20).toBe(20); // capped
    expect(s.progress.dmg30).toBe(30000); // capped
    expect(isComplete(s, "win2")).toBe(true);
    expect(isComplete(s, "play20")).toBe(true);
  });

  it("losses count cards and damage but not wins", () => {
    let s = { ...rollQuests("x"), active: ["win2", "play20", "dmg30"] };
    s = recordMatch(s, { won: false, cardsPlayed: 8, damage: 5000 });
    expect(s.progress.win2 ?? 0).toBe(0);
    expect(s.progress.play20).toBe(8);
  });

  it("claims pay once and only when complete", () => {
    let s = { ...rollQuests("x"), active: ["win2", "play20", "dmg30"] };
    expect(claimQuest(s, "win2")).toBeNull(); // not complete yet
    s = recordMatch(s, { won: true, cardsPlayed: 0, damage: 0 });
    s = recordMatch(s, { won: true, cardsPlayed: 0, damage: 0 });
    const claim = claimQuest(s, "win2");
    expect(claim).not.toBeNull();
    expect(claim!.reward).toBe(questDef("win2")!.reward);
    expect(claimQuest(claim!.state, "win2")).toBeNull(); // no double-dip
  });

  it("pool entries are sane", () => {
    for (const q of QUEST_POOL) {
      expect(q.target).toBeGreaterThan(0);
      expect(q.reward).toBeGreaterThan(0);
      expect(q.en.length).toBeGreaterThan(3);
      expect(q.ar.length).toBeGreaterThan(3);
    }
  });
});
