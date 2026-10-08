/**
 * Per-frame unit animation: interpolated placement between sim ticks, the
 * drop-in entrance, hit reactions (directional recoil, flash, squint),
 * status poses (stun daze, freeze in an ice shell, slow), the attack in
 * each unit's own style, speed-matched walking, living faces, and the
 * knockout / shatter / tumble when a unit leaves the field.
 *
 * Everything here reads the battle state and never writes it: lockstep
 * and replays are untouched by anything a frame does.
 */
import * as THREE from "three";
import { DEPLOY_DELAY, distance, type BattleEvent, type Entity } from "../../../game/battle";
import { getCard } from "../../../game/cards";
import { RAGE_BOOST, isRaged, moveGoal } from "../../../game/sim";
import { reducedMotion } from "../../../ui/prefs";
import { animateTroop, toon, type TroopRig } from "../../characters3d";
import { damageLabel } from "../../popups";
import { blobShadowScale, DUST_INTERVAL } from "../../ground";
import { impactStyle } from "../../impactfx";
import { deathMotion, toppleDirection } from "../../deathfx";
import { DROP_FALL, dropDelay, dropDuration, dropPose, type DropPose } from "../../spawnfx";
import { ARABIC } from "../../theme";
import type { Battle3D } from "../../scene3d";
import { SIM_DT, animClock, clampAlpha, pushSample, sampleTrack } from "../../anim/interp";
import {
  TOWER_ARCHETYPE,
  archetypeFor,
  attackSwing as swingCurve,
  newSwingPose,
  rigArchetype,
  setRigArchetype,
  type Archetype,
  type SwingPose,
} from "../../anim/archetypes";
import { gaitCadence } from "../../anim/gait";
import {
  SQUINT_TIME,
  blinkShut,
  dropSkinGrain,
  faceOf,
  newBlinkClock,
  poseFace,
  type BlinkClock,
  type FaceRig,
} from "../../anim/face";
import { startDeath, stepDeath } from "../../anim/deaths";
import {
  FLASH_TIME,
  HIT_JIGGLE_TIME,
  HOP_TIME,
  SPAWN_POP_TIME,
  TOWER_DEATH_TIME,
  TROOP_DEATH_TIME,
  easeOutBack,
  targetOf,
  toWorld,
  type DyingView,
  type EntityView,
} from "../common";
import { addShake } from "../camera";
import { contactRing, damagePopup, emitSparks, megaSlam } from "../fx/effects";
import { glbModels, hpBarVisible, makeStunSprite, setHpFill } from "./troops";

/** A troop view's animation state (created on its first frame). */
export interface TroopAnim {
  cardId: Entity["cardId"];
  arch: Archetype;
  /** Rig scale as built (the size class), for gait cadence. */
  rigScale: number;
  /** Stride rate at the unit's own speed, rad/s. */
  cadence: number;
  /** Per-view animation time: stops while stunned or frozen. */
  clock: number;
  /** The shared animation clock as of last frame. */
  seen: number;
  /** Walk-cycle angle. */
  stride: number;
  /** Walking, as fed to the pose (held through a stun). */
  moving: boolean;
  pose: SwingPose;
  face: FaceRig | null;
  blink: BlinkClock;
  /** The head's own roll, restored after a daze wobble. */
  headRoll: number;
  squintT: number;
  /** Recoil of the latest blow (world, attacker -> victim) and when it landed. */
  recoilX: number;
  recoilZ: number;
  recoilAt: number;
  /** Direction of the jiggle now playing (world, unit or zero). */
  jigX: number;
  jigZ: number;
  frozen: boolean;
  /** Translucent ice hull, built on the first freeze. */
  ice: THREE.Object3D[] | null;
  /** Seconds this unit waits in its deploy group's drop stagger. */
  dropDelay: number;
  landed: boolean;
}

/** A troop that drops in from the sky (not risers or the slam entrance). */
function drops(view: EntityView): boolean {
  return view.spawnStyle === "drop" || view.spawnStyle === "pop";
}

/** Body tilt away from a blow, per weight class (radians). */
const RECOIL_TILT = { light: 0.25, medium: 0.15, heavy: 0.08 } as const;
/** Ground shove on a blow, tiles; eases back over the jiggle. */
const RECOIL_KNOCK = 0.06;
/** Seconds a blow's direction stays fresh (covers projectile flight). */
const RECOIL_FRESH = 1.2;
/** Emissive tints for status poses. */
const FROZEN_TINT = [0.25, 0.45, 0.6] as const;
const SLOW_TINT = [0.12, 0.04, 0.17] as const;
const FLASH_WARM = [1, 0.85, 0.7] as const;

