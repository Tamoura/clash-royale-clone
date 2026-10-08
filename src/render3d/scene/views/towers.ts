/**
 * Crown towers: the keep with its crew, HP plate and edition dressing, built
 * as named chunks (base, wall, battlement, roof, flag, crew mount) that are
 * each merged into a few draw calls; per-frame aiming; damage stages that
 * knock off crenels, tilt then tear the flag and crack the walls; and the
 * collapse when one falls: chunks tumble off (towerCollapse.ts), dust rises,
 * rubble and a crater stay behind, and a king's fall stops time and pulls
 * the camera in.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BattleEvent, Entity } from "../../../game/battle";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../../game/arena";
import {
  animateTroop,
  articulate,
  buildTowerCannoneer,
  buildTowerDuchess,
  buildTowerKing,
  buildTowerPrincess,
  outlineRig,
  paintedToon,
  toon,
} from "../../characters3d";
import { batchStatic } from "../../staticBatch";
import { outlinesEnabled } from "../../quality";
import {
  CHUNK_ORDER,
  COLLAPSE_TIME,
  SINK_TIME,
  chunkPose,
  planCollapse,
  seededRandom,
  type ChunkMotion,
  type ChunkName,
  type ChunkStart,
} from "../../towerCollapse";
import { THEME } from "../../theme";
import type { Battle3D } from "../../scene3d";
import {
  HP_COLOR,
  LOOK,
  SIDE_COLOR,
  SPAWN_POP_TIME,
  arabic,
  targetOf,
  toWorld,
  viewSide,
  type DyingView,
  type EntityView,
} from "../common";
import { brickTex } from "../arena/textures";
import { crescentFinial, onionDome } from "../arena/build";
import { addShake, startKoZoom } from "../camera";
import { markShadowsDirty } from "../post";
import { contactRing, crownPop, emitSparks, kingWakeBurst, puff } from "../fx/effects";
import { LegacyFx } from "../fx/api";
import { attackSwing } from "./animate";
import {
  collectFlashMats,
  makeHpBar,
  makeHpText,
  makeLevelBadge,
  makeZzzSprite,
  updateHpText,
} from "./troops";

/**
 * Cosmetic tower flair tier, set from the player's trophy road: 0 = plain,
 * 1 (600+) = gilded merlon caps, 2 (1200+) = jeweled crest too. Applies at
 * tower build time (each battle rebuilds its towers).
 */
let TOWER_FLAIR = 0;
export function setTowerFlair(tier: number): void {
  TOWER_FLAIR = Math.max(0, Math.min(2, Math.floor(tier)));
}

/** Towers stand 1.1x (CR's true 3x3 / 4x4 footprints with a landmark bump). */
const TOWER_SCALE = 1.1;
/** Crenels a wounded tower loses: the first at 2/3 HP, all three by 1/3. */
const CRENELS_LOST = [0, 1, 3];

/** Everything about a crown tower's mesh the damage and collapse code needs. */
interface TowerRig {
  id: number;
  king: boolean;
  height: number;
  /** The keep's chunks by name; "base" stays put when the rest flies. */
  chunks: Map<ChunkName | "base", THREE.Object3D>;
  /**
   * The battlement mesh, whose last vertices are the three crenels that
   * break off (unitVerts each, first-lost last), and where they stood.
   */
  crenels: { mesh: THREE.Mesh | null; totalVerts: number; unitVerts: number; spots: THREE.Vector3[] };
  cracks: THREE.Mesh;
  flag: THREE.Group;
  cloth: THREE.Mesh;
  /** HP plate, number and sleep bubble: hidden once the tower falls. */
  plate: THREE.Object3D[];
  /** The scene this tower lives in (set every frame it stands). */
  b: Battle3D | null;
  collapse: Collapse | null;
}

interface Collapse {
  plan: ChunkMotion[];
  chunks: THREE.Object3D[];
  rest: THREE.Euler[];
  landed: boolean[];
  /** Materials to fade while the remains sink. */
  mats: (THREE.Material & { opacity: number })[];
}

const rigs = new WeakMap<THREE.Object3D, TowerRig>();

/** A named chunk of the keep; static ones are merged on their own. */
function chunkGroup(root: THREE.Group, name: ChunkName | "base", animated = false): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (animated) g.userData.noBatch = true;
  else g.userData.batchRoot = true;
  root.add(g);
  return g;
}

