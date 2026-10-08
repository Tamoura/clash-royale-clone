/**
 * Troop death motions (render-only): the knockout topple, the skeleton /
 * robot shatter, and the flyer tumble. Bodies leave by scaling to zero,
 * never by turning materials transparent (no sorting pops, no shader
 * variants). Shatter pieces stay children of the view's root, so the
 * scene's normal disposal of the root frees them too.
 */
import * as THREE from "three";
import type { DeathMotion } from "../deathfx";
import { particleScale } from "../quality";
import type { FxApi } from "../scene/fx/api";
import { poseFace, type FaceRig } from "./face";
import { hash01, hashSigned } from "./hash";

/** Knockout timeline (seconds): fall flat, one bounce, lie still, sink. */
export const KO_FALL = 0.18;
export const KO_BOUNCE = 0.16;
export const KO_HOLD = 0.3;
export const KO_SINK = 0.3;
export const KO_TIME = KO_FALL + KO_BOUNCE + KO_HOLD + KO_SINK;
/** Shatter: pieces fly under gravity, then shrink away. */
export const SHATTER_FLY = 0.6;
export const SHATTER_SHRINK = 0.2;
export const SHATTER_TIME = SHATTER_FLY + SHATTER_SHRINK;
/** Most shatter pieces in flight at once (scaled by the quality level). */
export const SHATTER_BUDGET = 300;
/** Render gravity for falling pieces and flyers (tiles/s²). */
export const GRAVITY = 18;
/** Flyer tumble: seconds lying on the ground before shrinking away. */
export const TUMBLE_REST = 0.18;
export const TUMBLE_SHRINK = 0.22;
/** Height a downed flyer's body centre rests at. */
const TUMBLE_LAND = 0.2;
/** Seconds the team ring / contact shadow take to fade under a corpse. */
const MARK_FADE = 0.2;

/** One body breaks into at most this many chunks (its biggest baked meshes). */
export const SHATTER_CHUNKS = 8;

/** How many shatter pieces may fly right now at the current quality. */
export function shatterCap(): number {
  return Math.floor(SHATTER_BUDGET * particleScale());
}

/** One flying piece of a shattered body (root-local units). */
export interface ShatterPart {
  obj: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  /** Spin, rad/s per axis. */
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

/** A dying troop's motion state, kept on its DyingView. */
export interface DeathAnim {
  motion: DeathMotion;
  duration: number;
  /** Topple direction on the ground, world space, unit length. */
  dirX: number;
  dirZ: number;
  /** The same direction in the root's own (yawed) frame. */
  localX: number;
  localZ: number;
  /** Root yaw and scale when death began. */
  yaw: number;
  scale: number;
  /** Height a flyer falls from (its hover). */
  fall: number;
  /** Rough body height, for where the sink puff goes. */
  height: number;
  face: FaceRig | null;
  /** The animated body (rig group, or the root for glTF models). */
  body: THREE.Object3D;
  parts: ShatterPart[] | null;
  /** Ground marks (team ring, contact shadow) and their starting scales. */
  marks: { obj: THREE.Object3D; s: number }[];
  /** Where the body went down, arena tiles (for FX). */
  ax: number;
  ay: number;
  fx: FxApi;
  /** One-shot cues already fired. */
  thud: boolean;
  puffed: boolean;
}

export function deathDuration(motion: DeathMotion, fall: number): number {
  if (motion === "shatter") return SHATTER_TIME;
  if (motion === "tumble") return tumbleTime(fall - TUMBLE_LAND) + TUMBLE_REST + TUMBLE_SHRINK;
  return KO_TIME;
}

/** Seconds a flyer takes to hit the ground from `fall` tiles up. */
export function tumbleTime(fall: number): number {
  return Math.sqrt((2 * Math.max(0.05, fall)) / GRAVITY);
}

/** The knockout body angle (0 upright .. π/2 flat), bounce lift and sink at `t`. */
export interface KoPose {
  tilt: number;
  lift: number;
  sink: number;
  /** Remaining body scale (1 until the final sink shrinks it). */
  shrink: number;
  /** True from the first ground contact on (X-eyes show). */
  down: boolean;
}

const HALF_PI = Math.PI / 2;

/** Pure knockout pose at `t` seconds after death. Writes into `out`. */
export function koPose(t: number, out: KoPose): KoPose {
  out.lift = 0;
  out.sink = 0;
  out.shrink = 1;
  if (t < KO_FALL) {
    const u = t / KO_FALL;
    out.tilt = HALF_PI * u * u; // gravity: slow start, fast slap
    out.down = false;
    return out;
  }
  out.down = true;
  if (t < KO_FALL + KO_BOUNCE) {
    const u = (t - KO_FALL) / KO_BOUNCE;
    const b = Math.sin(Math.PI * u);
    out.tilt = HALF_PI - 0.3 * b;
    out.lift = 0.1 * b;
    return out;
  }
  out.tilt = HALF_PI;
  const s = t - KO_FALL - KO_BOUNCE - KO_HOLD;
  if (s > 0) {
    const u = Math.min(1, s / KO_SINK);
    out.sink = 0.45 * u * u;
    const k = Math.max(0, (u - 0.25) / 0.75);
    out.shrink = 1 - k * k * (3 - 2 * k);
  }
  return out;
}

const KO = { tilt: 0, lift: 0, sink: 0, shrink: 1, down: false } as KoPose;
const Q_YAW = new THREE.Quaternion();
const Q_TIP = new THREE.Quaternion();
const AXIS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIZE = new THREE.Vector3();
const BOX = new THREE.Box3();

/** Set root rotation: yaw, then tipped by `tilt` toward the topple direction. */
function tip(root: THREE.Object3D, d: DeathAnim, tilt: number, extraYaw = 0): void {
  Q_YAW.setFromAxisAngle(UP, d.yaw + extraYaw);
  // Rotating about (dz, 0, -dx) swings "up" toward (dx, 0, dz).
  AXIS.set(d.dirZ, 0, -d.dirX);
  Q_TIP.setFromAxisAngle(AXIS, tilt);
  root.quaternion.multiplyQuaternions(Q_TIP, Q_YAW);
}

function fadeMarks(d: DeathAnim, t: number): void {
  const k = Math.max(0, 1 - t / MARK_FADE);
  for (const m of d.marks) {
    m.obj.scale.setScalar(m.s * k);
    if (k === 0) m.obj.visible = false;
  }
}

/** Pieces of a body worth throwing: top-level meshes (their details ride along). */
function topMeshes(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        if (c.visible && c.name !== "outline") out.push(mesh);
      } else {
        walk(c);
      }
    }
  };
  walk(group);
  return out;
}

