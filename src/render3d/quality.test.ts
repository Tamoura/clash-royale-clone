import { describe, expect, it } from "vitest";
import {
  DEFAULT_START,
  GFX_MEMORY_KEY,
  GFX_MEMORY_MAX,
  GFX_NOTE_KEY,
  LOW_END_GPUS,
  MIN_RENDER_SCALE,
  PIN_LEVEL,
  QUALITY_LEVELS,
  QualityGovernor,
  REPROBE_RETRY_MS,
  SETTLE,
  SLOW_WINDOW,
  WARMUP,
  WINDOW,
  autoStartFor,
  currentQuality,
  deviceKey,
  firstGuessLevel,
  levelName,
  liveQuality,
  outlinesEnabled,
  particleScale,
  qualityPinFromUrl,
  readGfxMemory,
  recordGfx,
  sanitizeGfxMemory,
  writeGfxMemory,
  type AutoStart,
  type Settled,
  type StorageLike,
} from "./quality";

/** Run `seconds` of frames whose duration depends on the current level. */
function run(gov: QualityGovernor, frameAt: (level: number) => number, seconds: number): void {
  for (let t = 0; t < seconds; ) {
    const dt = frameAt(gov.index);
    gov.sample(dt);
    t += dt;
  }
}

describe("quality ladder", () => {
  it("has five levels that only ever get cheaper", () => {
    expect(QUALITY_LEVELS).toHaveLength(5);
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const a = QUALITY_LEVELS[i - 1];
      const b = QUALITY_LEVELS[i];
      expect(b.dprCap).toBeLessThanOrEqual(a.dprCap);
      expect(b.pixelBudget).toBeLessThanOrEqual(a.pixelBudget);
      expect(b.minScale).toBeLessThanOrEqual(a.minScale);
      expect(b.minScale).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
      expect(b.bloom).toBeLessThanOrEqual(a.bloom);
      expect(b.shadowSize).toBeLessThanOrEqual(a.shadowSize);
      expect(b.particles).toBeLessThanOrEqual(a.particles);
      expect(Number(b.fxaa)).toBeLessThanOrEqual(Number(a.fxaa));
      expect(Number(b.outlines)).toBeLessThanOrEqual(Number(a.outlines));
      expect(Number(b.rimLight)).toBeLessThanOrEqual(Number(a.rimLight));
      // Every step must actually cut something.
      expect(b).not.toEqual(a);
    }
  });

  it("matches the documented levels", () => {
    const [l0, l1, l2, l3, l4] = QUALITY_LEVELS;
    expect(l0).toEqual({
      dprCap: 2,
      pixelBudget: 2.2e6,
      minScale: 1,
      bloom: 1,
      shadowSize: 2048,
      fxaa: true,
      particles: 1,
      outlines: true,
      rimLight: true,
      troopShadows: true,
      dressing: "full",
      crowdAnim: true,
      tufts: true,
      mixerHz: 60,
    });
    expect(l1).toMatchObject({ dprCap: 2, pixelBudget: 1.7e6, minScale: 0.9, bloom: 0.5, shadowSize: 1024, troopShadows: false, mixerHz: 60 });
    expect(l2).toMatchObject({ dprCap: 1.5, pixelBudget: 1.3e6, minScale: 0.8, bloom: 0, particles: 0.75, crowdAnim: false, tufts: true, mixerHz: 30 });
    expect(l3).toMatchObject({ dprCap: 1.5, pixelBudget: 1e6, minScale: 0.75, shadowSize: 512, particles: 0.5, dressing: "inner", tufts: false, mixerHz: 30 });
    expect(l4).toEqual({
      dprCap: 1.25,
      pixelBudget: 0.75e6,
      minScale: 0.7,
      bloom: 0,
      shadowSize: 0,
      fxaa: false,
      particles: 0.35,
      outlines: false,
      rimLight: false,
      troopShadows: false,
      dressing: "min",
      crowdAnim: false,
      tufts: false,
      mixerHz: 20,
    });
  });

  it("maps the art bible ladder: troop shadows, dressing, crowd, tufts and mixer rates", () => {
    expect(QUALITY_LEVELS.map((l) => l.troopShadows)).toEqual([true, false, false, false, false]);
    expect(QUALITY_LEVELS.map((l) => l.dressing)).toEqual(["full", "full", "full", "inner", "min"]);
    expect(QUALITY_LEVELS.map((l) => l.crowdAnim)).toEqual([true, true, false, false, false]);
    expect(QUALITY_LEVELS.map((l) => l.tufts)).toEqual([true, true, true, false, false]);
    expect(QUALITY_LEVELS.map((l) => l.mixerHz)).toEqual([60, 60, 30, 30, 20]);
  });
});

