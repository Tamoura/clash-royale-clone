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
  nameAr: string;
  blurb: string;
  blurbAr: string;
  /** The fixed deck the player defends with. */
  deck: CardId[];
  /** Seconds to survive (all your towers standing) to win. */
  surviveFor: number;
  waves: ChallengeWave[];
  /** Gold granted the first time the challenge is beaten. */
  goldReward: number;
  /** Scripted battles only: the opponent's King tower starts with this much HP. */
  enemyKingHp?: number;
}

const L = 3.5; // left lane / bridge x
const R = 14.5; // right lane / bridge x

export const CHALLENGES: Challenge[] = [
  {
    id: "giant-trouble",
    name: "Giant Trouble",
    nameAr: "ورطة العمالقة",
    blurb: "Two giants, two lanes. Hold the towers for 45 seconds!",
    blurbAr: "عملاقان في مسارين. احمِ أبراجك ٤٥ ثانية!",
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
    nameAr: "غارة جوية",
    blurb: "Balloons and dragons fill the sky. Shoot them down!",
    blurbAr: "المناطيد والتنانين تملأ السماء. أسقطها!",
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
    nameAr: "الحشد",
    blurb: "Wave after wave of little ones — splash them away!",
    blurbAr: "موجة تلو موجة من الصغار — اكتسحهم بالضربات الواسعة!",
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
 * The guided first battle (src/game/tutorial.ts drives it). It is not in
 * CHALLENGES, so it never shows in the Challenges list. Its waves are the
 * scripted lessons: a Giant to defend, then a cluster worth a Fireball.
 * The tutorial's held steps freeze the clock, so these times line up with
 * the lessons however long the player takes on each one.
 */
export const TUTORIAL_CHALLENGE: Challenge = {
  id: "tutorial",
  // Shown as the opponent's name in the battle's top bar.
  name: "Trainer",
  nameAr: "المدرّب",
  blurb: "Learn to deploy, defend, cast spells and win.",
  blurbAr: "تعلّم النشر والدفاع والتعاويذ والفوز.",
  deck: ["knight", "musketeer", "fireball", "giant", "archers", "mini-pekka", "arrows", "valkyrie"],
  // Never "won" by the clock: the tutorial ends when a King tower falls.
  surviveFor: 1e9,
  waves: [
    { at: 1, cardId: "giant", x: R, y: 12 },
    { at: 15, cardId: "archers", x: 4.2, y: 11 },
    { at: 15, cardId: "archers", x: 5.2, y: 11.6 },
  ],
  goldReward: 0,
  enemyKingHp: 1400,
};

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
