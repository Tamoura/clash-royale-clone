import { describe, expect, it } from "vitest";
import { createBattle, spawnUnits } from "./battle";
import { tick } from "./sim";
import { TOWER_TROOPS } from "./towers";

const DT = 1 / 30;

function princessTowers(b: ReturnType<typeof createBattle>, side: "player" | "enemy") {
  return b.entities.filter((e) => e.side === side && e.kind === "princess-tower");
}

describe("tower troops", () => {
  it("defaults every princess tower to the Princess", () => {
    const b = createBattle();
    for (const t of [...princessTowers(b, "player"), ...princessTowers(b, "enemy")]) {
      expect(t.towerTroop).toBe("princess");
      expect(t.damage).toBe(TOWER_TROOPS.princess.damage);
    }
  });

  it("gives each side its own defender; kings are untouched", () => {
    const b = createBattle(undefined, undefined, {}, 1, { player: "cannoneer", enemy: "duchess" });
    for (const t of princessTowers(b, "player")) {
      expect(t.towerTroop).toBe("cannoneer");
      expect(t.damage).toBe(TOWER_TROOPS.cannoneer.damage);
      expect(t.splashRadius).toBe(TOWER_TROOPS.cannoneer.splashRadius);
    }
    for (const t of princessTowers(b, "enemy")) expect(t.towerTroop).toBe("duchess");
    const kings = b.entities.filter((e) => e.kind === "king-tower");
    for (const k of kings) expect(k.towerTroop).toBeNull();
    // Tower HP is the tower's own, whatever the defender.
    expect(princessTowers(b, "player")[0].maxHp).toBe(princessTowers(b, "enemy")[0].maxHp);
  });

  it("the Dagger Duchess empties her magazine, then reloads one dagger at a time", () => {
    const b = createBattle(undefined, undefined, {}, 1, { player: "duchess" });
    const tower = princessTowers(b, "player")[0];
    // Park a tanky target in range so she fires continuously.
    const [target] = spawnUnits(b, "enemy", "giant", tower.x, tower.y + 3);
    target.hp = 1e9;
    let shots = 0;
    let lastAmmo = tower.ammo!;
    for (let t = 0; t < 4; t += DT) {
      tick(b, DT);
      if (tower.ammo! < lastAmmo) shots++;
      lastAmmo = tower.ammo!;
    }
    // Eight quick daggers land well inside 4s; the mag then sits near
    // empty, trickling back one shot per reloadSeconds.
    expect(shots).toBeGreaterThanOrEqual(8);
    expect(tower.ammo!).toBeLessThan(TOWER_TROOPS.duchess.ammoMax);
    // With no target in range the magazine refills fully.
    target.hp = 0;
    for (let t = 0; t < TOWER_TROOPS.duchess.reloadSeconds * 9; t += DT) tick(b, DT);
    expect(tower.ammo).toBe(TOWER_TROOPS.duchess.ammoMax);
  });

  it("the Cannoneer fires slowly but hits harder per shot than the Princess", () => {
    expect(TOWER_TROOPS.cannoneer.damage).toBeGreaterThan(TOWER_TROOPS.princess.damage * 2);
    expect(TOWER_TROOPS.cannoneer.hitSpeed).toBeGreaterThan(TOWER_TROOPS.princess.hitSpeed * 2);
    // ...while staying in the same DPS neighbourhood so neither is strictly better.
    const dps = (d: { damage: number; hitSpeed: number }) => d.damage / d.hitSpeed;
    expect(dps(TOWER_TROOPS.cannoneer) / dps(TOWER_TROOPS.princess)).toBeGreaterThan(0.8);
    expect(dps(TOWER_TROOPS.cannoneer) / dps(TOWER_TROOPS.princess)).toBeLessThan(1.1);
  });
});
