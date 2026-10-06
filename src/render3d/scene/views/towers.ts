/**
 * Crown towers: the keep mesh with its crew, HP plate and edition dressing,
 * per-frame aiming and damage stages, the sink-away death, and the rubble,
 * crown and cheer when one falls.
 */
import * as THREE from "three";
import type { BattleEvent, Entity } from "../../../game/battle";
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
import { addShake } from "../camera";
import { contactRing, crownPop, emitSparks, kingWakeBurst, puff } from "../fx/effects";
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

export function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.28 : 0.95;
  const height = king ? 2.35 : 1.85;

  // Two-step stone platform under the keep, gold-trimmed like CR.
  // Neon arena: the whole tower is team-colored (enemy magenta, player
  // blue) like the reference screenshot; the Arabic edition stays sand.
  const enemySide = e.side === "enemy";
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.9, 0.18, radius * 2.9),
    toon(enemySide ? LOOK.tower.platformEnemy : LOOK.tower.platformPlayer),
  );
  platform.position.y = 0.09;
  platform.castShadow = true;
  platform.receiveShadow = true;
  root.add(platform);
  const platTrim = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.95, 0.06, radius * 2.95),
    toon(0xd9a93f),
  );
  platTrim.position.y = 0.2;
  root.add(platTrim);
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.3, 0.3, radius * 2.3),
    toon(LOOK.tower.plinth),
  );
  plinth.position.y = 0.32;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

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
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

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
      pillar.castShadow = true;
      root.add(pillar);
    }
  }
  const baseCourse = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.1, 0.26, radius * 2.1),
    toon(LOOK.tower.plinth),
  );
  baseCourse.position.y = 0.6;
  baseCourse.castShadow = true;
  root.add(baseCourse);

  // Gold trim band under the battlements (CR's royal touch).
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.15, 0.14, radius * 2.15),
    toon(0xf2c14e),
  );
  trim.position.y = height - 0.16;
  trim.castShadow = true;
  root.add(trim);

  // Merlons along the four roof edges — taller CR battlements.
  const merlon = toon(LOOK.tower.battlement);
  const gildCap = TOWER_FLAIR >= 1 ? toon(0xf2c14e) : null;
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.2), merlon);
      a.position.set(i * radius * 0.7, height + 0.16, side * radius * 0.92);
      a.castShadow = true;
      root.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.38, 0.34), merlon);
      b.position.set(side * radius * 0.92, height + 0.16, i * radius * 0.7);
      b.castShadow = true;
      root.add(b);
      if (gildCap) {
        // Trophy-road flair: gilded caps on every battlement.
        const capA = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.22), gildCap);
        capA.position.set(i * radius * 0.7, height + 0.38, side * radius * 0.92);
        root.add(capA);
        const capB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.36), gildCap);
        capB.position.set(side * radius * 0.92, height + 0.38, i * radius * 0.7);
        root.add(capB);
      }
    }
  }
  if (TOWER_FLAIR >= 2) {
    // Veteran crest: a ruby set in gold on the tower's river-facing wall.
    const crestSide = e.side === "player" ? -1 : 1;
    const setting = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), toon(0xf2c14e));
    setting.rotation.x = Math.PI / 2;
    setting.position.set(0, height * 0.62, crestSide * (radius + 0.03));
    root.add(setting);
    const ruby = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), toon(0xe0314a));
    ruby.position.set(0, height * 0.62, crestSide * (radius + 0.08));
    root.add(ruby);
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
        root.add(cup);
      }
    }
    const rearZ = facing * -radius * 0.5;
    if (king) {
      const dome = onionDome(radius * 0.62, domeColor);
      dome.position.set(0, height + 0.05, rearZ);
      root.add(dome);
    } else {
      const fin = crescentFinial(0.55);
      fin.position.set(0, height + 0.2, rearZ);
      root.add(fin);
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
        cap.castShadow = true;
        root.add(cap);
        const goldTip = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 0.07, 8, 6),
          toon(0xf6c14e),
        );
        goldTip.position.set(sx * radius * 0.78, height + 0.72, sz * radius * 0.78);
        root.add(goldTip);
      }
    }
    if (king) {
      const crownDeck = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.62, radius * 0.72, 0.18, 8),
        toon(0xf6c14e),
      );
      crownDeck.position.set(0, height + 0.2, -facing * radius * 0.4);
      crownDeck.castShadow = true;
      root.add(crownDeck);
    }

    // CR-signature gun platform: a timber deck with a chunky cannon aimed
    // downlane (offset so the tower crew keeps center stage).
    const deckPlanks = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.92, radius * 0.98, 0.1, 10),
      toon(0x8a5c2e),
    );
    deckPlanks.position.y = height + 0.02;
    deckPlanks.castShadow = true;
    root.add(deckPlanks);
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
    barrel.castShadow = true;
    gun.add(barrel);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry((king ? 0.16 : 0.12) + 0.025, (king ? 0.16 : 0.12) + 0.025, 0.08, 10),
      toon(0xf6c14e),
    );
    band.rotation.x = facing * 1.35;
    band.position.set(0, 0.16, facing * 0.12);
    gun.add(band);
    root.add(gun);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), toon(0x4a3826));
  door.position.set(0, 0.62, facing * radius * 1.01);
  root.add(door);

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
    root.add(emblem);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.7, 0.06),
    toon(SIDE_COLOR[e.side]),
  );
  banner.position.set(0, height - 0.62, facing * radius * 1.03);
  root.add(banner);
  const bannerTip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 4), toon(SIDE_COLOR[e.side]));
  bannerTip.rotation.x = Math.PI;
  bannerTip.rotation.y = Math.PI / 4;
  bannerTip.position.set(0, height - 1.05, facing * radius * 1.03);
  root.add(bannerTip);

  // Team flag, planted off-center so the tower crew has the roof.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6),
    toon(0x5a4632),
  );
  pole.position.set(-radius * 0.6, height + 0.5, 0);
  root.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.32),
    new THREE.MeshToonMaterial({ color: SIDE_COLOR[e.side], side: THREE.DoubleSide }),
  );
  flag.position.set(-radius * 0.6 + 0.3, height + 0.72, 0);
  root.add(flag);

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
  outlineRig(defender.group);
  defender.group.scale.setScalar(king ? 0.85 : 0.8);
  if (defender.arm) defender.arm.rotation.x = defender.armRest;
  const mount = new THREE.Group();
  mount.position.y = height + 0.18;
  mount.add(defender.group);
  mount.traverse((o) => (o.castShadow = false)); // tiny on the roof; not worth a shadow pass
  root.add(mount);
  view.defender = defender;
  view.defenderMount = mount;

  if (king) {
    const zzz = makeZzzSprite();
    zzz.position.y = height + 2.0;
    root.add(zzz);
    view.zzz = zzz;
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

  // The keep never moves: merge its ~50 stone/trim/gun parts by look.
  batchStatic(root, (o) => o === mount || o === bar.group);
  view.flashMats = collectFlashMats(root);
  view.lastHp = e.hp;
  view.flashT = 0;
  view.spawnT = SPAWN_POP_TIME; // towers don't pop in
  view.isTroop = false;
  // Measured against real CR: at 1.5x a princess tower read 4.1 tiles wide
  // vs CR's 3.0. 1.1x lands both towers on CR's true 3x3 / 4x4 footprints
  // while keeping a slight landmark bump.
  view.baseScale = 1.1;
  root.scale.setScalar(1.1);
  return view as EntityView;
}

