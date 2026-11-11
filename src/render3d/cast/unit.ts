/**
 * A cast UNIT: one baked variant on its own skeleton (23 bones and one
 * bone texture), its own material instance (hit and status tints) and an
 * AnimationMixer. The view scales and squashes `group`; the bones and the
 * one skinned mesh live inside it.
 */
import * as THREE from "three";
import type { Side } from "../../game/arena";
import { castBeforeRender, castMaterial, type Baked } from "./bake";
import { BONE_INDEX, clipSpeed, clips, type Source } from "./loader";
import type { Variant } from "./types";

export interface KitUnit {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  actions: {
    idle: THREE.AnimationAction;
    walk: THREE.AnimationAction;
    attack: THREE.AnimationAction;
    hit?: THREE.AnimationAction;
    death?: THREE.AnimationAction;
  };
  /** Blend weights of idle / walk / attack. */
  weights: [number, number, number];
  /** Head-top height of the scaled model, for the HP bar and stars. */
  height: number;
  strike: number;
  /** Walk speed multiplier when no ground speed is given (B's API). */
  pace: number;
  /** The variant's resting scale (the view layers its entrance and hit squash on it). */
  scale: number;
  skeleton: THREE.Skeleton;
  /** The skeleton's bones in BONES order (swarm members copy their leader's). */
  bones: THREE.Bone[];
  /** Ground speed of the walk clip at time scale 1, rig units per second. */
  walkSpeed: number;
  /** Card+side key for swarm pose sharing ("" for crews and ghosts). */
  swarmKey: string;
  side: Side;
  cardId: string;
  /** Seconds left of the hit react. */
  hitT: number;
  /** Seconds accumulated since the mixer last stepped. */
  acc: number;
  dying: boolean;
}

/** Assemble a unit of a baked variant for a (viewer-relative) side. */
export function makeUnit(cardId: string, v: Variant, b: Baked, src: Source, side: Side, swarmKey: string): KitUnit {
  const group = new THREE.Group();
  group.name = "kitTroop";
  group.scale.setScalar(v.scale);
  const bones = src.bones.map((s) => {
    const bone = new THREE.Bone();
    bone.name = s.name;
    bone.position.copy(s.position);
    bone.quaternion.copy(s.quaternion);
    bone.scale.copy(s.scale);
    return bone;
  });
  src.bones.forEach((s, i) => {
    const parent = s.parent ? BONE_INDEX.get(s.parent.name) : undefined;
    if (parent !== undefined && (s.parent as THREE.Bone).isBone) bones[parent].add(bones[i]);
    else group.add(bones[i]);
  });
  const skeleton = new THREE.Skeleton(bones, src.inverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(b.geometry, castMaterial(b.atlas, side));
  mesh.name = "kitBody";
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.onBeforeRender = castBeforeRender;
  group.add(mesh);

  const mixer = new THREE.AnimationMixer(group);
  const action = (name: string, play = true): THREE.AnimationAction => {
    const clip = clips.get(name) ?? clips.get("Idle")!;
    const a = mixer.clipAction(clip);
    if (play) a.play();
    return a;
  };
  const actions: KitUnit["actions"] = { idle: action(v.idle), walk: action(v.walk), attack: action(v.attack) };
  actions.attack.paused = true; // posed from the sim's attack timer, never by the mixer clock
  actions.walk.setEffectiveWeight(0);
  actions.attack.setEffectiveWeight(0);
  if (clips.has("Hit_A")) {
    actions.hit = action("Hit_A");
    actions.hit.paused = true;
    actions.hit.setEffectiveWeight(0);
  }
  if (clips.has("Death_A")) actions.death = action("Death_A", false);
  // Units start their idle at different points (a deterministic hash, not the sim's randomness).
  actions.idle.time = (((cardId.length * 7919 + bones.length * 104729 + mixerSeed++) % 997) / 997) * actions.idle.getClip().duration;
  mixer.update(0);
  const unit: KitUnit = {
    group,
    mesh,
    mixer,
    actions,
    weights: [1, 0, 0],
    height: b.top * v.scale,
    strike: v.strike,
    pace: 1,
    scale: v.scale,
    skeleton,
    bones,
    walkSpeed: clipSpeed.get(v.walk) ?? 0,
    swarmKey,
    side,
    cardId,
    hitT: 0,
    acc: 0,
    dying: false,
  };
  group.userData.kitUnit = unit; // disposeDeep frees its skeleton and swarm slot
  return unit;
}

let mixerSeed = 1;
