/**
 * Per-frame unit animation: spawn entrances, leaps, hit jiggle, damage
 * flashes and numbers, status sprites, HP bars, rig/glTF locomotion and
 * facing, plus the knockout animation when a unit leaves the field.
 */
import * as THREE from "three";
import { DEPLOY_DELAY, distance, type BattleEvent, type Entity } from "../../../game/battle";
import { isRaged, moveGoal } from "../../../game/sim";
import { animateTroop } from "../../characters3d";
import { playGlbAction } from "../../glbModels";
import { damageLabel } from "../../popups";
import { blobShadowScale, DUST_INTERVAL } from "../../ground";
import { impactStyle } from "../../impactfx";
import type { Battle3D } from "../../scene3d";
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
import { damagePopup, emitSparks, megaSlam } from "../fx/effects";
import { hpBarVisible, makeStunSprite, setHpFill } from "./troops";

/**
 * Signed attack swing (animation principles): the arm cocks back as
 * the next blow approaches (negative = anticipation), sweeps forward
 * at the hit (1 -> 0), and dips past rest in a follow-through before
 * settling.
 */
export function attackSwing(e: Entity, engaged: boolean): number {
  if (e.hitSpeed <= 0) return 0;
  if (e.cooldown > e.hitSpeed - 0.3) {
    const p = (e.cooldown - (e.hitSpeed - 0.3)) / 0.3; // 1 at hit -> 0
    if (p > 0.25) return (p - 0.25) / 0.75;
    return -Math.sin((p / 0.25) * Math.PI) * 0.22; // follow-through dip
  }
  if (engaged && e.cooldown < 0.26 && e.cooldown > 0) {
    const w = 1 - e.cooldown / 0.26;
    return -0.7 * w * w; // deep ease-in wind-up telegraphs the blow
  }
  return 0;
}

/** Start the topple/sink-and-fade animation for a removed entity. */
export function beginDeath(b: Battle3D, view: EntityView): void {
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
      mat.transparent = true;
      fadeMats.push(mat);
    }
  });
  b.dying.push({
    view,
    t: 0,
    duration: view.isTroop ? TROOP_DEATH_TIME : TOWER_DEATH_TIME,
    topple: view.isTroop ? (view.root.position.x > 0 ? 1.35 : -1.35) : 0.12,
    fadeMats,
  });
}

/**
 * The shared per-frame update for every entity view (troops, buildings and
 * towers): placement, entrance, hit feedback, status sprites and the HP bar,
 * then the rig or glTF animation for troops. `alpha` is the render
 * interpolation fraction between sim ticks (reserved; positions are not
 * interpolated yet). Tower-only work follows in updateTower.
 */