export function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.28 : 0.95;
  const height = king ? 2.35 : 1.85;
  const base = chunkGroup(root, "base");
  const wall = chunkGroup(root, "wall");
  const battlement = chunkGroup(root, "battlement");
  const roof = chunkGroup(root, "roof");
  const flagGroup = chunkGroup(root, "flag", true);

  // Two-step stone platform under the keep, gold-trimmed like CR.
  // Neon arena: the whole tower is team-colored (enemy magenta, player
  // blue) like the reference screenshot; the Arabic edition stays sand.
  const enemySide = e.side === "enemy";
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.9, 0.18, radius * 2.9),
    toon(enemySide ? LOOK.tower.platformEnemy : LOOK.tower.platformPlayer),
  );
  platform.position.y = 0.09;
  base.add(platform);
  const platTrim = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.95, 0.06, radius * 2.95),
    toon(0xd9a93f),
  );
  platTrim.position.y = 0.2;
  base.add(platTrim);
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.3, 0.3, radius * 2.3),
    toon(LOOK.tower.plinth),
  );
  plinth.position.y = 0.32;
  base.add(plinth);

  const wallMat = paintedToon(
    new THREE.MeshToonMaterial({
      map: brickTex(enemySide ? LOOK.tower.enemy : LOOK.tower.player),
    }),
  );
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2, height, radius * 2),
    wallMat,
  );
  body.position.y = height / 2;
  wall.add(body);

  // Bevelled corner pillars standing proud of the wall, and a stone base
  // course: the chunky silhouette CR towers have instead of a bare box.
  const pillarMat = toon(LOOK.tower.battlement);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.32, height + 0.06, radius * 0.32),
        pillarMat,
      );
      pillar.position.set(sx * radius * 0.98, (height + 0.06) / 2, sz * radius * 0.98);
      wall.add(pillar);
    }
  }
  const baseCourse = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.1, 0.26, radius * 2.1),
    toon(LOOK.tower.plinth),
  );
  baseCourse.position.y = 0.6;
  base.add(baseCourse);

  // Gold trim band under the battlements (CR's royal touch).
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.15, 0.14, radius * 2.15),
    toon(0xf2c14e),
  );
  trim.position.y = height - 0.16;
  wall.add(trim);

  // Merlons along the four roof edges — taller CR battlements. The three
  // facing the camera that break off are added last (last-lost first), so
  // they end the battlement's merged mesh and damage trims them off its
  // draw range.
  const camSide = viewSide === "player" ? 1 : -1;
  const breakable = [
    { row: "a", side: camSide, i: 1 }, // lost at 2/3 HP
    { row: "a", side: camSide, i: -1 },
    { row: "b", side: -1, i: camSide }, // both gone by 1/3 HP
  ];
  const crenelUnits: THREE.Mesh[][] = [[], [], []];
  const spots: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const merlon = toon(LOOK.tower.battlement);
  const gildCap = TOWER_FLAIR >= 1 ? toon(0xf2c14e) : null;
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      for (const row of ["a", "b"] as const) {
        const along = row === "a";
        const x = along ? i * radius * 0.7 : side * radius * 0.92;
        const z = along ? side * radius * 0.92 : i * radius * 0.7;
        const m = new THREE.Mesh(
          along ? new THREE.BoxGeometry(0.34, 0.38, 0.2) : new THREE.BoxGeometry(0.2, 0.38, 0.34),
          merlon,
        );
        m.position.set(x, height + 0.16, z);
        const parts = [m];
        if (gildCap) {
          // Trophy-road flair: gilded caps on every battlement.
          const cap = new THREE.Mesh(
            along ? new THREE.BoxGeometry(0.36, 0.06, 0.22) : new THREE.BoxGeometry(0.22, 0.06, 0.36),
            gildCap,
          );
          cap.position.set(x, height + 0.38, z);
          parts.push(cap);
        }
        const k = breakable.findIndex((c) => c.row === row && c.side === side && c.i === i);
        if (k >= 0) {
          crenelUnits[k] = parts;
          spots[k].set(x, height + 0.2, z);
        } else {
          battlement.add(...parts);
        }
      }
    }
  }
  for (let k = crenelUnits.length - 1; k >= 0; k--) battlement.add(...crenelUnits[k]);
  const vertsOf = (m: THREE.Mesh): number => m.geometry.index?.count ?? m.geometry.getAttribute("position").count;
  const unitVerts = crenelUnits[0].reduce((n, m) => n + vertsOf(m), 0);

  if (TOWER_FLAIR >= 2) {
    // Veteran crest: a ruby set in gold on the tower's river-facing wall.
    const crestSide = e.side === "player" ? -1 : 1;
    const setting = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), toon(0xf2c14e));
    setting.rotation.x = Math.PI / 2;
    setting.position.set(0, height * 0.62, crestSide * (radius + 0.03));
    wall.add(setting);
    const ruby = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), toon(0xe0314a));
    ruby.position.set(0, height * 0.62, crestSide * (radius + 0.08));
    wall.add(ruby);
  }

  // Door + team banner facing the enemy.
  const facing = e.side === "player" ? -1 : 1;

  // Arabic theme: crown the tower with onion-dome cupolas at the corners and
  // a big central dome (king) or crescent spire (princess) toward the rear,
  // so the tower crew stays visible up front.
  if (arabic) {
    const domeColor = king ? (LOOK.islamic?.domeKing ?? THEME.turquoise) : (LOOK.islamic?.dome ?? THEME.teal);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cup = onionDome(radius * 0.26, domeColor);
        cup.position.set(sx * radius * 0.82, height + 0.02, sz * radius * 0.82);
        roof.add(cup);
      }
    }
    const rearZ = facing * -radius * 0.5;
    if (king) {
      const dome = onionDome(radius * 0.62, domeColor);
      dome.position.set(0, height + 0.05, rearZ);
      roof.add(dome);
    } else {
      const fin = crescentFinial(0.55);
      fin.position.set(0, height + 0.2, rearZ);
      roof.add(fin);
    }
  } else {
    // Classic edition: chunky team-color roof caps and a raised royal crown
    // platform make princess and king towers identifiable at a glance.
    const roofColor = SIDE_COLOR[e.side];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cap = new THREE.Mesh(
          new THREE.ConeGeometry(radius * 0.28, radius * 0.52, 4),
          toon(roofColor),
        );
        cap.rotation.y = Math.PI / 4;
        cap.position.set(sx * radius * 0.78, height + 0.42, sz * radius * 0.78);
        roof.add(cap);
        const goldTip = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 0.07, 8, 6),
          toon(0xf6c14e),
        );
        goldTip.position.set(sx * radius * 0.78, height + 0.72, sz * radius * 0.78);
        roof.add(goldTip);
      }
    }
    if (king) {
      const crownDeck = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.62, radius * 0.72, 0.18, 8),
        toon(0xf6c14e),
      );
      crownDeck.position.set(0, height + 0.2, -facing * radius * 0.4);
      roof.add(crownDeck);
    }

    // CR-signature gun platform: a timber deck with a chunky cannon aimed
    // downlane (offset so the tower crew keeps center stage).
    const deckPlanks = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.92, radius * 0.98, 0.1, 10),
      toon(0x8a5c2e),
    );
    deckPlanks.position.y = height + 0.02;
    roof.add(deckPlanks);
    const gun = new THREE.Group();
    gun.position.set(radius * 0.5, height + 0.14, facing * radius * 0.5);
    const carriage = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, 0.34),
      toon(0x6e4a26),
    );
    carriage.position.y = 0.02;
    gun.add(carriage);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(king ? 0.16 : 0.12, king ? 0.2 : 0.15, king ? 0.85 : 0.65, 10),
      toon(0x3a4150),
    );
    barrel.rotation.x = facing * 1.35; // aimed downlane with a slight lift
    barrel.position.set(0, 0.16, facing * 0.12);
    gun.add(barrel);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry((king ? 0.16 : 0.12) + 0.025, (king ? 0.16 : 0.12) + 0.025, 0.08, 10),
      toon(0xf6c14e),
    );
    band.rotation.x = facing * 1.35;
    band.position.set(0, 0.16, facing * 0.12);
    gun.add(band);
    roof.add(gun);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), toon(0x4a3826));
  door.position.set(0, 0.62, facing * radius * 1.01);
  base.add(door);

  // The king's platform bears a golden crown emblem out front.
  if (king) {
    const emblem = new THREE.Group();
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.07), toon(0xd9a93f));
    emblem.add(band);
    for (const dx of [-0.17, 0, 0.17]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), toon(0xd9a93f));
      spike.position.set(dx, 0.16, 0);
      emblem.add(spike);
    }
    emblem.position.set(0, 0.34, facing * radius * 1.47);
    base.add(emblem);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.7, 0.06),
    toon(SIDE_COLOR[e.side]),
  );
  banner.position.set(0, height - 0.62, facing * radius * 1.03);
  wall.add(banner);
  const bannerTip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 4), toon(SIDE_COLOR[e.side]));
  bannerTip.rotation.x = Math.PI;
  bannerTip.rotation.y = Math.PI / 4;
  bannerTip.position.set(0, height - 1.05, facing * radius * 1.03);
  wall.add(bannerTip);

  // Every static stone part casts and takes shadow, so each chunk merges
  // into as few meshes as its materials allow.
  for (const g of [base, wall, battlement, roof]) {
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
  }

  // Cracks spread over the walls as the tower is worn down.
  const cracks = buildCracks(radius, height, king);
  wall.add(cracks);

  // Team flag, planted off-center so the tower crew has the roof. Its
  // group pivots at the foot of the pole, so damage can tilt it over.
  flagGroup.position.set(-radius * 0.6, height + 0.1, 0);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6),
    toon(0x5a4632),
  );
  pole.position.y = 0.4;
  flagGroup.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.32),
    new THREE.MeshToonMaterial({ color: SIDE_COLOR[e.side], side: THREE.DoubleSide }),
  );
  cloth.position.set(0.3, 0.62, 0);
  flagGroup.add(cloth);

  const view: Partial<EntityView> & { root: THREE.Group } = { root, rig: null };

  // Tower crew: a princess archer, or the king on his keep. The rig
  // sits inside a mount group because animateTroop owns the rig's
  // own transform (hop/breath/lean).
  const defender = king
    ? buildTowerKing()
    : e.towerTroop === "cannoneer"
      ? buildTowerCannoneer()
      : e.towerTroop === "duchess"
        ? buildTowerDuchess()
        : buildTowerPrincess();
  articulate(defender);
  if (outlinesEnabled()) outlineRig(defender.group);
  defender.group.scale.setScalar(king ? 0.85 : 0.8);
  if (defender.arm) defender.arm.rotation.x = defender.armRest;
  // Each limb's parts (and their ink hulls) merge into that limb; faces
  // and other named parts stay separate meshes.
  batchStatic(defender.group, () => false, { tint: true, local: true });
  const mount = chunkGroup(root, "defenderMount", true);
  mount.position.y = height + 0.18;
  mount.add(defender.group);
  mount.traverse((o) => (o.castShadow = false)); // tiny on the roof; not worth a shadow pass
  view.defender = defender;
  view.defenderMount = mount;

  const plate: THREE.Object3D[] = [];
  if (king) {
    const zzz = makeZzzSprite();
    zzz.position.y = height + 2.0;
    root.add(zzz);
    view.zzz = zzz;
    plate.push(zzz);
  }

  const barWidth = king ? 2.8 : 2.3;
  const barY = height + (king ? 1.55 : 1.25);
  // Sit the bar behind the tower, on its outer side: above enemy towers
  // (-z, the top), below the player's (+z, the bottom)... except the FAR
  // king: it sits so deep that an outer-side plate projects above the top
  // of the frustum and is never visible. Its plate hangs on the
  // river-facing front instead (view-aware, so the guest's flipped camera
  // gets the same fix for the host's king).
  const outward = e.side === "player" ? 1 : -1;
  const farSide = e.side !== viewSide;
  const barZ = king && farSide ? -outward * 1.9 : outward * (king ? 1.7 : 1.4);
  const bar = makeHpBar(barWidth, HP_COLOR[e.side], barY, 0.36);
  bar.group.position.z = barZ;
  bar.group.userData.noBatch = true;
  root.add(bar.group);
  view.hpGroup = bar.group;
  view.hpFill = bar.fill;

  // CR plate: a chunky pill with the HP number inside and a level shield
  // riding its left end.
  const badge = makeLevelBadge(e.side);
  badge.scale.set(0.7, 0.7, 1);
  badge.position.set(-barWidth / 2 - 0.12, 0, 0.06);
  bar.group.add(badge);
  const hpText = makeHpText(barY + 0.02);
  hpText.sprite.scale.set(1.75, 0.64, 1);
  hpText.sprite.position.z = barZ + 0.2;
  root.add(hpText.sprite);
  view.hpText = hpText.text;
  plate.push(bar.group, hpText.sprite);

  // The keep never moves until it falls: each chunk merges by look into
  // a draw call or two (the flag, crew and HP plate stay live).
  batchStatic(root, () => false, { tint: true });
  // Every battlement part shares one look under tinting: one merged mesh.
  const battlementMeshes = battlement.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
  const battlementMesh = battlementMeshes.length === 1 ? battlementMeshes[0] : null;
  view.flashMats = collectFlashMats(root);
  view.lastHp = e.hp;
  view.flashT = 0;
  view.spawnT = SPAWN_POP_TIME; // towers don't pop in
  view.isTroop = false;
  // Measured against real CR: at 1.5x a princess tower read 4.1 tiles wide
  // vs CR's 3.0. 1.1x lands both towers on CR's true 3x3 / 4x4 footprints
  // while keeping a slight landmark bump.
  view.baseScale = TOWER_SCALE;
  root.scale.setScalar(TOWER_SCALE);

  rigs.set(root, {
    id: e.id,
    king,
    height,
    chunks: new Map<ChunkName | "base", THREE.Object3D>([
      ["base", base],
      ["wall", wall],
      ["battlement", battlement],
      ["roof", roof],
      ["flag", flagGroup],
      ["defenderMount", mount],
    ]),
    crenels: {
      mesh: battlementMesh,
      totalVerts: battlementMesh ? vertsOf(battlementMesh) : 0,
      unitVerts,
      spots,
    },
    cracks,
    flag: flagGroup,
    cloth,
    plate,
    b: null,
    collapse: null,
  });
  return view as EntityView;
}

