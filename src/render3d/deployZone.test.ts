import { describe, expect, it } from "vitest";
import { getCard } from "../game/cards";
import { deploysAnywhere } from "./scene3d";

describe("deploy overlay for a dig-anywhere card", () => {
  it("only the Digger (deployAnywhere troops) lifts the enemy-half shade", () => {
    expect(deploysAnywhere(getCard("digger"))).toBe(true);
    expect(deploysAnywhere(getCard("knight"))).toBe(false);
    expect(deploysAnywhere(getCard("cannon"))).toBe(false);
    expect(deploysAnywhere(getCard("comet"))).toBe(false);
    expect(deploysAnywhere(null)).toBe(false);
  });
});
