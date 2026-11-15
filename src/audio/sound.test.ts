import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOOKAHEAD_SEC,
  MAX_LOOKAHEAD_SEC,
  MUSIC_FADE_SEC,
  MUSIC_START_SEC,
  STEPS_PER_BAR,
  TRACKS,
  clockTickDue,
  compileTrack,
  degreeSemis,
  dueSteps,
  hushedLayers,
  layersAt,
  lookaheadFor,
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
  setPeriodicWave() {
    this.type = "custom";
  }
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
  createPeriodicWave() {
    return {};
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

  it("the menu theme is 64 steps in A/B sections", () => {
    const def = TRACKS.menu;
    expect(def.chords.length * STEPS_PER_BAR).toBe(64);
    expect(def.sections.map((s) => s.name)).toEqual(["A", "B"]);
    for (const edition of ["classic", "arabic"] as const) {
      const c = compileTrack(def, edition);
      expect(c.steps.filter((s) => s.lead).length).toBeGreaterThan(c.length / 4);
    }
  });

  it("every line fills its loop exactly and stays in a sane register", () => {
    for (const def of Object.values(TRACKS)) {
      const length = def.chords.length * STEPS_PER_BAR;
      // Every line fills the loop exactly; no stray tokens.
      const lines = [def.lead, def.bass, def.arp];
      if (def.hats) lines.push(def.hats);
      for (const edition of ["classic", "arabic"] as const) {
        for (const line of [def.drums[edition], def.answers?.[edition], def.rolls?.[edition]]) if (line) lines.push(line);
      }
      for (const line of lines) expect(parseLine(line).steps).toBe(length);
      for (const edition of ["classic", "arabic"] as const) {
        const c = compileTrack(def, edition);
        expect(c.length).toBe(length);
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

  it("War Drums is a 32-bar loop in five named sections", () => {
    const def = TRACKS.battle;
    expect(def.chords.length * STEPS_PER_BAR).toBe(256);
    expect(def.sections).toEqual([
      { name: "call", bar: 0 },
      { name: "march", bar: 8 },
      { name: "answer", bar: 16 },
      { name: "break", bar: 24 },
      { name: "charge", bar: 28 },
    ]);
    // The drone (the bass line) is the low bed: D2 and G2, long held notes.
    for (const edition of ["classic", "arabic"] as const) {
      const bass = compileTrack(def, edition).steps.flatMap((s) => (s.bass ? [s.bass] : []));
      expect(bass.length).toBeLessThanOrEqual(def.chords.length);
      for (const n of bass) {
        expect(n.len).toBeGreaterThanOrEqual(STEPS_PER_BAR);
        expect([-24, -19]).toContain(n.semis);
      }
    }
  });

  it("each edition renders the same tune in its own mode", () => {
    const classic = compileTrack(TRACKS.battle, "classic");
    const arabic = compileTrack(TRACKS.battle, "arabic");
    const rhythm = (c: typeof classic) => c.steps.map((s) => (s.lead ? s.lead.len : 0));
    expect(rhythm(arabic)).toEqual(rhythm(classic));
    expect(arabic.steps.map((s) => s.lead?.semis)).not.toEqual(classic.steps.map((s) => s.lead?.semis));
    expect(TRACKS.battle.voices.classic).toEqual({ lead: "horn", bass: "drone", arp: "brass" });
    expect(TRACKS.battle.voices.arabic).toEqual({ lead: "nafir", bass: "arghul", arp: "mizmar" });
  });

  it("each edition beats its own war drums: no shared letters, no darbuka", () => {
    const kit = (edition: "classic" | "arabic"): Set<string> => {
      const c = compileTrack(TRACKS.battle, edition);
      return new Set(c.steps.flatMap((s) => [s.drum, s.answer, s.roll]).join("").toUpperCase().split(""));
    };
    expect([...kit("classic")].sort()).toEqual(["B", "C", "H", "L", "R", "S"]);
    expect([...kit("arabic")].sort()).toEqual(["A", "F", "N", "Q", "U", "Z"]);
    // The menu keeps its darbuka (D dum, T tak).
    const menu = compileTrack(TRACKS.menu, "arabic");
    expect(new Set(menu.steps.map((s) => s.drum?.toUpperCase()).filter(Boolean))).toEqual(new Set(["D", "T"]));
  });

  it("the drums play from the first beat, with a big stroke on every downbeat", () => {
    for (const level of [0, 1, 2] as const) expect(layersAt(TRACKS.battle, level).drums).toBe(true);
    const big = { classic: "B", arabic: "U" } as const;
    for (const edition of ["classic", "arabic"] as const) {
      const c = compileTrack(TRACKS.battle, edition);
      for (let bar = 0; bar < TRACKS.battle.chords.length; bar++) {
        const groove = c.steps.slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).map((s) => s.drum);
        expect(groove[0]).toBe(big[edition]);
        expect(groove.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("every 4-bar phrase ends in a drum fill: a run of four full strokes over the big drum", () => {
    const run = (bar: (string | undefined)[]): boolean => bar.slice(4).every((t) => !!t && t === t.toUpperCase());
    const big = { classic: "B", arabic: "U" } as const;
    for (const edition of ["classic", "arabic"] as const) {
      const c = compileTrack(TRACKS.battle, edition);
      const groove = (bar: number) => c.steps.slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).map((s) => s.drum);
      const booms = (bar: (string | undefined)[]): number => bar.filter((t) => t?.includes(big[edition])).length;
      for (let phrase = 0; phrase < TRACKS.battle.chords.length / 4; phrase++) {
        const bars = [0, 1, 2, 3].map((i) => groove(phrase * 4 + i));
        expect(bars.map(run)).toEqual([false, false, false, true]);
        // The fill builds: the big drum strikes inside its run, and at least
        // as often as in the groove bar before it (a fill is never a drop).
        const fill = bars[3];
        expect(booms(fill.slice(4)), `${edition} phrase ${phrase + 1}`).toBeGreaterThanOrEqual(2);
        expect(booms(fill), `${edition} phrase ${phrase + 1}`).toBeGreaterThanOrEqual(booms(bars[2]));
      }
    }
  });

  it("horn calls are short phrases with space between them; the break is drums alone", () => {
    const def = TRACKS.battle;
    const c = compileTrack(def, "classic");
    const sounding = new Array<boolean>(c.length).fill(false);
    c.steps.forEach((s, i) => {
      for (let k = 0; s.lead && k < s.lead.len; k++) sounding[i + k] = true;
    });
    expect(sounding.filter(Boolean).length).toBeLessThan(c.length * 0.6);
    const brk = def.sections.find((s) => s.name === "break")!.bar * STEPS_PER_BAR;
    for (let i = brk; i < brk + 4 * STEPS_PER_BAR; i++) {
      expect(c.steps[i].lead).toBeUndefined();
      expect(c.steps[i].arp).toBeUndefined();
    }
    // Calls never run longer than two bars without a rest.
    let run = 0;
    for (const on of sounding) {
      run = on ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(2 * STEPS_PER_BAR);
    }
  });

  it("intensity: answering drums, hats and the second horn at 1; rolls, ghost strokes and a faster tempo at 2", () => {
    const def = TRACKS.battle;
    expect(layersAt(def, 0)).toEqual({ arp: false, hats: false, drums: true, answers: false, rolls: false });
    expect(layersAt(def, 1)).toEqual({ arp: true, hats: true, drums: true, answers: true, rolls: false });
    expect(layersAt(def, 2)).toEqual({ arp: true, hats: true, drums: true, answers: true, rolls: true });
    expect(stepSeconds(def, 1)).toBeLessThan(stepSeconds(def, 0));
    expect(stepSeconds(def, 2)).toBeLessThan(stepSeconds(def, 1));
    expect(stepSeconds(def, 2) / stepSeconds(def, 0)).toBeLessThan(0.9);
    expect(MUSIC_STEP_MS[2]).toBeLessThan(MUSIC_STEP_MS[0]);
    // Overtime rolls into every second bar, for two steps into every phrase
    // (and so every section) and four into the break. Between them, soft
    // ghost strokes fill the off-steps the groove leaves empty.
    const rollOf = { classic: "R", arabic: "Z" } as const;
    const ghostOf = { classic: "s", arabic: "a" } as const;
    for (const edition of ["classic", "arabic"] as const) {
      const c = compileTrack(def, edition);
      const rolling = (bar: number): number =>
        c.steps.slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).filter((s) => s.roll === rollOf[edition]).length;
      for (let bar = 0; bar < def.chords.length; bar++) {
        const want = bar % 2 === 0 ? 0 : bar % 4 === 1 ? 1 : bar === 27 ? 4 : 2;
        expect(rolling(bar), `${edition} bar ${bar + 1}`).toBe(want);
        if (want) expect(c.steps[(bar + 1) * STEPS_PER_BAR - 1].roll).toBe(rollOf[edition]);
      }
      let ghosts = 0;
      c.steps.forEach((s, i) => {
        if (s.roll !== ghostOf[edition]) return;
        ghosts++;
        expect(i % 2).toBe(1); // off-steps only
        expect(s.drum).toBeUndefined(); // where the groove is silent
      });
      expect(ghosts).toBeGreaterThan(c.length / 8);
      expect(new Set(c.steps.map((s) => s.roll).filter(Boolean))).toEqual(new Set([rollOf[edition], ghostOf[edition]]));
    }
    // The menu theme ignores the match's intensity.
    expect(stepSeconds(TRACKS.menu, 2)).toBe(stepSeconds(TRACKS.menu, 0));
  });

  it("a held clock keeps only the quietest bed: the pad, else the bass (War Drums' drone)", () => {
    const none = { lead: false, arp: false, hats: false, drums: false, answers: false, rolls: false };
    expect(hushedLayers(TRACKS.battle)).toEqual({ ...none, bass: true, pad: false });
    expect(hushedLayers(TRACKS.menu)).toEqual({ ...none, bass: false, pad: true });
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

  it("stretches the window when timers run late, within a cap", () => {
    expect(lookaheadFor(0)).toBe(LOOKAHEAD_SEC);
    expect(lookaheadFor(0.025)).toBe(LOOKAHEAD_SEC);
    expect(lookaheadFor(0.2)).toBeCloseTo(0.3);
    expect(lookaheadFor(5)).toBe(MAX_LOOKAHEAD_SEC);
  });

  it("a slightly late step still plays; a stalled clock skips ahead instead of bursting the backlog", () => {
    const late = { step: 3, time: 9.85 };
    expect(dueSteps(late, 10, LOOKAHEAD_SEC, () => 0.2).map((s) => s.step)).toEqual([3, 4]);

    const cur = { step: 10, time: 1 };
    const due = dueSteps(cur, 30, LOOKAHEAD_SEC, () => 0.2);
    expect(due.length).toBe(1);
    expect(due[0].time).toBeGreaterThanOrEqual(30);
  });

  it("keeps the music fed through janky frames", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.playMusic("menu");
    engine.resume();
    const ctx = FakeAudioContext.last!;
    const steps: number[] = [];
    const spy = vi.spyOn(engine as unknown as { playStep: (d: unknown, s: number, t: number) => void }, "playStep");
    spy.mockImplementation((_d, s) => void steps.push(s));
    // The main thread blocks for 200 ms at a time: timers fire that late.
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.2;
      vi.advanceTimersByTime(200);
    }
    // 8 s at 0.29 s a step: every step booked, none skipped.
    expect(steps.length).toBeGreaterThanOrEqual(27);
    expect(steps).toEqual(steps.map((_, i) => steps[0] + i));
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

  it("really synthesizes notes and drum strokes from the first beat, busier and faster at overtime", async () => {
    const run = async (level: 0 | 2) => {
      const { sound } = await load(memoryStorage());
      const engine = new sound.SoundEngine({ edition: "arabic" });
      engine.resume();
      engine.setIntensity(level);
      engine.playMusic("battle");
      const priv = engine as unknown as { playStep: (d: unknown, s: number, t: number) => void };
      const real = priv.playStep.bind(engine);
      let steps = 0;
      vi.spyOn(priv, "playStep").mockImplementation((d, s, t) => {
        steps++;
        real(d, s, t);
      });
      advance(8000);
      return { notes: engine.notesScheduled, hits: engine.drumHits, steps };
    };
    const normal = await run(0);
    expect(normal.notes).toBeGreaterThan(5);
    expect(normal.hits).toBeGreaterThan(15); // the drums play in normal time
    const overtime = await run(2);
    expect(overtime.steps).toBeGreaterThan(normal.steps * 1.1); // faster
    // The answering drums, jingles, rolls and the second horn join.
    expect(overtime.hits + overtime.notes).toBeGreaterThan((normal.hits + normal.notes) * 1.3);
  });

  it("an intensity change takes the next step, without a stumble", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    engine.playMusic("battle");
    const times: number[] = [];
    const spy = vi.spyOn(engine as unknown as { playStep: (d: unknown, s: number, t: number) => void }, "playStep");
    spy.mockImplementation((_d, _s, t) => void times.push(t));
    advance(3000);
    const switchAt = FakeAudioContext.last!.currentTime;
    engine.setIntensity(2);
    advance(3000);
    const [slow, fast] = [stepSeconds(TRACKS.battle, 0), stepSeconds(TRACKS.battle, 2)];
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // Every gap is one step at the old or the new tempo, and the tempo
    // changes once: nothing skipped, doubled or dragged.
    const kinds = gaps.map((g) => (Math.abs(g - slow) < 1e-6 ? "slow" : Math.abs(g - fast) < 1e-6 ? "fast" : "stumble"));
    expect(kinds).not.toContain("stumble");
    const firstFast = kinds.indexOf("fast");
    expect(firstFast).toBeGreaterThan(0);
    expect(kinds.slice(firstFast).every((k) => k === "fast")).toBe(true);
    // ... from the first step booked after the change.
    expect(times[firstFast]).toBeLessThanOrEqual(switchAt + LOOKAHEAD_SEC + slow);
  });

  it("every drum letter has a voice, and strokes reuse the cached noise and skin wave", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    const ctx = FakeAudioContext.last!;
    const buffers = vi.spyOn(ctx, "createBuffer");
    const waves = vi.spyOn(ctx, "createPeriodicWave");
    const priv = engine as unknown as { drum: (k: string, t: number, out: unknown, level: number, sec: number) => void };
    const out = ctx.createGain();
    for (const k of "BLHSRCUANQZFDTbscuat") {
      const [hits, started] = [engine.drumHits, ctx.started.length];
      priv.drum(k, 1, out, 1, 0.2);
      expect(engine.drumHits, k).toBe(hits + 1);
      expect(ctx.started.length, k).toBeGreaterThan(started);
    }
    expect(ctx.started.some((s) => s.type === "custom")).toBe(true); // the skins' wave
    expect(buffers).not.toHaveBeenCalled();
    expect(waves).not.toHaveBeenCalled();
  });

  it("the engine plays each drum layer from its intensity, the drone overlapping, and every stroke accented", async () => {
    const def = TRACKS.battle;
    type Accent = { level: number; tune: number; slap: number };
    for (const edition of ["classic", "arabic"] as const) {
      const c = compileTrack(def, edition);
      const letters = (key: "drum" | "answer" | "roll"): string => c.steps.map((s) => s[key] ?? "").join("");
      const levels: Record<number, number> = {};
      for (const level of [0, 1, 2] as const) {
        const { sound } = await load(memoryStorage());
        const engine = new sound.SoundEngine({ edition });
        engine.resume();
        engine.setIntensity(level);
        engine.playMusic("battle");
        const priv = engine as unknown as {
          playStep: (d: unknown, s: number, t: number) => void;
          drum: (k: string, t: number, out: unknown, level: number, sec: number, a?: Accent) => void;
          voice: (id: string, f: number, t: number, dur: number, ...r: unknown[]) => void;
        };
        const strokes: { k: string; step: number; level: number; a?: Accent }[] = [];
        const drones: { step: number; dur: number }[] = [];
        let step = 0;
        const drum = priv.drum.bind(engine);
        vi.spyOn(priv, "drum").mockImplementation((k, t, out, lv, sec, a) => {
          strokes.push({ k, step, level: lv, a });
          drum(k, t, out, lv, sec, a);
        });
        const voice = priv.voice.bind(engine);
        vi.spyOn(priv, "voice").mockImplementation((id, f, t, dur, ...r) => {
          if (id === def.voices[edition].bass) drones.push({ step, dur });
          voice(id, f, t, dur, ...r);
        });
        // The engine's own step player, over the whole loop.
        for (step = 0; step < c.length; step++) priv.playStep(graph(engine).deck, step, 1 + step * 0.25);
        // Exactly the groove, plus the answering drums from double elixir
        // and the rolls and ghost strokes in overtime: nothing more or less.
        const want = letters("drum") + (level >= 1 ? letters("answer") : "") + (level >= 2 ? letters("roll") : "");
        expect(strokes.map((s) => s.k).sort().join(""), `${edition} ${level}`).toBe([...want].sort().join(""));
        // Every drone note sounds a little past its written length (bassGate > 1), so the bed never dips.
        expect(def.bassGate).toBeGreaterThan(1);
        expect(drones.length).toBeGreaterThan(0);
        for (const d of drones) expect(d.dur).toBeCloseTo(c.steps[d.step].bass!.len * stepSeconds(def, level) * def.bassGate!, 9);
        // Strokes vary: the downbeat's slap is harder, and the big drum is
        // never struck the same way twice in a row.
        const big = strokes.filter((s) => s.k === (edition === "classic" ? "B" : "U"));
        for (const s of big) expect(s.a!.slap > 1).toBe(s.step % STEPS_PER_BAR === 0);
        for (let i = 1; i < big.length; i++) expect([big[i].level, big[i].a!.tune]).not.toEqual([big[i - 1].level, big[i - 1].a!.tune]);
        levels[level] = strokes.find((s) => s.step === 0)!.level;
      }
      // The groove plays harder in overtime.
      expect(levels[1]).toBe(levels[0]);
      expect(levels[2]).toBeGreaterThan(levels[1] * 1.05);
    }
  });

  it("every war drum sounds where a phone speaker can play it", async () => {
    const waves = vi.spyOn(FakeAudioContext.prototype, "createPeriodicWave");
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    // The skins' wave: a fundamental and its overtones at 2x, 3x and 4x.
    expect(waves).toHaveBeenCalledTimes(1);
    const amp = [...((waves.mock.calls[0] as unknown[])[1] as Float32Array)];
    expect(amp[0]).toBe(0);
    const overtoneIn = (f: number, lo: number, hi: number): boolean =>
      amp.some((a, n) => n >= 2 && a >= 0.25 && n * f >= lo && n * f <= hi);
    const ctx = FakeAudioContext.last!;
    const priv = engine as unknown as { drum: (k: string, t: number, out: unknown, level: number, sec: number, a?: unknown) => void };
    const out = ctx.createGain();
    const tunes = Array.from({ length: 256 }, (_, s) => sound.strokeAccent(s).tune);
    for (const tune of [Math.min(...tunes), 1, Math.max(...tunes)]) {
      for (const k of "BLHSUANQZF") {
        const before = ctx.started.length;
        priv.drum(k, 1, out, 1, 0.2, { level: 1, tune, slap: 1 });
        const skins = ctx.started.slice(before).filter((s) => s.type === "custom");
        expect(skins.length, k).toBe(1);
        const f = skins[0].frequency.events.map((e) => e.v);
        // The stick's attack and the struck pitch at 100 Hz or above; the
        // ring settles no lower than 60 Hz, so nothing is spent below 40 Hz.
        expect(f[0], k).toBeGreaterThanOrEqual(100);
        expect(Math.min(...f), k).toBeGreaterThanOrEqual(60);
        if (k === "B" || k === "U") {
          // The big drums carry their body in 120-500 Hz overtones, at the
          // hit and as they ring out.
          expect(f[1], k).toBeGreaterThanOrEqual(100);
          expect(overtoneIn(f[1], 120, 500), `${k} struck`).toBe(true);
          expect(overtoneIn(Math.min(...f), 120, 500), `${k} ringing`).toBe(true);
        }
      }
    }
  });

  it("War Drums' strokes vary in a fixed pattern: a harder downbeat slap, no two bars alike", async () => {
    const { sound } = await load(memoryStorage());
    const a = (s: number) => sound.strokeAccent(s);
    for (let s = 0; s < 256; s++) {
      const downbeat = s % STEPS_PER_BAR === 0;
      expect(20 * Math.log10(a(s).slap)).toBeCloseTo(downbeat ? 1.5 : 0, 1);
      expect(a(s).level).toBeGreaterThan(0.85);
      expect(a(s).level).toBeLessThan(1.1);
      expect(Math.abs(12 * Math.log2(a(s).tune))).toBeLessThan(1); // under a semitone
      expect(a(s)).toEqual(a(s)); // no randomness
    }
    // Downbeats ring a touch higher, on average.
    const mean = (xs: number[]): number => xs.reduce((x, y) => x + y, 0) / xs.length;
    const steps = Array.from({ length: 256 }, (_, i) => i);
    const tuneOf = (down: boolean) => mean(steps.filter((i) => (i % STEPS_PER_BAR === 0) === down).map((i) => a(i).tune));
    expect(tuneOf(true)).toBeGreaterThan(tuneOf(false) * 1.01);
    const bar = (b: number) => Array.from({ length: STEPS_PER_BAR }, (_, k) => a(b * STEPS_PER_BAR + k));
    // Bars 1 and 2 of the call play the same groove, but not the same strokes.
    expect(bar(1)).not.toEqual(bar(0));
  });
});

// ---- The quiet wait ------------------------------------------------------------

describe("hushed battle music", () => {
  it("keeps only the drone while hushed, and the drums come back after", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    engine.playMusic("battle");
    advance(4000);
    expect(engine.drumHits).toBeGreaterThan(8);
    const voices: string[] = [];
    const priv = engine as unknown as { voice: (id: string, ...rest: unknown[]) => void };
    const real = priv.voice.bind(engine);
    vi.spyOn(priv, "voice").mockImplementation((id, ...rest) => {
      voices.push(id);
      real(id, ...rest);
    });
    engine.setHushed(true);
    expect(engine.hushed).toBe(true);
    const hits = engine.drumHits;
    advance(8000);
    expect(engine.drumHits).toBe(hits); // no drums, answers or rolls
    expect(voices.length).toBeGreaterThan(0); // still music: the drone sounds on
    expect(new Set(voices)).toEqual(new Set(["drone"])); // no horns
    engine.setHushed(false);
    advance(4000);
    expect(engine.drumHits - hits).toBeGreaterThan(8);
  });

  it("never hushes the menu theme", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "arabic" });
    engine.resume();
    engine.playMusic("menu");
    advance(4000);
    const normal = engine.notesScheduled;
    engine.setHushed(true);
    const before = engine.notesScheduled;
    advance(4000);
    expect(engine.notesScheduled - before).toBeGreaterThan(normal * 0.8);
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

  it("from silence the battle track's first beat lands at full strength", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "classic" });
    engine.resume();
    const now = FakeAudioContext.last!.currentTime;
    engine.playMusic("battle"); // after the countdown: nothing was playing
    const gain = graph(engine).deck!.gain.gain;
    expect(gain.events[0]).toMatchObject({ kind: "set", v: 0 });
    expect(gain.events[1]).toMatchObject({ kind: "linear", v: 1 });
    expect(gain.events[1].t).toBeCloseTo(now + MUSIC_START_SEC, 5);
    expect(MUSIC_START_SEC).toBeLessThan(0.05); // before the first step
  });

  it("the menu theme still fades in over 0.4 s from silence, at start-up and after a match", async () => {
    const { sound } = await load(memoryStorage());
    const engine = new sound.SoundEngine({ edition: "arabic" });
    engine.resume();
    const ctx = FakeAudioContext.last!;
    const fadesIn = (): void => {
      const now = ctx.currentTime;
      engine.playMusic("menu");
      const gain = graph(engine).deck!.gain.gain;
      expect(gain.events[0]).toMatchObject({ kind: "set", v: 0, t: now });
      expect(gain.events[1]).toMatchObject({ kind: "linear", v: 1 });
      expect(gain.events[1].t).toBeCloseTo(now + MUSIC_FADE_SEC, 5);
    };
    fadesIn(); // the first start of the app
    engine.playMusic("none");
    advance(1000);
    engine.playMusic("battle");
    advance(2000);
    engine.playMusic("none"); // the match ends: results play no music
    advance(2000);
    fadesIn(); // then Home plays the menu from silence
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
