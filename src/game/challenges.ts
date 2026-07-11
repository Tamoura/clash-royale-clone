import { spawnUnits, type BattleState } from "./battle";
import type { CardId } from "./cards";

/** One scripted enemy deploy inside a challenge. */
export interface ChallengeWave {
  /** Battle time (seconds) at which the wave spawns. Must be > 0. */
  at: number;
  cardId: CardId;
  x: number;
  y: number;
}

/** A "defend this push" puzzle: survive the scripted waves. */
export interface Challenge {
  id: string;
  name: string;
  blurb: string;
  /** The fixed deck the player defends with. */
  deck: CardId[];
  /** Seconds to survive (all your towers standing) to win. */
  surviveFor: number;
  waves: ChallengeWave[];
  /** Gold granted the first time the challenge is beaten. */
  goldReward: number;
}

const L = 3.5; // left lane / bridge x
const R = 14.5; // right lane / bridge x

export const CHALLENGES: Challenge[] = [
  {
    id: "giant-trouble",
    name: "Giant Trouble",
    blurb: "Two giants, two lanes. Hold the towers for 45 seconds!",
    deck: [
      "knight",
      "archers",
      "mini-pekka",
      "musketeer",
      "cannon",
      "fireball",
      "skeletons",
      "arrows",
    ],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "giant", x: L, y: 10 },
      { at: 6, cardId: "musketeer", x: L, y: 12 },
      { at: 18, cardId: "giant", x: R, y: 10 },
      { at: 22, cardId: "archers", x: R, y: 12 },
      { at: 34, cardId: "knight", x: L, y: 11 },
    ],
    goldReward: 50,
  },
  {
    id: "air-raid",
    name: "Air Raid",
    blurb: "Balloons and dragons fill the sky. Shoot them down!",
    deck: [
      "musketeer",
      "archers",
      "wizard",
      "gargoyles",
      "knight",
      "arrows",
      "fireball",
      "cannon",
    ],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "balloon", x: R, y: 11 },
      { at: 10, cardId: "baby-dragon", x: R, y: 12 },
      { at: 20, cardId: "balloon", x: L, y: 11 },
      { at: 26, cardId: "minions", x: L, y: 12 },
      { at: 36, cardId: "gargoyles", x: R, y: 12 },
    ],
    goldReward: 50,
  },
  {
    id: "the-horde",
    name: "The Horde",
    blurb: "Wave after wave of little ones — splash them away!",
    deck: [
      "valkyrie",
      "wizard",
      "baby-dragon",
      "arrows",
      "zap",
      "knight",
      "archers",
      "fireball",
    ],
    surviveFor: 50,
    waves: [
      { at: 2, cardId: "skeleton-army", x: L, y: 11 },
      { at: 10, cardId: "bats", x: L, y: 12 },
      { at: 18, cardId: "hog-rider", x: R, y: 11 },
      { at: 26, cardId: "skeleton-army", x: R, y: 12 },
      { at: 36, cardId: "minions", x: L, y: 12 },
      { at: 42, cardId: "hog-rider", x: L, y: 11 },
    ],
    goldReward: 60,
  },
];

/**
 * Spawn every wave whose time has come. `cursor.next` is the index of the
 * first unspawned wave; calling again with the same cursor never
 * double-spawns.
 */
export function applyWaves(
  state: BattleState,
  ch: Challenge,
  cursor: { next: number },
): void {
  while (cursor.next < ch.waves.length && ch.waves[cursor.next].at <= state.time) {
    const w = ch.waves[cursor.next++];
    spawnUnits(state, "enemy", w.cardId, w.x, w.y);
  }
}

/** Lost the moment any of your towers falls; won once you survive long enough. */
export function challengeStatus(
  state: BattleState,
  ch: Challenge,
): "playing" | "won" | "lost" {
  const towers = state.entities.filter(
    (e) =>
      e.side === "player" &&
      (e.kind === "princess-tower" || e.kind === "king-tower"),
  );
  const lost =
    state.result?.winner === "enemy" ||
    towers.length < 3 ||
    towers.some((t) => t.hp <= 0);
  if (lost) return "lost";
  return state.time >= ch.surviveFor ? "won" : "playing";
}
