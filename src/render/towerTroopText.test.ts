import { describe, expect, it } from "vitest";
import { TOWER_TROOPS, TOWER_TROOP_IDS, TOWER_TROOP_KEY } from "../game/towers";
import { towerTroopBlurbIn, towerTroopNameIn } from "./towerTroopText";

describe("tower troop text on screen", () => {
  it("the Duchess is the Swift Duchess, with a gentler blurb", () => {
    expect(towerTroopNameIn("duchess", false)).toBe("Swift Duchess");
    expect(towerTroopNameIn("duchess", true)).toBe("الدوقة السريعة");
    for (const id of TOWER_TROOP_IDS) {
      expect(`${towerTroopNameIn(id, false)} ${towerTroopBlurbIn(id, false)}`).not.toMatch(/Dagger Duchess|deadly/i);
      expect(`${towerTroopNameIn(id, true)} ${towerTroopBlurbIn(id, true)}`).not.toMatch(/دوقة الخناجر|قاتل/);
    }
  });

  it("the Princess and the Cannoneer keep their names", () => {
    expect(towerTroopNameIn("princess", false)).toBe(TOWER_TROOPS.princess.name);
    expect(towerTroopNameIn("cannoneer", true)).toBe(TOWER_TROOPS.cannoneer.ar);
  });

  it("ids and the storage key stay (saves and the online loadout hold them)", () => {
    expect(TOWER_TROOP_IDS).toEqual(["princess", "cannoneer", "duchess"]);
    expect(TOWER_TROOP_KEY).toBe("cr-clone-tower-troop");
  });
});
