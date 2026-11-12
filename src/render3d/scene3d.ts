import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, type Side } from "../game/arena";
import {
  distance,
  type BattleEvent,
  type BattleState,
  type Entity,
} from "../game/battle";
import type { Card, CardId } from "../game/cards";
import { ShakeController } from "./shake";
import { HitStopController } from "./hitstop";
import { QualityGovernor, qualityPinFromUrl } from "./quality";
import { lookForArena } from "./arenaLooks";
import type { TroopRig } from "./characters3d";
import { prewarmBakes } from "./rigBake";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  CAM_HOME,
  LOOK,
  arabic,
  cameraZForView,
  disposeDeep,
  setLook,
  setViewSide,
  toWorld,
  viewSide,
  type DyingView,
  type EffectView,
  type EntityView,
} from "./scene/common";
import { applyEndStrings, arenaOnEvent, buildArena, updateCrowd, updateRiver } from "./scene/arena/build";
import { applyLookSky, buildLights, gradeSky, initSky, updateBirds } from "./scene/sky";
import {
  applyLookFog,
  applyFraming,
  applyShake,
  frameOrtho,
  initFog,
  koZoomActive,
  showcase,
  updateShowcase,
  type Framing,
} from "./scene/camera";
import {
  applyGrade,
  applyQuality,
  buildComposer,
  createRenderer,
  markShadowsDirty,
  maxAnisotropy,
  sampleQuality,
  setFlash,
} from "./scene/post";
import {
  deployFlash,
  emote,
  fxOnEvent,
  initFx,
  spawnFlourish,
  syncProjectiles,
  updateEffects,
} from "./scene/fx/effects";
import type { FxApi } from "./scene/fx/api";
import { resetComets, syncComets } from "./scene/fx/comet";
import { resetBurrows, syncBurrows } from "./scene/fx/burrow";
import {
  buildBuildingMesh,
  buildGhost,
  buildTroopMesh,
  loadGlbModels,
  isSwarmSized,
  makeLevelBadge,
} from "./scene/views/troops";
import {
  buildTowerMesh,
  setTowerCrewProvider,
  towersOnEvent,
  updateTower,
  updateTowerDeath,
  type TowerCrewProvider,
} from "./scene/views/towers";
import { beginDeath, updateTroop, updateTroopDeath, viewsOnEvent } from "./scene/views/animate";
import { castActiveForBattle, setLeanCamera } from "./cast/index";
import { towerCrewProvider as castCrewProvider } from "./cast/crew";
import { DeployOverlay, type LaneCallout, type RefuseReason, type ZoneParts } from "./scene/deployOverlay";
import { zoneModeFor } from "./deployZone";
import { reducedMotion } from "../ui/prefs";

// The scene's building blocks live in ./scene/ (arena, sky, camera, post,
// views, fx); Battle3D wires them together behind the same public API.
export { GAME_FONT, disposeDeep } from "./scene/common";
export { setTowerFlair } from "./scene/views/towers";
export { deploysAnywhere } from "./deployZone";

/**
 * Tower crews from the cast (cast/crew.ts, shared rules 4). Towers build
 * on the first sync after the battle latched its roster, so `make` asks
 * castActiveForBattle(): a battle that started on the procedural roster
 * keeps the hand-built crews too, even if the pack lands a moment later
 * (no mixing). Each battle rebuilds its towers.
 */
const castTowerCrews: TowerCrewProvider = {
  ...castCrewProvider,
  make(kind, side, edition) {
    return castActiveForBattle() ? castCrewProvider.make(kind, side, edition) : null;
  },
};

/** CR-readable spell telegraph colours. */
const SPELL_TINT: Partial<Record<CardId, number>> = {
  fireball: 0xff8c1a,
  zap: 0xffe566,
  arrows: 0x6ee7a0,
  rage: 0xff4db8,
  freeze: 0x7dd3fc,
  heal: 0x6ee7a0,
  tornado: 0x9aa3ad,
  "skeleton-barrel": 0xc9954a,
};

