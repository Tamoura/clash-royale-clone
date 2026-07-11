import { describe, expect, it } from "vitest";
import { DECK, type CardId } from "./cards";
import { createHand, playCard } from "./hand";

// A fixed 8-card deck so these tests don't depend on the real deck size.
const TEST_DECK: CardId[] = DECK.slice(0, 8);

describe("hand", () => {
  it("deals 4 cards from the deck, keeping the rest in order", () => {
    const h = createHand(TEST_DECK);
    expect(h.cards).toEqual(TEST_DECK.slice(0, 4));
    expect(h.queue).toEqual(TEST_DECK.slice(4));
  });

  it("playing a card replaces it with the next queued card", () => {
    const h = createHand(TEST_DECK);
    const after = playCard(h, TEST_DECK[1]);
    expect(after.cards[1]).toBe(TEST_DECK[4]);
    expect(after.cards.filter((c) => c === TEST_DECK[1])).toHaveLength(0);
  });

  it("the played card goes to the back of the queue", () => {
    const h = createHand(TEST_DECK);
    const after = playCard(h, TEST_DECK[0]);
    expect(after.queue[after.queue.length - 1]).toBe(TEST_DECK[0]);
    expect(after.queue).toHaveLength(4);
  });

  it("cycles: the first card returns to hand on the fifth play", () => {
    let h = createHand(TEST_DECK);
    for (const id of TEST_DECK.slice(0, 4)) h = playCard(h, id);
    // 8-card cycle: after 4 plays the hand is the back half of the deck.
    expect(h.cards).toEqual(TEST_DECK.slice(4));
    h = playCard(h, TEST_DECK[4]);
    expect(h.cards).toContain(TEST_DECK[0]);
  });

  it("throws when playing a card not in hand", () => {
    const h = createHand(TEST_DECK);
    expect(() => playCard(h, TEST_DECK[5])).toThrow();
  });
});