function sizeOf(o: THREE.Object3D): number {
  BOX.setFromObject(o);
  BOX.getSize(SIZE);
  return SIZE.x + SIZE.y + SIZE.z;
}

/**
 * Break the body apart: re-parent its pieces onto the root (keeping their
 * world placement) with seeded launch velocities and spins. `budget` caps
 * the pieces; the smallest are dropped when a pile-up would exceed it.
 */
function shatter(
  root: THREE.Object3D,
  body: THREE.Object3D,
  d: DeathAnim,
  seed: number,
  budget: number,
): ShatterPart[] {
  let meshes = topMeshes(body);
  budget = Math.min(budget, SHATTER_CHUNKS);
  if (meshes.length > budget) {
    const sized = meshes.map((m) => ({ m, s: sizeOf(m) })).sort((a, b) => b.s - a.s);
    meshes = sized.slice(0, Math.max(0, budget)).map((x) => x.m);
    for (const x of sized.slice(Math.max(0, budget))) x.m.visible = false;
  }
  root.updateMatrixWorld(true);
  const lx = d.localX;
  const lz = d.localZ;
  const parts: ShatterPart[] = [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    root.attach(m);
    const px = m.position.x;
    const pz = m.position.z;
    const len = Math.sqrt(px * px + pz * pz) || 1;
    const out = 1.2 + 1.8 * hash01(seed, i * 7 + 1);
    parts.push({
      obj: m,
      vx: (px / len) * out + lx * 1.3 + hashSigned(seed, i * 7 + 2) * 0.6,
      vy: 2.6 + 2.6 * hash01(seed, i * 7 + 3),
      vz: (pz / len) * out + lz * 1.3 + hashSigned(seed, i * 7 + 4) * 0.6,
      rx: hashSigned(seed, i * 7 + 5) * 11,
      ry: hashSigned(seed, i * 7 + 6) * 7,
      rz: hashSigned(seed, i * 7 + 7) * 11,
      sx: m.scale.x,
      sy: m.scale.y,
      sz: m.scale.z,
    });
  }
  return parts;
}

