/**
 * The legacy FX library: blasts, puffs, rings, spell set-pieces, popups,
 * crowns, death scatter, the pooled hit sparks and sim projectile meshes,
 * plus fxOnEvent, which turns battle events into these effects.
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { BattleEvent, BattleState, Entity } from "../../../game/battle";
import { toon } from "../../characters3d";
import { deathStyle } from "../../deathfx";
import { impactStyle } from "../../impactfx";
import { projectileStyle } from "../../projectiles";
import type { Battle3D } from "../../scene3d";
import {
  GAME_FONT,
  LOOK_AT,
  PREV_POS,
  disposeDeep,
  toWorld,
  unlitGlow,
  type EntityView,
} from "../common";
import { addShake } from "../camera";

// Hit-spark pool: one InstancedMesh, reused scratch objects (no per-frame
// allocation — see the three-best-practices skill).
export const PARTICLE_CAP = 320;
const SPARK_GRAVITY = 7;
const SPARK_M = new THREE.Matrix4();
const SPARK_POS = new THREE.Vector3();
const SPARK_SCALE = new THREE.Vector3();
const SPARK_QUAT = new THREE.Quaternion();
const SPARK_COLOR = new THREE.Color();

export function blast(b: Battle3D, ax: number, ay: number, radius: number, color: number, delay = 0): void {
  const w = toWorld(ax, ay);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  );
  ball.position.set(w.x, 0.4, w.z);
  b.addEffect(
    ball,
    0.5,
    (frac) => {
      ball.scale.setScalar(0.3 + (1 - frac) * radius);
      (ball.material as THREE.MeshBasicMaterial).opacity = 0.55 * frac;
    },
    delay,
  );
  // Expanding ground ring for readability.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(w.x, 0.04, w.z);
  b.addEffect(
    ring,
    0.45,
    (frac) => {
      ring.scale.setScalar(0.3 + (1 - frac) * radius * 1.15);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * frac;
    },
    delay,
  );
}

export function puff(b: Battle3D, ax: number, ay: number, color: number, size = 0.5, lift = 0): void {
  const w = toWorld(ax, ay);
  const group = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 * size + 0.05 * i, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    s.position.set((i % 2 ? 1 : -1) * 0.15 * i, 0.2 + 0.12 * i, (i > 1 ? 1 : -1) * 0.12);
    group.add(s);
  }
  group.position.set(w.x, 0.1 + lift, w.z);
  b.addEffect(group, 0.45, (frac) => {
    group.scale.setScalar(1 + (1 - frac) * 1.6);
    group.position.y = 0.1 + lift + (1 - frac) * 0.5;
    for (const child of group.children) {
      ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * frac;
    }
  });
}

/** Fast, low contact ring for melee readability without obscuring units. */
export function contactRing(b: Battle3D, ax: number, ay: number, radius: number, color: number): void {
  if (radius <= 0) return;
  const w = toWorld(ax, ay);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 1, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(w.x, 0.055, w.z);
  b.addEffect(ring, 0.24, (frac) => {
    ring.scale.setScalar(radius * (1.15 - frac * 0.8));
    (ring.material as THREE.MeshBasicMaterial).opacity = frac * 0.75;
  });
}

/** A small arrow-shaped missile oriented along its flight path. */
export function makeArrow(color: number, length = 0.7): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, length, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.24, 8),
    new THREE.MeshBasicMaterial({ color: 0x37474f }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = length / 2;
  g.add(tip);
  return g;
}

/** A projectile streaking from attacker to target. */
/** Muzzle flash at fire time; the shot itself is sim-driven now. */
export function projectile(b: Battle3D, ev: Extract<BattleEvent, { type: "attack" }>): void {
  const style = projectileStyle(ev.cardId, ev.kind);
  if (!style.muzzleFlash) return;
  const from = toWorld(ev.x, ev.y);
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true }),
  );
  (flash.material as THREE.MeshBasicMaterial).toneMapped = false; // stays hot
  flash.position.set(from.x, ev.kind === "troop" ? 0.9 : 1.6, from.z);
  b.addEffect(flash, 0.1, (frac) => {
    flash.scale.setScalar(1 + (1 - frac) * 1.8);
    (flash.material as THREE.MeshBasicMaterial).opacity = frac;
  });
}

