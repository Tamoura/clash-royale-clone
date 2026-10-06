/**
 * Shared state and helpers for the Battle3D scene modules: arena-to-world
 * mapping, the current viewpoint and arena look, team colours, the view
 * records the sync loop keeps per entity, and GPU disposal.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, type Side } from "../../game/arena";
import type { Entity } from "../../game/battle";
import type { TroopRig } from "../characters3d";
import type { Battle3D } from "../scene3d";
import type { GlbUnit } from "../glbModels";
import { ARABIC } from "../theme";
import { ARABIC_LOOK, LOOKS, type ArenaLook } from "../arenaLooks";

/** Arena tiles → world units: x centered, arena y becomes world z. */
export function toWorld(ax: number, ay: number): { x: number; z: number } {
  return { x: ax - ARENA_WIDTH / 2, z: ay - ARENA_HEIGHT / 2 };
}

export const SIDE_COLOR: Record<Side, number> = { player: 0x3b82f6, enemy: 0xef4444 };
/** HP-bar fill: CR convention — your units green, the enemy's red. */
export const HP_COLOR: Record<Side, number> = { player: 0x35d04a, enemy: 0xef4444 };

// Which side sits at the bottom of the screen. The host views as "player"
// (default); an online guest views as "enemy", so the camera looks from the
// far side and flat HP bars rotate 180° about Y to match — viewed from the
// opposite side, the two cancel out and bars read identically.
export let viewSide: Side = "player";
/** Called from Battle3D.setViewpoint (an ES binding is read-only outside). */
export function setViewSide(side: Side): void {
  viewSide = side;
}
export function cameraZForView(): number {
  return viewSide === "player" ? CAM_HOME.z : -CAM_HOME.z;
}

/** Per-theme scenery palette (theme flag lives in theme.ts). */
export const arabic = ARABIC;
/**
 * The arena look for the CURRENT battle. The normal edition swaps this per
 * trophy-road arena (see arenaLooks.ts); the Arabic edition keeps its one
 * night bazaar. Read at build time by every set-dressing routine.
 */
export let LOOK: ArenaLook = arabic ? ARABIC_LOOK : LOOKS.neon;
/** Called from Battle3D.setArenaLook. */
export function setLook(look: ArenaLook): void {
  LOOK = look;
}

/**
 * CR-style camera, lowered to ~49° elevation: steep enough that the
 * board reads flat, shallow enough that characters show their FACES,
 * bodies and weapons instead of the tops of their heads — silhouettes
 * are unreadable from directly above.
 */
export const CAM_HOME = new THREE.Vector3(0, 30, 26);
/** HP bars and similar boards tilt to face that camera square-on. */
export const BAR_TILT = -Math.atan2(CAM_HOME.y, CAM_HOME.z - 1.0);

/** The game's display face (bundled, OFL) with the old system fallbacks. */
export const GAME_FONT = "'Lilita One', 'Baloo Bhaijaan 2', 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";

/** Render-loop scratch vectors (render-avoid-allocations). */
export const PREV_POS = new THREE.Vector3();
export const LOOK_AT = new THREE.Vector3();

export const TROOP_DEATH_TIME = 0.5;
export const TOWER_DEATH_TIME = 0.8;
export const SPAWN_POP_TIME = 0.35;
export const HOP_TIME = 0.34; // Mega Knight leap arc duration
export const FLASH_TIME = 0.12;
/** Duration of the squash-and-stretch jiggle when a unit takes a hit. */
export const HIT_JIGGLE_TIME = 0.2;

export interface EntityView {
  root: THREE.Group;
  rig: TroopRig | null;
  hpFill: THREE.Mesh;
  hpGroup: THREE.Group;
  zzz?: THREE.Sprite;
  /** Cannon barrel, aimed at the current target. */
  barrel?: THREE.Group;
  /** Live numeric HP readout (towers). */
  hpText?: HpText;
  /** Materials with an emissive channel, for damage flashes. */
  flashMats: { mat: THREE.Material & { emissive: THREE.Color }; orig: number }[];
  lastHp: number;
  flashT: number;
  spawnT: number;
  isTroop: boolean;
  /** Resting scale (towers stand 1.5x for prominence). */
  baseScale?: number;
  /** Spinning stars shown while the entity is stunned (lazy). */
  stunStars?: THREE.Sprite;
  /** Whether any emissive glow (flash/rage/charge) is applied. */
  glowing?: boolean;
  /** Character perched on a tower (princess archer / the king). */
  defender?: TroopRig;
  /** Mount group carrying the defender (owns yaw/slump). */
  defenderMount?: THREE.Group;
  /** Damage batched since the last floating number. */
  pendingDmg?: number;
  /** Seconds until the next floating number may appear. */
  popupT?: number;
  /** Soft contact shadow under a flyer. */
  blobShadow?: THREE.Mesh;
  /** Seconds until the next footstep dust puff. */
  dustT?: number;
  /** How this troop enters the field. */
  spawnStyle?: "rise" | "pop" | "slam";
  spawnColor?: number;
  spawnBurst?: number;
  /** White countdown ring shown while the unit's deploy freeze runs. */
  deployRing?: THREE.Mesh;
  /** Seconds left of the take-a-hit squash jiggle. */
  hitT?: number;
  /** Damage stage a tower has visibly reached (0 pristine, 1 smoking, 2 burning). */
  dmgStage?: number;
  /** Seconds until the next damage-smoke puff on a wounded tower. */
  smokeT?: number;
  /** Seconds left in a leap arc (Mega Knight jump), 0/undefined = grounded. */
  hopT?: number;
  /** World position the current leap launched from. */
  hopFromX?: number;
  hopFromZ?: number;
  /** Real glTF model (KayKit) + animation mixer, when this card uses one. */
  glb?: GlbUnit & { current?: string };
  /** Deploy name tag: shown briefly, then shrinks away (CR shows none). */
  label?: THREE.Object3D;
  labelAge?: number;
}

export interface DyingView {
  view: EntityView;
  t: number;
  duration: number;
  /** Corpses topple to a side; buildings sink. */
  topple: number;
  fadeMats: (THREE.Material & { opacity: number })[];
}

export interface HpText {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: number;
}

export interface EffectView {
  obj: THREE.Object3D;
  ttl: number;
  ttl0: number;
  delay: number;
  update: (frac: number) => void;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Free GPU resources of a dynamic object (three-best-practices:
 * memory-dispose-recursive). Resources flagged `userData.shared`
 * (cached geometries, label materials, shared textures) and the
 * sprite class's global plane geometry are spared.
 */
export function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const isSprite = (o as THREE.Sprite).isSprite === true;
    if (!mesh.isMesh && !isSprite) return;
    if (!isSprite) {
      // Sprites share one global plane geometry — never dispose it.
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo && !geo.userData.shared) geo.dispose();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      if (m.userData.shared) continue;
      const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
      if (map && !map.userData.shared) map.dispose();
      m.dispose();
    }
  });
}

/** Unlit hot material: ignores lights and skips tone mapping. */
export function unlitGlow(color: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color });
  mat.toneMapped = false;
  return mat;
}

/** The entity `e` is targeting this frame, via the per-frame id index. */
export function targetOf(b: Battle3D, e: Entity): Entity | undefined {
  return e.targetId === null ? undefined : b.byId.get(e.targetId);
}
