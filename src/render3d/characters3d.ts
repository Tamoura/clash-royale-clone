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

export interface Wing {
  obj: THREE.Object3D;
  /** Resting roll; the flap oscillates around this. */
  base: number;
  /** Flap amplitude (signed, so wings mirror). */
  amp: number;
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
  /** Hover height for flying units (0/undefined = ground). */
  hover?: number;
  /** Flapping wings, if any. */
  wings?: Wing[];
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

function buildWizard(): TroopRig {
  const g = new THREE.Group();
  // Robe: tapered box stack.
  g.add(box(0.62, 0.3, 0.45, 0x6d28d9, 0, 0.15, 0));
  g.add(box(0.52, 0.55, 0.36, 0x7c3aed, 0, 0.55, 0));
  g.add(box(0.56, 0.08, 0.4, 0xf2c14e, 0, 0.34, 0)); // sash
  g.add(box(0.38, 0.32, 0.38, SKIN, 0, 1.0, 0)); // head
  g.add(box(0.3, 0.22, 0.1, 0xe8e3d8, 0, 0.84, 0.18)); // white beard
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.05, 12),
    lambert(0x5b21b6),
  );
  brim.castShadow = true;
  brim.position.y = 1.2;
  g.add(brim);
  g.add(cone(0.22, 0.42, 0x5b21b6, 0, 1.44, 0)); // pointed hat
  g.add(box(0.1, 0.3, 0.1, 0x7c3aed, -0.34, 0.7, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.34, 0.78, 0);
  arm.add(box(0.1, 0.26, 0.1, 0x7c3aed, 0, -0.13, 0));
  // Fire orb in the casting hand.
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff8c1a,
      emissive: 0xff6a00,
      emissiveIntensity: 1.6,
    }),
  );
  orb.position.set(0, -0.32, 0.08);
  arm.add(orb);
  g.add(arm);
  return { group: g, arm, armRest: -0.8, swingAmp: 0.9, height: 1.65 };
}

function buildBabyDragon(): TroopRig {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 10),
    lambert(0x4caf50),
  );
  body.castShadow = true;
  body.scale.set(1, 0.9, 1.15);
  body.position.y = 0.45;
  g.add(body);
  g.add(box(0.5, 0.42, 0.42, 0x59b75d, 0, 0.92, 0.18)); // head
  g.add(box(0.3, 0.2, 0.26, 0x66bb6a, 0, 0.82, 0.46)); // snout
  g.add(box(0.26, 0.05, 0.05, 0x2e7d32, 0, 0.74, 0.58)); // mouth line
  g.add(sphere(0.06, 0x1f2430, -0.14, 1.02, 0.36)); // eye
  g.add(sphere(0.06, 0x1f2430, 0.14, 1.02, 0.36)); // eye
  g.add(cone(0.07, 0.18, 0xa5d6a7, -0.14, 1.2, 0.05)); // horn
  g.add(cone(0.07, 0.18, 0xa5d6a7, 0.14, 1.2, 0.05)); // horn
  const tail = cone(0.1, 0.5, 0x4caf50, 0, 0.4, -0.62);
  tail.rotation.x = Math.PI / 2.4;
  g.add(tail);

  const wings: Wing[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 0.34, 0.72, -0.05);
    const membrane = box(0.55, 0.04, 0.34, 0x81c784, side * 0.3, 0, 0);
    wing.add(membrane);
    wing.rotation.z = side * 0.3;
    g.add(wing);
    wings.push({ obj: wing, base: side * 0.3, amp: side * 0.55 });
  }
  return {
    group: g,
    arm: null,
    armRest: 0,
    swingAmp: 0,
    height: 1.35,
    hover: 1.0,
    wings,
  };
}

function buildGargoyle(): TroopRig {
  const g = new THREE.Group();
  g.add(box(0.3, 0.34, 0.24, 0x6b7280, 0, 0.34, 0)); // stone body
  g.add(box(0.3, 0.26, 0.28, 0x7b8494, 0, 0.66, 0)); // head
  g.add(sphere(0.05, 0xffd54f, -0.08, 0.68, 0.13)); // glowing eye
  g.add(sphere(0.05, 0xffd54f, 0.08, 0.68, 0.13)); // glowing eye
  g.add(cone(0.05, 0.16, 0x4b5563, -0.11, 0.86, 0)); // horn
  g.add(cone(0.05, 0.16, 0x4b5563, 0.11, 0.86, 0)); // horn
  g.add(box(0.08, 0.2, 0.08, 0x6b7280, -0.19, 0.3, 0)); // arm
  const arm = new THREE.Group();
  arm.position.set(0.19, 0.42, 0);
  arm.add(box(0.08, 0.2, 0.08, 0x6b7280, 0, -0.1, 0)); // claw arm
  g.add(arm);

  const wings: Wing[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 0.16, 0.6, -0.1);
    wing.add(box(0.4, 0.03, 0.26, 0x4b5563, side * 0.22, 0, 0));
    wing.rotation.z = side * 0.4;
    g.add(wing);
    wings.push({ obj: wing, base: side * 0.4, amp: side * 0.7 });
  }
  return {
    group: g,
    arm,
    armRest: -0.4,
    swingAmp: 1.2,
    height: 0.95,
    hover: 0.9,
    wings,
  };
}

