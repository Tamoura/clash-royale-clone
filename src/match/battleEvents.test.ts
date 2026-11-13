import { describe, expect, it } from "vitest";
import { CrashShield, STORM_ERRORS } from "../app/crashShield";
import type { BattleEvent } from "../game/battle";
import { memoryKV } from "../meta/kv";
import { clearMatchMarker, markMatchStart, readMarker } from "./leftMatch";
import { MatchSettler, playBattleEvents, type EventBattle, type EventStep, type Winner } from "./battleEvents";
import mainSource from "../main.ts?raw";

const KING_DEATH: BattleEvent = { type: "death", kind: "king-tower", cardId: null, side: "enemy", x: 9, y: 28 };
const CROWN: BattleEvent = { type: "crown", winner: "player" };
const FINISH: BattleEvent = { type: "finish", winner: "player" };

/** A battle the kid just won: the enemy king falls, a crown, then the finish. */
function wonBattle(): EventBattle {
  return { events: [KING_DEATH, CROWN, FINISH], result: { winner: "player" } };
}

/** main.ts in miniature: a settle that clears the left-match marker (as finishMatch does) and pays out. */
function app() {
  const kv = memoryKV();
  markMatchStart(kv, Date.UTC(2026, 10, 13), 320);
  const settled: Winner[] = [];
  const settler = new MatchSettler((w) => {
    clearMatchMarker(kv);
    settled.push(w);
  });
  const caught: { where: string; err: unknown }[] = [];
  const guard = (where: string, work: () => void): void => {
    try {
      work();
    } catch (err) {
      caught.push({ where, err });
    }
  };
  return { kv, settled, settler, caught, guard };
}

/** A step that throws once, on the first event `when` accepts. */
function throwsOnce(when: (ev: BattleEvent) => boolean): EventStep {
  let done = false;
  return (ev) => {
    if (!done && when(ev)) {
      done = true;
      throw new Error(`effect failed on ${ev.type}`);
    }
  };
}

describe("one glitch in a battle event never costs the result", () => {
  it("a step that throws on the king's fall (before 'finish') still lets the match settle and clears the marker", () => {
    const a = app();
    const seen: string[] = [];
    const steps = [(ev: BattleEvent) => void seen.push(ev.type), throwsOnce((ev) => ev.type === "death")];
    playBattleEvents(wonBattle(), steps, a.settler, a.guard);
    expect(a.settled).toEqual(["player"]);
    expect(readMarker(a.kv)).toBeNull(); // the next launch charges no "you left" loss
    expect(seen).toEqual(["death", "crown", "finish"]); // the rest of the batch still played
    expect(a.caught.map((c) => c.where)).toEqual(["battle event 'death'"]);
  });

  it("a step that throws on the finish event itself still settles", () => {
    for (let at = 0; at < 3; at++) {
      const a = app();
      const steps: EventStep[] = [0, 1, 2].map((i) => (i === at ? throwsOnce((ev) => ev.type === "finish") : () => {}));
      playBattleEvents(wonBattle(), steps, a.settler, a.guard);
      expect(a.settled).toEqual(["player"]);
      expect(readMarker(a.kv)).toBeNull();
    }
  });

  it("every other step of the same event still runs after one throws", () => {
    const a = app();
    const ran: number[] = [];
    const steps: EventStep[] = [
      () => void ran.push(0),
      () => {
        throw new Error("sound broken");
      },
      () => void ran.push(2),
    ];
    playBattleEvents({ events: [CROWN], result: null }, steps, a.settler, a.guard);
    expect(ran).toEqual([0, 2]);
    expect(a.settled).toEqual([]); // not over: nothing to settle
  });

  it("drains the events, so nothing plays twice", () => {
    const a = app();
    const b = wonBattle();
    let played = 0;
    playBattleEvents(b, [() => void played++], a.settler, a.guard);
    playBattleEvents(b, [() => void played++], a.settler, a.guard);
    expect(b.events).toEqual([]);
    expect(played).toBe(3);
  });
});

