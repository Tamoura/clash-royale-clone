/**
 * Crown towers: the keep (towerCraft.ts: one mesh, one draw, both
 * editions), its crew, HP plate and per-look dressing (towerStyles.ts);
 * per-frame aiming; damage stages (cracks and a chipped merlon below 70%
 * HP; more merlons, a hole in the roof, a torn banner and a smoke wisp
 * below 40%); and the fall: the keep splits into a few chunks that topple
 * with dust (towerCollapse.ts) and leaves a ruin (a jagged stump, a rubble
 * heap, a scorched ring and the fallen banner). A king's fall stops time
 * and pulls the camera in.
 *
 * Team colours (roofs, domes, trim, banner, flag, HP bar, level shield)
 * follow the team the viewer sees, teamSide() from troops.ts, so an online
 * guest's own towers wear the player colours like their troops do, and
 * they repaint live when the colour-blind palette pref changes. Where
 * things sit and which way they face stays on the sim side.
 *
 * The crew comes from a provider when one is registered
 * (setTowerCrewProvider, shared rules 4), else the hand-built crew.
 */
import * as THREE from "three";
import type { BattleEvent, Entity } from "../../../game/battle";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../../game/arena";
import {
  animateTroop,
  articulate,
  buildTowerCannoneer,
  buildTowerDuchess,
  buildTowerKing,
  buildTowerPrincess,
  type TroopRig,
} from "../../characters3d";
import { teamColor, teamPalette } from "../../teamColors";
import { onPrefs, type TeamPalette } from "../../../ui/prefs";
import { bakeRig } from "../../rigBake";
import {
  CHUNK_ORDER,
  COLLAPSE_TIME,
  SINK_TIME,
  chunkPose,
  planCollapse,
  type ChunkMotion,
  type ChunkName,
  type ChunkStart,
} from "../../towerCollapse";
import { ARABIC } from "../../theme";
import type { Battle3D } from "../../scene3d";
import type { Side } from "../../../game/arena";
import { LOOK, SPAWN_POP_TIME, arabic, targetOf, toWorld, viewSide, type DyingView, type EntityView } from "../common";
import { craftKeep, craftRuin, keepUniformsOf, type KeepBuild, type KeepChunk, type KeepUniforms } from "./towerCraft";
import {
  PLATE_CLEAR_PX,
  clampPlate,
  platePlacement,
  screenUp,
  towerDamageStage,
  towerFlair,
  towerStyle,
  UP_Y,
  UP_Z,
  type PlateSpot,
  type TowerEdition,
} from "./towerStyles";
import { onionDome } from "../arena/build";
import { addShake, startKoZoom } from "../camera";
import { markShadowsDirty, registerTroopCaster } from "../post";
import { contactRing, crownPop, emitSparks, kingWakeBurst, puff } from "../fx/effects";
import { floorDust } from "../fx/pool";
import { attackSwing, isFrozen } from "./animate";
import {
  collectFlashMats,
  makeHpBar,
  makeHpText,
  makeLevelBadge,
  makeZzzSprite,
  setHpFillColor,
  teamSide,
  unitHpColor,
  updateHpText,
} from "./troops";

/** The colours a crown tower wears, by the team the viewer sees it on. */
export interface TowerTeamColors {
  /** Viewer-relative team: "player" is always yours. */
  team: Side;
  /** Roofs, domes, trim, banner and flag cloth: the live team colour (colour-blind pair included). */
  cloth: number;
  /** HP bar fill (green/red, or the colour-blind pair). */
  hp: number;
}

/**
 * Team colours for a tower of sim side `side` under the current viewpoint,
 * in the team palette pref (colour-blind pair included).
 */
export function towerTeamColors(side: Side, palette: TeamPalette = teamPalette()): TowerTeamColors {
  const team = teamSide(side);
  return { team, cloth: teamColor(team, "main", palette), hp: unitHpColor(team, palette) };
}

/**
 * Cosmetic tower flair tier, set from the player's trophy road: 0 = plain,
 * 1 (600+) = gilded trim and finials, 2 (1200+) = a jeweled crest and gold
 * roof bands too. Applies at tower build time (each battle rebuilds its towers).
 */