/** Permanent pile of broken masonry where a tower used to stand. */
export function dropRubble(b: Battle3D, ax: number, ay: number, king: boolean): void {
  const w = toWorld(ax, ay);
  const pile = new THREE.Group();
  const base = king ? 1.4 : 1.1;
  const stones = king ? 9 : 6;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + i * 1.7;
    const r = (i % 3) * 0.3 + 0.2;
    const s = 0.5 - (i % 3) * 0.13;
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(s * base, s * 0.7, s * base),
      toon(i % 2 ? 0x9b8d7b : 0x8b7c69),
    );
    stone.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    stone.rotation.set(0, a, (i % 5) * 0.12);
    stone.castShadow = true;
    pile.add(stone);
  }
  pile.position.set(w.x, 0, w.z);
  b.scene.add(pile);
  b.rubble.push(pile);
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
  // damage threshold is crossed, then the tower smoulders — light smoke
  // below 2/3 HP, thick black smoke and embers below 1/3.
  if (e.kind === "princess-tower" || e.kind === "king-tower") {
    const frac = e.hp / e.maxHp;
    const stage = frac < 1 / 3 ? 2 : frac < 2 / 3 ? 1 : 0;
    const towerTop = e.kind === "king-tower" ? 3.4 : 2.7;
    if (stage > (view.dmgStage ?? 0)) {
      view.dmgStage = stage;
      puff(b, e.x, e.y, 0x8b7c69, 1.1, towerTop * 0.4);
      emitSparks(b, e.x, e.y, towerTop * 0.6, 10, 4.5, 1.5, stage === 2 ? 0xff8c42 : 0xa89880, 0.11, 0.6);
      addShake(b, 0.22);
    }
    if ((view.dmgStage ?? 0) > 0) {
      view.smokeT = (view.smokeT ?? 0) - dt;
      if (view.smokeT <= 0) {
        view.smokeT = view.dmgStage === 2 ? 0.4 : 0.9;
        const ox = e.x + (Math.random() - 0.5) * 0.9;
        const oy = e.y + (Math.random() - 0.5) * 0.9;
        puff(b, ox, oy, view.dmgStage === 2 ? 0x3a332c : 0x776f64, 0.5, towerTop);
        if (view.dmgStage === 2) {
          emitSparks(b, ox, oy, towerTop, 2, 2.5, 1.2, 0xff8c42, 0.07, 0.5);
        }
      }
    }
  }
}

/** Towers and buildings lean a touch and sink into the ground. */
export function updateTowerDeath(d: DyingView, f: number): void {
  const ease = f * f;
  d.view.root.rotation.z = d.topple * ease;
  d.view.root.position.y = -1.6 * ease;
}

/** A tower or building destroyed, or a king woken. */
export function towersOnEvent(b: Battle3D, ev: BattleEvent): void {
  switch (ev.type) {
    case "death":
      if (ev.kind === "troop") break;
      puff(b, ev.x, ev.y, 0x8b7c69, 1.6);
      if (ev.kind !== "building") {
        crownPop(b, ev.x, ev.y);
        b.cheer = 1.8; // the stands go wild
        dropRubble(b, ev.x, ev.y, ev.kind === "king-tower");
        emitSparks(
          b,
          ev.x,
          ev.y,
          1.3,
          ev.kind === "king-tower" ? 24 : 16,
          6,
          1.55,
          0xf6c14e,
          0.14,
          0.8,
        );
        contactRing(b, ev.x, ev.y, ev.kind === "king-tower" ? 2.8 : 2.1, 0xf6c14e);
        addShake(b, ev.kind === "king-tower" ? 0.9 : 0.55);
        b.hitStop.punch(ev.kind === "king-tower" ? 0.1 : 0.07);
      }
      break;
    case "king-wake":
      kingWakeBurst(b, ev.side);
      b.hitStop.punch(0.06);
      break;
    default:
      break;
  }
}
