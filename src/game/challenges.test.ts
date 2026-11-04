import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, RIVER_Y } from "./arena";
import { createBattle, isValidDeck } from "./battle";
import { createBot, tickBot } from "./bot";
import { CARDS } from "./cards";
import {
  CHALLENGES,
  TUTORIAL_CHALLENGE,
  applyWaves,
  challengeStars,
  challengeStatus,
  sortedByStars,
  type Challenge,
} from "./challenges";
import { formatTime } from "../ui/i18n";
import { DIFFICULTIES } from "../match/difficulty";
import { tick } from "./sim";

describe("challenge definitions", () => {
  it("ships twelve: three one-star starters, then Giant Trouble", () => {
    expect(CHALLENGES).toHaveLength(12);
    expect(CHALLENGES.slice(0, 4).map((c) => c.id)).toEqual(["first-defense", "little-ones", "tank-stop", "giant-trouble"]);
    for (const c of CHALLENGES.slice(0, 3)) expect(c.stars).toBe(1);
    for (const id of ["air-raid", "the-horde", "hog-rush", "sky-pirates", "bridge-spam", "mega-drop", "witch-party", "skeleton-storm"]) {
      expect(CHALLENGES.some((c) => c.id === id)).toBe(true);
    }
  });

  it("every challenge has names, a goal blurb, stars and 30-80 gold", () => {
    for (const ch of CHALLENGES) {
      expect(ch.name.length).toBeGreaterThan(0);
      expect(ch.nameAr).toMatch(/[\u0600-\u06FF]/);
      // The blurb states the goal in the edition's own digits.
      expect(ch.blurb).toContain(`Keep all 3 towers standing for ${formatTime(ch.surviveFor, false)}!`);
      expect(ch.blurbAr).toContain(formatTime(ch.surviveFor, true));
      expect(ch.blurbAr).toMatch(/[\u0600-\u06FF]/);
      expect([1, 2, 3]).toContain(ch.stars);
      expect(ch.goldReward).toBeGreaterThanOrEqual(30);
      expect(ch.goldReward).toBeLessThanOrEqual(80);
    }
  });

  // Arabic shows only in the Golden Age edition, which renames the cards
  // (src/render/cardNames.ts) and has no sorcery, undead or tanks.
  it("Arabic text uses Golden Age names: no witches, skeletons, giants or tanks", () => {
    const CLASSIC_WORDS =
      /ساحر|سحر|هيكل|هياكل|عملاق|عمالقة|دبابة|منطاد|مناطيد|تنين|تنانين|خيّال|خيال|توابع|بيكا|صاعقة/;
    for (const ch of [...CHALLENGES, TUTORIAL_CHALLENGE]) {
      expect(ch.nameAr, ch.id).not.toMatch(CLASSIC_WORDS);
      expect(ch.blurbAr, ch.id).not.toMatch(CLASSIC_WORDS);
    }
    const byId = (id: string) => CHALLENGES.find((c) => c.id === id)!;
    expect(byId("witch-party").nameAr).toContain("الطبول"); // witch: قارعة الطبول
    expect(byId("skeleton-storm").nameAr).toContain("الميليشيا"); // skeletons: ميليشيا
    expect(byId("tank-stop").nameAr).toContain("فيل الحرب"); // giant: فيل الحرب
    expect(byId("mega-drop").blurbAr).toContain("أمير المماليك"); // mega-knight
    expect(byId("little-ones").blurbAr).toContain("وابل السهام"); // arrows
    expect(byId("little-ones").blurbAr).toContain("مسحوق الوميض"); // zap
  });

  it("sorts easiest first, keeping the list order within a star", () => {
    const sorted = sortedByStars(CHALLENGES);
    expect(sorted).toHaveLength(CHALLENGES.length);
    for (let i = 1; i < sorted.length; i++) {
      expect(challengeStars(sorted[i])).toBeGreaterThanOrEqual(challengeStars(sorted[i - 1]));
      if (challengeStars(sorted[i]) === challengeStars(sorted[i - 1])) {
        expect(CHALLENGES.indexOf(sorted[i])).toBeGreaterThan(CHALLENGES.indexOf(sorted[i - 1]));
      }
    }
    expect(sorted.slice(0, 3).map((c) => c.id)).toEqual(["first-defense", "little-ones", "tank-stop"]);
    // An unrated challenge (e.g. a later trial) sits with the two-stars.
    const unrated = { ...CHALLENGES[0], id: "trial", stars: undefined };
    expect(challengeStars(unrated)).toBe(2);
  });

  it("every challenge is well-formed", () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(CHALLENGES.map((c) => c.id));
    expect(ids.size).toBe(CHALLENGES.length);
    for (const ch of CHALLENGES) {
      expect(isValidDeck(ch.deck)).toBe(true);
      expect(ch.surviveFor).toBeGreaterThan(0);
      expect(ch.goldReward).toBeGreaterThan(0);
      for (const w of ch.waves) {
        expect(CARDS[w.cardId]).toBeDefined();
        // Troop waves only: spawnUnits throws for buildings and spells.
        expect(CARDS[w.cardId].kind).toBe("troop");
        expect(w.at).toBeGreaterThanOrEqual(0);
        expect(w.at).toBeLessThan(ch.surviveFor);
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x).toBeLessThanOrEqual(ARENA_WIDTH);
        // Waves spawn on the enemy half and march on the player.
        expect(w.y).toBeLessThan(RIVER_Y);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.y).toBeLessThanOrEqual(ARENA_HEIGHT);
      }
    }
  });
});

