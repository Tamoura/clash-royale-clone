/**
 * Render quality ladder. Five ordered levels trade picture for frame time,
 * cheapest cuts first: bloom resolution and shadow-map size (barely
 * visible), then bloom itself, resolution and particle density, and last
 * the shadow map, FXAA, rim light and outlines. Every level also has a
 * pixel budget, so a big (full-screen desktop) canvas sheds resolution on
 * each step, down to MIN_RENDER_SCALE, even where the device ratio is 1.
 *
 * The player's Settings pick the level (prefs.quality): 'high', 'medium'
 * and 'low' pin L0, L2 and L4; 'auto' lets the governor below walk the
 * ladder. A ?quality= URL pin beats the saved setting (screenshots, tests).
 *
 * The governor watches real frame times, judging each window of frames by
 * its trimmed mean (the slowest 10% dropped, so a lone GC pause or shader
 * compile never costs picture, while a steadily slow frame still counts).
 * While the game is slow it walks down the ladder, a step per window (two
 * when frames take over twice the target), whether or not the last step
 * helped: on one screen a step changes little and on the next a lot, and
 * vsync rounds frame times to whole refreshes. It stops at the first level
 * that is fast enough and stays free, so a later slowdown carries on from
 * there. If even L4 is slow, the slowness wasn't ours to fix (e.g. iOS Low
 * Power Mode caps the page at 30 fps no matter what we draw, or the CPU is
 * the bottleneck), so it goes back to the shallowest level it measured as
 * fast as the best (within TIE) and stops for the session. It never steps
 * back up, so the picture doesn't flicker.
 *
 * The step into L4 is the one exception to "whether or not the last step
 * helped": it turns off the shadow map and the rim light, which changes the
 * light state, so every lit material compiles a new shader on its next draw
 * (9 programs, most of a second on a phone), and the way back up compiles
 * again. So the governor only takes it once some step this session has
 * bought frame time (a level measured faster than its walk's first by more
 * than TIE, or fast enough). A walk that is flat from L0 to L3 is a frame
 * cap (or a CPU no level helps): it ends there, back at the shallowest tied
 * level, after about 9 s at L1-L3 and with no compile stall. A
 * device that only L4's cuts would help therefore stays put; Settings >
 * Quality > Low is its way out.
 *
 * Very slow devices (C44). A frame over HITCH (0.25 s, under 4 fps) never
 * enters those windows: one such frame is a hitch (a GC pause, a shader
 * compile, a tab switch). But a device that is that slow on every frame
 * (an old tablet, a school Chromebook, a software renderer) used to get no
 * samples at all and stayed on L0 for good. So a second, plainer check
 * watches every visible frame: when most frames of a ~2 s window
 * (SLOW_WINDOW, at least SLOW_MIN_FRAMES of them) are over HITCH, that is
 * a slideshow, not a hitch, and the governor goes straight to the bottom
 * level. A hidden tab and gaps over PAUSE never count.
 *
 * Each device remembers its level (GFX_MEMORY_KEY, keyed by the WebGL
 * renderer string and a screen-size bucket; see deviceKey and the memory
 * section below): the next session starts there instead of at L0, and
 * tries one level up at most once per session (stepping back if that is
 * slow). A brand-new device starts from firstGuessLevel (software
 * renderers at L4, a short table of low-end GPU families at L3). The URL
 * pin and the Settings pin always win over memory and guesses.
 */

