/**
 * Card wave 3 (sim v3): the Stone Golem and its Pebble Golem tokens, the
 * Digger and the Comet, plus the token rules that keep Pebble Golems out
 * of every deck. Each mechanic the wave adds has a test here.
 */
import { describe, expect, it } from "vitest";
import { ARENA_WIDTH, RIVER_Y } from "./arena";
import {
  burrowSeconds,
  checkDeploy,
  createBattle,
  deployCard,
  levelMultiplier,
  spawnUnits,
  type BattleState,
  type Entity,
} from "./battle";
import { createHand } from "./hand";
import { CARDS, DECK, TOKEN_IDS, getCard, isDeckable, type CardId } from "./cards";
import { createDraft } from "./draft";
import { dailyDeck, isFairDailyDeck } from "./daily";
import { createBot, botThink, tickBot } from "./bot";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";
import { parseClientMsg, playableCardIds } from "../net/validate";

const DT = 1 / 30;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) tick(b, DT);
}

function pebbles(b: BattleState): ReturnType<typeof spawnUnits> {
  return b.entities.filter((e) => e.cardId === "pebble-golem");
}

/** Put specific cards in a side's hand with a full bar. */
function giveHand(b: BattleState, side: "player" | "enemy", cards: CardId[]): void {
  const me = side === "player" ? b.player : b.enemy;
  me.hand = createHand([...cards, "knight", "archers", "giant", "fireball", "musketeer", "zap", "bats", "minions"].slice(0, 8) as CardId[]);
  me.elixir = { amount: 10 };
}

function enemyPrincess(b: BattleState, left = true): Entity {
  return b.entities.find((e) => e.side === "enemy" && e.kind === "princess-tower" && e.x < 9 === left)!;
}

describe("stone golem", () => {
  it("bursts into exactly two Pebble Golems where it falls", () => {
    const b = createBattle();
    const [golem] = spawnUnits(b, "player", "stone-golem", 9, 20);
    golem.hp = 0;
    tick(b, DT);
    expect(b.entities.includes(golem)).toBe(false);
    const p = pebbles(b);
    expect(p).toHaveLength(2);
    for (const u of p) {
      expect(u.side).toBe("player");
      expect(Math.abs(u.x - 9)).toBeLessThanOrEqual(0.71);
      expect(u.y).toBeCloseTo(20, 6);
      expect(u.sourceCardId).toBe("stone-golem");
    }
    // Two separate bodies, not stacked on one point.
    expect(p[0].x).not.toBe(p[1].x);
  });

  it("its pebbles take the golem's level, not their own", () => {
    const b = createBattle(undefined, undefined, { player: { "stone-golem": 4 } });
    const [golem] = spawnUnits(b, "player", "stone-golem", 9, 20);
    const mult = levelMultiplier({ "stone-golem": 4 }, "stone-golem");
    expect(golem.maxHp).toBeCloseTo(5000 * mult, 9);
    golem.hp = 0;
    tick(b, DT);
    for (const u of pebbles(b)) {
      expect(u.maxHp).toBe(950 * mult);
      expect(u.damage).toBe(55 * mult);
    }
  });

  it("credits the golem's card for its blast and its pebbles' blasts", () => {
    const b = createBattle();
    const [golem] = spawnUnits(b, "player", "stone-golem", 9, RIVER_Y);
    spawnUnits(b, "enemy", "knight", 9, RIVER_Y - 1);
    golem.hp = 0;
    tick(b, DT);
    const afterGolem = b.player.stats.damageByCard["stone-golem"] ?? 0;
    expect(afterGolem).toBe(260);
    for (const u of pebbles(b)) u.hp = 0;
    tick(b, DT);
    expect(b.player.stats.damageByCard["stone-golem"]).toBe(260 + 55 * 2);
    expect(b.player.stats.damageByCard["pebble-golem"]).toBeUndefined();
  });

  it("a golem whose blast topples a tower still scores the crown and splits", () => {
    const b = createBattle();
    const tower = b.entities.find((e) => e.side === "enemy" && e.kind === "princess-tower" && e.x < 9)!;
    const [golem] = spawnUnits(b, "player", "stone-golem", tower.x, tower.y + 2.2);
    tower.hp = 10;
    golem.hp = 0;
    tick(b, DT);
    expect(b.player.crowns).toBe(1);
    expect(pebbles(b)).toHaveLength(2);
  });

  it("never drops a pebble off the edge of the field", () => {
    const b = createBattle();
    const [golem] = spawnUnits(b, "enemy", "stone-golem", 0.95, 1);
    golem.hp = 0;
    tick(b, DT);
    for (const u of pebbles(b)) {
      expect(u.x).toBeGreaterThanOrEqual(u.radius);
      expect(u.x).toBeLessThanOrEqual(ARENA_WIDTH - u.radius);
      expect(u.y).toBeGreaterThanOrEqual(u.radius);
    }
  });

  it("marches on buildings like the other win conditions", () => {
    const b = createBattle();
    spawnUnits(b, "player", "stone-golem", 3.5, 20);
    const [knight] = spawnUnits(b, "enemy", "knight", 3.5, 18.5);
    run(b, 2);
    const golem = b.entities.find((e) => e.cardId === "stone-golem")!;
    expect(golem.targetId).not.toBe(knight.id);
    const target = b.entities.find((e) => e.id === golem.targetId);
    expect(target?.kind).not.toBe("troop");
  });
});

