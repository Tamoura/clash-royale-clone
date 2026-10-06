/**
 * Fog that never touches the board. Distance fog blends the stands and
 * backdrop into the sky, but with the look's own near distance it fell
 * inside the playfield: the far half (the enemy's towers and troops) came
 * out milky next to the crisp near half. fitFog starts the fog just past
 * the deepest corner of the playfield box as seen by the battle camera, so
 * both halves render at full contrast and only scenery beyond fades.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../game/arena";

export interface FogRange {
  near: number;
  far: number;
}

/** Clear air between the last playfield corner and the start of the fog. */
export const FOG_MARGIN = 2;
/** Shortest near-to-far ramp, so the fade into the sky never bands. */
export const MIN_FOG_RAMP = 20;

const CORNER = new THREE.Vector3();
const EYE = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const LOOK_M = new THREE.Matrix4();

/**
 * Fog distances for a camera with `viewMatrix` (world → view). The
 * playfield box spans the whole arena (x ±ARENA_WIDTH/2, z ±ARENA_HEIGHT/2,
 * the toWorld mapping) from the ground up to a king tower's top plus one
 * unit; near sits FOG_MARGIN past its deepest corner and the ramp keeps the
 * look's own length (at least MIN_FOG_RAMP).
 */
export function fitFog(
  viewMatrix: THREE.Matrix4,
  look: { fogNear: number; fogFar: number },
  kingHeight = 6,
): FogRange {
  let deepest = -Infinity;
  for (const x of [-ARENA_WIDTH / 2, ARENA_WIDTH / 2]) {
    for (const z of [-ARENA_HEIGHT / 2, ARENA_HEIGHT / 2]) {
      for (const y of [0, kingHeight + 1]) {
        CORNER.set(x, y, z).applyMatrix4(viewMatrix);
        deepest = Math.max(deepest, -CORNER.z); // view space looks down -z
      }
    }
  }
  const near = deepest + FOG_MARGIN;
  return { near, far: near + Math.max(MIN_FOG_RAMP, look.fogFar - look.fogNear) };
}

/**
 * The view matrix of a camera at `eye` looking at the arena centre — the
 * battle camera's resting pose, without shake or the home-screen sway.
 */
export function viewMatrixAt(x: number, y: number, z: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  EYE.set(x, y, z);
  // Same basis Object3D.lookAt builds for a camera, then inverted.
  LOOK_M.lookAt(EYE, ORIGIN, UP);
  LOOK_M.setPosition(EYE);
  return out.copy(LOOK_M).invert();
}

/** Three's linear fog factor (0 = clear, 1 = sky) at view depth `depth`. */
export function fogFactor(range: FogRange, depth: number): number {
  const t = Math.min(1, Math.max(0, (depth - range.near) / (range.far - range.near)));
  return t * t * (3 - 2 * t); // smoothstep, as in fog_fragment
}
