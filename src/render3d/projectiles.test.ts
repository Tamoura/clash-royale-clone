import { describe, expect, it } from "vitest";
import { projectileStyle } from "./projectiles";

describe("projectile styles", () => {
  it("towers and archers loose arcing arrows", () => {
    expect(projectileStyle(null, "princess-tower").form).toBe("arrow");
    expect(projectileStyle(null, "king-tower").form).toBe("arrow");
    expect(projectileStyle("archers", "troop").form).toBe("arrow");
    expect(projectileStyle("archers", "troop").arc).toBeGreaterThan(0.5);
  });

  it("casters throw glowing shots in their signature colors", () => {
    const wizard = projectileStyle("wizard", "troop");
    const witch = projectileStyle("witch", "troop");
    expect(wizard.glow).toBe(true);
    expect(witch.glow).toBe(true);
    expect(wizard.color).not.toBe(witch.color);
    expect(wizard.form).toBe("fireball"); // a modelled fireball, not an orb with a cone
    expect(wizard.trail).toBe("embers");
    expect(witch.trail).toBe("sparkle");
  });

  it("every shot has a modelled form (art bible 8)", () => {
    expect(projectileStyle("baby-dragon", "troop").form).toBe("fireball");
    expect(projectileStyle("musketeer", "troop").form).toBe("tracer");
    expect(projectileStyle("electro-wizard", "troop").form).toBe("bolt");
    expect(projectileStyle("ice-wizard", "troop").form).toBe("shard");
    for (const id of ["archers", "magic-archer", "princess"] as const) {
      const a = projectileStyle(id, "troop");
      expect(a.form, id).toBe("arrow");
      expect(a.fletch, id).toBeDefined();
    }
    expect(projectileStyle(null, "princess-tower").fletch).toBeDefined();
  });

  it("the musketeer fires a fast ball with a muzzle flash", () => {
    const m = projectileStyle("musketeer", "troop");
    expect(m.muzzleFlash).toBe(true);
    expect(m.duration).toBeLessThan(0.16);
    expect(m.glow).toBe(false);
  });

  it("the magic archer looses a glowing flat-flying arrow", () => {
    const m = projectileStyle("magic-archer", "troop");
    expect(m.form).toBe("arrow");
    expect(m.glow).toBe(true);
    expect(m.arc).toBeLessThan(0.3); // a piercing line, not a lob
  });

  it("the firecracker spits a glowing spark", () => {
    const f = projectileStyle("firecracker", "troop");
    expect(f.glow).toBe(true);
    expect(f.muzzleFlash).toBe(true);
    expect(f.trail).toBe("embers");
  });

  it("electric shots have a distinct trail and impact flash", () => {
    const electro = projectileStyle("electro-wizard", "troop");
    expect(electro.trail).toBe("electric");
    expect(electro.impactColor).not.toBe(electro.color);
  });

  it("falls back to a plain ball for unknown ranged attackers", () => {
    const d = projectileStyle("knight", "troop");
    expect(d.form).toBe("orb");
    expect(d.glow).toBe(false);
    expect(d.muzzleFlash).toBe(false);
  });
});
