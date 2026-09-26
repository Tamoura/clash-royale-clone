/**
 * Adaptive render quality. Watches real frame times and, when a device
 * can't hold its frame rate, first drops bloom (no visible softening) and
 * then a little resolution, so mid-range phones stay smooth.
 *
 * Every step is a probe: if the next measurement isn't clearly faster, the
 * slowness wasn't ours to fix (e.g. iOS Low Power Mode caps the page at
 * 30 fps no matter what we draw), so the step is undone and the governor
 * stops for the session. Resolution never drops below 1.5x, and it never
 * steps back up once settled, so the picture doesn't flicker.
 */

export interface QualityLevel {
  /** Upper bound on the device pixel ratio we render at. */
  dprCap: number;
  bloom: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { dprCap: 2, bloom: true },
  { dprCap: 2, bloom: false },
  { dprCap: 1.5, bloom: false },
];

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

export type QualityPin = "auto" | "high" | "low";

export function qualityPinFromUrl(search: string): QualityPin {
  const v = new URLSearchParams(search).get("quality");
  return v === "high" || v === "low" ? v : "auto";
}

export class QualityGovernor {
  private levelIdx: number;
  private acc = 0;
  private frames = 0;
  private settle = WARMUP;
  /** Average that triggered the last step, awaiting verification. */
  private probeFrom: number | null = null;
  private locked = false;

  constructor(private readonly pin: QualityPin = "auto") {
    this.levelIdx = pin === "low" ? QUALITY_LEVELS.length - 1 : 0;
  }

  get index(): number {
    return this.levelIdx;
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.levelIdx];
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
        this.levelIdx--;
        this.locked = true;
        return true;
      }
    }
    if (avg > SLOW_FRAME && this.levelIdx < QUALITY_LEVELS.length - 1) {
      this.levelIdx++;
      this.probeFrom = avg;
      this.settle = SETTLE;
      return true;
    }
    return false;
  }
}