/** Frame time rounded up to whole 60 Hz refreshes, as vsync presents it. */
const vsync = (s: number): number => Math.ceil(s * 60 - 1e-9) / 60;

/** The levels a governor passes through (and when) over `seconds` of frames. */
function trace(gov: QualityGovernor, frameAt: (level: number) => number, seconds: number): { at: number; to: number }[] {
  const steps: { at: number; to: number }[] = [];
  for (let t = 0; t < seconds; ) {
    const dt = frameAt(gov.index);
    if (gov.sample(dt)) steps.push({ at: t, to: gov.index });
    t += dt;
  }
  return steps;
}

describe("adaptive quality governor", () => {
  it("holds full quality on a device that keeps 60 fps", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 60, 60);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]);
  });

  it("walks down in order while slow and stops at the first fast-enough level", () => {
    // GPU-bound: every step buys frame time; L3 is the first under 1/45 s.
    const cost = [1 / 30, 1 / 36, 1 / 42, 1 / 52, 1 / 65];
    const gov = new QualityGovernor();
    run(gov, (i) => cost[i], WARMUP + WINDOW + 0.1);
    expect(gov.index).toBe(1);
    expect(gov.level.dprCap).toBe(2); // the first cut keeps full resolution on phones
    const steps = trace(gov, (i) => cost[i], 60);
    expect(steps.map((s) => s.to)).toEqual([2, 3]);
    expect(gov.index).toBe(3);
    // Not locked: if L3 gets slow later (a busier fight), the walk carries
    // on from here.
    expect(trace(gov, (i) => (i < 4 ? 1 / 30 : 1 / 65), 10).map((s) => s.to)).toEqual([4]);
  });

  it("goes back to full quality and stops when no level helps (30 fps cap, Low Power Mode)", () => {
    const gov = new QualityGovernor();
    const walk = trace(gov, () => 1 / 30, 30);
    // L1-L3 cost no shader compiles; L4 (light state change) is never tried.
    expect(walk.map((s) => s.to)).toEqual([1, 2, 3, 0]);
    expect(walk[walk.length - 1].at).toBeLessThan(14);
    expect(gov.index).toBe(0);
    expect(gov.level).toEqual(QUALITY_LEVELS[0]); // sharp, with bloom
    expect(trace(gov, () => 1 / 30, 120)).toEqual([]); // and stays there
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]);
  });

  it("keeps walking when vsync hides a step's gain (the old probe locked at L0)", () => {
    // 30 ms at L0; each step's real cost is rounded up to whole refreshes,
    // so L1 (22.5 ms) still presents at 33 ms but L2 (15 ms) makes 60 fps.
    const ratio = [1, 0.75, 0.5, 0.42, 0.25];
    const gov = new QualityGovernor();
    const steps = trace(gov, (i) => vsync(0.03 * ratio[i]), 60);
    expect(gov.index).toBe(2);
    expect(steps.map((s) => s.to)).toEqual([1, 2]);
    expect(steps[steps.length - 1].at).toBeLessThan(12); // settled within 12 s
  });

  it("keeps stepping through levels that change nothing once a step has helped", () => {
    const ms = [60, 40, 39, 38, 20];
    const gov = new QualityGovernor();
    run(gov, (i) => ms[i] / 1000, 60);
    expect(gov.index).toBe(4);
  });

  it("does not take the shader-recompiling step into L4 when no step has helped", () => {
    // Flat from L0 to L3 looks like a frame cap: L4's shadow map and rim
    // light changes would recompile every lit material for nothing.
    const ms = [50, 48, 47, 47, 25];
    const gov = new QualityGovernor();
    const walk = trace(gov, (i) => ms[i] / 1000, 60);
    expect(walk.map((s) => s.to)).not.toContain(4);
    expect(gov.index).toBe(0);
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]); // locked
  });

  it("lets a later walk reach L4 when an earlier step bought frame time", () => {
    const gov = new QualityGovernor();
    run(gov, (i) => [1 / 30, 1 / 50][Math.min(i, 1)], 20); // L1 is fast enough
    expect(gov.index).toBe(1);
    // A busier fight later: L1-L3 are equally slow, only L4 helps.
    run(gov, (i) => (i < 4 ? 1 / 30 : 1 / 60), 30);
    expect(gov.index).toBe(4);
  });

  it("settles on the best-looking level of a plateau (frame cap below the target)", () => {
    const ms = [50, 40, 100 / 3, 100 / 3, 100 / 3];
    const gov = new QualityGovernor();
    run(gov, (i) => ms[i] / 1000, 60);
    expect(gov.index).toBe(2);
    expect(trace(gov, () => 1 / 10, 30)).toEqual([]); // locked
  });

  it("ignores isolated hitches in a 60 fps game (5% of frames at 0.2 s)", () => {
    const gov = new QualityGovernor();
    let n = 0;
    run(gov, () => (++n % 20 === 0 ? 0.2 : 1 / 60), 60);
    expect(gov.index).toBe(0);
  });

  it("steps two levels at once when frames take over twice the target", () => {
    const gov = new QualityGovernor();
    const steps = trace(gov, () => 1 / 15, WARMUP + WINDOW + 0.5);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBe(2);
  });

  it("ignores start-up hitches and long pauses such as a tab switch", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 25; i++) gov.sample(0.1); // 2.5 s of loading jank
    // Long pauses between stretches of normal play (dialogs, GC, a tab switch).
    for (let i = 0; i < 20; i++) {
      gov.sample(1.5);
      run(gov, () => 1 / 60, 1);
    }
    gov.sample(40); // back from another tab
    for (let i = 0; i < 20; i++) gov.sample(0.5, false); // frames while hidden
    run(gov, () => 1 / 60, 20);
    expect(gov.index).toBe(0);
  });

  it("rearm() gives a new battle's start-up a grace period", () => {
    const slowStart = (rearm: boolean): number => {
      const gov = new QualityGovernor();
      run(gov, () => 1 / 60, 10);
      if (rearm) gov.rearm();
      run(gov, () => 1 / 20, SETTLE + WINDOW - 0.1);
      return gov.index;
    };
    expect(slowStart(false)).toBe(2); // judged on the first slow window
    expect(slowStart(true)).toBe(0); // still settling
  });
});

