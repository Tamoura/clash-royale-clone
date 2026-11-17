/**
 * Challenge names and blurbs as the screen shows them. The challenge data
 * (src/game/challenges.ts) is part of the locked sim and still uses the
 * cards' first names; this layer swaps in each edition's display wording
 * (src/render/cardNames.ts), keyed by challenge id. The ids never change:
 * they are stored in 'cr-clone-challenges-done'.
 */
import type { Challenge } from "../game/challenges";
import { ARABIC } from "../render3d/theme";

interface ChallengeWords {
  name?: string;
  nameAr?: string;
  blurb?: string;
  blurbAr?: string;
}

const OVERRIDES: Readonly<Record<string, ChallengeWords>> = {
  "little-ones": {
    blurb: "Skeletons, Imps and Bats! Arrows and Zap sweep them up. Keep all 3 towers standing for 0:30!",
    blurbAr: "مشاة وسرب صقور وخفافيش! وابل السهام ومسحوق الوميض يكنسانها. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٣٠!",
  },
  "the-horde": {
    blurb: "Wave after wave of little ones, and Boar Riders in between. Keep all 3 towers standing for 0:50!",
  },
  "hog-rush": {
    name: "Boar Rush",
    blurb: "Boar Riders charge a new lane every few seconds. Keep all 3 towers standing for 0:40!",
  },
  "sky-pirates": {
    blurb: "Three Balloons with Baby Dragons, Bats and Imps for a crew. Keep all 3 towers standing for 0:45!",
  },
  "mega-drop": {
    name: "Thunder Drop",
    blurb: "A Thunder Knight lands at 0:02, and another one later! Keep all 3 towers standing for 0:40!",
  },
  "bridge-spam": {
    name: "Bridge Rush",
    blurb: "Prince, Boar Rider and Little Steel Guard rush both bridges. Keep all 3 towers standing for 0:45!",
  },
  "witch-party": {
    blurbAr: "خمس قارعات طبول يستنفرن المشاة. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٥!",
  },
  "skeleton-storm": {
    nameAr: "عاصفة المشاة",
    blurb: "Four Bone Swarms, one after another, and Bats too. Keep all 3 towers standing for 0:40!",
    blurbAr: "أربعة حشود من المشاة، واحد تلو الآخر، ومعها الخفافيش. حافظ على أبراجك الثلاثة صامدة لمدة ٠:٤٠!",
  },
  // The guided first battle: spells are حيل in the Golden Age edition.
  tutorial: {
    blurbAr: "تعلّم النشر والدفاع والحيل والفوز.",
  },
};

type Named = Pick<Challenge, "id" | "name" | "nameAr" | "blurb" | "blurbAr">;

/** The challenge's name in an edition (`arabic`: the Golden Age edition). */
export function challengeNameIn(ch: Named, arabic: boolean): string {
  const o = OVERRIDES[ch.id];
  return arabic ? (o?.nameAr ?? ch.nameAr) : (o?.name ?? ch.name);
}

/** The challenge's one-line blurb in an edition. */
export function challengeBlurbIn(ch: Named, arabic: boolean): string {
  const o = OVERRIDES[ch.id];
  return arabic ? (o?.blurbAr ?? ch.blurbAr) : (o?.blurb ?? ch.blurb);
}

/** The challenge's name in the edition being played. */
export const challengeName = (ch: Named): string => challengeNameIn(ch, ARABIC);

/** The challenge's blurb in the edition being played. */
export const challengeBlurb = (ch: Named): string => challengeBlurbIn(ch, ARABIC);
