import { describe, expect, it, vi } from "vitest";
import type { BattleEvent, Entity } from "../../../game/battle";
import { getCard } from "../../../game/cards";
import { buildTroop } from "../../characters3d";
import type { Battle3D } from "../../scene3d";
import { isFrozen, setFrozen, viewsOnEvent, type TroopAnim } from "./animate";

/** Just enough of a battle view for the status code. */
function fakeScene(time: number) {
  const emit = vi.fn();
  const b = {
    syncState: { time },
    byId: new Map<number, Entity>(),
    fx: { emit },
    hitStop: { punch: vi.fn(), active: false },
  } as unknown as Battle3D;
  return { b, emit };
}

function troop(x: number, y: number, stunTimer: number): Entity {
  return { kind: "troop", side: "enemy", x, y, radius: 0.5, stunTimer } as unknown as Entity;
}

function anim(): TroopAnim {
  return { frozen: false, ice: null } as unknown as TroopAnim;
}

/** One frame of the status block as updateTroop runs it. */
function frame(b: Battle3D, a: TroopAnim, rig: ReturnType<typeof buildTroop>, e: Entity): boolean {
  const frozen = isFrozen(b, e);
  setFrozen(b, a, rig, e, frozen);
  return frozen;
}

describe("freeze vs stun", () => {
  it("an on-hit stun of exactly one second dazes without icing over", () => {
    const ew = getCard("electro-wizard");
    if (ew.kind !== "troop") throw new Error("electro-wizard troop");
    const { b, emit } = fakeScene(10);
    const rig = buildTroop("knight");
    const a = anim();
    const e = troop(9, 20, ew.unit.stunOnHit);
    expect(e.stunTimer).toBe(1);
    expect(frame(b, a, rig, e)).toBe(false);
    expect(a.ice).toBeNull();
    e.stunTimer = 0;
    expect(frame(b, a, rig, e)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("a Freeze spell ices the units it caught and shards burst on thaw", () => {
    const { b, emit } = fakeScene(10);
    const freeze = getCard("freeze");
    const ev: BattleEvent = { type: "spell", side: "player", cardId: "freeze", x: 9, y: 20 };
    viewsOnEvent(b, ev);
    const rig = buildTroop("knight");
    const a = anim();
    const caught = troop(9.5, 20, freeze.kind === "spell" ? freeze.stunSeconds : 4);
    expect(frame(b, a, rig, caught)).toBe(true);
    expect(a.ice?.length).toBeGreaterThan(0);
    expect(a.ice!.every((m) => m.visible)).toBe(true);
    caught.stunTimer = 0;
    expect(frame(b, a, rig, caught)).toBe(false);
    expect(a.ice!.every((m) => !m.visible)).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("chips");

    // Stunned outside the blast: a daze, not ice.
    const far = troop(2, 5, 1);
    expect(isFrozen(b, far)).toBe(false);
  });

  it("an expired freeze zone no longer ices a fresh stun", () => {
    const { b } = fakeScene(10);
    viewsOnEvent(b, { type: "spell", side: "player", cardId: "freeze", x: 9, y: 20 });
    (b.syncState as { time: number }).time = 30;
    expect(isFrozen(b, troop(9, 20, 1))).toBe(false);
  });
});
