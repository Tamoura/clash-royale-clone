import { describe, expect, it } from "vitest";
import type { CardId } from "../game/cards";
import { TRIAL_CHALLENGES } from "../game/challenges";
import {
  NEW_CARDS_SEEN_KEY,
  NEW_CARD_IDS,
  lockInfo,
  lockText,
  markNewCardsSeen,
  newCardRows,
  newCardsSeen,
  shouldShowNewCards,
  type SeenStore,
} from "./newCards";

function store(seed: Record<string, string> = {}): SeenStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const en = (e: string): string => e;
const ar = (_e: string, a: string): string => a;

describe("New cards! sheet", () => {
  it("introduces the wave's three cards, each with a trial", () => {
    expect(NEW_CARD_IDS).toEqual(["stone-golem", "digger", "comet"]);
    const rows = newCardRows(new Set(), 0, en);
    expect(rows.map((r) => r.id)).toEqual(NEW_CARD_IDS);
    for (const r of rows) {
      expect(r.blurb.length, r.id).toBeGreaterThan(10);
      expect(r.trial, r.id).not.toBeNull();
      expect(r.trial!.trial).toBe(r.id);
      expect(TRIAL_CHALLENGES).toContain(r.trial);
    }
  });

  it("shows once, after the guided battle; closing sets the seen flag", () => {
    const s = store();
    expect(shouldShowNewCards(s, false)).toBe(false); // not before the tutorial
    expect(shouldShowNewCards(s, true)).toBe(true);
    // While Home's hand points a brand-new player at their first chest, it waits.
    expect(shouldShowNewCards(s, true, true)).toBe(false);
    expect(shouldShowNewCards(s, true, false)).toBe(true);
    markNewCardsSeen(s);
    expect(s.data.get(NEW_CARDS_SEEN_KEY)).toBe("1");
    expect(newCardsSeen(s)).toBe(true);
    expect(shouldShowNewCards(s, true)).toBe(false);
  });

  it("never nags when storage is unavailable or throws", () => {
    expect(newCardsSeen(null)).toBe(true);
    const broken: SeenStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(newCardsSeen(broken)).toBe(true);
    expect(() => markNewCardsSeen(broken)).not.toThrow();
  });

  it("flags locked cards with where they unlock, in both editions", () => {
    const owned = new Set<CardId>(["digger"]);
    expect(lockText("digger", owned, 0, en)).toBeNull();
    expect(lockText("stone-golem", owned, 0, en)).toMatch(/Unlocks in .+ \(200 trophies\)/);
    expect(lockText("comet", owned, 0, en)).toMatch(/\(3,000 trophies\)/); // grouped, like the Arabic line
    expect(lockText("comet", owned, 0, ar)).toMatch(/[؀-ۿ]/);
    expect(lockText("comet", owned, 0, ar)).toContain("٣٬٠٠٠"); // Arabic-Indic digits
    const rows = newCardRows(owned, 0, en);
    expect(rows.find((r) => r.id === "digger")!.lock).toBeNull();
    expect(rows.find((r) => r.id === "comet")!.lock).toEqual({ text: expect.stringMatching(/^Unlocks in/), findable: false });
  });

  it("a card whose arena is reached reads as findable in chests, not as locked", () => {
    const owned = new Set<CardId>();
    expect(lockInfo("stone-golem", owned, 199, en)!.findable).toBe(false);
    expect(lockInfo("stone-golem", owned, 200, en)).toEqual({ text: "Find it in chests", findable: true });
    expect(lockInfo("stone-golem", owned, 250, ar)!.text).toMatch(/[؀-ۿ]/);
    expect(lockText("stone-golem", owned, 250, en)).not.toMatch(/Unlocks/);
    // Further cards still name their arena.
    expect(lockText("digger", owned, 250, en)).toMatch(/Unlocks in .+ \(400 trophies\)/);
    const rows = newCardRows(owned, 3000, en);
    expect(rows.every((r) => r.lock?.findable)).toBe(true);
  });
});