let TOWER_FLAIR = 0;
export function setTowerFlair(tier: number): void {
  TOWER_FLAIR = Math.max(0, Math.min(2, Math.floor(tier)));
}

/** Towers stand 1.1x (CR's true 3x3 / 4x4 footprints with a landmark bump). */
export const TOWER_SCALE = 1.1;

// ---- Crew seam (shared rules 4) ---------------------------------------------------------

export type TowerCrewKind = "tower-princess" | "tower-king" | "cannoneer" | "duchess";

/** What the crew is doing this frame. */
export interface TowerCrewState {
  attacking: boolean;
  /** The tower's attack cooldown (seconds until the next shot) and its hit speed. */
  cooldown: number;
  hitSpeed: number;
  /** A king that has not woken yet. */
  asleep: boolean;
  frozen: boolean;
}

/** A crew a provider made: the group to mount (feet at its origin) and its head-top height, world units. */
export interface TowerCrewUnit {
  group: THREE.Group;
  height: number;
}

/**
 * Supplies tower crews (cast-kit's towerCrewProvider). `side` is the
 * VIEWER-relative team the crew wears; `make` may return null for a kind it
 * cannot build, and the tower then keeps the hand-built crew.
 */
export interface TowerCrewProvider {
  make(kind: TowerCrewKind, side: Side, edition: TowerEdition): TowerCrewUnit | null;
  animate(unit: TowerCrewUnit, s: TowerCrewState, dt: number): void;
  dispose(unit: TowerCrewUnit): void;
}

let crewProvider: TowerCrewProvider | null = null;

/** Register (or clear, with null) the tower crew provider. Towers built afterwards use it. */
export function setTowerCrewProvider(p: TowerCrewProvider | null): void {
  crewProvider = p;
}

/** The registered crew provider, if any. */
export function towerCrewProvider(): TowerCrewProvider | null {
  return crewProvider;
}

/** The crew kind for a tower entity. */
export function crewKindOf(e: Pick<Entity, "kind" | "towerTroop">): TowerCrewKind {
  if (e.kind === "king-tower") return "tower-king";
  if (e.towerTroop === "cannoneer") return "cannoneer";
  if (e.towerTroop === "duchess") return "duchess";
  return "tower-princess";
}

/** Hand-built crew scale: about 0.75 of a field archer, inside the parapet. */
const FALLBACK_CREW_SCALE = { king: 0.85, crew: 0.8 };

type Crew =
  | { kind: "provider"; unit: TowerCrewUnit; provider: TowerCrewProvider; height: number }
  | { kind: "fallback"; rig: TroopRig; height: number };

/** Build the crew for a tower: the provider's, else the hand-built one (baked like a field troop). */
function buildCrew(e: Entity, team: Side): Crew {
  const kind = crewKindOf(e);
  const p = crewProvider;
  if (p) {
    const unit = p.make(kind, team, ARABIC ? "golden" : "classic");
    if (unit) return { kind: "provider", unit, provider: p, height: unit.height / TOWER_SCALE };
  }
  const king = kind === "tower-king";
  const rig =
    kind === "tower-king"
      ? buildTowerKing()
      : kind === "cannoneer"
        ? buildTowerCannoneer()
        : kind === "duchess"
          ? buildTowerDuchess()
          : buildTowerPrincess();
  if (king) shortenCrownPoints(rig);
  articulate(rig);
  const scale = king ? FALLBACK_CREW_SCALE.king : FALLBACK_CREW_SCALE.crew;
  rig.group.scale.setScalar(scale);
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  // Bake the crew like a field troop: one mesh and one ink hull per limb.
  bakeRig(rig, `tower-${king ? "king" : (e.towerTroop ?? "princess")}:${team}:${ARABIC ? "arabic" : "normal"}:default`);
  return { kind: "fallback", rig, height: rig.height * scale };
}

/**
 * The hand-built king's crown is a capped gold drum ringed by five tall
 * points: from the steep camera it reads as a gold disc with petals (the
 * "sunflower"). Open the drum into a band, so his hair shows inside, and
 * shorten the points.
 */
