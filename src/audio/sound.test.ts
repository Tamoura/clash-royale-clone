import { describe, expect, it } from "vitest";
import { MUSIC_STEP_MS, SoundEngine, deployPitch } from "./sound";

// SoundEngine is safe to construct without an AudioContext (node):
// every sound path no-ops, but the pure state logic still runs.

describe("dynamic audio", () => {
  it("battle music speeds up as the match heats up", () => {
    expect(MUSIC_STEP_MS[1]).toBeLessThan(MUSIC_STEP_MS[0]);
    expect(MUSIC_STEP_MS[2]).toBeLessThan(MUSIC_STEP_MS[1]);
  });

  it("tracks the requested intensity", () => {
    const s = new SoundEngine();
    expect(s.intensity).toBe(0);
    s.setIntensity(2);
    expect(s.intensity).toBe(2);
    s.setIntensity(0);
    expect(s.intensity).toBe(0);
  });

  it("expensive cards land with a deeper thump", () => {
    expect(deployPitch(7)).toBeLessThan(deployPitch(3));
    expect(deployPitch(1)).toBeGreaterThan(deployPitch(5));
  });
});
