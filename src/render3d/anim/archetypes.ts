/**
 * How each unit fights and how heavy it moves: the attack archetype picks
 * the strike pose (a sword chop, a lance thrust, a whirling spin, a gun's
 * kick, a two-handed cast, an overhead slam), and the weight class scales
 * gait bounce and hit recoil. Pure data plus the attack-timing curve —
 * everything is derived from read-only sim fields, never written back.
 */
import type { CardId } from "../../game/cards";
import { SIM_DT } from "./interp";

export type AttackStyle = "chop" | "thrust" | "spin" | "shoot" | "cast" | "slam";
export type Weight = "light" | "medium" | "heavy";
/** Four-legged gait: trot (four-beat) or bound (front pair, then hind pair). */
export type QuadGait = "trot" | "bound";

export interface Archetype {
  attackStyle: AttackStyle;
  weight: Weight;
  /** Set for mounts and beasts that walk on four legs. */
  quad?: QuadGait;
}

const A = (attackStyle: AttackStyle, weight: Weight, quad?: QuadGait): Archetype =>
  quad ? { attackStyle, weight, quad } : { attackStyle, weight };

/** The default for anything without a better fit. */
export const DEFAULT_ARCHETYPE: Archetype = A("chop", "medium");
/** Princess archers, cannoneers and kings on the towers. */
export const TOWER_ARCHETYPE: Archetype = A("shoot", "medium");

/**
 * Every card. Spells never field a unit, but they get an entry so a card
 * lookup can never miss (and Mirror copies resolve to the copied card).
 */
export const ARCHETYPES: Readonly<Record<CardId, Archetype>> = {
  knight: A("chop", "medium"),
  archers: A("shoot", "light"),
  firecracker: A("shoot", "light"),
  "magic-archer": A("shoot", "light"),
  giant: A("slam", "heavy"),
  musketeer: A("shoot", "medium"),
  "mini-pekka": A("chop", "medium"),
  skeletons: A("chop", "light"),
  wizard: A("cast", "medium"),
  witch: A("cast", "medium"),
  "hog-rider": A("chop", "medium", "bound"),
  balloon: A("slam", "heavy"),
  "baby-dragon": A("shoot", "medium"),
  gargoyles: A("chop", "light"),
  bats: A("chop", "light"),
  minions: A("shoot", "light"),
  "skeleton-army": A("chop", "light"),
  executioner: A("shoot", "heavy"),
  "electro-wizard": A("cast", "medium"),
  "ice-wizard": A("cast", "medium"),
  princess: A("shoot", "light"),
  "mega-knight": A("slam", "heavy"),
  "royal-giant": A("shoot", "heavy"),
  valkyrie: A("spin", "medium"),
  prince: A("thrust", "medium", "trot"),
  pekka: A("slam", "heavy"),
  cannon: A("shoot", "heavy"),
  tombstone: A("chop", "heavy"),
  "elixir-collector": A("chop", "heavy"),
  // The default champion; fielded champions are derived from their own def.
  champion: A("chop", "medium"),
  fireball: A("cast", "light"),
  arrows: A("shoot", "light"),
  zap: A("cast", "light"),
  rage: A("cast", "light"),
  freeze: A("cast", "light"),
  heal: A("cast", "light"),
  tornado: A("cast", "light"),
  "skeleton-barrel": A("chop", "light"),
  mirror: A("cast", "light"),
};

/**
 * The Islamic edition reskins some cards with a different weapon: the
 * militia carry spears, the cataphract couches a kontos lance, the war
 * drummer beats a drum, and the giant is a war elephant.
 */
export const ISLAMIC_ARCHETYPES: Readonly<Partial<Record<CardId, Archetype>>> = {
  skeletons: A("thrust", "light"),
  "skeleton-army": A("thrust", "light"),
  pekka: A("thrust", "heavy", "trot"),
  witch: A("chop", "medium"),
  giant: A("slam", "heavy", "trot"),
  "hog-rider": A("chop", "medium", "bound"),
};

/** The stats of a fielded champion that decide how it fights. */
export interface ChampionStats {
  /** Attack range in tiles (melee is 0.8). */
  range: number;
  /** Max HP per unit. */
  hp: number;
}

/** A Studio champion: ranged builds shoot, beefy builds hit heavy. */
export function championArchetype(def: ChampionStats): Archetype {
  const weight: Weight = def.hp >= 2200 ? "heavy" : def.hp <= 500 ? "light" : "medium";
  if (def.range > 1.2) return A("shoot", weight);
  return A(weight === "heavy" ? "slam" : "chop", weight);
}