/** Mirror the sim's in-flight projectiles as meshes. */
export function syncProjectiles(b: Battle3D, state: BattleState): void {
  const seen = b.projSeen;
  seen.clear();
  for (const p of state.projectiles) {
    seen.add(p.id);
    let view = b.projViews.get(p.id);
    if (!view) {
      const style = projectileStyle(p.cardId, p.sourceKind, p.towerTroop ?? null);
      if (style.form === "arrow") {
        view = makeArrow(style.color);
      } else {
        const mat = style.glow
          ? unlitGlow(style.color)
          : new THREE.MeshBasicMaterial({ color: style.color });
        const orb = new THREE.Mesh(new THREE.SphereGeometry(style.size, 8, 6), mat);
        view = orb;
      }
      if (style.trail !== "none") {
        const trailLength =
          style.trail === "electric" ? 1.15 : style.trail === "embers" ? 0.8 : 0.62;
        const trail = new THREE.Mesh(
          new THREE.ConeGeometry(style.form === "arrow" ? 0.045 : style.size * 0.72, trailLength, 8),
          new THREE.MeshBasicMaterial({
            color: style.color,
            transparent: true,
            opacity: style.trail === "electric" ? 0.8 : 0.48,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        trail.rotation.x = -Math.PI / 2;
        trail.position.z = -trailLength * 0.55;
        view.add(trail);
      }
      view.userData.impactColor = style.impactColor;
      b.scene.add(view);
      b.projViews.set(p.id, view);
    }
    // Arc by flight progress: launch point -> current target leg.
    const style = projectileStyle(p.cardId, p.sourceKind, p.towerTroop ?? null);
    const target = b.byId.get(p.targetId);
    const traveled = Math.hypot(p.x - p.sx, p.y - p.sy);
    const remaining = target ? Math.hypot(target.x - p.x, target.y - p.y) : 0;
    const frac = traveled / Math.max(0.001, traveled + remaining);
    const w = toWorld(p.x, p.y);
    const y0 = p.sourceKind === "troop" ? 0.9 : 1.6;
    // Scratch vectors: no allocation in the render loop.
    PREV_POS.copy(view.position);
    view.position.set(
      w.x,
      y0 + (0.7 - y0) * frac + Math.sin(frac * Math.PI) * style.arc,
      w.z,
    );
    if (PREV_POS.lengthSq() > 0) {
      LOOK_AT.copy(view.position).multiplyScalar(2).sub(PREV_POS);
      view.lookAt(LOOK_AT);
    }
  }
  for (const [id, view] of b.projViews) {
    if (!seen.has(id)) {
      // Spark where the shot landed (or fizzled) for a crisp impact.
      b.sparks.emit({
        x: view.position.x, y: view.position.y, z: view.position.z,
        count: 6,
        speed: 3.2,
        spread: 1.4,
        life: 0.4,
        size: 0.09,
        color: (view.userData.impactColor as number | undefined) ?? 0xfff1c4,
      });
      b.scene.remove(view);
      disposeDeep(view);
      b.projViews.delete(id);
    }
  }
}

/** Fireball: a flaming meteor crashes down, then explodes. */
export function fireballStrike(b: Battle3D, ax: number, ay: number): void {
  const w = toWorld(ax, ay);
  const start = { x: w.x + 1.5, y: 8, z: w.z - 4 };
  const meteor = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 12, 10),
    unlitGlow(0xffb300),
  );
  meteor.add(core);
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.4, 10),
    new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.7 }),
  );
  tail.position.set(0.25, 0.8, -0.7);
  tail.rotation.x = -0.5;
  meteor.add(tail);
  const FALL = 0.32;
  b.addEffect(meteor, FALL, (frac) => {
    const t = 1 - frac;
    meteor.position.set(
      start.x + (w.x - start.x) * t,
      start.y + (0.3 - start.y) * t,
      start.z + (w.z - start.z) * t,
    );
  });
  blast(b, ax, ay, 2.5, 0xff7814, FALL);
}

