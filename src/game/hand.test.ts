import { describe, expect, it } from "vitest";
import { DECK } from "./cards";
import { createHand, playCard } from "./hand";

describe("hand", () => {
  it("deals 4 cards from the deck, keeping the rest in order", () => {
    const h = createHand(DECK);
    expect(h.cards).toEqual(DECK.slice(0, 4));
    expect(h.queue).toEqual(DECK.slice(4));
  });

  it("playing a card replaces it with the next queued card", () => {
    const h = createHand(DECK);
    const after = playCard(h, DECK[1]);
    expect(after.cards[1]).toBe(DECK[4]);
    expect(after.cards.filter((c) => c === DECK[1])).toHaveLength(0);
  });

  it("the played card goes to the back of the queue", () => {
    const h = createHand(DECK);
    const after = playCard(h, DECK[0]);
    expect(after.queue[after.queue.length - 1]).toBe(DECK[0]);
    expect(after.queue).toHaveLength(4);
  });

  it("cycles: the first card returns to hand on the fifth play", () => {
    let h = createHand(DECK);
    for (const id of DECK.slice(0, 4)) h = playCard(h, id);
    // 8-card cycle: after 4 plays the hand is the back half of the deck.
    expect(h.cards).toEqual(DECK.slice(4));
    h = playCard(h, DECK[4]);
    expect(h.cards).toContain(DECK[0]);
  });

  it("throws when playing a card not in hand", () => {
    const h = createHand(DECK);
    expect(() => playCard(h, DECK[5])).toThrow();
  });
});
