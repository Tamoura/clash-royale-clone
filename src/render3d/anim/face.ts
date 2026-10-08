/**
 * Living faces: blinks on a per-unit seeded schedule, a squint when hit,
 * angry brows and a shouting mouth through the attack windup, and cartoon
 * X-eyes on a knockout. Works on the named meshes addEyes() builds
 * (eye, eyerim, pupil, brow, mouth); rigs without a face are skipped.
 */
import * as THREE from "three";
import { hash01 } from "./hash";

/** Seconds an eye stays shut per blink. */
export const BLINK_TIME = 0.09;
/** Gap between blinks, seconds. */
export const BLINK_MIN_GAP = 2.5;
export const BLINK_MAX_GAP = 5;
/** Eye height while shut. */
export const BLINK_SCALE = 0.1;
/** Seconds of the squint after taking a hit. */
export const SQUINT_TIME = 0.2;

/** Seconds from blink `n` to blink `n + 1` for a unit seeded `seed`. */
export function blinkGap(seed: number, n: number): number {
  return BLINK_MIN_GAP + (BLINK_MAX_GAP - BLINK_MIN_GAP) * hash01(seed, n + 1);
}

/** When a unit's first blink comes: staggered so a squad never blinks as one. */
export function firstBlink(seed: number): number {
  return 0.5 + BLINK_MIN_GAP * hash01(seed, 0x5eed);
}

/** The first `count` blink start times for a seed (pure; for tests and tools). */
export function blinkStarts(seed: number, count: number): number[] {
  const out: number[] = [];
  let at = firstBlink(seed);
  for (let n = 0; n < count; n++) {
    out.push(at);
    at += blinkGap(seed, n);
  }
  return out;
}

/** A unit's running position in its blink schedule (one per view). */
export interface BlinkClock {
  seed: number;
  /** Index of the next (or current) blink. */
  n: number;
  /** Start time of blink `n`. */
  at: number;
}

export function newBlinkClock(seed: number): BlinkClock {
  return { seed, n: 0, at: firstBlink(seed) };
}

/**
 * Whether the eyes are shut at time `t`. Advances the clock past finished
 * blinks; the result for any t matches blinkStarts(seed, ...) exactly.
 */
export function blinkShut(c: BlinkClock, t: number): boolean {
  if (t < c.at - BLINK_MAX_GAP * 2) {
    // The clock rewound (a new battle): restart the schedule.
    c.n = 0;
    c.at = firstBlink(c.seed);
  }
  while (t >= c.at + BLINK_TIME) {
    c.at += blinkGap(c.seed, c.n);
    c.n++;
  }
  return t >= c.at;
}

interface Brow {
  mesh: THREE.Object3D;
  rotZ: number;
  y: number;
  /** -1 left, 1 right (from its x position). */
  side: number;
}

/** The face parts of one rig, found once and cached. */
export interface FaceRig {
  head: THREE.Object3D | null;
  eyes: THREE.Object3D[];
  rims: THREE.Object3D[];
  pupils: THREE.Object3D[];
  brows: Brow[];
  mouths: { mesh: THREE.Object3D; sx: number; sy: number }[];
  /** Two crossed bars per eye, built on the first knockout. */
  xEyes: THREE.Object3D[] | null;
}

const FACES = new WeakMap<THREE.Object3D, FaceRig | null>();

/** The face of a rig group (null when it has no eyes). Cached per group. */
export function faceOf(group: THREE.Object3D): FaceRig | null {
  const hit = FACES.get(group);
  if (hit !== undefined) return hit;
  const face: FaceRig = { head: null, eyes: [], rims: [], pupils: [], brows: [], mouths: [], xEyes: null };
  group.traverse((o) => {
    switch (o.name) {
      case "eye":
        face.eyes.push(o);
        if (!face.head && o.parent && o.parent !== group) face.head = o.parent;
        break;
      case "eyerim":
        face.rims.push(o);
        break;
      case "pupil":
        face.pupils.push(o);
        break;
      case "brow":
        face.brows.push({ mesh: o, rotZ: o.rotation.z, y: o.position.y, side: Math.sign(o.position.x) || 1 });
        break;
      case "mouth":
        face.mouths.push({ mesh: o, sx: o.scale.x, sy: o.scale.y });
        break;
    }
  });
  const out = face.eyes.length ? face : null;
  FACES.set(group, out);
  return out;
}

