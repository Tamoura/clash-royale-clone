import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../game/arena";
import { CAM_HOME, toWorld } from "./common";
import {
  BATTLE_BOX,
  MAX_TOP_FRAC,
  TALL_BOX,
  ZERO_INSETS,
  fitBattleFrustum,
  type ContentBox,
  type Frustum,
  type Insets,
} from "./fit";

/** The frame before fit.ts: frameOrtho's own math with only a top inset, verbatim. */
function legacy(w: number, h: number, topInsetPx: number): Frustum {
  const aspect = w / h;
  const NEED_HALF_W = 9.95;
  const CONTENT_H = 26.8;
  const CONTENT_MID = 0.6;
  const f = Math.min(0.25, topInsetPx / h);
  const halfH = Math.max(NEED_HALF_W / aspect, CONTENT_H / 2 / (1 - f));
  const halfW = halfH * aspect;
  const V = halfH * 2;
  const top = CONTENT_MID + (V * (1 + f)) / 2;
  return { left: -halfW, right: halfW, top, bottom: top - V };
}

const topOnly = (top: number): Insets => ({ ...ZERO_INSETS, top });
/** CSS px per camera-space unit. */
const scaleOf = (w: number, f: Frustum): number => w / (f.right - f.left);

/** Camera-space point → canvas px. */
function toPx(f: Frustum, w: number, h: number, x: number, y: number): { x: number; y: number } {
  return {
    x: ((x - f.left) / (f.right - f.left)) * w,
    y: ((f.top - y) / (f.top - f.bottom)) * h,
  };
}