function shortenCrownPoints(rig: TroopRig): void {
  for (const o of rig.group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh) continue;
    if (m.geometry instanceof THREE.ConeGeometry && Math.abs(m.position.y - 1.52) < 0.05) {
      m.scale.set(0.9, 0.62, 0.9);
      m.position.set(m.position.x * 1.08, 1.47, m.position.z * 1.08);
    } else if (m.geometry instanceof THREE.CylinderGeometry && Math.abs(m.position.y - 1.36) < 0.02) {
      const p = m.geometry.parameters;
      if (p.openEnded) continue;
      m.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 16, 1, true);
      (m.material as THREE.Material).side = THREE.DoubleSide;
    }
  }
}

// ---- Live team repaint -------------------------------------------------------------------

interface TeamLive {
  root: THREE.Object3D;
  team: Side;
  uniforms: KeepUniforms[];
  hpFill?: THREE.Mesh;
}
const teamLive = new Set<TeamLive>();
let livePalette: TeamPalette | null = null;

/** The keep roof colour for a viewer team in a palette. */
function roofColor(team: Side, palette: TeamPalette): number {
  return teamColor(team, "main", palette);
}

/** Repaint every live tower and ruin for a palette (roofs, trim, banner, flag, HP fill). */
export function repaintTowers(palette: TeamPalette): void {
  for (const t of teamLive) {
    if (!t.root.parent) continue; // not on stage (yet, or any more)
    for (const u of t.uniforms) u.uTeam.value.setHex(roofColor(t.team, palette));
    if (t.hpFill) setHpFillColor(t.hpFill, unitHpColor(t.team, palette));
  }
}

function trackTeam(entry: TeamLive): void {
  if (livePalette === null) {
    livePalette = teamPalette();
    onPrefs((p) => {
      if (p.teamPalette === livePalette) return;
      livePalette = p.teamPalette;
      repaintTowers(p.teamPalette);
    });
  }
  if (teamLive.size > 48) for (const t of teamLive) if (!t.root.parent) teamLive.delete(t);
  teamLive.add(entry);
}

// ---- Tower rig -----------------------------------------------------------------------

/** Everything about a crown tower's mesh the damage, plate and collapse code needs. */
interface TowerRig {
  id: number;
  king: boolean;
  keep: KeepBuild;
  /** The cannon's own mesh (aims at the target; rises when a king wakes). */
  gun: THREE.Object3D | null;
  crew: Crew;
  mount: THREE.Group;
  camSide: number;
  /** Sim side "player" towers sit at the bottom for the host. */
  far: boolean;
  /** HP plate, number and sleep bubble: hidden once the tower falls. */
  plate: THREE.Object3D[];
  bar: THREE.Group;
  text: THREE.Sprite;
  /** Silhouette extremes (screen-up, local units) for the plate maths. */
  top: number;
  foot: number;
  spot: PlateSpot | null;
  /** The king's slump (1 asleep, eases to 0 when he wakes). */
  slump: number;
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

/** Plate half-height (local units): the level shield is its tallest part. */
export const PLATE_HALF = 0.3;
/** How far in front of the tower (toward the camera) the plate floats, local units. */
const PLATE_LIFT = 6;

export function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.28 : 0.95;
  const height = king ? 2.7 : 2.15; // the same massing in both editions
  const colors = towerTeamColors(e.side);
  const camSide = viewSide === "player" ? 1 : -1;
  // The cannon aims toward the opposing side.
  const facing = e.side === "player" ? -1 : 1;
  const edition: TowerEdition = arabic ? "golden" : "classic";
  const style = towerStyle(LOOK, edition);
  const crew = buildCrew(e, colors.team);

  const keep = craftKeep({
    king,
    radius,
    height,
    team: colors.cloth,
    enemyTeam: colors.team === "enemy",
    camSide,
    facing,
    gun: king || e.towerTroop === "cannoneer",
    flair: towerFlair(TOWER_FLAIR),
    style,
    dome: onionDome,
    crewHeight: crew.height,
  });
  root.add(keep.mesh);
  const gun = keep.gunMesh;
  if (gun) root.add(gun);

