import { describe, expect, it } from "vitest";
import { BRIDGE_XS, RIVER_Y } from "./arena";
import { createBattle, deployCard, spawnUnits, type BattleState } from "./battle";
import { createHand } from "./hand";
import { isRaged, moveGoal, tick } from "./sim";

const TICK = 1 / 20;

function run(b: BattleState, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) tick(b, TICK);
}

/** Put specific cards in a side's hand for deployment tests. */
function giveHand(b: BattleState, side: "player" | "enemy", cards: string[]): void {
  const state = side === "player" ? b.player : b.enemy;
  state.hand = createHand([...cards, "knight", "archers", "giant", "fireball"] as never);
  state.elixir = { amount: 10 };
}

describe("air units", () => {
  it("ground-only melee units ignore flyers and walk to buildings", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 20);
    spawnUnits(b, "enemy", "baby-dragon", 9, 19);
    tick(b, TICK);
    const target = b.entities.find((e) => e.id === knight.targetId);
    expect(target).toBeDefined();
    expect(target!.kind).not.toBe("troop");
  });

  it("air-targeting units shoot flyers down", () => {
    const b = createBattle();
    spawnUnits(b, "player", "musketeer", 9, 20);
    const [dragon] = spawnUnits(b, "enemy", "baby-dragon", 9, 17);
    run(b, 3);
    expect(dragon.hp).toBeLessThan(dragon.maxHp);
  });

  it("flyers head straight for their target, ignoring bridges", () => {
    const b = createBattle();
    const [dragon] = spawnUnits(b, "player", "baby-dragon", 9, 18);
    const [knight] = spawnUnits(b, "player", "knight", 9, 18);
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const dragonGoal = moveGoal(dragon, tower);
    const knightGoal = moveGoal(knight, tower);
    expect(dragonGoal.x).toBe(tower.x); // straight line
    expect(BRIDGE_XS).toContain(knightGoal.x); // bridge detour
  });

  it("towers shoot flying units", () => {
    const b = createBattle();
    const [dragon] = spawnUnits(b, "enemy", "baby-dragon", BRIDGE_XS[0], 21);
    run(b, 3);
    expect(dragon.hp).toBeLessThan(dragon.maxHp);
  });
});

describe("splash damage", () => {
  it("splash attackers damage the whole cluster", () => {
    const b = createBattle();
    spawnUnits(b, "player", "wizard", 9, 21);
    spawnUnits(b, "enemy", "skeletons", 9, 17.5);
    run(b, 4);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
  });
});

describe("charge", () => {
  it("a prince hits for double damage after a run-up", () => {
    const b = createBattle();
    // Remove the enemy princess towers so only the cannon fights back
    // and the prince survives his (otherwise heavily contested) run-up.
    b.entities = b.entities.filter(
      (e) => !(e.side === "enemy" && e.kind === "princess-tower"),
    );
    giveHand(b, "enemy", ["cannon"]);
    expect(deployCard(b, "enemy", "cannon", 9, 14)).toBe(true);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    // Same side of the river so the approach is a straight 5-tile run-up.
    spawnUnits(b, "player", "prince", 9, 9);
    for (let i = 0; i < 20 * 10; i++) {
      tick(b, TICK);
      if (b.events.some((e) => e.type === "attack" && e.cardId === "prince")) break;
    }
    // 800 max, one charged hit = 650 (vs 325 uncharged); some decay too.
    expect(cannon.hp).toBeLessThan(200);
    const prince = b.entities.find((e) => e.cardId === "prince")!;
    expect(prince.chargeProgress).toBe(0); // resets after the hit
  });
});

