import { describe, expect, it } from "vitest";
import { DECK, DEFAULT_DECK } from "../game/cards";
import {
  ARENAS,
  CARD_UNLOCK_TROPHIES,
  arenaForTrophies,
  cardsAvailableAt,
  nextArena,
  trophyProgress,
} from "./arenas";

describe("arenas", () => {
  it("covers every card in the pool exactly once", () => {
    const unlocked = Object.keys(CARD_UNLOCK_TROPHIES);
    // The Studio champion is created by the player, never found in chests,
    // so it's the one DECK card without an arena unlock.
    expect(unlocked.sort()).toEqual(DECK.filter((id) => id !== "champion").sort());
    expect(unlocked).toHaveLength(37);
  });

  it("Training Camp unlocks the starter deck", () => {
    const available = cardsAvailableAt(0);
    expect(available.sort()).toEqual([...DEFAULT_DECK].sort());
  });

  it("picks arena bands by trophy count", () => {
    expect(arenaForTrophies(0).id).toBe("training-camp");
    expect(arenaForTrophies(100).id).toBe("goblin-stadium");
    expect(arenaForTrophies(2999).id).toBe("jungle-arena");
    expect(arenaForTrophies(3000).id).toBe("legendary-peak");
    expect(nextArena(3000)).toBeNull();
  });

  it("reports progress toward the next arena", () => {
    const p = trophyProgress(50);
    expect(p.current.id).toBe("training-camp");
    expect(p.next?.id).toBe("goblin-stadium");
    expect(p.ratio).toBeCloseTo(0.5);
  });

  it("arenas are ordered by trophies", () => {
    for (let i = 1; i < ARENAS.length; i++) {
      expect(ARENAS[i].trophies).toBeGreaterThan(ARENAS[i - 1].trophies);
    }
  });
});
