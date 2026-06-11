import * as THREE from "three";
import type { CardId } from "../game/cards";

/**
 * Chunky low-poly characters built from primitives (toy/Crossy-Road
 * style) — no model files. Every troop is a THREE.Group standing on
 * y=0, facing +z; userData.arm is the weapon group that swings.
 */

const SKIN = 0xf6c9a0;

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function sphere(r: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function cone(
  r: number,
  h: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export interface TroopRig {
  group: THREE.Group;
  /** Shoulder group rotated on attack. */
  arm: THREE.Group | null;
  /** Resting arm pitch; swing animates from here. */
  armRest: number;
  /** How far the arm swings on an attack (radians). */
  swingAmp: number;
  /** Approximate top of the character, for the HP bar. */
  height: number;
}

function legs(color: number, spread: number, size = 0.16): THREE.Mesh[] {
  return [
    box(size, 0.22, size, color, -spread, 0.11, 0),
    box(size, 0.22, size, color, spread, 0.11, 0),
  ];
}

function buildKnight(): TroopRig {
  const g = new THREE.Group();
  g.add(...legs(0x3a2a1c, 0.13));
  g.add(box(0.55, 0.45, 0.34, 0x54606f, 0, 0.45, 0)); // armor torso
  g.add(box(0.57, 0.08, 0.36, 0x3a2a1c, 0, 0.25, 0)); // belt
  g.add(box(0.4, 0.34, 0.4, SKIN, 0, 0.86, 0)); // head
  g.add(box(0.46, 0.14, 0.46, 0x94a1ae, 0, 1.08, 0)); // helmet
  g.add(box(0.08, 0.1, 0.04, 0x94a1ae, 0, 0.92, 0.21)); // nose guard
  g.add(box(0.24, 0.05, 0.04, 0x6b4423, 0, 0.76, 0.21)); // mustache
  g.add(box(0.12, 0.34, 0.12, 0x54606f, -0.34, 0.5, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.36, 0.64, 0);
  arm.add(box(0.12, 0.32, 0.12, SKIN, 0, -0.16, 0));
  arm.add(box(0.18, 0.04, 0.08, 0x8d6e63, 0, -0.32, 0)); // guard
  arm.add(box(0.05, 0.6, 0.1, 0xcfd8e3, 0, -0.02, 0)); // blade up
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.6, height: 1.2 };
}

function buildArcher(): TroopRig {
  const g = new THREE.Group();
  g.add(...legs(0x254d28, 0.1, 0.13));
  g.add(box(0.42, 0.4, 0.28, 0x2e7d32, 0, 0.42, 0)); // tunic
  g.add(box(0.36, 0.3, 0.36, SKIN, 0, 0.78, 0)); // head
  g.add(box(0.4, 0.13, 0.4, 0xec5fa3, 0, 0.98, 0)); // pink hair
  g.add(sphere(0.1, 0xec5fa3, 0.2, 0.98, -0.12)); // bun
  g.add(box(0.1, 0.3, 0.1, 0x2e7d32, 0.28, 0.5, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(-0.28, 0.6, 0);
  arm.add(box(0.1, 0.28, 0.1, SKIN, 0, -0.14, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.27, 0.025, 6, 12, Math.PI),
    lambert(0x8d6e63),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.26, 0.12);
  bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
  arm.add(bow);
  arm.add(box(0.012, 0.52, 0.012, 0xe8e3d8, 0, -0.26, 0.1)); // string
  g.add(arm);
  return { group: g, arm, armRest: -0.9, swingAmp: 0.45, height: 1.1 };
}

function buildGiant(): TroopRig {
  const g = new THREE.Group();
  g.add(box(0.28, 0.32, 0.28, 0x7a5230, -0.22, 0.16, 0));
  g.add(box(0.28, 0.32, 0.28, 0x7a5230, 0.22, 0.16, 0));
  g.add(box(1.0, 0.85, 0.62, 0xc98850, 0, 0.92, 0)); // barrel torso
  g.add(box(0.3, 0.22, 0.03, 0xa96f3d, 0.18, 0.8, 0.32)); // patch
  g.add(box(1.02, 0.1, 0.64, 0x7a5230, 0, 0.55, 0)); // belt
  g.add(box(0.55, 0.5, 0.55, SKIN, 0, 1.62, 0)); // bald head
  g.add(box(0.57, 0.22, 0.2, 0x8a5a35, 0, 1.45, 0.22)); // beard
  g.add(box(0.4, 0.06, 0.05, 0x5d3d22, 0, 1.78, 0.28)); // brow
  // off arm
  const armL = new THREE.Group();
  armL.position.set(-0.62, 1.22, 0);
  armL.add(box(0.2, 0.5, 0.2, SKIN, 0, -0.28, 0));
  armL.add(sphere(0.17, SKIN, 0, -0.58, 0));
  armL.rotation.x = -0.25;
  g.add(armL);

  const arm = new THREE.Group();
  arm.position.set(0.62, 1.22, 0);
  arm.add(box(0.2, 0.5, 0.2, SKIN, 0, -0.28, 0));
  arm.add(sphere(0.18, SKIN, 0, -0.6, 0));
  g.add(arm);
  return { group: g, arm, armRest: -0.3, swingAmp: 1.3, height: 1.95 };
}

function buildMusketeer(): TroopRig {
  const g = new THREE.Group();
  g.add(...legs(0x283593, 0.11, 0.14));
  g.add(box(0.5, 0.5, 0.32, 0x3f51b5, 0, 0.48, 0)); // coat
  g.add(box(0.52, 0.09, 0.34, 0x283593, 0, 0.32, 0)); // sash
  g.add(box(0.38, 0.32, 0.38, SKIN, 0, 0.92, 0)); // head
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12),
    lambert(0x263238),
  );
  brim.castShadow = true;
  brim.position.set(0, 1.12, 0);
  g.add(brim);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.2, 0.2, 12),
    lambert(0x263238),
  );
  crown.castShadow = true;
  crown.position.set(0, 1.24, 0);
  g.add(crown);
  g.add(box(0.05, 0.18, 0.05, 0xe53935, 0.16, 1.3, 0)); // feather
  g.add(box(0.1, 0.3, 0.1, 0x3f51b5, -0.32, 0.55, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.32, 0.62, 0);
  arm.add(box(0.1, 0.26, 0.1, SKIN, 0, -0.13, 0));
  arm.add(box(0.07, 0.07, 0.5, 0x6d4c41, 0, -0.24, 0.22)); // stock
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.5, 8),
    lambert(0x9aa3ad),
  );
  barrel.castShadow = true;
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.22, 0.6);
  arm.add(barrel);
  g.add(arm);
  return { group: g, arm, armRest: -0.15, swingAmp: 0.35, height: 1.35 };
}