describe("tutorial challenge", () => {
  it("stays out of the Challenges list", () => {
    expect(CHALLENGES).not.toContain(TUTORIAL_CHALLENGE);
    expect(CHALLENGES.some((c) => c.id === TUTORIAL_CHALLENGE.id)).toBe(false);
  });

  it("is well-formed: a legal deck, enemy-half waves, a weakened King", () => {
    const ch = TUTORIAL_CHALLENGE;
    expect(isValidDeck(ch.deck)).toBe(true);
    for (const w of ch.waves) {
      expect(CARDS[w.cardId].kind).not.toBe("spell");
      expect(w.y).toBeLessThan(RIVER_Y);
      expect(w.at).toBeGreaterThan(0);
    }
    expect(ch.enemyKingHp).toBeGreaterThan(0);
    // Never won by the clock: only a fallen King ends the lesson.
    expect(ch.surviveFor).toBeGreaterThan(1e6);
  });
});

describe("challenge runtime", () => {
  const ch = CHALLENGES[0];

  it("spawns each wave once, when its time comes", () => {
    const b = createBattle(ch.deck, ch.deck);
    const cursor = { next: 0 };
    const troops = (): number =>
      b.entities.filter((e) => e.side === "enemy" && e.kind === "troop").length;

    applyWaves(b, ch, cursor);
    expect(troops()).toBe(0); // nothing due at t=0

    b.time = ch.waves[0].at + 0.01;
    applyWaves(b, ch, cursor);
    expect(troops()).toBeGreaterThan(0);
    const after = troops();
    // Re-applying at the same time must not double-spawn.
    applyWaves(b, ch, cursor);
    expect(troops()).toBe(after);

    // By the end of the script every wave has spawned exactly once.
    b.time = ch.surviveFor;
    applyWaves(b, ch, cursor);
    expect(cursor.next).toBe(ch.waves.length);
  });

  it("is 'playing' at the start, 'won' after surviving, 'lost' on tower fall", () => {
    const b = createBattle(ch.deck, ch.deck);
    tick(b, 1 / 30);
    expect(challengeStatus(b, ch)).toBe("playing");

    b.time = ch.surviveFor + 0.01;
    expect(challengeStatus(b, ch)).toBe("won");

    const tower = b.entities.find(
      (e) => e.side === "player" && e.kind === "princess-tower",
    )!;
    tower.hp = 0;
    expect(challengeStatus(b, ch)).toBe("lost");
  });
});

/**
 * Solvability: a normal-strength bot playing the challenge deck from the
 * player's side, against the scripted waves, exactly as main.ts runs a
 * challenge (tick, then the waves, then the status check).
 */
function botClears(ch: Challenge, seed: number): boolean {
  const b = createBattle(ch.deck, ch.deck);
  const bot = createBot(seed, { ...DIFFICULTIES.normal, side: "player" });
  const cursor = { next: 0 };
  const DT = 1 / 30;
  for (let i = 0; i < Math.ceil((ch.surviveFor + 5) / DT); i++) {
    tick(b, DT);
    tickBot(b, bot, DT);
    if (b.result) return b.result.winner === "player";
    applyWaves(b, ch, cursor);
    const status = challengeStatus(b, ch);
    if (status !== "playing") return status === "won";
  }
  return false;
}

describe("challenge solvability", () => {
  const SEEDS = 10;
  const clears = (ch: Challenge): number => {
    let n = 0;
    for (let s = 1; s <= SEEDS; s++) if (botClears(ch, s)) n++;
    return n;
  };

  it("a normal bot clears every one-star starter in at least 8 of 10 seeds, and every challenge in 2 of 10", () => {
    const report: string[] = [];
    for (const ch of CHALLENGES) {
      const n = clears(ch);
      report.push(`${ch.id}: ${n}/${SEEDS}`);
      expect(n, `${ch.id} cleared ${n}/${SEEDS} (${report.join(", ")})`).toBeGreaterThanOrEqual(challengeStars(ch) === 1 ? 8 : 2);
    }
  }, 60_000);
});