// ---- Cracks -----------------------------------------------------------------

/** One painted crack sheet per tower kind, shared by every tower of it. */
const crackTextures = new Map<string, THREE.CanvasTexture>();

/** A 128px transparent sheet of branching masonry cracks (seeded, so stable). */
function crackTexture(king: boolean): THREE.CanvasTexture {
  const key = king ? "king" : "princess";
  const cached = crackTextures.get(key);
  if (cached) return cached;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rand = seededRandom(king ? 41 : 17);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const crack = (x: number, y: number, angle: number, steps: number, width: number): void => {
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 1.1;
      const len = 10 + rand() * 12;
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      pts.push([x, y]);
      if (i > 1 && rand() < 0.35) crack(x, y, angle + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.5), 2 + Math.floor(rand() * 2), width * 0.6);
    }
    // A pale chipped lip under a dark split reads as a crack in any light.
    for (const [style, w, dx] of [["rgba(255,244,226,0.5)", width + 2.5, 1.8], ["rgba(26,18,12,0.95)", width, 0]] as const) {
      ctx.strokeStyle = style;
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        ctx.lineWidth = w * (1 - (i / pts.length) * 0.6);
        if (i === 0) ctx.moveTo(px + dx, py + dx);
        else ctx.lineTo(px + dx, py + dx);
      });
      ctx.stroke();
    }
  };
  // Bold splits running from the top of the sheet most of the way down:
  // the walls are seen small and at a slant, so fine hairlines would vanish.
  const mains = king ? 3 : 2;
  for (let i = 0; i < mains; i++) {
    const x0 = (S / (mains + 1)) * (i + 1) + (rand() - 0.5) * 16;
    crack(x0, 2, Math.PI / 2 + (rand() - 0.5) * 0.6, 6 + Math.floor(rand() * 2), 9);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  crackTextures.set(key, tex);
  return tex;
}