describe("buildings", () => {
  it("deploys on own half and decays away over its lifetime", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    expect(deployCard(b, "player", "cannon", 9, 8)).toBe(false); // enemy half
    expect(deployCard(b, "player", "cannon", 9, 20)).toBe(true);
    expect(b.entities.some((e) => e.kind === "building")).toBe(true);
    run(b, 31);
    expect(b.entities.some((e) => e.kind === "building")).toBe(false);
    expect(b.enemy.crowns).toBe(0); // expiring grants nothing
  });

  it("baits building-seeking troops away from towers", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    deployCard(b, "player", "cannon", 9, 20);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    const [giant] = spawnUnits(b, "enemy", "giant", 9, 17.5);
    tick(b, TICK);
    expect(giant.targetId).toBe(cannon.id);
  });

  it("cannot shoot flying units", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    deployCard(b, "player", "cannon", 9, 20);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    spawnUnits(b, "enemy", "baby-dragon", 9, 19);
    run(b, 2);
    expect(cannon.targetId).toBeNull();
  });
});

describe("spawners", () => {
  it("a witch summons skeletons on her side over time", () => {
    const b = createBattle();
    spawnUnits(b, "player", "witch", 9, 24);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
    run(b, 10);
    const skeletons = b.entities.filter((e) => e.cardId === "skeletons");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
    for (const s of skeletons) expect(s.side).toBe("player");
  });

  it("a tombstone building drips skeletons until it crumbles", () => {
    const b = createBattle();
    giveHand(b, "player", ["tombstone"]);
    expect(deployCard(b, "player", "tombstone", 9, 24)).toBe(true);
    run(b, 10);
    const skeletons = b.entities.filter((e) => e.cardId === "skeletons");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
    for (const s of skeletons) expect(s.side).toBe("player");
  });

  it("non-spawner troops never summon anything", () => {
    const b = createBattle();
    spawnUnits(b, "player", "knight", 9, 24);
    run(b, 10);
    expect(b.entities.filter((e) => e.cardId === "skeletons")).toHaveLength(0);
  });
});

describe("river jump", () => {
  it("the hog rider heads straight across the river, no bridge detour", () => {
    const b = createBattle();
    const [hog] = spawnUnits(b, "player", "hog-rider", 9, 18);
    const [knight] = spawnUnits(b, "player", "knight", 9, 18);
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    expect(moveGoal(hog, tower).x).toBe(tower.x); // straight line
    expect(BRIDGE_XS).toContain(moveGoal(knight, tower).x); // bridge detour
  });

  it("the hog rider still fights as a ground unit and ignores troops", () => {
    const b = createBattle();
    const [hog] = spawnUnits(b, "player", "hog-rider", 9, 20);
    spawnUnits(b, "enemy", "knight", 9, 19);
    tick(b, TICK);
    const target = b.entities.find((e) => e.id === hog.targetId);
    expect(target).toBeDefined();
    expect(target!.kind).not.toBe("troop"); // building-seeker
    expect(hog.flying).toBe(false); // ground attackers can hit him
  });
});

describe("death bomb", () => {
  // Mid-river spots: out of range of every tower, so only the bomb
  // (or its absence) can change anyone's HP during the test tick.
  it("a dying balloon damages nearby enemies", () => {
    const b = createBattle();
    const [balloon] = spawnUnits(b, "player", "balloon", 9, 16);
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 16.5);
    balloon.hp = 0;
    tick(b, TICK);
    expect(knight.hp).toBeLessThan(knight.maxHp);
  });

  it("the bomb spares the balloon's own side", () => {
    const b = createBattle();
    const [balloon] = spawnUnits(b, "player", "balloon", 9, 16);
    const [friend] = spawnUnits(b, "player", "knight", 9, 16.5);
    balloon.hp = 0;
    tick(b, TICK);
    expect(friend.hp).toBe(friend.maxHp);
  });

  it("ordinary troops explode into nothing", () => {
    const b = createBattle();
    const [mine] = spawnUnits(b, "player", "knight", 9, 16);
    const [foe] = spawnUnits(b, "enemy", "knight", 9, 16.5);
    mine.hp = 0;
    tick(b, TICK);
    expect(foe.hp).toBe(foe.maxHp);
  });
});

