/**
 * The arena stage: playfield, edging, stands and crowd, scenery, the river
 * band with its bridges, and Arabic ornaments (domes, finials, lanterns,
 * arch gateways) shared with the towers. Everything static is batched.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, BRIDGE_XS, RIVER_Y } from "../../../game/arena";
import type { BattleEvent } from "../../../game/battle";
import { ARABIC_LOOK } from "../../arenaLooks";
import { toon } from "../../characters3d";
import { batchStatic } from "../../staticBatch";
import { THEME } from "../../theme";
import type { Battle3D } from "../../scene3d";
import { LOOK, arabic, toWorld, unlitGlow, viewSide } from "../common";
import { makeStoneTexture, makeZelligeTexture } from "./textures";

// Instanced-pose scratch (no per-frame allocation).
const CROWD_M = new THREE.Matrix4();
const WATER_M = new THREE.Matrix4();
const WATER_POS = new THREE.Vector3();
const WATER_SCALE = new THREE.Vector3();
const WATER_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/** A gold crescent-and-orb finial that tops domes and spires. */
export function crescentFinial(s: number): THREE.Group {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(s * 0.3, 8, 6), toon(THEME.gold));
  ball.castShadow = true;
  g.add(ball);
  const cres = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.55, s * 0.15, 8, 16, Math.PI * 1.35),
    toon(THEME.goldLight),
  );
  cres.position.y = s * 1.05;
  cres.rotation.z = Math.PI * 0.33;
  cres.castShadow = true;
  g.add(cres);
  return g;
}

/** An onion dome on a stone drum, crowned with a crescent finial. */
export function onionDome(r: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.92, r * 1.02, r * 0.5, 12),
    toon(THEME.sand),
  );
  drum.position.y = r * 0.25;
  drum.castShadow = true;
  g.add(drum);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), toon(color));
  bulb.scale.set(1, 1.3, 1);
  bulb.position.y = r * 0.5 + r * 0.72;
  bulb.castShadow = true;
  g.add(bulb);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.34, r * 0.7, 12), toon(color));
  tip.position.y = r * 0.5 + r * 1.6;
  g.add(tip);
  const fin = crescentFinial(r * 0.9);
  fin.position.y = r * 0.5 + r * 1.95;
  g.add(fin);
  return g;
}

/** An ornate fanoos lantern: gold cage around a warm glow, capped + ringed. */
export function makeLantern(s = 1): THREE.Group {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11 * s, 0.09 * s, 0.3 * s, 8),
    unlitGlow(0xffb347),
  );
  glow.position.y = 0.2 * s;
  g.add(glow);
  for (const [ry, rr] of [[0.35, 0.12], [0.05, 0.1]] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr * s, 0.02 * s, 6, 10), toon(THEME.gold));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ry * s;
    g.add(ring);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.16 * s, 6), toon(THEME.gold));
  cap.position.y = 0.44 * s;
  g.add(cap);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s, 6, 5), toon(THEME.gold));
  drop.position.y = -0.02 * s;
  g.add(drop);
  return g;
}

/** A horseshoe-arch gateway straddling a bridge, crescent + hanging lantern. */
export function archGateway(): THREE.Group {
  const g = new THREE.Group();
  const span = 1.0;
  const pierH = 1.1;
  const pierR = 0.16;
  for (const sx of [-1, 1]) {
    const pier = new THREE.Mesh(
      new THREE.CylinderGeometry(pierR, pierR * 1.1, pierH, 10),
      toon(THEME.sand),
    );
    pier.position.set(sx * span, pierH / 2, 0);
    pier.castShadow = true;
    g.add(pier);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(pierR * 1.3, pierR * 1.45, 0.12, 10),
      toon(THEME.gold),
    );
    base.position.set(sx * span, 0.06, 0);
    g.add(base);
  }
  // Semicircular arch (half-torus in the x-y plane) bridging the piers.
  const arch = new THREE.Mesh(new THREE.TorusGeometry(span, pierR, 8, 20, Math.PI), toon(THEME.sand));
  arch.position.y = pierH;
  arch.castShadow = true;
  g.add(arch);
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(span + pierR * 0.55, pierR * 0.28, 6, 20, Math.PI),
    toon(THEME.gold),
  );
  trim.position.y = pierH;
  g.add(trim);
  const fin = crescentFinial(0.42);
  fin.position.set(0, pierH + span + 0.04, 0);
  g.add(fin);
  // Lantern on a short chain hung from the keystone.
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 4), toon(THEME.gold));
  chain.position.set(0, pierH + span - 0.32, 0);
  g.add(chain);
  const lantern = makeLantern(1.0);
  lantern.position.set(0, pierH + span - 0.7, 0);
  g.add(lantern);
  return g;
}

