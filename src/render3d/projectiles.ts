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
  size: 0.17,
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
    // Tower arrows: deep orange-gold so they read against the sandy floor.
    return { ...ORB_DEFAULTS, form: "arrow", color: 0xe65100, arc: 0.8, duration: 0.22 };
  }
  switch (cardId) {
    case "archers":
      // Dark wooden shaft — a light grey one vanished on the sand.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0x4e342e, arc: 0.8, duration: 0.22 };
    case "wizard":
      return { ...ORB_DEFAULTS, color: 0xff8c1a, size: 0.26, glow: true };
    case "witch":
      return { ...ORB_DEFAULTS, color: 0x76ff03, size: 0.24, glow: true };
    case "baby-dragon":
      return { ...ORB_DEFAULTS, color: 0x8bc34a, size: 0.26, glow: true };
    case "cannon":
      return { ...ORB_DEFAULTS, color: 0x1b2327, size: 0.26, arc: 0.8 };
    case "musketeer":
      return { ...ORB_DEFAULTS, color: 0x1b2327, size: 0.18, duration: 0.12, muzzleFlash: true };
    case "magic-archer":
      // A piercing magic arrow: glowing purple, flying flat and far.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xb98bff, glow: true, arc: 0.12, duration: 0.3 };
    case "firecracker":
      // A spitting firework spark with a bright muzzle flash.
      return { ...ORB_DEFAULTS, color: 0xff7a18, size: 0.22, glow: true, arc: 0.4, muzzleFlash: true };
    default:
      return { ...ORB_DEFAULTS, color: 0x263238 };
  }
}
