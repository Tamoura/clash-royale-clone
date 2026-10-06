import { describe, expect, it } from "vitest";
import { Lockstep, type DeployCommand, type InputFrame } from "./lockstep";

const deploy = (side: "player" | "enemy", cardId = "knight", x = 0, y = 0): DeployCommand => ({
  side,
  cardId: cardId as DeployCommand["cardId"],
  x,
  y,
});

/** Feed one player's bootstrap + every step's outgoing frame into its peer. */
function relay(from: Lockstep, to: Lockstep): void {
  for (const f of from.bootstrap()) to.receive(f);
}

describe("Lockstep scheduler", () => {
  it("bootstraps `delay` empty local frames for the opening ticks", () => {
    const ls = new Lockstep("player", 3);
    const frames = ls.bootstrap();
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(frames.every((f) => f.side === "player")).toBe(true);
    expect(frames.every((f) => f.commands.length === 0)).toBe(true);
  });

  it("will not simulate tick 0 until the remote frame for it arrives", () => {
    const ls = new Lockstep("player", 3);
    ls.bootstrap(); // self-delivers our own side
    expect(ls.ready()).toBe(false); // still missing the enemy's frame 0
    ls.receive({ tick: 0, side: "enemy", commands: [] });
    expect(ls.ready()).toBe(true);
  });

  it("advances one tick per step and emits a frame `delay` ticks ahead", () => {
    const ls = new Lockstep("player", 3);
    ls.bootstrap();
    ls.receive({ tick: 0, side: "enemy", commands: [] });
    const { commands, outgoing } = ls.step();
    expect(commands).toEqual([]);
    expect(outgoing.tick).toBe(3); // simTick 0 + delay 3
    expect(outgoing.side).toBe("player");
    expect(ls.ready()).toBe(false); // tick 1 needs the enemy's frame 1
  });

  it("delivers a queued local command at tick+delay, in canonical order", () => {
    const a = new Lockstep("player", 2);
    const b = new Lockstep("enemy", 2);
    relay(a, b); // a's empty bootstrap → b
    relay(b, a); // b's empty bootstrap → a

    a.queue(deploy("player", "giant"));
    b.queue(deploy("enemy", "knight"));

    // Step both peers in lockstep, forwarding each outgoing frame to the other.
    const applied: DeployCommand[][] = [];
    for (let i = 0; i < 4; i++) {
      const ra = a.step();
      const rb = b.step();
      b.receive(ra.outgoing);
      a.receive(rb.outgoing);
      applied.push(ra.commands);
    }
    // Both queued commands land on tick 2 (0 + delay 2), player before enemy.
    expect(applied[2]).toEqual([deploy("player", "giant"), deploy("enemy", "knight")]);
    expect(applied[0]).toEqual([]);
  });

  it("both peers compute the identical command stream", () => {
    const a = new Lockstep("player", 2);
    const b = new Lockstep("enemy", 2);
    relay(a, b);
    relay(b, a);
    a.queue(deploy("player", "wizard"));

    const seenByA: InputFrame["commands"][] = [];
    const seenByB: InputFrame["commands"][] = [];
    for (let i = 0; i < 5; i++) {
      const ra = a.step();
      const rb = b.step();
      b.receive(ra.outgoing);
      a.receive(rb.outgoing);
      seenByA.push(ra.commands);
      seenByB.push(rb.commands);
    }
    expect(seenByA).toEqual(seenByB); // perfect determinism across the wire
  });

  it("throws if stepped before both sides have confirmed the tick", () => {
    const ls = new Lockstep("player", 1);
    ls.bootstrap();
    expect(() => ls.step()).toThrow();
  });

  it("ignores duplicate and stale peer frames (first frame wins)", () => {
    const ls = new Lockstep("player", 2);
    ls.bootstrap();
    ls.receive({ tick: 0, side: "enemy", commands: [deploy("enemy", "knight")] });
    // A replayed copy with different contents must not overwrite the slot.
    ls.receive({ tick: 0, side: "enemy", commands: [deploy("enemy", "giant")] });
    ls.receive({ tick: 1, side: "enemy", commands: [] });
    expect(ls.step().commands).toEqual([deploy("enemy", "knight")]);
    // Tick 0 is simulated: a late copy of it is stale and dropped.
    ls.receive({ tick: 0, side: "enemy", commands: [deploy("enemy", "pekka")] });
    expect(ls.step().commands).toEqual([]);
    expect(ls.tick).toBe(2);
  });

  it("ignores frames claiming to be from the local side", () => {
    const ls = new Lockstep("enemy", 1);
    ls.bootstrap();
    ls.receive({ tick: 0, side: "enemy", commands: [deploy("enemy", "giant")] });
    ls.receive({ tick: 0, side: "player", commands: [] });
    expect(ls.step().commands).toEqual([]);
  });

  it("carries a queued ability on the outgoing frame and reports it on that tick for both peers", () => {
    const a = new Lockstep("player", 2);
    const b = new Lockstep("enemy", 2);
    relay(a, b);
    relay(b, a);
    a.queueAbility();
    b.queueEmote(3);

    const firedA: string[][] = [];
    const firedB: string[][] = [];
    const emotesB: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const t = a.tick;
      const ra = a.step();
      const rb = b.step();
      if (i === 0) {
        expect(ra.outgoing.ability).toBe(true);
        expect(rb.outgoing.emotes).toEqual([3]);
      } else {
        expect(ra.outgoing.ability).toBeUndefined(); // the flag is one-shot
        expect(rb.outgoing.emotes).toBeUndefined();
      }
      b.receive(ra.outgoing);
      a.receive(rb.outgoing);
      firedA.push(a.abilitiesAt(t));
      firedB.push(b.abilitiesAt(t));
      emotesB.push(b.emotesAt(t));
    }
    // Queued while simulating tick 0 → lands on tick 0 + delay on both peers.
    expect(firedA).toEqual([[], [], ["player"], [], []]);
    expect(firedB).toEqual(firedA);
    expect(emotesB[2]).toEqual([{ side: "enemy", emote: 3 }]);
  });

  it("orders simultaneous abilities player first and caps emotes per frame", () => {
    const ls = new Lockstep("enemy", 1);
    ls.queueAbility();
    for (const e of [1, 2, 3]) ls.queueEmote(e);
    ls.bootstrap();
    ls.receive({ tick: 0, side: "player", commands: [] });
    const { outgoing } = ls.step();
    expect(outgoing.emotes).toEqual([1, 2]);
    ls.receive({ tick: 1, side: "player", commands: [], ability: true, emotes: [7] });
    expect(ls.abilitiesAt(1)).toEqual(["player", "enemy"]);
    expect(ls.emotesAt(1)).toEqual([
      { side: "player", emote: 7 },
      { side: "enemy", emote: 1 },
      { side: "enemy", emote: 2 },
    ]);
  });
});