export interface QualityLevel {
  /** Upper bound on the device pixel ratio we render at. */
  dprCap: number;
  /**
   * Device pixels a frame may cost: a big canvas renders below its device
   * ratio to stay under it (see renderDpr in scene/post.ts).
   */
  pixelBudget: number;
  /** ...but never below this many device px per CSS px (the budget's floor). */
  minScale: number;
  /** Bloom resolution as a share of the canvas (1 full, 0.5 half, 0 off). */
  bloom: number;
  /** Sun shadow-map size in texels; 0 = no shadow map (contact/blob shadows only). */
  shadowSize: number;
  fxaa: boolean;
  /** Multiplier for particle counts (read through particleScale()). */
  particles: number;
  /** Ink outlines on characters (read through outlinesEnabled()). */
  outlines: boolean;
  /** The cool back-rim light that separates troops from the ground. */
  rimLight: boolean;
  /**
   * Troops cast real shadows into the sun's map (re-rendered every frame);
   * otherwise they keep their sun-offset blob shadows. See troopShadowLevel.
   */
  troopShadows: boolean;
  /**
   * How much of the set is dressed: 'full' adds the outer ring (wide screens)
   * and the long-side props, 'inner' keeps the court ring, stands and crowd,
   * 'min' the same with the cheapest props (the forest falls back to blobs).
   */
  dressing: Dressing;
  /** The crowd bobs and cheers (static from L2 down). */
  crowdAnim: boolean;
  /** Instanced grass tufts on grassy floors (the top three levels). */
  tufts: boolean;
  /** Animation mixer rate for the modelled cast (Hz). */
  mixerHz: 20 | 30 | 60;
}

/** Set dressing tiers (see QualityLevel.dressing). */
export type Dressing = "full" | "inner" | "min";

/**
 * The lowest render scale any level allows (device px per CSS px). The old
 * phone-width column was 52vh wide and the wide-screen board is 0.7425x the
 * height, so at 0.7 the board itself never gets fewer device pixels than it
 * had in that column: big screens can always get as cheap as it was.
 */
export const MIN_RENDER_SCALE = 0.7;

const L0: QualityLevel = {
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
};
// Art bible section 11: L1 halves bloom and keeps a static 1024 map (troops
// fall back to blobs); L2 drops bloom, caps DPR at 1.5, freezes the crowd and
// halves the mixers; L3 sheds pixels, the outer ring and the tufts; L4 drops
// the shadow map, FXAA, rim and ink and runs the mixers at 20 Hz.
const L1: QualityLevel = { ...L0, pixelBudget: 1.7e6, minScale: 0.9, bloom: 0.5, shadowSize: 1024, troopShadows: false };
const L2: QualityLevel = {
  ...L1, dprCap: 1.5, pixelBudget: 1.3e6, minScale: 0.8, bloom: 0, particles: 0.75, crowdAnim: false, mixerHz: 30,
};
const L3: QualityLevel = {
  ...L2, pixelBudget: 1e6, minScale: 0.75, shadowSize: 512, particles: 0.5, dressing: "inner", tufts: false,
};
const L4: QualityLevel = {
  ...L3,
  dprCap: 1.25,
  pixelBudget: 0.75e6,
  minScale: MIN_RENDER_SCALE,
  shadowSize: 0,
  fxaa: false,
  rimLight: false,
  particles: 0.35,
  outlines: false,
  dressing: "min",
  mixerHz: 20,
};

/** L0 (best) .. L4 (cheapest). */
export const QUALITY_LEVELS: readonly QualityLevel[] = [L0, L1, L2, L3, L4];

/** Trimmed-mean frame time (s) above which we step down: under ~45 fps. */
export const SLOW_FRAME = 1 / 45;
/** Seconds of frames per decision. */
export const WINDOW = 1.5;
/** Seconds to wait after a step (or a new battle) before judging again. */
export const SETTLE = 1.5;
/** Grace period at start-up (shader compiles, texture uploads). */
export const WARMUP = 3;
/** Share of each window's slowest frames left out of its mean (hitches). */
export const TRIM = 0.1;
/** At the bottom of a walk, levels within this share of the fastest count as tied. */
export const TIE = 0.08;
/** A frame slower than this (under 4 fps) is a hitch to the trimmed-mean windows. */
export const HITCH = 0.25;
/** A gap longer than this is a pause (tab switch, dialog, load), never a frame rate. */
export const PAUSE = 3;
/** Seconds of visible frames per sustained-slow check... */
export const SLOW_WINDOW = 2;
/**
 * ...with at least this many frames, and it is slow only when at least this
 * many of them (and most of them) are over HITCH: a few back-to-back hitches
 * (a burst of shader compiles) never make a slow window.
 */
export const SLOW_MIN_FRAMES = 5;

/** 'auto' runs the governor; the others pin a level. */
export type QualityPin = "auto" | "high" | "medium" | "low";

