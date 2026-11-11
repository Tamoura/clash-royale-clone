/**
 * THE CAST: every humanoid unit, tower crew and humanoid card portrait is
 * a CC0 KayKit character (Kay Lousberg's Adventurers and Skeletons packs)
 * cut into a per-card VARIANT and baked to one inked skinned draw.
 *
 *   loader.ts            the pack (public/models/troops/), castReady / castActiveForBattle
 *   bake.ts              variant -> one skinned geometry + atlas + material (team uniforms)
 *   rules.ts             the team rule as data (cloth swatches, forbidden hues)
 *   props.ts             our own primitive props (crowns, braids, turbans, muskets...)
 *   variants.classic.ts  the Classic roster and crews
 *   variants.golden.ts   the Golden Age overlays and the edition's own humanoids
 *   mounts.ts            procedural horse, hog and camel for the riders
 *   animate.ts           clips, lean, swarms, hit react, death
 *   crew.ts              towerCrewProvider for the towers package
 */
import * as THREE from "three";
import type { Side } from "../../game/arena";
import { ARABIC } from "../theme";
import { bakeVariant, type Baked } from "./bake";
import { castLoaded, sources } from "./loader";
import { joinSwarm, leaveSwarm } from "./animate";
import { makeUnit, type KitUnit } from "./unit";
import { CLASSIC } from "./variants.classic";
import { GOLDEN } from "./variants.golden";
import { championKey, championVariant } from "./champion";
import { loadChampion } from "../../game/customcard";
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
export { setCastPalette, RIM_UNIFORM } from "./bake";

/** The edition this page runs (the cast can still be asked for the other, e.g. by the contact sheet). */
export function currentEdition(): Edition {
  return ARABIC ? "golden" : "classic";
}

/** A card's variant in an edition, or undefined (not humanoid / not modelled there). */
export function variantOf(cardId: string, edition: Edition = currentEdition()): Variant | undefined {
  if (cardId === "champion") return championVariant(loadChampion(), edition) ?? undefined;
  return edition === "golden" ? GOLDEN[cardId] : CLASSIC[cardId];
}

/** The bake cache key of a card (the champion bakes once per look). */
function bakeKey(cardId: string, edition: Edition): string {
  return cardId === "champion" ? championKey(loadChampion(), edition) : `${edition}:${cardId}`;
}

/** True when this card has a modelled character in the edition and the pack is in. */
export function hasKitTroop(cardId: string, edition: Edition = currentEdition()): boolean {
  return castLoaded() && variantOf(cardId, edition) !== undefined;
}

/** The baked geometry and atlas of a card (shared by every unit of it). */
export function bakedOf(cardId: string, edition: Edition = currentEdition()): Baked | null {
  const v = variantOf(cardId, edition);
  if (!castLoaded() || !v) return null;
  return bakeVariant(bakeKey(cardId, edition), v);
}

/**
 * A posed, animated unit of a card for a (viewer-relative) side, or null
 * without the pack or a variant. Field units of one card and side share
 * their pose once a swarm reaches SWARM_SHARE (`swarm` false: crews,
 * portraits, the ghost).
 */
export function makeKitTroop(cardId: string, team: Side, edition: Edition = currentEdition(), swarm = true): KitUnit | null {
  const v = variantOf(cardId, edition);
  if (!castLoaded() || !v) return null;
  const b = bakeVariant(bakeKey(cardId, edition), v);
  const u = makeUnit(cardId, v, b, sources.get(v.file)!, team, swarm ? `${edition}:${cardId}:${team}` : "");
  joinSwarm(u);
  return u;
}

/** The translucent deploy preview of a card's character (yours), or null without the pack. */
export function makeKitGhost(cardId: string, edition: Edition = currentEdition()): { group: KitUnit["group"]; height: number } | null {
  const unit = makeKitTroop(cardId, "player", edition, false);
  const b = bakedOf(cardId, edition);
  if (!unit || !b) return null;
  if (!b.ghost) {
    // The ink shell cannot blend: the ghost draws the body's index range only, over the same buffers.
    const ghost = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(b.geometry.attributes)) ghost.setAttribute(name, attr);
    ghost.setIndex(b.geometry.index);
    ghost.setDrawRange(0, b.bodyCount);
    ghost.boundingSphere = b.geometry.boundingSphere;
    ghost.userData.shared = true;
    b.ghost = ghost;
  }
  unit.mesh.geometry = b.ghost;
  const mat = unit.mesh.material as THREE.MeshToonMaterial;
  mat.transparent = true;
  mat.opacity = 0.55;
  mat.depthWrite = false;
  return { group: unit.group, height: unit.height };
}

/** Free a unit's bone texture and its swarm slot (its geometry and atlas are shared; disposeDeep frees its material). */
export function disposeKitTroop(u: KitUnit): void {
  leaveSwarm(u);
  u.mixer.stopAllAction();
  u.skeleton.dispose();
}

/** The cards (and crews) with a modelled character in an edition. */
export function kitTroopCards(edition: Edition = currentEdition()): string[] {
  const ids = Object.keys(edition === "golden" ? GOLDEN : CLASSIC);
  return variantOf("champion", edition) ? [...ids, "champion"] : ids;
}