/** Zap: a jagged lightning bolt slams down with an electric flash. */
export function zapStrike(b: Battle3D, ax: number, ay: number, radius: number): void {
  const w = toWorld(ax, ay);
  // Jagged bolt built from stacked, offset segments.
  const bolt = new THREE.Group();
  let x = w.x;
  let z = w.z;
  let y = 7;
  while (y > 0.2) {
    const len = 0.9 + ((y * 7) % 5) * 0.12;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, len, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff176 }),
    );
    const nx = x + (((y * 13) % 7) - 3) * 0.12;
    const nz = z + (((y * 11) % 5) - 2) * 0.12;
    seg.position.set((x + nx) / 2, y - len / 2, (z + nz) / 2);
    seg.lookAt(nx, y - len, nz);
    seg.rotateX(Math.PI / 2);
    bolt.add(seg);
    x = nx;
    z = nz;
    y -= len * 0.85;
  }
  b.addEffect(bolt, 0.25, (frac) => {
    bolt.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.transparent = true;
        mat.opacity = frac;
      }
    });
  });
  blast(b, ax, ay, radius, 0xfff176, 0.1);
}

/** Rage: a pulsing purple ring marks the boost zone for its lifetime. */
export function rageZone(b: Battle3D, ax: number, ay: number, radius: number, seconds: number): void {
  const w = toWorld(ax, ay);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.85, radius, 36),
    new THREE.MeshBasicMaterial({
      color: 0xd81b60,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(w.x, 0.06, w.z);
  const haze = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.85, 36),
    new THREE.MeshBasicMaterial({
      color: 0x8e24aa,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
    }),
  );
  haze.rotation.x = -Math.PI / 2;
  haze.position.set(w.x, 0.05, w.z);
  const group = new THREE.Group();
  group.add(ring, haze);
  b.addEffect(group, seconds, (frac) => {
    const pulse = 1 + Math.sin((1 - frac) * seconds * Math.PI * 4) * 0.04;
    group.scale.set(pulse, 1, pulse);
    const fade = frac < 0.15 ? frac / 0.15 : 1;
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
    (haze.material as THREE.MeshBasicMaterial).opacity = 0.16 * fade;
  });
}

/** Freeze: an icy flash, then a lingering frost ring while frozen. */
export function freezeBlast(b: Battle3D, ax: number, ay: number, radius: number, seconds: number): void {
  const w = toWorld(ax, ay);
  blast(b, ax, ay, radius, 0xb2ebff, 0);
  const frost = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({
      color: 0xcfeeff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  frost.rotation.x = -Math.PI / 2;
  frost.position.set(w.x, 0.04, w.z);
  b.addEffect(frost, seconds, (frac) => {
    (frost.material as THREE.MeshBasicMaterial).opacity = 0.3 * Math.min(1, frac * 3);
  });
  // Ice shards poking out of the ground.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + i;
    const r = radius * (0.3 + ((i * 13) % 5) * 0.13);
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.5 + (i % 3) * 0.2, 5),
      new THREE.MeshToonMaterial({ color: 0xb2ebff, transparent: true }),
    );
    shard.position.set(w.x + Math.cos(a) * r, 0, w.z + Math.sin(a) * r);
    shard.rotation.z = ((i % 3) - 1) * 0.2;
    b.addEffect(shard, seconds, (frac) => {
      const grow = Math.min(1, (1 - frac) * seconds * 3);
      shard.scale.setScalar(Math.max(0.05, grow));
      shard.position.y = 0.25 * grow;
      (shard.material as THREE.MeshToonMaterial).opacity = Math.min(1, frac * 3);
    });
  }
}

/**
 * Mega Knight sky-slam: a heavy dust shockwave that radiates outward,
 * with debris flung in every direction and a hard camera kick — timed
 * to land as he hits the ground.
 */
