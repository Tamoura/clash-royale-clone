import { describe, expect, it } from "vitest";
import { RIVER_Y } from "./arena";
import { checkDeploy, createBattle, deployCard, isValidDeck } from "./battle";

describe("battle setup", () => {
  it("starts with 6 towers, full hands, and 5 elixir each", () => {
    const b = createBattle();
    expect(b.entities.filter((e) => e.kind !== "troop")).toHaveLength(6);
    expect(b.player.hand.cards).toHaveLength(4);
    expect(b.enemy.hand.cards).toHaveLength(4);
    expect(b.player.elixir.amount).toBe(5);
    expect(b.time).toBe(0);
    expect(b.result).toBeNull();
  });

  it("king towers start inactive, princess towers active", () => {
    const b = createBattle();
    for (const e of b.entities) {
      if (e.kind === "king-tower") expect(e.active).toBe(false);
      else expect(e.active).toBe(true);
    }
  });
});

describe("deployment", () => {
  it("deploys a troop card: spends elixir, cycles hand, spawns units", () => {
    const b = createBattle();
    const ok = deployCard(b, "player", "knight", 9, 24);
    expect(ok).toBe(true);
    const knights = b.entities.filter((e) => e.cardId === "knight");
    expect(knights).toHaveLength(1);
    expect(b.player.elixir.amount).toBeCloseTo(2); // 5 - 3
    expect(b.player.hand.cards).not.toContain("knight");
  });

  it("spawns one unit per count for multi-unit cards", () => {
    const b = createBattle();
    deployCard(b, "player", "archers", 9, 24);
    expect(b.entities.filter((e) => e.cardId === "archers")).toHaveLength(2);
  });

  it("rejects deployment without enough elixir", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "giant", 9, 24)).toBe(true); // 5 elixir
    expect(deployCard(b, "player", "knight", 9, 24)).toBe(false); // 0 left
    expect(b.entities.filter((e) => e.cardId === "knight")).toHaveLength(0);
  });

  it("rejects troop deployment on the enemy half", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "knight", 9, 8)).toBe(false);
    expect(b.player.elixir.amount).toBe(5);
    expect(b.player.hand.cards).toContain("knight");
  });

  it("allows spells anywhere, damaging enemies in the radius", () => {
    const b = createBattle();
    deployCard(b, "enemy", "knight", 9, 8);
    const knight = b.entities.find((e) => e.cardId === "knight")!;
    const before = knight.hp;
    expect(deployCard(b, "player", "fireball", 9, 8)).toBe(true);
    expect(knight.hp).toBeLessThan(before);
  });

  it("spells deal reduced (40%) damage to crown towers", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const before = tower.hp;
    deployCard(b, "player", "fireball", tower.x, tower.y);
    expect(before - tower.hp).toBeCloseTo(570 * 0.4);
  });

  it("spells never hit the caster's own towers", () => {
    const b = createBattle();
    const ownKing = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "king-tower",
    )!;
    b.enemy.elixir = { amount: 10 };
    b.enemy.hand = { ...b.enemy.hand, cards: ["fireball", "knight", "archers", "giant"] };
    expect(deployCard(b, "enemy", "fireball", ownKing.x, ownKing.y)).toBe(true);
    expect(ownKing.hp).toBe(ownKing.maxHp);
  });

  it("spells do not hit your own units", () => {
    const b = createBattle();
    b.player.elixir = { amount: 10 };
    deployCard(b, "player", "knight", 9, 24);
    const knight = b.entities.find((e) => e.cardId === "knight")!;
    expect(deployCard(b, "player", "fireball", 9, 24)).toBe(true);
    expect(knight.hp).toBe(knight.maxHp);
  });

  it("rejects troop deployment on the river itself", () => {
    const b = createBattle();
    expect(deployCard(b, "player", "knight", 9, RIVER_Y)).toBe(false);
  });
});

describe("checkDeploy", () => {
  it("approves a normal troop deploy", () => {
    const b = createBattle();
    expect(checkDeploy(b, "player", "knight", 9, 24)).toBe("ok");
  });

  it("flags the enemy half for troops but not for spells", () => {
    const b = createBattle();
    expect(checkDeploy(b, "player", "knight", 9, 8)).toBe("bad-spot");
    expect(checkDeploy(b, "player", "fireball", 9, 8)).toBe("ok");
  });

  it("flags missing elixir", () => {
    const b = createBattle();
    b.player.elixir = { amount: 1 };
    expect(checkDeploy(b, "player", "knight", 9, 24)).toBe("no-elixir");
  });

  it("flags cards not in hand and finished battles", () => {
    const b = createBattle();
    expect(checkDeploy(b, "player", "pekka", 9, 24)).toBe("not-in-hand");
    b.result = { winner: "player", playerCrowns: 3, enemyCrowns: 0 };
    expect(checkDeploy(b, "player", "knight", 9, 24)).toBe("finished");
  });

  it("agrees with deployCard", () => {
    const b = createBattle();
    expect(checkDeploy(b, "player", "knight", 9, 8)).not.toBe("ok");
    expect(deployCard(b, "player", "knight", 9, 8)).toBe(false);
    expect(checkDeploy(b, "player", "knight", 9, 24)).toBe("ok");
    expect(deployCard(b, "player", "knight", 9, 24)).toBe(true);
  });
});

describe("decks of 8", () => {
  it("battles run on 8-card decks: 4 in hand, 4 queued", () => {
    const b = createBattle();
    expect(b.player.hand.cards).toHaveLength(4);
    expect(b.player.hand.queue).toHaveLength(4);
  });

  it("accepts custom decks per side", () => {
    const deck = [
      "pekka", "witch", "balloon", "freeze",
      "zap", "skeletons", "tombstone", "hog-rider",
    ] as const;
    const b = createBattle([...deck]);
    expect(b.player.hand.cards).toEqual(deck.slice(0, 4));
    expect(b.player.hand.queue).toEqual(deck.slice(4));
    expect(b.enemy.hand.cards).toHaveLength(4); // default deck
  });

  it("validates a deck as exactly 8 unique known cards", () => {
    expect(isValidDeck(["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"])).toBe(true);
    expect(isValidDeck(["knight", "knight", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"])).toBe(false);
    expect(isValidDeck(["knight", "archers", "giant"])).toBe(false);
  });
});