/** The ladder level each pin holds. */
export const PIN_LEVEL: Record<Exclude<QualityPin, "auto">, number> = { high: 0, medium: 2, low: 4 };

export function qualityPinFromUrl(search: string): QualityPin {
  const v = new URLSearchParams(search).get("quality");
  return v === "high" || v === "medium" || v === "low" ? v : "auto";
}

/** The level the renderer draws at right now (the latest governor's). */
let current: QualityLevel = L0;
/** ...its index, and the pin in force there (for Settings' "Auto (now: Low)"). */
let live: { index: number; mode: QualityPin } = { index: 0, mode: "auto" };

/** The level in force (for effects that scale with it). */
export function currentQuality(): QualityLevel {
  return current;
}

/** The live level's index and the pin in force (the latest governor's). */
export function liveQuality(): { index: number; mode: QualityPin } {
  return { ...live };
}

/**
 * The Settings word for a ladder level, for "Auto (now: ...)": L0-L1 look
 * like High (L1 only halves the bloom and the shadow map), L2-L3 like Medium
 * (no bloom), and L4 is exactly the Low pin (no shadow map, rim or ink).
 */
export function levelName(index: number): Exclude<QualityPin, "auto"> {
  if (index >= PIN_LEVEL.low) return "low";
  return index >= PIN_LEVEL.medium ? "medium" : "high";
}

/** Multiplier for particle counts at the current quality level. */
export function particleScale(): number {
  return current.particles;
}

/** Whether characters get ink outlines at the current quality level. */
export function outlinesEnabled(): boolean {
  return current.outlines;
}

/** Mean of `frames` without its slowest `TRIM` share; sorts `frames` in place. */
function trimmedMean(frames: number[]): number {
  frames.sort((a, b) => a - b);
  const keep = Math.max(1, Math.floor(frames.length * (1 - TRIM)));
  let sum = 0;
  for (let i = 0; i < keep; i++) sum += frames[i];
  return sum / keep;
}

/**
 * Where 'auto' starts this session: the device's remembered level, a first
 * guess for a new device, or the top of the ladder (see autoStartFor).
 */
export interface AutoStart {
  level: number;
  /**
   * Some step down has bought frame time on this device (gates the
   * shader-recompiling step into L4, as stepsHelped does within a session).
   */
  helped: boolean;
  /** May try one level up once this session (a level remembered below L0). */
  reprobe: boolean;
  source: "default" | "memory" | "guess";
}

/** A brand-new device with no guess: the top of the ladder, as before C44. */
export const DEFAULT_START: Readonly<AutoStart> = { level: 0, helped: false, reprobe: false, source: "default" };

/** What the governor settled on, for the device memory (see QualityGovernor.configure). */
export interface Settled {
  level: number;
  helped: boolean;
  /** The once-per-session try one level up was too slow (it stepped back). */
  probeFailed: boolean;
}

export class QualityGovernor {
  private levelIdx = 0;
  private pin: QualityPin = "auto";
  /** Frame times of the window being filled, and their sum. */
  private frames: number[] = [];
  private acc = 0;
  private settle = WARMUP;
  /** While walking down: each level's measured frame time on this walk. */
  private walk: Map<number, number> | null = null;
  /** A step down has bought frame time this session (gates the step into L4). */
  private stepsHelped = false;
  private locked = false;
  /** The walk that locked measured the bottom level (so jumping there is no use). */
  private bottomTried = false;
  /** The sustained-slow window: visible time, frames, and frames over HITCH. */
  private slowAcc = 0;
  private slowFrames = 0;
  private slowCount = 0;
  /** Where 'auto' starts (memory or guess), kept up to date as it settles. */
  private autoStart: AutoStart = { ...DEFAULT_START };
  /** The governor has stepped this session (walk or jump): no more re-probe. */
  private stepped = false;
  /** The one re-probe this session has been used (survives Settings changes). */
  private probeUsed = false;
  /** While trying one level up: the level to step back to. */
  private probeFrom: number | null = null;
  private onSettle: ((s: Settled) => void) | null = null;
  /** The level last reported to onSettle this session (null: none yet). */
  private reported: number | null = null;