/** Freeze spells in force, tracked render-side from 'spell' events. */
interface FreezeZone {
  x: number;
  y: number;
  r: number;
  start: number;
  until: number;
}

/** Per-battle-view render state the scene class doesn't carry itself. */
interface SceneAnim {
  /** The shared animation clock (sim time + alpha, held by hit-stop). */
  clock: number;
  freezes: FreezeZone[];
}

const SCENES = new WeakMap<Battle3D, SceneAnim>();
/** Entity -> its view, for event handlers that only know a position. */
const VIEW_OF = new WeakMap<Entity, EntityView>();

function sceneAnim(b: Battle3D): SceneAnim {
  let s = SCENES.get(b);
  if (!s) {
    s = { clock: 0, freezes: [] };
    SCENES.set(b, s);
  }
  return s;
}

// Render-loop scratch (render-avoid-allocations).
const POS = { x: 0, z: 0 };
const DIR = { x: 0, z: 0 };
const DROP: DropPose = { visible: true, y: 0, sx: 1, sy: 1, sz: 1 };
const TOWER_POSE = newSwingPose();

/**
 * Signed attack swing for callers that animate a rig straight from an
 * entity (the tower crews): see archetypes.attackSwing for the curve.
 */
export function attackSwing(e: Entity, engaged: boolean): number {
  return swingCurve(e.cooldown, e.hitSpeed, engaged, "shoot", TOWER_POSE).swing;
}

/** Start the death motion for a removed entity. */
export function beginDeath(b: Battle3D, view: EntityView): void {
  if (!view.isTroop) {
    // Towers and buildings keep their sink-and-fade.
    const fadeMats: DyingView["fadeMats"] = [];
    view.root.traverse((o) => {
      const sprite = o as THREE.Sprite;
      if (sprite.isSprite) {
        // Label materials are shared between units — hide, don't fade.
        sprite.visible = false;
        return;
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material & { opacity: number };
        // A shared material (a baked rig's template, the outline) must never fade.
        if (mat.userData.shared || fadeMats.includes(mat)) return;
        mat.transparent = true;
        fadeMats.push(mat);
      }
    });
    b.dying.push({ view, t: 0, duration: TOWER_DEATH_TIME, topple: 0.12, fadeMats });
    return;
  }

  // Troops leave by motion and scale, never by transparency.
  const anim = view.anim;
  view.root.visible = true;
  view.hpGroup.visible = false;
  if (view.label) view.label.visible = false;
  if (view.stunStars) view.stunStars.visible = false;
  if (view.deployRing) view.deployRing.visible = false;
  if (anim?.ice) for (const m of anim.ice) m.visible = false;
  view.root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) o.visible = false;
  });
  if (view.glowing) {
    for (const f of view.flashMats) f.mat.emissive.setHex(f.orig);
    view.glowing = false;
  }
  if (anim?.face?.head) anim.face.head.rotation.z = anim.headRoll;

  const now = b.syncState?.time ?? 0;
  const fresh = anim && now - anim.recoilAt <= RECOIL_FRESH;
  toppleDirection(
    fresh ? anim.recoilX : 0,
    fresh ? anim.recoilZ : 0,
    view.root.position.x,
    view.root.position.z,
    DIR,
  );
  const marks: THREE.Object3D[] = [];
  for (const c of view.root.children) {
    if ((c as THREE.Mesh).isMesh) marks.push(c);
  }
  let active = 0;
  for (const d of b.dying) active += d.anim?.parts?.length ?? 0;
  const rig = view.rig;
  const fall = rig?.hover ? rig.group.position.y : 0;
  // World -> arena tiles (toWorld() just recentres the board).
  const origin = toWorld(0, 0);
  const motion = deathMotion(anim?.cardId ?? null, {
    flying: !!rig?.hover,
    hasFace: !!anim?.face,
  });
  const da = startDeath({
    motion,
    root: view.root,
    body: rig?.group ?? view.root,
    dirX: DIR.x,
    dirZ: DIR.z,
    fall,
    height: rig ? rig.height * rig.group.scale.y : 1.5,
    face: anim?.face ?? null,
    marks,
    ax: view.root.position.x - origin.x,
    ay: view.root.position.z - origin.z,
    fx: b.fx,
    seed: (anim?.blink.seed ?? 1) * 7919,
    activeParts: active,
  });
  b.dying.push({ view, t: 0, duration: da.duration || TROOP_DEATH_TIME, topple: 0, fadeMats: [], anim: da });
}

