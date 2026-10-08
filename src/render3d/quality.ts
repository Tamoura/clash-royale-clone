/**
 * Render quality ladder. Five ordered levels trade picture for frame time,
 * cheapest cuts first: bloom resolution and shadow-map size (barely
 * visible), then bloom itself, resolution and particle density, and last
 * the shadow map, FXAA, rim light and outlines.
 *
 * The player's Settings pick the level (prefs.quality): 'high', 'medium'
 * and 'low' pin L0, L2 and L4; 'auto' lets the governor below walk the
 * ladder. A ?quality= URL pin beats the saved setting (screenshots, tests).
 *
 * The governor watches real frame times. Every step down is a probe: if the
 * next measurement isn't clearly faster, the slowness wasn't ours to fix
 * (e.g. iOS Low Power Mode caps the page at 30 fps no matter what we draw),
 * so the step is undone and the governor stops for the session. It never
 * steps back up once settled, so the picture doesn't flicker.
 */

export interface QualityLevel {
  /** Upper bound on the device pixel ratio we render at. */
  dprCap: number;
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

const L0: QualityLevel = {
  dprCap: 2,
  bloom: 1,
  shadowSize: 2048,
  fxaa: true,
  particles: 1,
  outlines: true,
  rimLight: true,
};
const L1: QualityLevel = { ...L0, bloom: 0.5, shadowSize: 1024 };
const L2: QualityLevel = { ...L1, dprCap: 1.75, bloom: 0, particles: 0.75 };
const L3: QualityLevel = { ...L2, dprCap: 1.5, shadowSize: 512, particles: 0.5 };
const L4: QualityLevel = {
  ...L3,
  dprCap: 1.25,
  shadowSize: 0,
  fxaa: false,
  rimLight: false,
  particles: 0.35,
  outlines: false,
};

/** L0 (best) .. L4 (cheapest). */
export const QUALITY_LEVELS: readonly QualityLevel[] = [L0, L1, L2, L3, L4];

/** Average frame time (s) above which we step down: under ~45 fps. */
export const SLOW_FRAME = 1 / 45;
/** Seconds of frames averaged per decision. */
export const WINDOW = 2;
/** Seconds to wait after a step before judging the new level. */
export const SETTLE = 3;
/** Grace period at start-up (shader compiles, texture uploads). */
export const WARMUP = 5;
/** A step must cut the average frame time by at least this share to stay. */
export const MIN_GAIN = 0.12;

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

export class QualityGovernor {
  private levelIdx = 0;
  private pin: QualityPin = "auto";
  private acc = 0;
  private frames = 0;
  private settle = WARMUP;
  /** Average that triggered the last step, awaiting verification. */
  private probeFrom: number | null = null;
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

  private applyPin(pin: QualityPin): void {
    this.pin = pin;
    // A fresh start either way: back to the top of the ladder for 'auto'.
    this.levelIdx = pin === "auto" ? 0 : PIN_LEVEL[pin];
    this.acc = 0;
    this.frames = 0;
    this.settle = WARMUP;
    this.probeFrom = null;
    this.locked = false;
    current = this.level;
  }

  private step(to: number): void {
    this.levelIdx = to;
    current = this.level;
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
    this.acc += frameSeconds;
    this.frames++;
    if (this.acc < WINDOW) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;

    if (this.probeFrom !== null) {
      const helped = avg < this.probeFrom * (1 - MIN_GAIN);
      this.probeFrom = null;
      if (!helped) {
        // Not our bottleneck (frame cap, CPU, thermal): put it back, stop.
        this.step(this.levelIdx - 1);
        this.locked = true;
        return true;
      }
    }
    if (avg > SLOW_FRAME && this.levelIdx < QUALITY_LEVELS.length - 1) {
      this.step(this.levelIdx + 1);
      this.probeFrom = avg;
      this.settle = SETTLE;
      return true;
    }
    return false;
  }
}