/** Deterministic PRNG (mulberry32) so the sweep is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fitBattleFrustum", () => {
  it("reproduces the old top-inset frame exactly", () => {
    for (const w of [320, 390, 468, 614, 844, 1440]) {
      for (const h of [400, 653, 683, 914, 1180]) {
        for (const top of [0, 58, 97, 400]) {
          const a = fitBattleFrustum(w, h, topOnly(top));
          const b = legacy(w, h, top);
          expect(a.left).toBeCloseTo(b.left, 9);
          expect(a.right).toBeCloseTo(b.right, 9);
          expect(a.top).toBeCloseTo(b.top, 9);
          expect(a.bottom).toBeCloseTo(b.bottom, 9);
        }
      }
    }
  });

  it("matches the shipped phone frames (golden values)", () => {
    const a = fitBattleFrustum(390, 653, topOnly(97));
    expect(a.left).toBeCloseTo(-9.95, 4);
    expect(a.right).toBeCloseTo(9.95, 4);
    expect(a.top).toBeCloseTo(19.7346, 4);
    expect(a.bottom).toBeCloseTo(-13.5851, 4);
    const b = fitBattleFrustum(468, 683, topOnly(97));
    expect(b.left).toBeCloseTo(-10.7017, 4);
    expect(b.right).toBeCloseTo(10.7017, 4);
    expect(b.top).toBeCloseTo(18.4362, 4);
    expect(b.bottom).toBeCloseTo(-12.8, 4);
  });

  it("keeps the content box inside the free rectangle, touching it", () => {
    const r = rng(0xc0ffee);
    for (let i = 0; i < 500; i++) {
      const w = 200 + r() * 2400;
      const h = 200 + r() * 1400;
      const left = r() < 0.5 ? 0 : r() * w * 0.4;
      const right = r() < 0.5 ? left : r() * w * 0.4;
      const ins: Insets = { left, right, top: r() * h * 0.4, bottom: r() * h * 0.4 };
      const box: ContentBox = r() < 0.5 ? BATTLE_BOX : TALL_BOX;
      const f = fitBattleFrustum(w, h, ins, box);
      const top = Math.min(ins.top, MAX_TOP_FRAC * h);
      const free = { x0: ins.left, x1: w - ins.right, y0: top, y1: h - ins.bottom };
      const a = toPx(f, w, h, -box.halfW, box.mid + box.height / 2);
      const b = toPx(f, w, h, box.halfW, box.mid - box.height / 2);
      const eps = 1e-6;
      expect(a.x).toBeGreaterThanOrEqual(free.x0 - eps);
      expect(b.x).toBeLessThanOrEqual(free.x1 + eps);
      expect(a.y).toBeGreaterThanOrEqual(free.y0 - eps);
      expect(b.y).toBeLessThanOrEqual(free.y1 + eps);
      // As large as it goes: it spans the free rect on one axis.
      const fillsW = Math.abs(b.x - a.x - (free.x1 - free.x0)) < 1e-6;
      const fillsH = Math.abs(b.y - a.y - (free.y1 - free.y0)) < 1e-6;
      expect(fillsW || fillsH).toBe(true);
      // The frustum keeps the canvas aspect: nothing stretches.
      expect((f.right - f.left) / (f.top - f.bottom)).toBeCloseTo(w / h, 9);
    }
  });

  it("is symmetric when the side insets are", () => {
    for (const side of [0, 186, 320]) {
      const f = fitBattleFrustum(1440, 900, { top: 30, bottom: 10, left: side, right: side });
      expect(f.left).toBeCloseTo(-f.right, 12);
    }
  });

  it("makes portrait troops bigger: the slim box under the measured band", () => {
    const before = scaleOf(390, legacy(390, 653, 97));
    const after = scaleOf(390, fitBattleFrustum(390, 653, topOnly(83), TALL_BOX));
    expect(after / before).toBeGreaterThanOrEqual(1.07);
  });

  it("makes desktop troops far bigger with side panels", () => {
    // Today's desktop column (468 wide) against the full 1440x900 screen.
    const before = scaleOf(468, legacy(468, 900 - 217, 97));
    const after = scaleOf(1440, fitBattleFrustum(1440, 900, { top: 0, bottom: 0, left: 320, right: 320 }));
    expect(after / before).toBeGreaterThan(1.4);
  });
});

describe("pointer picks at the new framing", () => {
  const TILES: [number, number][] = [
    [0.5, 31.5],
    [9, 24],
    [17.5, 0.5],
    [2, 30],
  ];
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** The battle camera for a canvas of w x h with frame `f`, seen from `camZ`. */
  function camera(f: Frustum, camZ: number): THREE.OrthographicCamera {
    const cam = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, -50, 120);
    cam.position.set(CAM_HOME.x, CAM_HOME.y, camZ);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }

  const CASES: [string, number, number, Insets, ContentBox][] = [
    ["wide 1440x900", 1440, 900, { top: 0, bottom: 0, left: 320, right: 320 }, BATTLE_BOX],
    ["tall 390x653", 390, 653, topOnly(83), TALL_BOX],
  ];
  for (const [name, w, h, ins, box] of CASES) {
    for (const [view, camZ] of [
      ["host", CAM_HOME.z],
      ["guest", -CAM_HOME.z],
    ] as const) {
      it(`${name} (${view}): the tile under the finger comes back, inside the free rect`, () => {
        const f = fitBattleFrustum(w, h, ins, box);
        const cam = camera(f, camZ);
        const ray = new THREE.Raycaster();
        const hit = new THREE.Vector3();
        // (The guest's camera sits at -z, so the same tiles land at the other end.)
        const corners: [number, number][] = [
          [0, 0],
          [ARENA_WIDTH, 0],
          [0, ARENA_HEIGHT],
          [ARENA_WIDTH, ARENA_HEIGHT],
        ];
        for (const [ax, ay] of [...TILES, ...corners]) {
          const wp = toWorld(ax, ay);
          const ndc = new THREE.Vector3(wp.x, 0, wp.z).project(cam);
          // The field sits inside what the HUD leaves free (CSS px).
          const px = ((ndc.x + 1) / 2) * w;
          const py = ((1 - ndc.y) / 2) * h;
          expect(px).toBeGreaterThanOrEqual(ins.left - 1e-6);
          expect(px).toBeLessThanOrEqual(w - ins.right + 1e-6);
          expect(py).toBeGreaterThanOrEqual(Math.min(ins.top, MAX_TOP_FRAC * h) - 1e-6);
          expect(py).toBeLessThanOrEqual(h - ins.bottom + 1e-6);
          // And a pick there lands on the same tile (scene3d.pick's math).
          ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
          expect(ray.ray.intersectPlane(ground, hit)).not.toBeNull();
          expect(hit.x + ARENA_WIDTH / 2).toBeCloseTo(ax, 6);
          expect(hit.z + ARENA_HEIGHT / 2).toBeCloseTo(ay, 6);
        }
      });
    }
  }
});
