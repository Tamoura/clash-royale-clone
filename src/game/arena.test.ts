import { describe, expect, it } from "vitest";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_XS,
  RIVER_Y,
  canDeployTroopAt,
  nearestBridgeX,
  towerSpots,
} from "./arena";

describe("arena geometry", () => {
  it("is 18x32 tiles with the river in the middle", () => {
    expect(ARENA_WIDTH).toBe(18);
    expect(ARENA_HEIGHT).toBe(32);
    expect(RIVER_Y).toBe(16);
    expect(BRIDGE_XS).toHaveLength(2);
  });

  it("places 2 princess towers and 1 king tower per side, mirrored", () => {
    const player = towerSpots("player");
    const enemy = towerSpots("enemy");
    expect(player.filter((t) => t.kind === "princess")).toHaveLength(2);
    expect(player.filter((t) => t.kind === "king")).toHaveLength(1);
    for (const t of player) expect(t.y).toBeGreaterThan(RIVER_Y);
    for (const t of enemy) expect(t.y).toBeLessThan(RIVER_Y);
    // mirrored across the river
    const px = player.map((t) => t.x).sort((a, b) => a - b);
    const ex = enemy.map((t) => t.x).sort((a, b) => a - b);
    expect(px).toEqual(ex);
  });

  it("only allows troop deployment on your own half", () => {
    expect(canDeployTroopAt("player", 9, 24)).toBe(true);
    expect(canDeployTroopAt("player", 9, 8)).toBe(false);
    expect(canDeployTroopAt("enemy", 9, 8)).toBe(true);
    expect(canDeployTroopAt("enemy", 9, 24)).toBe(false);
  });

  it("rejects deployment outside the arena or in the river", () => {
    expect(canDeployTroopAt("player", -1, 24)).toBe(false);
    expect(canDeployTroopAt("player", 9, 33)).toBe(false);
    expect(canDeployTroopAt("player", 9, RIVER_Y)).toBe(false);
  });

  it("finds the nearest bridge", () => {
    expect(nearestBridgeX(2)).toBe(BRIDGE_XS[0]);
    expect(nearestBridgeX(16)).toBe(BRIDGE_XS[1]);
  });
});