export function updateTroop(b: Battle3D, view: EntityView, e: Entity, dt: number, _alpha: number): void {
  const w = toWorld(e.x, e.y);
  // A leaper that teleported a long way this frame (Mega Knight jump):
  // arc it through the air and slam the ground where it lands.
  if (
    e.cardId === "mega-knight" &&
    view.spawnT >= SPAWN_POP_TIME &&
    Math.hypot(w.x - view.root.position.x, w.z - view.root.position.z) > 1.4
  ) {
    view.hopT = HOP_TIME;
    view.hopFromX = view.root.position.x;
    view.hopFromZ = view.root.position.z;
    megaSlam(b, e.x, e.y);
  }
  view.root.position.x = w.x;
  view.root.position.z = w.z;

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

  // Spawn entrance: rise out of the ground, or pop-in bounce.
  const baseScale = view.baseScale ?? 1;
  if (view.spawnT < SPAWN_POP_TIME) {
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
  } else {
    // Take-a-hit jiggle: a fast squash (short + wide) that springs back —
    // every landed blow visibly deforms the victim, not just a flash.
    view.hitT = Math.max(0, (view.hitT ?? 0) - dt);
    const j =
      view.hitT > 0 ? Math.sin((view.hitT / HIT_JIGGLE_TIME) * Math.PI) : 0;
    if (j > 0) {
      view.root.scale.set(
        baseScale * (1 + 0.1 * j),
        baseScale * (1 - 0.14 * j),
        baseScale * (1 + 0.1 * j),
      );
    } else if (view.root.scale.x !== baseScale) {
      view.root.scale.setScalar(baseScale);
    }
    if (!(view.hopT && view.hopT > 0) && view.root.position.y !== 0) {
      view.root.position.y = 0;
    }
  }

  // Leap arc: sail from the launch point to the landing on a parabola.
  if (view.hopT && view.hopT > 0) {
    view.hopT -= dt;
    const f = Math.min(1, 1 - Math.max(0, view.hopT) / HOP_TIME);
    view.root.position.x = (view.hopFromX ?? w.x) + (w.x - (view.hopFromX ?? w.x)) * f;
    view.root.position.z = (view.hopFromZ ?? w.z) + (w.z - (view.hopFromZ ?? w.z)) * f;
    view.root.position.y = Math.sin(f * Math.PI) * 2.4;
  }

  // Emissive glow chain: damage flash > rage pink > charge gold.
  const lost = view.lastHp - e.hp;
  if (lost > 0.5) {
    view.flashT = FLASH_TIME;
    // Troops recoil bodily; towers/buildings show damage other ways
    // (and deployed buildings decay every tick, which is not a "hit").
    if (e.kind === "troop") view.hitT = HIT_JIGGLE_TIME;
    // Masonry chips fly off towers with every real hit.
    if (e.kind === "princess-tower" || e.kind === "king-tower") {
      emitSparks(b, e.x, e.y, 1.6, 3, 3.2, 1.3, 0x9b8d7b, 0.09, 0.45);
    }
  }
  view.lastHp = e.hp;

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
  const raged = e.kind === "troop" && isRaged(b.syncState, e);
  const charging = e.chargeDistance > 0 && e.chargeProgress >= e.chargeDistance;
  if (view.flashT > 0) {
    view.flashT = Math.max(0, view.flashT - dt);
    const k = view.flashT / FLASH_TIME;
    for (const f of view.flashMats) f.mat.emissive.setRGB(k, k, k);
    view.glowing = true;
  } else if (raged) {
    const pulse = 0.32 + Math.sin(b.syncState.time * 9) * 0.1;
    for (const f of view.flashMats) f.mat.emissive.setRGB(pulse, 0.05, 0.18);
    view.glowing = true;
  } else if (charging) {
    const k = 0.25 + Math.sin(b.syncState.time * 14) * 0.12;
    for (const f of view.flashMats) f.mat.emissive.setRGB(k, k * 0.75, 0);
    view.glowing = true;
  } else if (view.glowing) {
    for (const f of view.flashMats) f.mat.emissive.setHex(f.orig);
    view.glowing = false;
  }

  // Seeing stars while stunned.
  if (e.stunTimer > 0 && e.kind === "troop") {
    if (!view.stunStars) {
      view.stunStars = makeStunSprite();
      const lift = view.rig ? (view.rig.hover ?? 0) + view.rig.height : 1.4;
      view.stunStars.position.y = lift + 0.35;
      view.root.add(view.stunStars);
    }
    view.stunStars.visible = true;
    view.stunStars.material.rotation = b.syncState.time * 4;
  } else if (view.stunStars) {
    view.stunStars.visible = false;
  }


  const barWidth =
    e.kind === "troop" ? 0.9 : e.kind === "building" ? 1.4 : e.kind === "king-tower" ? 2.2 : 1.8;
  setHpFill(view, e.hp / e.maxHp, barWidth);
  view.hpGroup.visible = hpBarVisible(view, e);

  if (view.rig) {
    const target = targetOf(b, e);
    const inRange =
      !!target &&
      distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
    const swing = attackSwing(e, inRange);
    const moving = !inRange && e.deployTimer <= 0;
    animateTroop(view.rig, {
      moving,
      swing,
      time: b.syncState.time,
      phase: e.id * 1.7,
      charging,
    });

    // Flyer blob shadow tracks the bob; walkers kick up dust.
    if (view.blobShadow && view.rig.hover) {
      const s = blobShadowScale(view.rig.hover, view.rig.group.position.y);
      view.blobShadow.scale.setScalar(s);
    }
    if (!view.rig.hover && moving && e.stunTimer <= 0) {
      view.dustT = (view.dustT ?? Math.random() * DUST_INTERVAL) - dt;
      if (view.dustT <= 0) {
        view.dustT = DUST_INTERVAL;
        b.fx.emit("dust", e.x, e.y);
      }
    }
    // Face the attack target, or the spot being walked toward —
    // turning smoothly rather than snapping.
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
  } else if (view.glb) {
    // Real glTF model: drive its mixer + clip from the same combat state.
    const target = targetOf(b, e);
    const inRange =
      !!target &&
      distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
    const moving = !inRange && e.deployTimer <= 0;
    playGlbAction(view.glb, inRange ? "attack" : moving ? "walk" : "idle");
    view.glb.mixer.update(dt);

    if (moving && e.stunTimer <= 0) {
      view.dustT = (view.dustT ?? Math.random() * DUST_INTERVAL) - dt;
      if (view.dustT <= 0) {
        view.dustT = DUST_INTERVAL;
        b.fx.emit("dust", e.x, e.y);
      }
    }

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
}

/** A dying troop's knockout, `f` running 0 -> 1 over its death time. */
export function updateTroopDeath(d: DyingView, f: number, dt: number): void {
  const ease = f * f;
  d.view.root.rotation.z = d.topple * ease;
  // Cartoon knockout: a little launch upward with a half-spin,
  // then crumple through the floor while fading.
  d.view.root.rotation.y += dt * 7 * Math.sign(d.topple);
  d.view.root.position.y =
    Math.sin(Math.min(1, f * 1.5) * Math.PI) * 0.45 - 0.5 * ease;
}

/**
 * How a landed melee blow reacts beyond its sparks: a heavy bruiser kicks
 * the camera, and a render-only hit-stop that never touches the sim clock.
 */
export function viewsOnEvent(b: Battle3D, ev: BattleEvent): void {
  if (ev.type !== "attack" || ev.ranged) return;
  const s = impactStyle(ev.cardId);
  if (s.trauma > 0) addShake(b, s.trauma);
  if (
    ev.cardId === "pekka" ||
    ev.cardId === "mega-knight" ||
    ev.cardId === "giant" ||
    ev.cardId === "prince"
  ) {
    b.hitStop.punch(0.055);
  }
}