/** How long the refused-drop ring pulses (seconds). */
export const BAD_SPOT_SECONDS = 1.2;
/** A ghost on a "no" spot fades to this fraction of its opacity. */
export const GHOST_DIM = 0.4;

/*
 * Fields marked @internal are shared with the ./scene/ modules, which take
 * the Battle3D instance as their first argument; they are not public API.
 */
export class Battle3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Particles, decals, damage numbers and spell set pieces (a VfxPool, see fx/pool.ts). */
  fx!: FxApi;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly views = new Map<number, EntityView>();
  /** @internal Timed effects aged by the render loop (see addEffect). */
  effects: EffectView[] = [];
  /** @internal Views playing their death animation. */
  dying: DyingView[] = [];
  /** @internal The battle state being synced this frame. */
  syncState!: BattleState;
  /** @internal Entities by id for the frame being synced. */
  readonly byId = new Map<number, Entity>();
  /** Entity / projectile ids seen this sync (reused every frame). */
  private readonly seen = new Set<number>();
  /** @internal */
  readonly projSeen = new Set<number>();
  /** @internal The hover disc and ring under the finger (read by dev tools and the staging script). */
  readonly hoverDisc: THREE.Mesh;
  /** @internal */
  readonly hoverRing: THREE.Mesh;
  /** @internal Everything that belongs to the arena stage (rebuilt per look). */
  arenaGroup = new THREE.Group();
  /** @internal Living sky: 0 = daylight, 1 = deep night (driven by match time). */
  dayPhase = 0;
  /** @internal */
  lightningT = 0;
  private wasOvertime = false;
  /** @internal Lantern strings at each end of the field (see applyEndStrings). */
  endStringPlayer: THREE.Object3D | null = null;
  /** @internal */
  endStringEnemy: THREE.Object3D | null = null;
  /** @internal What the battle frame keeps clear of the HUD (null: the whole board, no insets). */
  framing: Framing | null = null;
  /** @internal Fog-immune glow materials (lanterns, neon, torches) with base colors. */
  glowMats: Array<{ mat: THREE.MeshBasicMaterial; base: THREE.Color }> = [];
  /** @internal The light rig (rebuilt with the look; graded by the living sky). */
  lightGroup = new THREE.Group();
  private hoverPulse = 0;
  private ghost: {
    id: CardId;
    rig: TroopRig;
    mats: { mat: THREE.Material; base: number }[];
    dim: boolean;
  } | null = null;
  /** @internal Trauma-based camera shake; big impacts punch harder than small ones. */
  readonly shakeCtl = new ShakeController();
  /** @internal */
  shakeTime = 0;
  /** Render-only hit-stop (does not touch the sim clock). */
  readonly hitStop = new HitStopController();
  /** @internal Rubble piles left by fallen towers; cleared on reset. */
  rubble: THREE.Object3D[] = [];
  /** @internal Sim projectile meshes by projectile id. */
  projViews = new Map<number, THREE.Object3D>();
  /** @internal Spectator bodies/heads; they jump when a crown falls. */
  crowd: { bodies: THREE.InstancedMesh; heads: THREE.InstancedMesh; seats: THREE.Vector2[] } | null =
    null;
  /** @internal Seconds of crowd cheering left. */
  cheer = 0;
  /** @internal Seconds until the next ambient bird flyover. */
  birdTimer = 4;
  /** @internal Scrolling river texture + accumulated flow time. */
  waterTex: THREE.CanvasTexture | null = null;
  /** @internal */
  waterSparkles: THREE.InstancedMesh | null = null;
  /** @internal */
  waterTime = 0;
  /** @internal Post-processing: render, thresholded bloom, then one fused final pass. */
  readonly composer: EffectComposer;
  /** @internal Steps resolution/bloom down on devices that can't hold the frame rate. */
  readonly quality = new QualityGovernor(qualityPinFromUrl(location.search));
  /** @internal */
  lastFrameAt = 0;
  /** @internal */
  readonly bloom: UnrealBloomPass;
  /** @internal Tone mapping, sRGB, per-arena grade, FXAA and flash in one pass. */
  finalPass!: ShaderPass;
  /** @internal Board width (CSS px) the edge shade fades out before; 0 = no shade (setEdgeShade). */
  edgeFieldW = 0;
  /** Shadow-map renders so far: shadows are static and re-render only when marked dirty. */
  shadowRenders = 0;
  /**
   * The placement map (scene/deployOverlay.ts): one plane whose shader draws
   * where the held card may go, and lights a lane's pocket the moment its
   * tower falls. A child of the scene, not the arena group, so a look rebuild
   * never disposes it.
   */
  readonly zone: DeployOverlay;
  /** @internal */
  readonly container: HTMLElement;
  private readonly onResize = (): void => this.resize();
  /** Follows the container itself, so CSS-only size changes (a layout flip) re-fit too. */
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    loadGlbModels(); // the modelled cast (KayKit pack, lazy chunk); battles latch it in main.ts afterCastGate
    setTowerCrewProvider(castTowerCrews);
    this.renderer = createRenderer(container);

    this.scene = new THREE.Scene();
    initSky(this);
    initFog(this);
    this.scene.add(this.arenaGroup);
    this.scene.add(this.lightGroup);

    // Orthographic = no perspective convergence, so the arena reads
    // as a perfectly straight board (not a trapezoid). Angled from
    // the player's elevated side, not straight down from the sky.
    this.camera = new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120);
    this.camera.position.copy(CAM_HOME);
    this.camera.lookAt(0, 0, 0);
    frameOrtho(this);
    initFx(this); // pooled particles, decals, damage numbers (fx/pool.ts)

    buildLights(this);
    buildArena(this);

    this.hoverDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
    );
    this.hoverDisc.rotation.x = -Math.PI / 2;
    this.hoverDisc.position.y = 0.03;
    this.hoverDisc.visible = false;
    this.scene.add(this.hoverDisc);

    // Outer telegraph ring (spells / buildings / troop feet) — pulses in render().
    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.62, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.position.y = 0.04;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    this.zone = new DeployOverlay({ golden: arabic });
    this.zone.setView(viewSide);
    this.zone.setLook(LOOK);
    this.scene.add(this.zone.mesh);

    const post = buildComposer(this);
    this.composer = post.composer;
    this.bloom = post.bloom;

    this.resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", this.onResize);
    } else {
      // setSize(w, h, false) never touches the container's own size: no loop.
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(container);
    }
  }

  /** @internal Light rig handles, re-graded every frame by the living sky. */
  hemi!: THREE.HemisphereLight;
  /** @internal */
  sun!: THREE.DirectionalLight;
  /** @internal */
  fillLight!: THREE.DirectionalLight;

  /**
   * Stage the arena for a trophy-road arena id (normal edition only — the
   * Arabic bazaar is a single fixed look). Rebuilds the set and light rig
   * when the look actually changes; call before reset() for a new battle.
   */
  setArenaLook(arenaId: string, force = false): void {
    const next = lookForArena(arenaId, arabic);
    if (next.id === LOOK.id && !force) return;
    setLook(next);
    for (const g of [this.arenaGroup, this.lightGroup]) {
      for (const child of [...g.children]) {
        g.remove(child);
        disposeDeep(child);
      }
    }
    this.crowd = null;
    this.glowMats = [];
    applyLookSky(this);
    applyLookFog(this);
    buildLights(this);
    buildArena(this);
    applyGrade(this);
    this.zone.setLook(LOOK);
  }

  /** @internal An unlit, fog-immune, bloom-ready glow material the living sky can dim. */
  glow(color: number): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color, fog: false });
    mat.toneMapped = false;
    this.glowMats.push({ mat, base: new THREE.Color(color) });
    return mat;
  }

  /** Anisotropic filtering for ground textures (capped at 4x). */
  get maxAniso(): number {
    return maxAnisotropy(this.renderer);
  }

  /** Additive white over the whole frame, 0..1 (for spell impacts). */
  setFlash(a: number): void {
    setFlash(this, a);
  }

  /** Current look id (for tests / debugging). */
  get arenaLookId(): string {
    return LOOK.id;
  }

  /** @internal Whether the home diorama framing is on. */
  showcase = false;
  /** @internal */
  showcaseT = 0;
  /** @internal Fraction of the canvas height (from the top) the home window covers. */
  showcaseWindow = 0.5;

  /**
   * Home-screen diorama: frame the arena small inside the top window of
   * the home screen and let the camera sway slowly around it. Any battle
   * start (setViewpoint) turns it off again.
   */
  setShowcase(on: boolean, windowFrac = 0.5): void {
    showcase(this, on, windowFrac);
  }

  /**
   * Keep the board clear of the HUD: its insets around the canvas and the
   * content box to fit (see ui/layoutWire.ts). Re-fits only on a change.
   */
  setFraming(f: Framing): void {
    applyFraming(this, f);
  }

  resize(): void {
    applyQuality(this);
    frameOrtho(this);
  }

  /**
   * Choose which side sits at the bottom of the screen. The host views as
   * "player" (default); an online guest views as "enemy" so they too look at
   * their own towers from below. Call before a match builds its entities.
   */
  setViewpoint(side: Side): void {
    setViewSide(side);
    if (this.showcase) this.setShowcase(false);
    applyEndStrings(this);
    this.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    this.camera.lookAt(0, 0, 0);
    this.zone.setView(side);
  }

  /** Convert a pointer event to arena tile coordinates, if on the field. */
  /** Arena point (tiles) at height `h` → page coordinates, for DOM effects. */
  arenaToClient(ax: number, ay: number, h = 0): { x: number; y: number } {
    const w = toWorld(ax, ay);
    const v = new THREE.Vector3(w.x, h, w.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    if (koZoomActive(this)) return null; // the frame is moving under the finger
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const ax = hit.x + ARENA_WIDTH / 2;
    const ay = hit.z + ARENA_HEIGHT / 2;
    if (ax < 0 || ax > ARENA_WIDTH || ay < 0 || ay > ARENA_HEIGHT) return null;
    return { x: ax, y: ay };
  }

  setHover(
    pos: { x: number; y: number } | null,
    radiusTiles: number,
    spell: boolean,
    valid = true,
    cardId: CardId | null = null,
  ): void {
    if (!pos) {
      this.hoverDisc.visible = false;
      this.hoverRing.visible = false;
      return;
    }
    const w = toWorld(pos.x, pos.y);
    this.hoverDisc.visible = true;
    this.hoverRing.visible = true;
    this.hoverDisc.position.set(w.x, 0.03, w.z);
    this.hoverRing.position.set(w.x, 0.04, w.z);
    const scale = Math.max(0.35, radiusTiles / 0.6);
    this.hoverDisc.scale.setScalar(scale);
    this.hoverRing.scale.setScalar(scale);

    let tint = !valid ? 0xef4444 : spell ? 0xff8c1a : 0x4ade80;
    if (valid && spell && cardId && SPELL_TINT[cardId] !== undefined) {
      tint = SPELL_TINT[cardId]!;
    }
    (this.hoverDisc.material as THREE.MeshBasicMaterial).color.set(tint);
    (this.hoverRing.material as THREE.MeshBasicMaterial).color.set(tint);
    (this.hoverDisc.material as THREE.MeshBasicMaterial).opacity = spell
      ? valid
        ? 0.22
        : 0.32
      : valid
        ? 0.18
        : 0.3;
  }

  /** Brief white flash at a deploy point (CR drop feedback). */
  deployFlash(ax: number, ay: number): void {
    deployFlash(this, ax, ay);
  }

  /**
   * Translucent preview of the selected troop under the cursor.
   * Pass null to clear; the rig is rebuilt only when the card changes.
   * `dim` (a "no" spot) fades it to GHOST_DIM of its usual see-through.
   */
  setGhost(cardId: CardId | null, pos: { x: number; y: number } | null, dim = false): void {
    if (!cardId || !pos) {
      if (this.ghost) this.ghost.rig.group.visible = false;
      return;
    }
    if (this.ghost?.id !== cardId) {
      if (this.ghost) {
        this.scene.remove(this.ghost.rig.group);
        disposeDeep(this.ghost.rig.group);
      }
      const rig = buildGhost(cardId);
      this.scene.add(rig.group);
      const mats: { mat: THREE.Material; base: number }[] = [];
      rig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (mat.transparent && !mats.some((m) => m.mat === mat)) mats.push({ mat, base: mat.opacity });
        }
      });
      this.ghost = { id: cardId, rig, mats, dim: false };
    }
    if (this.ghost.dim !== dim) {
      this.ghost.dim = dim;
      for (const m of this.ghost.mats) m.mat.opacity = m.base * (dim ? GHOST_DIM : 1);
    }
    const w = toWorld(pos.x, pos.y);
    this.ghost.rig.group.visible = true;
    this.ghost.rig.group.position.set(w.x, this.ghost.rig.hover ?? 0, w.z);
  }

  /**
   * Show or hide the placement map for the selected card (pass the card it
   * plays as: the Mirror's copy). Troops and buildings show the lane map, the
   * Digger (`deployAnywhere`) its dig map, spells none.
   */
  setZoneVisible(visible: boolean, card: Card | null = null): void {
    this.zone.hold(visible ? zoneModeFor(card) : null);
  }

  /** What the placement map is showing (tests, dev tools and the staging script). */
  get zoneParts(): ZoneParts {
    return this.zone.parts;
  }

  /** Whether the placement map is up for a held card (a troop or building is selected). */
  get zoneVisible(): boolean {
    return this.zone.held !== null;
  }

  /** The pointer rests on a "no" spot: the map's outline thickens, calling the finger back inside. */
  zoneCallBack(on: boolean): void {
    this.zone.callBack(on);
  }

  /** A refused drop: the outline thickens and the region the words are about flashes. */
  zoneRefuse(reason: RefuseReason, ax: number, ay: number): void {
    this.zone.refuse(reason, ax, ay);
  }

  /** The "Drop troops here now!" label for a lane that just opened, or null. */
  laneCallout(): LaneCallout | null {
    return this.zone.callout();
  }

  /** Hide that label early (the kid just played a card). */
  dismissLaneCallout(): void {
    this.zone.dismissCallout();
  }

  /** The drawn map's signed distance at an arena point, as the GPU reads it (+ = allowed). */
  zoneSample(ax: number, ay: number): number {
    return this.zone.sample(ax, ay);
  }

  /** Which side sits at the bottom of the screen. */
  get viewpoint(): Side {
    return viewSide;
  }

  /** The final-blow zoom is moving the frame (nothing may be pinned to the board). */
  get koZooming(): boolean {
    return koZoomActive(this);
  }

  /**
   * A refused drop: a red ring pulses twice at the spot for 1.2 s, so the
   * "no" lands where the finger is, not only on the hand.
   */
  badSpotPulse(ax: number, ay: number): void {
    const w = toWorld(ax, ay);
    const group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    ringMat.toneMapped = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    const discMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), discMat);
    disc.rotation.x = -Math.PI / 2;
    group.add(disc, ring);
    group.position.set(w.x, 0.08, w.z);
    group.renderOrder = 5;
    const still = reducedMotion();
    this.addEffect(group, BAD_SPOT_SECONDS, (frac) => {
      if (still) {
        // Reduced motion: one still ring that fades, no beats.
        ring.scale.setScalar(1);
        ringMat.opacity = 0.95 * frac;
        discMat.opacity = 0.3 * frac;
        return;
      }
      // Two beats over the effect's life: grow and fade, then again.
      const beat = ((1 - frac) * 2) % 1;
      ring.scale.setScalar(0.8 + beat * 1.1);
      ringMat.opacity = 0.95 * (1 - beat) * Math.min(1, frac * 4);
      discMat.opacity = 0.3 * frac;
    });
  }

  /** @internal Add a timed effect; `update` gets the remaining life fraction (1 -> 0). */
  addEffect(
    obj: THREE.Object3D,
    ttl: number,
    update: (frac: number) => void,
    delay = 0,
  ): void {
    if (delay > 0) obj.visible = false;
    this.scene.add(obj);
    this.effects.push({ obj, ttl, ttl0: ttl, delay, update });
  }

  /** An emote bubble floating above a side's king tower. */
  showEmote(side: Side, emoji: string): void {
    emote(this, side, emoji);
  }

  /** Visual reactions to gameplay events. */
  onEvent(ev: BattleEvent): void {
    fxOnEvent(this, ev);
    viewsOnEvent(this, ev);
    towersOnEvent(this, ev);
    arenaOnEvent(this, ev);
  }

  /**
   * Drive the living sky from match time: full daylight for the opening
   * minute, sunset through the middle, night by the final seconds, and a
   * lightning strike the instant overtime begins.
   */
  /** Dev/preview: pin the day phase (null = follow the match clock). */
  /** @internal */
  phaseOverride: number | null = null;
  forceDayPhase(p: number | null): void {
    this.phaseOverride = p;
  }

  setMatchPhase(time: number, overtime: boolean): void {
    if (this.showcase) return; // the home diorama keeps its golden hour
    if (this.phaseOverride !== null) {
      this.dayPhase = this.phaseOverride;
      return;
    }
    const t = Math.max(0, Math.min(1, (time - 45) / 130));
    this.dayPhase = overtime ? 1 : t * t * (3 - 2 * t);
    if (overtime && !this.wasOvertime) this.lightningT = 0.55;
    this.wasOvertime = overtime;
  }

  /**
   * Create/update/remove meshes to mirror the battle state. `alpha` is the
   * fraction of a sim tick elapsed since `state` (1 = draw it as is); it is
   * passed through to the view animation, which does not interpolate yet.
   */
  sync(state: BattleState, dt: number, alpha = 1): void {
    if (state !== this.syncState) {
      // A new battle: bake both decks' troop rigs now, while the countdown runs.
      prewarmBakes([...state.player.hand.cards, ...state.player.hand.queue, ...state.enemy.hand.cards, ...state.enemy.hand.queue]);
    }
    this.syncState = state;
    // The cast leans toward THIS frame's camera (the guest's flipped view
    // included) before any unit or tower crew is built or posed.
    setLeanCamera(this.camera);
    this.byId.clear();
    for (const e of state.entities) this.byId.set(e.id, e);
    this.setMatchPhase(state.time, state.overtime);
    syncProjectiles(this, state);
    // Render-only telegraphs read straight off the sim: falling comets and digging Diggers.
    syncComets(this, state, dt, alpha);
    syncBurrows(this, state, dt, alpha);
    // The placement map follows opened lanes (a tower falling widens where
    // you can deploy, and lights that pocket up the moment it happens).
    this.zone.sync(state, viewSide, dt, reducedMotion());
    const seen = this.seen;
    seen.clear();
    for (const e of state.entities) {
      seen.add(e.id);
      let view = this.views.get(e.id);
      if (!view) {
        // The lowest-id living unit of a card nearby leads its pack: a
        // swarm shows one level shield, not one per member.
        const packLead =
          e.kind === "troop" &&
          !state.entities.some(
            (o) =>
              o.id < e.id &&
              o.hp > 0 &&
              o.side === e.side &&
              o.cardId === e.cardId &&
              o.kind === "troop" &&
              distance(o, e) < 4,
          );
        view =
          e.kind === "troop"
            ? buildTroopMesh(e)
            : e.kind === "building"
              ? buildBuildingMesh(e)
              : buildTowerMesh(e);
        if (e.kind === "troop" && e.cardId) {
          // Level shield on the (damage-only) HP bar, CR-style. Swarm-sized
          // members past the first go without: one shield names the pack's
          // level and saves a draw per unit.
          if (packLead || !isSwarmSized(e)) {
            const lvl = (e.side === "player" ? state.player : state.enemy).levels[e.cardId] ?? 1;
            const shield = makeLevelBadge(e.side, lvl);
            shield.scale.set(0.34, 0.34, 1);
            shield.position.set(-0.6, 0, 0.05);
            view.hpGroup.add(shield);
          }
        }
        this.views.set(e.id, view);
        this.scene.add(view.root);
        spawnFlourish(this, view, e);
      }
      updateTroop(this, view, e, dt, alpha);
      if (!view.isTroop) updateTower(this, view, e, dt);
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.views.delete(id);
        beginDeath(this, view);
      }
    }
  }

  /** True between webglcontextlost and webglcontextrestored. */
  private contextLost = false;

  /**
   * Survive a lost WebGL context (a backgrounded tab, a GPU reset): cancel the
   * default so the browser may restore it, stop drawing while it is gone, and
   * on restore rebuild the arena (`arenaId` is the one in play), drop every
   * entity view and re-fit the post stack. The next sync() recreates the
   * views from the battle state, so play continues without a reload.
   */
  recoverFromContextLoss(arenaId: () => string): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.setArenaLook(arenaId(), true);
      this.reset();
      markShadowsDirty(this);
      this.resize();
    });
  }

  render(dt: number): void {
    if (this.contextLost) return;
    gradeSky(this, dt);
    updateRiver(this, dt);
    updateCrowd(this, dt);
    updateBirds(this, dt);
    applyShake(this, dt);
    updateShowcase(this, dt);

    // Spell / deploy telegraph ring pulse (dashed feel via opacity + scale);
    // held still under reduced motion.
    const still = reducedMotion();
    if (this.hoverRing.visible) {
      const base = this.hoverDisc.scale.x;
      const ringMat = this.hoverRing.material as THREE.MeshBasicMaterial;
      if (still) {
        this.hoverRing.scale.setScalar(base);
        ringMat.opacity = 0.85;
      } else {
        this.hoverPulse += dt;
        const pulse = 0.92 + Math.sin(this.hoverPulse * 9) * 0.08;
        this.hoverRing.scale.setScalar(base * pulse);
        ringMat.opacity = 0.55 + Math.sin(this.hoverPulse * 11) * 0.3;
      }
    }

    this.zone.render(this.dayPhase, this.renderer.getPixelRatio(), still);
    updateEffects(this, dt);
    this.fx.update(dt);

    this.dying = this.dying.filter((d) => {
      d.t += dt;
      const f = Math.min(1, d.t / d.duration);
      if (f >= 1) {
        this.scene.remove(d.view.root);
        disposeDeep(d.view.root);
        return false;
      }
      if (d.view.isTroop) updateTroopDeath(d, f, dt);
      else updateTowerDeath(d, f);
      for (const mat of d.fadeMats) mat.opacity = 1 - f;
      return true;
    });

    this.composer.render();
    sampleQuality(this);
  }

  /** Remove every entity mesh (used on battle restart). */
  reset(): void {
    this.hitStop.reset();
    for (const view of this.views.values()) {
      this.scene.remove(view.root);
      disposeDeep(view.root);
    }
    this.views.clear();
    for (const f of this.effects) {
      this.scene.remove(f.obj);
      disposeDeep(f.obj);
    }
    this.effects = [];
    this.fx.reset();
    resetComets(this);
    resetBurrows(this);
    for (const d of this.dying) {
      this.scene.remove(d.view.root);
      disposeDeep(d.view.root);
    }
    this.dying = [];
    if (this.ghost) {
      this.scene.remove(this.ghost.rig.group);
      disposeDeep(this.ghost.rig.group);
      this.ghost = null;
    }
    for (const pile of this.rubble) {
      this.scene.remove(pile);
      disposeDeep(pile);
    }
    this.rubble = [];
    for (const view of this.projViews.values()) {
      this.scene.remove(view);
      disposeDeep(view);
    }
    this.projViews.clear();
    this.shakeCtl.update(999, 1); // drain trauma to rest
    this.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    this.camera.lookAt(0, 0, 0);
    this.zone.reset(); // the next sync seeds quietly: no reveal for lanes already open
  }

  /** Release renderer-owned resources when the battle view is permanently removed. */
  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.reset();
    this.scene.remove(this.zone.mesh);
    this.zone.dispose();
    disposeDeep(this.scene);
    this.scene.clear();
    this.bloom.dispose();
    this.finalPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