/** The archetype for a unit on the field. `cardId` null = a tower crew. */
export function archetypeFor(
  cardId: CardId | null,
  opts: { arabic?: boolean; champion?: ChampionStats } = {},
): Archetype {
  if (cardId === null) return TOWER_ARCHETYPE;
  if (cardId === "champion" && opts.champion) return championArchetype(opts.champion);
  if (opts.arabic) {
    const alt = ISLAMIC_ARCHETYPES[cardId];
    if (alt) return alt;
  }
  return ARCHETYPES[cardId] ?? DEFAULT_ARCHETYPE;
}

/**
 * Archetypes bound to a rig object, for call sites that animate a rig
 * without knowing its card (the tower crews). Weak: rigs are not kept alive.
 */
const RIG_ARCHETYPES = new WeakMap<object, Archetype>();

export function setRigArchetype(rig: object, arch: Archetype): void {
  RIG_ARCHETYPES.set(rig, arch);
}

export function rigArchetype(rig: object): Archetype | undefined {
  return RIG_ARCHETYPES.get(rig);
}

/** Seconds the blow takes after it lands (the follow-through). */
export const STRIKE_TIME = 0.12;
/**
 * A whirl needs longer to read as one full turn: at 0.12 s a 360° spin
 * covers 90° per frame on a 30 fps phone and aliases into a wobble.
 */
export const SPIN_STRIKE_TIME = 0.24;
/** Seconds the arm takes to return to the ready stance after the strike. */
export const RECOVER_TIME = 0.2;
/** Longest anticipation any unit shows. */
export const MAX_WINDUP = 0.45;

/**
 * Anticipation length: 30% of the time between blows, capped, so a fast
 * stabber flicks and a slow bruiser heaves. Never overlaps the strike.
 */
export function windupTime(hitSpeed: number): number {
  return Math.max(0, Math.min(MAX_WINDUP, 0.3 * hitSpeed, hitSpeed - STRIKE_TIME - SIM_DT));
}

/** Where a unit is in its attack cycle this frame. */
export interface SwingPose {
  /** Anticipation 0..1: rises through the windup, holds at 1 on the last tick. */
  windup: number;
  /** Follow-through 1..0: 1 the instant the blow lands, decaying after. */
  strike: number;
  /** 1 between blows while a target is in reach (the ready stance), else 0. */
  ready: number;
  /** Seconds since the blow landed (Infinity when not attacking). */
  since: number;
  /** The legacy signed swing: negative = cocked back, positive = striking. */
  swing: number;
}

/** A fresh pose record (callers keep one per view and reuse it). */
export function newSwingPose(): SwingPose {
  return { windup: 0, strike: 0, ready: 0, since: Infinity, swing: 0 };
}

function smooth(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The attack curve from the sim's attack timer. After a blow lands the
 * timer is reset to `hitSpeed` and counts down; the next blow lands on the
 * tick it reaches 0. So `hitSpeed - cooldown` is the time since the last
 * blow, and the last `windupTime` seconds of the countdown are the
 * anticipation, which peaks one tick early and holds for that tick.
 *
 * `cooldown` may be pre-advanced by the frame's alpha for smoothness.
 * Writes into `out` (default: a shared scratch record) and returns it.
 */
export function attackSwing(
  cooldown: number,
  hitSpeed: number,
  engaged: boolean,
  style: AttackStyle = "chop",
  out: SwingPose = SCRATCH,
): SwingPose {
  out.windup = 0;
  out.strike = 0;
  out.ready = 0;
  out.since = Infinity;
  out.swing = 0;
  if (hitSpeed <= 0) return out;
  const cd = Math.max(0, cooldown);
  const since = hitSpeed - cd;
  const strikeTime = style === "spin" ? SPIN_STRIKE_TIME : STRIKE_TIME;
  if (since >= 0 && since < strikeTime + RECOVER_TIME) {
    out.since = since;
    if (since < strikeTime) {
      // Snap forward, then hang most of the way out: the hit reads.
      out.strike = 1 - 0.65 * (since / strikeTime);
    } else {
      out.strike = 0.35 * (1 - smooth((since - strikeTime) / RECOVER_TIME));
    }
    out.swing = out.strike;
    return out;
  }
  if (!engaged) return out;
  const w = windupTime(hitSpeed);
  if (w > 0 && cd < w) {
    // Reach the peak one tick before the blow and hold it there.
    const span = Math.max(1e-3, w - SIM_DT);
    const p = Math.min(1, (w - cd) / span);
    out.windup = 1 - (1 - p) * (1 - p); // ease-out into the held peak
    out.swing = -0.7 * out.windup;
    return out;
  }
  out.ready = 1;
  return out;
}

const SCRATCH: SwingPose = newSwingPose();
