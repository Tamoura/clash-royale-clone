import { describe, expect, it } from "vitest";
import { isValidDeck } from "./battle";
import { CARDS } from "./cards";
import {
  DRAFT_ROUNDS,
  createDraft,
  isDraftComplete,
  pickCard,
} from "./draft";

describe("draft mode", () => {
  it("offers 3 distinct known cards per round", () => {
    const d = createDraft(42);
    expect(d.offers).toHaveLength(3);
    expect(new Set(d.offers).size).toBe(3);
    for (const id of d.offers) expect(CARDS[id]).toBeDefined();
  });

  it("a pick goes to the player and the bot takes one of the rest", () => {
    const d = createDraft(42);
    const chosen = d.offers[0];
    const next = pickCard(d, chosen)!;
    expect(next.picks).toEqual([chosen]);
    expect(next.botPicks).toHaveLength(1);
    expect(d.offers).toContain(next.botPicks[0]);
    expect(next.botPicks[0]).not.toBe(chosen);
  });

  it("rejects a card that was not offered", () => {
    const d = createDraft(42);
    const notOffered = Object.keys(CARDS).find(
      (id) => !d.offers.includes(id as never),
    )!;
    expect(pickCard(d, notOffered as never)).toBeNull();
  });

  it("never repeats a card anywhere across the whole draft", () => {
    let d = createDraft(7);
    const seen = new Set<string>();
    for (let round = 0; round < DRAFT_ROUNDS; round++) {
      for (const id of d.offers) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      d = pickCard(d, d.offers[1])!;
    }
    expect(isDraftComplete(d)).toBe(true);
  });

  it("produces two legal 8-card decks after 8 rounds", () => {
    let d = createDraft(99);
    while (!isDraftComplete(d)) d = pickCard(d, d.offers[0])!;
    expect(isValidDeck(d.picks)).toBe(true);
    expect(isValidDeck(d.botPicks)).toBe(true);
    // The two decks never share a card (all draws are distinct).
    for (const id of d.picks) expect(d.botPicks).not.toContain(id);
  });

  it("is deterministic for a seed", () => {
    const run = (seed: number): string => {
      let d = createDraft(seed);
      const log: string[] = [];
      while (!isDraftComplete(d)) {
        log.push(d.offers.join(","));
        d = pickCard(d, d.offers[2])!;
      }
      return log.join("|") + "#" + d.botPicks.join(",");
    };
    expect(run(1234)).toBe(run(1234));
    expect(run(1234)).not.toBe(run(4321));
  });
});
