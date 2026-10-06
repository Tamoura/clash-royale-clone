/**
 * Idle rendering: the 3D scene only draws what the player can see.
 * - An opaque screen (Collection, Chests, deck editor...) covers the arena
 *   completely, so nothing renders behind it.
 * - The home diorama is a small framed window behind the menus: it renders
 *   every other frame at a capped resolution without bloom. The time of each
 *   skipped frame carries into the next drawn one, so its motion (camera
 *   sway, river, crowd, birds) keeps wall-clock speed.
 * - A hidden tab holds the solo sim, so a match never runs on unseen.
 * Driven by the 'screen' hook; registered once from main.ts.
 */
import { on, registerSimHold, setRenderGate, type Hooks } from "./hooks";
import type { Battle3D } from "../render3d/scene3d";
import { setDioramaQuality } from "../render3d/scene/post";

type SceneMode = Hooks["screen"]["sceneMode"];

/**
 * Longest step one drawn frame may take: a drawn diorama frame plus the
 * skipped one before it, each already clamped to 0.25 s by main.ts.
 */
export const MAX_DRAW_DT = 0.5;

/**
 * Whether to draw this frame for the current screen mode. `tick` counts
 * frames; the diorama draws on every other one.
 */
export function renderThisFrame(mode: SceneMode, tick: number): boolean {
  if (mode === "none") return false;
  if (mode === "diorama") return tick % 2 === 0;
  return true;
}

/**
 * Paces scene draws for the current screen mode. step() takes every
 * frame's presentation dt and returns the dt to draw with, or null to skip
 * the frame; skipped time is summed into the next drawn frame.
 */
export class FramePacer {
  private mode: SceneMode = "battle";
  private tick = 0;
  private pending = 0;

  get sceneMode(): SceneMode {
    return this.mode;
  }

  setMode(mode: SceneMode): void {
    this.mode = mode;
    this.tick = 0; // the first frame of any screen always draws
    this.pending = 0; // time spent on another screen is not replayed
  }

  step(dt: number): number | null {
    if (this.mode === "none") {
      this.pending = 0;
      return null;
    }
    this.pending += dt;
    if (!renderThisFrame(this.mode, this.tick++)) return null;
    const drawDt = Math.min(MAX_DRAW_DT, this.pending);
    this.pending = 0;
    return drawDt;
  }
}

export function registerLifecycle(scene: Battle3D): void {
  const pacer = new FramePacer();
  on("screen", (s) => {
    pacer.setMode(s.sceneMode);
    setDioramaQuality(scene, s.sceneMode === "diorama");
  });
  // Opaque screens skip the call outright. Otherwise every frame reaches
  // scene.render, which the pacer wraps so a skipped diorama frame keeps
  // its dt for the next drawn one.
  setRenderGate(() => pacer.sceneMode !== "none");
  const draw = scene.render.bind(scene);
  scene.render = (dt: number): void => {
    const drawDt = pacer.step(dt);
    if (drawDt !== null) draw(drawDt);
  };
  // Solo play only consults sim holds; online lockstep keeps its clock.
  registerSimHold(() => typeof document !== "undefined" && document.hidden);
}
