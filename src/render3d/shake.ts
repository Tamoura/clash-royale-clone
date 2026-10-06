/**
 * Trauma-based camera shake (Squirrel Eiserloh's model): impacts add
 * "trauma" (0..1) which decays linearly, and the screen offset scales with
 * trauma *squared* so small hits barely wobble while big ones really punch.
 * Pure and frame-rate independent — the renderer turns `intensity` into a
 * noisy camera offset. Under reduced motion (Settings or the OS) every kick
 * is scaled to nothing, so the camera never moves.
 */
import { reducedMotion } from "../ui/prefs";

export class ShakeController {
  private trauma = 0;

  /** Kick the camera; trauma stacks but never exceeds 1 (none under reduced motion). */
  add(amount: number): void {
    const scale = reducedMotion() ? 0 : 1;
    this.trauma = Math.min(1, this.trauma + amount * scale);
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
