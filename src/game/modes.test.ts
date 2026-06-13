import { describe, expect, it } from "vitest";
import { createBattle } from "./battle";
import { effectiveElixirMultiplier, tick } from "./sim";

describe("elixir-rate game modes", () => {
  it("defaults to a 1x rate", () => {
    const b = createBattle();
    expect(b.elixirRate).toBe(1);
    expect(effectiveElixirMultiplier(b)).toBe(1);
  });

  it("a triple-elixir match runs a flat 3x from the start", () => {
    const b = createBattle(undefined, undefined, {}, 3);
    expect(b.elixirRate).toBe(3);
    expect(effectiveElixirMultiplier(b)).toBe(3); // overrides the early-game 1x curve
  });

  it("a 7x mega match fills elixir far faster than normal", () => {
    const normal = createBattle();
    const mega = createBattle(undefined, undefined, {}, 7);
    const before = normal.player.elixir.amount;
    for (let i = 0; i < 30; i++) {
      tick(normal, 1 / 30);
      tick(mega, 1 / 30);
    }
    const normalGain = normal.player.elixir.amount - before;
    const megaGain = mega.player.elixir.amount - before;
    expect(megaGain).toBeGreaterThan(normalGain * 3);
  });
});
