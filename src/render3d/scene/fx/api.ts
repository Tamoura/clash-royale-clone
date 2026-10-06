/**
 * The FX contract the rest of the scene talks to. Callers name a preset
 * ("dust", "smoke", ...) at an arena point and leave the look to the
 * implementation Battle3D carries in `fx` (VfxPool, see pool.ts); ground
 * decals (scorch, frost...) go through the same seam.
 *
 * Preset names other packages rely on: 'dust', 'smoke', 'smoke-column',
 * 'chips', 'ring'; decal kind 'crater'. presets.ts lists the rest.
 */
import type { Side } from "../../../game/arena";

/** Ground mark kinds: the public six plus the falling shadow and rune circle. */
export type DecalKindName = "scorch" | "frost" | "crack" | "heal" | "crater" | "ring" | "shadow" | "rune";

export interface FxApi {
  /** One-shot effect `preset` at arena tile (x, y). */
  emit(
    preset: string,
    x: number,
    y: number,
    opts?: { z?: number; color?: number; radius?: number; count?: number; side?: Side },
  ): void;
  /** A ground mark of radius `r` tiles that fades over `life` seconds. */
  decal(kind: DecalKindName, x: number, y: number, r: number, opts?: { color?: number; life?: number }): void;
  /** Advance by the presentation dt (called once per rendered frame). */
  update(dt: number): void;
  /** Drop everything in flight (battle restart). */
  reset(): void;
}