  /**
   * `urlPin` (from ?quality=) overrides `pref` (the saved Settings choice)
   * for the life of the governor; setPref() changes only the latter.
   */
  constructor(
    private readonly urlPin: QualityPin = "auto",
    pref: QualityPin = "auto",
  ) {
    this.applyPin(urlPin !== "auto" ? urlPin : pref);
  }

  get index(): number {
    return this.levelIdx;
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.levelIdx];
  }

  /** The pin in force ('auto' when the governor is free to step). */
  get mode(): QualityPin {
    return this.pin;
  }

  /** Where 'auto' starts now (for logs and tests). */
  get start(): Readonly<AutoStart> {
    return this.autoStart;
  }

  /**
   * Set where 'auto' starts (the device memory or a first guess) and who
   * hears what it settles on. Under 'auto' the level moves there at once;
   * a pin keeps its level (pins always win).
   */
  configure(start: AutoStart, onSettle: ((s: Settled) => void) | null = null): void {
    const bottom = QUALITY_LEVELS.length - 1;
    const level = Math.max(0, Math.min(bottom, Math.round(start.level) || 0));
    this.autoStart = { ...start, level, reprobe: start.reprobe && level > 0 };
    this.onSettle = onSettle;
    if (this.pin === "auto") this.applyPin("auto");
  }

  /** Apply a new Settings choice live; true when the level changed. */
  setPref(pref: QualityPin): boolean {
    const before = this.levelIdx;
    const next = this.urlPin !== "auto" ? this.urlPin : pref;
    if (next === this.pin) return false;
    this.applyPin(next);
    return this.levelIdx !== before;
  }

  /**
   * A new battle (or screen) is starting: give its start-up hitches a grace
   * period before judging, and start a fresh window. Keeps the level.
   */
  rearm(): void {
    this.settle = Math.max(this.settle, SETTLE);
    this.frames.length = 0;
    this.acc = 0;
    this.clearSlow();
  }

  private applyPin(pin: QualityPin): void {
    this.pin = pin;
    // A fresh start either way: 'auto' starts where this device left off
    // (or at the top of the ladder for a device it knows nothing about).
    this.levelIdx = pin === "auto" ? this.autoStart.level : PIN_LEVEL[pin];
    this.frames.length = 0;
    this.acc = 0;
    this.clearSlow();
    this.settle = WARMUP;
    this.walk = null;
    this.stepsHelped = pin === "auto" && this.autoStart.helped;
    this.locked = false;
    this.bottomTried = false;
    this.stepped = false;
    this.probeFrom = null;
    this.publish();
  }

  private step(to: number): void {
    this.levelIdx = to;
    this.publish();
  }

  private publish(): void {
    current = this.level;
    live = { index: this.levelIdx, mode: this.pin };
  }

  private clearSlow(): void {
    this.slowAcc = 0;
    this.slowFrames = 0;
    this.slowCount = 0;
  }

  /**
   * Feed one frame's wall time in seconds (and whether the page was visible
   * for it); true when the level changed.
   */
  sample(frameSeconds: number, visible = true): boolean {
    if (this.pin !== "auto") return false;
    // A hidden tab and long gaps (tab switches, dialogs) say nothing about speed.
    if (!visible || !(frameSeconds > 0) || frameSeconds > PAUSE) {
      this.clearSlow();
      return false;
    }
    // Start-up grace (shader compiles, texture uploads): every visible frame
    // counts down, the slow ones too, or a very slow device never got past it.
    if (this.settle > 0) {
      this.settle -= frameSeconds;
      return false;
    }
    if (this.slowWindow(frameSeconds)) return this.sustainedSlow();
    // A lone frame over HITCH is a hitch (GC pause, shader compile): it never
    // costs picture in the trimmed-mean windows below.
    if (this.locked || frameSeconds > HITCH) return false;
    this.frames.push(frameSeconds);
    this.acc += frameSeconds;
    if (this.acc < WINDOW) return false;
    const t = trimmedMean(this.frames);
    this.frames.length = 0;
    this.acc = 0;
    return this.judge(t);
  }

  /** Add a frame to the sustained-slow window; true when a full window was mostly slow. */
  private slowWindow(frameSeconds: number): boolean {
    this.slowAcc += frameSeconds;
    this.slowFrames++;
    if (frameSeconds > HITCH) this.slowCount++;
    if (this.slowAcc < SLOW_WINDOW || this.slowFrames < SLOW_MIN_FRAMES) return false;
    const slow = this.slowCount >= SLOW_MIN_FRAMES && this.slowCount * 2 > this.slowFrames;
    this.clearSlow();
    return slow;
  }

  /** Most frames of a visible window were over HITCH: a slideshow, so go to the bottom. */
  private sustainedSlow(): boolean {
    const bottom = QUALITY_LEVELS.length - 1;
    if (this.probeFrom !== null) return this.endProbe(false);
    if (this.levelIdx >= bottom) {
      this.report(bottom, false); // nothing cheaper: this is where it settles
      return false;
    }
    // A walk that already measured the bottom as no faster: not our pixels.
    if (this.locked && this.bottomTried) return false;
    this.walk = null;
    this.locked = false;
    this.stepsHelped = true;
    this.stepped = true;
    this.step(bottom);
    this.settle = SETTLE;
    this.frames.length = 0;
    this.acc = 0;
    this.report(bottom, false);
    return true;
  }

  /** Judge one trimmed-mean window `t` (s) at the current level. */
  private judge(t: number): boolean {
    const bottom = QUALITY_LEVELS.length - 1;
    if (this.probeFrom !== null) return this.endProbe(t <= SLOW_FRAME);

    if (!this.walk) {
      if (t <= SLOW_FRAME) {
        // Fast enough here: remember it, and maybe try one level up.
        this.report(this.levelIdx, false);
        return this.maybeProbe();
      }
      if (this.levelIdx === bottom) {
        this.report(bottom, false);
        return false;
      }
      this.walk = new Map();
    }
    const walk = this.walk;
    const first = walk.size > 0 ? (walk.values().next().value as number) : t;
    walk.set(this.levelIdx, t);
    if (t <= SLOW_FRAME) {
      this.stepsHelped = true;
      this.walk = null; // fast enough: stay here, free to walk on later
      this.report(this.levelIdx, false);
      return false;
    }
    if (t < first * (1 - TIE)) this.stepsHelped = true;
    // One step down (two when far too slow), then let the new level settle.
    // The step into the bottom level recompiles every lit material's shader,
    // so it waits until some step has shown that our pixels are the problem.
    const to = Math.min(bottom, this.levelIdx + (t > 2 * SLOW_FRAME ? 2 : 1));
    if (this.levelIdx < bottom && (to < bottom || this.stepsHelped)) {
      this.step(to);
      this.stepped = true;
      this.settle = SETTLE;
      return true;
    }
    // Slow at the bottom, or flat all the way down to it: not (only) our
    // pixels (frame cap, CPU, thermal). Keep the best-looking level that was
    // as fast, and stop.
    let best = Infinity;
    for (const v of walk.values()) best = Math.min(best, v);
    let pick = bottom;
    for (const [i, v] of walk) if (v <= best * (1 + TIE)) pick = Math.min(pick, i);
    this.bottomTried = walk.has(bottom);
    this.walk = null;
    this.locked = true;
    this.report(pick, false);
    if (pick === this.levelIdx) return false;
    this.step(pick);
    return true;
  }

  /**
   * The once-per-session try one level up: only from the level this session
   * started at (remembered or guessed, never L0), before any step, after a
   * window there measured fast enough.
   */
  private maybeProbe(): boolean {
    const s = this.autoStart;
    if (!s.reprobe || this.probeUsed || this.stepped || this.levelIdx === 0 || this.levelIdx !== s.level) return false;
    this.probeUsed = true;
    this.probeFrom = this.levelIdx;
    this.step(this.levelIdx - 1);
    this.settle = SETTLE;
    return true;
  }

  /** The try one level up is judged: keep it when fast enough, else step back. */
  private endProbe(ok: boolean): boolean {
    const from = this.probeFrom as number;
    this.probeFrom = null;
    if (ok) {
      this.report(this.levelIdx, false);
      return false;
    }
    this.step(from);
    this.settle = SETTLE;
    this.frames.length = 0;
    this.acc = 0;
    this.clearSlow();
    this.report(from, true);
    return true;
  }

  /** Tell the device memory where 'auto' settled (once per level per session). */
  private report(level: number, probeFailed: boolean): void {
    this.autoStart = { ...this.autoStart, level, helped: this.stepsHelped || this.autoStart.helped };
    if (!probeFailed && this.reported === level) return;
    this.reported = level;
    this.onSettle?.({ level, helped: this.autoStart.helped, probeFailed });
  }
}