describe("quality pins", () => {
  it("reads high/medium/low from the URL", () => {
    expect(qualityPinFromUrl("?quality=high")).toBe("high");
    expect(qualityPinFromUrl("?quality=medium")).toBe("medium");
    expect(qualityPinFromUrl("?quality=low")).toBe("low");
    expect(qualityPinFromUrl("?quality=ultra")).toBe("auto");
    expect(qualityPinFromUrl("?arena=2")).toBe("auto");
  });

  it("pins Settings high/medium/low to L0/L2/L4 and never auto-steps", () => {
    expect(new QualityGovernor("auto", "high").index).toBe(0);
    expect(new QualityGovernor("auto", "medium").index).toBe(2);
    expect(new QualityGovernor("auto", "low").index).toBe(4);
    const high = new QualityGovernor("auto", "high");
    run(high, () => 1 / 10, 30);
    expect(high.index).toBe(0);
  });

  it("applies a Settings change live, and back to auto restarts at the top", () => {
    const gov = new QualityGovernor();
    expect(gov.setPref("low")).toBe(true);
    expect(gov.level.dprCap).toBe(1.25);
    expect(gov.setPref("low")).toBe(false); // no-op
    expect(gov.setPref("medium")).toBe(true);
    expect(gov.index).toBe(2);
    expect(gov.setPref("auto")).toBe(true);
    expect(gov.index).toBe(0);
    expect(gov.mode).toBe("auto");
  });

  it("lets a URL pin beat the saved setting", () => {
    const gov = new QualityGovernor("high", "low");
    expect(gov.index).toBe(0);
    expect(gov.setPref("low")).toBe(false);
    expect(gov.index).toBe(0);
  });

  it("feeds particleScale() and outlinesEnabled() from the level in force", () => {
    const gov = new QualityGovernor("auto", "low");
    expect(currentQuality()).toBe(QUALITY_LEVELS[4]);
    expect(particleScale()).toBe(0.35);
    expect(outlinesEnabled()).toBe(false);
    gov.setPref("medium");
    expect(particleScale()).toBe(0.75);
    expect(outlinesEnabled()).toBe(true);
    gov.setPref("high");
    expect(particleScale()).toBe(1);
  });
});

