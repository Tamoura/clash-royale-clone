import { describe, expect, it } from "vitest";
import { CHALLENGES, TRIAL_CHALLENGES } from "../game/challenges";
import { TUTORIAL_CHALLENGE } from "../game/challenges";
import { challengeBlurb, challengeBlurbIn, challengeName, challengeNameIn } from "./challengeText";

const ALL = [...CHALLENGES, ...TRIAL_CHALLENGES, TUTORIAL_CHALLENGE];

/** Old card and challenge names the screens must not show. */
const OLD_EN = /P\.?E\.?K\.?K\.?A|Hog Rider|Hog Rush|Mega Knight|Mega Drop|Minions|Skeleton Arm(y|ies)|Bridge Spam|elixir/i;
const OLD_AR = /ميليشيا|إكسير|تعاويذ|تعويذ|الكشّافة/;

describe("challenge text on screen", () => {
  it("never shows a replaced name, in either edition", () => {
    for (const ch of ALL) {
      expect(`${challengeNameIn(ch, false)} ${challengeBlurbIn(ch, false)}`, ch.id).not.toMatch(OLD_EN);
      expect(`${challengeNameIn(ch, true)} ${challengeBlurbIn(ch, true)}`, ch.id).not.toMatch(OLD_AR);
    }
  });

  it("renames by challenge id, and the ids (stored in saves) stay", () => {
    const byId = (id: string) => ALL.find((c) => c.id === id)!;
    expect(challengeNameIn(byId("hog-rush"), false)).toBe("Boar Rush");
    expect(challengeNameIn(byId("mega-drop"), false)).toBe("Thunder Drop");
    expect(challengeNameIn(byId("bridge-spam"), false)).toBe("Bridge Rush");
    expect(challengeNameIn(byId("skeleton-storm"), true)).toBe("عاصفة المشاة");
    expect(challengeBlurbIn(byId("bridge-spam"), false)).toContain("Boar Rider and Little Steel Guard");
    expect(challengeBlurbIn(byId("little-ones"), true)).toMatch(/^مشاة /);
    // The sim's data is untouched: the overrides live in this layer only.
    expect(byId("hog-rush").name).toBe("Hog Rush");
  });

  it("keeps the goal at the end of every blurb (the same seconds as the sim's)", () => {
    for (const ch of ALL) {
      if (ch.id === "tutorial") continue;
      const goal = /for (\d:\d\d)!$/.exec(ch.blurb)?.[1];
      expect(challengeBlurbIn(ch, false).endsWith(`for ${goal}!`), ch.id).toBe(true);
      expect(challengeBlurbIn(ch, true).slice(-6)).toBe(ch.blurbAr.slice(-6));
    }
  });

  it("the edition-bound helpers read the Golden Age text in Node", () => {
    expect(challengeName(CHALLENGES[0])).toBe(challengeNameIn(CHALLENGES[0], true));
    expect(challengeBlurb(CHALLENGES[0])).toBe(challengeBlurbIn(CHALLENGES[0], true));
  });
});
