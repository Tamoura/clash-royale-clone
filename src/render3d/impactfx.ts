import type { CardId } from "../game/cards";

/** How a landed melee hit reads: a spark burst plus optional camera kick. */
export interface ImpactStyle {
  /** Silhouette of the hit response. */
  kind: "cut" | "crush" | "magic";
  /** Number of spark particles to throw. */
  particles: number;
  /** Spark launch speed (world units/sec). */
  speed: number;
  /** Spray cone half-angle (radians). */
  spread: number;
  color: number;
  size: number;
  /** Secondary flash/ring color. */
  accent: number;
  /** Expanding contact ring radius (0 disables it). */
  ringRadius: number;
  /** Camera trauma to add (0 = no shake). */
  trauma: number;
}

const CRUSH: ImpactStyle = {
  kind: "crush",
  particles: 16,
  speed: 5.4,
  spread: 1.45,
  color: 0xfff1c4,
  size: 0.13,
  accent: 0xf6c14e,
  ringRadius: 1.05,
  trauma: 0.32,
};
const MEDIUM: ImpactStyle = {
  kind: "cut",
  particles: 9,
  speed: 4.2,
  spread: 1.25,
  color: 0xffe7b0,
  size: 0.1,
  accent: 0xff9f43,
  ringRadius: 0.55,
  trauma: 0.14,
};
const LIGHT: ImpactStyle = {
  kind: "cut",
  particles: 4,
  speed: 3,
  spread: 1.5,
  color: 0xfff4d6,
  size: 0.075,
  accent: 0xffffff,
  ringRadius: 0,
  trauma: 0,
};
const ARCANE: ImpactStyle = {
  ...MEDIUM,
  kind: "magic",
  color: 0xb98bff,
  accent: 0x7c4dff,
  ringRadius: 0.7,
  trauma: 0.08,
};

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
    case "mega-knight":
      return CRUSH;
    case "witch":
      return ARCANE;
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