describe("very slow devices: a sustained slow window goes straight to the bottom", () => {
  const bottom = QUALITY_LEVELS.length - 1;

  it("steady 0.4 s frames (about 2.4 fps) reach the bottom within a few seconds", () => {
    const gov = new QualityGovernor();
    const steps = trace(gov, () => 0.4, 60);
    expect(steps.map((s) => s.to)).toEqual([bottom]);
    expect(steps[0].at).toBeLessThanOrEqual(WARMUP + SLOW_WINDOW + 0.5);
    expect(gov.index).toBe(bottom);
  });

  it("the tutorial's 1.5 fps too, and it stays at the bottom once it is faster there", () => {
    const gov = new QualityGovernor();
    // 2.3 fps on L0 to L3, 5.7 fps on L4 (the planning measurements).
    const steps = trace(gov, (i) => (i < bottom ? 1 / 1.5 : 1 / 5.7), 120);
    expect(steps.map((s) => s.to)).toEqual([bottom]);
    expect(steps[0].at).toBeLessThan(WARMUP + 4);
  });

  it("isolated spikes never do (a 0.6 s hitch every half second on a 60 fps game)", () => {
    const gov = new QualityGovernor();
    let n = 0;
    run(gov, () => (++n % 30 === 0 ? 0.6 : 1 / 60), 120);
    expect(gov.index).toBe(0);
  });

  it("nor do bursts of four back-to-back hitches (a run of shader compiles)", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 12; i++) {
      run(gov, () => 1 / 60, 3);
      for (let k = 0; k < 4; k++) gov.sample(0.6);
    }
    run(gov, () => 1 / 60, 10);
    expect(gov.index).toBe(0);
  });

  it("a hidden tab never counts, however slow its frames", () => {
    const gov = new QualityGovernor();
    for (let i = 0; i < 300; i++) gov.sample(0.4, false);
    run(gov, () => 1 / 60, 30);
    expect(gov.index).toBe(0);
  });

  it("a pinned level never moves, and a lock that measured the bottom as no faster stays", () => {
    const high = new QualityGovernor("auto", "high");
    run(high, () => 0.4, 60);
    expect(high.index).toBe(0);
    // L2 to L4 measure the same: the walk locks at L2 having tried L4.
    const ms = [60, 40, 39, 38, 40];
    const gov = new QualityGovernor();
    run(gov, (i) => ms[i] / 1000, 60);
    expect(gov.index).toBe(2);
    expect(trace(gov, () => 0.4, 30)).toEqual([]);
  });

  it("a lock that never tried the bottom (a frame cap) still jumps when it becomes a slideshow", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 30, 30); // flat L0..L3: locked back at L0
    expect(gov.index).toBe(0);
    expect(trace(gov, () => 0.4, 30).map((s) => s.to)).toEqual([bottom]);
  });

  it("rearm() gives a new battle's start-up a grace before a slow window", () => {
    const gov = new QualityGovernor();
    run(gov, () => 1 / 60, 10);
    gov.rearm();
    run(gov, () => 0.4, SETTLE + SLOW_WINDOW - 0.5);
    expect(gov.index).toBe(0);
    run(gov, () => 0.4, 2);
    expect(gov.index).toBe(bottom);
  });
});

/** A start as the device memory would hand it to configure(). */
const memoryStart = (level: number, reprobe = true): AutoStart => ({ level, helped: true, reprobe, source: "memory" });

