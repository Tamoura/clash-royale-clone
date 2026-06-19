import { describe, expect, it } from "vitest";
import { createBattle, spawnUnits, type BattleState } from "./battle";
import { tick } from "./sim";

const TICK = 1 / 20;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) tick(b, TICK);
}

describe("Ice Wizard chill", () => {
  it("leaves a lingering slow on the troops it hits", () => {
    const b = createBattle();
    spawnUnits(b, "player", "ice-wizard", 9, 14);
    const [victim] = spawnUnits(b, "enemy", "knight", 9, 16);
    run(b, 3);
    expect(victim.slowTimer).toBeGreaterThan(0);
  });
});

describe("Electro Wizard chain", () => {
  it("strikes more than one enemy with a single shot", () => {
    const b = createBattle();
    spawnUnits(b, "player", "electro-wizard", 9, 13);
    const a = spawnUnits(b, "enemy", "knight", 8.4, 16)[0];
    const c = spawnUnits(b, "enemy", "knight", 9.6, 16)[0];
    run(b, 2.5);
    const hurt = [a, c].filter((e) => e.hp < e.maxHp).length;
    expect(hurt).toBe(2);
  });

  it("stuns the troops it zaps", () => {
    const b = createBattle();
    spawnUnits(b, "player", "electro-wizard", 9, 13);
    const [victim] = spawnUnits(b, "enemy", "knight", 9, 16);
    let peakStun = 0;
    for (let i = 0; i < Math.round(2.5 / TICK); i++) {
      tick(b, TICK);
      peakStun = Math.max(peakStun, victim.stunTimer);
    }
    expect(peakStun).toBeGreaterThan(0.5);
  });
});
