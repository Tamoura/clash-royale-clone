/**
 * The arena stage: the painted playfield, edging, stands and crowd,
 * scenery, the living river band with its bridges, the stadium backdrop,
 * night light pools, ambient weather, and Arabic ornaments (domes,
 * finials, lanterns, arch gateways) shared with the towers. Everything
 * static is batched.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, BRIDGE_XS, RIVER_Y, towerSpots } from "../../../game/arena";
import type { BattleEvent } from "../../../game/battle";
import { reducedMotion } from "../../../ui/prefs";
import { toon } from "../../characters3d";
import { batchStatic } from "../../staticBatch";
import { THEME } from "../../theme";
import type { QualityLevel } from "../../quality";
import { stagePalette } from "../../arenaLooks";
import type { Battle3D } from "../../scene3d";
import { LOOK, arabic, toWorld, unlitGlow, viewSide } from "../common";
import { skyHorizon } from "../sky";
import { buildAmbient, disposeAmbient, updateAmbient, type Ambient } from "./ambient";
import { buildBackdrop, type Backdrop } from "./backdrop";
import { buildClassicBridges } from "./bridges";
import { buildTufts } from "./tufts";
import { makeCrowd, poseCrowd, type Crowd, type CrowdSeat } from "./crowd";
import { groundTexture, hashString } from "./groundPaint";
import { LightPools, type LightSpot } from "./lightPools";
import { buildRiver, type RiverHandle } from "./river";
import { buildClassicScenery } from "./scenery";
import { buildGoldenSurround } from "./golden";
import { Sculpt, sculptMaterial, tone } from "../views/towerCraft";

/** Everything the arena art keeps per Battle3D between frames. */
interface ArenaArt {
  backdrop: Backdrop;
  river: RiverHandle;
  pools: LightPools;
  ambient: Ambient | null;
  /** Crowd seats 0..kitSeats-1 belong to the backdrop stand (host-view x/z). */
  kitSeats: Array<{ x: number; z: number }>;
  /** The quality level the set was last dressed for. */
  level: QualityLevel | null;
  /** The instanced chibi crowd (null when there are no seats). */
  crowd: Crowd | null;
  /** Side strips (forest, outer ring) and where their inner edge sits. */
  sides: Array<{ obj: THREE.Object3D; innerX: number; allowed: boolean }>;
  /** Seconds of tower-hit wave left, and the clock it runs on. */
  wave: number;
  waveT: number;
  /** The crowd stands at its rest pose (nothing to update while still). */
  posedStill?: boolean;
}
const ART = new WeakMap<Battle3D, ArenaArt>();

/** Side stands stand this far out; in portrait they sit just off-frame. */
const STAND_X = 11.25;
/** The stands' field-side face: past this the crowd is off-screen. */
const STAND_INNER_X = STAND_X - 0.8;

// Instanced-pose scratch (no per-frame allocation).
const SKY_TINT = new THREE.Color();
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

/** Hand the crowd to the scene (2 draws) and keep its posing state. */
function installCrowd(b: Battle3D, seats: CrowdSeat[]): Crowd | null {
  const crowd = makeCrowd(seats, stagePalette(LOOK).crowdTeamShare);
  if (!crowd) return null;
  b.crowd = { bodies: crowd.bodies, heads: crowd.heads, seats: seats.map((s) => new THREE.Vector2(s.x, s.z)) };
  b.arenaGroup.add(crowd.bodies, crowd.heads);
  return crowd;
}

type Seat = CrowdSeat;

/**
 * Set dressing around the court: the apron, the surround (scenery.ts for
 * Classic, golden.ts for the Golden Age: stands, crowd seats, pavilions or
 * souk awnings, the forest or the town), lantern strings and the bridge
 * torches or lanterns. Returns the crowd seats and appends every light to
 * `lights`. (The far band and the near band belong to the backdrop.)
 */
