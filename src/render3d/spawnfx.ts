import type { CardId } from "../game/cards";

export interface SpawnRecipe {
  kind: "rise" | "pop" | "slam";
  color: number;
  burst: number;
}

/**
 * How a troop enters the field: necromantic summons rise out of
 * the ground, the Mega Knight slams down from the sky, and
 * everything else pops in with a bounce.
 */
export function spawnStyle(cardId: CardId | null): "rise" | "pop" | "slam" {
  return spawnRecipe(cardId).kind;
}

/** Data-only deploy flourish; never feeds back into simulation state. */
export function spawnRecipe(cardId: CardId | null): SpawnRecipe {
  if (cardId === "skeletons" || cardId === "skeleton-army") {
    return { kind: "rise", color: 0x76ff03, burst: 0.75 };
  }
  if (cardId === "mega-knight") {
    return { kind: "slam", color: 0xf6c14e, burst: 1.8 };
  }
  if (cardId === "electro-wizard") {
    return { kind: "pop", color: 0x76e6ff, burst: 0.85 };
  }
  if (cardId === "witch") {
    return { kind: "pop", color: 0xb98bff, burst: 0.75 };
  }
  return { kind: "pop", color: 0xd9cdb8, burst: 0.45 };
}