  const view: Partial<EntityView> & { root: THREE.Group } = { root, rig: null };

  // Crew stands on the deck (or the king's dais), inside the crenellations.
  const mount = new THREE.Group();
  mount.name = "defenderMount";
  mount.userData.noBatch = true;
  mount.position.copy(keep.crew);
  root.add(mount);
  if (crew.kind === "provider") {
    // Provider crews are sized in world units: undo the tower's scale.
    crew.unit.group.scale.multiplyScalar(1 / TOWER_SCALE);
    mount.add(crew.unit.group);
  } else {
    mount.add(crew.rig.group);
    view.defender = crew.rig;
  }
  // A provider's crew is one skinned draw: it casts like a field troop, one
  // registered caster that follows the live level (post.ts), so the static
  // map of the lower levels never freezes a crew's pose. The hand-built crew
  // is many limbs: tiny on the roof, not worth a shadow pass.
  mount.traverse((o) => (o.castShadow = false));
  const caster = crew.kind === "provider" ? crew.unit.group.getObjectByProperty("isMesh", true) : undefined;
  if (caster) registerTroopCaster(caster);
  view.defenderMount = mount;

  const plate: THREE.Object3D[] = [];
  if (king) {
    const zzz = makeZzzSprite();
    zzz.position.set(keep.crew.x + 0.55, keep.crew.y + crew.height * 0.95, keep.crew.z);
    root.add(zzz);
    view.zzz = zzz;
    plate.push(zzz);
  }

  // CR plate: a chunky pill with the HP number inside and a level shield
  // riding its left end. Placed every frame (placePlate).
  const barWidth = king ? 2.8 : 2.3;
  const bar = makeHpBar(barWidth, colors.hp, 0, 0.36);
  bar.group.userData.noBatch = true;
  root.add(bar.group);
  view.hpGroup = bar.group;
  view.hpFill = bar.fill;
  const badge = makeLevelBadge(e.side);
  badge.scale.set(0.7, 0.7, 1);
  badge.position.set(-barWidth / 2 - 0.12, 0, 0.06);
  bar.group.add(badge);
  const hpText = makeHpText(0);
  hpText.sprite.scale.set(1.75, 0.64, 1);
  root.add(hpText.sprite);
  view.hpText = hpText.text;
  plate.push(bar.group, hpText.sprite);

  view.flashMats = collectFlashMats(root);
  view.lastHp = e.hp;
  view.flashT = 0;
  view.spawnT = SPAWN_POP_TIME; // towers don't pop in
  view.isTroop = false;
  view.baseScale = TOWER_SCALE;
  root.scale.setScalar(TOWER_SCALE);

  // Silhouette extremes on screen (local screen-up units from the tower's foot).
  let top = -Infinity;
  for (const p of keep.tops) top = Math.max(top, screenUp(p.y, p.z, camSide));
  top = Math.max(top, screenUp(keep.crew.y + crew.height, keep.crew.z, camSide));
  let foot = Infinity;
  for (const p of keep.feet) foot = Math.min(foot, screenUp(p.y, p.z, camSide));
  const far = e.side !== viewSide;

  const rig: TowerRig = {
    id: e.id,
    king,
    keep,
    gun,
    crew,
    mount,
    camSide,
    far,
    plate,
    bar: bar.group,
    text: hpText.sprite,
    top,
    foot,
    spot: null,
    slump: king && !e.active ? 1 : 0,
    b: null,
    collapse: null,
  };
  placePlate(rig, platePlacement(top, foot, PLATE_HALF, 0.2, far));
  rigs.set(root, rig);
  trackTeam({ root, team: colors.team, uniforms: [keep.uniforms], hpFill: bar.fill });
  return view as EntityView;
}

/**
 * A tower's plate layout (for tests and tools): the silhouette's top and
 * foot and the plate's spot, in screen-up local units from the tower's foot.
 */
