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
}

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
};
const L1: QualityLevel = { ...L0, pixelBudget: 1.7e6, minScale: 0.9, bloom: 0.5, shadowSize: 1024 };
const L2: QualityLevel = { ...L1, dprCap: 1.75, pixelBudget: 1.3e6, minScale: 0.8, bloom: 0, particles: 0.75 };
const L3: QualityLevel = { ...L2, dprCap: 1.5, pixelBudget: 1e6, minScale: 0.75, shadowSize: 512, particles: 0.5 };
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

/** The level in force (for effects that scale with it). */
export function currentQuality(): QualityLevel {
  return current;
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

export class QualityGovernor {
  private levelIdx = 0;
  private pin: QualityPin = "auto";
  /** Frame times of the window being filled, and their sum. */
  private frames: number[] = [];
  private acc = 0;
  private settle = WARMUP;
  /** While walking down: each level's measured frame time on this walk. */
  private walk: Map<number, number> | null = null;
  private locked = false;

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
  }

  private applyPin(pin: QualityPin): void {
    this.pin = pin;
    // A fresh start either way: back to the top of the ladder for 'auto'.
    this.levelIdx = pin === "auto" ? 0 : PIN_LEVEL[pin];
    this.frames.length = 0;
    this.acc = 0;
    this.settle = WARMUP;
    this.walk = null;
    this.locked = false;
    current = this.level;
  }

  private step(to: number): void {
    this.levelIdx = to;
    current = this.level;
  }

  /** One step down (two when far too slow), then let the new level settle. */
  private stepDown(t: number): void {
    this.step(Math.min(QUALITY_LEVELS.length - 1, this.levelIdx + (t > 2 * SLOW_FRAME ? 2 : 1)));
    this.settle = SETTLE;
  }

  /** Feed one frame's wall time in seconds; true when the level changed. */
  sample(frameSeconds: number): boolean {
    if (this.pin !== "auto" || this.locked) return false;
    // Tab switches and load hitches say nothing about steady-state speed.
    if (!(frameSeconds > 0) || frameSeconds > 0.25) return false;
    if (this.settle > 0) {
      this.settle -= frameSeconds;
      return false;
    }
    this.frames.push(frameSeconds);
    this.acc += frameSeconds;
    if (this.acc < WINDOW) return false;
    const t = trimmedMean(this.frames);
    this.frames.length = 0;
    this.acc = 0;
    const bottom = QUALITY_LEVELS.length - 1;

    if (!this.walk) {
      if (t <= SLOW_FRAME || this.levelIdx === bottom) return false;
      this.walk = new Map([[this.levelIdx, t]]);
      this.stepDown(t);
      return true;
    }
    this.walk.set(this.levelIdx, t);
    if (t <= SLOW_FRAME) {
      this.walk = null; // fast enough: stay here, free to walk on later
      return false;
    }
    if (this.levelIdx < bottom) {
      this.stepDown(t);
      return true;
    }
    // Slow even at the bottom: not (only) our pixels (frame cap, CPU,
    // thermal). Keep the best-looking level that was as fast, and stop.
    let best = Infinity;
    for (const v of this.walk.values()) best = Math.min(best, v);
    let pick = bottom;
    for (const [i, v] of this.walk) if (v <= best * (1 + TIE)) pick = Math.min(pick, i);
    this.walk = null;
    this.locked = true;
    if (pick === this.levelIdx) return false;
    this.step(pick);
    return true;
  }
}
