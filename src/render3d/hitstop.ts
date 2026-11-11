/**
 * Render-only hit-stop: freezes the presentation clock briefly on heavy
 * impacts without touching the sim timestep (lockstep-safe). Reduced
 * motion keeps only a short beat of every freeze.
 *
 * Retuned for the Toy Tournament density (more readable hits on screen at
 * once): a freeze is at most MAX_HITSTOP, and after one ends, light punches
 * (under BIG_HITSTOP) rest for REST_AFTER seconds, so a busy brawl reads as
 * a few clean beats instead of a constant stutter. Big beats (a tower
 * falling, a comet) always land.
 */
import { reducedMotion } from "../ui/prefs";

/** Longest freeze any impact may ask for (a king tower falling). */
export const MAX_HITSTOP = 0.25;
/** Cap per freeze under reduced motion. */
export const REDUCED_HITSTOP = 0.05;
/** A punch this long or longer always lands, even inside the rest window. */
export const BIG_HITSTOP = 0.1;
/** Seconds after a freeze during which light punches are skipped. */
export const REST_AFTER = 0.2;

export class HitStopController {
  private remaining = 0;
  private rest = 0;

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
   * mid-stop so a tower fall isn't cut short by a lighter hit; a light
   * punch right after a freeze is skipped (see REST_AFTER).
   */
  punch(seconds: number): void {
    const cap = reducedMotion() ? REDUCED_HITSTOP : MAX_HITSTOP;
    const s = Math.max(0, Math.min(cap, seconds));
    if (this.rest > 0 && this.remaining === 0 && seconds < BIG_HITSTOP) return;
    if (s > this.remaining) this.remaining = s;
  }

  /** Drain the freeze clock; call every frame with real wall-clock dt. */
  update(dt: number): void {
    if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) this.rest = REST_AFTER;
    } else {
      this.rest = Math.max(0, this.rest - dt);
    }
  }

  /** Clear immediately (e.g. on battle reset). */
  reset(): void {
    this.remaining = 0;
    this.rest = 0;
  }
}