export function megaSlam(b: Battle3D, ax: number, ay: number): void {
  const LAND = 0.26; // sync with the fall in the spawn animation
  const w = toWorld(ax, ay);
  blast(b, ax, ay, 3.2, 0xb9a888, LAND);
  // A low crater ring that snaps outward on impact.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.95, 40),
    new THREE.MeshBasicMaterial({
      color: 0x7a6b50,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(w.x, 0.05, w.z);
  b.addEffect(
    ring,
    0.5,
    (frac) => {
      ring.scale.setScalar(0.3 + (1 - frac) * 4.5);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * frac;
    },
    LAND,
  );
  // Debris chunks hurled outward in every direction (the "trampling" push).
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshToonMaterial({ color: 0x8d7a5c, transparent: true }),
    );
    chunk.position.set(w.x, 0.2, w.z);
    b.addEffect(
      chunk,
      0.5,
      (frac) => {
        const t = 1 - frac;
        const r = t * 3;
        chunk.position.set(w.x + Math.cos(a) * r, 0.2 + Math.sin(t * Math.PI) * 1.2, w.z + Math.sin(a) * r);
        chunk.rotation.set(t * 6, t * 5, 0);
        (chunk.material as THREE.MeshToonMaterial).opacity = frac;
      },
      LAND,
    );
  }
  puff(b, ax, ay, 0xcdbd9c, 1.8);
  addShake(b, 0.85);
}

/**
 * Arrows: the volley is loosed from the caster's edge of the arena and
 * visibly arcs the whole way across the field before raining down on the
 * radius — you can read who fired it and where it's going mid-flight.
 */
export function arrowVolley(b: Battle3D, ax: number, ay: number, radius: number, side: Side = "enemy"): void {
  // World +z is the player's half; the volley flies in from the caster's side.
  const dir = side === "player" ? 1 : -1;
  const FLIGHT = 0.55;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + (i % 3) * 0.4;
    const r = radius * (0.25 + 0.7 * ((i * 37) % 10) * 0.1);
    const w = toWorld(ax, ay);
    const tx = w.x + Math.cos(angle) * r;
    const tz = w.z + Math.sin(angle) * r;
    // Launch point: staggered fan several tiles back toward the caster.
    const sx = tx + ((i % 5) - 2) * 0.55;
    const sz = tz + dir * (8.5 + (i % 4) * 0.8);
    const sy = 1.1;
    const apex = 3.8 + (i % 4) * 0.55;
    // Bright shaft + glowing tracer: from the steep camera a small dark
    // arrow reads as a speck, so the volley needs to shine to be seen.
    const arrow = makeArrow(0xf3e2b8, 1.0);
    const trail = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 1.1, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    trail.rotation.x = -Math.PI / 2;
    trail.position.z = -0.65;
    arrow.add(trail);
    arrow.position.set(sx, sy, sz);
    const at = (t: number, out: THREE.Vector3): THREE.Vector3 =>
      out.set(
        sx + (tx - sx) * t,
        sy + (0.05 - sy) * t + Math.sin(t * Math.PI) * apex,
        sz + (tz - sz) * t,
      );
    b.addEffect(
      arrow,
      FLIGHT,
      (frac) => {
        const t = 1 - frac;
        at(t, PREV_POS);
        arrow.position.copy(PREV_POS);
        // Nose along the flight path: aim at a point just ahead.
        at(Math.min(1, t + 0.04), LOOK_AT);
        arrow.lookAt(LOOK_AT);
      },
      i * 0.03,
    );
  }
  blast(b, ax, ay, radius, 0xdce6ff, FLIGHT + 0.02);
}

/** Roaring red shockwave + steam when a sleeping king wakes up. */
export function kingWakeBurst(b: Battle3D, side: Side): void {
  const z = side === "player" ? 14.5 : -14.5; // king tower rows
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 1.0, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff5252,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.15, z);
  b.addEffect(ring, 0.7, (frac) => {
    const t = 1 - frac;
    ring.scale.setScalar(1 + t * 4);
    (ring.material as THREE.MeshBasicMaterial).opacity = frac * 0.85;
  });
  // Angry steam puffs popping out of the keep.
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80,
        transparent: true,
        opacity: 0.8,
      }),
    );
    const a = (i / 5) * Math.PI * 2;
    puff.position.set(Math.cos(a) * 0.7, 2.6, z + Math.sin(a) * 0.7);
    b.addEffect(
      puff,
      0.6,
      (frac) => {
        puff.position.y = 2.6 + (1 - frac) * 1.6;
        puff.scale.setScalar(1 + (1 - frac) * 1.6);
        (puff.material as THREE.MeshBasicMaterial).opacity = 0.8 * frac;
      },
      i * 0.07,
    );
  }
  addShake(b, 0.35);
}

