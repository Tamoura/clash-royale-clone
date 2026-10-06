/**
 * Idle rendering: the 3D scene only draws what the player can see.
 * - An opaque screen (Collection, Chests, deck editor...) covers the arena
 *   completely, so nothing renders behind it.
 * - The home diorama is a small framed window behind the menus: it renders
 *   every other frame at a capped resolution without bloom.
 * - A hidden tab holds the solo sim, so a match never runs on unseen.
 * Driven by the 'screen' hook; registered once from main.ts.
 */
import { on, registerSimHold, setRenderGate, type Hooks } from "./hooks";
import type { Battle3D } from "../render3d/scene3d";
import { setDioramaQuality } from "../render3d/scene/post";

type SceneMode = Hooks["screen"]["sceneMode"];

/**
 * Whether to draw this frame for the current screen mode. `tick` counts
 * frames; the diorama draws on every other one.
 */
export function renderThisFrame(mode: SceneMode, tick: number): boolean {
  if (mode === "none") return false;
  if (mode === "diorama") return tick % 2 === 0;
  return true;
}

export function registerLifecycle(scene: Battle3D): void {
  let mode: SceneMode = "battle";
  let tick = 0;
  on("screen", (s) => {
    mode = s.sceneMode;
    tick = 0; // the first frame of any screen always draws
    setDioramaQuality(scene, mode === "diorama");
  });
  setRenderGate(() => renderThisFrame(mode, tick++));
  // Solo play only consults sim holds; online lockstep keeps its clock.
  registerSimHold(() => typeof document !== "undefined" && document.hidden);
}