describe("tokens", () => {
  it("Pebble Golem is a token: not deckable, not in DECK", () => {
    expect(TOKEN_IDS).toEqual(["pebble-golem"]);
    expect(isDeckable("pebble-golem")).toBe(false);
    expect(isDeckable("champion")).toBe(false);
    expect(isDeckable("stone-golem")).toBe(true);
    expect(DECK).not.toContain("pebble-golem");
    for (const id of Object.keys(CARDS) as CardId[]) {
      if (id !== "champion" && !TOKEN_IDS.includes(id)) expect(DECK, id).toContain(id);
    }
  });

  it("the relay rejects a deck or a deploy naming a Pebble Golem", () => {
    const ids = playableCardIds();
    expect(ids.has("pebble-golem")).toBe(false);
    expect(ids.has("stone-golem")).toBe(true);
    const deck = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon"];
    const mode = { elixirRate: 1, mirror: false };
    const msg = (last: string) => JSON.stringify({ t: "create", deck: [...deck, last], mode });
    expect(parseClientMsg(msg("pebble-golem"), ids)).toEqual({ error: "bad-message" });
    expect(parseClientMsg(msg("stone-golem"), ids)).toMatchObject({ t: "create" });
    const frame = { tick: 3, side: "player", commands: [{ side: "player", cardId: "pebble-golem", x: 9, y: 20 }] };
    expect(parseClientMsg(JSON.stringify({ t: "frame", frame }), ids)).toEqual({ error: "bad-message" });
  });

  it("is never offered by a draft or dealt as the daily deck", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = createDraft(seed);
      expect(d.offers).not.toContain("pebble-golem");
      expect(d.remaining).not.toContain("pebble-golem");
    }
    for (let day = 1; day <= 60; day++) {
      const deck = dailyDeck(`2026-11-${String((day % 28) + 1).padStart(2, "0")}#${day}`);
      expect(deck).not.toContain("pebble-golem");
      expect(isFairDailyDeck(deck)).toBe(true);
    }
    expect(isFairDailyDeck(["pebble-golem", "giant", "knight", "archers", "zap", "bats", "minions", "cannon"])).toBe(false);
  });

  it("costs nothing and comes one at a time", () => {
    const c = getCard("pebble-golem");
    expect(c.kind).toBe("troop");
    if (c.kind !== "troop") return;
    expect(c.cost).toBe(0);
    expect(c.count).toBe(1);
    expect(c.token).toBe(true);
  });
});

