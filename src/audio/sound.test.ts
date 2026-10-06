import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOOKAHEAD_SEC,
  MUSIC_FADE_SEC,
  STEPS_PER_BAR,
  TRACKS,
  clockTickDue,
  compileTrack,
  degreeSemis,
  dueSteps,
  layersAt,
  parseDegree,
  parseLine,
  SCALES,
  stepSeconds,
} from "./music";
import { DUCK_GAIN, MUSIC_STEP_MS, PAN_LIMIT, busGains, crownCue, deployPitch, jingleFor, panFor, rarityTier } from "./sound";

// ---- A minimal Web Audio stand-in (vitest runs in node) --------------------

class FakeParam {
  value: number;
  events: { kind: string; v: number; t: number }[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  private log(kind: string, v: number, t: number): this {
    this.value = v;
    this.events.push({ kind, v, t });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.log("set", v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.log("linear", v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.log("exp", v, t);
  }
  setTargetAtTime(v: number, t: number) {
    return this.log("target", v, t);
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  out: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
  }
}

class FakeSource extends FakeNode {
  type = "sine";
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  buffer: unknown = null;
  startedAt = -1;
  constructor(private ctx: FakeAudioContext) {
    super();
  }
  start(t = 0) {
    this.startedAt = t;
    this.ctx.started.push(this);
  }
  stop() {}
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  state: "running" | "suspended" = "running";
  sampleRate = 4000;
  destination = new FakeNode();
  started: FakeSource[] = [];
  constructor() {
    FakeAudioContext.last = this;
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam(1) });
  }
  createOscillator() {
    return new FakeSource(this);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1) });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createDynamicsCompressor() {
    const p = () => new FakeParam(0);
    return Object.assign(new FakeNode(), { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() });
  }
  createBuffer(_ch: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  addEventListener() {}
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

type SoundModule = typeof import("./sound");
type PrefsModule = typeof import("../ui/prefs");

/** Fresh sound + prefs modules over `store` (a "page load"). */
async function load(store: Storage): Promise<{ sound: SoundModule; prefs: PrefsModule }> {
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.resetModules();
  const prefs = await import("../ui/prefs");
  const sound = await import("./sound");
  return { sound, prefs };
}

/** The engine's private graph, for assertions. */
interface Graph {
  master: { gain: FakeParam };
  musicBus: { gain: FakeParam };
  sfxBus: { gain: FakeParam };
  duckGain: { gain: FakeParam };
  deck: { id: string; gain: { gain: FakeParam } } | null;
}
const graph = (e: unknown): Graph => e as Graph;

/** Move the audio clock and the timers forward together. */
function advance(ms: number): void {
  const ctx = FakeAudioContext.last!;
  for (let t = 0; t < ms; t += 5) {
    ctx.currentTime += 0.005;
    vi.advanceTimersByTime(5);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeAudioContext.last = null;
});

// ---- Composition ----------------------------------------------------------

describe("music data", () => {
  it("parses degrees, octaves and holds", () => {
    expect(parseDegree("1")).toBe(0);
    expect(parseDegree("^1")).toBe(7);
    expect(parseDegree("_7")).toBe(-1);
    expect(parseDegree("-")).toBeNull();
    const { steps, notes } = parseLine("1 - - . | 3 - 5 .");
    expect(steps).toBe(8);
    expect(notes.map((n) => [n.step, n.tok, n.len])).toEqual([
      [0, "1", 3],
      [4, "3", 2],
      [6, "5", 1],
    ]);
    expect(degreeSemis(SCALES.major, -1)).toBe(-1); // leading tone below
    expect(degreeSemis(SCALES.bayati, 1)).toBe(1.5); // the quarter-tone second
  });

  it("the menu theme is 64 steps in A/B sections and the battle track is 96+ with a bridge", () => {
    expect(TRACKS.menu.chords.length * STEPS_PER_BAR).toBe(64);
    expect(TRACKS.menu.sections.map((s) => s.name)).toEqual(["A", "B"]);
    expect(TRACKS.battle.chords.length * STEPS_PER_BAR).toBeGreaterThanOrEqual(96);
    expect(TRACKS.battle.sections.map((s) => s.name)).toEqual(["A", "B", "A'", "bridge"]);
    for (const def of Object.values(TRACKS)) {
      const length = def.chords.length * STEPS_PER_BAR;
      // Every line fills the loop exactly; no stray tokens.
      expect(parseLine(def.lead).steps).toBe(length);
      expect(parseLine(def.bass).steps).toBe(length);
      expect(parseLine(def.arp).steps).toBe(length);
      for (const edition of ["classic", "arabic"] as const) {
        const c = compileTrack(def, edition);
        expect(c.length).toBe(length);
        const leads = c.steps.filter((s) => s.lead).length;
        expect(leads).toBeGreaterThan(length / 4);
        for (const s of c.steps) {
          for (const n of [s.lead, s.bass, s.arp, ...(s.pad ?? [])]) {
            if (!n) continue;
            expect(Number.isFinite(n.semis)).toBe(true);
            expect(n.len).toBeGreaterThan(0);
            // Audible, sane register: A1 .. ~C7 around the D4 root.
            expect(n.semis).toBeGreaterThanOrEqual(-29);
            expect(n.semis).toBeLessThanOrEqual(34);
          }
        }
      }
    }
  });

  it("each edition renders the same tune in its own mode", () => {
    const classic = compileTrack(TRACKS.battle, "classic");
    const arabic = compileTrack(TRACKS.battle, "arabic");
    const rhythm = (c: typeof classic) => c.steps.map((s) => (s.lead ? s.lead.len : 0));
    expect(rhythm(arabic)).toEqual(rhythm(classic));
    expect(arabic.steps.map((s) => s.lead?.semis)).not.toEqual(classic.steps.map((s) => s.lead?.semis));
    expect(classic.steps.some((s) => s.drum === "K")).toBe(true);
    expect(arabic.steps.some((s) => s.drum === "D")).toBe(true); // darbuka dum
  });

  it("intensity 1 adds hats and the counter-melody; 2 adds drums and a faster tempo", () => {
    const def = TRACKS.battle;
    expect(layersAt(def, 0)).toEqual({ arp: false, hats: false, drums: false });
    expect(layersAt(def, 1)).toEqual({ arp: true, hats: true, drums: false });
    expect(layersAt(def, 2)).toEqual({ arp: true, hats: true, drums: true });
    expect(stepSeconds(def, 2)).toBeLessThan(stepSeconds(def, 0));
    expect(MUSIC_STEP_MS[2]).toBeLessThan(MUSIC_STEP_MS[0]);
    // The menu theme ignores the match's intensity.
    expect(stepSeconds(TRACKS.menu, 2)).toBe(stepSeconds(TRACKS.menu, 0));
  });

  it("ticks once per second through the last 10 seconds only", () => {
    let last = -1;
    const ticks: number[] = [];
    for (let left = 14; left > -1; left -= 1 / 30) {
      const t = clockTickDue(last, left);
      if (t !== null) {
        ticks.push(t);
        last = t;
      }
    }
    expect(ticks).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(clockTickDue(-1, 0)).toBeNull();
    expect(clockTickDue(-1, 119.5)).toBeNull();
  });
});

// ---- Scheduling ------------------------------------------------------------

describe("look-ahead scheduler", () => {
  it("books steps in increasing time order, only inside the window", () => {
    const cur = { step: 0, time: 0.05 };
    let now = 0;
    let prev = -Infinity;
    let booked = 0;
    for (let i = 0; i < 400; i++) {
      for (const s of dueSteps(cur, now, LOOKAHEAD_SEC, (k) => (k % 2 ? 0.19 : 0.2))) {
        expect(s.time).toBeGreaterThan(prev);
        expect(s.time).toBeLessThan(now + LOOKAHEAD_SEC);
        expect(s.time).toBeGreaterThanOrEqual(now - 0.1);
        expect(s.step).toBe(booked);
        prev = s.time;
        booked++;
      }
      now += 0.025;
    }
    // ~10 s of music at ~0.195 s a step.
    expect(booked).toBeGreaterThan(45);
    expect(booked).toBeLessThan(56);
  });

  it("a stalled clock skips ahead instead of bursting the backlog", () => {
    const cur = { step: 10, time: 1 };
    const due = dueSteps(cur, 30, LOOKAHEAD_SEC, () => 0.2);
    expect(due.length).toBe(1);
    expect(due[0].time).toBeGreaterThanOrEqual(30);
  });

  it("the engine's music notes go out in time order within the look-ahead", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.playMusic("battle");
    engine.resume();
    const ctx = FakeAudioContext.last!;
    const calls: { t: number; now: number }[] = [];
    const spy = vi.spyOn(engine as unknown as { playStep: (d: unknown, s: number, t: number) => void }, "playStep");
    spy.mockImplementation((_d, _s, t) => void calls.push({ t, now: ctx.currentTime }));
    advance(3000);
    expect(calls.length).toBeGreaterThan(10);
    for (let i = 0; i < calls.length; i++) {
      expect(calls[i].t).toBeLessThan(calls[i].now + LOOKAHEAD_SEC + 1e-9);
      expect(calls[i].t).toBeGreaterThanOrEqual(calls[i].now - 1e-9);
      if (i > 0) expect(calls[i].t).toBeGreaterThan(calls[i - 1].t);
    }
  });

  it("really synthesizes notes and speeds up at overtime", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "arabic" });
    engine.resume();
    engine.playMusic("battle");
    advance(4000);
    const normal = engine.notesScheduled;
    expect(normal).toBeGreaterThan(10);
    engine.setIntensity(2);
    const before = engine.notesScheduled;
    advance(4000);
    // Drums, hats and the counter-melody join: clearly busier.
    expect(engine.notesScheduled - before).toBeGreaterThan(normal * 1.3);
  });
});

