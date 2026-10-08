import { describe, expect, it } from "vitest";
import { createBattle, type BattleState } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { cardDisplayName } from "../render/cardNames";
import { fmtNum, fmtTime } from "../ui/i18n";
import {
  TowerDamageTracker,
  buildResultStats,
  hudModel,
  lossTip,
  mergeTimeline,
  quantiseElixirPct,
  resultModel,
  type ResultStats,
} from "./hudModel";

function battleWithHand(cards: CardId[], elixir: number): BattleState {
  const b = createBattle();
  b.player.hand = { cards, queue: b.player.hand.queue };
  b.player.elixir = { ...b.player.elixir, amount: elixir };
  return b;
}

describe("hudModel", () => {
  it("quantises the elixir bar to half a percent", () => {
    expect(quantiseElixirPct(5)).toBe(50);
    expect(quantiseElixirPct(5.03)).toBe(50.5);
    expect(quantiseElixirPct(12)).toBe(100);
    expect(quantiseElixirPct(-1)).toBe(0);
    // Sub-step elixir growth leaves the model untouched (no DOM write).
    const a = hudModel(battleWithHand(["knight", "archers", "giant", "fireball"], 5.0), "player");
    const b = hudModel(battleWithHand(["knight", "archers", "giant", "fireball"], 5.02), "player");
    expect(a.elixirPct).toBe(b.elixirPct);
    expect(a.elixirInt).toBe(5);
  });

  it("checks affordability against elixir minus the pending spend", () => {
    const cost = getCard("giant").cost;
    const b = battleWithHand(["giant", "knight", "archers", "fireball"], cost);
    const free = hudModel(b, "player").hand[0];
    expect(free).toMatchObject({ id: "giant", cost, affordable: true, chargePct: 100, need: 0 });
    const held = hudModel(b, "player", 1).hand[0];
    expect(held.affordable).toBe(false);
    expect(held.need).toBe(1);
    expect(held.chargePct).toBe(Math.floor(((cost - 1) / cost) * 100));
  });

  it("marks a Mirror with nothing to copy as dead", () => {
    const slot = hudModel(battleWithHand(["mirror", "knight", "archers", "giant"], 10), "player").hand[0];
    expect(slot).toMatchObject({ cost: null, affordable: false, chargePct: 0 });
  });

  it("reports the King's ability charge and readiness", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "rally" });
    b.player.abilityCharge = 0.5;
    expect(hudModel(b, "player").ability).toEqual({ id: "rally", pct: 50, ready: false });
    b.player.abilityCharge = 1;
    expect(hudModel(b, "player").ability).toEqual({ id: "rally", pct: 100, ready: true });
    expect(hudModel(createBattle(), "player").ability.id).toBeNull();
  });

  it("maps the result to the local side's point of view", () => {
    const b = createBattle();
    expect(hudModel(b, "player").result).toBeNull();
    b.result = { winner: "enemy", playerCrowns: 1, enemyCrowns: 3 };
    expect(resultModel(b, "player")).toEqual({ outcome: "loss", myCrowns: 1, theirCrowns: 3 });
    expect(hudModel(b, "enemy").result).toEqual({ outcome: "win", myCrowns: 3, theirCrowns: 1 });
    b.result = { winner: "draw", playerCrowns: 1, enemyCrowns: 1 };
    expect(resultModel(b, "player")?.outcome).toBe("draw");
    // Double elixir stops reading once the match is over.
    expect(hudModel(b, "player").leak).toBe(false);
  });

  it("formats the clock and the overtime prefix", () => {
    const b = createBattle();
    b.time = 60.2;
    expect(hudModel(b, "player").clockText).toBe(fmtTime(120));
    b.overtime = true;
    b.time = 200;
    const m = hudModel(b, "player");
    expect(m.overtime).toBe(true);
    expect(m.clockText.endsWith(fmtTime(100))).toBe(true);
    expect(m.clockText.length).toBeGreaterThan(fmtTime(100).length);
  });
});

describe("mergeTimeline", () => {
  it("merges three identical lines into one counted line", () => {
    const e = { t: 6, mine: false, tower: "princess" as const };
    const lines = mergeTimeline([e, e, e]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain(fmtNum(3));
    expect(lines[0].text).toContain(` · ${fmtTime(6)}`);
    expect(lines[0].mine).toBe(false);
  });

  it("keeps different towers, sides and distant falls apart", () => {
    const lines = mergeTimeline([
      { t: 90, mine: true, tower: "princess" },
      { t: 40, mine: false, tower: "princess" },
      { t: 41, mine: false, tower: "king" },
      { t: 150, mine: true, tower: "princess" },
    ]);
    expect(lines.map((l) => l.mine)).toEqual([false, false, true, true]);
    expect(lines[0].text).toContain(fmtTime(40));
    expect(lines[0].text).not.toContain(fmtNum(2));
  });
});

describe("lossTip", () => {
  const stats = (enemy: Partial<Record<CardId, number>>): ResultStats => ({
    ...buildResultStats(createBattle(), "player"),
    towerDamage: { player: {}, enemy },
  });

  it("names the enemy card that hurt the towers most", () => {
    const tip = lossTip(stats({ giant: 1800, arrows: 200 }), "player");
    expect(tip).not.toBeNull();
    expect(tip).toContain(cardDisplayName("giant"));
    expect(tip).not.toContain(cardDisplayName("arrows"));
    // The guest reads the other table.
    expect(lossTip(stats({ giant: 1800 }), "enemy")).toBeNull();
  });

  it("suggests a counter that fits the card's targeting", () => {
    const building = lossTip(stats({ giant: 10 }), "player");
    const air = lossTip(stats({ minions: 10 }), "player");
    const spell = lossTip(stats({ fireball: 10 }), "player");
    expect(new Set([building, air, spell]).size).toBe(3);
  });

  it("is silent when no enemy card touched a tower", () => {
    expect(lossTip(stats({}), "player")).toBeNull();
  });
});

describe("TowerDamageTracker", () => {
  it("credits a tower's HP drop to the card that attacked it", () => {
    const b = createBattle();
    const tracker = new TowerDamageTracker();
    tracker.observe(b);
    const tower = b.entities.find((e) => e.side === "player" && e.kind === "princess-tower")!;
    tracker.noteEvent(
      { type: "attack", kind: "troop", cardId: "giant", ranged: false, x: tower.x, y: tower.y - 1, targetX: tower.x, targetY: tower.y },
      b.time,
    );
    tower.hp -= 300;
    b.time += 0.5;
    tracker.observe(b);
    expect(tracker.bySide.enemy.giant).toBeCloseTo(300);
    expect(tracker.bySide.player).toEqual({});
    // A destroyed tower's remaining HP is credited too.
    tracker.noteEvent({ type: "spell", side: "enemy", cardId: "fireball", x: tower.x, y: tower.y }, b.time);
    const left = tower.hp;
    b.entities = b.entities.filter((e) => e !== tower);
    tracker.observe(b);
    expect((tracker.bySide.enemy.giant ?? 0) + (tracker.bySide.enemy.fireball ?? 0)).toBeCloseTo(300 + left);
    // The stats snapshot copies the table.
    const s = buildResultStats(b, "player", tracker.bySide);
    tracker.reset();
    expect(s.towerDamage.enemy.giant).toBeGreaterThan(300);
    expect(tracker.bySide.enemy).toEqual({});
  });
});
