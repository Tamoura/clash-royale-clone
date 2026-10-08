import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, RIVER_Y } from "./arena";
import { createBattle, spawnUnits } from "./battle";
import { BOT_PROFILE_DEFAULTS, botThink, createBot, tickBot } from "./bot";
import { createHand } from "./hand";
import { DEFAULT_DECK, type CardId } from "./cards";
import { createPilot, tickPilot } from "./pilot";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";
import { stateChecksum } from "../net/checksum";

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

  it("rages its own win-condition push when flush with elixir", () => {
    const b = createBattle();
    spawnUnits(b, "enemy", "giant", 3.5, RIVER_Y - 2);
    spawnUnits(b, "enemy", "musketeer", 3.8, RIVER_Y - 3);
    giveBotHand(b, ["rage", "knight", "archers", "skeletons"]);
    botThink(b, createBot(42));
    expect(b.effects.some((e) => e.cardId === "rage")).toBe(true);
  });

  it("freezes a dense cluster of invaders on its half", () => {
    const b = createBattle();
    spawnUnits(b, "player", "knight", 9, RIVER_Y - 3);
    spawnUnits(b, "player", "knight", 9.4, RIVER_Y - 3.2);
    spawnUnits(b, "player", "knight", 8.6, RIVER_Y - 2.8);
    giveBotHand(b, ["freeze", "knight", "archers", "skeletons"]);
    botThink(b, createBot(42));
    expect(b.effects.some((e) => e.cardId === "freeze")).toBe(true);
  });

  it("escorts a leading tank with a flying win-con (giant + balloon)", () => {
    for (const seed of [1, 7, 42, 99]) {
      const b = createBattle();
      spawnUnits(b, "enemy", "giant", 3.5, RIVER_Y - 3); // tank already pushing
      giveBotHand(b, ["balloon", "musketeer", "skeletons", "bats"]);
      botThink(b, createBot(seed));
      const balloons = troopsOf(b, "enemy").filter((e) => e.cardId === "balloon");
      expect(balloons.length).toBe(1);
      // It joins the tank's lane, not the other one.
      for (const x of balloons) expect(Math.abs(x.x - 3.5)).toBeLessThan(2.5);
    }
  });

  it("does not always break a win-con cost tie the same way", () => {
    // Giant and balloon both cost 5. With both in hand, different seeds
    // must sometimes lead with each — a fixed tie-break leaves one card
    // rotting in hand for entire matches.
    const leads = new Set<string>();
    for (const seed of [1, 2, 3, 5, 7, 11, 42, 99]) {
      const b = createBattle();
      giveBotHand(b, ["balloon", "giant", "skeletons", "bats"]);
      botThink(b, createBot(seed));
      const t = troopsOf(b, "enemy")[0];
      if (t?.cardId) leads.add(t.cardId);
    }
    expect(leads.has("giant")).toBe(true);
    expect(leads.has("balloon")).toBe(true);
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

describe("side-aware bot", () => {
  /** Mirror of giveBotHand for a bot playing the bottom half. */
  function givePlayerHand(b: ReturnType<typeof createBattle>, cards: string[]): void {
    b.player.hand = createHand([...cards, "knight", "archers", "giant", "fireball"] as never);
    b.player.elixir = { amount: 10 };
  }

  it("fills every optional knob with the classic default", () => {
    const bot = createBot(1, { thinkInterval: 1, pushAt: 8 });
    expect(bot.side).toBe("enemy");
    expect(bot.reactionDelay).toBe(0);
    expect(bot.mistakeRate).toBe(0);
    expect(bot.spellIQ).toBe(1);
    expect(bot.allowFinisher).toBe(true);
    expect(BOT_PROFILE_DEFAULTS.side).toBe("enemy");
  });

  it("defends its own (bottom) half when piloting the player side", () => {
    const b = createBattle();
    b.player.elixir = { amount: 10 };
    spawnUnits(b, "enemy", "knight", 3.5, RIVER_Y + 2);
    botThink(b, createBot(42, { side: "player" }));
    const defenders = troopsOf(b, "player");
    expect(defenders.length).toBeGreaterThan(0);
    for (const d of defenders) expect(d.y).toBeGreaterThan(RIVER_Y);
  });

  it("pushes from its own bridge when piloting the player side", () => {
    const b = createBattle();
    givePlayerHand(b, ["giant", "skeletons", "archers", "wizard"]);
    botThink(b, createBot(42, { side: "player" }));
    const troops = troopsOf(b, "player");
    expect(troops.map((t) => t.cardId)).toEqual(["giant"]);
    expect(troops[0].y).toBeCloseTo(ARENA_HEIGHT - (RIVER_Y - 4));
  });

  it("plays the mirror image of the enemy-side bot", () => {
    const top = createBattle();
    const bottom = createBattle();
    spawnUnits(top, "player", "knight", 5, RIVER_Y - 2);
    spawnUnits(bottom, "enemy", "knight", 5, ARENA_HEIGHT - (RIVER_Y - 2));
    top.enemy.elixir = { amount: 10 };
    bottom.player.elixir = { amount: 10 };
    botThink(top, createBot(9));
    botThink(bottom, createBot(9, { side: "player" }));
    const a = troopsOf(top, "enemy").map((e) => [e.cardId, e.x, e.y]);
    const m = troopsOf(bottom, "player").map((e) => [e.cardId, e.x, ARENA_HEIGHT - e.y]);
    expect(a.length).toBeGreaterThan(0);
    expect(m).toEqual(a);
  });

  it("waits reactionDelay seconds before answering an invader", () => {
    const b = createBattle();
    b.enemy.elixir = { amount: 6 }; // enough to defend, short of a push
    b.enemy.hand = createHand(["knight", "archers", "musketeer", "valkyrie", "giant", "fireball", "arrows", "zap"]);
    spawnUnits(b, "player", "knight", 3.5, RIVER_Y - 2);
    const slow = createBot(42, { reactionDelay: 2 });
    botThink(b, slow); // first sight: no reaction yet
    expect(troopsOf(b, "enemy")).toHaveLength(0);
    b.time += 1;
    botThink(b, slow);
    expect(troopsOf(b, "enemy")).toHaveLength(0);
    b.time += 1.5;
    botThink(b, slow);
    expect(troopsOf(b, "enemy").length).toBeGreaterThan(0);
  });

  it("a high spellIQ ignores a cluster the default bot would spell", () => {
    const setup = () => {
      const b = createBattle();
      giveBotHand(b, ["arrows", "giant", "hog-rider", "balloon"]);
      // Three archers-worth of value: enough for arrows (3), not for 2x.
      spawnUnits(b, "player", "archers", 9, RIVER_Y - 3);
      spawnUnits(b, "player", "archers", 9.4, RIVER_Y - 3.2);
      return b;
    };
    const plain = setup();
    botThink(plain, createBot(42));
    expect(plain.effects.some((e) => e.cardId === "arrows")).toBe(true);
    const picky = setup();
    botThink(picky, createBot(42, { spellIQ: 2 }));
    expect(picky.effects.some((e) => e.cardId === "arrows")).toBe(false);
  });

  it("never finishes a tower with a spell when allowFinisher is off", () => {
    const setup = () => {
      const b = createBattle();
      giveBotHand(b, ["fireball", "skeletons", "bats", "knight"]);
      const tower = b.entities.find((e) => e.side === "player" && e.kind === "princess-tower")!;
      tower.hp = 50;
      return b;
    };
    const rude = setup();
    botThink(rude, createBot(1));
    expect(rude.events.some((e) => e.type === "spell" && e.cardId === "fireball")).toBe(true);
    const kind = setup();
    botThink(kind, createBot(1, { allowFinisher: false }));
    expect(kind.events.some((e) => e.type === "spell" && e.cardId === "fireball")).toBe(false);
  });

  it("slips up only within the rules: every mistake is still a legal play", () => {
    for (const side of ["enemy", "player"] as const) {
      const b = createBattle(DEFAULT_DECK, DEFAULT_DECK);
      const bot = createBot(5, { side, mistakeRate: 1, thinkInterval: 0.5, pushAt: 4 });
      let plays = 0;
      for (let t = 0; t < 30 * 120 && !b.result; t++) {
        tick(b, 1 / 30);
        tickBot(b, bot, 1 / 30);
        for (const ev of b.events) {
          if (ev.type !== "deploy" || ev.side !== side) continue;
          plays++;
          // Troops and buildings land on the bot's own half (no tower has fallen).
          if (b.player.crowns + b.enemy.crowns === 0) {
            expect(side === "enemy" ? ev.y < RIVER_Y : ev.y > RIVER_Y).toBe(true);
          }
        }
        b.events.length = 0;
      }
      expect(plays).toBeGreaterThan(5);
    }
  });
});

/**
 * Snapshot: whole seeded matches against the normal and hard bot profiles,
 * sampled with stateChecksum every 300 ticks. The fixture was captured
 * BEFORE the bot learned to play either side and to make mistakes, so it
 * proves the default profiles (and every saved replay, which re-creates
 * its bot from seed + profile) still make exactly the same plays.
 */
describe("bot snapshot", () => {
  const DT = 1 / 30;
  const SAMPLE = 300;
  const MAX_TICKS = 30 * (BATTLE_DURATION + OVERTIME_DURATION) + 30;
  const DECKS: CardId[][] = [
    DEFAULT_DECK,
    ["cannon", "freeze", "rage", "mirror", "giant", "musketeer", "skeletons", "arrows"],
    ["heal", "skeleton-barrel", "elixir-collector", "tornado", "balloon", "valkyrie", "zap", "bats"],
  ];
  const PROFILES = {
    normal: { thinkInterval: 1.0, pushAt: 8 },
    hard: { thinkInterval: 0.55, pushAt: 6 },
  } as const;

  function trace(i: number, tier: keyof typeof PROFILES): { sums: number[]; winner: string; ticks: number } {
    const b = createBattle(DEFAULT_DECK, DECKS[i], {}, 1, {}, { player: "rally", enemy: (["rally", "restore", "salvo"] as const)[i] });
    const bot = createBot(9000 + i, PROFILES[tier]);
    const pilot = createPilot(500 + i);
    const sums: number[] = [];
    let t = 0;
    for (; t < MAX_TICKS && !b.result; t++) {
      tickPilot(b, pilot, DT);
      tick(b, DT);
      tickBot(b, bot, DT);
      b.events.length = 0;
      if ((t + 1) % SAMPLE === 0) sums.push(stateChecksum(b));
    }
    sums.push(stateChecksum(b));
    return { sums, winner: b.result?.winner ?? "none", ticks: t };
  }

  const FIXTURE: Record<string, { sums: number[]; winner: string; ticks: number }> = {
    "normal-0": {
      sums: [
        2331464826, 4242004129, 545071692, 3343785850, 2214328479, 1049432801,
        2395278456, 4235287843, 2721297228, 964647001, 1445801226, 1939704935,
        1814757781, 386127648, 2611807727, 3299237802, 1771682291, 1125510365,
        3944289167,
      ],
      winner: "enemy",
      ticks: 5401,
    },
    "normal-1": {
      sums: [
        3967589965, 325270354, 2787626439, 2428838500, 1061971610, 2774141507,
        1542481325, 799943695, 2417825047, 2390044206, 570180802, 2237770336,
        1306084008, 1141453084, 4020109919, 723439349, 2411544843, 1970993356,
        3762502254,
      ],
      winner: "player",
      ticks: 5401,
    },
    "normal-2": {
      sums: [
        359395313, 555699469, 2734517376, 345896709, 2102799540, 2267085366,
        2067040913, 3575477480, 3474240845, 3992425148, 122525595, 1719967134,
        3394359913, 194696013, 2576697584, 2304957474, 3577586674, 3572431994,
        3391449889,
      ],
      winner: "enemy",
      ticks: 5401,
    },
    "hard-0": {
      sums: [
        490951617, 3957263388, 3772914039, 4255100035, 2255575832, 1345588746,
        3424243933, 943990520, 955929095, 46627719, 2982324542, 2943398919,
        4251526780, 1955110677, 2573542688, 2930378967, 592499545, 198469274,
        3603919868, 155680441, 2719583634, 4239723538, 2006814732, 3476235176,
        201977768, 2933341317, 1132816612, 534416944,
      ],
      winner: "enemy",
      ticks: 8353,
    },
    "hard-1": {
      sums: [
        1348659352, 2142287434, 1602244527, 2082842734, 3372899854, 2875259080,
        3092173492, 3220729939, 822385063, 3990523397, 1555073234, 3110842047,
        2724314560, 259937880, 2449943032, 2549435741, 2058467834, 1376325056,
        1369421312,
      ],
      winner: "player",
      ticks: 5401,
    },
    "hard-2": {
      sums: [
        1174139870, 2920872792, 2095528310, 3107492375, 1824511351, 2810084895,
        739663375, 2756575446, 1897029291, 3383164516, 2870425010, 2234295396,
        2092099689, 2178050029, 2955491477, 2383587513, 1242847736, 2689157739,
        404779126,
      ],
      winner: "enemy",
      ticks: 5401,
    },
  };

  it("default profiles replay the pre-refactor matches exactly", () => {
    const got: typeof FIXTURE = {};
    for (const tier of ["normal", "hard"] as const) {
      for (let i = 0; i < 3; i++) got[`${tier}-${i}`] = trace(i, tier);
    }
    expect(got).toEqual(FIXTURE);
  });
});