export function decorate(b: Battle3D, lights: LightSpot[]): Seat[] {
  // Outer apron framing the arena.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(ARENA_WIDTH + 46, 0.36, ARENA_HEIGHT + 10), toon(LOOK.apron));
  apron.position.y = -0.24;
  apron.receiveShadow = true;
  b.arenaGroup.add(apron);

  const seats: Seat[] = arabic ? buildGoldenSurround(b.arenaGroup, LOOK) : buildClassicScenery(b.arenaGroup, LOOK);

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
        const ly = y + Math.sin(i * 2.3) * 0.15;
        const ci = i + (sz > 0 ? 1 : 0);
        stringLantern(-12 + i * 4, ly, sz * dz, ci);
        lights.push({
          x: -12 + i * 4, y: ly - 0.4, z: sz * dz, color: lanternColors[ci % lanternColors.length],
          radius: 1.7, end: sz > 0 ? "player" : "enemy",
        });
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
        const ci = i + (sx > 0 ? 1 : 0);
        stringLantern(sx * sideX, 4.6 + Math.sin(i * 1.7) * 0.18, z, ci);
        lights.push({ x: sx * sideX, y: 4.2, z, color: lanternColors[ci % lanternColors.length], radius: 1.6 });
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
        lights.push({ x: w.x + 1.2, y: 1.12, z: sz * 2.2, color: 0xffb347, radius: 1.9 });
      } else {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), toon(LOOK.fencePost));
        pole.position.set(w.x + 1.45, 0.55, sz * 2.2);
        pole.castShadow = true;
        b.arenaGroup.add(pole);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), b.glow(LOOK.torch));
        flame.position.set(w.x + 1.45, 1.2, sz * 2.2);
        b.arenaGroup.add(flame);
        lights.push({ x: w.x + 1.45, y: 1.2, z: sz * 2.2, color: LOOK.torch, radius: 2.0 });
      }
    }
  }

  return seats;
}

/** The crescent inlay's colour: the look's emblem gold at this share over the floor plaster. */
export const EMBLEM_CONTRAST = 0.25;
/** The crescent's size against the old 2.5-unit inlay. */
export const EMBLEM_SCALE = 0.62;

/**
 * Flat crescent moon inlaid in the floor: small and at a quarter of its old
 * contrast (art bible section 3), a hint in the paving that never competes
 * with the units.
 */