/** Spectators as two instanced meshes (bodies, heads): 2 draw calls. */
export function buildCrowd(b: Battle3D, seats: Array<{ x: number; z: number; garb: number; skin: number }>): void {
  if (seats.length === 0) return;
  const bodies = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.13, 0.26, 6),
    toon(0xffffff),
    seats.length,
  );
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), toon(0xffffff), seats.length);
  const col = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const vivid = (hex: number): THREE.Color => {
    col.set(hex).getHSL(hsl);
    return col.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l); // as toon() does
  };
  seats.forEach((seat, i) => {
    bodies.setColorAt(i, vivid(seat.garb));
    heads.setColorAt(i, vivid(seat.skin));
  });
  b.crowd = { bodies, heads, seats: seats.map((s) => new THREE.Vector2(s.x, s.z)) };
  poseCrowd(b, -1);
  b.arenaGroup.add(bodies, heads);
}

/** Place every spectator; `t >= 0` makes them hop (cheering). */
export function poseCrowd(b: Battle3D, t: number): void {
  const c = b.crowd!;
  c.seats.forEach((seat, i) => {
    const hop = t >= 0 ? Math.abs(Math.sin(t * 11 + i * 2.6)) * 0.16 : 0;
    CROWD_M.makeTranslation(seat.x, 1.06 + hop, seat.y);
    c.bodies.setMatrixAt(i, CROWD_M);
    CROWD_M.makeTranslation(seat.x, 1.28 + hop, seat.y);
    c.heads.setMatrixAt(i, CROWD_M);
  });
  c.bodies.instanceMatrix.needsUpdate = true;
  c.heads.instanceMatrix.needsUpdate = true;
  c.bodies.computeBoundingSphere();
  c.heads.computeBoundingSphere();
}

