import { describe, expect, it } from "vitest";
import { projectileStyle } from "./projectiles";

describe("projectile styles", () => {
  it("towers and archers loose arcing arrows", () => {
    expect(projectileStyle(null, "princess-tower").form).toBe("arrow");
    expect(projectileStyle(null, "king-tower").form).toBe("arrow");
    expect(projectileStyle("archers", "troop").form).toBe("arrow");
    expect(projectileStyle("archers", "troop").arc).toBeGreaterThan(0.5);
  });

  it("casters throw glowing orbs in their signature colors", () => {
    const wizard = projectileStyle("wizard", "troop");
    const witch = projectileStyle("witch", "troop");
    expect(wizard.glow).toBe(true);
    expect(witch.glow).toBe(true);
    expect(wizard.color).not.toBe(witch.color);
  });

  it("the musketeer fires a fast ball with a muzzle flash", () => {
    const m = projectileStyle("musketeer", "troop");
    expect(m.muzzleFlash).toBe(true);
    expect(m.duration).toBeLessThan(0.16);
    expect(m.glow).toBe(false);
  });

  it("falls back to a plain ball for unknown ranged attackers", () => {
    const d = projectileStyle("knight", "troop");
    expect(d.form).toBe("orb");
    expect(d.glow).toBe(false);
    expect(d.muzzleFlash).toBe(false);
  });
});
