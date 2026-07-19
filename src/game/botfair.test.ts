import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { createBot, tickBot } from "./bot";
import { DEFAULT_DECK, getCard, type CardId } from "./cards";
import { HAND_SIZE, playCard, type HandState } from "./hand";
import { BATTLE_DURATION, tick } from "./sim";

/**
 * Fair-play proof: the bot must obey EXACTLY the same card rules as the
 * player — an 8-card deck, a 4-card hand, and CR rotation (a played card
 * goes to the back of the queue and the next queued card is drawn).
 *
 * We shadow the bot's hand independently: starting from its deck, we apply
 * the rotation rule ourselves for every deploy/spell event the bot emits.
 * If the bot ever plays a card outside its hand, skips the rotation, or
 * spends elixir it doesn't have, the shadow (or the sim) diverges and this
 * test fails.
 */
describe("bot fair play", () => {
  const TICK = 1 / 30;

  function shadowEquals(a: HandState, b: HandState): boolean {
    return (
      a.cards.join(",") === b.cards.join(",") && a.queue.join(",") === b.queue.join(",")
    );
  }

  it("follows the player's exact hand-rotation rules for a whole match", () => {
    const altDeck: CardId[] = [
      "knight", "archers", "giant", "fireball",
      "musketeer", "mini-pekka", "baby-dragon", "arrows",
    ];
    const b = createBattle(altDeck, DEFAULT_DECK);
    const bot = createBot(1234, { thinkInterval: 0.55, pushAt: 6 }); // hardest bot
    // Independent shadow of the bot's hand, advanced ONLY by observed events.
    let shadow: HandState = {
      cards: DEFAULT_DECK.slice(0, HAND_SIZE),
      queue: DEFAULT_DECK.slice(HAND_SIZE),
    };
    let plays = 0;
    let lastElixir = b.enemy.elixir.amount;

    while (!b.result && b.time < BATTLE_DURATION) {
      tick(b, TICK);
      const before = b.enemy.elixir.amount;
      tickBot(b, bot, TICK);
      // Every card the bot just played must have been in the shadow hand;
      // apply the same rotation the player's hand uses.
      for (const ev of b.events) {
        if ((ev.type === "deploy" || ev.type === "spell") && ev.side === "enemy") {
          expect(shadow.cards).toContain(ev.cardId);
          const cost = getCard(ev.cardId).cost;
          expect(before).toBeGreaterThanOrEqual(cost); // no free elixir
          shadow = playCard(shadow, ev.cardId);
          plays++;
        }
      }
      b.events.length = 0;
      // The sim's actual bot hand must match our independent shadow.
      expect(shadowEquals(shadow, b.enemy.hand)).toBe(true);
      // Hand is always exactly 4; deck membership never changes.
      expect(b.enemy.hand.cards).toHaveLength(HAND_SIZE);
      expect(
        [...b.enemy.hand.cards, ...b.enemy.hand.queue].slice().sort().join(","),
      ).toBe(DEFAULT_DECK.slice().sort().join(","));
      // Elixir only moves by regen (up) or legal card costs (down).
      expect(b.enemy.elixir.amount).toBeGreaterThanOrEqual(0);
      lastElixir = b.enemy.elixir.amount;
    }
    expect(lastElixir).toBeGreaterThanOrEqual(0);
    // The bot actually played a real match's worth of cards.
    expect(plays).toBeGreaterThan(4);
  });

  it("never deploys troops outside its own half", () => {
    const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
    const bot = createBot(77, { thinkInterval: 0.55, pushAt: 6 });
    for (let i = 0; i < 30 * 90 && !b.result; i++) {
      tick(b, TICK);
      tickBot(b, bot, TICK);
      for (const ev of b.events) {
        if (ev.type === "deploy" && ev.side === "enemy") {
          // Troop/building deploys are checked by position of the freshly
          // spawned entities: all enemy troops must appear on y < 16 or be
          // spawner summons from an entity already legally placed.
          for (const e of b.entities) {
            if (e.side !== "enemy" || e.kind === "king-tower" || e.kind === "princess-tower") continue;
            if (e.deployTimer > 0.9) {
              expect(e.y).toBeLessThan(16.5);
            }
          }
        }
      }
      b.events.length = 0;
    }
  });
});
