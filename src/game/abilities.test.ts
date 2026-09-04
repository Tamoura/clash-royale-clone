import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  RESTORE_TOWER_HP,
  RESTORE_TROOP_HP,
  SALVO_DAMAGE,
  useAbility,
} from "./abilities";
import { createBattle, spawnUnits } from "./battle";
import { isRaged, tick } from "./sim";

const DT = 1 / 30;

describe("King's Ability", () => {
  it("charges over the match and refuses to fire early", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "rally" });
    expect(b.player.abilityCharge).toBe(0);
    expect(useAbility(b, "player")).toBe(false);
    for (let t = 0; t < ABILITIES.rally.chargeSeconds + 1; t += DT) tick(b, DT);
    expect(b.player.abilityCharge).toBe(1);
    expect(useAbility(b, "player")).toBe(true);
    expect(b.player.abilityCharge).toBe(0); // spent
  });

  it("a side without a chosen ability never charges", () => {
    const b = createBattle();
    for (let t = 0; t < 10; t += DT) tick(b, DT);
    expect(b.player.abilityCharge).toBe(0);
    expect(useAbility(b, "player")).toBe(false);
  });

  it("Rally rages every friendly troop, wherever it stands", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "rally" });
    b.player.abilityCharge = 1;
    const [near] = spawnUnits(b, "player", "knight", 3, 28);
    const [far] = spawnUnits(b, "player", "knight", 15, 18);
    const [foe] = spawnUnits(b, "enemy", "knight", 9, 10);
    useAbility(b, "player");
    expect(isRaged(b, near)).toBe(true);
    expect(isRaged(b, far)).toBe(true);
    expect(isRaged(b, foe)).toBe(false);
  });

  it("Restore heals towers and troops up to their caps", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "restore" });
    b.player.abilityCharge = 1;
    const tower = b.entities.find((e) => e.side === "player" && e.kind === "princess-tower")!;
    tower.hp = 1000;
    const [knight] = spawnUnits(b, "player", "knight", 9, 24);
    knight.hp = 100;
    const [enemyKnight] = spawnUnits(b, "enemy", "knight", 9, 8);
    enemyKnight.hp = 100;
    useAbility(b, "player");
    expect(tower.hp).toBe(1000 + RESTORE_TOWER_HP);
    expect(knight.hp).toBe(100 + RESTORE_TROOP_HP);
    expect(enemyKnight.hp).toBe(100); // not ours
  });

  it("Salvo bombards the enemies nearest our king, credited to no card", () => {
    const b = createBattle(undefined, undefined, {}, 1, {}, { player: "salvo" });
    b.player.abilityCharge = 1;
    // Five giants marching down the lane, spaced past the splash radius;
    // the four nearest our king eat a shell each, the fifth is spared.
    const giants = [26, 22, 18, 14, 4].map((y) => spawnUnits(b, "enemy", "giant", 9, y)[0]);
    useAbility(b, "player");
    for (const g of giants.slice(0, 4)) expect(g.hp).toBe(g.maxHp - SALVO_DAMAGE);
    expect(giants[4].hp).toBe(giants[4].maxHp);
    expect(b.player.stats.damageDealt).toBe(SALVO_DAMAGE * 4);
    expect(b.player.stats.damageByCard.fireball ?? 0).toBe(0); // the King's own shots
  });
});
