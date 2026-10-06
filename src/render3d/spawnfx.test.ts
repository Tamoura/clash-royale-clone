import { describe, expect, it } from "vitest";
import { DEPLOY_DELAY } from "../game/battle";
import {
  DROP_FALL,
  DROP_HEIGHT,
  DROP_STAGGER_CAP,
  dropDelay,
  dropDuration,
  dropPose,
  spawnRecipe,
  spawnStyle,
  type DropPose,
} from "./spawnfx";

describe("spawn styles", () => {
  it("skeletons claw their way out of the ground", () => {
    expect(spawnStyle("skeletons")).toBe("rise");
    expect(spawnStyle("skeleton-army")).toBe("rise");
  });

  it("the Mega Knight slams down from the sky", () => {
    expect(spawnStyle("mega-knight")).toBe("slam");
  });

  it("everyone else drops in", () => {
    expect(spawnStyle("knight")).toBe("drop");
    expect(spawnStyle("balloon")).toBe("drop");
    expect(spawnStyle(null)).toBe("drop");
  });

  it("special deploys use recognizable accent colors and burst scales", () => {
    expect(spawnRecipe("electro-wizard").color).not.toBe(spawnRecipe("witch").color);
    expect(spawnRecipe("mega-knight").burst).toBeGreaterThan(spawnRecipe("knight").burst);
  });
});

describe("drop-in entrance", () => {
  const pose = (): DropPose => ({ visible: true, y: 0, sx: 1, sy: 1, sz: 1 });

  it("staggers a swarm by 45 ms per unit, never past 0.6 s", () => {
    expect(dropDelay(0, DEPLOY_DELAY)).toBe(0);
    expect(dropDelay(1, DEPLOY_DELAY)).toBeCloseTo(0.045);
    expect(dropDelay(4, DEPLOY_DELAY)).toBeCloseTo(0.18);
    for (let i = 0; i < 60; i++) {
      expect(dropDelay(i, DEPLOY_DELAY)).toBeLessThanOrEqual(DROP_STAGGER_CAP);
    }
    expect(dropDelay(40, DEPLOY_DELAY)).toBe(DROP_STAGGER_CAP);
  });

  it("no unit is still hidden or airborne when its deploy freeze ends", () => {
    for (const timer of [DEPLOY_DELAY, 0.8, 0.5, 0.3, 0.22, 0.1, 0]) {
      for (let i = 0; i < 30; i++) {
        const delay = dropDelay(i, timer);
        expect(delay).toBeLessThanOrEqual(DROP_STAGGER_CAP);
        const at = dropPose(Math.max(timer, DROP_FALL), delay, pose());
        expect(at.visible).toBe(true);
        if (timer >= DROP_FALL) {
          // Landed (falling no longer) by the time it may act.
          expect(delay + DROP_FALL).toBeLessThanOrEqual(timer + 1e-9);
          expect(dropPose(timer, delay, pose()).y).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it("falls stretched from 2.2 tiles, lands squashed, then settles to rest", () => {
    const start = dropPose(0, 0, pose());
    expect(start.y).toBeCloseTo(DROP_HEIGHT);
    expect(start.sy).toBeCloseTo(1.2);
    expect(start.sx).toBeCloseTo(0.85);
    // Ease-in: the first half of the fall covers less than half the height.
    expect(DROP_HEIGHT - dropPose(DROP_FALL / 2, 0, pose()).y).toBeLessThan(DROP_HEIGHT / 2);
    const land = dropPose(DROP_FALL, 0, pose());
    expect(land.y).toBe(0);
    expect(land.sx).toBeCloseTo(1.25);
    expect(land.sy).toBeCloseTo(0.7);
    const rest = dropPose(dropDuration(0), 0, pose());
    expect(rest.sx).toBe(1);
    expect(rest.sy).toBe(1);
  });

  it("waits hidden through its stagger", () => {
    const p = dropPose(0.05, 0.1, pose());
    expect(p.visible).toBe(false);
  });
});