/** Throw a burst of glowing sparks at an arena point. */
export function emitSparks(
  b: Battle3D,
  ax: number,
  ay: number,
  height: number,
  count: number,
  speed: number,
  spread: number,
  color: number,
  size: number,
  life = 0.45,
): void {
  const w = toWorld(ax, ay);
  b.sparks.emit({ x: w.x, y: height, z: w.z, count, speed, spread, life, size, color });
}

/** Dark necromantic disc that summoned skeletons rise through. */
export function summonPortal(b: Battle3D, ax: number, ay: number, accent = 0x76ff03): void {
  const w = toWorld(ax, ay);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x2e1a47, transparent: true }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(w.x, 0.04, w.z);
  b.addEffect(disc, 0.6, (frac) => {
    disc.scale.setScalar(0.4 + (1 - frac) * 0.8);
    (disc.material as THREE.MeshBasicMaterial).opacity = frac * 0.75;
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.6, 24),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(w.x, 0.05, w.z);
  b.addEffect(ring, 0.6, (frac) => {
    ring.scale.setScalar(0.5 + (1 - frac) * 1.1);
    (ring.material as THREE.MeshBasicMaterial).opacity = frac * 0.8;
  });
}

/** Bone shards scattering from a fallen skeleton. */
export function boneScatter(b: Battle3D, ax: number, ay: number, color: number): void {
  const w = toWorld(ax, ay);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + i;
    const bone = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 0.06),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    const vx = Math.cos(a) * (1.2 + (i % 3) * 0.5);
    const vz = Math.sin(a) * (1.2 + (i % 3) * 0.5);
    b.addEffect(bone, 0.55, (frac) => {
      const t = 1 - frac;
      bone.position.set(
        w.x + vx * t,
        0.4 + 2.2 * t - 4.4 * t * t, // tossed up, falls back down
        w.z + vz * t,
      );
      bone.rotation.set(t * 9 + i, t * 7, t * 5);
      (bone.material as THREE.MeshBasicMaterial).opacity = Math.min(1, frac * 3);
    });
  }
}

/** Electric burst for a broken war machine. */
export function sparkBurst(b: Battle3D, ax: number, ay: number, color: number): void {
  const w = toWorld(ax, ay);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + i * 0.7;
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.3),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    const r = 1.1 + (i % 3) * 0.4;
    spark.position.set(w.x, 0.7, w.z);
    spark.lookAt(w.x + Math.cos(a) * r, 0.7 + (i % 2) * 0.8, w.z + Math.sin(a) * r);
    b.addEffect(spark, 0.4, (frac) => {
      const t = 1 - frac;
      spark.position.set(
        w.x + Math.cos(a) * r * t,
        0.7 + (i % 2) * 0.8 * t,
        w.z + Math.sin(a) * r * t,
      );
      (spark.material as THREE.MeshBasicMaterial).opacity = frac;
    });
  }
  blast(b, ax, ay, 0.9, color, 0);
}

/** The balloon envelope spirals down, shrinking as it vents. */
export function deflate(b: Battle3D, ax: number, ay: number, color: number): void {
  const w = toWorld(ax, ay);
  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true }),
  );
  envelope.scale.y = 1.15;
  b.addEffect(envelope, 0.9, (frac) => {
    const t = 1 - frac;
    envelope.position.set(
      w.x + Math.sin(t * Math.PI * 4) * 0.9 * t,
      1.7 * (1 - t * t),
      w.z + Math.cos(t * Math.PI * 4) * 0.9 * t,
    );
    envelope.scale.setScalar(Math.max(0.08, 1 - t * 0.9));
    envelope.scale.y *= 1.15;
    (envelope.material as THREE.MeshBasicMaterial).opacity = Math.min(1, frac * 2);
  });
}

