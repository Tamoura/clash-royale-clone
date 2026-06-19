import type { CardId } from "../game/cards";

/**
 * How a troop enters the field: necromantic summons rise out of
 * the ground, the Mega Knight slams down from the sky, and
 * everything else pops in with a bounce.
 */
export function spawnStyle(cardId: CardId | null): "rise" | "pop" | "slam" {
  if (cardId === "skeletons") return "rise";
  if (cardId === "mega-knight") return "slam";
  return "pop";
}
