/**
 * Crown tower styles: everything about a tower's look that is data, not
 * geometry, so it can be read (and tested) without a canvas or a GPU.
 *
 * - Per look: the stone (ArenaLook.tower BrickVariant per team), the plinth,
 *   battlement and platform colours, and the look-id extras (snow caps,
 *   ember cracks, vines, neon strips, bone lintels) from a small switch
 *   table. Roofs and domes are never in here: they are always the live
 *   team colour (teamColors.ts), colour-blind palette included.
 * - Flair tiers from the trophy road (setTowerFlair): gilded, then jeweled.
 * - Damage stage thresholds.
 * - HP plate placement as screen-space maths: above the tallest roof tip
 *   for the far side's towers, under the gate foot for the near side's,
 *   with a clearance, flipped when the preferred side leaves the screen.
 */
import type { ArenaLook, BrickVariant } from "../../arenaLooks";

export type TowerEdition = "classic" | "golden";

/** Look-specific dressing (art bible section 2, "Per look"). */
export type TowerExtra = "snowCaps" | "emberCracks" | "vines" | "neonStrips" | "boneLintels";

/** The Classic looks (arenaLooks.ts LOOKS) and the Golden Age ones (ISLAMIC_LOOKS). */
export const CLASSIC_LOOK_IDS = [
  "meadow", "swamp", "bone", "snow", "forge", "mystic", "workshop", "royal", "ice", "jungle", "neon",
] as const;
export const GOLDEN_LOOK_IDS = [
  "souk", "courtyard", "oasis", "dunes", "copper", "andalus", "artisans", "alhambra", "atlas", "ghouta", "medina",
] as const;

/** Look id -> extras. Looks not listed wear none. */
export const LOOK_EXTRAS: Readonly<Record<string, readonly TowerExtra[]>> = {
  snow: ["snowCaps"],
  ice: ["snowCaps"],
  atlas: ["snowCaps"],
  forge: ["emberCracks"],
  copper: ["emberCracks"],
  jungle: ["vines"],
  ghouta: ["vines"],
  neon: ["neonStrips"],
  bone: ["boneLintels"],
};

/** Gold for trim, finials and crests (both editions). */
export const TOWER_GOLD = 0xf2c14e;
export const TOWER_GOLD_DARK = 0xc9932e;

export interface TowerStyle {
  look: string;
  edition: TowerEdition;
  /** Roof shape: Classic cones, Golden Age bulbous domes. */
  roof: "cone" | "dome";
  /** Ashlar stone for each viewer-relative team's keep. */
  wall: { player: BrickVariant; enemy: BrickVariant };
  /** Paving under the plinth, per team. */
  platform: { player: number; enemy: number };
  plinth: number;
  battlement: number;
  extras: ReadonlySet<TowerExtra>;
  /** Night-native looks keep warm lit slits (copper, medina, souk). */
  litWindows: boolean;
}

/** The style for one arena look in one edition. */
export function towerStyle(look: ArenaLook, edition: TowerEdition): TowerStyle {
  const t = look.tower;
  return {
    look: look.id,
    edition,
    roof: edition === "golden" ? "dome" : "cone",
    wall: { player: t.player, enemy: t.enemy },
    platform: { player: t.platformPlayer, enemy: t.platformEnemy },
    plinth: t.plinth,
    battlement: t.battlement,
    extras: new Set(LOOK_EXTRAS[look.id] ?? []),
    litWindows: look.nightPools,
  };
}

/** What each trophy-road flair tier adds (setTowerFlair: 0 plain, 1 at 600, 2 at 1200). */
export interface TowerFlair {
  tier: 0 | 1 | 2;
  /** Gold string courses and merlon caps instead of stone. */
  gildedTrim: boolean;
  /** Tall gilded spire finials instead of plain gold balls. */
  gildedFinials: boolean;
  /** A ruby set in gold on the crest. */
  jewelCrest: boolean;
  /** Gold bands around every roof cone or dome. */
  goldRoofBands: boolean;
}