describe("remembered level and the once-per-session try one level up", () => {
  it("starts at the remembered level, with no step-down sequence", () => {
    const gov = new QualityGovernor();
    gov.configure(memoryStart(4, false));
    expect(gov.index).toBe(4);
    expect(trace(gov, (i) => (i < 4 ? 0.4 : 1 / 5.7), 60)).toEqual([]);
  });

  it("reports where it settled: once per level per session", () => {
    const seen: Settled[] = [];
    const gov = new QualityGovernor();
    gov.configure({ ...DEFAULT_START }, (s) => seen.push(s));
    run(gov, () => 1 / 60, 60);
    expect(seen).toEqual([{ level: 0, helped: false, probeFailed: false }]);
    const slow: Settled[] = [];
    const g2 = new QualityGovernor();
    g2.configure({ ...DEFAULT_START }, (s) => slow.push(s));
    run(g2, () => 0.4, 60);
    expect(slow).toEqual([{ level: 4, helped: true, probeFailed: false }]);
  });

  it("tries one level up once, and keeps it when fast enough", () => {
    const seen: Settled[] = [];
    const cost = [1 / 30, 1 / 50, 1 / 60, 1 / 60, 1 / 60];
    const gov = new QualityGovernor();
    gov.configure(memoryStart(2), (s) => seen.push(s));
    const steps = trace(gov, (i) => cost[i], 60);
    expect(steps.map((s) => s.to)).toEqual([1]); // one level up only, never L0 this session
    expect(gov.index).toBe(1);
    expect(seen.map((s) => s.level)).toEqual([2, 1]);
    expect(seen.every((s) => !s.probeFailed)).toBe(true);
  });

  it("steps back when the level up is slow, and says the try failed", () => {
    const seen: Settled[] = [];
    const cost = [1 / 30, 1 / 30, 1 / 60, 1 / 60, 1 / 60];
    const gov = new QualityGovernor();
    gov.configure(memoryStart(2), (s) => seen.push(s));
    const steps = trace(gov, (i) => cost[i], 120);
    expect(steps.map((s) => s.to)).toEqual([1, 2]);
    expect(gov.index).toBe(2);
    expect(seen[seen.length - 1]).toEqual({ level: 2, helped: true, probeFailed: true });
  });

  it("steps back from a level up that is a slideshow (the L4 to L3 try on a weak GPU)", () => {
    const gov = new QualityGovernor();
    gov.configure(memoryStart(4));
    const steps = trace(gov, (i) => (i < 4 ? 0.4 : 1 / 60), 60);
    expect(steps.map((s) => s.to)).toEqual([3, 4]);
    expect(gov.index).toBe(4);
  });

  it("never tries up from L0, without leave, or after Settings round trips", () => {
    const top = new QualityGovernor();
    top.configure(memoryStart(0));
    expect(trace(top, () => 1 / 60, 30)).toEqual([]);
    const noLeave = new QualityGovernor();
    noLeave.configure(memoryStart(3, false));
    expect(trace(noLeave, () => 1 / 60, 30)).toEqual([]);
    const gov = new QualityGovernor();
    gov.configure(memoryStart(3));
    expect(trace(gov, () => 1 / 60, 30).map((s) => s.to)).toEqual([2]);
    gov.setPref("low");
    gov.setPref("auto"); // back to auto: starts where it settled (L2), no second try
    expect(gov.index).toBe(2);
    expect(trace(gov, () => 1 / 60, 30)).toEqual([]);
  });

  it("a remembered level below the top may still walk on into L4 in a busier fight", () => {
    const gov = new QualityGovernor();
    gov.configure(memoryStart(3, false));
    expect(trace(gov, (i) => (i < 4 ? 1 / 30 : 1 / 60), 30).map((s) => s.to)).toEqual([4]);
  });
});