describe("digger", () => {
  it("deploys anywhere dry on the field, the enemy half included", () => {
    const b = createBattle();
    giveHand(b, "player", ["digger"]);
    expect(checkDeploy(b, "player", "digger", 9, 9)).toBe("ok");
    expect(checkDeploy(b, "player", "digger", 1, 1)).toBe("ok"); // the enemy's back corner
    expect(checkDeploy(b, "player", "digger", 9, 24)).toBe("ok"); // own half too
    expect(checkDeploy(b, "player", "digger", 3.5, 16)).toBe("ok"); // a bridge
    // A normal troop still can't go there.
    giveHand(b, "player", ["knight"]);
    expect(checkDeploy(b, "player", "knight", 9, 9)).toBe("bad-spot");
  });

  it("is rejected in the river and on a tower or building body", () => {
    const b = createBattle();
    giveHand(b, "player", ["digger", "cannon"]);
    const tower = enemyPrincess(b);
    expect(checkDeploy(b, "player", "digger", 9, 16)).toBe("bad-spot"); // river water
    expect(checkDeploy(b, "player", "digger", 9, 15.5)).toBe("bad-spot");
    expect(checkDeploy(b, "player", "digger", tower.x, tower.y)).toBe("bad-spot");
    expect(checkDeploy(b, "player", "digger", tower.x, tower.y + 1.5)).toBe("bad-spot"); // < radius + 0.6
    expect(checkDeploy(b, "player", "digger", tower.x, tower.y + 1.7)).toBe("ok");
    expect(checkDeploy(b, "player", "digger", 9, 2.5)).toBe("bad-spot"); // the enemy King
    expect(checkDeploy(b, "player", "digger", 9, 29.5)).toBe("bad-spot"); // our own King
    expect(deployCard(b, "player", "cannon", 9, 24)).toBe(true);
    expect(checkDeploy(b, "player", "digger", 9.5, 24)).toBe("bad-spot"); // a building body
    expect(checkDeploy(b, "player", "digger", 18.5, 9)).toBe("bad-spot"); // off the field
  });

  it("costs 3 and burrows for the King-to-spot distance at 8 tiles/s, at most 3.3 s", () => {
    const b = createBattle();
    giveHand(b, "player", ["digger"]);
    expect(deployCard(b, "player", "digger", 9, 9)).toBe(true);
    expect(b.player.elixir.amount).toBeCloseTo(7, 9);
    const dig = b.entities.find((e) => e.cardId === "digger")!;
    expect(dig.burrowTotal).toBeCloseTo((29.5 - 9) / 8, 9);
    expect(dig.burrowTimer).toBe(dig.burrowTotal);
    expect(burrowSeconds(b, "player", 1, 1)).toBe(3.3);
    expect(burrowSeconds(b, "enemy", 9, 2.5)).toBe(0);
    // spawnUnits (challenge waves, tests) fields it on the surface.
    expect(spawnUnits(b, "player", "digger", 9, 20)[0].burrowTimer).toBe(0);
  });

  it("is invisible to towers and immune to Arrows while burrowed", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, "player", ["digger"]);
    giveHand(b, "enemy", ["arrows"]);
    expect(deployCard(b, "player", "digger", tower.x, tower.y + 2.2)).toBe(true);
    const dig = b.entities.find((e) => e.cardId === "digger")!;
    run(b, 1);
    expect(dig.burrowTimer).toBeGreaterThan(0);
    expect(tower.targetId).not.toBe(dig.id);
    expect(b.projectiles.some((p) => p.targetId === dig.id)).toBe(false);
    expect(deployCard(b, "enemy", "arrows", dig.x, dig.y)).toBe(true);
    expect(dig.hp).toBe(dig.maxHp);
    // Nor does anything shove it around underground.
    const [k] = spawnUnits(b, "enemy", "knight", dig.x, dig.y);
    const before = { x: dig.x, y: dig.y };
    tick(b, DT);
    expect({ x: dig.x, y: dig.y }).toEqual(before);
    expect(k.hp).toBeGreaterThan(0);
  });

  it("surfaces after its tunnel, then fights after the usual 1 s pop-up", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, "player", ["digger"]);
    deployCard(b, "player", "digger", tower.x, tower.y + 2.2);
    const dig = b.entities.find((e) => e.cardId === "digger")!;
    const total = dig.burrowTotal;
    let emergedAt = -1;
    let firstHitAt = -1;
    const startHp = tower.hp;
    while (b.time < total + 2 && firstHitAt < 0) {
      b.events.length = 0;
      tick(b, DT);
      if (emergedAt < 0 && b.events.some((e) => e.type === "emerge" && e.cardId === "digger")) emergedAt = b.time;
      if (tower.hp < startHp) firstHitAt = b.time;
    }
    expect(emergedAt).toBeGreaterThan(total - DT);
    expect(emergedAt).toBeLessThan(total + DT * 1.5);
    // It cannot swing before the pop-up ends: burrowTotal + 1 s.
    expect(firstHitAt).toBeGreaterThan(total + 1);
    expect(firstHitAt).toBeLessThan(total + 1 + 0.2);
    expect(dig.targetId).toBe(tower.id);
  });

  it("chips crown towers for 35% (56 a hit) but hits troops in full", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    const [dig] = spawnUnits(b, "player", "digger", tower.x, tower.y + 2.2);
    dig.deployTimer = 0;
    const before = tower.hp;
    for (let i = 0; i < 60 && tower.hp === before; i++) tick(b, DT);
    expect(before - tower.hp).toBeCloseTo(56, 9);

    const b2 = createBattle();
    const [d2] = spawnUnits(b2, "player", "digger", 9, RIVER_Y + 3);
    const [k] = spawnUnits(b2, "enemy", "knight", 9, RIVER_Y + 3.9);
    d2.deployTimer = 0;
    k.deployTimer = 5;
    for (let i = 0; i < 60 && k.hp === k.maxHp; i++) tick(b2, DT);
    expect(k.maxHp - k.hp).toBe(160);
  });
});

