import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, type OpenLanes, type Side } from "../game/arena";
import {
  distance,
  openLanes,
  type BattleEvent,
  type BattleState,
  type Entity,
} from "../game/battle";
import type { CardId } from "../game/cards";
import { ShakeController } from "./shake";
import { HitStopController } from "./hitstop";
import { ParticleField } from "./particles";
import { QualityGovernor, qualityPinFromUrl } from "./quality";
import { lookForArena } from "./arenaLooks";
import type { TroopRig } from "./characters3d";
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
  applyShake,
  applyTopInset,
  frameOrtho,
  initFog,
  koZoomActive,
  showcase,
  updateShowcase,
} from "./scene/camera";
import {
  applyGrade,
  applyQuality,
  buildComposer,
  createRenderer,
  maxAnisotropy,
  sampleQuality,
  setFlash,
} from "./scene/post";
import {
  PARTICLE_CAP,
  buildSparkMesh,
  deployFlash,
  emote,
  fxOnEvent,
  spawnFlourish,
  syncProjectiles,
  syncSparks,
  updateEffects,
} from "./scene/fx/effects";
import { LegacyFx, type FxApi } from "./scene/fx/api";
import {
  buildBuildingMesh,
  buildGhost,
  buildTroopMesh,
  loadGlbModels,
  makeLevelBadge,
} from "./scene/views/troops";
import { buildTowerMesh, towersOnEvent, updateTower, updateTowerDeath } from "./scene/views/towers";
import { beginDeath, updateTroop, updateTroopDeath, viewsOnEvent } from "./scene/views/animate";

// The scene's building blocks live in ./scene/ (arena, sky, camera, post,
// views, fx); Battle3D wires them together behind the same public API.
export { GAME_FONT, disposeDeep } from "./scene/common";
export { setTowerFlair } from "./scene/views/towers";

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

// Matches KING_DEPLOY_BUFFER in battle.ts: troops can't be deployed this close
// to the enemy king even after a lane opens.
const KING_NO_DEPLOY_RADIUS = 4.5;

/*
 * Fields marked @internal are shared with the ./scene/ modules, which take
 * the Battle3D instance as their first argument; they are not public API.
 */