// ---- Music control -------------------------------------------------------

describe("music control", () => {
  it("resume() unlocks audio but never starts music on its own", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    advance(500);
    expect(engine.music).toBe("none");
    expect(engine.musicRunning).toBe(false);
    expect(engine.notesScheduled).toBe(0);
  });

  it("a request made before the unlock plays once audio runs", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.playMusic("menu");
    expect(engine.musicRunning).toBe(false); // no context yet
    engine.resume();
    expect(engine.musicRunning).toBe(true);
    expect(graph(engine).deck?.id).toBe("menu");
  });

  it("crossfades over 0.4 s when the track changes", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    engine.playMusic("menu");
    advance(1000);
    const menuGain = graph(engine).deck!.gain.gain;
    const now = FakeAudioContext.last!.currentTime;
    engine.playMusic("battle");
    const fade = menuGain.events.at(-1)!;
    expect(fade).toMatchObject({ kind: "linear", v: 0 });
    expect(fade.t).toBeCloseTo(now + MUSIC_FADE_SEC, 5);
    const battleGain = graph(engine).deck!.gain.gain;
    expect(graph(engine).deck!.id).toBe("battle");
    expect(battleGain.events[0]).toMatchObject({ kind: "set", v: 0 });
    expect(battleGain.events[1].t).toBeCloseTo(now + MUSIC_FADE_SEC, 5);
    engine.playMusic("none");
    expect(engine.musicRunning).toBe(false);
  });

  it("duck() dips the music 8 dB and restores it", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    engine.duck(true);
    expect(graph(engine).duckGain.gain.value).toBeCloseTo(DUCK_GAIN, 5);
    expect(20 * Math.log10(DUCK_GAIN)).toBeCloseTo(-8, 5);
    engine.duck(false);
    expect(graph(engine).duckGain.gain.value).toBe(1);
  });
});

