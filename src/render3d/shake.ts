/**
 * Trauma-based camera shake (Squirrel Eiserloh's model): impacts add
 * "trauma" (0..1) which decays linearly, and the screen offset scales with
 * trauma *squared* so small hits barely wobble while big ones really punch.
 * Pure and frame-rate independent — the renderer turns `intensity` into a
 * noisy camera offset. Under reduced motion (Settings or the OS) every kick
 * is scaled to nothing, so the camera never moves.
 *
 * Retuned for the Toy Tournament density: kicks stack with diminishing
 * returns (a brawl of light hits never builds into a quake), trauma tops
 * out at MAX_TRAUMA, and it drains a little faster (DECAY_PER_SEC).
 */
import { reducedMotion } from "../ui/prefs";

/** The most trauma impacts can build (a king tower falling reaches it). */
export const MAX_TRAUMA = 0.85;
/** Default drain rate (trauma per second). */
export const DECAY_PER_SEC = 1.8;

export class ShakeController {
  private trauma = 0;

  /** Kick the camera; trauma stacks with diminishing returns up to MAX_TRAUMA (none under reduced motion). */
  add(amount: number): void {
    const scale = reducedMotion() ? 0 : 1;
    this.trauma = Math.min(MAX_TRAUMA, this.trauma + amount * scale * (1 - 0.5 * this.trauma));
  }

  /** Drain trauma toward rest at `decayPerSec` units per second. */
  update(dt: number, decayPerSec = DECAY_PER_SEC): void {
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