export function makeCrescentEmblem(z: number): THREE.Group {
  const g = new THREE.Group();
  const R = 2.5 * EMBLEM_SCALE; // outer disc radius
  const r = 2.2 * EMBLEM_SCALE; // bite disc radius
  const cx = 1.5 * EMBLEM_SCALE; // bite offset; the crescent opens toward +x
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
  const floor = new THREE.Color(LOOK.islamic?.plaster ?? "#efe7cf");
  const inlay = floor.lerp(new THREE.Color(LOOK.islamic?.emblem ?? 0xe8b948), EMBLEM_CONTRAST);
  const crescent = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(inlay.getHex()));
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
  const prev = ART.get(b);
  if (prev) {
    // Points and instance buffers are not freed by disposeDeep.
    if (prev.ambient) disposeAmbient(prev.ambient);
    prev.pools.dispose();
  }
  // The painted playfield slab: a cached floor paint on its top face.
  const maxAniso = (b as unknown as { maxAniso?: number }).maxAniso ?? 4;
  const aniso = Math.min(maxAniso, b.renderer.capabilities.getMaxAnisotropy?.() ?? maxAniso);
  const fieldMat = new THREE.MeshToonMaterial({ map: groundTexture(LOOK, arabic, aniso) });
  const fieldGeo = new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.4, ARENA_HEIGHT);
  // The paint's row 0 is the enemy back line; the box's top face runs
  // v = 1 there, so flip that face's v (vertices 8-11).
  const uv = fieldGeo.getAttribute("uv");
  for (let i = 8; i < 12; i++) uv.setY(i, 1 - uv.getY(i));
  const field = new THREE.Mesh(fieldGeo, [
    toon(LOOK.fieldSide).clone(), // stone sides
    toon(LOOK.fieldSide).clone(),
    fieldMat, // top
    toon(LOOK.fieldSide).clone(),
    toon(LOOK.fieldSide).clone(),
    toon(LOOK.fieldSide).clone(),
  ]);
  field.position.set(0, -0.2, 0);
  field.receiveShadow = true;
  b.arenaGroup.add(field);

  // Edging around the playfield, post at each corner.
  const hw = ARENA_WIDTH / 2 + 0.45;
  const hd = ARENA_HEIGHT / 2 + 0.15;
  const stone = LOOK.edging;
  for (const side of arabic ? [-1, 1] : []) {
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
      if (arabic) b.arenaGroup.add(post);
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
  const tufts = buildTufts(LOOK);
  if (tufts) b.arenaGroup.add(tufts);
  const lights: LightSpot[] = [];
  const seats = decorate(b, lights);

  // The stadium backdrop behind the enemy king, with its own crowd stand
  // (seated first, so cheering can skip the off-screen side stands).
  const backdrop = buildBackdrop(LOOK, (c) => b.glow(c));
  b.arenaGroup.add(backdrop.group);
  const kitSeats: CrowdSeat[] = backdrop.seats.map((st) => ({ x: st.x, z: st.z, y: st.y, face: 0, side: "enemy" }));
  const crowd = installCrowd(b, [...kitSeats, ...seats]);
  for (const l of backdrop.lights) lights.push({ ...l, backdrop: true });

  // The Islamic lane strips are baked into the floor paint now.
  const river = finishArena(b);

  const pools = new LightPools(lights, LOOK.nightPools);
  b.arenaGroup.add(pools.group);
  const ambient = buildAmbient(LOOK, hashString(`ambient:${LOOK.id}`));
  if (ambient) b.arenaGroup.add(ambient.points);
  ART.set(b, {
    backdrop,
    river,
    pools,
    ambient,
    kitSeats: kitSeats.map((st) => ({ x: st.x, z: st.z })),
    level: null,
    crowd,
    sides: [],
    wave: 0,
    waveT: 0,
  });
  applyArenaQuality(b, b.quality.level);
  applyEndStrings(b);
  // Hundreds of static props -> a handful of draws: every lit toon prop
  // merges into one vertex-coloured mesh per shadow setting (the colour moves
  // to the vertices), so the per-frame shadow pass draws a few casters, not
  // dozens. The dimmable glow materials (the living sky retints them) stay
  // out of it and merge per colour in the second pass.
  const notToon = (o: THREE.Object3D): boolean =>
    o.userData.noBatch === true ||
    ((o as THREE.Mesh).isMesh === true && !((o as THREE.Mesh).material as THREE.Material & { isMeshToonMaterial?: boolean }).isMeshToonMaterial);
  batchStatic(b.arenaGroup, notToon, { tint: true });
  batchStatic(b.arenaGroup, (o) => o.userData.noBatch === true);
  // Warm every shader now (during the versus splash), not on the first frame.
  try {
    b.renderer.compile(b.scene, b.camera);
  } catch {
    // A failed warm-up only costs a hitch later.
  }
}

/** The arena art handles for this scene (tests and debugging). */
export function arenaArt(b: Battle3D): Readonly<ArenaArt> | undefined {
  return ART.get(b);
}