describe("stun", () => {
  it("zap freezes enemies in place for its stun duration", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 16);
    run(b, 1.5); // deploy freeze over, knight walking
    const yBefore = knight.y;
    giveHand(b, "player", ["zap"]);
    expect(deployCard(b, "player", "zap", 9, knight.y)).toBe(true);
    expect(knight.hp).toBeLessThan(knight.maxHp); // zap damage landed
    run(b, 0.4); // still inside the stun window
    expect(knight.y).toBe(yBefore); // rooted to the spot
    run(b, 1);
    expect(knight.y).not.toBe(yBefore); // free again
  });

  it("freeze roots enemies for several seconds without hurting them", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 16);
    run(b, 1.5);
    const yBefore = knight.y;
    giveHand(b, "player", ["freeze"]);
    expect(deployCard(b, "player", "freeze", 9, knight.y)).toBe(true);
    expect(knight.hp).toBe(knight.maxHp); // no damage
    run(b, 3);
    expect(knight.y).toBe(yBefore); // still frozen at 3s
    run(b, 2);
    expect(knight.y).not.toBe(yBefore); // thawed
  });

  it("zap does not stun the caster's own troops", () => {
    const b = createBattle();
    const [mine] = spawnUnits(b, "player", "knight", 9, 16);
    run(b, 1.5);
    const yBefore = mine.y;
    giveHand(b, "player", ["zap"]);
    expect(deployCard(b, "player", "zap", 9, mine.y)).toBe(true);
    run(b, 0.4);
    expect(mine.hp).toBe(mine.maxHp);
    expect(mine.y).not.toBe(yBefore); // kept walking
  });
});

describe("rage", () => {
  /** Distance a fresh knight covers in 3s, optionally raged at spawn. */
  function knightProgress(raged: boolean): number {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 20);
    if (raged) {
      giveHand(b, "player", ["rage"]);
      expect(deployCard(b, "player", "rage", 9, 20)).toBe(true);
    }
    run(b, 3);
    return Math.hypot(knight.x - 9, knight.y - 20);
  }

  it("troops inside a friendly rage zone hustle", () => {
    expect(knightProgress(true)).toBeGreaterThan(knightProgress(false));
  });

  it("enemy troops get nothing from the zone", () => {
    const b = createBattle();
    const [foe] = spawnUnits(b, "enemy", "knight", 9, 12);
    giveHand(b, "player", ["rage"]);
    expect(deployCard(b, "player", "rage", 9, 12)).toBe(true);
    run(b, 3);
    const control = createBattle();
    const [free] = spawnUnits(control, "enemy", "knight", 9, 12);
    run(control, 3);
    expect(Math.hypot(foe.x - 9, foe.y - 12)).toBeCloseTo(
      Math.hypot(free.x - 9, free.y - 12),
      5,
    );
  });

  it("reports raged status for the renderer", () => {
    const b = createBattle();
    const [mine] = spawnUnits(b, "player", "knight", 9, 20);
    const [foe] = spawnUnits(b, "enemy", "knight", 9, 20.5);
    giveHand(b, "player", ["rage"]);
    deployCard(b, "player", "rage", 9, 20);
    expect(isRaged(b, mine)).toBe(true);
    expect(isRaged(b, foe)).toBe(false);
    run(b, 7); // zone expired
    expect(isRaged(b, mine)).toBe(false);
  });

  it("the boost dies with the zone", () => {
    const b = createBattle();
    giveHand(b, "player", ["rage"]);
    deployCard(b, "player", "rage", 9, 20);
    expect(b.buffZones.length).toBe(1);
    run(b, 10);
    expect(b.buffZones.length).toBe(0);
  });
});

