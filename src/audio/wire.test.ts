import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BattleState } from "../game/battle";

type Hooks = typeof import("../app/hooks");
type Sound = typeof import("./sound");

interface Rig {
  hooks: Hooks;
  engine: InstanceType<Sound["SoundEngine"]>;
  music: string[];
  vibrate: ReturnType<typeof vi.fn>;
}

/** Fresh hooks + wiring + engine (no Web Audio in node: calls are recorded, not played). */
async function rig(): Promise<Rig> {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal("navigator", { vibrate });
  vi.stubGlobal("localStorage", undefined);
  vi.resetModules();
  const hooks = await import("../app/hooks");
  const sound = await import("./sound");
  await import("./wire");
  const engine = new sound.SoundEngine({ edition: "classic" });
  const music: string[] = [];
  const play = engine.playMusic.bind(engine);
  engine.playMusic = (id) => {
    music.push(id);
    play(id);
  };
  return { hooks, engine, music, vibrate };
}

function tower(side: "player" | "enemy", hp: number) {
  return { side, kind: "princess-tower", hp } as BattleState["entities"][number];
}

function fakeBattle(time = 10): BattleState {
  return {
    entities: [tower("player", 1000), tower("enemy", 1000)],
    time,
    overtime: false,
    result: null,
  } as unknown as BattleState;
}

const start = (r: Rig, battle: BattleState, mySide: "player" | "enemy" = "player") =>
  r.hooks.emit("matchStart", { kind: "ladder", battle, mySide, online: mySide === "enemy", replay: false });
const frame = (r: Rig, battle: BattleState, phase: string) =>
  r.hooks.emit("frame", { dt: 1 / 60, presentDt: 1 / 60, alpha: 1, phase, battle });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("audio wiring", () => {
  it("plays the menu theme on menus and the battle track only after the countdown", async () => {
    const r = await rig();
    r.hooks.emit("screen", { id: "home", sceneMode: "diorama" });
    r.hooks.emit("screen", { id: "collection", sceneMode: "none" });
    expect(r.music).toEqual(["menu", "menu"]);
    const b = fakeBattle();
    r.hooks.emit("screen", { id: "battle", sceneMode: "battle" });
    start(r, b);
    expect(r.music.at(-1)).toBe("none");
    frame(r, b, "countdown");
    frame(r, b, "countdown");
    expect(r.music).not.toContain("battle");
    frame(r, b, "playing");
    frame(r, b, "playing");
    expect(r.music.filter((m) => m === "battle")).toHaveLength(1);
  });

  it("knows the online guest's side, and the result stops the music", async () => {
    const r = await rig();
    const b = fakeBattle();
    start(r, b, "enemy");
    expect(r.engine.side).toBe("enemy");
    frame(r, b, "playing");
    r.hooks.emit("matchEnd", {
      kind: "ladder", winner: "enemy", mySide: "enemy", myCrowns: 1, theirCrowns: 0,
      trophyDelta: 0, online: true, battle: b, replay: false, sandbox: false,
    });
    expect(r.music.at(-1)).toBe("none");
    expect(r.vibrate).toHaveBeenLastCalledWith([20, 40, 20, 40, 60]); // victory
  });

  it("a match in progress resumes its track after a menu", async () => {
    const r = await rig();
    const b = fakeBattle();
    start(r, b);
    frame(r, b, "playing");
    r.hooks.emit("screen", { id: "deck", sceneMode: "none" });
    expect(r.music.at(-1)).toBe("menu");
    frame(r, b, "playing"); // the sim is frozen under the picker: no change
    expect(r.music.at(-1)).toBe("menu");
    r.hooks.emit("screen", { id: "battle", sceneMode: "battle" });
    frame(r, b, "playing");
    expect(r.music.at(-1)).toBe("battle");
  });

  it("ticks the last 10 seconds and taps when our towers are hit", async () => {
    const r = await rig();
    const ticks: number[] = [];
    r.engine.clockTick = (s) => void ticks.push(s);
    const b = fakeBattle(168);
    start(r, b);
    for (let t = 168; t < 180; t += 0.1) {
      b.time = t;
      frame(r, b, "playing");
    }
    expect(ticks).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    r.vibrate.mockClear();
    b.entities[1].hp -= 100; // the enemy tower: no buzz
    frame(r, b, "playing");
    expect(r.vibrate).not.toHaveBeenCalled();
    b.entities[0].hp -= 100; // ours
    frame(r, b, "playing");
    expect(r.vibrate).toHaveBeenCalledWith(8);
  });

  it("buzzes inputs and tower falls", async () => {
    const r = await rig();
    r.hooks.emit("input", { kind: "deploy", cardId: "knight" });
    expect(r.vibrate).toHaveBeenLastCalledWith(12);
    r.hooks.emit("input", { kind: "invalid" });
    expect(r.vibrate).toHaveBeenLastCalledWith([18, 40, 18]);
    r.hooks.emit("battleEvent", {
      ev: { type: "death", kind: "king-tower", cardId: null, side: "enemy", x: 9, y: 29 },
      mySide: "player",
    });
    expect(r.vibrate).toHaveBeenLastCalledWith([40, 60, 80]);
  });
});