/** An in-memory Storage. */
function fakeStore(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("device memory (cr-clone-gfx-memory)", () => {
  const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

  it("round-trips through storage under its key", () => {
    const store = fakeStore();
    const key = deviceKey(SWIFT, 390, 844, 3);
    writeGfxMemory(store, recordGfx([], key, { level: 4, helped: true, probeFailed: false }, "index-abc", 1000));
    expect(Object.keys(store.data)).toEqual([GFX_MEMORY_KEY]);
    expect(GFX_MEMORY_KEY).toBe("cr-clone-gfx-memory");
    expect(GFX_NOTE_KEY).toBe("cr-clone-gfx-note-seen");
    const back = readGfxMemory(store);
    expect(back).toEqual([{ key, level: 4, helped: true, build: "index-abc", at: 1000, failBuild: "", failAt: 0 }]);
    expect(autoStartFor(back[0], 0, "index-abc", 2000)).toEqual({ level: 4, helped: true, reprobe: true, source: "memory" });
  });

  it("keeps the memory across builds (updates go live often) and only lets a failed try wait", () => {
    const key = "gpu|800x400@3";
    let m = recordGfx([], key, { level: 2, helped: true, probeFailed: true }, "build-a", 1000);
    expect(m[0]).toMatchObject({ level: 2, failBuild: "build-a", failAt: 1000 });
    expect(autoStartFor(m[0], 0, "build-a", 2000).reprobe).toBe(false); // same build: wait
    expect(autoStartFor(m[0], 0, "build-b", 2000)).toEqual({ level: 2, helped: true, reprobe: true, source: "memory" });
    expect(autoStartFor(m[0], 0, "build-a", 1000 + REPROBE_RETRY_MS + 1).reprobe).toBe(true); // a week on
    // A later settle under a new build keeps the failed try on record until it is retried.
    m = recordGfx(m, key, { level: 2, helped: true, probeFailed: false }, "build-b", 3000);
    expect(m[0]).toMatchObject({ build: "build-b", failBuild: "build-a" });
    expect(autoStartFor({ ...m[0], level: 0 }, 4, "build-b", 4000)).toMatchObject({ level: 0, reprobe: false });
  });

  it("sanitises: junk, other shapes, bad levels, odd characters, duplicates and too many devices", () => {
    expect(readGfxMemory(fakeStore({ [GFX_MEMORY_KEY]: "{not json" }))).toEqual([]);
    expect(readGfxMemory(fakeStore({ [GFX_MEMORY_KEY]: JSON.stringify({ v: 2, devices: [] }) }))).toEqual([]);
    expect(readGfxMemory(fakeStore({ [GFX_MEMORY_KEY]: JSON.stringify([1, 2]) }))).toEqual([]);
    expect(readGfxMemory(fakeStore({ [GFX_MEMORY_KEY]: "x".repeat(5000) }))).toEqual([]);
    expect(readGfxMemory(fakeStore())).toEqual([]);
    expect(readGfxMemory(null)).toEqual([]);
    const devices = [
      { key: "a", level: 5, at: 1 },
      { key: "b", level: -1, at: 1 },
      { key: "c", level: 1.5, at: 1 },
      { key: "d", level: "2", at: 1 },
      { key: "", level: 2, at: 1 },
      { key: "e\u0000‮<script>", level: 3, at: 10, helped: "yes", build: 7, failAt: -4 },
      { key: "f", level: 1, at: 20 },
      { key: "f", level: 4, at: 5 }, // older duplicate
      { key: "g", level: 0, at: 30 },
      { key: "h", level: 0, at: 40 },
      { key: "i", level: 2, at: 50 },
      { key: "k".repeat(500), level: 2, at: Number.NaN },
    ];
    const out = sanitizeGfxMemory({ v: 1, devices });
    expect(out.map((e) => e.key)).toEqual(["i", "h", "g", "f"]); // newest first, at most 4
    expect(out.length).toBe(GFX_MEMORY_MAX);
    expect(out.find((e) => e.key === "f")?.level).toBe(1);
    const odd = sanitizeGfxMemory({ v: 1, devices: [devices[5], devices[11]] });
    expect(odd[0]).toEqual({ key: "e<script>", level: 3, helped: false, build: "", at: 10, failBuild: "", failAt: 0 });
    expect(odd[1].key.length).toBeLessThanOrEqual(160);
    expect(odd[1].at).toBe(0);
  });

  it("never throws when storage does (private mode, quota)", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readGfxMemory(broken)).toEqual([]);
    expect(() => writeGfxMemory(broken, recordGfx([], "k", { level: 1, helped: false, probeFailed: false }, "b", 1))).not.toThrow();
  });

  it("keys by renderer string and a screen-size bucket (rotation-proof)", () => {
    const phone = deviceKey(SWIFT, 390, 844, 3);
    expect(phone).toBe(`${SWIFT}|800x400@3`);
    expect(deviceKey(SWIFT, 844, 390, 3)).toBe(phone); // landscape is the same screen
    expect(deviceKey(SWIFT, 402, 822, 2.9)).toBe(phone); // a near size lands in the same bucket
    expect(deviceKey(SWIFT, 1440, 900, 1)).toBe(`${SWIFT}|1400x900@1`);
    expect(deviceKey("Mali-G52 MC2", 1440, 900, 1)).not.toBe(deviceKey(SWIFT, 1440, 900, 1));
    expect(deviceKey("", 0, 0, Number.NaN)).toBe("unknown|0x0@1");
    expect(deviceKey("gpu\n\tname\u0007", 800, 1280, 1.33)).toBe("gpu name|1300x800@1.5");
  });
});

