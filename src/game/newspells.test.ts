import { describe, expect, it } from "vitest";
import { createBattle, deployCard, distance, spawnUnits, type BattleState } from "./battle";
import { createHand } from "./hand";
import type { CardId } from "./cards";

function giveHand(b: BattleState, side: "player" | "enemy", cards: CardId[]): void {
  const s = side === "player" ? b.player : b.enemy;
  s.hand = createHand(([...cards, "knight", "archers", "giant", "fireball"] as CardId[]).slice(0, 8));
  s.elixir = { amount: 10 };
}

describe("Heal", () => {
  it("restores friendly troops, never above max, and ignores enemies", () => {
    const b = createBattle();
    const [mine] = spawnUnits(b, "player", "knight", 9, 24);
    const [theirs] = spawnUnits(b, "enemy", "knight", 9.5, 24);
    mine.hp = 500;
    theirs.hp = 500;
    giveHand(b, "player", ["heal"]);
    expect(deployCard(b, "player", "heal", 9, 24)).toBe(true);
    expect(mine.hp).toBe(1000); // +500
    expect(theirs.hp).toBe(500); // enemies untouched
    // Second heal caps at max HP.
    giveHand(b, "player", ["heal"]);
    deployCard(b, "player", "heal", 9, 24);
    expect(mine.hp).toBe(1400);
  });

  it("never heals towers", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "player" && e.kind === "princess-tower",
    )!;
    tower.hp = 1000;
    giveHand(b, "player", ["heal"]);
    deployCard(b, "player", "heal", tower.x, tower.y);
    expect(tower.hp).toBe(1000);
  });
});

describe("Tornado", () => {
  it("drags enemy troops toward the blast center and damages them", () => {
    const b = createBattle();
    const [victim] = spawnUnits(b, "enemy", "knight", 6, 20);
    const before = distance(victim, { x: 9, y: 20 });
    giveHand(b, "player", ["tornado"]);
    expect(deployCard(b, "player", "tornado", 9, 20)).toBe(true);
    const after = distance(victim, { x: 9, y: 20 });
    expect(after).toBeLessThan(before);
    expect(before - after).toBeCloseTo(2.5, 1); // full pull distance
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it("does not move friendly troops or buildings", () => {
    const b = createBattle();
    const [friend] = spawnUnits(b, "player", "knight", 6, 20);
    const fx = friend.x;
    giveHand(b, "player", ["tornado"]);
    deployCard(b, "player", "tornado", 9, 20);
    expect(friend.x).toBe(fx);
  });
});

describe("Skeleton Barrel", () => {
  it("bursts skeletons out at the target — even deep in enemy territory", () => {
    const b = createBattle();
    giveHand(b, "player", ["skeleton-barrel"]);
    // Aim at the enemy princess tower: troops can't deploy there, spells can.
    expect(deployCard(b, "player", "skeleton-barrel", 3.5, 6.5)).toBe(true);
    const skellies = b.entities.filter(
      (e) => e.side === "player" && e.cardId === "skeletons",
    );
    expect(skellies).toHaveLength(3);
    for (const s of skellies) {
      expect(distance(s, { x: 3.5, y: 6.5 })).toBeLessThan(2);
    }
  });
});