export interface DeathSetup {
  motion: DeathMotion;
  root: THREE.Object3D;
  /** The animated body (rig group, or the root for glTF models). */
  body: THREE.Object3D;
  dirX: number;
  dirZ: number;
  fall: number;
  height: number;
  face: FaceRig | null;
  /** Root children that sit on the ground (team ring, contact shadow). */
  marks: THREE.Object3D[];
  ax: number;
  ay: number;
  fx: FxApi;
  seed: number;
  /** Shatter pieces already in flight elsewhere (counts against the cap). */
  activeParts: number;
}

/** Start a troop's death motion. */
export function startDeath(o: DeathSetup): DeathAnim {
  const yaw = o.root.rotation.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const d: DeathAnim = {
    motion: o.motion,
    duration: deathDuration(o.motion, o.fall),
    dirX: o.dirX,
    dirZ: o.dirZ,
    localX: o.dirX * c - o.dirZ * s,
    localZ: o.dirX * s + o.dirZ * c,
    yaw,
    scale: o.root.scale.x,
    fall: o.fall,
    height: o.height,
    face: o.face,
    body: o.body,
    parts: null,
    marks: o.marks.map((obj) => ({ obj, s: obj.scale.x })),
    ax: o.ax,
    ay: o.ay,
    fx: o.fx,
    thud: false,
    puffed: false,
  };
  if (o.motion === "shatter" && o.body !== o.root) {
    const budget = shatterCap() - o.activeParts;
    if (budget >= 4) {
      d.parts = shatter(o.root, o.body, d, o.seed, budget);
    } else {
      // The sky is already full of bones: fall over instead.
      d.motion = "ko";
      d.duration = KO_TIME;
    }
  }
  return d;
}

/** Advance a death motion to `t` seconds (render dt `dt`). */
export function stepDeath(d: DeathAnim, root: THREE.Object3D, t: number, dt: number): void {
  fadeMarks(d, t);
  if (d.motion === "shatter" && d.parts) {
    const shrink = t > SHATTER_FLY ? Math.max(0, 1 - (t - SHATTER_FLY) / SHATTER_SHRINK) : 1;
    const step = Math.min(dt, 0.05);
    for (const p of d.parts) {
      p.vy -= GRAVITY * step;
      const o = p.obj;
      o.position.x += p.vx * step;
      o.position.y += p.vy * step;
      o.position.z += p.vz * step;
      if (o.position.y < 0.05) {
        // Clatter on the ground: bounce low, skid, spin down.
        o.position.y = 0.05;
        if (p.vy < 0) p.vy = -p.vy * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.rx *= 0.6;
        p.ry *= 0.6;
        p.rz *= 0.6;
      }
      o.rotation.x += p.rx * step;
      o.rotation.y += p.ry * step;
      o.rotation.z += p.rz * step;
      o.scale.set(p.sx * shrink, p.sy * shrink, p.sz * shrink);
    }
    return;
  }
  if (d.motion === "tumble" && d.body !== root) {
    // Spin down out of the air about the body's own centre, then lie still.
    const T = tumbleTime(d.fall - TUMBLE_LAND);
    const ft = Math.min(t, T);
    d.body.position.y = Math.max(TUMBLE_LAND, d.fall - 0.5 * GRAVITY * ft * ft);
    AXIS.set(d.localZ, 0, -d.localX);
    Q_TIP.setFromAxisAngle(AXIS, Math.min(HALF_PI * 1.2, ft * 8));
    Q_YAW.setFromAxisAngle(UP, ft * 6);
    d.body.quaternion.multiplyQuaternions(Q_TIP, Q_YAW);
    if (t >= T && !d.puffed) {
      d.puffed = true;
      d.fx.emit("dust", d.ax, d.ay, { radius: 0.55 });
    }
    const s = t - T - TUMBLE_REST;
    const k = s > 0 ? Math.max(0, 1 - s / TUMBLE_SHRINK) : 1;
    root.scale.setScalar(d.scale * k);
    return;
  }
  // Knockout.
  koPose(t, KO);
  tip(root, d, KO.tilt);
  // Lying on its back, not half buried: lift by the body's thickness.
  root.position.y = KO.lift + 0.12 * Math.sin(KO.tilt) * d.scale - KO.sink;
  root.scale.setScalar(d.scale * KO.shrink);
  if (KO.down && !d.thud) {
    d.thud = true;
    if (d.face) poseFace(d.face, { blink: false, squint: 0, anger: 0, ko: true });
  }
  if (KO.sink > 0 && !d.puffed) {
    d.puffed = true;
    const h = d.height * 0.5;
    d.fx.emit("dust", d.ax + d.dirX * h, d.ay + d.dirZ * h, { radius: 0.6 });
  }
}
