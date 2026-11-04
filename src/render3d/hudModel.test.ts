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
import { tick, BATTLE_DURATION, OVERTIME_DURATION } from "../game/sim";
import { tr } from "../ui/i18n";
import {
  MATCH_CLOCK,
  abilitySecondsLeft,
  badSpotReason,
  badSpotText,
  challengeClock,
  chargingText,
  goalText,
  overtimeHint,
  resultReason,
  tiebreakInfo,
  tiebreakText,
  weakestTowerHp,
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

// ---- battle-clarity: the HUD explains goals, tiebreaks and refusals ------------

const towers = (b: BattleState, side: "player" | "enemy") =>
  b.entities.filter((e) => e.side === side && (e.kind === "princess-tower" || e.kind === "king-tower"));

describe("challenge goal clock", () => {
  it("counts down a survive goal; the tutorial and other modes keep the match clock", () => {
    expect(challengeClock(45)).toEqual({ kind: "survive", seconds: 45 });
    expect(challengeClock(1e9)).toBe(MATCH_CLOCK); // the guided first battle
    expect(challengeClock(Number.NaN)).toBe(MATCH_CLOCK);
    expect(challengeClock(undefined)).toBe(MATCH_CLOCK);
    expect(challengeClock(0)).toBe(MATCH_CLOCK);
  });

  it("shows SURVIVE 0:45 counting down to the win", () => {
    const b = createBattle();
    const clock = challengeClock(45);
    const start = hudModel(b, "player", 0, clock);
    expect(start.survive).toBe(true);
    expect(start.clockText).toBe(`${tr("SURVIVE", "اصمد")} ${fmtTime(45)}`);
    b.time = 10.2;
    expect(hudModel(b, "player", 0, clock).clockText.endsWith(fmtTime(35))).toBe(true);
    b.time = 50;
    expect(hudModel(b, "player", 0, clock).clockText.endsWith(fmtTime(0))).toBe(true);
    // The match clock is untouched by default.
    b.time = 10;
    const normal = hudModel(b, "player");
    expect(normal.survive).toBe(false);
    expect(normal.clockText).toBe(fmtTime(BATTLE_DURATION - 10));
  });

  it("states the goal and explains the ending", () => {
    expect(goalText(45)).toContain(fmtTime(45));
    const clock = challengeClock(45);
    const won = createBattle();
    won.time = 45;
    won.result = { winner: "player", playerCrowns: 0, enemyCrowns: 0 };
    expect(resultReason(won, "player", clock)).toBe(tr("You held on!", "صمدت حتى النهاية!"));

    const lost = createBattle();
    const fallen = towers(lost, "player").find((t) => t.kind === "princess-tower")!;
    lost.entities = lost.entities.filter((e) => e !== fallen);
    lost.result = { winner: "enemy", playerCrowns: 0, enemyCrowns: 1 };
    expect(resultReason(lost, "player", clock)).toBe(
      tr("A tower fell! Keep every tower standing", "سقط برج! أبقِ كل أبراجك قائمة"),
    );

    // A forfeit with every tower standing is not blamed on a tower.
    const quit = createBattle();
    quit.result = { winner: "enemy", playerCrowns: 0, enemyCrowns: 0 };
    expect(resultReason(quit, "player", clock)).toBeNull();
    expect(resultReason(createBattle(), "player", clock)).toBeNull(); // still playing
  });
});

describe("tiebreak", () => {
  /** A 0-0 match about to run out of overtime, with the given weakest-tower HP. */
  function tiedAtTheWire(playerHp: number, enemyHp: number): BattleState {
    const b = createBattle();
    b.overtime = true;
    b.time = BATTLE_DURATION + OVERTIME_DURATION - 0.01;
    towers(b, "player").find((t) => t.kind === "princess-tower")!.hp = playerHp;
    towers(b, "enemy").find((t) => t.kind === "princess-tower")!.hp = enemyHp;
    return b;
  }

  it("hints at the rule under the clock during overtime only", () => {
    const b = createBattle();
    expect(hudModel(b, "player").hint).toBeNull();
    b.overtime = true;
    b.time = BATTLE_DURATION + 5;
    expect(hudModel(b, "player").hint).toBe(overtimeHint());
    expect(overtimeHint()).toBe(tr("Tie? Weakest tower loses", "تعادل؟ يخسر صاحب أضعف برج"));
    b.result = { winner: "draw", playerCrowns: 0, enemyCrowns: 0 };
    expect(hudModel(b, "player").hint).toBeNull();
  });

  it("explains a result decided on tower HP with both numbers, from either seat", () => {
    const b = tiedAtTheWire(404, 1200);
    tick(b, 1 / 30);
    expect(b.result?.winner).toBe("enemy"); // the sim's own tiebreak
    expect(weakestTowerHp(b, "player")).toBe(404);
    expect(tiebreakInfo(b, "player")).toEqual({ mine: 404, theirs: 1200 });
    expect(tiebreakInfo(b, "enemy")).toEqual({ mine: 1200, theirs: 404 });
    const text = resultReason(b, "player")!;
    expect(text).toBe(tiebreakText({ mine: 404, theirs: 1200 }));
    expect(text).toContain(fmtNum(404));
    expect(text).toContain(fmtNum(1200));
  });

  it("explains a draw the same way", () => {
    const b = tiedAtTheWire(900, 900);
    tick(b, 1 / 30);
    expect(b.result?.winner).toBe("draw");
    expect(resultReason(b, "player")).toBe(tiebreakText({ mine: 900, theirs: 900 }));
  });

  it("stays quiet for crowns, forfeits and running matches", () => {
    const crowns = createBattle();
    crowns.overtime = true;
    crowns.time = BATTLE_DURATION + OVERTIME_DURATION;
    crowns.result = { winner: "player", playerCrowns: 1, enemyCrowns: 0 };
    expect(tiebreakInfo(crowns, "player")).toBeNull();
    const forfeit = createBattle();
    forfeit.time = 100;
    forfeit.result = { winner: "enemy", playerCrowns: 0, enemyCrowns: 0 };
    expect(tiebreakInfo(forfeit, "player")).toBeNull();
    expect(resultReason(forfeit, "player")).toBeNull();
    expect(tiebreakInfo(tiedAtTheWire(5, 9), "player")).toBeNull();
  });

  it("never shows a standing tower as 0 HP", () => {
    expect(tiebreakText({ mine: 0.3, theirs: 1999.2 })).toContain(fmtNum(1));
    expect(tiebreakText({ mine: 0.3, theirs: 1999.2 })).toContain(fmtNum(2000));
  });
});

describe("KING not ready", () => {
  it("counts the seconds until the ability is charged", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "rally" });
    b.player.abilityCharge = 0.5;
    expect(abilitySecondsLeft(b, "player")).toBe(28); // 27.5 s of a 55 s meter, rounded up
    b.player.abilityCharge = 1;
    expect(abilitySecondsLeft(b, "player")).toBe(0);
    expect(abilitySecondsLeft(createBattle(), "player")).toBeNull();
    expect(chargingText(28)).toContain(fmtNum(28));
  });
});

