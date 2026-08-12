import { describe, expect, it } from "vitest";
import { createBattle, TOWER_SPELL_DAMAGE_FACTOR, type BattleState } from "./battle";
import { botThink, createBot } from "./bot";
import { getCard, type CardId } from "./cards";
import { createHand } from "./hand";

function giveBotHand(b: BattleState, cards: CardId[], elixir = 10): void {
  b.enemy.hand = createHand(
    ([...cards, "knight", "archers", "giant", "fireball", "arrows", "zap", "rage"] as CardId[]).slice(0, 8),
  );
  b.enemy.elixir = { amount: elixir };
}

describe("bot dirty tricks", () => {
  it("spell-finishes a player tower it can kill outright", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "player" && e.kind === "princess-tower",
    )!;
    const fireball = getCard("fireball");
    if (fireball.kind !== "spell") throw new Error("fireball is a spell");
    tower.hp = fireball.damage * TOWER_SPELL_DAMAGE_FACTOR - 1; // one cast kills
    giveBotHand(b, ["fireball"]);
    botThink(b, createBot(1));
    expect(tower.hp).toBeLessThanOrEqual(0);
  });

  it("does not waste spells on healthy towers", () => {
    const b = createBattle();
    const before = b.enemy.elixir.amount;
    giveBotHand(b, ["fireball"], before);
    // No clusters, no low towers: the finisher must not fire; whatever the
    // bot does instead must not be a fireball at a full-HP tower.
    botThink(b, createBot(1));
    const towers = b.entities.filter(
      (e) => e.side === "player" && (e.kind === "princess-tower" || e.kind === "king-tower"),
    );
    for (const t of towers) expect(t.hp).toBe(t.maxHp);
  });
});