export function towerPlateInfo(view: EntityView): { top: number; foot: number; spot: PlateSpot; camSide: number; far: boolean } | null {
  const rig = rigs.get(view.root);
  return rig && rig.spot ? { top: rig.top, foot: rig.foot, spot: rig.spot, camSide: rig.camSide, far: rig.far } : null;
}

/** The keep's uniforms (team colour, damage stage) for a tower view. */
export function towerKeepUniforms(view: EntityView): KeepUniforms | null {
  return rigs.get(view.root)?.keep.uniforms ?? null;
}

/** Put the plate's centre at screen-up `spot.s`, floated toward the camera so nothing hides it. */
function placePlate(rig: TowerRig, spot: PlateSpot): void {
  rig.spot = spot;
  const y0 = spot.s / UP_Y;
  const y = y0 + PLATE_LIFT * UP_Z;
  const z = PLATE_LIFT * UP_Y * rig.camSide;
  rig.bar.position.set(0, y, z);
  // Damage numbers start at the plate (animate.ts): the height over the
  // tower's foot at which the floated plate shows on screen, world units.
  rig.bar.userData.popupY = y0 * TOWER_SCALE;
  // The number sits just in front of the bar as the camera sees it.
  rig.text.position.set(0, y + 0.2 * UP_Z, z + 0.2 * UP_Y * rig.camSide);
}

const V = new THREE.Vector3();

/** CSS px kept between a near plate and the card tray's top edge (its markers sit just above it). */
export const PLATE_TRAY_GAP_PX = 8;

/**
 * Keep the plate on screen and clear of the roofs and crew: the clearance is
 * held in screen px (at least PLATE_CLEAR_PX), and a plate that would leave
 * the screen, or slide under the HUD, flips to the tower's other side.
 */
function updatePlate(b: Battle3D, rig: TowerRig, root: THREE.Object3D): void {
  const cam = b.camera;
  const h = b.renderer.domElement.clientHeight || 1;
  const viewH = (cam.top - cam.bottom) / cam.zoom;
  const ppu = (h / viewH) * TOWER_SCALE; // CSS px per local unit
  const clear = Math.max(0.12, (PLATE_CLEAR_PX + 2) / ppu);
  const ins = b.framing?.insets;
  root.getWorldPosition(V);
  V.applyMatrix4(cam.matrixWorldInverse);
  const footUp = V.y; // camera-up of the tower's foot
  const screenTop = (cam.top / cam.zoom - (ins?.top ?? 0) / (ppu / TOWER_SCALE) - footUp) / TOWER_SCALE;
  // The tray's top edge carries its markers above the inset: keep a gap over it.
  const trayGap = (ins?.bottom ?? 0) > 0 ? PLATE_TRAY_GAP_PX : 0;
  const screenBottom = (cam.bottom / cam.zoom + ((ins?.bottom ?? 0) + trayGap) / (ppu / TOWER_SCALE) - footUp) / TOWER_SCALE;
  const want = platePlacement(rig.top, rig.foot, PLATE_HALF, clear, rig.far);
  const minClear = PLATE_CLEAR_PX / ppu; // the art bible's floor; `clear` adds 2 px of margin
  const spot = clampPlate(want, rig.top, rig.foot, PLATE_HALF, clear, screenTop, screenBottom, minClear);
  if (!rig.spot || Math.abs(rig.spot.s - spot.s) > 1e-3) placePlate(rig, spot);
}

/**
 * The sleeping king's forward slump (the crew mount's rotation.x) for a
 * slump of 1 (asleep) easing to 0 (awake). The tilt turns about the
 * tower's X axis after the mount's yaw (Euler XYZ), so its sign picks the
 * world z it leans toward: always the camera's side, so the guest (camera
 * at -z) also sees the king nod toward them, face and crown out from under
 * the canopy, never leaning back under it. A provider's crew nods less.
 */
export function kingSlumpTilt(slump: number, camSide: number, provider: boolean): number {
  const k = Math.max(0, Math.min(1, slump));
  return camSide * (provider ? 0.3 : 0.45) * k * k * (3 - 2 * k);
}