describe("comet", () => {
  it("lands 1.8 s after the cast and not before, for 400 on a crown tower", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, "player", ["comet"]);
    expect(deployCard(b, "player", "comet", tower.x, tower.y)).toBe(true);
    expect(b.player.elixir.amount).toBeCloseTo(4, 9);
    expect(b.events).toContainEqual({ type: "spell", side: "player", cardId: "comet", x: tower.x, y: tower.y });
    expect(b.pendingSpells).toHaveLength(1);
    const full = tower.hp;
    for (let i = 0; i < 53; i++) tick(b, DT); // 1.767 s
    expect(tower.hp).toBe(full);
    expect(b.pendingSpells).toHaveLength(1);
    b.events.length = 0;
    tick(b, DT); // 1.8 s
    expect(b.pendingSpells).toHaveLength(0);
    expect(full - tower.hp).toBeCloseTo(400, 6);
    expect(b.events).toContainEqual({ type: "spell-land", side: "player", cardId: "comet", x: tower.x, y: tower.y });
    expect(b.player.stats.damageByCard.comet).toBeCloseTo(400, 6);
  });

  it("knocks survivors back, and misses anyone who walked out", () => {
    const b = createBattle();
    giveHand(b, "player", ["comet"]);
    const [pekka] = spawnUnits(b, "enemy", "pekka", 10, 10);
    const [dodger] = spawnUnits(b, "enemy", "knight", 8, 10);
    pekka.deployTimer = 99; // stands still
    dodger.deployTimer = 99;
    deployCard(b, "player", "comet", 9, 10);
    run(b, 1);
    dodger.x = 3; // walks out of the blast before it lands
    run(b, 1);
    expect(pekka.maxHp - pekka.hp).toBe(1000);
    expect(pekka.x).toBeCloseTo(11, 6);
    expect(dodger.hp).toBe(dodger.maxHp);
  });

  it("is level-scaled when cast", () => {
    const b = createBattle(undefined, undefined, { player: { comet: 3 } });
    giveHand(b, "player", ["comet"]);
    deployCard(b, "player", "comet", 9, 10);
    expect(b.pendingSpells[0].damage).toBeCloseTo(1000 * levelMultiplier({ comet: 3 }, "comet"), 9);
  });

  it("never lands once the match is over", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, "player", ["comet"]);
    deployCard(b, "player", "comet", tower.x, tower.y);
    b.result = { winner: "enemy", playerCrowns: 0, enemyCrowns: 3 };
    run(b, 3);
    expect(tower.hp).toBe(tower.maxHp);
  });
});