// ---- Device memory and first guesses (C44) ---------------------------------

/** localStorage key: each device's settled level (see GfxEntry). */
export const GFX_MEMORY_KEY = "cr-clone-gfx-memory";
/** localStorage key: the one-time "Graphics set to Low" note was shown. */
export const GFX_NOTE_KEY = "cr-clone-gfx-note-seen";
/** Devices remembered at most (most recent first): a tablet and a laptop with a monitor or two. */
export const GFX_MEMORY_MAX = 4;
/** After a failed try one level up, the next try waits for a new build or this long. */
export const REPROBE_RETRY_MS = 7 * 24 * 3600 * 1000;
/** A stored value longer than this is not ours: start fresh. */
const GFX_MEMORY_MAX_CHARS = 4096;
const KEY_MAX = 160;
const BUILD_MAX = 64;

/** One device's memory. */
export interface GfxEntry {
  /** deviceKey(): renderer string and screen bucket. */
  key: string;
  level: number;
  helped: boolean;
  /** The build it was last written by (kept across deploys, never a reason to forget). */
  build: string;
  /** When it was last written (ms since 1970). */
  at: number;
  /** The build (and time) whose try one level up was too slow; "" when none. */
  failBuild: string;
  failAt: number;
}

/** The part of Storage the memory uses (a fake in tests). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function cleanText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // Printable ASCII only: renderer strings are plain, and nothing odd reaches a key.
  return s.replace(/\s/g, " ").replace(/[^\x20-\x7e]/g, "").replace(/ +/g, " ").trim().slice(0, max);
}

function finiteAt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Keep the well-formed entries of a stored value (newest first, one per key, at most GFX_MEMORY_MAX). */
export function sanitizeGfxMemory(raw: unknown): GfxEntry[] {
  const devices = (raw as { v?: unknown; devices?: unknown } | null)?.devices;
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1 || !Array.isArray(devices)) return [];
  const out: GfxEntry[] = [];
  for (const d of devices.slice(0, 32) as unknown[]) {
    if (!d || typeof d !== "object") continue;
    const e = d as Record<string, unknown>;
    const key = cleanText(e.key, KEY_MAX);
    const level = e.level;
    if (!key || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level >= QUALITY_LEVELS.length) continue;
    out.push({
      key,
      level,
      helped: e.helped === true,
      build: cleanText(e.build, BUILD_MAX),
      at: finiteAt(e.at),
      failBuild: cleanText(e.failBuild, BUILD_MAX),
      failAt: finiteAt(e.failAt),
    });
  }
  out.sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.key) && seen.add(e.key)).slice(0, GFX_MEMORY_MAX);
}