describe("first guess for a brand-new device", () => {
  it("starts software renderers at the bottom", () => {
    for (const r of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "ANGLE (Mesa, llvmpipe (LLVM 12.0.0, 256 bits), OpenGL 4.5)",
      "Microsoft Basic Render Driver",
      "Software Rasterizer",
    ]) {
      expect(firstGuessLevel(r)).toBe(4);
    }
  });

  it("starts the low-end GPU families in the table at L3", () => {
    expect(LOW_END_GPUS.length).toBeLessThanOrEqual(8); // a short, documented table
    for (const r of [
      "Mali-G52 MC2",
      "ANGLE (ARM, Mali-T720, OpenGL ES 3.1)",
      "Mali-400 MP",
      "Adreno (TM) 505",
      "Adreno (TM) 610",
      "ANGLE (Qualcomm, Adreno (TM) 308, OpenGL ES 3.0)",
      "PowerVR Rogue GE8320",
      "ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL ES 3.2)",
      "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Mesa Intel(R) HD Graphics 400 (BSW)",
      "V3D 4.2",
    ]) {
      expect(firstGuessLevel(r), r).toBe(3);
    }
  });

  it("starts everything else at L0, as before", () => {
    for (const r of [
      "Adreno (TM) 650",
      "Adreno (TM) 618",
      "Mali-G78 MP14",
      "Apple GPU",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) HD Graphics 4600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "unknown",
      "",
    ]) {
      expect(firstGuessLevel(r), r).toBe(0);
    }
  });

  it("a guess starts auto there, may try up once, and steps into L4 without waiting", () => {
    expect(autoStartFor(undefined, 0, "b", 1)).toEqual(DEFAULT_START);
    const start = autoStartFor(undefined, 3, "b", 1);
    expect(start).toEqual({ level: 3, helped: true, reprobe: true, source: "guess" });
    const gov = new QualityGovernor();
    gov.configure(start);
    expect(gov.index).toBe(3);
  });
});

describe("pins win over memory and guesses", () => {
  it("a ?quality= pin ignores the memory, and reports nothing", () => {
    const seen: Settled[] = [];
    const gov = new QualityGovernor("high");
    gov.configure(memoryStart(4), (s) => seen.push(s));
    expect(gov.index).toBe(0);
    run(gov, () => 0.4, 30);
    expect(gov.index).toBe(0);
    gov.setPref("auto"); // the URL pin still wins
    expect(gov.index).toBe(0);
    const low = new QualityGovernor("low");
    low.configure(memoryStart(0));
    expect(low.index).toBe(4);
    expect(seen).toEqual([]);
  });

  it("a Settings pin ignores the memory; back to Auto starts at the remembered level", () => {
    const gov = new QualityGovernor("auto", "medium");
    gov.configure(autoStartFor(undefined, 4, "b", 1));
    expect(gov.index).toBe(2);
    gov.setPref("high");
    expect(gov.index).toBe(0);
    gov.setPref("auto");
    expect(gov.index).toBe(4);
    expect(gov.mode).toBe("auto");
  });
});

describe("what Settings shows for Auto", () => {
  it("names each level after the nearest pin", () => {
    expect(QUALITY_LEVELS.map((_, i) => levelName(i))).toEqual(["high", "high", "medium", "medium", "low"]);
    expect(levelName(PIN_LEVEL.low)).toBe("low");
  });

  it("reads the live level and pin", () => {
    const gov = new QualityGovernor();
    gov.configure(memoryStart(3, false));
    expect(liveQuality()).toEqual({ index: 3, mode: "auto" });
    run(gov, () => 0.4, 30);
    expect(liveQuality()).toEqual({ index: 4, mode: "auto" });
    gov.setPref("medium");
    expect(liveQuality()).toEqual({ index: 2, mode: "medium" });
  });
});
