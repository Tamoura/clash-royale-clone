/**
 * Card ownership and deck legality for the meta shell.
 * Battle sim still only sees an 8-card deck — this gates what can enter it.
 */
import { DEFAULT_DECK, DECK, type CardId } from "../game/cards";
import { isValidDeck } from "../game/battle";
import { cardsAvailableAt, unlockTrophiesFor } from "./arenas";

export type OwnedSet = Set<CardId>;
export type ShardMap = Partial<Record<CardId, number>>;

export function starterOwned(): CardId[] {
  return [...DEFAULT_DECK];
}

export function ownedSet(owned: readonly CardId[]): OwnedSet {
  return new Set(owned);
}

export function canPutInDeck(id: CardId, owned: OwnedSet): boolean {
  return owned.has(id);
}

/** True when the card's arena unlock is reached (findable / showable). */
export function isUnlockedAt(id: CardId, trophies: number): boolean {
  return unlockTrophiesFor(id) <= trophies;
}

export function isOwned(id: CardId, owned: OwnedSet): boolean {
  return owned.has(id);
}

/**
 * A battle deck must be 8 unique known cards, all owned.
 */
export function isOwnedDeck(
  cards: CardId[],
  owned: OwnedSet,
): boolean {
  return isValidDeck(cards) && cards.every((id) => owned.has(id));
}

/**
 * Clamp a saved deck to owned cards; fill remaining slots from starter
 * owned cards not already in the deck. Always returns 8 unique cards
 * when the owned set includes the starter deck.
 */
export function clampDeckToOwned(
  deck: CardId[],
  owned: OwnedSet,
): CardId[] {
  const kept: CardId[] = [];
  const seen = new Set<CardId>();
  for (const id of deck) {
    if (!owned.has(id) || seen.has(id)) continue;
    kept.push(id);
    seen.add(id);
    if (kept.length === 8) return kept;
  }
  for (const id of DEFAULT_DECK) {
    if (seen.has(id) || !owned.has(id)) continue;
    kept.push(id);
    seen.add(id);
    if (kept.length === 8) return kept;
  }
  for (const id of DECK) {
    if (seen.has(id) || !owned.has(id)) continue;
    kept.push(id);
    seen.add(id);
    if (kept.length === 8) return kept;
  }
  return kept;
}

/** Cards the player can still discover in chests at this trophy count. */
export function findableUnowned(
  trophies: number,
  owned: OwnedSet,
): CardId[] {
  return cardsAvailableAt(trophies).filter((id) => !owned.has(id));
}

export function addShards(
  shards: ShardMap,
  id: CardId,
  amount: number,
): ShardMap {
  const next = { ...shards };
  next[id] = Math.max(0, (next[id] ?? 0) + Math.max(0, Math.floor(amount)));
  return next;
}

export function grantOwned(owned: CardId[], id: CardId): CardId[] {
  if (owned.includes(id)) return owned;
  return [...owned, id];
}
