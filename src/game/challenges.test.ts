import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, RIVER_Y } from "./arena";
import { createBattle, isValidDeck } from "./battle";
import { CARDS } from "./cards";
import {
  CHALLENGES,
  applyWaves,
  challengeStatus,
} from "./challenges";
import { tick } from "./sim";

describe("challenge definitions", () => {
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
        expect(CARDS[w.cardId].kind).not.toBe("spell");
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
