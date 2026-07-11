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

describe("piloting", () => {
  const buildingsOf = (b: ReturnType<typeof createBattle>) =>
    b.entities.filter((e) => e.side === "enemy" && e.kind === "building");

  it("pushes with a win-condition as the spearhead, not a cheap troop", () => {
    const b = createBattle();
    giveBotHand(b, ["giant", "skeletons", "archers", "wizard"]); // 10 elixir
    botThink(b, createBot(42));
    const troops = troopsOf(b, "enemy");
    expect(troops.length).toBeGreaterThan(0);
    // The single play should be the giant, not the 1-elixir skeletons.
    expect(troops.every((t) => t.cardId === "giant")).toBe(true);
  });

  it("sends support to the lane where its tank is already pushing", () => {
    const b = createBattle();
    spawnUnits(b, "enemy", "giant", 3.5, RIVER_Y - 3); // tank on the left lane
    b.enemy.hand = createHand([
      "musketeer", "knight", "archers", "skeletons",
      "wizard", "valkyrie", "bats", "minions",
    ] as never);
    b.enemy.elixir = { amount: 10 };
    botThink(b, createBot(42));
    const support = troopsOf(b, "enemy").filter((t) => t.cardId !== "giant");
    expect(support.length).toBeGreaterThan(0);
    for (const s of support) expect(Math.abs(s.x - 3.5)).toBeLessThan(2.5);
  });

  it("drops an elixir collector in the back when flush and unthreatened", () => {
    const b = createBattle();
    b.enemy.hand = createHand([
      "elixir-collector", "knight", "archers", "skeletons",
      "giant", "musketeer", "valkyrie", "bats",
    ] as never);
    b.enemy.elixir = { amount: 10 };
    botThink(b, createBot(42));
    const buildings = buildingsOf(b);
    expect(buildings.map((x) => x.cardId)).toEqual(["elixir-collector"]);
    expect(buildings[0].y).toBeLessThan(8); // deep on its own side, not at the bridge
  });

  it("answers a ground tank with a defensive building when it has one", () => {
    const b = createBattle();
    spawnUnits(b, "player", "giant", 3.5, RIVER_Y - 2); // ground tank invading
    b.enemy.hand = createHand([
      "cannon", "knight", "archers", "skeletons",
      "musketeer", "valkyrie", "bats", "minions",
    ] as never);
    b.enemy.elixir = { amount: 10 };
    botThink(b, createBot(42));
    expect(buildingsOf(b).some((x) => x.cardId === "cannon")).toBe(true);
  });
});

describe("difficulty", () => {
  it("a slower thinker waits longer between plays", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 10 };
    const lazy = createBot(42, { thinkInterval: 3, pushAt: 8 });
    tickBot(b, lazy, 1.5); // under its interval: no move yet
    expect(troopsOf(b, "enemy")).toHaveLength(0);
    tickBot(b, lazy, 2); // crosses 3s total
    expect(troopsOf(b, "enemy").length).toBeGreaterThan(0);
  });

  it("an aggressive bot pushes on less elixir", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 6 };
    const aggro = createBot(42, { thinkInterval: 1, pushAt: 5 });
    botThink(b, aggro);
    expect(troopsOf(b, "enemy").length).toBeGreaterThan(0);
    const c = createBattle();
    c.enemy.elixir = { amount: 6 };
    botThink(c, createBot(42)); // default waits for 8
    expect(troopsOf(c, "enemy")).toHaveLength(0);
  });
});