/**
 * Per-frame tower and building work after the shared unit update: aim the
 * cannon and the tower crew, place the HP plate, refresh the HP number and
 * the king's sleep bubble, and degrade wounded crown towers.
 */
export function updateTower(b: Battle3D, view: EntityView, e: Entity, dt: number): void {
  const w = toWorld(e.x, e.y);
  // A new tower or building changes what casts shadows.
  if (!view.root.userData.shadowsMarked) {
    view.root.userData.shadowsMarked = true;
    markShadowsDirty(b);
  }
  const rig = rigs.get(view.root);
  if (rig) {
    rig.b = b;
    const target = targetOf(b, e);
    const asleep = e.kind === "king-tower" && !e.active;
    // The cannon swings to its target; a sleeping king's lies low and rises as he wakes.
    rig.slump = asleep ? 1 : Math.max(0, rig.slump - dt / 0.35);
    if (rig.gun) {
      const rest = e.side === "player" ? Math.PI : 0;
      let yaw = rest;
      if (target) {
        const tw = toWorld(target.x, target.y);
        yaw = Math.atan2(tw.x - w.x, tw.z - w.z);
      }
      rig.gun.rotation.y = yaw;
      const k = rig.king ? rig.slump * rig.slump * (3 - 2 * rig.slump) : 0;
      rig.gun.position.y = rig.keep.gunAt.y - 0.3 * k;
      rig.gun.rotation.x = 0.35 * k;
    }
    // Crew: aim at the target, fire on the tower's attack beat; the
    // sleeping king slumps over his dais and stands when he wakes. Idle,
    // the king faces the camera, the others the opposing side.
    const mount = rig.mount;
    if (target) {
      const tw = toWorld(target.x, target.y);
      mount.rotation.y = Math.atan2(tw.x - w.x, tw.z - w.z);
    } else {
      mount.rotation.y = rig.king ? (rig.camSide > 0 ? 0 : Math.PI) : e.side === "player" ? Math.PI : 0;
    }
    mount.rotation.x = kingSlumpTilt(rig.slump, rig.camSide, rig.crew.kind === "provider");
    if (rig.crew.kind === "fallback") {
      const swing = attackSwing(e, target !== undefined);
      animateTroop(rig.crew.rig, { moving: false, swing, time: b.syncState.time, phase: e.id * 1.7 });
    } else {
      rig.crew.provider.animate(
        rig.crew.unit,
        { attacking: target !== undefined && !asleep, cooldown: e.cooldown, hitSpeed: e.hitSpeed, asleep, frozen: isFrozen(b, e) },
        dt,
      );
    }
    updatePlate(b, rig, view.root);
  }

  if (view.hpText) updateHpText(view.hpText, e.hp);
  if (view.zzz) view.zzz.visible = !e.active;

  // Wounded crown towers visibly degrade (see the file header); masonry
  // bursts off as each threshold is crossed, and a single wisp of smoke
  // rises from the broken roof once it is badly hurt.
  if (rig && (e.kind === "princess-tower" || e.kind === "king-tower")) {
    const stage = towerDamageStage(e.hp, e.maxHp);
    const was = view.dmgStage ?? 0;
    if (stage > was) {
      view.dmgStage = stage;
      showDamage(b, rig, e, was, stage);
    }
    if (view.dmgStage === 2) {
      view.smokeT = (view.smokeT ?? 0) - dt;
      if (view.smokeT <= 0) {
        view.smokeT = 0.75;
        const p = rig.keep.smoke;
        b.fx.emit("smoke", e.x + p.x * TOWER_SCALE, e.y + p.z * TOWER_SCALE, { z: p.y * TOWER_SCALE + 0.2, color: 0x6f675e, radius: 0.32 });
      }
    }
  }
}