describe("refused drops", () => {
  it("says 'your side only' for the shut enemy half and the river", () => {
    const b = createBattle();
    expect(badSpotReason(b, "player", b.player.hand.cards[0], 9, 8)).toBe("side");
    expect(badSpotReason(b, "player", "knight", 9, 8)).toBe("side");
    expect(badSpotReason(b, "player", "knight", 9, 16)).toBe("side"); // the river
    expect(badSpotText("side")).toBe(tr("Your side only!", "في جهتك فقط!"));
    // The guest's own half is the top one.
    expect(badSpotReason(b, "enemy", b.enemy.hand.cards[0], 9, 24)).toBe("side");
  });

  it("says 'too close to a tower' inside an opened lane", () => {
    const b = createBattle();
    const left = towers(b, "enemy").find((t) => t.kind === "princess-tower" && t.x < 9)!;
    b.entities = b.entities.filter((e) => e !== left); // the left lane opens
    expect(badSpotReason(b, "player", "knight", 3.5, 5)).toBeNull(); // clear of the king
    expect(badSpotReason(b, "player", "knight", 8, 4)).toBe("tower"); // inside the king's buffer
    expect(badSpotText("tower")).toBe(tr("Too close to a tower!", "قريب جدًا من البرج!"));
  });

  it("has nothing to say for good spots, spells and cards not in hand", () => {
    const b = createBattle();
    expect(badSpotReason(b, "player", "knight", 9, 24)).toBeNull();
    expect(badSpotReason(b, "player", "fireball", -3, 8)).toBeNull();
    expect(badSpotReason(b, "player", "pekka", 9, 8)).toBeNull();
  });
});
