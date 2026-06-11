import { describe, expect, it } from "vitest";
import { damageLabel } from "./popups";

describe("damage labels", () => {
  it("ignores chip damage", () => {
    expect(damageLabel(3)).toBeNull();
    expect(damageLabel(24)).toBeNull();
  });

  it("rounds the number", () => {
    expect(damageLabel(159.7)?.text).toBe("160");
  });

  it("grows and heats up with the hit size", () => {
    const small = damageLabel(110)!;
    const medium = damageLabel(320)!;
    const huge = damageLabel(750)!;
    expect(medium.scale).toBeGreaterThan(small.scale);
    expect(huge.scale).toBeGreaterThan(medium.scale);
    expect(small.color).not.toBe(huge.color);
  });
});
