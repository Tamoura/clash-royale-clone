import type { CardId } from "../game/cards";
import type { TowerTroopId } from "../game/towers";
import type { EntityKind } from "../game/battle";

/**
 * Visual recipe for one ranged attack's projectile (art bible 8: modelled
 * projectiles). The renderer (scene/fx/effects.ts) builds each form once
 * per style from cached geometry:
 * - fireball: an emissive core above the bloom threshold, three toon flame
 *   petals spinning round it and a smoke ribbon shed behind (never a cone);
 * - arrow: a shaft, a steel head and fletching, one draw;
 * - tracer: a musket ball with a hot streak behind it;
 * - bolt: an electric core that crackles along its path;
 * - shard: a pale ice crystal shedding frost;
 * - orb: a plain ball (cannonballs, magic orbs).
 */
export type ProjectileForm = "arrow" | "orb" | "fireball" | "tracer" | "bolt" | "shard";

export interface ProjectileStyle {
  form: ProjectileForm;
  color: number;
  /** What the shot sheds in flight. */
  trail: "none" | "streak" | "embers" | "electric" | "smoke" | "frost" | "sparkle";
  /** Color of the landing flash. */
  impactColor: number;
  /** Orb radius in world units (ignored for arrows). */
  size: number;
  /** Emissive core (the one part allowed past the bloom threshold). */
  glow: boolean;
  /** Peak height of the flight arc. */
  arc: number;
  /** Flight time in seconds. */
  duration: number;
  /** Brief flash at the muzzle when fired. */
  muzzleFlash: boolean;
  /** Arrows: the fletching colour (feathers). */
  fletch?: number;
}

const ORB_DEFAULTS = {
  form: "orb" as ProjectileForm,
  trail: "none" as ProjectileStyle["trail"],
  impactColor: 0xfff1c4,
  size: 0.17,
  glow: false,
  arc: 0.25,
  duration: 0.16,
  muzzleFlash: false,
};

/** Cream goose feathers on a plain arrow (never white, never a team hue). */
export const FLETCH_CREAM = 0xe8dcc0;

/** Per-card projectile looks; towers and archers loose arrows. */
export function projectileStyle(
  cardId: CardId | null,
  kind: EntityKind,
  towerTroop: TowerTroopId | null = null,
): ProjectileStyle {
  if (kind !== "troop" && kind !== "building") {
    if (towerTroop === "cannoneer") {
      // Heavy iron shell lobbed high, trailing smoke.
      return { ...ORB_DEFAULTS, color: 0x20262b, impactColor: 0xffb300, trail: "smoke", size: 0.32, arc: 1.0, duration: 0.3 };
    }
    if (towerTroop === "duchess") {
      // A flat, fast, silver dagger.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0xc9d2dc, fletch: 0x6b4fa0, impactColor: 0xfff1c4, trail: "streak", arc: 0.15, duration: 0.1 };
    }
    // Tower arrows: a dark shaft and cream fletching, so they read against the sandy floor.
    return { ...ORB_DEFAULTS, form: "arrow", color: 0x5a3a22, fletch: FLETCH_CREAM, trail: "streak", arc: 0.8, duration: 0.22 };
  }
  switch (cardId) {
    case "archers":
      // Dark wooden shaft — a light grey one vanished on the sand.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0x4e342e, fletch: FLETCH_CREAM, trail: "streak", arc: 0.8, duration: 0.22 };
    case "wizard":
      return { ...ORB_DEFAULTS, form: "fireball", color: 0xff8c1a, impactColor: 0xffd54f, trail: "embers", size: 0.26, glow: true };
    case "witch":
      return { ...ORB_DEFAULTS, color: 0x7a3fbf, impactColor: 0xb98bff, trail: "sparkle", size: 0.22, glow: true };
    case "baby-dragon":
      // A small breath fireball (the dragon itself never blooms).
      return { ...ORB_DEFAULTS, form: "fireball", color: 0xff9a2e, impactColor: 0xffb347, trail: "embers", size: 0.2, glow: true };
    case "cannon":
      return { ...ORB_DEFAULTS, color: 0x1b2327, size: 0.26, arc: 0.8, trail: "smoke" };
    case "musketeer":
      return { ...ORB_DEFAULTS, form: "tracer", color: 0xffc35a, impactColor: 0xffb300, trail: "streak", size: 0.1, duration: 0.12, muzzleFlash: true };
    case "magic-archer":
      // A piercing magic arrow: violet fletching and glow, flying flat and far.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0x5b3d8a, fletch: 0xb98bff, impactColor: 0xd7b3ff, trail: "sparkle", glow: true, arc: 0.12, duration: 0.3 };
    case "firecracker":
      // A spitting firework spark with a bright muzzle flash.
      return { ...ORB_DEFAULTS, form: "fireball", color: 0xff7a18, impactColor: 0xffe066, trail: "embers", size: 0.16, glow: true, arc: 0.4, muzzleFlash: true };
    case "electro-wizard":
      // Crackling blue-white bolt, flat and fast.
      return { ...ORB_DEFAULTS, form: "bolt", color: 0x5ad1ff, impactColor: 0xe8fbff, trail: "electric", size: 0.18, glow: true, arc: 0.1, duration: 0.1, muzzleFlash: true };
    case "ice-wizard":
      // A pale ice shard shedding frost.
      return { ...ORB_DEFAULTS, form: "shard", color: 0xbfeaff, impactColor: 0xe6f8ff, trail: "frost", size: 0.22, glow: true, arc: 0.2 };
    case "princess":
      // A long, high flaming arrow lobbed across the arena.
      return { ...ORB_DEFAULTS, form: "arrow", color: 0x6b3a1e, fletch: 0xffb347, impactColor: 0xffd54f, trail: "embers", glow: true, arc: 1.1, duration: 0.34 };
    case "royal-giant":
      // Heavy dark cannonball with a puff of smoke behind.
      return { ...ORB_DEFAULTS, color: 0x20262b, size: 0.3, arc: 0.5, duration: 0.2, trail: "smoke" };
    default:
      return { ...ORB_DEFAULTS, color: 0x263238 };
  }
}
