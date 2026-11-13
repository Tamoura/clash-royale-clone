import { describe, expect, it } from "vitest";
import { on } from "../app/hooks";
import { memoryKV } from "../meta/kv";
import { applyMatchResult, loadProfile, type PlayerProfile } from "../meta/progress";
import { markMatchStart, readMarker, takeLeftMatch } from "./leftMatch";
import { leaveAfterGlitch, stopOnlineAfterGlitch } from "./noContest";
import { currentStreak } from "./rewards";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

/** What the next boot does with a leftover marker (main.ts settleLeftMatch, minus the lock probe). */
function nextBoot(kv: ReturnType<typeof memoryKV>, profile: PlayerProfile): PlayerProfile {
  const left = takeLeftMatch(kv, NOW + 60_000);
  return left ? applyMatchResult(profile, "enemy", NOW).profile : profile;
}

function profileWith(trophies: number): PlayerProfile {
  return { ...loadProfile(memoryKV()), trophies };
}

describe("Back to menu after a glitch is no contest", () => {
  it("(sanity) a ladder match left any other way settles as a loss on the next boot", () => {
    const kv = memoryKV();
    markMatchStart(kv, NOW, 500);
    expect(nextBoot(kv, profileWith(500)).trophies).toBeLessThan(500);
  });

  it("leaves trophies, the streak and every counter untouched, now and on the next boot", () => {
    const kv = memoryKV();
    markMatchStart(kv, NOW, 500);
    const profile = profileWith(500);
    const before = JSON.stringify(profile);
    const streakBefore = { ...currentStreak() };
    const ends: unknown[] = [];
    const off = on("matchEnd", (m) => void ends.push(m)); // auto difficulty, quests, achievements listen here
    const steps: string[] = [];
    leaveAfterGlitch({
      kv,
      releaseLiveMatch: () => void steps.push("release"),
      dismissHud: () => void steps.push("dismiss"),
      openHome: () => void steps.push("home"),
    });
    off();
    expect(steps).toEqual(["release", "dismiss", "home"]);
    expect(readMarker(kv)).toBeNull(); // nothing left for the next boot to charge
    expect(JSON.stringify(nextBoot(kv, profile))).toBe(before);
    expect(currentStreak()).toEqual(streakBefore);
    expect(ends).toEqual([]);
  });

  it("still goes Home when an earlier step throws (it runs because something already broke)", () => {
    const reported: string[] = [];
    let home = false;
    leaveAfterGlitch({
      kv: null,
      releaseLiveMatch: () => {
        throw new Error("lock gone");
      },
      dismissHud: () => {
        throw new Error("hud broken");
      },
      openHome: () => {
        home = true;
      },
      report: (what) => void reported.push(what),
    });
    expect(home).toBe(true);
    expect(reported).toEqual(["release the live match", "close the battle screens"]);
  });
});

describe("an online glitch stops the match as no contest on this device", () => {
  it("says paused first (the friend reads 'left', not 'gave up'), then leaves", () => {
    const calls: string[] = [];
    stopOnlineAfterGlitch({ setPaused: (p) => void calls.push(`paused:${p}`) }, () => void calls.push("leave"));
    expect(calls).toEqual(["paused:true", "leave"]);
  });

  it("leaves even if the pause can't be sent", () => {
    let left = false;
    stopOnlineAfterGlitch(
      {
        setPaused: () => {
          throw new Error("socket gone");
        },
      },
      () => {
        left = true;
      },
    );
    expect(left).toBe(true);
  });
});
