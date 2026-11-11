/**
 * Driving cast units: idle / walk / attack blended from combat state, the
 * attack clip's blow locked to the sim's attack timer, walk speed matched
 * to ground speed (no foot sliding), a light Hit_A react, Death_A, the
 * mixer rate by quality level, swarms sharing one pose, and the
 * render-only LEAN toward the camera.
 *
 * Reads entity state only: nothing here writes the sim.
 */
import * as THREE from "three";
import { QUALITY_LEVELS, currentQuality } from "../quality";
import type { KitUnit } from "./unit";
import { castRoster } from "./loader";

/** Characters lean this far toward the camera (render-only, pivot at the feet). */
export const LEAN_DEG = 14;
export const LEAN = (LEAN_DEG * Math.PI) / 180;

/** Seconds of the light hit react. */
export const HIT_REACT_TIME = 0.28;
/** Peak weight of the hit react over the current pose. */
export const HIT_REACT_WEIGHT = 0.45;
/** Units of one card per side from which they share one pose. */
export const SWARM_SHARE = 6;

/** Mixer updates per second at quality level `index` (art bible 6): that level's QualityLevel.mixerHz. */
export function mixerHz(index: number): number {
  return QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, index))].mixerHz;
}

const AXIS = new THREE.Vector3();

/**
 * The lean of a unit's body, as a rotation in its root's (yawed) frame.
 * The body tips about its feet so its front (or back) turns TOWARD the
 * camera: the head goes away from the viewer, the body stands taller on
 * screen and less of it is hat-top (a partial billboard). The axis is
 * horizontal and perpendicular to the camera's horizontal view direction
 * (camDirX, camDirZ), so it works from any viewpoint (the guest's, the
 * swaying home diorama).
 */
export function leanQuaternion(camDirX: number, camDirZ: number, yaw: number, out: THREE.Quaternion, angle = LEAN): THREE.Quaternion {
  const len = Math.hypot(camDirX, camDirZ);
  if (len < 1e-6) return out.identity();
  // Along the view, on the ground (away from the camera).
  const dx = camDirX / len;
  const dz = camDirZ / len;
  // up x away: rotating about it swings "up" away from the camera.
  const ax = dz;
  const az = -dx;
  // Into the root's frame (undo its yaw).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  AXIS.set(ax * c - az * s, 0, ax * s + az * c);
  return out.setFromAxisAngle(AXIS, angle);
}

/** The camera's horizontal view direction, set once per frame by the scene (troops and crews read it). */
export const VIEW_DIR = { x: 0, z: -1 };

export function setLeanCamera(camera: THREE.Camera): void {
  camera.getWorldDirection(DIR3);
  VIEW_DIR.x = DIR3.x;
  VIEW_DIR.z = DIR3.z;
}
const DIR3 = new THREE.Vector3();

export interface KitPose {
  moving: boolean;
  attacking: boolean;
  /** Seconds until the next blow lands, and the seconds between blows. */
  cooldown: number;
  hitSpeed: number;
  /** Walk / swing speed multiplier (slow, rage). */
  rate: number;
  /** Frozen or stunned: the whole body holds its pose (the mixer pauses). */
  frozen: boolean;
  /** Ground speed in world units per second while moving (matches the walk clip to it). */
  speed?: number;
  /** A blow landed on this unit this frame (starts the hit react). */
  hit?: boolean;
  /** Fully charged (the Prince): the weapon is couched at its strike pose. */
  charging?: boolean;
}

// ---------------------------------------------------------------- swarms

const swarms = new Map<string, KitUnit[]>();

/** Count a unit into its card+side swarm (from makeKitTroop). */
export function joinSwarm(u: KitUnit): void {
  if (!u.swarmKey) return;
  let list = swarms.get(u.swarmKey);
  if (!list) swarms.set(u.swarmKey, (list = []));
  if (!list.includes(u)) list.push(u);
}

/** Take a unit out of its swarm (death, dispose). */
export function leaveSwarm(u: KitUnit): void {
  if (!u.swarmKey) return;
  const list = swarms.get(u.swarmKey);
  if (!list) return;
  const i = list.indexOf(u);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) swarms.delete(u.swarmKey);
}

/** The unit whose pose this one copies, or null when it animates itself. */
export function swarmLeader(u: KitUnit): KitUnit | null {
  if (!u.swarmKey) return null;
  const list = swarms.get(u.swarmKey);
  if (!list || list.length < SWARM_SHARE || list[0] === u) return null;
  return list[0];
}

