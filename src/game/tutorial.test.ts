import { describe, expect, it } from "vitest";
import { useAbility } from "./abilities";
import { createBattle, deployCard, type BattleState } from "./battle";
import { applyWaves, CHALLENGES, challengeStatus, TUTORIAL_CHALLENGE } from "./challenges";
import { tick } from "./sim";
import type { TowerTroopId } from "./towers";
import {
  TUTORED_KEY,
  TUTORIAL_KEY,
  TUTORIAL_STEPS,
  Tutorial,
  loadTutorialProgress,
  prepareTutorialBattle,
  tutorialChallenge,
  tutorialDone,
  type TutorialStorage,
} from "./tutorial";

const DT = 1 / 30;

function memStorage(init: Record<string, string> = {}): TutorialStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** The tutorial battle as main.ts builds it (a challenge with no bot). */
function tutorialBattle(from = 0, enemyTower: TowerTroopId = "princess") {
  const ch = tutorialChallenge(from);
  const b = createBattle(ch.deck, ch.deck, {}, 1, { player: "princess", enemy: enemyTower }, { player: "rally", enemy: "salvo" });
  prepareTutorialBattle(b, ch);
  return { b, ch, cursor: { next: 0 } };
}

/** One frame of the solo loop: the sim only runs when the tutorial lets it. */
function frame(t: Tutorial, g: ReturnType<typeof tutorialBattle>): void {
  const { b, ch, cursor } = g;
  if (!t.holds(b) && !b.result) {
    tick(b, DT);
    applyWaves(b, ch, cursor);
    const status = challengeStatus(b, ch);
    if (status !== "playing" && !b.result) {
      b.result = { winner: status === "won" ? "player" : "enemy", playerCrowns: b.player.crowns, enemyCrowns: b.enemy.crowns };
      b.events.push({ type: "finish", winner: b.result.winner });
    }
  }
  for (const ev of b.events.splice(0)) t.feed(ev, b);
  t.feed({ type: "frame" }, b);
}

/** A model student: does exactly what the coach shows, as soon as it can. */
function follow(t: Tutorial, b: BattleState): void {
  const step = t.current;
  if (!step) return;
  const target = step.target?.(b);
  if (target) deployCard(b, "player", target.cardId, target.x, target.y);
  else if (step.tapToContinue) t.feed({ type: "tap" }, b);
  else if (step.anchor === "ability") useAbility(b, "player");
}

describe("tutorial challenge", () => {
  it("is hidden from the Challenges list and uses real cards", () => {
    expect(CHALLENGES.some((c) => c.id === "tutorial")).toBe(false);
    expect(new Set(TUTORIAL_CHALLENGE.deck).size).toBe(8);
    for (const id of ["knight", "musketeer", "fireball", "giant"] as const) {
      expect(TUTORIAL_CHALLENGE.deck.slice(0, 4)).toContain(id);
    }
  });

  it("weakens the enemy King without waking it", () => {
    const { b } = tutorialBattle();
    const king = b.entities.find((e) => e.side === "enemy" && e.kind === "king-tower")!;
    expect(king.hp).toBe(TUTORIAL_CHALLENGE.enemyKingHp);
    expect(king.maxHp).toBe(king.hp);
    tick(b, DT);
    expect(king.active).toBe(false);
  });

  it("drops the waves of lessons a resumed battle skips", () => {
    expect(tutorialChallenge(0).waves).toHaveLength(3);
    expect(tutorialChallenge(2).waves.map((w) => w.cardId)).toEqual(["archers", "archers"]);
    expect(tutorialChallenge(4).waves).toHaveLength(0);
  });
});

