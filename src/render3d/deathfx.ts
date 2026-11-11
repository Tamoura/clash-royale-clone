import type { CardId } from "../game/cards";
import { ARABIC } from "./theme";

/** How a troop's death reads on screen. */
export interface DeathStyle {
  kind: "puff" | "bones" | "sparks" | "deflate" | "crumble";
  color: number;
  /** Scale applied to the primary death silhouette. */
  scale: number;
  /** Number of pooled accent particles emitted after the silhouette. */
  particles: number;
}

/**
 * Per-card death theatrics. Every puff is tinted (art bible 8: never
 * white): a creature leaves a puff of its own colour, everyone else a
 * dusty violet-grey.
 */
export function deathStyle(cardId: CardId | null): DeathStyle {
  switch (cardId) {
    case "skeletons":
    case "skeleton-army":
      return { kind: "bones", color: 0xe9dfc8, scale: 0.9, particles: 4 };
    case "pekka":
    case "mini-pekka":
      return { kind: "sparks", color: 0x8c7bff, scale: 1.1, particles: 9 };
    case "electro-wizard":
      return { kind: "sparks", color: 0x76e6ff, scale: 1.1, particles: 9 };
    case "balloon":
      // The Golden Age flies a fire kite: its silk tears in saffron.
      return { kind: "deflate", color: ARABIC ? 0xe0a030 : 0xd9a441, scale: 1.35, particles: 7 };
    case "baby-dragon":
      return { kind: "puff", color: ARABIC ? 0xb98a5a : 0x6fae3e, scale: 1.1, particles: 7 };
    case "minions":
      return { kind: "puff", color: ARABIC ? 0x8a6a4a : 0x8a7f9e, scale: 0.75, particles: 5 };
    case "bats":
      return { kind: "puff", color: 0x7a5aa8, scale: 0.6, particles: 4 };
    case "gargoyles":
      return { kind: "puff", color: ARABIC ? 0x8a6a4a : 0x8d8a84, scale: 0.8, particles: 5 };
    case "giant":
      // The Golden Age giant is a war elephant.
      return { kind: "puff", color: ARABIC ? 0x9a8f86 : 0xa08f86, scale: 1.2, particles: 6 };
    // A golem crumbles into stone chunks (its pebbles pop out of the rubble).
    case "stone-golem":
      return { kind: "crumble", color: ARABIC ? 0xc8b898 : 0x8e928a, scale: 1.5, particles: 10 };
    case "pebble-golem":
      return { kind: "crumble", color: ARABIC ? 0xc8b898 : 0x8e928a, scale: 0.8, particles: 6 };
    case "digger":
      return { kind: "puff", color: ARABIC ? 0xd8c49a : 0xa88a64, scale: 0.85, particles: 6 };
    default:
      return { kind: "puff", color: 0x9d93a8, scale: 0.75, particles: 5 };
  }
}

/**
 * How the body itself leaves the field:
 * - ko: falls flat (away from the last blow), bounces once, X-eyes, sinks
 * - shatter: a skeleton's bones or a robot's plates fly apart
 * - tumble: a flyer spins down out of the air
 */
export type DeathMotion = "ko" | "shatter" | "tumble";

const SHATTER_CARDS: ReadonlySet<CardId> = new Set<CardId>([
  "skeletons",
  "skeleton-army",
  "pekka",
  "mini-pekka",
  // Stone has no face to knock out: a golem breaks into its boulders.
  "stone-golem",
  "pebble-golem",
]);

/**
 * Pick the death motion. Only faceless rigs (skeletons, the P.E.K.K.A
 * robots) shatter: where an edition dresses those cards as people with
 * faces, they get a knockout instead of coming apart.
 */
export function deathMotion(
  cardId: CardId | null,
  rig: { flying: boolean; hasFace: boolean },
): DeathMotion {
  if (rig.flying) return "tumble";
  if (cardId && SHATTER_CARDS.has(cardId) && !rig.hasFace) return "shatter";
  return "ko";
}

/**
 * The ground direction (world x/z, unit length) a body topples toward:
 * along the last blow's recoil (attacker -> victim), or, with no recent
 * blow, away from the middle of the board. Writes into `out`.
 */
export function toppleDirection(
  recoilX: number,
  recoilZ: number,
  posX: number,
  posZ: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  let x = recoilX;
  let z = recoilZ;
  let len = Math.sqrt(x * x + z * z);
  if (len < 1e-4) {
    x = posX;
    z = posZ;
    len = Math.sqrt(x * x + z * z);
  }
  if (len < 1e-4) {
    x = 0;
    z = 1;
    len = 1;
  }
  out.x = x / len;
  out.z = z / len;
  return out;
}