/** Quads per stage: one on each of the keep's four faces, one on its roof. */
const CRACK_QUADS_PER_STAGE = 5;

/**
 * Crack decals on the four wall faces and across the roof (the part the
 * steep camera sees best), one merged mesh: the first five quads show at
 * the first damage stage, all ten at the second (by index draw range).
 * Hidden while the tower is whole.
 */
function buildCracks(radius: number, height: number, king: boolean): THREE.Mesh {
  const quads: THREE.BufferGeometry[] = [];
  const out = radius + 0.012;
  const bottom = 0.8;
  const top = height - 0.3;
  const span = top - bottom;
  const stages = [
    { cx: -0.22, cy: bottom + span * 0.62, w: 1.15, h: span * 0.72, flip: false, roofX: -0.3, roofZ: 0.25 },
    { cx: 0.28, cy: bottom + span * 0.36, w: 1.05, h: span * 0.68, flip: true, roofX: 0.3, roofZ: -0.2 },
  ];
  // The roof deck sits a touch above the wall top (classic timber deck).
  const roofY = height + (arabic ? 0.01 : 0.08);
  for (const s of stages) {
    const roofQuad = new THREE.PlaneGeometry(radius * 1.1, radius * 1.1);
    roofQuad.rotateX(-Math.PI / 2);
    roofQuad.rotateY(s.flip ? Math.PI / 2 : 0);
    roofQuad.translate(s.roofX * radius, roofY, s.roofZ * radius);
    quads.push(roofQuad);
    for (let face = 0; face < 4; face++) {
      const q = new THREE.PlaneGeometry(s.w * radius, s.h);
      if (s.flip) {
        // Mirror the sheet so the second stage's cracks don't repeat the first's.
        const uv = q.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      }
      q.translate(s.cx * radius, s.cy, out);
      q.rotateY((face * Math.PI) / 2);
      quads.push(q);
    }
  }
  const geo = mergeGeometries(quads, false)!;
  for (const q of quads) q.dispose();
  const mat = new THREE.MeshBasicMaterial({
    map: crackTexture(king),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "cracks";
  mesh.userData.noBatch = true;
  mesh.visible = false;
  return mesh;
}

// ---- Damage stages ------------------------------------------------------------

/** Show damage stage `stage` (1 below 2/3 HP, 2 below 1/3) on the keep. */
function showDamage(b: Battle3D, rig: TowerRig, e: Entity, from: number, stage: number): void {
  // Crenels break off the camera-facing battlements, with a spray of chips.
  const lost = CRENELS_LOST[stage];
  const { crenels } = rig;
  crenels.mesh?.geometry.setDrawRange(0, crenels.totalVerts - lost * crenels.unitVerts);
  for (let k = CRENELS_LOST[from]; k < lost; k++) {
    const p = crenels.spots[k];
    b.fx.emit("chips", e.x + p.x * TOWER_SCALE, e.y + p.z * TOWER_SCALE, { z: p.y * TOWER_SCALE, radius: 0.7 });
    emitSparks(b, e.x + p.x * TOWER_SCALE, e.y + p.z * TOWER_SCALE, p.y * TOWER_SCALE, 6, 3.5, 1.4, 0xa89880, 0.1, 0.55);
  }
  // The flag leans at the first stage and hangs torn at the second.
  rig.flag.rotation.z = stage === 1 ? 0.32 : 0.62;
  if (stage === 2) {
    rig.cloth.scale.set(0.58, 0.85, 1);
    rig.cloth.position.set(0.03 + 0.55 * 0.58 * 0.5, 0.6, 0);
    rig.cloth.rotation.z = -0.5;
    (rig.cloth.material as THREE.MeshToonMaterial).color.multiplyScalar(0.62);
  }
  // Cracks run over the walls.
  rig.cracks.visible = true;
  rig.cracks.geometry.setDrawRange(0, stage * CRACK_QUADS_PER_STAGE * 6);
  markShadowsDirty(b);
}

/**
 * Per-frame tower and building work after the shared unit update: aim the
 * cannon and the tower crew, refresh the HP number and the king's sleep
 * bubble, and degrade wounded crown towers.
 */
export function updateTower(b: Battle3D, view: EntityView, e: Entity, dt: number): void {
  const w = toWorld(e.x, e.y);
  if (view.barrel) {
    const target = targetOf(b, e);
    if (target) {
      const tw = toWorld(target.x, target.y);
      view.barrel.rotation.y = Math.atan2(tw.x - w.x, tw.z - w.z);
    }
  }
  // A new tower or building changes what casts shadows.
  if (!view.root.userData.shadowsMarked) {
    view.root.userData.shadowsMarked = true;
    markShadowsDirty(b);
  }

  // Tower crew: aim at the target, swing on attack, and let the
  // sleeping king slump over his battlements.
  if (view.defender && view.defenderMount) {
    const target = targetOf(b, e);
    const swing = attackSwing(e, target !== undefined);
    animateTroop(view.defender, {
      moving: false,
      swing,
      time: b.syncState.time,
      phase: e.id * 1.7,
    });
    if (target) {
      const tw = toWorld(target.x, target.y);
      view.defenderMount.rotation.y = Math.atan2(tw.x - w.x, tw.z - w.z);
    } else {
      view.defenderMount.rotation.y = e.side === "player" ? Math.PI : 0;
    }
    const asleep = e.kind === "king-tower" && !e.active;
    view.defenderMount.rotation.x = asleep ? 0.45 : 0;
  }

  if (view.hpText) updateHpText(view.hpText, e.hp);
  if (view.zzz) view.zzz.visible = !e.active;

  // Wounded crown towers visibly degrade: masonry bursts off as each
  // damage threshold is crossed (crenels, flag, cracks), then the tower
  // smoulders — light smoke below 2/3 HP, thick black smoke and embers
  // below 1/3.
  if (e.kind === "princess-tower" || e.kind === "king-tower") {
    const rig = rigs.get(view.root);
    if (rig) rig.b = b;
    const frac = e.hp / e.maxHp;
    const stage = frac < 1 / 3 ? 2 : frac < 2 / 3 ? 1 : 0;
    const towerTop = e.kind === "king-tower" ? 3.4 : 2.7;
    const was = view.dmgStage ?? 0;
    if (stage > was) {
      view.dmgStage = stage;
      b.fx.emit("chips", e.x, e.y, { z: towerTop * 0.4 });
      emitSparks(b, e.x, e.y, towerTop * 0.6, 10, 4.5, 1.5, stage === 2 ? 0xff8c42 : 0xa89880, 0.11, 0.6);
      addShake(b, 0.22);
      if (rig) showDamage(b, rig, e, was, stage);
    }
    if ((view.dmgStage ?? 0) > 0) {
      view.smokeT = (view.smokeT ?? 0) - dt;
      if (view.smokeT <= 0) {
        view.smokeT = view.dmgStage === 2 ? 0.4 : 0.9;
        const ox = e.x + (Math.random() - 0.5) * 0.9;
        const oy = e.y + (Math.random() - 0.5) * 0.9;
        b.fx.emit("smoke", ox, oy, { z: towerTop, color: view.dmgStage === 2 ? 0x3a332c : 0x776f64 });
        if (view.dmgStage === 2) {
          emitSparks(b, ox, oy, towerTop, 2, 2.5, 1.2, 0xff8c42, 0.07, 0.5);
        }
      }
    }
  }
}

// ---- Collapse -----------------------------------------------------------------

const BOX = new THREE.Box3();
const INV = new THREE.Matrix4();
const CENTER = new THREE.Vector3();
const SIZE = new THREE.Vector3();
const SHIFT = new THREE.Vector3();
const Q_INV = new THREE.Quaternion();

/**
 * Turn a fallen tower's chunks into debris: re-pivot each flying chunk on
 * its own centre (so it tumbles about itself), plan the throw, and take
 * over the fade from the generic death so the pieces stay solid in the air.
 */
function startCollapse(d: DyingView, rig: TowerRig): Collapse {
  const root = d.view.root;
  d.duration = COLLAPSE_TIME + SINK_TIME;
  const mats = d.fadeMats;
  d.fadeMats = [];
  for (const m of mats) m.opacity = 1;
  for (const o of rig.plate) o.visible = false;
  root.updateMatrixWorld(true);
  INV.copy(root.matrixWorld).invert();
  const chunks: THREE.Object3D[] = [];
  const starts: ChunkStart[] = [];
  for (const name of CHUNK_ORDER) {
    const chunk = rig.chunks.get(name);
    if (!chunk) continue;
    BOX.setFromObject(chunk).applyMatrix4(INV); // root-local bounds
    if (BOX.isEmpty()) continue;
    BOX.getCenter(CENTER);
    BOX.getSize(SIZE);
    // Move the pivot to the centre without moving the parts.
    SHIFT.copy(CENTER).sub(chunk.position).applyQuaternion(Q_INV.copy(chunk.quaternion).invert());
    for (const child of chunk.children) child.position.sub(SHIFT);
    chunk.position.copy(CENTER);
    chunks.push(chunk);
    starts.push({
      name,
      x: CENTER.x,
      y: CENTER.y,
      z: CENTER.z,
      // The heavy wall slumps into its own crater; light pieces lie on it.
      restY: Math.max(0.05, Math.min(SIZE.x, SIZE.y, SIZE.z) * (name === "wall" ? 0.2 : 0.35)),
    });
  }
  return {
    plan: planCollapse(rig.id, starts),
    chunks,
    rest: chunks.map((c) => c.rotation.clone()),
    landed: chunks.map(() => false),
    mats,
  };
}

/**
 * Towers come apart (see towerCollapse.ts), then their remains sink and
 * fade; buildings lean a touch and sink into the ground.
 */
export function updateTowerDeath(d: DyingView, f: number): void {
  const rig = rigs.get(d.view.root);
  if (!rig) {
    const ease = f * f;
    d.view.root.rotation.z = d.topple * ease;
    d.view.root.position.y = -1.6 * ease;
    return;
  }
  const c = (rig.collapse ??= startCollapse(d, rig));
  const t = d.t;
  const root = d.view.root;
  for (let i = 0; i < c.chunks.length; i++) {
    const m = c.plan[i];
    const p = chunkPose(m, t);
    const chunk = c.chunks[i];
    chunk.position.set(p.x, p.y, p.z);
    const r = c.rest[i];
    chunk.rotation.set(r.x + p.rx, r.y + p.ry, r.z + p.rz);
    if (p.landed && !c.landed[i]) {
      c.landed[i] = true;
      // A puff of dust where each chunk thumps down.
      const b = rig.b;
      if (b) {
        const ax = root.position.x + ARENA_WIDTH / 2 + p.x * TOWER_SCALE;
        const ay = root.position.z + ARENA_HEIGHT / 2 + p.z * TOWER_SCALE;
        b.fx.emit("dust", ax, ay, { radius: 0.9, color: LOOK.tower.plinth });
      }
    }
  }
  if (t > COLLAPSE_TIME) {
    const s = Math.min(1, (t - COLLAPSE_TIME) / SINK_TIME);
    root.position.y = -1.6 * s * s;
    for (const mat of c.mats) mat.opacity = 1 - s;
  }
}

// ---- Rubble, crater and dust ----------------------------------------------------

/** Shared radial "crater" stain (legacy FX only; the FX layer draws its own). */
let craterTex: THREE.CanvasTexture | null = null;

function craterTexture(): THREE.CanvasTexture {
  if (craterTex) return craterTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rand = seededRandom(97);
  // A dusty pale rim, a ragged scorched hollow, and cracks running out of it.
  const rim = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S / 2);
  rim.addColorStop(0, "rgba(120,98,70,0.55)");
  rim.addColorStop(0.7, "rgba(150,126,92,0.3)");
  rim.addColorStop(1, "rgba(150,126,92,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * S * 0.12;
    const r = S * (0.16 + rand() * 0.12);
    const blot = ctx.createRadialGradient(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r);
    blot.addColorStop(0, "rgba(30,22,15,0.75)");
    blot.addColorStop(0.7, "rgba(40,30,20,0.45)");
    blot.addColorStop(1, "rgba(40,30,20,0)");
    ctx.fillStyle = blot;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.strokeStyle = "rgba(26,18,12,0.85)";
  ctx.lineCap = "round";
  for (let i = 0; i < 7; i++) {
    let a = (i / 7) * Math.PI * 2 + rand() * 0.5;
    let x = S / 2 + Math.cos(a) * S * 0.2;
    let y = S / 2 + Math.sin(a) * S * 0.2;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      a += (rand() - 0.5) * 0.8;
      x += Math.cos(a) * 7;
      y += Math.sin(a) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  craterTex = new THREE.CanvasTexture(c);
  craterTex.colorSpace = THREE.SRGBColorSpace;
  craterTex.userData.shared = true;
  return craterTex;
}

/** Rubble shard colours for the current arena's towers. */
function rubbleColors(): number[] {
  const t = LOOK.tower;
  // Islamic towers break into marble and glazed teal tile.
  if (arabic) return [t.platformPlayer, t.plinth, LOOK.islamic?.dome ?? THEME.teal, t.battlement];
  return [t.plinth, t.battlement, t.platformPlayer];
}

/**
 * Permanent pile of broken masonry where a tower used to stand, in the
 * arena's own tower stone. It heaps up while the tower comes down.
 */
export function dropRubble(b: Battle3D, ax: number, ay: number, king: boolean): THREE.Group {
  const w = toWorld(ax, ay);
  const pile = new THREE.Group();
  const base = king ? 1.7 : 1.4;
  const stones = king ? 11 : 8;
  const colors = rubbleColors();
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + i * 1.7;
    const r = (i % 3) * 0.3 + 0.2;
    const s = 0.5 - (i % 3) * 0.13;
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(s * base, s * 0.7, s * base),
      toon(colors[i % colors.length]),
    );
    stone.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    stone.rotation.set(0, a, (i % 5) * 0.12);
    stone.castShadow = true;
    pile.add(stone);
  }
  batchStatic(pile, () => false, { tint: true });
  pile.position.set(w.x, 0, w.z);
  b.scene.add(pile);
  b.rubble.push(pile);
  return pile;
}

/** A dark scorched hollow under a fallen tower (when the FX layer has no decals). */
function legacyCrater(pile: THREE.Group, radius: number): void {
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({ map: craterTexture(), transparent: true, depthWrite: false }),
  );
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = 0.06; // above the floor's lane and zone overlays
  crater.renderOrder = -1;
  pile.add(crater);
}