// ---- Side-aware cues -------------------------------------------------------

describe("side-aware cues", () => {
  it("picks the crowd reaction from the local side", () => {
    expect(crownCue("player", "player")).toBe("cheer");
    expect(crownCue("enemy", "player")).toBe("groan");
    // The online guest plays 'enemy': its crowns are cheers.
    expect(crownCue("enemy", "enemy")).toBe("cheer");
    expect(crownCue("player", "enemy")).toBe("groan");
  });

  it("the guest's ('enemy') win plays the victory jingle", () => {
    expect(jingleFor("enemy", "enemy")).toBe("win");
    expect(jingleFor("player", "enemy")).toBe("lose");
    expect(jingleFor("player", "player")).toBe("win");
    expect(jingleFor("draw", "enemy")).toBe("draw");
  });

  it("the engine routes crown and finish events through the local side", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    const priv = engine as unknown as { crown: (c: string) => void; jingle: (k: string) => void };
    const crown = vi.spyOn(priv, "crown");
    const jingle = vi.spyOn(priv, "jingle");
    engine.setLocalSide("enemy");
    engine.onEvent({ type: "crown", winner: "enemy" });
    engine.onEvent({ type: "crown", winner: "player" });
    engine.onEvent({ type: "finish", winner: "enemy" });
    expect(crown.mock.calls.map((c) => c[0])).toEqual(["cheer", "groan"]);
    expect(jingle).toHaveBeenCalledWith("win");
    engine.setLocalSide("player");
    engine.onEvent({ type: "finish", winner: "enemy" });
    expect(jingle).toHaveBeenLastCalledWith("lose");
  });

  it("pans by arena x, clamped, and mirrored for the guest", () => {
    expect(panFor(9, "player")).toBe(0);
    expect(panFor(0, "player")).toBe(-PAN_LIMIT);
    expect(panFor(18, "player")).toBe(PAN_LIMIT);
    expect(panFor(13.5, "player")).toBeCloseTo(0.5);
    expect(panFor(13.5, "enemy")).toBeCloseTo(-0.5);
    expect(panFor(Number.NaN, "player")).toBe(0);
  });

  it("battle events go through a stereo panner", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    const ctx = FakeAudioContext.last!;
    const make = vi.spyOn(ctx, "createStereoPanner");
    engine.onEvent({ type: "spell", side: "player", cardId: "fireball", x: 2, y: 10 });
    expect(make).toHaveBeenCalledTimes(1);
    expect(make.mock.results[0].value.pan.value).toBeCloseTo(-0.6);
    expect(ctx.started.length).toBeGreaterThan(0);
  });
});

