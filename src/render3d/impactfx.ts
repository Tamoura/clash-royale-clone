import type { CardId } from "../game/cards";

/** How a landed melee hit reads: a spark burst plus optional camera kick. */
export interface ImpactStyle {
  /** Number of spark particles to throw. */
  particles: number;
  /** Spark launch speed (world units/sec). */
  speed: number;
  /** Spray cone half-angle (radians). */
  spread: number;
  color: number;
  size: number;
  /** Camera trauma to add (0 = no shake). */
  trauma: number;
}

const HEAVY: ImpactStyle = { particles: 14, speed: 5, spread: 1.4, color: 0xfff1c4, size: 0.12, trauma: 0.32 };
const MEDIUM: ImpactStyle = { particles: 8, speed: 4, spread: 1.3, color: 0xffe7b0, size: 0.1, trauma: 0.14 };
const LIGHT: ImpactStyle = { particles: 4, speed: 3, spread: 1.5, color: 0xfff4d6, size: 0.08, trauma: 0 };

/**
 * Per-card melee impact recipe. Bruisers land with a screen-shaking burst;
 * swarm units just flick a few sparks. Ranged units don't use this — their
 * shots are projectiles.
 */
export function impactStyle(cardId: CardId | null): ImpactStyle {
  switch (cardId) {
    case "pekka":
    case "mini-pekka":
    case "prince":
      return HEAVY;
    case "knight":
    case "valkyrie":
    case "giant":
    case "hog-rider":
    case "balloon":
      return MEDIUM;
    default:
      return LIGHT;
  }
}