export function decorate(b: Battle3D): void {
  // Distant ground so the arena never floats in a void.
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshToonMaterial({ color: LOOK.far }),
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.45;
  b.arenaGroup.add(far);

  // Outer apron framing the arena.
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_WIDTH + 10, 0.36, ARENA_HEIGHT + 10),
    toon(LOOK.apron),
  );
  apron.position.y = -0.24;
  apron.receiveShadow = true;
  b.arenaGroup.add(apron);

  // Rustic fence ringing the apron.
  const fenceHw = ARENA_WIDTH / 2 + 4.6;
  const fenceHd = ARENA_HEIGHT / 2 + 4.6;
  const addFenceRun = (
    from: [number, number],
    to: [number, number],
    posts: number,
  ): void => {
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 0.7, 6),
        toon(LOOK.fencePost),
      );
      post.position.set(
        from[0] + (to[0] - from[0]) * t,
        0.1,
        from[1] + (to[1] - from[1]) * t,
      );
      post.castShadow = true;
      b.arenaGroup.add(post);
    }
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), toon(LOOK.fenceRail));
    rail.position.set((from[0] + to[0]) / 2, 0.3, (from[1] + to[1]) / 2);
    rail.rotation.y = -Math.atan2(to[1] - from[1], to[0] - from[0]);
    b.arenaGroup.add(rail);
  };
  addFenceRun([-fenceHw, -fenceHd], [fenceHw, -fenceHd], 10);
  addFenceRun([-fenceHw, fenceHd], [fenceHw, fenceHd], 10);
  addFenceRun([-fenceHw, -fenceHd], [-fenceHw, fenceHd], 16);
  addFenceRun([fenceHw, -fenceHd], [fenceHw, fenceHd], 16);

  // Long spectator stands flanking the arena: stone galleries with
  // pitched roofs — red on the enemy half, blue on the player half
  // (CR arenas are walled in by these).
  const crowdSeats: Array<{ x: number; z: number; garb: number; skin: number }> = [];
  const stand = (x: number, zCenter: number, len: number, roofColor: number): void => {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, len), toon(LOOK.standWall));
    wall.position.y = 0.55;
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);

    // A crowd of spectators leaning over the field-side parapet
    // (collected here, drawn below as two instanced meshes).
    const innerX = -Math.sign(x) * 0.92;
    const CROWD_SKIN = [0xf6c9a0, 0x9c6644, 0xcfa07a] as const;
    const CROWD_GARB = [0xe53935, 0x3b82f6, 0xf2c14e, 0x66bb6a, 0xab47bc] as const;
    const seats = Math.floor(len / 1.1);
    for (let i = 0; i < seats; i++) {
      const z = -len / 2 + 0.7 + i * 1.1 + ((i * 7) % 3) * 0.12;
      crowdSeats.push({
        x: x + innerX,
        z: zCenter + z,
        garb: CROWD_GARB[(i * 3 + Math.round(x)) % CROWD_GARB.length],
        skin: CROWD_SKIN[(i + Math.abs(Math.round(zCenter))) % CROWD_SKIN.length],
      });
    }

    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, len + 0.4), toon(roofColor));
    roof.position.y = 1.55;
    // Pitch the roof by squashing the top: cheap wedge illusion.
    roof.scale.y = 0.9;
    roof.castShadow = true;
    g.add(roof);
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.24, len + 0.5),
      toon(0xd9a93f),
    );
    ridge.position.y = 1.86;
    g.add(ridge);
    g.position.set(x, 0, zCenter);
    b.arenaGroup.add(g);
  };
  const standX = ARENA_WIDTH / 2 + 6.2;
  const standLen = ARENA_HEIGHT / 2 - 2.5;
  for (const sx of [-1, 1]) {
    stand(sx * standX, -ARENA_HEIGHT / 4 - 1, standLen, LOOK.standRoofEnemy); // enemy side
    stand(sx * standX, ARENA_HEIGHT / 4 + 1, standLen, LOOK.standRoofPlayer); // player side
  }
  buildCrowd(b, crowdSeats);

  // Striped spectator tents in the corners, team-colored.
  const tent = (x: number, z: number, color: number): void => {
    const g = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.3, 8), toon(color));
    roof.position.y = 1.15;
    roof.castShadow = true;
    g.add(roof);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.15, 0.9, 8),
      toon(LOOK.tentWall),
    );
    wall.position.y = 0.45;
    wall.castShadow = true;
    g.add(wall);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6),
      toon(0x5a4632),
    );
    pole.position.y = 1.95;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.3),
      new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide }),
    );
    flag.position.set(0.26, 2.05, 0);
    g.add(flag);
    g.position.set(x, 0, z);
    b.arenaGroup.add(g);
  };
  const tHw = ARENA_WIDTH / 2 + 3.1;
  const tHd = ARENA_HEIGHT / 2 + 3.0;
  tent(-tHw, tHd, 0x3b6fd4);
  tent(tHw, tHd, 0x3b6fd4);
  tent(-tHw, -tHd, 0xd44a3b);
  tent(tHw, -tHd, 0xd44a3b);

  // Strings of glowing lanterns flanking the field (look-dependent).
  // Unlit glow material, so the bloom pass makes them softly radiate;
  // the living sky dims them by day and ignites them at night.
  if (LOOK.lanterns) {
    const lanternColors = LOOK.lanterns;
    const lanternMat = (color: number): THREE.MeshBasicMaterial => b.glow(color);
    const stringLantern = (x: number, y: number, z: number, i: number): void => {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 8),
        lanternMat(lanternColors[i % lanternColors.length]),
      );
      body.scale.set(1, 1.25, 1);
      body.position.set(x, y - 0.4, z);
      b.arenaGroup.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.1, 8), toon(LOOK.fencePost));
      cap.position.set(x, y - 0.02, z);
      b.arenaGroup.add(cap);
    };
    const rope = (len: number, x: number, y: number, z: number, alongX: boolean): void => {
      const r = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, len, 5),
        new THREE.MeshBasicMaterial({ color: LOOK.fencePost, fog: false }),
      );
      r.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      r.position.set(x, y, z);
      b.arenaGroup.add(r);
    };
    // A string across each end, hung right at the arena edge — the
    // steep camera keeps anything further out above the frame.
    // Each end's string lives in its own group so the one on the camera's
    // side can hide: seen from above it would cross our own king tower.
    for (const sz of [-1, 1]) {
      const dz = ARENA_HEIGHT / 2;
      const y = 2.8;
      const holder = b.arenaGroup;
      const endGroup = new THREE.Group();
      endGroup.userData.batchRoot = true; // toggled as a unit per viewpoint
      b.arenaGroup = endGroup;
      rope(ARENA_WIDTH + 10, 0, y, sz * dz, true);
      for (let i = 0; i < 7; i++) {
        stringLantern(-12 + i * 4, y + Math.sin(i * 2.3) * 0.15, sz * dz, i + (sz > 0 ? 1 : 0));
      }
      b.arenaGroup = holder;
      holder.add(endGroup);
      if (sz > 0) b.endStringPlayer = endGroup;
      else b.endStringEnemy = endGroup;
    }
    applyEndStrings(b);
    // Side strings for wider screens.
    const sideX = ARENA_WIDTH / 2 + 3.4;
    for (const sx of [-1, 1]) {
      rope(ARENA_HEIGHT + 4, sx * sideX, 4.6, 0, false);
      for (let i = 0; i < 8; i++) {
        const z = -14 + i * 4;
        stringLantern(sx * sideX, 4.6 + Math.sin(i * 1.7) * 0.18, z, i + (sx > 0 ? 1 : 0));
      }
    }
  }

  // Lanterns (arabic) or torches (normal) flanking each bridge approach.
  for (const bx of BRIDGE_XS) {
    const w = toWorld(bx, RIVER_Y);
    for (const sz of [-1, 1]) {
      if (arabic) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 6), toon(THEME.stone));
        pole.position.set(w.x + 1.45, 0.55, sz * 2.2);
        pole.castShadow = true;
        b.arenaGroup.add(pole);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 4), toon(THEME.gold));
        arm.rotation.z = Math.PI / 2;
        arm.position.set(w.x + 1.32, 1.08, sz * 2.2);
        b.arenaGroup.add(arm);
        const lantern = makeLantern(0.95);
        lantern.position.set(w.x + 1.2, 0.92, sz * 2.2);
        b.arenaGroup.add(lantern);
      } else {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), toon(LOOK.fencePost));
        pole.position.set(w.x + 1.45, 0.55, sz * 2.2);
        pole.castShadow = true;
        b.arenaGroup.add(pole);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), b.glow(LOOK.torch));
        flame.position.set(w.x + 1.45, 1.2, sz * 2.2);
        b.arenaGroup.add(flame);
      }
    }
  }

  // Trees by look: palms, pines, violet topiary, or dead snags.
  const tree = (x: number, z: number, s: number): void => {
    const g = new THREE.Group();
    const kind = LOOK.tree.kind;
    if (kind === "palm") {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 8), toon(LOOK.tree.trunk));
      trunk.position.y = 0.75;
      trunk.rotation.z = 0.06;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 7; i++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.0, 5), toon(i % 2 ? LOOK.tree.leafA : LOOK.tree.leafB));
        const a = (i / 7) * Math.PI * 2;
        frond.position.set(Math.cos(a) * 0.42, 1.5, Math.sin(a) * 0.42);
        frond.rotation.set(Math.PI / 2 - 0.5, 0, -a + Math.PI / 2);
        frond.castShadow = true;
        g.add(frond);
      }
      for (let i = 0; i < 3; i++) {
        const date = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), toon(0x9c4a2a));
        date.position.set(Math.cos(i * 2) * 0.12, 1.36, Math.sin(i * 2) * 0.12);
        g.add(date);
      }
    } else if (kind === "dead") {
      // Bare snag: a leaning trunk with two stubby branches, no foliage.
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.7, 7), toon(LOOK.tree.trunk));
      trunk.position.y = 0.85;
      trunk.rotation.z = 0.12;
      trunk.castShadow = true;
      g.add(trunk);
      for (const [dy, rz] of [[1.1, 0.9], [1.4, -1.1]] as const) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.8, 5), toon(LOOK.tree.leafB));
        br.position.set(rz > 0 ? 0.3 : -0.3, dy, 0);
        br.rotation.z = rz;
        g.add(br);
      }
    } else if (kind === "topiary") {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 8), toon(LOOK.tree.trunk));
      trunk.position.y = 0.25;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const layer = new THREE.Mesh(new THREE.ConeGeometry(0.75 - i * 0.18, 0.7, 10), toon(i % 2 ? LOOK.tree.leafA : LOOK.tree.leafB));
        layer.position.y = 0.62 + i * 0.42;
        layer.castShadow = true;
        g.add(layer);
      }
    } else {
      // Pine: stacked cones on a short trunk.
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 8), toon(LOOK.tree.trunk));
      trunk.position.y = 0.25;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const layer = new THREE.Mesh(new THREE.ConeGeometry(0.7 - i * 0.16, 0.8, 8), toon(i % 2 ? LOOK.tree.leafA : LOOK.tree.leafB));
        layer.position.y = 0.6 + i * 0.5;
        layer.castShadow = true;
        g.add(layer);
      }
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    b.arenaGroup.add(g);
  };
  const rock = (x: number, z: number, s: number): void => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), toon(LOOK.rock));
    m.position.set(x, 0.16 * s, z);
    m.scale.set(s, s * 0.7, s);
    m.castShadow = true;
    b.arenaGroup.add(m);
  };

  const hw = ARENA_WIDTH / 2;
  const hd = ARENA_HEIGHT / 2;
  // Tree lines along both sides, plus a few behind each king.
  const treeSpots: Array<[number, number, number]> = [
    [-hw - 1.6, -12, 1.2], [-hw - 2.4, -6, 0.9], [-hw - 1.8, -1, 1.1],
    [-hw - 2.2, 4, 1.0], [-hw - 1.5, 9, 1.3], [-hw - 2.6, 14, 0.8],
    [hw + 1.7, -13, 1.0], [hw + 2.3, -7, 1.2], [hw + 1.6, -2, 0.9],
    [hw + 2.5, 3, 1.1], [hw + 1.8, 8, 1.0], [hw + 2.2, 13, 1.2],
    [-5, -hd - 2.2, 1.1], [3, -hd - 2.8, 0.9], [7, hd + 2.4, 1.2], [-6, hd + 2.6, 1.0],
  ];
  for (const [x, z, s] of treeSpots) tree(x, z, s);
  const rockSpots: Array<[number, number, number]> = [
    [-hw - 1.3, 6.5, 0.8], [hw + 1.4, -4.5, 1.0], [-hw - 2.0, -9.5, 0.6],
    [hw + 1.2, 10.5, 0.7], [2, -hd - 1.8, 0.9], [-3, hd + 1.9, 0.8],
  ];
  for (const [x, z, s] of rockSpots) rock(x, z, s);

  // Flower dots on the playfield grass (meadow-type looks only).
  const flowerSpots: Array<[number, number, number]> = !LOOK.flowers ? [] : [
    [1.5, -11, 0xfff176], [-6.5, -4, 0xf48fb1], [6.8, -13, 0xffffff],
    [-2.2, 11, 0xfff176], [7.1, 5.5, 0xf48fb1], [-7.4, 13.2, 0xffffff],
    [4.4, 9.8, 0xf48fb1], [-4.8, -13.5, 0xffffff],
  ];
  for (const [x, z, color] of flowerSpots) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), toon(color));
    f.position.set(x, 0.06, z);
    b.arenaGroup.add(f);
  }
}

