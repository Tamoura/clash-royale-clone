/**
 * Render-only hit-stop: freezes the presentation clock briefly on heavy
 * impacts without touching the sim timestep (lockstep-safe). Reduced
 * motion keeps only a short beat of every freeze.
 */
import { reducedMotion } from "../ui/prefs";

/** Longest freeze any impact may ask for (a king tower falling). */
export const MAX_HITSTOP = 0.3;
/** Cap per freeze under reduced motion. */
export const REDUCED_HITSTOP = 0.05;

export class HitStopController {
  private remaining = 0;

  /** True while the presentation clock should hold. */
  get active(): boolean {
    return this.remaining > 0;
  }

  /** Seconds still frozen. */
  get left(): number {
    return this.remaining;
  }

  /**
   * Queue a freeze of `seconds` (clamped). Longer freezes win if already
   * mid-stop so a tower fall isn't cut short by a lighter hit.
   */
  punch(seconds: number): void {
    const cap = reducedMotion() ? REDUCED_HITSTOP : MAX_HITSTOP;
    const s = Math.max(0, Math.min(cap, seconds));
    if (s > this.remaining) this.remaining = s;
  }

  /** Drain the freeze clock; call every frame with real wall-clock dt. */
  update(dt: number): void {
    this.remaining = Math.max(0, this.remaining - dt);
  }

  /** Clear immediately (e.g. on battle reset). */
  reset(): void {
    this.remaining = 0;
  }
}