describe("elixir collector", () => {
  it("generates bonus elixir for its owner over time", () => {
    const withPump = createBattle();
    giveHand(withPump, "player", ["elixir-collector"]);
    expect(deployCard(withPump, "player", "elixir-collector", 9, 24)).toBe(true);
    withPump.player.elixir = { amount: 0 };
    const control = createBattle();
    giveHand(control, "player", ["knight"]);
    deployCard(control, "player", "knight", 9, 24);
    control.player.elixir = { amount: 0 };
    run(withPump, 10);
    run(control, 10);
    const bonus = withPump.player.elixir.amount - control.player.elixir.amount;
    expect(bonus).toBeGreaterThanOrEqual(1);
    expect(bonus).toBeLessThan(2.5);
  });

  it("never pays out to the opponent", () => {
    const b = createBattle();
    giveHand(b, "player", ["elixir-collector"]);
    deployCard(b, "player", "elixir-collector", 9, 24);
    b.enemy.elixir = { amount: 0 };
    b.player.elixir = { amount: 0 };
    run(b, 10);
    const control = createBattle();
    control.enemy.elixir = { amount: 0 };
    run(control, 10);
    expect(b.enemy.elixir.amount).toBeCloseTo(control.enemy.elixir.amount, 5);
  });
});

describe("deploy delay", () => {
  it("troops stand frozen for the first second", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 9, 24);
    run(b, 0.8);
    expect(knight.y).toBe(24);
    run(b, 1);
    expect(knight.y).toBeLessThan(24);
  });

  it("river deployment rule still applies to buildings near the river", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    expect(deployCard(b, "player", "cannon", 9, RIVER_Y)).toBe(false);
  });
});

describe("troop collision", () => {
  it("ground troops shove apart instead of overlapping", () => {
    const b = createBattle();
    const [a] = spawnUnits(b, "player", "knight", 9, 20);
    const [c] = spawnUnits(b, "player", "knight", 9.05, 20.05);
    run(b, 1);
    const dist = Math.hypot(a.x - c.x, a.y - c.y);
    expect(dist).toBeGreaterThanOrEqual((a.radius + c.radius) * 0.85);
  });

  it("flyers pass freely over ground troops", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "player", "knight", 4, 20);
    const [dragon] = spawnUnits(b, "player", "baby-dragon", 4.05, 20.05);
    run(b, 0.5); // deploy-frozen: only collision could move them
    const dist = Math.hypot(knight.x - dragon.x, knight.y - dragon.y);
    expect(dist).toBeLessThan(0.3); // still stacked: no ground-air push
  });

  it("buildings are immovable; the troop gives way", () => {
    const b = createBattle();
    giveHand(b, "player", ["cannon"]);
    deployCard(b, "player", "cannon", 9, 20);
    const cannon = b.entities.find((e) => e.cardId === "cannon")!;
    const [knight] = spawnUnits(b, "player", "knight", 9.1, 20.1);
    run(b, 0.5);
    expect(cannon.x).toBe(9);
    expect(cannon.y).toBe(20);
    const dist = Math.hypot(knight.x - cannon.x, knight.y - cannon.y);
    expect(dist).toBeGreaterThanOrEqual((knight.radius + cannon.radius) * 0.85);
  });
});

describe("projectile travel", () => {
  it("ranged damage lands when the shot arrives, not when fired", () => {
    const b = createBattle();
    spawnUnits(b, "player", "musketeer", 9, 22);
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 17);
    run(b, 0.9); // still deploy-frozen: nothing fired yet
    // Find the moment the first shot is fired:
    let fired = false;
    for (let i = 0; i < 60 && !fired; i++) {
      tick(b, 1 / 20);
      fired = b.projectiles.length > 0;
    }
    expect(fired).toBe(true);
    expect(knight.hp).toBe(knight.maxHp); // shot still in the air
    run(b, 1); // plenty of flight time
    expect(knight.hp).toBeLessThan(knight.maxHp);
  });

  it("a shot fizzles if its target dies mid-flight", () => {
    const b = createBattle();
    spawnUnits(b, "player", "musketeer", 9, 22);
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 17);
    let fired = false;
    for (let i = 0; i < 120 && !fired; i++) {
      tick(b, 1 / 20);
      fired = b.projectiles.length > 0;
    }
    expect(fired).toBe(true);
    knight.hp = 0; // dies while the ball is in the air
    run(b, 1);
    expect(b.projectiles).toHaveLength(0); // fizzled, no crash
  });
});

