import type { CardId } from "../game/cards";

/** How a troop's death reads on screen. */
export interface DeathStyle {
  kind: "puff" | "bones" | "sparks" | "deflate";
  color: number;
  /** Scale applied to the primary death silhouette. */
  scale: number;
  /** Number of pooled accent particles emitted after the silhouette. */
  particles: number;
}

/** Per-card death theatrics; default is the classic dust puff. */
export function deathStyle(cardId: CardId | null): DeathStyle {
  switch (cardId) {
    case "skeletons":
    case "skeleton-army":
      return { kind: "bones", color: 0xf5f2ea, scale: 0.9, particles: 4 };
    case "pekka":
    case "mini-pekka":
      return { kind: "sparks", color: 0x8c7bff, scale: 1.1, particles: 9 };
    case "electro-wizard":
      return { kind: "sparks", color: 0x76e6ff, scale: 1.1, particles: 9 };
    case "balloon":
      return { kind: "deflate", color: 0xc62828, scale: 1.35, particles: 7 };
    case "baby-dragon":
      return { kind: "puff", color: 0x8bc34a, scale: 1.15, particles: 7 };
    default:
      return { kind: "puff", color: 0xd8cbb5, scale: 0.75, particles: 5 };
  }
}