/** The stored memory, sanitised; [] when absent, unreadable or not ours. Never throws. */
export function readGfxMemory(store: StorageLike | null): GfxEntry[] {
  try {
    const s = store?.getItem(GFX_MEMORY_KEY);
    if (!s || s.length > GFX_MEMORY_MAX_CHARS) return [];
    return sanitizeGfxMemory(JSON.parse(s));
  } catch {
    return [];
  }
}

/** Store the memory (sanitised and bounded). Never throws: a full or blocked storage just forgets. */
export function writeGfxMemory(store: StorageLike | null, entries: readonly GfxEntry[]): void {
  try {
    store?.setItem(GFX_MEMORY_KEY, JSON.stringify({ v: 1, devices: sanitizeGfxMemory({ v: 1, devices: entries }) }));
  } catch {
    // private mode, quota: the next session simply starts from its guess
  }
}

/** The memory after device `key` settled (`s`) under `build` at `now` (pure). */
export function recordGfx(entries: readonly GfxEntry[], key: string, s: Settled, build: string, now: number): GfxEntry[] {
  const k = cleanText(key, KEY_MAX);
  const old = entries.find((e) => e.key === k);
  const next: GfxEntry = {
    key: k,
    level: Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.round(s.level) || 0)),
    helped: s.helped,
    build: cleanText(build, BUILD_MAX),
    at: now,
    failBuild: s.probeFailed ? cleanText(build, BUILD_MAX) : (old?.failBuild ?? ""),
    failAt: s.probeFailed ? now : (old?.failAt ?? 0),
  };
  return [next, ...entries.filter((e) => e.key !== k)].slice(0, GFX_MEMORY_MAX);
}

