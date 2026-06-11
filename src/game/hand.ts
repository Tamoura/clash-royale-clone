import type { CardId } from "./cards";

export const HAND_SIZE = 4;

export interface HandState {
  /** The cards currently playable. */
  readonly cards: readonly CardId[];
  /** Upcoming cards, in draw order. */
  readonly queue: readonly CardId[];
}

export function createHand(deck: readonly CardId[]): HandState {
  return {
    cards: deck.slice(0, HAND_SIZE),
    queue: deck.slice(HAND_SIZE),
  };
}

export function playCard(hand: HandState, id: CardId): HandState {
  const index = hand.cards.indexOf(id);
  if (index === -1) throw new Error(`Card ${id} is not in hand`);
  const cards = [...hand.cards];
  cards[index] = hand.queue[0];
  return { cards, queue: [...hand.queue.slice(1), id] };
}
