import { describe, expect, it } from "vitest";
import { ABILITY_IDS } from "../game/abilities";
import { TOWER_TROOP_IDS } from "../game/towers";
import { FEATURE_ARENA } from "../meta/unlocks";
import { botAbilityPool, botTowerTroopPool, pickBotLoadout } from "./botLoadout";

describe("bot loadout fairness", () => {
  it("a brand-new player's bot uses the Princess and Royal Rally", () => {
    for (const r of [0, 0.4, 0.99]) {
      expect(pickBotLoadout(0, () => r)).toEqual({ towerTroop: "princess", ability: "rally" });
    }
    expect(botTowerTroopPool(0)).toEqual(["princess"]);
    expect(botAbilityPool(0)).toEqual(["rally"]);
  });

  it("opens each choice at the arena the player gets it", () => {
    const towers = FEATURE_ARENA.towerTroops;
    const abilities = FEATURE_ARENA.abilities;
    expect(botTowerTroopPool(towers - 1)).toEqual(["princess"]);
    expect(botTowerTroopPool(towers)).toEqual(TOWER_TROOP_IDS);
    expect(botAbilityPool(abilities - 1)).toEqual(["rally"]);
    expect(botAbilityPool(abilities)).toEqual(ABILITY_IDS);
  });

  it("picks across the whole unlocked pool", () => {
    const late = 9;
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const l = pickBotLoadout(late, () => (i % 10) / 10 + 0.05);
      seen.add(l.towerTroop);
      seen.add(l.ability);
    }
    for (const id of [...TOWER_TROOP_IDS, ...ABILITY_IDS]) expect(seen.has(id), id).toBe(true);
    // An rng that returns 1 never reads past the end.
    expect(TOWER_TROOP_IDS).toContain(pickBotLoadout(late, () => 1).towerTroop);
  });
});
