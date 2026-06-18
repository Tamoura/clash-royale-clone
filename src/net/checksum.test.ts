import { describe, expect, it } from "vitest";
import { createBattle, deployCard } from "../game/battle";
import { tick } from "../game/sim";
import { stateChecksum } from "./checksum";

describe("state checksum (drift detection)", () => {
  it("is identical for two independently-built fresh battles", () => {
    expect(stateChecksum(createBattle())).toBe(stateChecksum(createBattle()));
  });

  it("two clients running the same command stream stay in sync", () => {
    const a = createBattle();
    const b = createBattle();
    deployCard(a, "player", "knight", 0, 22);
    deployCard(b, "player", "knight", 0, 22);
    for (let i = 0; i < 60; i++) {
      tick(a, 1 / 30);
      tick(b, 1 / 30);
    }
    expect(stateChecksum(a)).toBe(stateChecksum(b));
  });

  it("changes when an entity is added on only one side", () => {
    const a = createBattle();
    const b = createBattle();
    const before = stateChecksum(a);
    deployCard(a, "player", "knight", 0, 22);
    expect(stateChecksum(a)).not.toBe(before);
    expect(stateChecksum(a)).not.toBe(stateChecksum(b));
  });

  it("tolerates sub-0.1-tile position noise", () => {
    const a = createBattle();
    deployCard(a, "player", "knight", 0, 22);
    const b = createBattle();
    deployCard(b, "player", "knight", 0, 22);
    const unit = b.entities.find((e) => e.cardId === "knight")!;
    unit.x += 0.0001; // last-bit transcendental noise
    expect(stateChecksum(a)).toBe(stateChecksum(b));
  });
});
