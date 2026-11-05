import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BattleEvent } from "../game/battle";
import { waveCue } from "./sound";

const ev = (e: BattleEvent): BattleEvent => e;

describe("card wave 3 sound cues", () => {
  it("map the new cards' moments to their sounds", () => {
    expect(waveCue(ev({ type: "deploy", side: "player", cardId: "digger", x: 3, y: 4 }))).toBe("dig");
    expect(waveCue(ev({ type: "emerge", side: "player", cardId: "digger", x: 3, y: 4 }))).toBe("pop");
    expect(waveCue(ev({ type: "spell", side: "enemy", cardId: "comet", x: 9, y: 9 }))).toBe("whoosh");
    expect(waveCue(ev({ type: "spell-land", side: "enemy", cardId: "comet", x: 9, y: 9 }))).toBe("boom");
    expect(waveCue(ev({ type: "deploy", side: "player", cardId: "stone-golem", x: 9, y: 20 }))).toBe("grind");
    expect(waveCue(ev({ type: "death", kind: "troop", side: "player", cardId: "stone-golem", x: 9, y: 20 }))).toBe("crumble");
    expect(waveCue(ev({ type: "death", kind: "troop", side: "player", cardId: "pebble-golem", x: 9, y: 20 }))).toBe("crumble-small");
  });

  it("leave every other event to the existing sounds", () => {
    expect(waveCue(ev({ type: "spell", side: "player", cardId: "fireball", x: 9, y: 9 }))).toBeNull();
    expect(waveCue(ev({ type: "deploy", side: "player", cardId: "knight", x: 9, y: 20 }))).toBeNull();
    expect(waveCue(ev({ type: "death", kind: "troop", side: "player", cardId: "knight", x: 9, y: 20 }))).toBeNull();
  });
});

// ---- The engine really synthesizes them (a recording Web Audio stand-in) ----

class Param {
  value = 0;
  setValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class Node {
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
}
class Ctx {
  static last: Ctx | null = null;
  currentTime = 0;
  state = "running";
  sampleRate = 4000;
  destination = new Node();
  sources = 0;
  constructor() {
    Ctx.last = this;
  }
  private src() {
    this.sources++;
    return Object.assign(new Node(), { type: "sine", frequency: new Param(), detune: new Param(), buffer: null, start() {}, stop() {} });
  }
  createOscillator() {
    return this.src();
  }
  createBufferSource() {
    return this.src();
  }
  createGain() {
    return Object.assign(new Node(), { gain: new Param() });
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { type: "lowpass", frequency: new Param(), Q: new Param() });
  }
  createDelay() {
    return Object.assign(new Node(), { delayTime: new Param() });
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: new Param() });
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createBuffer(_c: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  addEventListener() {}
}

describe("card wave 3 sounds play", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("AudioContext", Ctx);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the dig, pop, whoosh, boom and crumble each start voices", async () => {
    const { SoundEngine } = await import("./sound");
    const engine = new SoundEngine({ edition: "classic" });
    engine.resume();
    const ctx = Ctx.last!;
    const events: BattleEvent[] = [
      { type: "deploy", side: "player", cardId: "digger", x: 3, y: 4 },
      { type: "emerge", side: "player", cardId: "digger", x: 3, y: 4 },
      { type: "spell", side: "player", cardId: "comet", x: 9, y: 9 },
      { type: "spell-land", side: "player", cardId: "comet", x: 9, y: 9 },
      { type: "death", kind: "troop", side: "player", cardId: "stone-golem", x: 9, y: 20 },
    ];
    for (const e of events) {
      const before = ctx.sources;
      ctx.currentTime += 1; // past every throttle
      engine.onEvent(e, "player");
      expect(ctx.sources - before, e.type).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("card wave 3 haptics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a Comet landing and a Stone Golem crumbling thud", async () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("localStorage", undefined);
    vi.resetModules();
    const hooks = await import("../app/hooks");
    await import("./wire");
    hooks.emit("matchStart", { kind: "ladder", battle: { entities: [], time: 0, overtime: false, result: null } as never, mySide: "player", online: false, replay: false });
    hooks.emit("battleEvent", { ev: { type: "spell-land", side: "enemy", cardId: "comet", x: 9, y: 9 }, mySide: "player" });
    expect(vibrate).toHaveBeenCalledTimes(1);
    hooks.emit("battleEvent", { ev: { type: "death", kind: "troop", side: "enemy", cardId: "stone-golem", x: 9, y: 9 }, mySide: "player" });
    expect(vibrate).toHaveBeenCalledTimes(2);
    hooks.emit("battleEvent", { ev: { type: "death", kind: "troop", side: "enemy", cardId: "knight", x: 9, y: 9 }, mySide: "player" });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
});
