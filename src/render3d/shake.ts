/**
 * Trauma-based camera shake (Squirrel Eiserloh's model): impacts add
 * "trauma" (0..1) which decays linearly, and the screen offset scales with
 * trauma *squared* so small hits barely wobble while big ones really punch.
 * Pure and frame-rate independent — the renderer turns `intensity` into a
 * noisy camera offset.
 */
export class ShakeController {
  private trauma = 0;

  /** Kick the camera; trauma stacks but never exceeds 1. */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Drain trauma toward rest at `decayPerSec` units per second. */
  update(dt: number, decayPerSec = 1.5): void {
    this.trauma = Math.max(0, this.trauma - decayPerSec * dt);
  }

  /** Shake strength (0..1), quadratic in trauma for a snappier falloff. */
  get intensity(): number {
    return this.trauma * this.trauma;
  }

  get active(): boolean {
    return this.trauma > 0;
  }
}
