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

  it("catches a different elixir bar (to the thousandth)", () => {
    const a = createBattle();
    const b = createBattle();
    b.player.elixir = { amount: b.player.elixir.amount + 0.002 };
    expect(stateChecksum(a)).not.toBe(stateChecksum(b));
  });

  it("catches crowns, a reordered hand and a different next card", () => {
    const base = stateChecksum(createBattle());
    const crowns = createBattle();
    crowns.enemy.crowns = 1;
    expect(stateChecksum(crowns)).not.toBe(base);
    const hand = createBattle();
    hand.player.hand = { cards: [...hand.player.hand.cards].reverse(), queue: hand.player.hand.queue };
    expect(stateChecksum(hand)).not.toBe(base);
    const next = createBattle();
    const q = [...next.enemy.hand.queue];
    [q[0], q[1]] = [q[1], q[0]];
    next.enemy.hand = { cards: next.enemy.hand.cards, queue: q };
    expect(stateChecksum(next)).not.toBe(base);
  });

  it("catches sub-1 hp drift that the per-entity rounding hides", () => {
    const a = createBattle();
    const b = createBattle();
    b.entities[0].hp -= 0.001;
    expect(stateChecksum(a)).not.toBe(stateChecksum(b));
  });

  it("catches projectiles, buff zones, the result and overtime", () => {
    const base = stateChecksum(createBattle());
    const over = createBattle();
    over.overtime = true;
    expect(stateChecksum(over)).not.toBe(base);
    const done = createBattle();
    done.result = { winner: "draw", playerCrowns: 0, enemyCrowns: 0 };
    expect(stateChecksum(done)).not.toBe(base);
    const zone = createBattle();
    zone.buffZones.push({ side: "player", x: 9, y: 20, radius: 3, ttl: 5 });
    expect(stateChecksum(zone)).not.toBe(base);
    const shot = createBattle();
    // Only the count is mixed, so a bare stand-in shot is enough here.
    shot.projectiles.push({} as (typeof shot.projectiles)[number]);
    expect(stateChecksum(shot)).not.toBe(base);
  });

  it("ignores render-only data: events, effects and stats", () => {
    const a = createBattle();
    const b = createBattle();
    b.events.push({ type: "crown", winner: "player" });
    b.effects.push({ cardId: "zap", x: 1, y: 1, radius: 2, ttl: 1 });
    b.player.stats.damageDealt = 500;
    expect(stateChecksum(a)).toBe(stateChecksum(b));
  });
});
