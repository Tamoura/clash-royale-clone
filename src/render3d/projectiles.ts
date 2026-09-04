import type { CardId } from "../game/cards";
import type { TowerTroopId } from "../game/towers";
import type { EntityKind } from "../game/battle";

/** Visual recipe for one ranged attack's projectile. */
export interface ProjectileStyle {
  form: "arrow" | "orb";
  color: number;
  /** Trail silhouette used by the renderer. */
  trail: "none" | "streak" | "embers" | "electric";
  /** Color of the landing flash. */
  impactColor: number;
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
  trail: "none" as const,
  impactColor: 0xfff1c4,
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
  towerTroop: TowerTroopId | null = null,
): ProjectileStyle {
  if (kind !== "troop" && kind !== "building") {
    if (towerTroop === "cannoneer") {
      // Heavy iron shell lobbed high, with a smoky trail.
      return { ...ORB_DEFAULTS, color: 0x20262b, impactColor: 0xffb300, trail: "embers", size: 0.32, arc: 1.0, duration: 0.3 };
    }
    if (towerTroop === "duchess") {
      // A flat, fast, silver dagger.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xdde4ec, impactColor: 0xffffff, trail: "streak", arc: 0.15, duration: 0.1 };
    }
    // Tower arrows: deep orange-gold so they read against the sandy floor.
    return { ...ORB_DEFAULTS, form: "arrow", color: 0xe65100, trail: "streak", arc: 0.8, duration: 0.22 };
  }
  switch (cardId) {
    case "archers":
      // Dark wooden shaft — a light grey one vanished on the sand.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0x4e342e, trail: "streak", arc: 0.8, duration: 0.22 };
    case "wizard":
      return { ...ORB_DEFAULTS, color: 0xff8c1a, impactColor: 0xffd54f, trail: "embers", size: 0.26, glow: true };
    case "witch":
      return { ...ORB_DEFAULTS, color: 0x76ff03, impactColor: 0xb98bff, trail: "streak", size: 0.24, glow: true };
    case "baby-dragon":
      return { ...ORB_DEFAULTS, color: 0x8bc34a, impactColor: 0xffb347, trail: "embers", size: 0.26, glow: true };
    case "cannon":
      return { ...ORB_DEFAULTS, color: 0x1b2327, size: 0.26, arc: 0.8 };
    case "musketeer":
      return { ...ORB_DEFAULTS, color: 0x1b2327, impactColor: 0xffb300, trail: "streak", size: 0.18, duration: 0.12, muzzleFlash: true };
    case "magic-archer":
      // A piercing magic arrow: glowing purple, flying flat and far.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xb98bff, impactColor: 0xd7b3ff, trail: "streak", glow: true, arc: 0.12, duration: 0.3 };
    case "firecracker":
      // A spitting firework spark with a bright muzzle flash.
      return { ...ORB_DEFAULTS, color: 0xff7a18, impactColor: 0xffe066, trail: "embers", size: 0.22, glow: true, arc: 0.4, muzzleFlash: true };
    case "electro-wizard":
      // Crackling blue-white bolt, flat and fast.
      return { ...ORB_DEFAULTS, color: 0x5ad1ff, impactColor: 0xe8fbff, trail: "electric", size: 0.2, glow: true, arc: 0.1, duration: 0.1, muzzleFlash: true };
    case "ice-wizard":
      // Pale icy shard.
      return { ...ORB_DEFAULTS, color: 0xbfeaff, impactColor: 0xffffff, trail: "streak", size: 0.22, glow: true, arc: 0.2 };
    case "princess":
      // A long, high flaming arrow lobbed across the arena.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xff7043, impactColor: 0xffd54f, trail: "embers", glow: true, arc: 1.1, duration: 0.34 };
    case "royal-giant":
      // Heavy dark cannonball.
      return { ...ORB_DEFAULTS, color: 0x20262b, size: 0.3, arc: 0.5, duration: 0.2 };
    default:
      return { ...ORB_DEFAULTS, color: 0x263238 };
  }
}
