import { describe, expect, it } from "vitest";
import { createBattle, spawnUnits } from "./battle";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "./sim";

const TICK = 1 / 20;

describe("match flow", () => {
  it("ends at 180s with the crown leader winning", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION - TICK / 2;
    b.player.crowns = 1;
    tick(b, TICK);
    expect(b.result).toEqual({
      winner: "player",
      playerCrowns: 1,
      enemyCrowns: 0,
    });
  });

  it("goes to overtime on a crown tie", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION - TICK / 2;
    b.player.crowns = 1;
    b.enemy.crowns = 1;
    tick(b, TICK);
    expect(b.result).toBeNull();
    expect(b.overtime).toBe(true);
  });

  it("first crown in overtime wins immediately", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION;
    b.overtime = true;
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    tower.hp = 1;
    spawnUnits(b, "player", "mini-pekka", tower.x, tower.y + 1.5);
    for (let i = 0; i < 20 * 5 && !b.result; i++) tick(b, TICK);
    expect(b.result?.winner).toBe("player");
  });

  it("a fully tied overtime ends in a draw", () => {
    const b = createBattle();
    b.overtime = true;
    b.time = BATTLE_DURATION + OVERTIME_DURATION - TICK / 2;
    tick(b, TICK);
    expect(b.result?.winner).toBe("draw");
  });

  it("destroying the king ends the battle instantly with 3 crowns", () => {
    const b = createBattle();
    const king = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "king-tower",
    )!;
    king.hp = 1;
    spawnUnits(b, "player", "mini-pekka", king.x, king.y + 2);
    for (let i = 0; i < 20 * 10 && !b.result; i++) tick(b, TICK);
    expect(b.result).toEqual({
      winner: "player",
      playerCrowns: 3,
      enemyCrowns: 0,
    });
  });

  it("ticking after the result is set changes nothing", () => {
    const b = createBattle();
    b.time = BATTLE_DURATION;
    b.player.crowns = 2;
    tick(b, TICK);
    expect(b.result?.winner).toBe("player");
    const snapshot = JSON.stringify(b);
    tick(b, TICK);
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});
