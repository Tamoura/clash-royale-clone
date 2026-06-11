import type { CardId } from "../game/cards";

/**
 * How a troop enters the field: necromantic summons rise out of
 * the ground, everything else pops in with a bounce.
 */
export function spawnStyle(cardId: CardId | null): "rise" | "pop" {
  return cardId === "skeletons" ? "rise" : "pop";
}