/** Flat golden crescent moon inlaid in the floor (arena centerpiece). */
export function makeCrescentEmblem(z: number): THREE.Group {
  const g = new THREE.Group();
  const R = 2.5; // outer disc radius
  const r = 2.2; // bite disc radius
  const cx = 1.5; // bite offset; the crescent opens toward +x
  // Horn (intersection) points of the two circles.
  const ix = (cx * cx + R * R - r * r) / (2 * cx);
  const iy = Math.sqrt(Math.max(0, R * R - ix * ix));
  const thTop = Math.atan2(iy, ix);
  const thBot = Math.atan2(-iy, ix);
  const bTop = Math.atan2(iy, ix - cx);
  const bBot = Math.atan2(-iy, ix - cx);
  const steps = 48;
  const shape = new THREE.Shape();
  // Outer far arc: top horn, counter-clockwise around the big disc.
  for (let i = 0; i <= steps; i++) {
    const a = thTop + (i / steps) * (thBot + Math.PI * 2 - thTop);
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // Concave inner arc: back along the bite disc through its left bulge.
  const span = bBot - (bTop - Math.PI * 2);
  for (let i = 1; i <= steps; i++) {
    const a = bBot - (i / steps) * span;
    shape.lineTo(cx + Math.cos(a) * r, Math.sin(a) * r);
  }
  const crescent = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(LOOK.islamic?.emblem ?? 0xe8b948));
  crescent.rotation.x = -Math.PI / 2;
  crescent.rotation.z = 0; // open the crescent vertically (down the board)
  crescent.position.set(0, 0.03, z);
  crescent.receiveShadow = true;
  g.add(crescent);
  return g;
}

