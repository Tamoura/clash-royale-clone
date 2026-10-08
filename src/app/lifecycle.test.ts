import { describe, expect, it } from "vitest";
import { FramePacer, MAX_DRAW_DT, renderThisFrame } from "./lifecycle";

/** Feeds `frames` frames of `dt` and returns the total dt drawn and the draw count. */
function run(pacer: FramePacer, frames: number, dt: number): { time: number; draws: number } {
  let time = 0;
  let draws = 0;
  for (let i = 0; i < frames; i++) {
    const d = pacer.step(dt);
    if (d !== null) {
      time += d;
      draws++;
    }
  }
  return { time, draws };
}

describe("idle rendering", () => {
  it("never draws behind an opaque screen", () => {
    for (let t = 0; t < 10; t++) expect(renderThisFrame("none", t)).toBe(false);
  });

  it("draws every frame in battle", () => {
    for (let t = 0; t < 10; t++) expect(renderThisFrame("battle", t)).toBe(true);
  });

  it("draws the home diorama on every other frame, starting with the first", () => {
    const drawn = Array.from({ length: 8 }, (_, t) => renderThisFrame("diorama", t));
    expect(drawn).toEqual([true, false, true, false, true, false, true, false]);
  });
});

describe("frame pacing", () => {
  it("advances the diorama as much time per wall-second as battle mode", () => {
    const battle = new FramePacer();
    const diorama = new FramePacer();
    diorama.setMode("diorama");
    // One wall-second at 60 Hz (plus one frame, so the last skipped frame lands).
    const b = run(battle, 61, 1 / 60);
    const d = run(diorama, 61, 1 / 60);
    expect(b.draws).toBe(61);
    expect(d.draws).toBe(31);
    expect(d.time).toBeCloseTo(b.time, 9);
  });

  it("keeps wall-clock speed on a slow device too", () => {
    const battle = new FramePacer();
    const diorama = new FramePacer();
    diorama.setMode("diorama");
    // Software GL: about 6 fps, frames already clamped by main.ts.
    const b = run(battle, 41, 0.2);
    const d = run(diorama, 41, 0.2);
    expect(d.time).toBeCloseTo(b.time, 9);
  });

  it("carries a skipped frame's dt into the next drawn one", () => {
    const p = new FramePacer();
    p.setMode("diorama");
    expect(p.step(0.016)).toBeCloseTo(0.016);
    expect(p.step(0.02)).toBeNull();
    expect(p.step(0.017)).toBeCloseTo(0.037);
  });

  it("caps a drawn step and drops time spent behind other screens", () => {
    const p = new FramePacer();
    p.setMode("diorama");
    p.step(0.25);
    p.step(0.3); // skipped
    expect(p.step(0.3)).toBe(MAX_DRAW_DT);
    p.step(0.1); // skipped, then the screen changes
    p.setMode("none");
    expect(p.step(0.1)).toBeNull();
    p.setMode("diorama");
    expect(p.step(0.016)).toBeCloseTo(0.016);
  });
});
