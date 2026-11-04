import { describe, expect, it } from "vitest";
import { createBattle, type BattleState } from "../game/battle";
import { DEFAULT_DECK, getCard, type CardId } from "../game/cards";
import { spawnUnits } from "../game/battle";
import {
  BASIC_TIPS,
  LEAK_TIP_ELIXIR,
  chooseCoachTip,
  createDefeatWatch,
  defeatFacts,
  isCoachedDefeat,
  watchEvent,
  type DefeatFacts,
} from "./coachTips";

const plainName = (id: CardId): string => getCard(id).name;

function facts(over: Partial<DefeatFacts> = {}): DefeatFacts {
  return {
    elixirLeaked: 0,
    towerLostToBuildingTargeter: false,
    spellsCast: 2,
    elixirSpent: 30,
    deck: DEFAULT_DECK,
    rotation: 0,
    ...over,
  };
}

const tip = (over: Partial<DefeatFacts> = {}) => chooseCoachTip(facts(over), plainName);

describe("chooseCoachTip", () => {
  it("leaked elixir comes first", () => {
    const t = tip({ elixirLeaked: LEAK_TIP_ELIXIR, towerLostToBuildingTargeter: true, spellsCast: 0 });
    expect(t.id).toBe("leak");
    expect(t.en).toBe("Don't let elixir sit at 10, play a card!");
    expect(t.ar).toMatch(/الإكسير/);
    expect(tip({ elixirLeaked: LEAK_TIP_ELIXIR - 0.5 }).id).not.toBe("leak");
  });

  it("a tower lost to a building-targeter: shooters behind the front troop", () => {
    const t = tip({ towerLostToBuildingTargeter: true, spellsCast: 0 });
    expect(t.id).toBe("building");
    expect(t.en).toBe("Put Musketeer or Archers behind your Knight!");
    expect(t.ar).toContain("Knight"); // names come from nameOf (edition names in the game)
  });

  it("names only what the deck holds, with a generic line otherwise", () => {
    const one = tip({ towerLostToBuildingTargeter: true, deck: ["valkyrie", "wizard", "giant", "zap"] });
    expect(one.en).toBe("Put Wizard behind your Valkyrie!");
    const none = tip({ towerLostToBuildingTargeter: true, deck: ["giant", "hog-rider", "zap", "skeletons"] });
    expect(none.id).toBe("building");
    expect(none.en).not.toMatch(/Musketeer|Knight/);
    expect(none.ar.length).toBeGreaterThan(0);
  });

  it("no spell cast: the deck's group spell", () => {
    const t = tip({ spellsCast: 0 });
    expect(t.id).toBe("spell");
    expect(t.en).toBe("Arrows clears groups of little troops");
    expect(tip({ spellsCast: 0, deck: ["knight", "zap", "giant"] }).en).toBe("Zap clears groups of little troops");
    // A deck with no group spell gets a basic instead of a nag it cannot follow.
    expect(tip({ spellsCast: 0, deck: ["knight", "giant", "rage"] }).id).toMatch(/^basic-/);
  });

  it("no card played at all (an early forfeit): a basic, not the spell nag", () => {
    expect(tip({ spellsCast: 0, elixirSpent: 0 }).id).toMatch(/^basic-/);
    expect(tip({ spellsCast: 0, elixirSpent: 0, rotation: 1 }).id).toBe("basic-1");
    // Sitting at a full bar is still worth the leak tip.
    expect(tip({ spellsCast: 0, elixirSpent: 0, elixirLeaked: LEAK_TIP_ELIXIR }).id).toBe("leak");
  });

  it("otherwise rotates through the basics", () => {
    const seen = new Set<string>();
    for (let r = 0; r < BASIC_TIPS.length; r++) seen.add(tip({ rotation: r }).id);
    expect(seen.size).toBe(BASIC_TIPS.length);
    expect(tip({ rotation: BASIC_TIPS.length }).id).toBe(tip({ rotation: 0 }).id);
    expect(tip({ rotation: -1 }).id).toMatch(/^basic-\d$/);
    for (const [en, ar] of BASIC_TIPS) {
      expect(en.length).toBeGreaterThan(0);
      expect(ar).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("isCoachedDefeat", () => {
  const base = { kind: "ladder" as const, online: false, sandbox: false, replay: false, winner: "enemy" as const, mySide: "player" as const };
  it("only a lost solo ladder match", () => {
    expect(isCoachedDefeat(base)).toBe(true);
    expect(isCoachedDefeat({ ...base, winner: "player" })).toBe(false);
    expect(isCoachedDefeat({ ...base, winner: "draw" })).toBe(false);
    expect(isCoachedDefeat({ ...base, online: true })).toBe(false);
    expect(isCoachedDefeat({ ...base, sandbox: true })).toBe(false);
    expect(isCoachedDefeat({ ...base, replay: true })).toBe(false);
    expect(isCoachedDefeat({ ...base, kind: "challenge" })).toBe(false);
  });
});

describe("watching a match", () => {
  const battle = (): BattleState => createBattle(DEFAULT_DECK, DEFAULT_DECK);
  const myTower = (b: BattleState) => b.entities.find((e) => e.side === "player" && e.kind === "princess-tower")!;

  it("counts my spells only", () => {
    const b = battle();
    const w = createDefeatWatch(b, "player");
    watchEvent(w, { type: "spell", side: "enemy", cardId: "arrows", x: 5, y: 5 });
    expect(w.spells).toBe(0);
    watchEvent(w, { type: "spell", side: "player", cardId: "arrows", x: 5, y: 5 });
    expect(w.spells).toBe(1);
  });

  it("a tower that falls with a building-targeter beside it", () => {
    const b = battle();
    const t = myTower(b);
    spawnUnits(b, "enemy", "giant", t.x, t.y - 2);
    const w = createDefeatWatch(b, "player");
    watchEvent(w, { type: "death", kind: "princess-tower", cardId: null, side: "player", x: t.x, y: t.y });
    expect(w.lostToBuilding).toBe(true);
  });

  it("a building-targeter seen hitting the spot earlier still counts (it died in the blast)", () => {
    const b = battle();
    const t = myTower(b);
    const w = createDefeatWatch(b, "player");
    watchEvent(w, { type: "attack", kind: "troop", cardId: "balloon", ranged: false, x: t.x, y: t.y - 1, targetX: t.x, targetY: t.y });
    watchEvent(w, { type: "death", kind: "princess-tower", cardId: null, side: "player", x: t.x, y: t.y });
    expect(w.lostToBuilding).toBe(true);
  });

  it("not when only other troops took it, or when it was the enemy's tower", () => {
    const b = battle();
    const t = myTower(b);
    spawnUnits(b, "enemy", "knight", t.x, t.y - 2);
    const w = createDefeatWatch(b, "player");
    watchEvent(w, { type: "attack", kind: "troop", cardId: "knight", ranged: false, x: t.x, y: t.y - 1, targetX: t.x, targetY: t.y });
    watchEvent(w, { type: "death", kind: "princess-tower", cardId: null, side: "player", x: t.x, y: t.y });
    expect(w.lostToBuilding).toBe(false);
    spawnUnits(b, "player", "giant", 3, 3);
    watchEvent(w, { type: "death", kind: "princess-tower", cardId: null, side: "enemy", x: 3, y: 3 });
    expect(w.lostToBuilding).toBe(false);
  });

  it("builds the chooser's facts from the battle", () => {
    const b = battle();
    b.player.stats.elixirLeaked = 6.5;
    b.player.stats.elixirSpent = 12;
    const w = createDefeatWatch(b, "player");
    const f = defeatFacts(b, "player", w, 3);
    expect(f.elixirLeaked).toBe(6.5);
    expect(f.elixirSpent).toBe(12);
    expect(f.spellsCast).toBe(0);
    expect([...f.deck].sort()).toEqual([...DEFAULT_DECK].sort());
    expect(f.rotation).toBe(3);
    // No watch (e.g. the coach was installed mid-match): never nag about spells.
    expect(defeatFacts(b, "player", null, 0).spellsCast).toBeGreaterThan(0);
  });
});
