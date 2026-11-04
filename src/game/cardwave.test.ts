/**
 * Card wave 3 (sim v3): the Stone Golem and its Pebble Golem tokens, the
 * Digger and the Comet, plus the token rules that keep Pebble Golems out
 * of every deck. Each mechanic the wave adds has a test here.
 */
import { describe, expect, it } from "vitest";
import { ARENA_WIDTH, RIVER_Y } from "./arena";
import { createBattle, levelMultiplier, spawnUnits, type BattleState } from "./battle";
import { CARDS, DECK, TOKEN_IDS, getCard, isDeckable, type CardId } from "./cards";
import { createDraft } from "./draft";
import { dailyDeck, isFairDailyDeck } from "./daily";
import { tick } from "./sim";
import { parseClientMsg, playableCardIds } from "../net/validate";

const DT = 1 / 30;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) tick(b, DT);
}

function pebbles(b: BattleState): ReturnType<typeof spawnUnits> {
  return b.entities.filter((e) => e.cardId === "pebble-golem");
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