describe("tutorial steps", () => {
  it("holds the clock until the Knight is deployed", () => {
    const t = new Tutorial(memStorage());
    const g = tutorialBattle();
    for (let i = 0; i < 90; i++) frame(t, g);
    expect(g.b.time).toBe(0);
    expect(t.step).toBe(0);
    // A different card does not count…
    deployCard(g.b, "player", "giant", 9, 20);
    frame(t, g);
    expect(t.step).toBe(0);
  });

  it("advances only on the expected events", () => {
    const t = new Tutorial(memStorage());
    const { b } = tutorialBattle();
    const wrong = [
      { type: "deploy", side: "player", cardId: "musketeer", x: 1, y: 20 },
      { type: "deploy", side: "enemy", cardId: "knight", x: 1, y: 10 },
      { type: "tap" },
      { type: "frame" },
    ] as const;
    for (const ev of wrong) expect(t.feed(ev, b)).toBe(false);
    expect(t.feed({ type: "deploy", side: "player", cardId: "knight", x: 3.5, y: 20 }, b)).toBe(true);
    expect(t.step).toBe(1);
    // The elixir callout only moves on a tap.
    t.feed({ type: "deploy", side: "player", cardId: "musketeer", x: 11, y: 26 }, b);
    expect(t.step).toBe(2);
    expect(t.feed({ type: "spell", side: "player", cardId: "fireball", x: 9, y: 9 }, b)).toBe(false);
    expect(t.feed({ type: "tap" }, b)).toBe(true);
    expect(t.feed({ type: "crown", winner: "player" }, b)).toBe(false);
    expect(t.feed({ type: "spell", side: "player", cardId: "fireball", x: 9, y: 9 }, b)).toBe(true);
    expect(t.feed({ type: "crown", winner: "enemy" }, b)).toBe(false);
    expect(t.feed({ type: "crown", winner: "player" }, b)).toBe(true);
    expect(t.feed({ type: "ability", side: "enemy", ability: "salvo", x: 9, y: 2 }, b)).toBe(false);
    expect(t.feed({ type: "ability", side: "player", ability: "rally", x: 9, y: 29 }, b)).toBe(true);
    expect(t.feed({ type: "finish", winner: "enemy" }, b)).toBe(false);
    expect(t.feed({ type: "finish", winner: "player" }, b)).toBe(true);
    expect(t.done).toBe(true);
  });

  it("saves each step as it completes and resumes after a reload", () => {
    const store = memStorage();
    const t = new Tutorial(store);
    const { b } = tutorialBattle();
    expect(store.map.has(TUTORIAL_KEY)).toBe(false); // starting saves nothing
    t.feed({ type: "deploy", side: "player", cardId: "knight", x: 3.5, y: 20 }, b);
    expect(store.map.get(TUTORIAL_KEY)).toBe("1");
    const reloaded = new Tutorial(store);
    expect(reloaded.step).toBe(1);
    expect(reloaded.current?.id).toBe("defend");
    reloaded.skip();
    expect(new Tutorial(store).done).toBe(true);
    expect(store.map.get(TUTORED_KEY)).toBe("1");
  });

  it("treats the legacy tutored flag as done and survives bad storage", () => {
    expect(tutorialDone(memStorage({ [TUTORED_KEY]: "1" }))).toBe(true);
    expect(loadTutorialProgress(memStorage({ [TUTORIAL_KEY]: "4" }))).toBe(4);
    expect(loadTutorialProgress(memStorage({ [TUTORIAL_KEY]: "banana" }))).toBe(0);
    expect(loadTutorialProgress(memStorage({ [TUTORIAL_KEY]: "99" }))).toBe(0);
    const throwing: TutorialStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(tutorialDone(throwing)).toBe(false);
    const t = new Tutorial(throwing);
    expect(() => t.skip()).not.toThrow();
  });

  for (const tower of ["princess", "cannoneer", "duchess"] as const) {
    it(`a student who follows the coach wins (enemy ${tower})`, () => {
      const t = new Tutorial(memStorage());
      const g = tutorialBattle(0, tower);
      const seen: string[] = [];
      for (let i = 0; i < 30 * 400 && !t.done; i++) {
        const id = t.current?.id;
        if (id && seen[seen.length - 1] !== id) seen.push(id);
        follow(t, g.b);
        frame(t, g);
        if (g.b.result && !t.done) break;
      }
      expect(seen).toEqual(TUTORIAL_STEPS.map((s) => s.id));
      expect(g.b.result?.winner).toBe("player");
      expect(t.done).toBe(true);
      // The player never lost a tower on the way.
      expect(g.b.entities.filter((e) => e.side === "player" && e.kind !== "troop" && e.cardId === null)).toHaveLength(3);
    });
  }

  it("resumes a reloaded lesson at the saved step and still wins", () => {
    const store = memStorage({ [TUTORIAL_KEY]: "3" });
    const t = new Tutorial(store);
    const g = tutorialBattle(3);
    for (let i = 0; i < 30 * 400 && !t.done && !g.b.result; i++) {
      follow(t, g.b);
      frame(t, g);
    }
    expect(t.done).toBe(true);
    expect(g.b.result?.winner).toBe("player");
  });
});