/** A lumpy mound edging the field (snow drift / sand dune by theme). */
export function makeSnowDrift(x: number, z: number, scale: number): THREE.Mesh {
  const drift = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    toon(LOOK.drift),
  );
  drift.scale.set(scale, scale * 0.45, scale);
  drift.position.set(x, -0.05, z);
  drift.castShadow = true;
  drift.receiveShadow = true;
  return drift;
}

export function buildArena(b: Battle3D): void {
  // One checkered playfield slab instead of two flat halves.
  const fieldMat = new THREE.MeshToonMaterial({
    map: arabic ? makeZelligeTexture() : makeStoneTexture(),
  });
  const field = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.4, ARENA_HEIGHT),
    [
      toon(LOOK.fieldSide).clone(), // stone sides
      toon(LOOK.fieldSide).clone(),
      fieldMat, // top
      toon(LOOK.fieldSide).clone(),
      toon(LOOK.fieldSide).clone(),
      toon(LOOK.fieldSide).clone(),
    ],
  );
  field.position.set(0, -0.2, 0);
  field.receiveShadow = true;
  b.arenaGroup.add(field);

  // Snow drifts piled along the playfield edges (winter theme).
  const dhw = ARENA_WIDTH / 2 + 1.1;
  const dhd = ARENA_HEIGHT / 2 + 0.6;
  const driftSpots: Array<[number, number, number]> = [
    [-dhw, -11, 1.6], [-dhw, -3, 1.3], [-dhw, 6, 1.7], [-dhw, 13, 1.4],
    [dhw, -13, 1.5], [dhw, -5, 1.6], [dhw, 4, 1.3], [dhw, 12, 1.7],
    [-5, -dhd, 1.8], [5, -dhd, 1.5], [-6, dhd, 1.6], [6, dhd, 1.9],
  ];
  for (const [x, z, sc] of driftSpots) {
    b.arenaGroup.add(makeSnowDrift(x, z, sc));
  }

  // Edging around the playfield, post at each corner.
  const hw = ARENA_WIDTH / 2 + 0.45;
  const hd = ARENA_HEIGHT / 2 + 0.15;
  const stone = LOOK.edging;
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, ARENA_HEIGHT + 0.9), toon(stone));
    rail.position.set(side * hw, 0.05, 0);
    rail.castShadow = true;
    rail.receiveShadow = true;
    b.arenaGroup.add(rail);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(ARENA_WIDTH + 1.4, 0.34, 0.5), toon(stone));
    cap.position.set(0, 0.05, side * hd);
    cap.castShadow = true;
    cap.receiveShadow = true;
    b.arenaGroup.add(cap);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.7, 0.7),
        toon(LOOK.cornerPost),
      );
      post.position.set(sx * hw, 0.18, sz * hd);
      post.castShadow = true;
      b.arenaGroup.add(post);
      if (LOOK.neon) {
        // Neon cap on each corner post, picked up by the bloom pass.
        const neon = new THREE.Mesh(
          new THREE.BoxGeometry(0.74, 0.08, 0.74),
          b.glow(sz < 0 ? LOOK.neon.enemy : LOOK.neon.player),
        );
        neon.position.set(sx * hw, 0.56, sz * hd);
        b.arenaGroup.add(neon);
      }
    }
  }
  if (LOOK.neon) {
    // Thin neon strips along the end caps complete the cage glow.
    for (const sz of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA_WIDTH + 1.4, 0.05, 0.1),
        b.glow(sz < 0 ? LOOK.neon.enemy : LOOK.neon.player),
      );
      strip.position.set(0, 0.24, sz * hd);
      b.arenaGroup.add(strip);
    }
  }
  decorate(b);

  // Arabic keeps its straight golden lanes; the normal edition bakes
  // organic winding paths directly into the floor texture instead.
  if (arabic) addStraightLanes(b);
  finishArena(b);
  // Hundreds of static props -> one draw call per look.
  batchStatic(b.arenaGroup, () => false);
}

