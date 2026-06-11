import { describe, expect, it } from "vitest";
import { createElixir, tickElixir, trySpend } from "./elixir";

describe("elixir", () => {
  it("starts at 5", () => {
    expect(createElixir().amount).toBe(5);
  });

  it("regenerates 1 elixir per 2.8 seconds", () => {
    let e = createElixir();
    e = tickElixir(e, 2.8, false);
    expect(e.amount).toBeCloseTo(6);
  });

  it("caps at 10", () => {
    let e = createElixir();
    e = tickElixir(e, 1000, false);
    expect(e.amount).toBe(10);
  });

  it("regenerates twice as fast in double-elixir time", () => {
    let e = createElixir();
    e = tickElixir(e, 1.4, true);
    expect(e.amount).toBeCloseTo(6);
  });

  it("spends elixir when affordable", () => {
    const e = createElixir(); // 5
    const after = trySpend(e, 3);
    expect(after).not.toBeNull();
    expect(after!.amount).toBeCloseTo(2);
  });

  it("refuses to spend more than available", () => {
    const e = createElixir(); // 5
    expect(trySpend(e, 6)).toBeNull();
  });
});