/** Show damage stage `stage` (1 below 70% HP, 2 below 40%) on the keep. */
function showDamage(b: Battle3D, rig: TowerRig, e: Entity, from: number, stage: number): void {
  rig.keep.uniforms.uStage.value = stage;
  const top = rig.top * TOWER_SCALE;
  for (let k = from + 1; k <= stage; k++) {
    for (const p of rig.keep.chips[k] ?? []) {
      b.fx.emit("chips", e.x + p.x * TOWER_SCALE, e.y + p.z * TOWER_SCALE, { z: p.y * TOWER_SCALE, radius: 0.6 });
      emitSparks(b, e.x + p.x * TOWER_SCALE, e.y + p.z * TOWER_SCALE, p.y * TOWER_SCALE, 5, 3.2, 1.3, 0xa89880, 0.09, 0.5);
    }
  }
  b.fx.emit("chips", e.x, e.y, { z: Math.max(1.5, top * 0.45) });
  addShake(b, 0.22);
  markShadowsDirty(b);
}

// ---- Collapse -----------------------------------------------------------------

/** Which keep chunk each collapse piece is (the base stays as the ruin's stump). */
const CHUNK_OF: Partial<Record<ChunkName, KeepChunk>> = { upper: "upper", front: "front", back: "back", canopy: "canopy" };

const BOX = new THREE.Box3();
const CENTER = new THREE.Vector3();
const SIZE = new THREE.Vector3();
const P = new THREE.Vector3();

/** A rigid piece of the keep: the vertices of one chunk range, re-pivoted on their centre. */
function chunkPiece(keep: KeepBuild, chunk: KeepChunk): THREE.Group | null {
  const r = keep.ranges.get(chunk);
  if (!r) return null;
  const src = keep.mesh.geometry;
  const pos = src.getAttribute("position");
  BOX.makeEmpty();
  for (let i = r.start; i < r.start + r.count; i++) BOX.expandByPoint(P.fromBufferAttribute(pos, i));
  BOX.getCenter(CENTER);
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
  g.setDrawRange(r.start, r.count);
  g.boundingSphere = new THREE.Sphere(CENTER.clone(), BOX.getSize(SIZE).length() / 2 + 0.5);
  g.userData.sharedAttributes = true;
  const mesh = new THREE.Mesh(g, keep.mesh.material);
  mesh.customDepthMaterial = keep.mesh.customDepthMaterial;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.position.copy(CENTER).negate();
  const pivot = new THREE.Group();
  pivot.name = chunk;
  pivot.position.copy(CENTER);
  pivot.add(mesh);
  return pivot;
}

/**
 * Turn a fallen tower into falling pieces: the roofs and turrets (front and
 * back pairs), the upper keep, the king's canopy and the crew each become a
 * rigid chunk; the base hides (the ruin's stump stands in its place).
 */
function startCollapse(d: DyingView, rig: TowerRig): Collapse {
  const root = d.view.root;
  d.duration = COLLAPSE_TIME + SINK_TIME;
  const mats = d.fadeMats;
  d.fadeMats = [];
  for (const m of mats) m.opacity = 1;
  for (const o of rig.plate) o.visible = false;
  rig.keep.mesh.visible = false;
  if (rig.gun) rig.gun.visible = false;
  const chunks: THREE.Object3D[] = [];
  const starts: ChunkStart[] = [];
  for (const name of CHUNK_ORDER) {
    let piece: THREE.Object3D | null;
    if (name === "crew") {
      // The crew tumbles about its own feet (the mount's pivot).
      piece = rig.mount;
      CENTER.copy(piece.position);
      SIZE.set(0.6, rig.crew.height, 0.6);
    } else {
      const chunk = CHUNK_OF[name];
      piece = chunk ? chunkPiece(rig.keep, chunk) : null;
      if (!piece) continue;
      if (name === "upper" && rig.gun) {
        // The cannon rides the upper keep down.
        rig.gun.visible = true;
        piece.attach(rig.gun);
      }
      root.add(piece);
      CENTER.copy(piece.position);
      const m = piece.children[0] as THREE.Mesh;
      const r = rig.keep.ranges.get(CHUNK_OF[name]!)!;
      BOX.makeEmpty();
      const pos = m.geometry.getAttribute("position");
      for (let i = r.start; i < r.start + r.count; i++) BOX.expandByPoint(P.fromBufferAttribute(pos, i));
      BOX.getSize(SIZE);
    }
    chunks.push(piece);
    starts.push({
      name,
      x: CENTER.x,
      y: CENTER.y,
      z: CENTER.z,
      restY: Math.max(0.12, Math.min(SIZE.x, SIZE.y, SIZE.z) * (name === "upper" ? 0.3 : 0.35)),
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
        b.fx.emit("dust", ax, ay, { radius: 0.9, color: collapseDust() });
      }
    }
  }
  if (t > COLLAPSE_TIME) {
    const s = Math.min(1, (t - COLLAPSE_TIME) / SINK_TIME);
    root.position.y = -1.6 * s * s;
    for (const mat of c.mats) mat.opacity = 1 - s;
  }
}