export function addStraightLanes(b: Battle3D): void {
  const laneCanvas = document.createElement("canvas");
  laneCanvas.width = 48;
  laneCanvas.height = 256;
  const lctx = laneCanvas.getContext("2d")!;
  const Z = LOOK.islamic ?? ARABIC_LOOK.islamic!;
  const grad = lctx.createLinearGradient(0, 0, 48, 0);
  grad.addColorStop(0, `rgba(${Z.lane},0)`);
  grad.addColorStop(0.15, `rgba(${Z.lane},0.75)`);
  grad.addColorStop(0.5, `rgba(${Z.lane},0.95)`);
  grad.addColorStop(0.85, `rgba(${Z.lane},0.75)`);
  grad.addColorStop(1, `rgba(${Z.lane},0)`);
  lctx.fillStyle = grad;
  lctx.fillRect(0, 0, 48, 256);
  // Speckled wear so the path reads as trodden dirt.
  lctx.fillStyle = `rgba(${Z.laneWear},0.55)`;
  for (let i = 0; i < 120; i++) {
    lctx.fillRect((i * 13) % 46, (i * 47) % 254, 2.5, 1.8);
  }
  lctx.fillStyle = "rgba(255,236,170,0.4)";
  for (let i = 0; i < 80; i++) {
    lctx.fillRect((i * 19 + 5) % 46, (i * 31 + 9) % 254, 1.8, 1.2);
  }
  // Center rut line for CR lane readability.
  lctx.fillStyle = `rgba(${Z.laneWear},0.3)`;
  lctx.fillRect(22, 0, 4, 256);
  const laneTex = new THREE.CanvasTexture(laneCanvas);
  laneTex.colorSpace = THREE.SRGBColorSpace;
  for (const bx of BRIDGE_XS) {
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, ARENA_HEIGHT - 1.2),
      new THREE.MeshToonMaterial({ map: laneTex, transparent: true }),
    );
    lane.rotation.x = -Math.PI / 2;
    const w = toWorld(bx, ARENA_HEIGHT / 2);
    lane.position.set(w.x, 0.012, 0);
    lane.receiveShadow = true;
    b.arenaGroup.add(lane);
  }
}