export function towerFlair(tier: number): TowerFlair {
  const t = Math.max(0, Math.min(2, Math.floor(Number.isFinite(tier) ? tier : 0))) as 0 | 1 | 2;
  return { tier: t, gildedTrim: t >= 1, gildedFinials: t >= 1, jewelCrest: t >= 2, goldRoofBands: t >= 2 };
}

// ---- Damage -------------------------------------------------------------------------

/** HP shares below which a crown tower shows damage stage 1 and 2. */
export const DAMAGE_STAGE_1 = 0.7;
export const DAMAGE_STAGE_2 = 0.4;

/** 0 whole, 1 below 70% HP (cracks, a chipped merlon), 2 below 40% (more merlons, roof hole, torn banner, smoke). */
export function towerDamageStage(hp: number, maxHp: number): 0 | 1 | 2 {
  const f = maxHp > 0 ? hp / maxHp : 0;
  return f < DAMAGE_STAGE_2 ? 2 : f < DAMAGE_STAGE_1 ? 1 : 0;
}

// ---- HP plate placement ------------------------------------------------------------

/**
 * The battle camera's screen-up direction in world units: CAM_HOME (0, 30, 26)
 * looks down about 49 degrees, so a point at height y and depth z sits at
 * s = UP_Y * y - UP_Z * camSide * z on the image plane (camSide +1 for the
 * host, whose camera stands at +z; -1 for the online guest).
 */
export const UP_Y = 26 / Math.hypot(30, 26);
export const UP_Z = 30 / Math.hypot(30, 26);

export function screenUp(y: number, z: number, camSide: number): number {
  return UP_Y * y - UP_Z * camSide * z;
}

/** A point's height and depth (tower-local). */
export interface YZ {
  y: number;
  z: number;
}

/**
 * Where a tower's HP plate goes, in screen-up units relative to the tower's
 * foot: its centre `s`, and whether it hangs above the roofs.
 */
export interface PlateSpot {
  s: number;
  above: boolean;
}

/**
 * Plate centre (screen-up, world units) for a tower whose silhouette reaches
 * up to `top` and down to `foot` (both screen-up, world units), for a plate
 * `halfH` tall either side of its centre, `clear` units off the tower. Far
 * towers (the opponent's, at the top of the screen) carry it above the
 * tallest roof tip; near towers under the gate foot.
 */
export function platePlacement(top: number, foot: number, halfH: number, clear: number, far: boolean): PlateSpot {
  return far ? { s: top + clear + halfH, above: true } : { s: foot - clear - halfH, above: false };
}

/**
 * Screen clamp: given the plate's preferred spot and the room on screen
 * (in the same units: `screenTop` and `screenBottom` bound the visible,
 * HUD-free band), keep it where it is when it fits, else flip it to the
 * other side of the tower, else pin it to the edge it overflows.
 */
export function clampPlate(
  spot: PlateSpot,
  top: number,
  foot: number,
  halfH: number,
  clear: number,
  screenTop: number,
  screenBottom: number,
): PlateSpot {
  const fits = (s: number): boolean => s + halfH <= screenTop && s - halfH >= screenBottom;
  if (fits(spot.s)) return spot;
  const flipped = platePlacement(top, foot, halfH, clear, !spot.above);
  if (fits(flipped.s)) return flipped;
  const s = Math.min(screenTop - halfH, Math.max(screenBottom + halfH, spot.s));
  return { s, above: spot.above };
}

/** The gap in screen px between a plate and the tower part it clears. */
export function plateClearancePx(spot: PlateSpot, top: number, foot: number, halfH: number, pxPerUnit: number): number {
  return (spot.above ? spot.s - halfH - top : foot - (spot.s + halfH)) * pxPerUnit;
}

/** At least this many CSS px between a plate and the roofs or crew (at 390 px wide). */
export const PLATE_CLEAR_PX = 4;