describe("the bot and the new cards", () => {
  function playerPrincess(b: BattleState, left = true): Entity {
    return b.entities.find((e) => e.side === "player" && e.kind === "princess-tower" && e.x < 9 === left)!;
  }

  it("leads a push with the Stone Golem, a win condition", () => {
    const b = createBattle();
    giveHand(b, "enemy", ["stone-golem", "knight", "archers", "musketeer"]);
    botThink(b, createBot(3));
    const golem = b.entities.find((e) => e.cardId === "stone-golem");
    expect(golem?.side).toBe("enemy");
    expect(golem!.y).toBeLessThan(RIVER_Y);
  });

  it("treats a Stone Golem on the field as a tank and feeds its lane", () => {
    const b = createBattle();
    const [golem] = spawnUnits(b, "enemy", "stone-golem", 14.5, 10);
    giveHand(b, "enemy", ["knight", "archers", "musketeer", "minions"]);
    botThink(b, createBot(3));
    const support = b.entities.filter((e) => e.side === "enemy" && e.kind === "troop" && e !== golem);
    expect(support.length).toBeGreaterThan(0);
    for (const u of support) expect(Math.abs(u.x - 14.5)).toBeLessThan(2);
  });

  it("tunnels the Digger behind the weakest princess tower, or the other one", () => {
    const b = createBattle();
    const right = playerPrincess(b, false);
    right.hp = 900;
    giveHand(b, "enemy", ["digger", "knight", "archers", "musketeer"]);
    botThink(b, createBot(3));
    const dig = b.entities.find((e) => e.cardId === "digger")!;
    expect(dig.side).toBe("enemy");
    expect(dig.x).toBe(right.x);
    expect(dig.y).toBeCloseTo(right.y + right.radius + 1.2, 9); // the far side, away from the river
    expect(dig.burrowTimer).toBeGreaterThan(0);

    // The weakest tower's far side is blocked by a building: the other tower.
    const b2 = createBattle();
    const r2 = playerPrincess(b2, false);
    r2.hp = 900;
    giveHand(b2, "player", ["cannon"]);
    b2.player.elixir = { amount: 10 };
    expect(deployCard(b2, "player", "cannon", r2.x, r2.y + 2.2)).toBe(true);
    giveHand(b2, "enemy", ["digger", "knight", "archers", "musketeer"]);
    botThink(b2, createBot(3));
    const d2 = b2.entities.find((e) => e.cardId === "digger")!;
    expect(d2.x).toBe(playerPrincess(b2, true).x);
  });

  it("drops the Comet on two valuable troops", () => {
    const b = createBattle();
    giveHand(b, "enemy", ["comet", "knight", "archers", "giant"]);
    spawnUnits(b, "player", "wizard", 9, RIVER_Y - 3);
    spawnUnits(b, "player", "musketeer", 9.6, RIVER_Y - 3.2);
    botThink(b, createBot(3));
    expect(b.pendingSpells).toHaveLength(1);
    expect(b.pendingSpells[0].side).toBe("enemy");
    expect(b.pendingSpells[0].x).toBeCloseTo(9.3, 6);
  });

  it("finishes a 400 HP tower with the Comet, then leaves it to the falling rock", () => {
    const b = createBattle();
    const tower = playerPrincess(b);
    tower.hp = 200;
    giveHand(b, "enemy", ["comet", "fireball", "knight", "archers"]);
    const bot = createBot(3);
    botThink(b, bot);
    expect(b.pendingSpells.map((p) => p.cardId)).toEqual(["comet"]);
    const left = b.enemy.elixir.amount;
    b.enemy.elixir = { amount: 10 };
    botThink(b, bot); // a Fireball would also kill it, but the Comet is already falling
    expect(b.enemy.lastPlayed).not.toBe("fireball");
    expect(b.effects.some((f) => f.cardId === "fireball")).toBe(false);
    expect(left).toBeCloseTo(4, 9);
    for (let i = 0; i < 60; i++) tick(b, DT);
    expect(b.entities.includes(tower)).toBe(false);
    expect(b.enemy.crowns).toBe(1);
  });

  it("stays inert without the new cards in hand", () => {
    const b = createBattle();
    giveHand(b, "enemy", ["knight", "archers", "musketeer", "fireball"]);
    b.enemy.elixir = { amount: 5 };
    botThink(b, createBot(3));
    expect(b.entities.filter((e) => e.side === "enemy" && e.kind === "troop")).toHaveLength(0);
    expect(b.pendingSpells).toHaveLength(0);
  });

  it("a seeded bot-vs-bot match plays every new card on both sides", () => {
    const deck: CardId[] = ["stone-golem", "digger", "comet", "knight", "archers", "musketeer", "fireball", "zap"];
    const b = createBattle(deck, deck);
    const bp = createBot(4, { side: "player" });
    const be = createBot(4 ^ 0x9e3779b9);
    const played = { player: new Set<CardId>(), enemy: new Set<CardId>() };
    while (!b.result && b.time < BATTLE_DURATION + OVERTIME_DURATION + 1) {
      tick(b, DT);
      tickBot(b, be, DT);
      tickBot(b, bp, DT);
      for (const ev of b.events) if (ev.type === "deploy" || ev.type === "spell") played[ev.side].add(ev.cardId);
      b.events.length = 0;
    }
    for (const side of ["player", "enemy"] as const) {
      for (const id of ["stone-golem", "digger", "comet"] as const) expect(played[side].has(id), `${side} ${id}`).toBe(true);
    }
    expect(b.result).not.toBeNull();
  });
});
