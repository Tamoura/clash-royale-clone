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
  /** One line that ends with the goal, e.g. "Keep all 3 towers standing for 0:45!". */
  blurb: string;
  blurbAr: string;
  /** The fixed deck the player defends with. */
  deck: CardId[];
  /** Seconds to survive (all your towers standing) to win. */
  surviveFor: number;
  /** Troop waves only: spawnUnits throws for buildings and spells. */
  waves: ChallengeWave[];
  /** Gold granted the first time the challenge is beaten. */
  goldReward: number;
  /** How hard it is, 1 (a gentle starter) to 3; unset reads as 2. */
  stars?: 1 | 2 | 3;
  /** Scripted battles only: the opponent's King tower starts with this much HP. */
  enemyKingHp?: number;
}

const L = 3.5; // left lane / bridge x
const R = 14.5; // right lane / bridge x

/**
 * The listed puzzles: three one-star starters first, then the rest. The
 * Challenges screen sorts by stars (stable), so starters always lead.
 * Waves spawn on the enemy half (y < RIVER_Y) and march on the player.
 */
export const CHALLENGES: Challenge[] = [
  {
    id: "first-defense",
    name: "First Defense",
    nameAr: "الدفاع الأول",
    blurb: "A Knight, then a Giant. Keep all 3 towers standing for 0:30!",
    blurbAr: "فارس ثم عملاق. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٣٠!",
    deck: ["knight", "archers", "musketeer", "mini-pekka", "cannon", "fireball", "arrows", "skeletons"],
    surviveFor: 30,
    waves: [
      { at: 2, cardId: "knight", x: L, y: 11 },
      { at: 12, cardId: "giant", x: R, y: 10 },
    ],
    goldReward: 30,
    stars: 1,
  },
  {
    id: "little-ones",
    name: "Little Ones",
    nameAr: "الصغار",
    blurb: "Skeletons, Minions and Bats! Arrows and Zap sweep them up. Keep all 3 towers standing for 0:30!",
    blurbAr: "هياكل وتوابع وخفافيش! السهام والصاعقة تكنسها. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٣٠!",
    deck: ["arrows", "zap", "knight", "archers", "musketeer", "valkyrie", "baby-dragon", "fireball"],
    surviveFor: 30,
    waves: [
      { at: 2, cardId: "skeletons", x: L, y: 12 },
      { at: 9, cardId: "minions", x: R, y: 12 },
      { at: 17, cardId: "bats", x: L, y: 12 },
    ],
    goldReward: 30,
    stars: 1,
  },
  {
    id: "tank-stop",
    name: "Tank Stop",
    nameAr: "أوقف الدبابة",
    blurb: "A Giant with Archers behind him. Keep all 3 towers standing for 0:35!",
    blurbAr: "عملاق ورماة خلفه. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٣٥!",
    deck: ["mini-pekka", "knight", "musketeer", "archers", "cannon", "fireball", "arrows", "skeletons"],
    surviveFor: 35,
    waves: [
      { at: 2, cardId: "giant", x: L, y: 10 },
      { at: 5, cardId: "archers", x: L, y: 12 },
    ],
    goldReward: 40,
    stars: 1,
  },
  {
    id: "giant-trouble",
    name: "Giant Trouble",
    nameAr: "ورطة العمالقة",
    blurb: "Two giants, two lanes. Keep all 3 towers standing for 0:45!",
    blurbAr: "عملاقان في مسارين. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
    deck: ["knight", "archers", "mini-pekka", "musketeer", "cannon", "fireball", "skeletons", "arrows"],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "giant", x: L, y: 10 },
      { at: 6, cardId: "musketeer", x: L, y: 12 },
      { at: 18, cardId: "giant", x: R, y: 10 },
      { at: 22, cardId: "archers", x: R, y: 12 },
      { at: 34, cardId: "knight", x: L, y: 11 },
    ],
    goldReward: 70,
    stars: 3,
  },
  {
    id: "air-raid",
    name: "Air Raid",
    nameAr: "غارة جوية",
    blurb: "Balloons and dragons fill the sky. Keep all 3 towers standing for 0:45!",
    blurbAr: "المناطيد والتنانين تملأ السماء. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
    deck: ["musketeer", "archers", "wizard", "gargoyles", "knight", "arrows", "fireball", "cannon"],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "balloon", x: R, y: 11 },
      { at: 10, cardId: "baby-dragon", x: R, y: 12 },
      { at: 20, cardId: "balloon", x: L, y: 11 },
      { at: 26, cardId: "minions", x: L, y: 12 },
      { at: 36, cardId: "gargoyles", x: R, y: 12 },
    ],
    goldReward: 50,
    stars: 2,
  },
  {
    id: "the-horde",
    name: "The Horde",
    nameAr: "الحشد",
    blurb: "Wave after wave of little ones. Keep all 3 towers standing for 0:50!",
    blurbAr: "موجة تلو موجة من الصغار. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٥٠!",
    deck: ["valkyrie", "wizard", "baby-dragon", "arrows", "zap", "knight", "archers", "fireball"],
    surviveFor: 50,
    waves: [
      { at: 2, cardId: "skeleton-army", x: L, y: 11 },
      { at: 10, cardId: "bats", x: L, y: 12 },
      { at: 18, cardId: "hog-rider", x: R, y: 11 },
      { at: 26, cardId: "skeleton-army", x: R, y: 12 },
      { at: 36, cardId: "minions", x: L, y: 12 },
      { at: 42, cardId: "hog-rider", x: L, y: 11 },
    ],
    goldReward: 70,
    stars: 3,
  },
  {
    id: "hog-rush",
    name: "Hog Rush",
    nameAr: "اندفاع الخيّالة",
    blurb: "Hog Riders charge a new lane every 6 seconds. Keep all 3 towers standing for 0:40!",
    blurbAr: "خيّالة يندفعون في مسار جديد كل ٦ ثوانٍ. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٠!",
    deck: ["cannon", "tombstone", "mini-pekka", "knight", "skeletons", "musketeer", "zap", "valkyrie"],
    surviveFor: 40,
    waves: [
      { at: 2, cardId: "hog-rider", x: L, y: 11 },
      { at: 8, cardId: "hog-rider", x: R, y: 11 },
      { at: 14, cardId: "hog-rider", x: L, y: 11 },
      { at: 20, cardId: "hog-rider", x: R, y: 11 },
      { at: 26, cardId: "hog-rider", x: L, y: 11 },
    ],
    goldReward: 50,
    stars: 2,
  },
  {
    id: "sky-pirates",
    name: "Sky Pirates",
    nameAr: "قراصنة السماء",
    blurb: "A Balloon with Bats and Minions for a crew. Keep all 3 towers standing for 0:45!",
    blurbAr: "منطاد يرافقه طاقم من الخفافيش والتوابع. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
    deck: ["musketeer", "archers", "wizard", "baby-dragon", "arrows", "zap", "gargoyles", "knight"],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "bats", x: R, y: 12 },
      { at: 4, cardId: "balloon", x: R, y: 10 },
      { at: 18, cardId: "minions", x: L, y: 12 },
      { at: 26, cardId: "balloon", x: L, y: 10 },
      { at: 28, cardId: "bats", x: L, y: 12 },
    ],
    goldReward: 50,
    stars: 2,
  },
  {
    id: "mega-drop",
    name: "Mega Drop",
    nameAr: "الهبوط الكبير",
    blurb: "A Mega Knight lands at 0:02! Keep all 3 towers standing for 0:40!",
    blurbAr: "فارس عملاق يهبط عند ٠:٠٢! حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٠!",
    deck: ["pekka", "mini-pekka", "skeleton-army", "knight", "cannon", "musketeer", "fireball", "zap"],
    surviveFor: 40,
    waves: [
      { at: 2, cardId: "mega-knight", x: R, y: 10 },
      { at: 20, cardId: "musketeer", x: L, y: 12 },
      { at: 26, cardId: "knight", x: L, y: 11 },
    ],
    goldReward: 60,
    stars: 2,
  },
  {
    id: "bridge-spam",
    name: "Bridge Spam",
    nameAr: "زحمة الجسور",
    blurb: "Prince, Hog Rider and Mini P.E.K.K.A rush both bridges. Keep all 3 towers standing for 0:45!",
    blurbAr: "أمير وخيّال وبيكا صغير يندفعون على الجسرين. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
    deck: ["knight", "skeletons", "cannon", "tombstone", "valkyrie", "musketeer", "zap", "fireball"],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "prince", x: L, y: 11 },
      { at: 7, cardId: "hog-rider", x: R, y: 11 },
      { at: 14, cardId: "mini-pekka", x: L, y: 12 },
      { at: 22, cardId: "prince", x: R, y: 11 },
      { at: 28, cardId: "hog-rider", x: L, y: 11 },
      { at: 35, cardId: "mini-pekka", x: R, y: 12 },
    ],
    goldReward: 80,
    stars: 3,
  },
  {
    id: "witch-party",
    name: "Witch Party",
    nameAr: "حفلة الساحرات",
    blurb: "Two Witches and all their Skeletons. Keep all 3 towers standing for 0:45!",
    blurbAr: "ساحرتان ومعهما هياكلهما. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
    deck: ["valkyrie", "fireball", "arrows", "knight", "musketeer", "mini-pekka", "baby-dragon", "zap"],
    surviveFor: 45,
    waves: [
      { at: 2, cardId: "knight", x: L, y: 11 },
      { at: 4, cardId: "witch", x: L, y: 13 },
      { at: 20, cardId: "knight", x: R, y: 11 },
      { at: 22, cardId: "witch", x: R, y: 13 },
    ],
    goldReward: 60,
    stars: 2,
  },
  {
    id: "skeleton-storm",
    name: "Skeleton Storm",
    nameAr: "عاصفة الهياكل",
    blurb: "Three Skeleton Armies, one after another. Keep all 3 towers standing for 0:40!",
    blurbAr: "ثلاثة جيوش من الهياكل، واحد تلو الآخر. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٠!",
    deck: ["valkyrie", "wizard", "arrows", "zap", "knight", "musketeer", "baby-dragon", "fireball"],
    surviveFor: 40,
    waves: [
      { at: 2, cardId: "skeleton-army", x: L, y: 11 },
      { at: 12, cardId: "skeleton-army", x: R, y: 11 },
      { at: 22, cardId: "skeleton-army", x: L, y: 11 },
    ],
    goldReward: 60,
    stars: 2,
  },
];

/** A challenge's difficulty, 1-3 (unset reads as 2). */
export function challengeStars(ch: Challenge): 1 | 2 | 3 {
  return ch.stars ?? 2;
}

/** The listed challenges easiest first; ties keep their CHALLENGES order. */
export function sortedByStars(list: readonly Challenge[]): Challenge[] {
  return list
    .map((ch, i) => ({ ch, i }))
    .sort((a, b) => challengeStars(a.ch) - challengeStars(b.ch) || a.i - b.i)
    .map((x) => x.ch);
}

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
