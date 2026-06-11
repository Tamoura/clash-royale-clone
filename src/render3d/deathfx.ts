import type { CardId } from "../game/cards";

/** How a troop's death reads on screen. */
export interface DeathStyle {
  kind: "puff" | "bones" | "sparks" | "deflate";
  color: number;
}

/** Per-card death theatrics; default is the classic dust puff. */
export function deathStyle(cardId: CardId | null): DeathStyle {
  switch (cardId) {
    case "skeletons":
      return { kind: "bones", color: 0xf5f2ea };
    case "pekka":
    case "mini-pekka":
      return { kind: "sparks", color: 0x8c7bff };
    case "balloon":
      return { kind: "deflate", color: 0xc62828 };
    default:
      return { kind: "puff", color: 0xcccccc };
  }
}