/** River, emblems, bridges, and bank foam — both editions. */
export function finishArena(b: Battle3D): void {
  // Bright CR-blue water with drifting light streaks.
  const waterCanvas = document.createElement("canvas");
  waterCanvas.width = 128;
  waterCanvas.height = 32;
  const wctx = waterCanvas.getContext("2d")!;
  // The mid-band is whatever the look says: river, lava, chasm, ice, metal.
  wctx.fillStyle = LOOK.band.fill;
  wctx.fillRect(0, 0, 128, 32);
  wctx.strokeStyle = LOOK.band.streak;
  wctx.lineWidth = 1.6;
  for (let i = 0; i < 9; i++) {
    const y = 3 + ((i * 37) % 26);
    const x = (i * 29) % 110;
    wctx.beginPath();
    wctx.moveTo(x, y);
    wctx.quadraticCurveTo(x + 7, y - 2, x + 14, y);
    wctx.stroke();
  }
  b.waterTex = new THREE.CanvasTexture(waterCanvas);
  b.waterTex.wrapS = THREE.RepeatWrapping;
  b.waterTex.colorSpace = THREE.SRGBColorSpace;
  const river = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.22, 2.2),
    new THREE.MeshToonMaterial({ map: b.waterTex }),
  );
  river.position.set(0, -0.04, 0);
  b.arenaGroup.add(river);
  // One instanced draw call supplies mobile-friendly moving specular glints.
  b.waterSparkles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.7, 0.045),
    new THREE.MeshBasicMaterial({
      color: LOOK.band.glint,
      transparent: true,
      opacity: LOOK.band.glintOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    12,
  );
  b.waterSparkles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  b.waterSparkles.frustumCulled = false;
  b.arenaGroup.add(b.waterSparkles);

  // Gold crescent emblem on each half (Arabic). The normal edition bakes
  // its faint crown watermark into the floor texture instead.
  if (arabic) {
    for (const sz of [-1, 1]) {
      const z = sz * (ARENA_HEIGHT / 4 + 0.5);
      b.arenaGroup.add(makeCrescentEmblem(z));
    }
  }

  if (arabic) {
    // Ornate sandstone bridges with a horseshoe-arch gateway, parapets,
    // gold rim, and teal cupola finials at each end.
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 2.6), toon(THEME.sand));
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      b.arenaGroup.add(deck);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.06, 2.66), toon(THEME.gold));
      rim.position.set(w.x, 0.21, 0);
      b.arenaGroup.add(rim);
      const gate = archGateway();
      gate.position.set(w.x, 0.2, 0);
      b.arenaGroup.add(gate);
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 2.6), toon(THEME.stone));
        wall.position.set(w.x + side * 0.92, 0.34, 0);
        wall.castShadow = true;
        b.arenaGroup.add(wall);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 2.66), toon(THEME.gold));
        cap.position.set(w.x + side * 0.92, 0.53, 0);
        b.arenaGroup.add(cap);
        for (const ez of [-1.2, 1.2]) {
          const post = onionDome(0.16, THEME.teal);
          post.position.set(w.x + side * 0.92, 0.4, ez);
          b.arenaGroup.add(post);
        }
      }
    }
  } else if (LOOK.band.bridge === "gate") {
    // Neon arena: each crossing is a gold crown-buckle gate set into the
    // dark metal band (reference screenshot), flanked by slate posts.
    const SLATE = 0x343a52;
    const SLATEDK = 0x23283c;
    const GOLD = 0xd9a93f;
    const GOLDLT = 0xf2c14e;
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.24, 2.6), toon(SLATE));
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      b.arenaGroup.add(deck);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 2.0), toon(GOLD));
      plate.position.set(w.x, 0.25, 0);
      plate.castShadow = true;
      b.arenaGroup.add(plate);
      const boss = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 1.3), toon(GOLDLT));
      boss.position.set(w.x, 0.31, 0);
      b.arenaGroup.add(boss);
      for (const sz of [-1, 1]) {
        for (const dx of [-0.38, 0, 0.38]) {
          const point = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), toon(GOLDLT));
          point.rotation.y = Math.PI / 4;
          point.position.set(w.x + dx, 0.32, sz * 0.85);
          point.castShadow = true;
          b.arenaGroup.add(point);
        }
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.34), toon(SLATEDK));
          post.position.set(w.x + sx * 1.0, 0.3, sz * 1.2);
          post.castShadow = true;
          b.arenaGroup.add(post);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.4), toon(GOLD));
          cap.position.set(w.x + sx * 1.0, 0.58, sz * 1.2);
          b.arenaGroup.add(cap);
        }
      }
    }
  } else if (LOOK.band.bridge === "timber") {
    // Chunky golden timber decks with royal-blue braces and rope rails.
    const WOOD = 0xc99032;
    const WOOD_LIGHT = 0xe0ad45;
    const BRACE = 0x315da8;
    const ROPE = 0xd4a574;
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 2.6), toon(WOOD));
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      b.arenaGroup.add(deck);
      for (let i = -3; i <= 3; i++) {
        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(1.92, 0.035, 0.32),
          toon(i % 2 ? WOOD_LIGHT : WOOD),
        );
        plank.position.set(w.x, 0.225, i * 0.36);
        plank.castShadow = true;
        b.arenaGroup.add(plank);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 2.7), toon(0xf6c14e));
        rail.position.set(w.x + side * 0.94, 0.34, 0);
        rail.castShadow = true;
        b.arenaGroup.add(rail);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), toon(ROPE));
        rope.rotation.x = Math.PI / 2;
        rope.position.set(w.x + side * 0.94, 0.58, 0);
        b.arenaGroup.add(rope);
        for (const ez of [-1.0, -0.33, 0.33, 1.0]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.22), toon(BRACE));
          post.position.set(w.x + side * 0.94, 0.46, ez);
          post.castShadow = true;
          b.arenaGroup.add(post);
        }
      }
    }
  } else {
    // Stone (or ice) arch crossings: a masonry deck with a low arched
    // parapet on each side, capped in the look's edging color.
    const ice = LOOK.band.bridge === "ice";
    const STONE = ice ? 0xdcecf6 : LOOK.tower.plinth;
    const STONEDK = ice ? 0xb8d4e8 : LOOK.edging;
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.24, 2.6), toon(STONE));
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      b.arenaGroup.add(deck);
      // Keystone arch belly under the deck (reads from the camera angle).
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.0, 12, 1, false, 0, Math.PI), toon(STONEDK));
      arch.rotation.z = Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      arch.position.set(w.x, -0.02, 0);
      arch.scale.set(0.45, 1, 1);
      b.arenaGroup.add(arch);
      for (const side of [-1, 1]) {
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 2.7), toon(STONEDK));
        parapet.position.set(w.x + side * 0.95, 0.35, 0);
        parapet.castShadow = true;
        b.arenaGroup.add(parapet);
        for (const ez of [-1.2, 1.2]) {
          const finial = new THREE.Mesh(
            ice ? new THREE.ConeGeometry(0.14, 0.42, 6) : new THREE.SphereGeometry(0.16, 8, 6),
            toon(ice ? 0xffffff : LOOK.edging),
          );
          finial.position.set(w.x + side * 0.95, ice ? 0.7 : 0.6, ez);
          b.arenaGroup.add(finial);
        }
      }
    }
  }

  // Soft foam strips along the river banks (both editions).
  const foamMat = new THREE.MeshBasicMaterial({
    color: LOOK.band.foam,
    transparent: true,
    opacity: LOOK.band.foamOpacity,
    depthWrite: false,
  });
  for (const sz of [-1, 1]) {
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_WIDTH + 0.4, 0.35), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.02, sz * 1.15);
    b.arenaGroup.add(foam);
  }
}

