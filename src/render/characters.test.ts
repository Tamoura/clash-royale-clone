import { describe, expect, it } from "vitest";
import { drawCardArt, drawTroopCharacter, STILL } from "./characters";

/** A 2D context stand-in that counts what gets painted. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; fills: () => number; colors: Set<string> } {
  let fills = 0;
  const colors = new Set<string>();
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, key: string) {
        if (key === "fill") return () => {
          fills++;
          if (typeof state.fillStyle === "string") colors.add(state.fillStyle);
        };
        if (key === "createRadialGradient" || key === "createLinearGradient") return () => ({ addColorStop() {} });
        if (key in state) return state[key];
        return () => {};
      },
      set(_t, key: string, value: unknown) {
        state[key] = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, fills: () => fills, colors };
}

describe("2D card art for card wave 3", () => {
  it("the Stone Golem, Pebble Golem and Digger have their own painted fallbacks", () => {
    const seen: string[] = [];
    for (const id of ["stone-golem", "pebble-golem", "digger"] as const) {
      const f = fakeCtx();
      drawTroopCharacter(f.ctx, id, 20, 20, 10, "#3b82f6", STILL);
      expect(f.fills(), id).toBeGreaterThan(6);
      seen.push([...f.colors].sort().join(","));
    }
    expect(new Set(seen).size).toBe(3); // three different looks
  });

  it("the Comet's art is a flaming rock: dark stone under fire colours", () => {
    const f = fakeCtx();
    drawCardArt(f.ctx, "comet", 12, 12, 24);
    expect(f.fills()).toBeGreaterThan(5);
    expect(f.colors.has("#5a4740")).toBe(true); // the basalt rock
    expect(f.colors.has("#ffe082")).toBe(true); // the hottest flame band
  });
});
