import type { CardId } from "../game/cards";

export interface SpawnRecipe {
  kind: "rise" | "drop" | "slam";
  color: number;
  burst: number;
}

/**
 * How a troop enters the field: necromantic summons rise out of
 * the ground, the Mega Knight slams down from the sky, and
 * everyone else drops in from just above and lands with a squash.
 */
export function spawnStyle(cardId: CardId | null): "rise" | "drop" | "slam" {
  return spawnRecipe(cardId).kind;
}

/** Data-only deploy flourish; never feeds back into simulation state. */
export function spawnRecipe(cardId: CardId | null): SpawnRecipe {
  if (cardId === "skeletons" || cardId === "skeleton-army") {
    return { kind: "rise", color: 0x76ff03, burst: 0.75 };
  }
  if (cardId === "mega-knight") {
    return { kind: "slam", color: 0xf6c14e, burst: 1.8 };
  }
  if (cardId === "electro-wizard") {
    return { kind: "drop", color: 0x76e6ff, burst: 0.85 };
  }
  if (cardId === "witch") {
    return { kind: "drop", color: 0xb98bff, burst: 0.75 };
  }
  // The Digger climbs out of the hole it dug (after its tunnel, see burrow.ts).
  if (cardId === "digger") {
    return { kind: "rise", color: 0xa88a64, burst: 0.7 };
  }
  if (cardId === "stone-golem") {
    return { kind: "drop", color: 0xc8beac, burst: 1.1 };
  }
  return { kind: "drop", color: 0xd9cdb8, burst: 0.45 };
}

/** Drop-in: height (tiles) a unit falls from. */
export const DROP_HEIGHT = 2.2;
/** Seconds of the ease-in fall. */
export const DROP_FALL = 0.22;
/** Seconds of the elastic settle after the landing squash. */
export const DROP_SETTLE = 0.18;
/** Swarm units land one after another, this far apart... */
export const DROP_STAGGER = 0.045;
/** ...but the last one never waits longer than this. */
export const DROP_STAGGER_CAP = 0.6;

/**
 * Seconds unit `index` of a deploy group waits before it starts falling.
 * The stagger stays inside the deploy freeze: every unit has landed by the
 * time its `deployTimer` runs out and it may act.
 */
export function dropDelay(index: number, deployTimer: number): number {
  const stagger = Math.min(Math.max(0, index) * DROP_STAGGER, DROP_STAGGER_CAP);
  return Math.max(0, Math.min(stagger, deployTimer - DROP_FALL));
}

/** Total seconds a drop-in entrance lasts. */
export function dropDuration(delay: number): number {
  return delay + DROP_FALL + DROP_SETTLE;
}

/** The drop-in pose at one instant. */
export interface DropPose {
  /** False while the unit waits for its turn in the stagger. */
  visible: boolean;
  /** Height above its resting place. */
  y: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Pose `t` seconds after the unit appeared: hidden through its stagger,
 * a stretched ease-in fall, then a squash (1.25, 0.7, 1.25) on landing that
 * springs back through a damped wobble. Writes into `out`.
 */
export function dropPose(t: number, delay: number, out: DropPose): DropPose {
  out.visible = t >= delay;
  out.y = 0;
  out.sx = out.sy = out.sz = 1;
  if (t < delay) {
    out.y = DROP_HEIGHT;
    return out;
  }
  const f = (t - delay) / DROP_FALL;
  if (f < 1) {
    out.y = DROP_HEIGHT * (1 - f * f);
    out.sx = out.sz = 0.85;
    out.sy = 1.2;
    return out;
  }
  const s = (t - delay - DROP_FALL) / DROP_SETTLE;
  if (s < 1) {
    // Damped spring from the landing squash back to rest.
    const d = (1 - s) * (1 - s) * Math.cos(s * Math.PI * 2.5);
    out.sx = out.sz = 1 + 0.25 * d;
    out.sy = 1 - 0.3 * d;
  }
  return out;
}

/** Pop-out (a Pebble Golem bursting from its Stone Golem): a beat inside the rubble... */
export const POP_DELAY = 0.12;
/** ...then a hop of this many seconds from the parent's middle to its own spot... */
export const POP_TIME = 0.42;
/** ...peaking this high (tiles), launched from this height inside the parent. */
export const POP_HEIGHT = 1.3;
export const POP_START = 0.9;

/** The pop-out pose: a drop pose plus how far along the hop the unit is (0..1). */
export interface PopPose extends DropPose {
  f: number;
}

/** Total seconds a pop-out entrance lasts. */
export function popDuration(): number {
  return POP_DELAY + POP_TIME + DROP_SETTLE;
}

/**
 * Pose `t` seconds after the unit appeared: hidden while the parent
 * crumbles, a stretched hop out along a parabola (f runs 0 to 1 across it),
 * then the drop's landing squash and wobble. Writes into `out`.
 */
export function popPose(t: number, out: PopPose): PopPose {
  out.visible = t >= POP_DELAY;
  out.sx = out.sy = out.sz = 1;
  if (t < POP_DELAY) {
    out.f = 0;
    out.y = POP_START;
    return out;
  }
  const f = (t - POP_DELAY) / POP_TIME;
  if (f < 1) {
    out.f = f;
    out.y = POP_START * (1 - f) + POP_HEIGHT * 4 * f * (1 - f);
    out.sx = out.sz = 0.88;
    out.sy = 1.16;
    return out;
  }
  out.f = 1;
  out.y = 0;
  const s = (t - POP_DELAY - POP_TIME) / DROP_SETTLE;
  if (s < 1) {
    const d = (1 - s) * (1 - s) * Math.cos(s * Math.PI * 2.5);
    out.sx = out.sz = 1 + 0.25 * d;
    out.sy = 1 - 0.3 * d;
  }
  return out;
}