describe("each battle settles exactly once", () => {
  it("a second finish event, or the next frames, settle nothing more", () => {
    const a = app();
    const b = wonBattle();
    playBattleEvents(b, [], a.settler, a.guard);
    b.events.push(FINISH);
    playBattleEvents(b, [], a.settler, a.guard);
    playBattleEvents(b, [], a.settler, a.guard);
    expect(a.settled).toEqual(["player"]);
  });

  it("the safety net: decided but its finish event lost, it settles on the next frame", () => {
    const a = app();
    const b: EventBattle = { events: [], result: { winner: "enemy" } };
    playBattleEvents(b, [], a.settler, a.guard);
    playBattleEvents(b, [], a.settler, a.guard);
    expect(a.settled).toEqual(["enemy"]);
    expect(readMarker(a.kv)).toBeNull();
  });

  it("a battle still being played is never settled by the net", () => {
    const a = app();
    playBattleEvents({ events: [CROWN], result: null }, [], a.settler, a.guard);
    expect(a.settled).toEqual([]);
    expect(readMarker(a.kv)).not.toBeNull();
  });

  it("a settle that throws halfway is reported and never repeated (no double pay-out)", () => {
    let calls = 0;
    const settler = new MatchSettler(() => {
      calls++;
      throw new Error("rewards broken");
    });
    const caught: string[] = [];
    const guard = (where: string, work: () => void): void => {
      try {
        work();
      } catch {
        caught.push(where);
      }
    };
    const b = wonBattle();
    playBattleEvents(b, [], settler, guard);
    playBattleEvents(b, [], settler, guard);
    expect(calls).toBe(1);
    expect(caught).toEqual(["settling the match"]);
  });

  it("the next battle (a new object) settles on its own", () => {
    const a = app();
    playBattleEvents(wonBattle(), [], a.settler, a.guard);
    playBattleEvents({ events: [{ type: "finish", winner: "draw" }], result: { winner: "draw" } }, [], a.settler, a.guard);
    expect(a.settled).toEqual(["player", "draw"]);
  });

  it("a forfeit hit by the same one-off glitch still settles (as the loss it is)", () => {
    const a = app();
    // forfeitMatch: result set, finish queued; the next frame's effects glitch once.
    const b: EventBattle = { events: [{ type: "finish", winner: "enemy" }], result: { winner: "enemy" } };
    playBattleEvents(b, [throwsOnce(() => true)], a.settler, a.guard);
    expect(a.settled).toEqual(["enemy"]);
    expect(readMarker(a.kv)).toBeNull();
  });
});

describe("with the crash shield's guard", () => {
  function shieldRig(rethrow: boolean) {
    const storms: boolean[] = [];
    const recorded: unknown[] = [];
    let t = 1000;
    const shield = new CrashShield({
      now: () => t,
      record: (_w, err) => void recorded.push(err),
      print: () => {},
      onStorm: (again) => {
        storms.push(again);
        return true;
      },
      rethrow,
    });
    return { shield, storms, recorded, tick: (ms: number) => void (t += ms) };
  }

  it("a one-off glitch is recorded, the match settles, and the next frame is scheduled", () => {
    const r = shieldRig(false);
    const a = app();
    let scheduled = 0;
    r.shield.runFrame(
      () => playBattleEvents(wonBattle(), [throwsOnce((ev) => ev.type === "death")], a.settler, (w, f) => r.shield.guard(w, f)),
      () => void scheduled++,
    );
    expect(scheduled).toBe(1);
    expect(a.settled).toEqual(["player"]);
    expect(r.recorded).toHaveLength(1);
    expect(r.storms).toEqual([]); // one stray error: carry on
  });

  it(`an effect that throws on every event counts toward a storm (${STORM_ERRORS} within the window)`, () => {
    const r = shieldRig(false);
    const a = app();
    const always: EventStep = () => {
      throw new Error("collapse effect broken");
    };
    for (let i = 0; i < STORM_ERRORS; i++) {
      r.shield.runFrame(
        () => playBattleEvents({ events: [CROWN], result: null }, [always], a.settler, (w, f) => r.shield.guard(w, f)),
        () => {},
      );
      r.tick(100);
    }
    expect(r.storms).toEqual([false]);
  });

  it("stays loud in development: thrown on at the end of the frame, after the settle and the next frame", () => {
    const r = shieldRig(true);
    const a = app();
    let scheduled = 0;
    const order: string[] = [];
    expect(() =>
      r.shield.runFrame(
        () => {
          playBattleEvents(wonBattle(), [throwsOnce((ev) => ev.type === "death")], a.settler, (w, f) => r.shield.guard(w, f));
          order.push("rest of the frame");
        },
        () => void scheduled++,
      ),
    ).toThrow("effect failed on death");
    expect(a.settled).toEqual(["player"]);
    expect(order).toEqual(["rest of the frame"]);
    expect(scheduled).toBe(1);
  });
});

describe("main.ts plays battle events only through playBattleEvents", () => {
  const src = mainSource as string;

  it("the frame body drains them with the shield's guard and the one settler", () => {
    expect(src).toMatch(/playBattleEvents\(battle, battleEventSteps, settler, guardStep\)/);
    expect(src).toMatch(/new MatchSettler\(finishMatch\)/);
    expect(src).not.toMatch(/battle\.events\.splice/);
  });

  it("finishMatch is called nowhere else (the settler is the only way a match settles)", () => {
    expect(src.match(/finishMatch\(/g)).toHaveLength(1); // its declaration
  });

  it("Back to menu after a glitch marks the battle as no contest", () => {
    expect(src).toMatch(/abandonBattle: \(\) => settler\.noContest\(battle\)/);
  });
});
