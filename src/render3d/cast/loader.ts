/**
 * Loading the cast: the CC0 KayKit Adventurers and Skeletons characters
 * (Kay Lousberg), packed by tools/troop-pack.mjs into public/models/troops/
 * (one small meshopt-compressed GLB per body, one shared clip set: every
 * body shares the Rig_Medium skeleton).
 *
 * The pack starts loading at app boot (loadKitTroops, from
 * troops.loadGlbModels). A battle uses the cast only when the pack was in
 * when it began (castActiveForBattle): never a mix of modelled and
 * procedural troops in one battle, and nothing pops in mid-fight.
 */
import * as THREE from "three";
import { FILES, type FileId } from "./types";

/** The rig's deform bones (GLTFLoader strips the dots from "upperarm.l"). */
export const BONES = [
  "root", "hips", "spine", "chest", "head",
  "upperarml", "lowerarml", "wristl", "handl", "handslotl",
  "upperarmr", "lowerarmr", "wristr", "handr", "handslotr",
  "upperlegl", "lowerlegl", "footl", "toesl",
  "upperlegr", "lowerlegr", "footr", "toesr",
] as const;
export const BONE_INDEX = new Map<string, number>(BONES.map((n, i) => [n, i]));
export const HEAD_BONE = BONE_INDEX.get("head")!;

export interface Source {
  rig: THREE.Object3D;
  image: CanvasImageSource;
  /** Deform bones of the source rig, by BONES index. */
  bones: THREE.Bone[];
  inverses: THREE.Matrix4[];
  /** Source skeleton joint -> BONES index (unknown joints ride the root). */
  remap: number[];
}

export const sources = new Map<FileId, Source>();
export const clips = new Map<string, THREE.AnimationClip>();
/** Ground speed of each walk clip at time scale 1, rig units per second (feet planted). */
export const clipSpeed = new Map<string, number>();

let loading: Promise<boolean> | null = null;
let ready = false;
/** Whether the battle in progress uses the cast (latched by beginCastBattle). */
let battleCast: boolean | null = null;

/** Off in node (tests) and with the DEV-only `?troops=rigs` A/B switch (the procedural roster). */
export function kitTroopsWanted(): boolean {
  try {
    if (typeof document === "undefined") return false;
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("troops") === "rigs") return false;
    return true;
  } catch {
    return false;
  }
}

/** True once the pack is loaded and baked sources exist. */
export function castLoaded(): boolean {
  return ready;
}

/** Start (or join) the one load of the character pack; resolves false if it failed or is switched off. */
export function loadKitTroops(): Promise<boolean> {
  if (!kitTroopsWanted()) return Promise.resolve(false);
  loading ??= (async () => {
    const t0 = performance.now();
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const base = `${import.meta.env.BASE_URL}models/troops/`;
    const [anims, ...chars] = await Promise.all([
      loader.loadAsync(`${base}anims.glb`),
      ...FILES.map((f) => loader.loadAsync(`${base}${f}.glb`)),
    ]);
    for (const clip of anims.animations) clips.set(clip.name, clip);
    measureWalks(anims.scene);
    chars.forEach((gltf, i) => {
      const rig = gltf.scene;
      rig.updateMatrixWorld(true);
      let skinned: THREE.SkinnedMesh | null = null;
      let image: CanvasImageSource | null = null;
      rig.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && !skinned) skinned = m;
        const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map;
        if (map && !image) image = map.image as CanvasImageSource;
      });
      if (!skinned || !image) throw new Error(`cast: ${FILES[i]} has no skinned mesh or palette`);
      const skeleton = (skinned as THREE.SkinnedMesh).skeleton;
      const bones: THREE.Bone[] = [];
      const inverses: THREE.Matrix4[] = [];
      const remap = skeleton.bones.map((bone, j) => {
        const at = BONE_INDEX.get(bone.name);
        if (at === undefined) return 0;
        bones[at] = bone;
        inverses[at] = skeleton.boneInverses[j];
        return at;
      });
      if (bones.filter(Boolean).length !== BONES.length) throw new Error(`cast: ${FILES[i]} is missing rig bones`);
      sources.set(FILES[i], { rig, image, bones, inverses, remap });
    });
    ready = true;
    if (import.meta.env.DEV) console.info(`cast: pack ready in ${Math.round(performance.now() - t0)} ms`);
    return true;
  })().catch((err) => {
    console.warn("cast: pack failed to load, keeping the procedural roster", err);
    return false;
  });
  return loading;
}

/** Resolves when the pack is in (true) or has failed / is switched off (false). */
export function castReady(): Promise<boolean> {
  return loadKitTroops();
}

/**
 * Latch whether the battle starting now uses the cast: call at battle
 * start (after waiting up to 3 s on castReady()). Until the next call,
 * castActiveForBattle() keeps that answer even if the pack arrives later.
 */
export function beginCastBattle(): boolean {
  battleCast = ready;
  return battleCast;
}

/** Whether the battle in progress fields the modelled cast (the pack's state if no battle latched it). */
export function castActiveForBattle(): boolean {
  return battleCast ?? ready;
}

/**
 * How far a walk clip carries the body per second when its planted foot
 * does not slide: the mean backward speed of whichever foot is lower,
 * sampled over one cycle on the clip rig.
 */
function measureWalks(rig: THREE.Object3D): void {
  const footL = rig.getObjectByName("footl");
  const footR = rig.getObjectByName("footr");
  if (!footL || !footR) return;
  const mixer = new THREE.AnimationMixer(rig);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const name of ["Walking_A", "Walking_B", "Running_A", "Running_B"]) {
    const clip = clips.get(name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.play();
    const n = 48;
    let travel = 0;
    let lastZ: number | null = null;
    let lastFoot: THREE.Object3D | null = null;
    for (let i = 0; i <= n; i++) {
      mixer.setTime((clip.duration * i) / n);
      rig.updateMatrixWorld(true);
      footL.getWorldPosition(a);
      footR.getWorldPosition(b);
      const foot = a.y <= b.y ? footL : footR;
      const z = foot === footL ? a.z : b.z;
      if (lastZ !== null && foot === lastFoot) travel += Math.max(0, lastZ - z);
      lastZ = z;
      lastFoot = foot;
    }
    action.stop();
    clipSpeed.set(name, travel / clip.duration);
  }
  mixer.stopAllAction();
}