/** River band, bank lips, glints, emblems and bridges — both editions. */
export function finishArena(b: Battle3D): RiverHandle {
  // The mid-band: water, lava, ice, chasm or neon (see river.ts).
  const river = buildRiver(b.arenaGroup, LOOK);
  b.waterTex = null;
  // Water and ice keep a few instanced specular glints sliding over them.
  const glints = LOOK.band.kind === "water" || LOOK.band.kind === "ice";
  b.waterSparkles = !glints ? null : new THREE.InstancedMesh(
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
  if (b.waterSparkles) {
    b.waterSparkles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    b.waterSparkles.frustumCulled = false;
    b.arenaGroup.add(b.waterSparkles);
  }

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
  } else if (LOOK.band.bridge === "timber") {
    // Hand-built timber crossings: uneven planks over dark bearers, stone
    // abutments at both ends, and post-and-rope rails with capped posts.
    const sc = new Sculpt((_x, y, _z, ny) => (0.74 + 0.26 * Math.min(1, Math.max(0, y / 0.5))) * (ny > 0.7 ? 1.05 : ny < -0.4 ? 0.7 : 1));
    const WOODS = [0xc48a3c, 0xb47a30, 0xd29a48, 0xbb8236];
    const BEARER = 0x6b4520;
    const ABUT = tone(LOOK.cornerPost, 1.02, 0.5);
    let seed = 77;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      sc.box(2.0, 0.2, 2.5, BEARER, w.x, 0.08, 0);
      const planks = 10;
      const pd = 2.56 / planks;
      for (let i = 0; i < planks; i++) {
        const z = -1.28 + pd * (i + 0.5);
        sc.box(1.96 + (rnd() - 0.5) * 0.1, 0.06, pd - 0.035, WOODS[Math.floor(rnd() * WOODS.length)], w.x + (rnd() - 0.5) * 0.04, 0.21, z, (rnd() - 0.5) * 0.03);
        for (const sx of [-1, 1]) sc.box(0.04, 0.02, 0.04, 0x3b2a1a, w.x + sx * 0.78, 0.245, z, 0, () => 1);
      }
      for (const sz of [-1, 1]) {
        sc.box(2.5, 0.34, 0.34, ABUT, w.x, 0.1, sz * 1.42);
        sc.box(2.56, 0.06, 0.4, tone(ABUT, 1.12), w.x, 0.29, sz * 1.42);
      }
      for (const side of [-1, 1]) {
        const x = w.x + side * 0.98;
        sc.box(0.16, 0.14, 2.7, BEARER, x, 0.26, 0);
        const rope = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6);
        rope.rotateX(Math.PI / 2);
        sc.add(rope, 0xe2c48a, x, 0.66, 0);
        for (const ez of [-1.2, -0.4, 0.4, 1.2]) {
          sc.box(0.2, 0.62, 0.2, 0x8a5a2a, x, 0.5, ez);
          sc.box(0.26, 0.07, 0.26, 0xe8c15a, x, 0.84, ez);
        }
      }
    }
    const bridges = sc.mesh(sculptMaterial(), "timber-bridges");
    if (bridges) b.arenaGroup.add(bridges);
  } else {
    buildClassicBridges(b.arenaGroup, LOOK, (c) => b.glow(c));
  }

  return river;
}

/**
 * Viewpoint-dependent dressing: hide the lantern string nearest the camera
 * (it would cross our king), and turn the backdrop, its crowd and its
 * lights to stand behind whichever king is at the far end.
 */
export function applyEndStrings(b: Battle3D): void {
  if (b.endStringPlayer) b.endStringPlayer.visible = viewSide !== "player";
  if (b.endStringEnemy) b.endStringEnemy.visible = viewSide !== "enemy";
  const art = ART.get(b);
  if (!art) return;
  art.backdrop.orient(viewSide);
  art.pools.orient(viewSide, {
    player: !b.endStringPlayer || b.endStringPlayer.visible,
    enemy: !b.endStringEnemy || b.endStringEnemy.visible,
  });
  if (art.crowd) {
    // The far-band crowd turns with the backdrop to face the court.
    const flip = viewSide === "player" ? 1 : -1;
    art.kitSeats.forEach((st, i) => {
      const seat = art.crowd!.seats[i];
      seat.x = st.x * flip;
      seat.z = st.z * flip;
      seat.face = flip > 0 ? 0 : Math.PI;
      b.crowd?.seats[i]?.set(seat.x, seat.z);
    });
    poseCrowd(art.crowd, -1, 0, 0);
  }
}

/**
 * Per frame: the river, waterfall and glints flow, the weather drifts,
 * and the night lights follow the living sky.
 */
