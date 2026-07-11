/**
 * Render-only hit-stop: freezes the presentation clock briefly on heavy
 * impacts without touching the sim timestep (lockstep-safe).
 */
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
    const s = Math.max(0, Math.min(0.12, seconds));
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