export class Battle3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Effects behind the FX contract (footstep dust today). */
  fx: FxApi = new LegacyFx(this);
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
  private readonly hoverDisc: THREE.Mesh;
  private readonly hoverRing: THREE.Mesh;
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
  /** @internal Screen pixels covered by the HUD overlay across the top of the stage. */
  topInsetPx = 0;
  /** @internal Fog-immune glow materials (lanterns, neon, torches) with base colors. */
  glowMats: Array<{ mat: THREE.MeshBasicMaterial; base: THREE.Color }> = [];
  /** @internal The light rig (rebuilt with the look; graded by the living sky). */
  lightGroup = new THREE.Group();
  private hoverPulse = 0;
  private ghost: { id: CardId; rig: TroopRig } | null = null;
  /** @internal Trauma-based camera shake; big impacts punch harder than small ones. */
  readonly shakeCtl = new ShakeController();
  /** @internal */
  shakeTime = 0;
  /** Render-only hit-stop (does not touch the sim clock). */
  readonly hitStop = new HitStopController();
  /** @internal Pooled hit sparks / debris, mirrored into one InstancedMesh. */
  readonly sparks = new ParticleField(PARTICLE_CAP);
  /** @internal */
  sparkMesh!: THREE.InstancedMesh;
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
  /** Shadow-map renders so far: shadows are static and re-render only when marked dirty. */
  shadowRenders = 0;
  private readonly zonePlane: THREE.Mesh; // own-half deploy area (blue)
  // Enemy half, split per lane: a dark "no-deploy" overlay that turns into a
  // blue "deployable" strip once that lane's princess tower falls.
  private readonly enemyDarkL: THREE.Mesh;
  private readonly enemyDarkR: THREE.Mesh;
  private readonly laneBlueL: THREE.Mesh;
  private readonly laneBlueR: THREE.Mesh;
  // Red "keep clear" disc around the enemy king (matches the deploy buffer).
  private readonly kingNoDeploy: THREE.Mesh;
  private zoneShown = false;
  private lastOpen: OpenLanes = { left: false, right: false };
  /** @internal */
  readonly container: HTMLElement;
  private readonly onResize = (): void => this.resize();

  constructor(container: HTMLElement) {
    this.container = container;
    loadGlbModels(); // real character models (KayKit), only when opted in
    this.renderer = createRenderer(container);

    this.scene = new THREE.Scene();
    initSky(this);
    initFog(this);
    this.scene.add(this.arenaGroup);
    this.scene.add(this.lightGroup);

    this.sparkMesh = buildSparkMesh();
    this.scene.add(this.sparkMesh);

    // Orthographic = no perspective convergence, so the arena reads
    // as a perfectly straight board (not a trapezoid). Angled from
    // the player's elevated side, not straight down from the sky.
    this.camera = new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120);
    this.camera.position.copy(CAM_HOME);
    this.camera.lookAt(0, 0, 0);
    frameOrtho(this);

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

    this.zonePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT / 2 - 1),
      new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    this.zonePlane.rotation.x = -Math.PI / 2;
    this.zonePlane.position.set(0, 0.025, ARENA_HEIGHT / 4 + 0.5);
    this.zonePlane.visible = false;
    this.scene.add(this.zonePlane);

    // Enemy half, one mesh per lane. Dark "can't deploy" by default; swapped
    // for a blue "deployable" strip when that lane opens (tower fell).
    const laneW = ARENA_WIDTH / 2;
    const zoneStrip = (color: number, opacity: number, depth: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(laneW, depth),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.enemyDarkL = zoneStrip(0x1a0b10, 0.24, ARENA_HEIGHT / 2 + 1);
    this.enemyDarkR = zoneStrip(0x1a0b10, 0.24, ARENA_HEIGHT / 2 + 1);
    this.laneBlueL = zoneStrip(0x3b82f6, 0.12, ARENA_HEIGHT / 2 - 1);
    this.laneBlueR = zoneStrip(0x3b82f6, 0.12, ARENA_HEIGHT / 2 - 1);

    // "Keep clear" disc around the enemy king (radius = the deploy buffer).
    this.kingNoDeploy = new THREE.Mesh(
      new THREE.CircleGeometry(KING_NO_DEPLOY_RADIUS, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.kingNoDeploy.rotation.x = -Math.PI / 2;
    this.kingNoDeploy.visible = false;
    const k0 = toWorld(ARENA_WIDTH / 2, 2.5);
    this.kingNoDeploy.position.set(k0.x, 0.028, k0.z);
    this.scene.add(this.kingNoDeploy);

    const post = buildComposer(this);
    this.composer = post.composer;
    this.bloom = post.bloom;

    this.resize();
    window.addEventListener("resize", this.onResize);
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
  setArenaLook(arenaId: string): void {
    const next = lookForArena(arenaId, arabic);
    if (next.id === LOOK.id) return;
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

  /** The HUD overlay height; the frame keeps the arena clear of it. */
  setTopInset(px: number): void {
    applyTopInset(this, px);
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
    const m = side === "player" ? 1 : -1;
    this.zonePlane.position.z = m * (ARENA_HEIGHT / 4 + 0.5);
    // Enemy half (opposite side); left lane at -x, right lane at +x.
    const ez = -m * (ARENA_HEIGHT / 4 - 0.5); // dark overlay centre
    const bz = -m * (ARENA_HEIGHT / 4 + 0.5); // blue strip centre (off the river)
    const lx = ARENA_WIDTH / 4;
    this.enemyDarkL.position.set(-lx, 0.026, ez);
    this.enemyDarkR.position.set(lx, 0.026, ez);
    this.laneBlueL.position.set(-lx, 0.027, bz);
    this.laneBlueR.position.set(lx, 0.027, bz);
    // Enemy king sits at arena y=2.5 (or mirrored for the guest viewpoint).
    const kingW = toWorld(ARENA_WIDTH / 2, side === "player" ? 2.5 : ARENA_HEIGHT - 2.5);
    this.kingNoDeploy.position.set(kingW.x, 0.028, kingW.z);
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
   */
  setGhost(cardId: CardId | null, pos: { x: number; y: number } | null): void {
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
      this.ghost = { id: cardId, rig };
    }
    const w = toWorld(pos.x, pos.y);
    this.ghost.rig.group.visible = true;
    this.ghost.rig.group.position.set(w.x, this.ghost.rig.hover ?? 0, w.z);
  }

  setZoneVisible(visible: boolean): void {
    this.zoneShown = visible;
    this.applyDeployZone();
  }

  /**
   * Show the deploy overlay: own half blue; each enemy-half lane is dark
   * (forbidden) until its tower falls, then it lights up blue (deployable).
   */
  private applyDeployZone(): void {
    const v = this.zoneShown;
    const open = this.lastOpen;
    this.zonePlane.visible = v;
    this.laneBlueL.visible = v && open.left;
    this.laneBlueR.visible = v && open.right;
    // The king buffer only matters once a lane is open into enemy territory.
    this.kingNoDeploy.visible = v && (open.left || open.right);
    this.enemyDarkL.visible = v && !open.left;
    this.enemyDarkR.visible = v && !open.right;
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
    this.syncState = state;
    this.byId.clear();
    for (const e of state.entities) this.byId.set(e.id, e);
    this.setMatchPhase(state.time, state.overtime);
    syncProjectiles(this, state);
    // Keep the deploy overlay in step with opened lanes (a tower falling
    // expands where you can deploy).
    const open = openLanes(state, viewSide);
    if (open.left !== this.lastOpen.left || open.right !== this.lastOpen.right) {
      this.lastOpen = open;
      this.applyDeployZone();
    }
    const seen = this.seen;
    seen.clear();
    for (const e of state.entities) {
      seen.add(e.id);
      let view = this.views.get(e.id);
      if (!view) {
        // One name label per deployed group: the lowest-id living unit of
        // a card nearby carries it, so a swarm reads as one labeled pack.
        const withLabel =
          e.kind === "troop" &&
          e.radius >= 0.28 &&
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
            ? buildTroopMesh(e, withLabel)
            : e.kind === "building"
              ? buildBuildingMesh(e)
              : buildTowerMesh(e);
        if (e.kind === "troop" && e.cardId) {
          view.label = view.root.getObjectByName("unitLabel");
          view.labelAge = 0;
          // Level shield on the (damage-only) HP bar, CR-style.
          const lvl = (e.side === "player" ? state.player : state.enemy).levels[e.cardId] ?? 1;
          const shield = makeLevelBadge(e.side, lvl);
          shield.scale.set(0.34, 0.34, 1);
          shield.position.set(-0.6, 0, 0.05);
          view.hpGroup.add(shield);
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

  render(dt: number): void {
    gradeSky(this, dt);
    updateRiver(this, dt);
    updateCrowd(this, dt);
    updateBirds(this, dt);
    applyShake(this, dt);
    updateShowcase(this, dt);

    // Spell / deploy telegraph ring pulse (dashed feel via opacity + scale).
    if (this.hoverRing.visible) {
      this.hoverPulse += dt;
      const pulse = 0.92 + Math.sin(this.hoverPulse * 9) * 0.08;
      const base = this.hoverDisc.scale.x;
      this.hoverRing.scale.setScalar(base * pulse);
      (this.hoverRing.material as THREE.MeshBasicMaterial).opacity =
        0.55 + Math.sin(this.hoverPulse * 11) * 0.3;
    }

    // Advance and draw the hit-spark pool through one InstancedMesh.
    syncSparks(this, dt);
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
    for (const p of this.sparks.particles) p.active = false;
    this.sparkMesh.count = 0;
    this.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    this.camera.lookAt(0, 0, 0);
  }

  /** Release renderer-owned resources when the battle view is permanently removed. */
  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.reset();
    disposeDeep(this.scene);
    this.scene.clear();
    this.bloom.dispose();
    this.finalPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
