import { describe, expect, it } from "vitest";
import { RIVER_Y } from "./arena";
import { createBattle, spawnUnits } from "./battle";
import { botThink, createBot, tickBot } from "./bot";
import { createHand } from "./hand";

function troopsOf(b: ReturnType<typeof createBattle>, side: "player" | "enemy") {
  return b.entities.filter((e) => e.side === side && e.kind === "troop");
}

/** Put specific cards in the bot's hand with full elixir. */
function giveBotHand(b: ReturnType<typeof createBattle>, cards: string[]): void {
  b.enemy.hand = createHand([...cards, "knight", "archers", "giant", "fireball"] as never);
  b.enemy.elixir = { amount: 10 };
}

describe("bot", () => {
  it("saves elixir when there is no threat and no big push available", () => {
    const b = createBattle(); // 5 elixir, below push threshold
    const bot = createBot(42);
    botThink(b, bot);
    expect(troopsOf(b, "enemy")).toHaveLength(0);
  });

  it("defends its own half when a player troop crosses the river", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 10 };
    spawnUnits(b, "player", "knight", 3.5, RIVER_Y - 2);
    const bot = createBot(42);
    botThink(b, bot);
    const defenders = troopsOf(b, "enemy");
    expect(defenders.length).toBeGreaterThan(0);
    for (const d of defenders) expect(d.y).toBeLessThan(RIVER_Y);
  });

  it("starts a push once elixir is nearly full", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 9 };
    const bot = createBot(42);
    botThink(b, bot);
    expect(troopsOf(b, "enemy").length).toBeGreaterThan(0);
  });

  it("never wastes a spell on a cheap swarm", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 10 };
    // Three 1-elixir-total skeletons: arrows/fireball would lose elixir.
    spawnUnits(b, "player", "skeletons", 9, RIVER_Y - 3);
    const bot = createBot(42);
    botThink(b, bot);
    expect(b.effects).toHaveLength(0); // no spell cast
  });

  it("spells a cluster of player troops instead of deploying", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 10 };
    // Three knights stacked on the bot's half: prime fireball target.
    spawnUnits(b, "player", "knight", 9, RIVER_Y - 3);
    spawnUnits(b, "player", "knight", 9.4, RIVER_Y - 3.2);
    spawnUnits(b, "player", "knight", 8.6, RIVER_Y - 2.8);
    const bot = createBot(42);
    botThink(b, bot);
    expect(b.effects.length).toBeGreaterThan(0);
    const hurt = troopsOf(b, "player").filter((e) => e.hp < e.maxHp);
    expect(hurt.length).toBeGreaterThanOrEqual(3);
  });

  it("defends an air invader only with troops that can hit it", () => {
    for (const seed of [1, 7, 42, 99]) {
      const b = createBattle();
      giveBotHand(b, ["knight", "mini-pekka", "valkyrie", "musketeer"]);
      spawnUnits(b, "player", "balloon", 3.5, RIVER_Y - 2);
      botThink(b, createBot(seed));
      const defenders = troopsOf(b, "enemy");
      expect(defenders.length).toBeGreaterThan(0);
      for (const d of defenders) expect(d.targetsAir).toBe(true);
    }
  });

  it("never defends with troops that ignore the invader", () => {
    for (const seed of [1, 7, 42, 99]) {
      const b = createBattle();
      giveBotHand(b, ["giant", "hog-rider", "balloon", "knight"]);
      spawnUnits(b, "player", "knight", 3.5, RIVER_Y - 2);
      botThink(b, createBot(seed));
      const defenders = troopsOf(b, "enemy");
      expect(defenders.length).toBeGreaterThan(0);
      for (const d of defenders) expect(d.targetsBuildingsOnly).toBe(false);
    }
  });

  it("zaps a valuable cluster when zap is the spell in hand", () => {
    const b = createBattle();
    giveBotHand(b, ["zap", "knight", "giant", "hog-rider"]);
    spawnUnits(b, "player", "knight", 9, RIVER_Y - 3);
    spawnUnits(b, "player", "knight", 9.4, RIVER_Y - 3.2);
    spawnUnits(b, "player", "knight", 8.6, RIVER_Y - 2.8);
    botThink(b, createBot(42));
    const stunned = troopsOf(b, "player").filter((e) => e.stunTimer > 0);
    expect(stunned.length).toBeGreaterThanOrEqual(3);
  });

  it("only thinks at its decision interval", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 10 };
    const bot = createBot(42);
    tickBot(b, bot, 0.05); // far below the think interval
    expect(troopsOf(b, "enemy")).toHaveLength(0);
    tickBot(b, bot, 2); // crosses the interval
    expect(troopsOf(b, "enemy").length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const positions = () => {
      const b = createBattle();
      const bot = createBot(7);
      for (let i = 0; i < 200; i++) {
        b.enemy.elixir = { amount: 10 };
        tickBot(b, bot, 0.5);
      }
      return troopsOf(b, "enemy").map((e) => [e.cardId, e.x, e.y]);
    };
    expect(positions()).toEqual(positions());
  });
});
