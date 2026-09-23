/**
 * Adaptive render quality. Watches real frame times and, when a device
 * can't hold its frame rate, steps down resolution and then bloom — the
 * two biggest fill-rate costs — so mid-range phones stay smooth instead of
 * stuttering at full retina. It only ever steps down within a session:
 * stepping back up would make the picture flicker between levels.
 */

export interface QualityLevel {
  /** Upper bound on the device pixel ratio we render at. */
  dprCap: number;
  bloom: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { dprCap: 2, bloom: true },
  { dprCap: 1.5, bloom: true },
  { dprCap: 1.25, bloom: false },
  { dprCap: 1, bloom: false },
];

/** Average frame time (s) above which we step down: under ~45 fps. */
export const SLOW_FRAME = 1 / 45;
/** Seconds of frames averaged per decision. */
export const WINDOW = 2;
/** Seconds to wait after a step before judging the new level. */
export const SETTLE = 3;

export type QualityPin = "auto" | "high" | "low";

export function qualityPinFromUrl(search: string): QualityPin {
  const v = new URLSearchParams(search).get("quality");
  return v === "high" || v === "low" ? v : "auto";
}

export class QualityGovernor {
  private levelIdx: number;
  private acc = 0;
  private frames = 0;
  private settle = 0;

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
    if (this.pin !== "auto") return false;
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
    if (avg > SLOW_FRAME && this.levelIdx < QUALITY_LEVELS.length - 1) {
      this.levelIdx++;
      this.settle = SETTLE;
      return true;
    }
    return false;
  }
}