/** A rising column of dust puffs (when the FX layer has no 'smoke-column'). */
function legacySmokeColumn(b: Battle3D, ax: number, ay: number, king: boolean): void {
  const driver = new THREE.Group();
  let next = 0;
  let n = 0;
  const color = LOOK.tower.plinth;
  b.addEffect(driver, 1.3, (frac) => {
    const t = (1 - frac) * 1.3;
    while (t >= next && n < 9) {
      const jitter = ((n * 37) % 10) / 10 - 0.5;
      puff(b, ax + jitter * 0.8, ay - jitter * 0.6, color, (king ? 1.5 : 1.2) + n * 0.12, 0.3 + n * 0.45);
      n++;
      next += 0.13;
    }
  });
}

/** A tower or building destroyed, or a king woken. */
export function towersOnEvent(b: Battle3D, ev: BattleEvent): void {
  switch (ev.type) {
    case "death": {
      if (ev.kind === "troop") break;
      puff(b, ev.x, ev.y, 0x8b7c69, 1.6);
      if (ev.kind === "building") break;
      const king = ev.kind === "king-tower";
      crownPop(b, ev.x, ev.y);
      b.cheer = 1.8; // the stands go wild
      // Dust billows up as the keep comes apart, and leaves a crater.
      const legacy = b.fx instanceof LegacyFx;
      const craterR = king ? 2.2 : 1.7;
      b.fx.emit("smoke-column", ev.x, ev.y, { radius: king ? 1.6 : 1.2, color: LOOK.tower.plinth });
      b.fx.decal("crater", ev.x, ev.y, craterR, { life: 600 });
      if (legacy) legacySmokeColumn(b, ev.x, ev.y, king);
      const pile = dropRubble(b, ev.x, ev.y, king);
      // The rubble heaps up while the chunks rain down.
      const stones = [...pile.children];
      for (const s of stones) s.scale.y = 0.05;
      if (legacy) legacyCrater(pile, craterR);
      // (The driver outlives the growth, so the heap always finishes.)
      const growLife = COLLAPSE_TIME + SINK_TIME;
      b.addEffect(new THREE.Group(), growLife, (frac) => {
        const t = (1 - frac) * growLife;
        const k = Math.min(1, Math.max(0, (t - 0.25) / (COLLAPSE_TIME - 0.25)));
        const y = 0.05 + 0.95 * k * k * (3 - 2 * k);
        for (const s of stones) s.scale.y = y;
      });
      emitSparks(b, ev.x, ev.y, 1.3, king ? 24 : 16, 6, 1.55, 0xf6c14e, 0.14, 0.8);
      contactRing(b, ev.x, ev.y, king ? 2.8 : 2.1, 0xf6c14e);
      addShake(b, king ? 0.9 : 0.55);
      if (king) {
        // The match-winning blow: time stops, then the camera leans in.
        b.hitStop.punch(0.25);
        startKoZoom(b, ev.x, ev.y);
      } else {
        b.hitStop.punch(0.07);
      }
      break;
    }
    case "king-wake":
      kingWakeBurst(b, ev.side);
      b.hitStop.punch(0.06);
      break;
    default:
      break;
  }
}