export function updateRiver(b: Battle3D, dt: number): void {
  b.waterTime += dt;
  const art = ART.get(b);
  if (art) {
    regionCull(b);
    const t = b.waterTime;
    const u = art.river.material.uniforms;
    u["uTime"].value = t;
    u["uNight"].value = b.dayPhase;
    (u["uSky"].value as THREE.Color).copy(skyHorizon(SKY_TINT));
    if (art.backdrop.waterfall) art.backdrop.waterfall.material.uniforms["uTime"].value = t;
    if (art.ambient) {
      const h = b.renderer.domElement.height || 1;
      updateAmbient(art.ambient, t, h / Math.max(1e-3, b.camera.top - b.camera.bottom), reducedMotion());
    }
    art.pools.update(b.dayPhase, b.syncState);
    // Far silhouettes sink into the night with the sky.
    art.backdrop.silhouettes.color.setScalar(1 - 0.55 * b.dayPhase);
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

/**
 * Crowd cheering: spectators hop while the cheer lasts. The side stands
 * only join in when the frame is wide enough to show them.
 */
export function updateCrowd(b: Battle3D, dt: number): void {
  const art = ART.get(b);
  const crowd = art?.crowd;
  const live = art?.level?.crowdAnim ?? false;
  const cheering = b.cheer > 0;
  if (cheering) b.cheer = Math.max(0, b.cheer - dt);
  if (art && art.wave > 0) art.wave = Math.max(0, art.wave - dt);
  if (!crowd || !art) return;
  // A crown always gets its jump; the idle bob and the tower-hit wave only
  // animate on the levels that keep the crowd alive.
  const wave = live ? Math.min(1, art.wave / 0.4) : 0;
  const jump = cheering ? Math.min(1, b.cheer / 0.3) : 0;
  if (!live && !cheering && !art.posedStill) {
    poseCrowd(crowd, -1, 0, 0);
    art.posedStill = true;
    return;
  }
  if (!live && !cheering) return;
  art.posedStill = false;
  const sidesOnScreen = b.showcase || Math.max(-b.camera.left, b.camera.right) > STAND_INNER_X;
  const n = sidesOnScreen ? Infinity : art.kitSeats.length;
  poseCrowd(crowd, b.waterTime, jump, wave, live ? 1 : 0, n);
}

/** Squared distance (tiles) within which an attack counts as a tower hit. */
const TOWER_HIT_R2 = 2.2 * 2.2;

/**
 * Arena reactions to battle events: the crowd waves when a tower is hit
 * (crowns make it jump: towers.ts sets b.cheer).
 */
export function arenaOnEvent(b: Battle3D, ev: BattleEvent): void {
  if (ev.type !== "attack") return;
  const art = ART.get(b);
  if (!art || art.wave > 0.3) return;
  for (const side of ["player", "enemy"] as const) {
    for (const t of towerSpots(side)) {
      const dx = ev.targetX - t.x;
      const dy = ev.targetY - t.y;
      if (dx * dx + dy * dy < TOWER_HIT_R2) {
        art.wave = 0.9;
        return;
      }
    }
  }
}

/**
 * Apply a quality level to the set: the dressing tier, tufts and whether the
 * crowd animates. Called by post.applyQuality on every level change.
 */
export function applyArenaQuality(b: Battle3D, level: QualityLevel): void {
  const art = ART.get(b);
  if (!art) return;
  art.level = level;
  // Tufts on the top three levels; the outer dressing (forest, town) from
  // 'full' and 'inner' down to nothing at 'min' is kept: L4 must still look
  // finished, and those meshes cast no shadow.
  art.sides = [];
  b.arenaGroup.traverse((o) => {
    if (o.userData.dressing === "tufts") o.visible = level.tufts;
    const mesh = o as THREE.Mesh;
    if ((o.userData.dressing === "outer" || o.userData.dressing === "forest") && mesh.isMesh) {
      // Region culling: a long strip's bounding sphere reaches the middle of
      // the court, so the frustum never culls it; the frame's half-width
      // against the strip's inner edge does (a portrait phone sees neither).
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const innerX = box.min.x > 0 ? box.min.x : box.max.x < 0 ? -box.max.x : 0;
      art.sides.push({ obj: o, innerX, allowed: o.userData.dressing === "forest" || level.dressing === "full" });
    }
  });
  regionCull(b);
}

/** Show each side strip only while the frame is wide enough to reach it. */
function regionCull(b: Battle3D): void {
  const art = ART.get(b);
  if (!art) return;
  const half = b.showcase ? Infinity : Math.max(-b.camera.left, b.camera.right);
  for (const s of art.sides) s.obj.visible = s.allowed && half > s.innerX;
}