/** What the face shows this frame. */
export interface FaceState {
  /** Eyes shut for a blink. */
  blink: boolean;
  /** Hit squint 0..1. */
  squint: number;
  /** Attack windup 0..1: brows knit, mouth opens wide. */
  anger: number;
  /** Knocked out: pupils gone, X-eyes shown. */
  ko: boolean;
}

/** Pose the face parts absolutely (no drift across frames). */
export function poseFace(face: FaceRig, st: FaceState): void {
  const open = st.ko ? 1 : st.blink ? BLINK_SCALE : 1 - 0.55 * st.squint;
  for (const e of face.eyes) e.scale.y = open;
  for (const r of face.rims) r.scale.y = st.ko ? 1 : Math.max(0.18, open);
  for (const p of face.pupils) {
    p.visible = !st.ko;
    p.scale.y = open;
  }
  const knit = Math.max(st.anger, st.squint * 0.6);
  for (const b of face.brows) {
    b.mesh.rotation.z = b.rotZ - b.side * 0.4 * knit;
    b.mesh.position.y = b.y - 0.02 * knit;
  }
  for (const m of face.mouths) {
    m.mesh.scale.x = m.sx * (1 + 0.45 * st.anger);
    m.mesh.scale.y = m.sy * (1 + 1.8 * st.anger);
  }
  if (st.ko && !face.xEyes) face.xEyes = buildXEyes(face);
  if (face.xEyes) for (const x of face.xEyes) x.visible = st.ko;
}

let xGeo: THREE.BoxGeometry | null = null;
let xMat: THREE.MeshBasicMaterial | null = null;

/** Two thin crossed bars over each eye; geometry and material are shared. */
function buildXEyes(face: FaceRig): THREE.Object3D[] {
  if (!xGeo) {
    xGeo = new THREE.BoxGeometry(2.3, 0.42, 0.3);
    xGeo.userData.shared = true;
    xMat = new THREE.MeshBasicMaterial({ color: 0x1f2430 });
    xMat.userData.shared = true;
  }
  const out: THREE.Object3D[] = [];
  for (const eye of face.eyes) {
    const mesh = eye as THREE.Mesh;
    // A baked rig folds both eyes into one mesh and lists where they sit.
    const spots = (eye.userData.spots as { x: number; z: number; r: number }[] | undefined) ?? null;
    if (!spots) mesh.geometry.computeBoundingSphere();
    for (const spot of spots ?? [{ x: eye.position.x, z: eye.position.z, r: mesh.geometry.boundingSphere?.radius ?? 0.05 }]) {
      const r = spot.r * (spots ? 1 : eye.scale.x);
      const x = new THREE.Group();
      x.name = "xeyes";
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(xGeo, xMat!);
        bar.rotation.z = a;
        x.add(bar);
      }
      x.scale.setScalar(r);
      x.position.set(spot.x, eye.position.y, spot.z + r * 0.95);
      x.visible = false;
      eye.parent?.add(x);
      out.push(x);
    }
  }
  return out;
}

/** The toon-boosted skin tone toon() turns the builders' SKIN into. */
const SKIN_HEX = ((): number => {
  const c = new THREE.Color(0xf6c9a0);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l);
  return c.getHex();
})();

/**
 * Faces read cleaner without the cloth grain: drop the grain map from
 * skin materials (and from whatever head carries the eyes). Run once when
 * the view is created, before its first draw compiles the shader.
 */
export function dropSkinGrain(group: THREE.Object3D, face: FaceRig | null): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshToonMaterial;
    if (!mat.isMeshToonMaterial || !mat.map) return;
    // Baked rigs choose grain per vertex (see rigBake); their one material is shared.
    if (mat.userData.baked) return;
    if (o === face?.head || mat.color.getHex() === SKIN_HEX) {
      mat.map = null;
      mat.needsUpdate = true;
    }
  });
}
