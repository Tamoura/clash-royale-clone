import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../game/arena";
import { ARABIC_LOOK, ISLAMIC_LOOKS, LOOKS, type ArenaLook } from "./arenaLooks";
import { FOG_MARGIN, MIN_FOG_RAMP, fitFog, fogFactor, viewMatrixAt } from "./fogfit";
import { frameOrtho } from "./scene/camera";
import { CAM_HOME } from "./scene/common";
import type { Battle3D } from "./scene3d";

// The Islamic road's first world is the Arabic edition's base look itself.
const ALL_LOOKS: ArenaLook[] = [
  ...new Set([...Object.values(LOOKS), ...Object.values(ISLAMIC_LOOKS), ARABIC_LOOK]),
];
const ASPECTS: [string, number, number][] = [
  ["phone 390x844", 390, 844],
  ["wide 16:9", 1600, 900],
];
const VIEWS: ["host" | "guest", number][] = [
  ["host", CAM_HOME.z],
  ["guest", -CAM_HOME.z],
];
/** King towers stand at arena y = 2.5 and ARENA_HEIGHT - 2.5, mid-width. */
const KINGS = [2.5, ARENA_HEIGHT - 2.5].map((ay) => ay - ARENA_HEIGHT / 2);

/** The battle camera as Battle3D frames it for a container of w x h. */
function battleCamera(w: number, h: number, camZ: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120);
  camera.position.set(CAM_HOME.x, CAM_HOME.y, camZ);
  camera.lookAt(0, 0, 0);
  const stub = { camera, container: { clientWidth: w, clientHeight: h }, topInsetPx: 0, showcase: false };
  frameOrtho(stub as unknown as Battle3D);
  camera.updateMatrixWorld(true);
  return camera;
}

function depthOf(camera: THREE.Camera, x: number, y: number, z: number): number {
  return -new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse).z;
}

describe("fitFog", () => {
  it("covers every arena look in both editions", () => {
    expect(ALL_LOOKS).toHaveLength(22);
  });

  it("matches the battle camera's own view matrix", () => {
    for (const [, z] of VIEWS) {
      const cam = battleCamera(390, 844, z);
      const m = viewMatrixAt(CAM_HOME.x, CAM_HOME.y, z);
      for (let i = 0; i < 16; i++) expect(m.elements[i]).toBeCloseTo(cam.matrixWorldInverse.elements[i], 6);
    }
  });

  for (const look of ALL_LOOKS) {
    for (const [aspectName, w, h] of ASPECTS) {
      for (const [viewName, camZ] of VIEWS) {
        it(`${look.id}: both kings fog-free (${aspectName}, ${viewName})`, () => {
          const cam = battleCamera(w, h, camZ);
          const range = fitFog(cam.matrixWorldInverse, look);
          for (const kz of KINGS) {
            for (const y of [0, 3, 7]) {
              for (const dx of [-2, 0, 2]) {
                expect(fogFactor(range, depthOf(cam, dx, y, kz))).toBe(0);
              }
            }
          }
          // Every playfield corner is clear too, with the margin to spare.
          for (const x of [-ARENA_WIDTH / 2, ARENA_WIDTH / 2]) {
            for (const z of [-ARENA_HEIGHT / 2, ARENA_HEIGHT / 2]) {
              expect(depthOf(cam, x, 0, z)).toBeLessThanOrEqual(range.near - FOG_MARGIN + 1e-6);
            }
          }
          // The ramp keeps the look's length, and scenery far behind the
          // board still fades into the sky.
          expect(range.far - range.near).toBe(Math.max(MIN_FOG_RAMP, look.fogFar - look.fogNear));
          const behind = -Math.sign(camZ) * 60;
          expect(fogFactor(range, depthOf(cam, 0, 0, behind))).toBeGreaterThan(0.5);
        });
      }
    }
  }

  it("gives the host and the flipped guest the same fog", () => {
    const host = fitFog(viewMatrixAt(0, CAM_HOME.y, CAM_HOME.z), LOOKS.neon);
    const guest = fitFog(viewMatrixAt(0, CAM_HOME.y, -CAM_HOME.z), LOOKS.neon);
    expect(guest.near).toBeCloseTo(host.near, 6);
    expect(guest.far).toBeCloseTo(host.far, 6);
  });

  it("used to wash the far king out with the look's own distances", () => {
    // The regression this module fixes: e.g. the swamp look fogged the enemy
    // king by well over half.
    const cam = battleCamera(390, 844, CAM_HOME.z);
    const old = { near: LOOKS.swamp.fogNear, far: LOOKS.swamp.fogFar };
    expect(fogFactor(old, depthOf(cam, 0, 0, KINGS[0]))).toBeGreaterThan(0.5);
  });
});