/**
 * The memory key for a device: its WebGL renderer string (cleaned, "unknown"
 * when the browser hides it) and a screen-size bucket (the long and short
 * side to the nearest 100 CSS px, and the pixel ratio to the nearest half),
 * so a laptop on a big monitor keeps a level of its own.
 */
export function deviceKey(renderer: string, screenW: number, screenH: number, dpr: number): string {
  const r = cleanText(renderer, 120) || "unknown";
  const w = Number.isFinite(screenW) && screenW > 0 ? screenW : 0;
  const h = Number.isFinite(screenH) && screenH > 0 ? screenH : 0;
  const long = Math.round(Math.max(w, h) / 100) * 100;
  const short = Math.round(Math.min(w, h) / 100) * 100;
  const ratio = Math.min(4, Math.max(0.5, Math.round((Number.isFinite(dpr) && dpr > 0 ? dpr : 1) * 2) / 2));
  return `${r}|${long}x${short}@${ratio}`;
}

/** Renderers that draw on the CPU: every level is slow there, so start at the bottom. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;

/**
 * Known low-end GPU families, started at L3 on a brand-new device (one step
 * above Low: the picture keeps its shadows, rim and ink, and the governor
 * still walks from there). Kept short on purpose: only families common in
 * cheap tablets and school laptops. Everything else starts at L0.
 */
export const LOW_END_GPUS: readonly { family: string; match: RegExp }[] = [
  { family: "ARM Mali-400/450/470 and Mali-T6xx/T7xx (older budget tablets)", match: /\bmali-(4\d\d|t[67]\d\d)\b/i },
  { family: "ARM Mali-G31/G51/G52 (budget tablets and phones)", match: /\bmali-g(31|51|52)\b/i },
  { family: "Qualcomm Adreno 3xx/4xx/50x and 610 (budget Snapdragon)", match: /\badreno\b[^0-9]*(3\d\d|4\d\d|50\d|610)\b/i },
  { family: "PowerVR SGX and Rogue GE8xxx (budget tablets)", match: /\bpowervr\b.*\b(sgx|ge8\d{3})\b/i },
  {
    family: "Intel HD 2000-4000, HD 400/405/500/505 and UHD 600/605 (old laptops, school Chromebooks)",
    match: /\bintel\b.*\bu?hd graphics (2000|2500|3000|4000|400|405|500|505|600|605)\b/i,
  },
  { family: "Vivante and Broadcom VideoCore/V3D (small boards, cheap tablets)", match: /\bvivante\b|\bvideocore\b|\bv3d\b/i },
];

/** The level a brand-new device starts at, from its renderer string. */
export function firstGuessLevel(renderer: string): number {
  if (SOFTWARE_RENDERER.test(renderer)) return QUALITY_LEVELS.length - 1;
  if (LOW_END_GPUS.some((g) => g.match.test(renderer))) return 3;
  return 0;
}

/**
 * Where 'auto' starts: the remembered level when this device has one (with
 * a try one level up, unless that failed under this same build within
 * REPROBE_RETRY_MS), else the first guess (`guess`), else L0.
 */
export function autoStartFor(entry: GfxEntry | undefined, guess: number, build: string, now: number): AutoStart {
  if (entry) {
    const failedHere = entry.failBuild !== "" && entry.failBuild === cleanText(build, BUILD_MAX) && now - entry.failAt < REPROBE_RETRY_MS;
    return { level: entry.level, helped: entry.helped, reprobe: entry.level > 0 && !failedHere, source: "memory" };
  }
  if (guess > 0) return { level: guess, helped: true, reprobe: true, source: "guess" };
  return { ...DEFAULT_START };
}
