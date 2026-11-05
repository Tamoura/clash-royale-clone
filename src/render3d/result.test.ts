import { describe, expect, it } from "vitest";
import { celebrationFor, confettiPlan } from "./result";

describe("result celebration", () => {
  it("a 3-crown win gets its own show; other wins the normal one", () => {
    expect(celebrationFor("win", 3)).toBe("three-crowns");
    expect(celebrationFor("win", 2)).toBe("win");
    expect(celebrationFor("win", 1)).toBe("win");
    expect(celebrationFor("win", 0)).toBe("win"); // a tiebreak win
    expect(celebrationFor("loss", 3)).toBe("none");
    expect(celebrationFor("draw", 3)).toBe("none");
  });

  it("3 crowns throw more and bigger confetti, gold crowns included", () => {
    const three = confettiPlan("three-crowns");
    const win = confettiPlan("win");
    expect(three.pieces).toBeGreaterThan(win.pieces);
    expect(three.scale).toBeGreaterThan(win.scale);
    expect(three.crowns).toBeGreaterThan(0);
    expect(win.crowns).toBe(0);
    expect(win.pieces).toBe(42); // the ordinary win is unchanged
    expect(confettiPlan("none").pieces).toBe(0);
  });
});
