/**
 * The FX contract the rest of the scene talks to. Callers name a preset
 * ("dust", "smoke", ...) at an arena point and leave the look to whichever
 * implementation Battle3D carries in `fx`; ground decals (scorch, frost...)
 * go through the same seam. LegacyFx keeps today's look by mapping presets
 * onto the existing puff() and ignoring decals.
 */
import type { Side } from "../../../game/arena";
import type { Battle3D } from "../../scene3d";
import { puff } from "./effects";

export interface FxApi {
  /** One-shot effect `preset` at arena tile (x, y). */
  emit(
    preset: string,
    x: number,
    y: number,
    opts?: { z?: number; color?: number; radius?: number; count?: number; side?: Side },
  ): void;
  /** A ground mark of radius `r` tiles that fades over `life` seconds. */
  decal(
    kind: "scorch" | "frost" | "crack" | "heal" | "crater" | "ring",
    x: number,
    y: number,
    r: number,
    opts?: { color?: number; life?: number },
  ): void;
  /** Advance by the presentation dt (called once per rendered frame). */
  update(dt: number): void;
  /** Drop everything in flight (battle restart). */
  reset(): void;
}

/** Puff colour and size per legacy preset; `opts` may override either. */
const PUFF_PRESETS: Record<string, { color: number; size: number }> = {
  dust: { color: 0xcfc4b2, size: 0.16 }, // footsteps
  smoke: { color: 0x776f64, size: 0.5 }, // smouldering towers
  chips: { color: 0x8b7c69, size: 1.1 }, // masonry bursts
};

/**
 * Today's effects behind the FxApi: presets become puffs (timed effects the
 * Battle3D render loop already ages and clears), decals are not drawn.
 */
export class LegacyFx implements FxApi {
  constructor(private readonly b: Battle3D) {}

  emit(
    preset: string,
    x: number,
    y: number,
    opts?: { z?: number; color?: number; radius?: number; count?: number; side?: Side },
  ): void {
    const p = PUFF_PRESETS[preset];
    if (!p) return;
    puff(this.b, x, y, opts?.color ?? p.color, opts?.radius ?? p.size, opts?.z ?? 0);
  }

  decal(): void {}

  update(): void {}

  reset(): void {}
}