/** First-frame setup of a troop view's animation state. */
function initTroopAnim(b: Battle3D, view: EntityView, e: Entity): TroopAnim {
  const rig = view.rig;
  const arch = archetypeFor(e.cardId, {
    arabic: ARABIC,
    champion: e.cardId === "champion" ? { range: e.attackRange, hp: e.maxHp } : undefined,
  });
  const rigScale = rig ? rig.group.scale.x : 1.25;
  const face = rig ? faceOf(rig.group) : null;
  if (rig) {
    setRigArchetype(rig, arch);
    dropSkinGrain(rig.group, face);
  }
  // Which unit of its deploy group is this? (Same card, side and deploy
  // moment; lower ids landed first.) Spaces the swarm's drop-in.
  let index = 0;
  if (drops(view) && e.deployTimer > 0) {
    for (const o of b.syncState.entities) {
      if (
        o.id < e.id &&
        o.cardId === e.cardId &&
        o.side === e.side &&
        o.kind === "troop" &&
        Math.abs(o.deployTimer - e.deployTimer) < 1e-6
      ) {
        index++;
      }
    }
  }
  const speed = e.speed > 0 ? e.speed : 1.1;
  const anim: TroopAnim = {
    cardId: e.cardId,
    arch,
    rigScale,
    cadence: gaitCadence(speed, rigScale),
    clock: sceneAnim(b).clock,
    seen: sceneAnim(b).clock,
    stride: 0,
    moving: false,
    pose: newSwingPose(),
    face,
    blink: newBlinkClock(e.id),
    headRoll: face?.head?.rotation.z ?? 0,
    squintT: 0,
    recoilX: 0,
    recoilZ: 0,
    recoilAt: -Infinity,
    jigX: 0,
    jigZ: 0,
    frozen: false,
    ice: null,
    dropDelay: drops(view) ? dropDelay(index, e.deployTimer) : 0,
    landed: !drops(view),
  };
  return anim;
}

/** Shared translucent ice for frozen units (never disposed per unit). */
let iceMat: THREE.MeshToonMaterial | null = null;

function iceMaterial(): THREE.MeshToonMaterial {
  if (!iceMat) {
    iceMat = toon(0xa8ecff);
    iceMat.map = null;
    iceMat.transparent = true;
    iceMat.opacity = 0.5;
    iceMat.depthWrite = false;
    iceMat.emissive.setRGB(0.1, 0.3, 0.4);
    iceMat.userData.shared = true;
  }
  return iceMat;
}

/** A thin ice hull over the body: each sizeable part, scaled 1.06 in place. */
function buildIceShell(rig: TroopRig): THREE.Object3D[] {
  const parts: THREE.Mesh[] = [];
  rig.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name === "outline" || o.name === "ice") return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const r = (geo.boundingSphere?.radius ?? 0) * Math.max(o.scale.x, o.scale.y, o.scale.z);
    if (r >= 0.1) parts.push(mesh);
  });
  const mat = iceMaterial();
  return parts.map((m) => {
    const shell = new THREE.Mesh(m.geometry, mat);
    shell.name = "ice";
    shell.scale.setScalar(1.06);
    shell.renderOrder = 2;
    m.add(shell);
    return shell;
  });
}

