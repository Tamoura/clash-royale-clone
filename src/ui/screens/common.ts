/** Small pieces shared by several menu screens. */
import type { CardId } from "../../game/cards";
import { makeCardCanvas } from "../cardFrame";

/** Card tile canvas reused in the deck tray and collection grid. */
export function cardTileCanvas(id: CardId): HTMLCanvasElement {
  return makeCardCanvas(id, { style: "tile", size: 128 });
}