describe("fireball knockback", () => {
  it("shoves survivors away from the blast center", () => {
    const b = createBattle();
    const [knight] = spawnUnits(b, "enemy", "knight", 9, 16.5);
    giveHand(b, "player", ["fireball"]);
    deployCard(b, "player", "fireball", 9, 15.5); // blast south of him
    expect(knight.y).toBeGreaterThan(16.5); // pushed north
  });

  it("never budges towers", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const { x, y } = tower;
    giveHand(b, "player", ["fireball"]);
    deployCard(b, "player", "fireball", tower.x, tower.y + 1);
    expect(tower.x).toBe(x);
    expect(tower.y).toBe(y);
  });
});

describe("nearest-target acquisition", () => {
  it("a troop picks a closer tower over an in-sight but farther troop", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const [knight] = spawnUnits(b, "player", "knight", tower.x, tower.y + 2.2);
    spawnUnits(b, "enemy", "knight", tower.x, tower.y + 6); // in sight, farther
    tick(b, TICK);
    expect(knight.targetId).toBe(tower.id);
  });

  it("a troop picks a closer enemy troop over a farther tower", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    const [knight] = spawnUnits(b, "player", "knight", tower.x, tower.y + 7);
    const [foe] = spawnUnits(b, "enemy", "knight", tower.x, tower.y + 4.5);
    tick(b, TICK);
    expect(knight.targetId).toBe(foe.id);
  });
});

describe("swarm spawning", () => {
  it("spawns all 15 skeletons of the army, spread apart (not stacked)", () => {
    const b = createBattle();
    const army = spawnUnits(b, "player", "skeleton-army", 9, 22);
    expect(army.length).toBe(15);
    const distinct = new Set(army.map((e) => `${e.x.toFixed(2)},${e.y.toFixed(2)}`));
    expect(distinct.size).toBeGreaterThan(10); // not all on the same tile
  });

  it("spawns 5 bats", () => {
    const b = createBattle();
    expect(spawnUnits(b, "player", "bats", 9, 22).length).toBe(5);
  });
});

describe("target persistence", () => {
  it("an engaged attacker keeps its target when a nearer enemy is deployed", () => {
    const b = createBattle();
    const tower = b.entities.find(
      (e) => e.side === "enemy" && e.kind === "princess-tower",
    )!;
    // A musketeer already within range of (engaged with) the tower.
    const [musk] = spawnUnits(b, "player", "musketeer", tower.x, tower.y + 5);
    tick(b, TICK);
    expect(musk.targetId).toBe(tower.id);
    // A fresh enemy troop appears much closer than the tower...
    spawnUnits(b, "enemy", "knight", tower.x, tower.y + 3.2);
    tick(b, TICK);
    // ...but the musketeer stays locked onto the tower it's engaged with.
    expect(musk.targetId).toBe(tower.id);
  });
});

describe("piercing shots", () => {
  it("the magic archer's shot pierces every enemy in its line", () => {
    const b = createBattle();
    const col = 14.5; // a bridge column: troops here path straight, no detour
    spawnUnits(b, "player", "magic-archer", col, 12);
    const [near] = spawnUnits(b, "enemy", "knight", col, 9);
    const [far] = spawnUnits(b, "enemy", "knight", col, 7);
    const [offLine] = spawnUnits(b, "enemy", "knight", col - 4, 9);
    run(b, 1.8); // long enough for one shot to fly the full line
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBeLessThan(far.maxHp); // pierced through the near foe
    expect(offLine.hp).toBe(offLine.maxHp); // a line, not a splash
  });
});

describe("recoil", () => {
  it("the firecracker hops backward after firing", () => {
    const b = createBattle();
    const col = 14.5;
    const [fc] = spawnUnits(b, "player", "firecracker", col, 12);
    spawnUnits(b, "enemy", "knight", col, 8); // foe ahead, toward lower y
    const startY = fc.y;
    run(b, 1.5); // one shot fires (hit speed is slow)
    expect(fc.y).toBeGreaterThan(startY + 1); // kicked away from the foe
  });
});