/** Floating combat text that rises and fades. */
export function damagePopup(
  b: Battle3D,
  x: number,
  y: number,
  z: number,
  label: { text: string; scale: number; color: string },
): void {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = `bold 44px ${GAME_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(label.text, 64, 32);
  ctx.fillStyle = label.color;
  ctx.fillText(label.text, 64, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
    }),
  );
  const s = 0.9 * label.scale;
  sprite.position.set(x, y + 0.3, z);
  b.addEffect(sprite, 0.75, (frac) => {
    const t = 1 - frac;
    sprite.position.y = y + 0.3 + t * 1.1;
    const pop = Math.min(1, t * 8);
    sprite.scale.set(s * 2 * pop, s * pop, 1);
    sprite.material.opacity = frac < 0.25 ? frac / 0.25 : 1;
  });
}

/** A golden crown rises, spins, and fades over a fallen tower. */
export function crownPop(b: Battle3D, ax: number, ay: number): void {
  const w = toWorld(ax, ay);
  const crown = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 10), toon(0xfbbf24));
  crown.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), toon(0xfbbf24));
    spike.position.set(Math.cos(a) * 0.45, 0.26, Math.sin(a) * 0.45);
    crown.add(spike);
  }
  crown.position.set(w.x, 0.6, w.z);
  b.addEffect(crown, 1.2, (frac) => {
    const t = 1 - frac;
    crown.position.y = 0.6 + t * 2.4;
    crown.rotation.y = t * Math.PI * 3;
    crown.scale.setScalar(1 + t * 0.4);
    crown.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material & { opacity: number };
        mat.transparent = true;
        mat.opacity = Math.min(1, frac * 2.5);
      }
    });
  });
}


/** Advance the spark pool and mirror live particles into the mesh. */
export function syncSparks(b: Battle3D, dt: number): void {
  b.sparks.update(dt, SPARK_GRAVITY);
  const mesh = b.sparkMesh;
  let i = 0;
  for (const p of b.sparks.particles) {
    if (!p.active) continue;
    const f = p.life / p.life0; // 1 → 0 as it dies
    SPARK_POS.set(p.x, p.y, p.z);
    SPARK_SCALE.setScalar(p.size * (0.35 + 0.65 * f)); // shrink while fading
    SPARK_M.compose(SPARK_POS, SPARK_QUAT, SPARK_SCALE);
    mesh.setMatrixAt(i, SPARK_M);
    SPARK_COLOR.setHex(p.color);
    mesh.setColorAt(i, SPARK_COLOR);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** The InstancedMesh that draws every pooled hit spark. */
export function buildSparkMesh(): THREE.InstancedMesh {
  // One InstancedMesh draws every hit spark; unlit + glowing so they pop.
  const sparkMat = new THREE.MeshBasicMaterial();
  sparkMat.toneMapped = false;
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 5),
    sparkMat,
    PARTICLE_CAP,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/** Brief white flash at a deploy point (CR drop feedback). */
export function deployFlash(b: Battle3D, ax: number, ay: number): void {
  const w = toWorld(ax, ay);
  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  flash.rotation.x = -Math.PI / 2;
  flash.position.set(w.x, 0.05, w.z);
  b.addEffect(flash, 0.28, (frac) => {
    const t = 1 - frac;
    flash.scale.setScalar(1 + t * 1.4);
    (flash.material as THREE.MeshBasicMaterial).opacity = 0.7 * frac;
  });
}

/** An emote bubble floating above a side's king tower. */
export function emote(b: Battle3D, side: Side, emoji: string): void {
  const z = side === "player" ? 13.5 : -13.5; // just above each king tower
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  // Speech bubble.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(64, 56, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(50, 96);
  ctx.lineTo(64, 122);
  ctx.lineTo(76, 96);
  ctx.closePath();
  ctx.fill();
  ctx.font = "56px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 58);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  sprite.position.set(0, 4.2, z);
  sprite.scale.setScalar(0.1);
  b.addEffect(sprite, 2.4, (frac) => {
    const t = 1 - frac;
    const pop = Math.min(1, t * 6);
    sprite.scale.setScalar(2.2 * (0.2 + 0.8 * pop));
    sprite.position.y = 4.2 + t * 0.5;
    sprite.material.opacity = frac < 0.15 ? frac / 0.15 : 1;
  });
}

/**
 * Entry flourish for a freshly built view: a dark portal for risers, a
 * sky-slam shockwave for the Mega Knight, dust for everyone else.
 */
export function spawnFlourish(b: Battle3D, view: EntityView, e: Entity): void {
  if (view.spawnStyle === "rise") summonPortal(b, e.x, e.y, view.spawnColor);
  else if (view.spawnStyle === "slam") megaSlam(b, e.x, e.y);
  else if (view.isTroop) {
    puff(b, e.x, e.y, view.spawnColor ?? 0xd9cdb8, view.spawnBurst ?? 0.45);
    contactRing(b, e.x, e.y, Math.min(0.85, view.spawnBurst ?? 0.45), view.spawnColor ?? 0xffffff);
  }
}

/** Age every timed effect; expired ones leave the scene and free the GPU. */
export function updateEffects(b: Battle3D, dt: number): void {
  b.effects = b.effects.filter((f) => {
    if (f.delay > 0) {
      f.delay -= dt;
      if (f.delay > 0) return true;
      f.obj.visible = true;
    }
    f.ttl -= dt;
    if (f.ttl <= 0) {
      b.scene.remove(f.obj);
      disposeDeep(f.obj);
      return false;
    }
    f.update(f.ttl / f.ttl0);
    return true;
  });
}

/** Spell, ability, attack and troop-death effects for a battle event. */
export function fxOnEvent(b: Battle3D, ev: BattleEvent): void {
  switch (ev.type) {
    case "ability":
      // Royal flourish from the king tower: a big gold ring for a rally,
      // a green bloom for a restore, a smoke puff for a salvo launch.
      if (ev.ability === "rally") rageZone(b, ev.x, ev.y, 4, 5);
      else if (ev.ability === "restore") blast(b, ev.x, ev.y, 3.5, 0x6ee7a0);
      else blast(b, ev.x, ev.y, 2.2, 0xffb300);
      break;
    case "spell":
      if (ev.cardId === "fireball") fireballStrike(b, ev.x, ev.y);
      else if (ev.cardId === "zap") zapStrike(b, ev.x, ev.y, 2);
      else if (ev.cardId === "rage") rageZone(b, ev.x, ev.y, 2.5, 6);
      else if (ev.cardId === "freeze") freezeBlast(b, ev.x, ev.y, 3, 4);
      else if (ev.cardId === "heal") {
        blast(b, ev.x, ev.y, 3, 0x6ee7a0);
        emitSparks(b, ev.x, ev.y, 0.4, 14, 2.2, 1.6, 0x8effb0, 0.1, 0.7);
      } else if (ev.cardId === "tornado") {
        blast(b, ev.x, ev.y, 4, 0xaab4c4);
        emitSparks(b, ev.x, ev.y, 0.6, 18, 5, 1.8, 0xcfd6e0, 0.09, 0.6);
      } else if (ev.cardId === "skeleton-barrel") {
        puff(b, ev.x, ev.y, 0x8a5a30, 0.9);
        boneScatter(b, ev.x, ev.y, 0xf5f2ea);
      }
      // Mega Knight's slam shockwave is fired from his sky-drop spawn entry.
      else if (ev.cardId === "mega-knight") {
        /* handled on spawn */
      } else arrowVolley(b, ev.x, ev.y, 4, ev.side);
      break;
    case "attack":
      if (ev.ranged) {
        projectile(b, ev);
      } else {
        // Melee landed: sparks fly off the struck target (camera kick and
        // hit-stop follow in viewsOnEvent). Ranged hits spark on landing.
        const s = impactStyle(ev.cardId);
        emitSparks(b, ev.targetX, ev.targetY, 0.8, s.particles, s.speed, s.spread, s.color, s.size);
        contactRing(b, ev.targetX, ev.targetY, s.ringRadius, s.accent);
      }
      break;
    case "death":
      if (ev.kind === "troop") {
        const style = deathStyle(ev.cardId);
        if (style.kind === "bones") boneScatter(b, ev.x, ev.y, style.color);
        else if (style.kind === "sparks") sparkBurst(b, ev.x, ev.y, style.color);
        else if (style.kind === "deflate") deflate(b, ev.x, ev.y, style.color);
        else puff(b, ev.x, ev.y, style.color, style.scale);
        emitSparks(
          b,
          ev.x,
          ev.y,
          0.6,
          style.particles,
          3.5,
          1.5,
          style.color,
          0.09 * style.scale,
          0.5,
        );
      }
      break;
    default:
      break;
  }
}
