/**
 * Shared types of the modelled cast (src/render3d/cast/): the KayKit
 * character files, palette swatches, paints and the per-card VARIANT a
 * unit is baked from.
 */
import type * as THREE from "three";

/** Character files packed by tools/troop-pack.mjs into public/models/troops/. */
export const FILES = ["knight", "barbarian", "mage", "rogue", "rogue_hooded", "skeleton_minion"] as const;
export type FileId = (typeof FILES)[number];

/** Which edition's look a variant is for. */
export type Edition = "classic" | "golden";

/** A swatch of a character's palette: "column,row", column 0..7, row 0..3 (each is 1 x 2 cells of the 8 x 8 grid). */
export type Swatch = `${number},${number}`;

/**
 * What a swatch, mesh or primitive is painted with: a fixed signature
 * colour, or the unit's team shade (cloth only, see TEAM RULE in rules.ts).
 */
export type Paint = number | "team" | "teamDark";

/** A primitive prop of our own, skinned rigidly to one bone. */
export interface Extra {
  /** Bone it rides (BONES name). */
  bone: string;
  /** Geometry in the rig's rest-pose space, or in the bone's own space with `local`. */
  geo: () => THREE.BufferGeometry;
  local?: boolean;
  color: Paint;
  /** An open shell (a crown band, a hair fringe): both faces drawn, no ink shell (its inside would show as ink). */
  open?: boolean;
  /** Team paint is only allowed on cloth (a sash, tabard or mantle): say so. */
  cloth?: boolean;
  /** Not scaled with the head even when riding the head bone (default: head extras grow with the head). */
  fixed?: boolean;
}

/**
 * A card's character: which body, props, repaints and clips. Baked once per
 * card and edition into ONE skinned geometry with its ink shell.
 */
export interface Variant {
  file: FileId;
  /** Model scale on the field (the bodies are ~2.4 units tall at 1). */
  scale: number;
  /** Rigid props to wear, by node name; "file:Node" borrows another character's. */
  props: string[];
  /** Skinned body meshes to leave out (by name test). */
  drop?: RegExp;
  /** Meshes painted whole in the team colour: capes and cloaks only. */
  team?: RegExp;
  /** Palette swatches repainted (hair, robes, steel...). "team" only on the file's cloth swatches. */
  paint?: Partial<Record<Swatch, Paint>>;
  /** Paint for the swatches of a borrowed prop's palette (never team). */
  propPaint?: Partial<Record<Swatch, Paint>>;
  extras?: Extra[];
  /** Capes are cut to this share of their length (default CAPE_LENGTH). */
  cape?: number;
  /** Hats are narrowed about the head's axis by this factor (Mage_Hat only, default HAT_BRIM). */
  brim?: number;
  /** Body widened by this factor in x and z (the head keeps its size): the big guys. */
  girth?: number;
  /** Body below the neck stretched this much in height (the head rides up with it): giants stand tall, not round. */
  stretch?: number;
  /** Head scale about the neck (default HEAD_SCALE, 1.12). */
  headScale?: number;
  /**
   * Hair at the BACK of the head is repainted from this swatch (the hat or
   * hood's own): under a hat brim or a hood the packs' hair pokes out as a
   * "V" mark that reads as an emblem from behind.
   */
  hairBack?: Swatch;
  /** Skin tone (default SKIN, a warm peach). */
  skin?: number;
  idle: string;
  walk: string;
  attack: string;
  /** Where in the attack clip the blow lands (0..1). */
  strike: number;
  /**
   * At least two silhouette features that read from BEHIND (how you see
   * your own troops): documentation the coverage test checks for.
   */
  back: string[];
}