function buildMiniPekka(): TroopRig {
  const g = new THREE.Group();
  g.add(...legs(0x10141c, 0.13, 0.17));
  g.add(box(0.5, 0.42, 0.34, 0x202b3d, 0, 0.46, 0)); // metal body
  g.add(box(0.56, 0.44, 0.5, 0x26334a, 0, 0.94, 0)); // helmet head
  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.03),
    new THREE.MeshStandardMaterial({
      color: 0x4fd8ff,
      emissive: 0x4fd8ff,
      emissiveIntensity: 2,
    }),
  );
  eye.position.set(0, 0.96, 0.26);
  g.add(eye);
  const hornL = cone(0.07, 0.32, 0xb7c2cc, -0.32, 1.24, 0);
  hornL.rotation.z = 0.5;
  const hornR = cone(0.07, 0.32, 0xb7c2cc, 0.32, 1.24, 0);
  hornR.rotation.z = -0.5;
  g.add(hornL, hornR);
  g.add(box(0.12, 0.3, 0.12, 0x202b3d, -0.34, 0.5, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.36, 0.6, 0);
  arm.add(box(0.12, 0.28, 0.12, 0x202b3d, 0, -0.14, 0));
  arm.add(box(0.05, 0.16, 0.05, 0x6d4c41, 0, -0.34, 0)); // handle
  arm.add(box(0.04, 0.5, 0.3, 0xb7c2cc, 0, -0.1, 0.06)); // cleaver
  g.add(arm);
  return { group: g, arm, armRest: -0.45, swingAmp: 1.8, height: 1.4 };
}

function buildSkeleton(): TroopRig {
  const g = new THREE.Group();
  g.add(box(0.07, 0.18, 0.07, 0xf5f2ea, -0.07, 0.09, 0));
  g.add(box(0.07, 0.18, 0.07, 0xf5f2ea, 0.07, 0.09, 0));
  g.add(box(0.24, 0.26, 0.15, 0xf5f2ea, 0, 0.32, 0)); // ribcage block
  g.add(box(0.26, 0.03, 0.16, 0xd9d2c0, 0, 0.32, 0.001)); // rib line
  g.add(box(0.27, 0.25, 0.27, 0xf5f2ea, 0, 0.6, 0)); // skull
  g.add(box(0.05, 0.06, 0.02, 0x1f2430, -0.07, 0.62, 0.14)); // eye
  g.add(box(0.05, 0.06, 0.02, 0x1f2430, 0.07, 0.62, 0.14)); // eye
  g.add(box(0.06, 0.2, 0.06, 0xf5f2ea, -0.17, 0.38, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.17, 0.45, 0);
  arm.add(box(0.06, 0.18, 0.06, 0xf5f2ea, 0, -0.09, 0));
  arm.add(box(0.03, 0.32, 0.06, 0xe8e3d8, 0, -0.02, 0)); // bone sword
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.5, height: 0.78 };
}

const BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
  knight: buildKnight,
  archers: buildArcher,
  giant: buildGiant,
  musketeer: buildMusketeer,
  "mini-pekka": buildMiniPekka,
  skeletons: buildSkeleton,
};

export function buildTroop(cardId: CardId): TroopRig {
  const builder = BUILDERS[cardId];
  if (!builder) throw new Error(`No 3D builder for ${cardId}`);
  const rig = builder();
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  return rig;
}

/** Apply walk bob + attack swing. swing is 1 right after a hit → 0. */
export function animateTroop(
  rig: TroopRig,
  opts: { moving: boolean; swing: number; time: number; phase: number },
): void {
  rig.group.position.y = opts.moving
    ? Math.abs(Math.sin(opts.time * 9 + opts.phase)) * 0.08
    : 0;
  if (rig.arm) {
    rig.arm.rotation.x = rig.armRest - rig.swingAmp * opts.swing;
  }
  // Lean into the walk a touch.
  rig.group.rotation.x = opts.moving ? 0.06 : 0;
}