// ---- The ruin -------------------------------------------------------------------------

/**
 * What a fallen tower leaves where it stood (towerCraft.ts craftRuin): the
 * stump at once, the rubble heap and fallen banner heaping up while the
 * chunks rain down. It wears the tower's team colour (repainted live).
 */
export function dropRubble(b: Battle3D, ax: number, ay: number, king: boolean, side: Side = ay < ARENA_HEIGHT / 2 ? "enemy" : "player", seed = Math.round(ax * 31 + ay * 17)): THREE.Group {
  const w = toWorld(ax, ay);
  const team = teamSide(side);
  const { stump, heap } = craftRuin({
    king,
    radius: king ? 1.28 : 0.95,
    team: teamColor(team, "main", teamPalette()),
    enemyTeam: team === "enemy",
    camSide: viewSide === "player" ? 1 : -1,
    style: towerStyle(LOOK, arabic ? "golden" : "classic"),
    seed,
  });
  const pile = new THREE.Group();
  pile.name = "ruin";
  pile.add(stump, heap);
  pile.position.set(w.x, 0, w.z);
  pile.scale.setScalar(TOWER_SCALE);
  b.scene.add(pile);
  b.rubble.push(pile);
  const uniforms = [stump, heap].map((m) => keepUniformsOf(m)).filter((u): u is KeepUniforms => u !== null);
  trackTeam({ root: pile, team, uniforms });
  return pile;
}

/**
 * Collapse dust: the floor's own dust lifted about 20% toward white, so a
 * falling keep raises the court's dust and never a near-black cloud (it took
 * the plinth colour: on the dark looks a black smoke wall).
 */
export function collapseDust(): number {
  return new THREE.Color(floorDust(LOOK)).lerp(new THREE.Color(0xfff6e6), 0.2).getHex();
}

/** A ruin's scorched ground: a soft decal tinted toward the floor, at most 0.6 opaque. */
export const RUIN_SCORCH_ALPHA = 0.55;

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
      // Dust billows up as the keep comes apart; a soft scorch stays (the
      // scorch decal's colour leans toward the floor's dust: no black pit).
      const craterR = king ? 2.4 : 1.9;
      b.fx.emit("smoke-column", ev.x, ev.y, { radius: king ? 1.6 : 1.2, color: collapseDust() });
      b.fx.decal("scorch", ev.x, ev.y, craterR, { life: 600, alpha: RUIN_SCORCH_ALPHA });
      const pile = dropRubble(b, ev.x, ev.y, king, ev.side);
      // The heap rises while the chunks rain down (the stump is there at once).
      const heap = pile.children[1];
      heap.scale.y = 0.05;
      const growLife = COLLAPSE_TIME + SINK_TIME;
      b.addEffect(new THREE.Group(), growLife, (frac) => {
        const t = (1 - frac) * growLife;
        const k = Math.min(1, Math.max(0, (t - 0.25) / (COLLAPSE_TIME - 0.25)));
        heap.scale.y = 0.05 + 0.95 * k * k * (3 - 2 * k);
      });
      emitSparks(b, ev.x, ev.y, 1.3, king ? 18 : 12, 6, 1.55, 0xf6c14e, 0.12, 0.7);
      contactRing(b, ev.x, ev.y, king ? 2.8 : 2.1, 0xf6c14e);
      addShake(b, king ? 0.9 : 0.55);
      markShadowsDirty(b);
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