function buildValkyrie(): TroopRig {
  const g = new THREE.Group();
  g.add(...legs(0x4e342e, 0.12, 0.15));
  g.add(box(0.56, 0.5, 0.36, 0xb71c1c, 0, 0.5, 0)); // dress
  g.add(box(0.58, 0.09, 0.38, 0x6d4c41, 0, 0.28, 0)); // belt
  g.add(box(0.4, 0.34, 0.4, SKIN, 0, 0.94, 0)); // head
  g.add(box(0.46, 0.14, 0.46, 0xe07b39, 0, 1.16, 0)); // orange hair
  g.add(box(0.1, 0.34, 0.1, 0xe07b39, -0.26, 0.9, -0.16)); // braid
  g.add(box(0.1, 0.34, 0.1, 0xe07b39, 0.26, 0.9, -0.16)); // braid
  g.add(box(0.12, 0.3, 0.12, SKIN, -0.36, 0.56, 0)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.38, 0.68, 0);
  arm.add(box(0.12, 0.28, 0.12, SKIN, 0, -0.14, 0));
  arm.add(box(0.06, 0.5, 0.06, 0x6d4c41, 0, -0.3, 0.16)); // haft
  // Double-headed axe.
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12, 1, false, 0, Math.PI),
      lambert(0xb7c2cc),
    );
    blade.castShadow = true;
    blade.rotation.set(0, side > 0 ? 0 : Math.PI, Math.PI / 2);
    blade.position.set(side * 0.03, -0.52, 0.16);
    arm.add(blade);
  }
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.7, height: 1.3 };
}

function buildPrince(): TroopRig {
  const g = new THREE.Group();
  // Pony.
  const HORSE = 0x8d6e63;
  for (const [lx, lz] of [
    [-0.24, 0.35],
    [0.24, 0.35],
    [-0.24, -0.35],
    [0.24, -0.35],
  ]) {
    g.add(box(0.13, 0.4, 0.13, HORSE, lx, 0.2, lz));
  }
  g.add(box(0.55, 0.42, 1.1, 0x9c7b66, 0, 0.6, 0)); // horse body
  g.add(box(0.3, 0.34, 0.42, HORSE, 0, 0.95, 0.62)); // horse head
  g.add(box(0.26, 0.16, 0.18, 0x7a5548, 0, 0.78, 0.84)); // muzzle
  g.add(box(0.08, 0.3, 0.3, 0x5d4037, 0, 1.12, 0.42)); // mane
  const tail = cone(0.07, 0.4, 0x5d4037, 0, 0.7, -0.62);
  tail.rotation.x = -Math.PI / 2.6;
  g.add(tail);
  // Rider.
  g.add(box(0.42, 0.42, 0.3, 0xfafafa, 0, 1.08, -0.12)); // tabard
  g.add(box(0.44, 0.1, 0.32, 0xf2c14e, 0, 0.9, -0.12)); // gold trim
  g.add(box(0.34, 0.3, 0.34, SKIN, 0, 1.42, -0.12)); // head
  g.add(box(0.4, 0.16, 0.4, 0xf2c14e, 0, 1.62, -0.12)); // gold helmet
  const plume = cone(0.09, 0.3, 0xe53935, 0, 1.82, -0.12);
  g.add(plume);
  g.add(box(0.1, 0.28, 0.1, 0xfafafa, -0.28, 1.1, -0.12)); // off arm

  const arm = new THREE.Group();
  arm.position.set(0.3, 1.2, -0.05);
  arm.add(box(0.1, 0.24, 0.1, SKIN, 0, -0.12, 0));
  // Lance pointing ahead.
  const lance = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.06, 1.3, 8),
    lambert(0xd7ccc8),
  );
  lance.castShadow = true;
  lance.rotation.x = Math.PI / 2;
  lance.position.set(0, -0.2, 0.6);
  arm.add(lance);
  arm.add(cone(0.07, 0.18, 0xb7c2cc, 0, -0.2, 1.3)); // tip — rotated below
  const tip = arm.children[arm.children.length - 1];
  tip.rotation.x = Math.PI / 2;
  g.add(arm);
  return { group: g, arm, armRest: -0.1, swingAmp: 0.55, height: 1.95 };
}

const BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
  knight: buildKnight,
  archers: buildArcher,
  giant: buildGiant,
  musketeer: buildMusketeer,
  "mini-pekka": buildMiniPekka,
  skeletons: buildSkeleton,
  wizard: buildWizard,
  "baby-dragon": buildBabyDragon,
  gargoyles: buildGargoyle,
  valkyrie: buildValkyrie,
  prince: buildPrince,
};

export function buildTroop(cardId: CardId): TroopRig {
  const builder = BUILDERS[cardId];
  if (!builder) throw new Error(`No 3D builder for ${cardId}`);
  const rig = builder();
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  return rig;
}

/** Apply walk bob / hover + wing flap + attack swing (1 after a hit → 0). */
export function animateTroop(
  rig: TroopRig,
  opts: { moving: boolean; swing: number; time: number; phase: number },
): void {
  if (rig.hover) {
    // Flyers float and gently undulate whether moving or not.
    rig.group.position.y =
      rig.hover + Math.sin(opts.time * 3 + opts.phase) * 0.08;
    rig.group.rotation.x = opts.moving ? 0.12 : 0;
  } else {
    rig.group.position.y = opts.moving
      ? Math.abs(Math.sin(opts.time * 9 + opts.phase)) * 0.08
      : 0;
    // Lean into the walk a touch.
    rig.group.rotation.x = opts.moving ? 0.06 : 0;
  }
  if (rig.wings) {
    for (const wing of rig.wings) {
      wing.obj.rotation.z =
        wing.base + Math.sin(opts.time * 12 + opts.phase) * wing.amp;
    }
  }
  if (rig.arm) {
    rig.arm.rotation.x = rig.armRest - rig.swingAmp * opts.swing;
  }
}
