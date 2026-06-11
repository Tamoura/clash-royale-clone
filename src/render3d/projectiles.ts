import type { CardId } from "../game/cards";
import type { EntityKind } from "../game/battle";

/** Visual recipe for one ranged attack's projectile. */
export interface ProjectileStyle {
  form: "arrow" | "orb";
  color: number;
  /** Orb radius in world units (ignored for arrows). */
  size: number;
  /** Emissive material + light streak trail. */
  glow: boolean;
  /** Peak height of the flight arc. */
  arc: number;
  /** Flight time in seconds. */
  duration: number;
  /** Brief flash at the muzzle when fired. */
  muzzleFlash: boolean;
}

const ORB_DEFAULTS = {
  form: "orb" as const,
  size: 0.08,
  glow: false,
  arc: 0.25,
  duration: 0.16,
  muzzleFlash: false,
};

/** Per-card projectile looks; towers and archers loose arrows. */
export function projectileStyle(
  cardId: CardId | null,
  kind: EntityKind,
): ProjectileStyle {
  if (kind !== "troop" && kind !== "building") {
    // Tower arrows: golden, high arc.
    return { ...ORB_DEFAULTS, form: "arrow", color: 0xffe082, arc: 0.8, duration: 0.22 };
  }
  switch (cardId) {
    case "archers":
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xd7ccc8, arc: 0.8, duration: 0.22 };
    case "wizard":
      return { ...ORB_DEFAULTS, color: 0xff8c1a, size: 0.16, glow: true };
    case "witch":
      return { ...ORB_DEFAULTS, color: 0x76ff03, size: 0.14, glow: true };
    case "baby-dragon":
      return { ...ORB_DEFAULTS, color: 0x8bc34a, size: 0.15, glow: true };
    case "cannon":
      return { ...ORB_DEFAULTS, color: 0x263238, size: 0.15, arc: 0.8 };
    case "musketeer":
      return { ...ORB_DEFAULTS, color: 0x37474f, duration: 0.12, muzzleFlash: true };
    default:
      return { ...ORB_DEFAULTS, color: 0x37474f };
  }
}