// ---- Volumes ----------------------------------------------------------------

describe("volumes from prefs", () => {
  it("maps sliders and mute to bus gains", () => {
    const g = busGains({ master: 1, music: 0.5, sfx: 0.8, muted: false });
    expect(g.master).toBeGreaterThan(0);
    expect(g.music).toBeCloseTo(busGains({ master: 1, music: 1, sfx: 1, muted: false }).music / 2);
    expect(busGains({ master: 1, music: 1, sfx: 1, muted: true }).master).toBe(0);
    expect(busGains({ master: 0.5, music: 0, sfx: 1, muted: false }).music).toBe(0);
  });

  it("applies saved volumes at start and follows live changes", async () => {
    const saved = JSON.stringify({ v: 1, master: 0.6, music: 0.25, sfx: 0.4 });
    const { sound, prefs } = await load(memoryStorage({ "cr-clone-settings": saved }));
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    const want = sound.busGains(prefs.getPrefs());
    expect(graph(engine).master.gain.value).toBeCloseTo(want.master);
    expect(graph(engine).musicBus.gain.value).toBeCloseTo(want.music);
    expect(graph(engine).sfxBus.gain.value).toBeCloseTo(want.sfx);
    prefs.setPrefs({ music: 1, sfx: 0 });
    expect(graph(engine).musicBus.gain.value).toBeCloseTo(sound.busGains(prefs.getPrefs()).music);
    expect(graph(engine).sfxBus.gain.value).toBe(0);
  });

  it("mute persists across a reload and the engine stays muted", async () => {
    const store = memoryStorage();
    {
      const { sound } = await load(store);
      const engine = new sound.SoundEngine({ edition: "classic" });
      engine.resume();
      engine.setMuted(true);
      expect(engine.muted).toBe(true);
      expect(graph(engine).master.gain.value).toBe(0);
    }
    // "Reload": fresh modules over the same storage.
    const { sound, prefs } = await load(store);
    expect(prefs.getPrefs().muted).toBe(true);
    const engine = new sound.SoundEngine({ edition: "classic" });
    expect(engine.muted).toBe(true);
    engine.resume();
    expect(graph(engine).master.gain.value).toBe(0);
    // Muted: the music keeps time but spends no voices.
    engine.playMusic("menu");
    advance(2000);
    expect(engine.notesScheduled).toBe(0);
    engine.setMuted(false);
    expect(graph(engine).master.gain.value).toBeGreaterThan(0);
  });
});

describe("one-shots", () => {
  it("every reward and UI sound plays without throwing", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "arabic" });
    engine.resume();
    const ctx = FakeAudioContext.last!;
    for (const fn of [
      () => engine.uiTap(),
      () => engine.uiBack(),
      () => engine.chestShake(),
      () => engine.chestOpen(),
      () => engine.cardFlip("epic"),
      () => engine.cardFlip(),
      () => engine.sting("rare"),
      () => engine.sting(),
      () => engine.newCard(),
      () => engine.claim(),
      () => engine.clockTick(3),
      () => engine.countdownBeep(true),
    ]) {
      const before = ctx.started.length;
      fn();
      ctx.currentTime += 0.5; // clear the per-sound throttles
      expect(ctx.started.length).toBeGreaterThan(before);
    }
  });

  it("is silent and safe without Web Audio (node)", () => {
    vi.stubGlobal("AudioContext", undefined);
    return import("./sound").then(({ SoundEngine }) => {
      const s = new SoundEngine({ edition: "classic" });
      expect(() => {
        s.resume();
        s.playMusic("battle");
        s.uiTap();
        s.onEvent({ type: "finish", winner: "player" });
        s.setIntensity(2);
      }).not.toThrow();
      expect(s.intensity).toBe(2);
    });
  });

  it("ranks rarities and lands pricier cards deeper", () => {
    expect(rarityTier("common")).toBe(0);
    expect(rarityTier("rare")).toBe(1);
    expect(rarityTier("epic")).toBe(2);
    expect(rarityTier("legendary")).toBe(3);
    expect(deployPitch(7)).toBeLessThan(deployPitch(3));
  });
});
