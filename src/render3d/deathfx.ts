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