/** For tests. */
export function swarmSize(key: string): number {
  return swarms.get(key)?.length ?? 0;
}

// ---------------------------------------------------------------- driving

/** Advance the mixer at the quality level's rate (a unit's own clock accumulates between steps). */
function stepMixer(u: KitUnit, dt: number): void {
  u.acc += dt;
  const hz = currentQuality().mixerHz;
  if (u.acc + 1e-4 < 1 / hz) return;
  u.mixer.update(u.acc);
  u.acc = 0;
}

/** Drive a unit's clips from its combat state: walk and idle on the clock, the attack locked to the sim's timer. */
export function animateKitTroop(u: KitUnit, s: KitPose, dt: number): void {
  if (u.dying) return;
  if (s.hit) u.hitT = HIT_REACT_TIME;
  if (s.frozen) return; // frozen or stunned: the whole body holds its pose
  u.clock += dt;
  if (u.mount) castRoster()?.animateMount(u.mount, s.moving, s.speed ?? 1.2, dt, u.clock); // a mount exists only once the roster is in

  const leader = swarmLeader(u);
  if (leader) {
    // A swarm member wears its leader's pose (23 bone rotations), not its own mixer.
    for (let i = 0; i < u.bones.length; i++) {
      u.bones[i].quaternion.copy(leader.bones[i].quaternion);
      u.bones[i].position.copy(leader.bones[i].position);
    }
    return;
  }

  const want = s.attacking || s.charging ? 2 : s.moving ? 1 : 0;
  const k = Math.min(1, dt / 0.14);
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    u.weights[i] += ((i === want ? 1 : 0) - u.weights[i]) * k;
    sum += u.weights[i];
  }
  u.hitT = Math.max(0, u.hitT - dt);
  const hitW = u.actions.hit && u.hitT > 0 ? HIT_REACT_WEIGHT * Math.sin(Math.PI * (1 - u.hitT / HIT_REACT_TIME)) : 0;
  const { idle, walk, attack, hit } = u.actions;
  const rest = (1 - hitW) / sum;
  idle.setEffectiveWeight(u.weights[0] * rest);
  walk.setEffectiveWeight(u.weights[1] * rest);
  attack.setEffectiveWeight(u.weights[2] * rest);
  if (hit) {
    hit.setEffectiveWeight(hitW);
    // The first half of Hit_A: the flinch, not the recovery.
    hit.time = (1 - u.hitT / HIT_REACT_TIME) * hit.getClip().duration * 0.5;
  }
  // Feet planted: the walk clip runs at the ground speed it was made for.
  const ts = s.speed !== undefined && u.walkSpeed > 0 ? s.speed / (u.walkSpeed * u.scale) : s.rate;
  walk.setEffectiveTimeScale(Math.max(0.2, Math.min(3, ts)));

  // The clip's blow lands exactly when the sim's does: wind up into it, follow through after.
  const d = attack.getClip().duration;
  const hs = Math.max(0.05, s.hitSpeed);
  const speed = Math.max(1, d / hs);
  const pre = (u.strike * d) / speed;
  const post = ((1 - u.strike) * d) / speed;
  const since = hs - s.cooldown;
  let t = 0;
  if (s.charging && !s.attacking) t = u.strike * d;
  else if (s.attacking) {
    if (s.cooldown <= pre) t = u.strike * d - s.cooldown * speed;
    else if (since <= post) t = u.strike * d + since * speed;
  }
  attack.time = Math.max(0, Math.min(d - 1e-3, t));
  stepMixer(u, dt);
}

/** Start a unit's Death_A (its swarm forgets it; it poses itself from now on). */
export function startKitDeath(u: KitUnit): void {
  if (u.dying) return;
  u.dying = true;
  leaveSwarm(u);
  const death = u.actions.death;
  if (!death) return;
  for (const a of [u.actions.idle, u.actions.walk, u.actions.attack, u.actions.hit, u.actions.lower]) a?.setEffectiveWeight(0);
  death.reset();
  death.setLoop(THREE.LoopOnce, 1);
  death.clampWhenFinished = true;
  death.setEffectiveWeight(1);
  death.setEffectiveTimeScale(DEATH_SPEED);
  death.play();
  u.mixer.update(0);
}

/** Death_A plays this much faster than authored: the fall lands with the existing KO beat. */
export const DEATH_SPEED = 1.8;

/** Advance a dying unit's Death_A (every frame: a death is short and on screen). */
export function stepKitDeath(u: KitUnit, dt: number): void {
  if (u.dying) u.mixer.update(dt);
}