function insideFreeze(s: SceneAnim, e: Entity, now: number): boolean {
  for (const z of s.freezes) {
    if (now < z.start || now >= z.until) continue;
    const dx = e.x - z.x;
    const dy = e.y - z.y;
    const r = z.r + e.radius;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/**
 * A stunned troop reads as frozen only inside a Freeze spell tracked from
 * its 'spell' event. The stun timer alone can't tell: an Electro Wizard
 * bolt stuns for a full second too, and must daze, not ice over.
 */
export function isFrozen(b: Battle3D, e: Entity): boolean {
  if (e.kind !== "troop" || e.stunTimer <= 0) return false;
  return insideFreeze(sceneAnim(b), e, b.syncState.time);
}

/** Show or hide the ice hull as `frozen` flips; a thaw bursts into shards. */
export function setFrozen(b: Battle3D, anim: TroopAnim, rig: TroopRig, e: Entity, frozen: boolean): void {
  if (frozen === anim.frozen) return;
  anim.frozen = frozen;
  if (frozen && !anim.ice) anim.ice = buildIceShell(rig);
  if (anim.ice) for (const m of anim.ice) m.visible = frozen;
  // Thaw: the ice cracks off in a burst of shards.
  if (!frozen) b.fx.emit("chips", e.x, e.y, { count: 6, color: 0xcff4ff, radius: 0.45 });
}

/** Camera kick that honours the reduced-motion preference. */
function shake(b: Battle3D, amount: number): void {
  if (!reducedMotion()) addShake(b, amount);
}

/**
 * The shared per-frame update for every entity view (troops, buildings and
 * towers): placement, entrance, hit feedback, status sprites and the HP bar,
 * then the rig or glTF animation for troops. `alpha` is the fraction of a
 * sim tick elapsed since `b.syncState` (positions blend between the last
 * two ticks by it). Tower-only work follows in updateTower.
 */
export function updateTroop(b: Battle3D, view: EntityView, e: Entity, dt: number, alpha: number): void {
  const state = b.syncState;
  const sa = sceneAnim(b);
  sa.clock = animClock(sa.clock, state.time, alpha, b.hitStop.active);
  const w = toWorld(e.x, e.y);
  VIEW_OF.set(e, view);

  if (view.isTroop && !view.anim) view.anim = initTroopAnim(b, view, e);
  const anim = view.anim;
  // Tower crews fire (towers.ts animates them without knowing a card).
  if (view.defender && !rigArchetype(view.defender)) setRigArchetype(view.defender, TOWER_ARCHETYPE);

  // Smooth placement between sim ticks; long jumps snap, shoves ease.
  const maxStep = Math.max(0.12, e.speed * SIM_DT * RAGE_BOOST * 2.2);
  const drawnX = view.drawnX ?? w.x;
  const drawnZ = view.drawnZ ?? w.z;
  const sample = pushSample(view, w.x, w.z, state.time, maxStep);
  sampleTrack(view, alpha, dt, POS);
  // A leaper that teleported a long way (Mega Knight jump): arc it through
  // the air from where it was drawn and slam the ground where it lands.
  if (
    sample === "snap" &&
    e.cardId === "mega-knight" &&
    view.spawnT >= SPAWN_POP_TIME &&
    Math.hypot(w.x - drawnX, w.z - drawnZ) > 1.4
  ) {
    view.hopT = HOP_TIME;
    view.hopFromX = drawnX;
    view.hopFromZ = drawnZ;
    megaSlam(b, e.x, e.y);
  }
  view.root.position.x = POS.x;
  view.root.position.z = POS.z;

  // Deploy name tag: readable for two seconds, then it shrinks away so
  // a crowded field shows troops, not captions.
  if (view.label) {
    view.labelAge = (view.labelAge ?? 0) + dt;
    const k = Math.max(0, 1 - Math.max(0, view.labelAge - 2) / 0.35);
    view.label.scale.set(1.7 * k, 0.42 * k, 1);
    if (k === 0) {
      view.label.visible = false;
      view.label = undefined;
    }
  }

  // Entrance: risers climb out of the ground, the Mega Knight plummets,
  // everyone else drops in from just overhead.
  const baseScale = view.baseScale ?? 1;
  let dropY = 0;
  let dsx = 1;
  let dsy = 1;
  let dsz = 1;
  if (anim && drops(view)) {
    const total = dropDuration(anim.dropDelay);
    if (view.spawnT < total) {
      const before = view.spawnT;
      view.spawnT = Math.min(total, view.spawnT + dt);
      dropPose(view.spawnT, anim.dropDelay, DROP);
      view.root.visible = DROP.visible;
      dropY = DROP.y;
      dsx = DROP.sx;
      dsy = DROP.sy;
      dsz = DROP.sz;
      const landAt = anim.dropDelay + DROP_FALL;
      if (!anim.landed && before < landAt && view.spawnT >= landAt) {
        anim.landed = true;
        const color = view.spawnColor ?? 0xd9cdb8;
        const burst = view.spawnBurst ?? 0.45;
        b.fx.emit("dust", e.x, e.y, { radius: burst, color });
        contactRing(b, e.x, e.y, Math.min(0.85, burst + e.radius * 0.4), color);
        if (anim.arch.weight === "heavy") shake(b, 0.14);
      }
    } else if (!view.root.visible) {
      view.root.visible = true;
    }
  } else if (view.spawnT < SPAWN_POP_TIME) {
    view.spawnT += dt;
    const f = Math.min(1, view.spawnT / SPAWN_POP_TIME);
    if (view.spawnStyle === "rise") {
      view.root.position.y = -1.0 * (1 - f) * (1 - f);
      view.root.scale.setScalar(baseScale);
    } else if (view.spawnStyle === "slam") {
      // Plummet from the sky, accelerating into a ground-shaking landing.
      view.root.position.y = 8 * (1 - f * f);
      view.root.scale.setScalar(baseScale);
    } else {
      view.root.scale.setScalar(Math.max(0.05, easeOutBack(f) * baseScale));
    }
  } else if (!(view.hopT && view.hopT > 0) && view.root.position.y !== 0) {
    view.root.position.y = 0;
  }

  // Leap arc: sail from the launch point to the landing on a parabola.
  if (view.hopT && view.hopT > 0) {
    view.hopT -= dt;
    const f = Math.min(1, 1 - Math.max(0, view.hopT) / HOP_TIME);
    view.root.position.x = (view.hopFromX ?? w.x) + (w.x - (view.hopFromX ?? w.x)) * f;
    view.root.position.z = (view.hopFromZ ?? w.z) + (w.z - (view.hopFromZ ?? w.z)) * f;
    view.root.position.y = Math.sin(f * Math.PI) * 2.4;
  }

  // A landed blow: flash, squint, and a recoil away from the attacker.
  const lost = view.lastHp - e.hp;
  if (lost > 0.5) {
    view.flashT = FLASH_TIME;
    // Troops recoil bodily; towers/buildings show damage other ways
    // (and deployed buildings decay every tick, which is not a "hit").
    if (e.kind === "troop") {
      view.hitT = HIT_JIGGLE_TIME;
      if (anim) {
        anim.squintT = SQUINT_TIME;
        const fresh = state.time - anim.recoilAt <= RECOIL_FRESH;
        anim.jigX = fresh ? anim.recoilX : 0;
        anim.jigZ = fresh ? anim.recoilZ : 0;
      }
    }
    // Masonry chips fly off towers with every real hit.
    if (e.kind === "princess-tower" || e.kind === "king-tower") {
      emitSparks(b, e.x, e.y, 1.6, 3, 3.2, 1.3, 0x9b8d7b, 0.09, 0.45);
    }
  }
  view.lastHp = e.hp;
  view.hitT = Math.max(0, (view.hitT ?? 0) - dt);
  const hitK = view.hitT > 0 ? view.hitT / HIT_JIGGLE_TIME : 0;
  // Squash springs out and back; the tilt and shove snap away and ease home.
  const jig = hitK > 0 ? Math.sin(hitK * Math.PI) : 0;
  const recoil = hitK * hitK * (3 - 2 * hitK);

  // Deploy freeze countdown: a white ring shrinking around the unit's
  // feet so the "why isn't it moving yet" second reads as a timer.
  if (e.kind === "troop") {
    if (e.deployTimer > 0) {
      if (!view.deployRing) {
        view.deployRing = new THREE.Mesh(
          new THREE.RingGeometry(0.78, 0.92, 28),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        view.deployRing.rotation.x = -Math.PI / 2;
        view.deployRing.position.y = 0.035;
        view.root.add(view.deployRing);
      }
      view.deployRing.visible = true;
      const f = Math.max(0.05, e.deployTimer / DEPLOY_DELAY);
      view.deployRing.scale.setScalar((0.5 + 0.9 * f) * (e.radius / 0.5));
      (view.deployRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * f;
    } else if (view.deployRing) {
      view.deployRing.visible = false;
    }
  }

  // Floating combat text, batched so swarms don't spam numbers.
  if (lost > 0.5) view.pendingDmg = (view.pendingDmg ?? 0) + lost;
  view.popupT = Math.max(0, (view.popupT ?? 0) - dt);
  if ((view.pendingDmg ?? 0) > 0 && view.popupT === 0) {
    const label = damageLabel(view.pendingDmg!);
    view.pendingDmg = 0;
    view.popupT = 0.35;
    if (label) {
      const lift = view.rig
        ? (view.rig.hover ?? 0) + view.rig.height
        : e.kind === "building"
          ? 1.2
          : 2.4;
      damagePopup(b, w.x, lift, w.z, label);
    }
  }

  // Status: stunned units daze, frozen ones turn to ice, slowed ones tint.
  const stunned = e.kind === "troop" && e.stunTimer > 0;
  const frozen = isFrozen(b, e);
  const slowed = e.kind === "troop" && e.slowTimer > 0;
  if (anim && view.rig) setFrozen(b, anim, view.rig, e, frozen);

  // Emissive glow chain: damage flash > frozen > rage pink > charge gold > slow.
  const raged = e.kind === "troop" && isRaged(state, e);
  const charging = e.chargeDistance > 0 && e.chargeProgress >= e.chargeDistance;
  if (view.flashT > 0) {
    const fresh = view.flashT === FLASH_TIME; // the blow landed this frame
    view.flashT = Math.max(0, view.flashT - dt);
    if (fresh) {
      // One frame of pure white sells the impact...
      for (const f of view.flashMats) f.mat.emissive.setRGB(1, 1, 1);
    } else {
      // ...then a warm glow that dies away.
      const k = view.flashT / FLASH_TIME;
      for (const f of view.flashMats) {
        f.mat.emissive.setRGB(FLASH_WARM[0] * k, FLASH_WARM[1] * k, FLASH_WARM[2] * k);
      }
    }
    view.glowing = true;
  } else if (frozen) {
    for (const f of view.flashMats) f.mat.emissive.setRGB(FROZEN_TINT[0], FROZEN_TINT[1], FROZEN_TINT[2]);
    view.glowing = true;
  } else if (raged) {
    const pulse = 0.32 + Math.sin(state.time * 9) * 0.1;
    for (const f of view.flashMats) f.mat.emissive.setRGB(pulse, 0.05, 0.18);
    view.glowing = true;
  } else if (charging) {
    const k = 0.25 + Math.sin(state.time * 14) * 0.12;
    for (const f of view.flashMats) f.mat.emissive.setRGB(k, k * 0.75, 0);
    view.glowing = true;
  } else if (slowed) {
    for (const f of view.flashMats) f.mat.emissive.setRGB(SLOW_TINT[0], SLOW_TINT[1], SLOW_TINT[2]);
    view.glowing = true;
  } else if (view.glowing) {
    for (const f of view.flashMats) f.mat.emissive.setHex(f.orig);
    view.glowing = false;
  }

  // Seeing stars while stunned (an iced unit is past seeing anything).
  if (stunned && !frozen) {
    if (!view.stunStars) {
      view.stunStars = makeStunSprite();
      const lift = view.rig ? (view.rig.hover ?? 0) + view.rig.height : 1.4;
      view.stunStars.position.y = lift + 0.35;
      view.root.add(view.stunStars);
    }
    view.stunStars.visible = true;
    view.stunStars.material.rotation = state.time * 4;
  } else if (view.stunStars) {
    view.stunStars.visible = false;
  }

  const barWidth =
    e.kind === "troop" ? 0.9 : e.kind === "building" ? 1.4 : e.kind === "king-tower" ? 2.2 : 1.8;
  setHpFill(view, e.hp / e.maxHp, barWidth);
  view.hpGroup.visible = hpBarVisible(view, e);

  if (view.rig && anim) {
    const rig = view.rig;
    const target = targetOf(b, e);
    const inRange =
      !!target &&
      distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
    const walking = !inRange && e.deployTimer <= 0 && !stunned;

    // Per-view time runs with the shared clock, except while stunned:
    // the whole body (legs, breathing, attack) holds its pose.
    const step = Math.min(0.25, Math.max(0, sa.clock - anim.seen));
    anim.seen = sa.clock;
    if (!stunned) {
      anim.clock += step;
      if (walking && !anim.moving) anim.stride = 0; // start from a neutral stance
      anim.moving = walking;
      const pace = (slowed ? 0.5 : 1) * (raged ? RAGE_BOOST : 1);
      if (walking) anim.stride += step * anim.cadence * pace;
      // Blend the attack timer forward by alpha so the swing is 60 Hz smooth.
      const cd = e.cooldown - clampAlpha(alpha) * SIM_DT * pace;
      swingCurve(cd, e.hitSpeed, inRange && e.deployTimer <= 0, anim.arch.attackStyle, anim.pose);
      anim.squintT = Math.max(0, anim.squintT - dt);
    }
    animateTroop(rig, {
      moving: anim.moving,
      swing: anim.pose.swing,
      windup: anim.pose.windup,
      ready: anim.pose.ready,
      time: anim.clock,
      phase: e.id * 1.7,
      charging,
      style: anim.arch.attackStyle,
      weight: anim.arch.weight,
      quad: anim.arch.quad,
      stride: anim.stride,
    });

    if (anim.face) {
      if (!stunned) {
        poseFace(anim.face, {
          blink: blinkShut(anim.blink, anim.clock),
          squint: anim.squintT / SQUINT_TIME,
          anger: anim.pose.windup,
          ko: false,
        });
      }
      // Dazed: the head lolls in a slow circle (frozen heads don't).
      if (anim.face.head) {
        anim.face.head.rotation.z =
          anim.headRoll + (stunned && !frozen ? Math.sin(sa.clock * Math.PI * 3) * 0.2 : 0);
      }
    } else if (stunned && !frozen) {
      rig.group.rotation.z += Math.sin(sa.clock * Math.PI * 3) * 0.1;
    }

    // Layer the entrance and the hit reaction on top of the pose.
    const sx = dsx * (1 + 0.1 * jig);
    const sy = dsy * (1 - 0.14 * jig);
    const sz = dsz * (1 + 0.1 * jig);
    if (sx !== 1 || sy !== 1 || sz !== 1) {
      rig.group.scale.x *= sx;
      rig.group.scale.y *= sy;
      rig.group.scale.z *= sz;
    }
    rig.group.position.y += dropY;
    if (recoil > 0 && (anim.jigX !== 0 || anim.jigZ !== 0)) {
      // Tip away from the attacker: the blow's direction in the body's frame.
      const yaw = view.root.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const lx = anim.jigX * c - anim.jigZ * s;
      const lz = anim.jigX * s + anim.jigZ * c;
      const tilt = RECOIL_TILT[anim.arch.weight] * recoil;
      rig.group.rotation.x += tilt * lz;
      rig.group.rotation.z -= tilt * lx;
      view.root.position.x += anim.jigX * RECOIL_KNOCK * recoil;
      view.root.position.z += anim.jigZ * RECOIL_KNOCK * recoil;
    }

    // Flyer blob shadow tracks the bob; walkers kick up dust.
    if (view.blobShadow && rig.hover) {
      const sh = blobShadowScale(rig.hover, rig.group.position.y);
      view.blobShadow.scale.setScalar(sh);
    }
    if (!rig.hover && walking) {
      view.dustT = (view.dustT ?? Math.random() * DUST_INTERVAL) - dt;
      if (view.dustT <= 0) {
        view.dustT = DUST_INTERVAL;
        b.fx.emit("dust", e.x, e.y);
      }
    }
    // Face the attack target, or the spot being walked toward —
    // turning smoothly rather than snapping (frozen units can't turn).
    if (!stunned) turnToward(view, e, target, inRange, w, dt);
  } else if (view.glb) {
    // Real glTF model: drive its mixer + clip from the same combat state.
    const target = targetOf(b, e);
    const inRange =
      !!target &&
      distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
    const moving = !inRange && e.deployTimer <= 0 && !stunned;
    glbModels()!.playGlbAction(view.glb, inRange ? "attack" : moving ? "walk" : "idle");
    if (!stunned) view.glb.mixer.update(dt);
    if (anim && drops(view)) {
      view.root.position.y = dropY;
      view.root.scale.set(dsx * (1 + 0.1 * jig), dsy * (1 - 0.14 * jig), dsz * (1 + 0.1 * jig));
    }

    if (moving) {
      view.dustT = (view.dustT ?? Math.random() * DUST_INTERVAL) - dt;
      if (view.dustT <= 0) {
        view.dustT = DUST_INTERVAL;
        b.fx.emit("dust", e.x, e.y);
      }
    }
    if (!stunned) turnToward(view, e, target, inRange, w, dt);
  } else if (view.defender && view.defender.group) {
    // Tower crews blink too.
    const face = faceOf(view.defender.group);
    if (face) {
      let clock = DEFENDER_BLINKS.get(view.defender);
      if (!clock) {
        clock = newBlinkClock(e.id);
        DEFENDER_BLINKS.set(view.defender, clock);
      }
      poseFace(face, { blink: blinkShut(clock, sa.clock), squint: 0, anger: 0, ko: false });
    }
  }
}

const DEFENDER_BLINKS = new WeakMap<TroopRig, BlinkClock>();

/** Ease the unit's yaw toward its target, or the spot it walks toward. */
function turnToward(
  view: EntityView,
  e: Entity,
  target: Entity | undefined,
  inRange: boolean,
  w: { x: number; z: number },
  dt: number,
): void {
  let targetYaw: number | null = null;
  if (target) {
    const goal = inRange ? target : moveGoal(e, target);
    const gw = toWorld(goal.x, goal.y);
    if (Math.hypot(gw.x - w.x, gw.z - w.z) > 1e-3) {
      targetYaw = Math.atan2(gw.x - w.x, gw.z - w.z);
    }
  } else {
    targetYaw = e.side === "player" ? Math.PI : 0;
  }
  if (targetYaw !== null) {
    const cur = view.root.rotation.y;
    let delta = targetYaw - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    view.root.rotation.y = cur + delta * Math.min(1, dt * 10);
  }
}

/** A dying entity's motion, `f` running 0 -> 1 over its death time. */
export function updateTroopDeath(d: DyingView, f: number, dt: number): void {
  if (d.anim) {
    stepDeath(d.anim, d.view.root, f * d.duration, dt);
    return;
  }
  const ease = f * f;
  d.view.root.rotation.z = d.topple * ease;
  d.view.root.rotation.y += dt * 7 * Math.sign(d.topple);
  d.view.root.position.y = Math.sin(Math.min(1, f * 1.5) * Math.PI) * 0.45 - 0.5 * ease;
}

/** Point a living troop's recoil away from (fromX, fromY), arena tiles. */
function setRecoil(e: Entity, fromX: number, fromY: number, at: number): void {
  const anim = VIEW_OF.get(e)?.anim;
  if (!anim) return;
  const dx = e.x - fromX;
  const dy = e.y - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-3) return;
  // Arena x/y map straight onto world x/z (toWorld only shifts the origin).
  anim.recoilX = dx / len;
  anim.recoilZ = dy / len;
  anim.recoilAt = at;
}

/**
 * Gameplay events seen by the unit views: a landed melee blow kicks the
 * camera (heavies) and holds a render-only hit-stop; every attack marks
 * its victim's recoil direction; spells push recoil outward and freezes
 * are remembered for the ice pose.
 */
export function viewsOnEvent(b: Battle3D, ev: BattleEvent): void {
  if (!b.syncState) return;
  const now = b.syncState.time;
  if (ev.type === "spell") {
    const card = getCard(ev.cardId);
    if (card.kind !== "spell") return;
    if (ev.cardId === "freeze") {
      const s = sceneAnim(b);
      s.freezes = s.freezes.filter((z) => z.until > now && z.start <= now);
      s.freezes.push({ x: ev.x, y: ev.y, r: card.radius, start: now, until: now + card.stunSeconds });
    }
    if (card.damage > 0 || card.knockback > 0) {
      // Everyone caught in the blast reels away from its centre.
      for (const e of b.byId.values()) {
        if (e.kind !== "troop" || e.side === ev.side) continue;
        const dx = e.x - ev.x;
        const dy = e.y - ev.y;
        if (dx * dx + dy * dy <= (card.radius + e.radius) ** 2) {
          setRecoil(e, ev.x, ev.y, now);
        }
      }
    }
    return;
  }
  if (ev.type !== "attack") return;

  // The victim is whoever stands nearest the struck point.
  let victim: Entity | undefined;
  let best = Infinity;
  for (const e of b.byId.values()) {
    if (e.kind !== "troop") continue;
    const dx = e.x - ev.targetX;
    const dy = e.y - ev.targetY;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      victim = e;
    }
  }
  if (victim && best <= (victim.radius + 0.6) ** 2) {
    setRecoil(victim, ev.x, ev.y, now);
  }

  if (ev.ranged) return;
  const s = impactStyle(ev.cardId);
  if (s.trauma > 0) shake(b, s.trauma);
  if (
    ev.cardId === "pekka" ||
    ev.cardId === "mega-knight" ||
    ev.cardId === "giant" ||
    ev.cardId === "prince"
  ) {
    b.hitStop.punch(0.055);
  }
  // A whirling blade sweeps a ring around the spinner.
  const arch = archetypeFor(ev.cardId, { arabic: ARABIC });
  if (ev.cardId && arch.attackStyle === "spin") {
    const card = getCard(ev.cardId);
    const radius = card.kind === "spell" ? 1 : Math.max(0.8, card.unit.splashRadius);
    b.fx.emit("ring", ev.x, ev.y, { radius });
  }
}