/** Hide the end-string nearest the camera (it would cross our king). */
export function applyEndStrings(b: Battle3D): void {
  if (b.endStringPlayer) b.endStringPlayer.visible = viewSide !== "player";
  if (b.endStringEnemy) b.endStringEnemy.visible = viewSide !== "enemy";
}


/** The river drifts sideways forever, with glints sliding over it. */
export function updateRiver(b: Battle3D, dt: number): void {
  if (b.waterTex) {
    b.waterTime += dt;
    b.waterTex.offset.x = b.waterTime * 0.04;
  }
  if (b.waterSparkles) {
    for (let i = 0; i < b.waterSparkles.count; i++) {
      const phase = i * 1.917;
      const x = ((i * 3.73 + b.waterTime * (0.7 + (i % 3) * 0.16)) % (ARENA_WIDTH + 2)) -
        (ARENA_WIDTH + 2) / 2;
      WATER_POS.set(
        x,
        0.085 + Math.sin(b.waterTime * 2.4 + phase) * 0.012,
        ((i * 0.73) % 1.7) - 0.85,
      );
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(b.waterTime * 3.1 + phase));
      WATER_SCALE.set(pulse, pulse, 1);
      WATER_M.compose(WATER_POS, WATER_QUAT, WATER_SCALE);
      b.waterSparkles.setMatrixAt(i, WATER_M);
    }
    b.waterSparkles.instanceMatrix.needsUpdate = true;
  }
}

/** Crowd cheering: spectators hop while the cheer lasts. */
export function updateCrowd(b: Battle3D, dt: number): void {
  if (b.cheer > 0) {
    b.cheer = Math.max(0, b.cheer - dt);
    if (b.crowd) poseCrowd(b, b.cheer > 0 ? b.waterTime : -1);
  }
}

/** Arena reactions to battle events (none yet; arena work hooks in here). */
export function arenaOnEvent(_b: Battle3D, _ev: BattleEvent): void {}
