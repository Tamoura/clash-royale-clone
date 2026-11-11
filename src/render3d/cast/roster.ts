/**
 * THE CAST ROSTER: the heavy half of the cast (variant tables, props, mounts,
 * the bake and the unit builder). It is a lazy chunk loaded with the pack
 * (loader.ts loadKitTroops), so none of it weighs on the first download; the
 * light facade in index.ts answers "no cast" until it is in.
 */
import * as THREE from "three";
import type { Side } from "../../game/arena";
import { ARABIC } from "../theme";
import { bakeVariant, type Baked } from "./bake";
import { castLoaded, sources } from "./loader";
import { joinSwarm } from "./animate";
import { makeUnit, type KitUnit } from "./unit";
import { CLASSIC } from "./variants.classic";
import { GOLDEN } from "./variants.golden";
import { championKey, championVariant } from "./champion";
import { loadChampion } from "../../game/customcard";
import type { Edition, Variant } from "./types";

export { setCastPalette } from "./bake";
export { animateMount } from "./mounts";

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

/** The cards (and crews) with a modelled character in an edition. */
export function kitTroopCards(edition: Edition = currentEdition()): string[] {
  const ids = Object.keys(edition === "golden" ? GOLDEN : CLASSIC);
  return variantOf("champion", edition) ? [...ids, "champion"] : ids;
}

