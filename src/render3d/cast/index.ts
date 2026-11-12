/**
 * THE CAST: every humanoid unit, tower crew and humanoid card portrait is
 * a CC0 KayKit character (Kay Lousberg's Adventurers and Skeletons packs)
 * cut into a per-card VARIANT and baked to one inked skinned draw.
 *
 *   loader.ts            the pack (public/models/troops/), castReady / castActiveForBattle
 *   roster.ts            the heavy half (lazy chunk, loaded with the pack): variants, bake, units
 *   bake.ts              variant -> one skinned geometry + atlas + material (team uniforms)
 *   rules.ts             the team rule as data (cloth swatches, forbidden hues)
 *   props.ts             our own primitive props (crowns, braids, turbans, muskets...)
 *   variants.classic.ts  the Classic roster and crews
 *   variants.golden.ts   the Golden Age overlays and the edition's own humanoids
 *   mounts.ts            procedural horse, hog and camel for the riders
 *   animate.ts           clips, lean, swarms, hit react, death
 *   crew.ts              towerCrewProvider for the towers package
 *
 * This file is the light facade the rest of the game imports: until the
 * pack and its roster chunk are in, it answers "no cast" (no variant, no
 * unit, no portrait), exactly as when the pack failed.
 */
import type { Side } from "../../game/arena";
import type { TeamPalette } from "../../ui/prefs";
import { ARABIC } from "../theme";
import { leaveSwarm } from "./animate";
import { castRoster } from "./loader";
import type { Baked } from "./bake";
import type { KitUnit } from "./unit";
import type { Edition, Variant } from "./types";

export type { KitUnit } from "./unit";
export type { Edition, Variant } from "./types";
export type { KitPose } from "./animate";
export {
  animateKitTroop,
  leanQuaternion,
  setLeanCamera,
  startKitDeath,
  stepKitDeath,
  LEAN,
  LEAN_DEG,
  VIEW_DIR,
} from "./animate";
export { beginCastBattle, castActiveForBattle, castLoaded, castReady, kitTroopsWanted, loadKitTroops } from "./loader";
export { RIM_UNIFORM } from "../look/material";

/** The edition this page runs (the cast can still be asked for the other, e.g. by the contact sheet). */
export function currentEdition(): Edition {
  return ARABIC ? "golden" : "classic";
}

/** A card's variant in an edition, or undefined (not humanoid / not modelled there, or the roster is not in yet). */
export function variantOf(cardId: string, edition: Edition = currentEdition()): Variant | undefined {
  return castRoster()?.variantOf(cardId, edition);
}

/** True when this card has a modelled character in the edition and the pack is in. */
export function hasKitTroop(cardId: string, edition: Edition = currentEdition()): boolean {
  return castRoster()?.hasKitTroop(cardId, edition) ?? false;
}

/** The baked geometry and atlas of a card (shared by every unit of it). */
export function bakedOf(cardId: string, edition: Edition = currentEdition()): Baked | null {
  return castRoster()?.bakedOf(cardId, edition) ?? null;
}

/**
 * A posed, animated unit of a card for a (viewer-relative) side, or null
 * without the pack or a variant (see roster.ts makeKitTroop).
 */
export function makeKitTroop(cardId: string, team: Side, edition: Edition = currentEdition(), swarm = true): KitUnit | null {
  return castRoster()?.makeKitTroop(cardId, team, edition, swarm) ?? null;
}

/** The translucent deploy preview of a card's character (yours), or null without the pack. */
export function makeKitGhost(cardId: string, edition: Edition = currentEdition()): { group: KitUnit["group"]; height: number } | null {
  return castRoster()?.makeKitGhost(cardId, edition) ?? null;
}

/** Repaint every cast unit for a team palette (a no-op until the roster is in: it reads the pref when it lands). */
export function setCastPalette(palette: TeamPalette): void {
  castRoster()?.setCastPalette(palette);
}

/** Free a unit's bone texture and its swarm slot (its geometry and atlas are shared; disposeDeep frees its material). */
export function disposeKitTroop(u: KitUnit): void {
  leaveSwarm(u);
  u.mixer.stopAllAction();
  u.skeleton.dispose();
}

/** The cards (and crews) with a modelled character in an edition (none until the roster is in). */
export function kitTroopCards(edition: Edition = currentEdition()): string[] {
  return castRoster()?.kitTroopCards(edition) ?? [];
}
