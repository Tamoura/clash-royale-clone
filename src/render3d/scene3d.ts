import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, BRIDGE_XS, RIVER_Y, type Side } from "../game/arena";
import {
  distance,
  type BattleEvent,
  type BattleState,
  type Entity,
} from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { isRaged, moveGoal } from "../game/sim";
import { projectileStyle } from "./projectiles";
import { damageLabel } from "./popups";
import { deathStyle } from "./deathfx";
import { DUST_INTERVAL, blobShadowScale } from "./ground";
import { spawnStyle } from "./spawnfx";
import { ShakeController } from "./shake";
import { ParticleField } from "./particles";
import { impactStyle } from "./impactfx";
import { THEME } from "./theme";
import {
  animateTroop,
  articulate,
  buildTowerKing,
  buildTowerPrincess,
  buildTroop,
  outlineRig,
  toon,
  type TroopRig,
} from "./characters3d";

/** Arena tiles → world units: x centered, arena y becomes world z. */
function toWorld(ax: number, ay: number): { x: number; z: number } {
  return { x: ax - ARENA_WIDTH / 2, z: ay - ARENA_HEIGHT / 2 };
}

const SIDE_COLOR: Record<Side, number> = { player: 0x3b82f6, enemy: 0xef4444 };
/** HP-bar fill: CR convention — your units green, the enemy's red. */
const HP_COLOR: Record<Side, number> = { player: 0x35d04a, enemy: 0xef4444 };

// Which side sits at the bottom of the screen. The host views as "player"
// (default); an online guest views as "enemy", so the camera looks from the
// far side and flat HP bars rotate 180° about Y to match — viewed from the
// opposite side, the two cancel out and bars read identically.
let viewSide: Side = "player";
function cameraZForView(): number {
  return viewSide === "player" ? CAM_HOME.z : -CAM_HOME.z;
}

/**
 * Two arena looks: the original "normal" (winter-stone) world and the
 * "arabic" Moorish/Islamic theme. Read once at load (persisted); the toggle
 * in main.ts re-saves it and reloads. Guarded so node tests (no localStorage)
 * fall back safely.
 */
export type ArenaTheme = "normal" | "arabic";
export const ARENA_THEME_KEY = "cr-clone-arena-theme";
function readArenaTheme(): ArenaTheme {
  try {
    return localStorage.getItem(ARENA_THEME_KEY) === "normal" ? "normal" : "arabic";
  } catch {
    return "arabic";
  }
}
const arenaTheme: ArenaTheme = readArenaTheme();
const arabic = arenaTheme === "arabic";
/** Per-theme scenery palette. */
const ARENA_PALETTE = {
  normal: { sky: 0x9ec8e8, apron: 0xe4ecf5, far: 0xdbe6f0, fieldSide: 0xb8a886, edging: 0xd8d0c0, drift: 0xeef4ff },
  arabic: { sky: THEME.sky, apron: 0xd8c79a, far: 0xd8c79a, fieldSide: THEME.stone, edging: THEME.sand, drift: 0xe6d2a6 },
}[arenaTheme];

/**
 * CR-style steep camera (~66° elevation): the field reads almost
 * flat/2D while the characters stay visibly 3D. Chosen by grid
 * search so the whole arena + stands fit the frustum at fov 48.
 */
const CAM_HOME = new THREE.Vector3(0, 34, 22);
/** HP bars and similar boards tilt to face that camera square-on. */
const BAR_TILT = -Math.atan2(CAM_HOME.y, CAM_HOME.z - 1.0);

/**
 * Signed attack swing (animation principles): the arm cocks back as
 * the next blow approaches (negative = anticipation), sweeps forward
 * at the hit (1 -> 0), and dips past rest in a follow-through before
 * settling.
 */
function attackSwing(e: Entity, engaged: boolean): number {
  if (e.hitSpeed <= 0) return 0;
  if (e.cooldown > e.hitSpeed - 0.3) {
    const p = (e.cooldown - (e.hitSpeed - 0.3)) / 0.3; // 1 at hit -> 0
    if (p > 0.25) return (p - 0.25) / 0.75;
    return -Math.sin((p / 0.25) * Math.PI) * 0.14; // follow-through dip
  }
  if (engaged && e.cooldown < 0.22 && e.cooldown > 0) {
    const w = 1 - e.cooldown / 0.22;
    return -0.5 * w * w; // ease-in wind-up
  }
  return 0;
}

/** Render-loop scratch vectors (render-avoid-allocations). */
const PREV_POS = new THREE.Vector3();
const LOOK_AT = new THREE.Vector3();

// Hit-spark pool: one InstancedMesh, reused scratch objects (no per-frame
// allocation — see the three-best-practices skill).
const PARTICLE_CAP = 320;
const SPARK_GRAVITY = 7;
const SPARK_M = new THREE.Matrix4();
const SPARK_POS = new THREE.Vector3();
const SPARK_SCALE = new THREE.Vector3();
const SPARK_QUAT = new THREE.Quaternion();
const SPARK_COLOR = new THREE.Color();

const TROOP_DEATH_TIME = 0.5;
const TOWER_DEATH_TIME = 0.8;
const SPAWN_POP_TIME = 0.35;
const FLASH_TIME = 0.12;

interface EntityView {
  root: THREE.Group;
  rig: TroopRig | null;
  hpFill: THREE.Mesh;
  hpGroup: THREE.Group;
  zzz?: THREE.Sprite;
  /** Cannon barrel, aimed at the current target. */
  barrel?: THREE.Group;
  /** Live numeric HP readout (towers). */
  hpText?: HpText;
  /** Materials with an emissive channel, for damage flashes. */
  flashMats: { mat: THREE.Material & { emissive: THREE.Color }; orig: number }[];
  lastHp: number;
  flashT: number;
  spawnT: number;
  isTroop: boolean;
  /** Resting scale (towers stand 1.5x for prominence). */
  baseScale?: number;
  /** Spinning stars shown while the entity is stunned (lazy). */
  stunStars?: THREE.Sprite;
  /** Whether any emissive glow (flash/rage/charge) is applied. */
  glowing?: boolean;
  /** Character perched on a tower (princess archer / the king). */
  defender?: TroopRig;
  /** Mount group carrying the defender (owns yaw/slump). */
  defenderMount?: THREE.Group;
  /** Damage batched since the last floating number. */
  pendingDmg?: number;
  /** Seconds until the next floating number may appear. */
  popupT?: number;
  /** Soft contact shadow under a flyer. */
  blobShadow?: THREE.Mesh;
  /** Seconds until the next footstep dust puff. */
  dustT?: number;
  /** How this troop enters the field. */
  spawnStyle?: "rise" | "pop";
}

interface DyingView {
  view: EntityView;
  t: number;
  duration: number;
  /** Corpses topple to a side; buildings sink. */
  topple: number;
  fadeMats: (THREE.Material & { opacity: number })[];
}

interface HpText {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: number;
}

interface EffectView {
  obj: THREE.Object3D;
  ttl: number;
  ttl0: number;
  delay: number;
  update: (frac: number) => void;
}

function makeHpText(y: number): { sprite: THREE.Sprite; text: HpText } {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.5, 0.56, 1);
  sprite.position.y = y;
  return { sprite, text: { ctx, tex, last: -1 } };
}

function updateHpText(t: HpText, hp: number): void {
  const value = Math.max(0, Math.ceil(hp));
  if (value === t.last) return;
  t.last = value;
  const ctx = t.ctx;
  ctx.clearRect(0, 0, 128, 48);
  ctx.font = "bold 30px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(String(value), 64, 26);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(value), 64, 26);
  t.tex.needsUpdate = true;
}

/** Shared rounded-pill trough texture for HP bars. */
let pillTexture: THREE.CanvasTexture | null = null;

function pillTex(): THREE.CanvasTexture {
  if (!pillTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#10141c";
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(2, 2, 124, 28, 14);
    ctx.fill();
    ctx.stroke();
    pillTexture = new THREE.CanvasTexture(c);
    pillTexture.userData.shared = true;
  }
  return pillTexture;
}

function makeHpBar(width: number, color: number, y: number): {
  group: THREE.Group;
  fill: THREE.Mesh;
} {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.2),
    new THREE.MeshBasicMaterial({ map: pillTex(), transparent: true }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.06, 0.14),
    new THREE.MeshBasicMaterial({ color }),
  );
  fill.position.z = 0.01;
  // Gloss highlight rides the fill so it scales with it.
  const gloss = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.06, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  gloss.position.set(0, 0.04, 0.01);
  fill.add(gloss);
  group.add(bg, fill);
  group.position.y = y;
  // Face the steep camera; for the enemy viewpoint, also spin 180° about Y.
  if (viewSide === "enemy") group.rotation.set(BAR_TILT, Math.PI, 0, "YXZ");
  else group.rotation.x = BAR_TILT;
  return { group, fill };
}

/** Small circular level badge capping a tower HP pill. */
function makeLevelBadge(side: Side): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = side === "player" ? "#2c55b8" : "#b02e22";
  ctx.strokeStyle = "#e8e3d8";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "bold 30px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("9", 32, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.42, 0.42, 1);
  return sprite;
}

function setHpFill(view: EntityView, frac: number, width: number): void {
  const f = Math.max(0, Math.min(1, frac));
  view.hpFill.scale.x = Math.max(0.001, f);
  view.hpFill.position.x = (-(1 - f) * (width - 0.06)) / 2;
}

/** One shared sprite material per card+side; labels never change. */
const nameMaterials = new Map<string, THREE.SpriteMaterial>();

function nameSpriteMaterial(cardId: CardId, side: Side): THREE.SpriteMaterial {
  const key = `${cardId}:${side}`;
  const cached = nameMaterials.get(key);
  if (cached) return cached;
  const name = getCard(cardId).name;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  let size = 34;
  ctx.font = `bold ${size}px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif`;
  while (ctx.measureText(name).width > 236 && size > 16) {
    size -= 2;
    ctx.font = `bold ${size}px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = side === "player" ? "#aecdff" : "#ffb9b3";
  ctx.fillText(name, 128, 34);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
  });
  mat.userData.shared = true; // cached across every unit label
  nameMaterials.set(key, mat);
  return mat;
}

/** Shared "seeing stars" texture for stunned units. */
let stunTexture: THREE.CanvasTexture | null = null;

function makeStunSprite(): THREE.Sprite {
  if (!stunTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 48;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 30px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe14d";
    ctx.strokeStyle = "rgba(10,14,22,0.9)";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    for (const [x, y] of [
      [24, 32],
      [64, 24],
      [104, 34],
    ] as const) {
      ctx.strokeText("★", x, y + 8);
      ctx.fillText("★", x, y + 8);
    }
    stunTexture = new THREE.CanvasTexture(c);
    stunTexture.userData.shared = true;
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: stunTexture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.3, 0.5, 1);
  return sprite;
}

function makeZzzSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 30px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("z", 22, 44);
  ctx.font = "bold 20px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  ctx.fillText("z", 42, 26);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  sprite.scale.set(1.2, 1.2, 1);
  return sprite;
}

/** Materials with an emissive channel under this object, for flashes. */
function collectFlashMats(root: THREE.Object3D): EntityView["flashMats"] {
  const out: EntityView["flashMats"] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material & { emissive?: THREE.Color };
    if (mat.emissive) {
      out.push({
        mat: mat as THREE.Material & { emissive: THREE.Color },
        orig: mat.emissive.getHex(),
      });
    }
  });
  return out;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Free GPU resources of a dynamic object (three-best-practices:
 * memory-dispose-recursive). Resources flagged `userData.shared`
 * (cached geometries, label materials, shared textures) and the
 * sprite class's global plane geometry are spared.
 */
export function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const isSprite = (o as THREE.Sprite).isSprite === true;
    if (!mesh.isMesh && !isSprite) return;
    if (!isSprite) {
      // Sprites share one global plane geometry — never dispose it.
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo && !geo.userData.shared) geo.dispose();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      if (m.userData.shared) continue;
      const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
      if (map && !map.userData.shared) map.dispose();
      m.dispose();
    }
  });
}

/** Unlit hot material: ignores lights and skips tone mapping. */
function unlitGlow(color: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color });
  mat.toneMapped = false;
  return mat;
}

/** Shared stone-brick texture for tower walls. */
let brickTexture: THREE.CanvasTexture | null = null;

function brickTex(): THREE.CanvasTexture {
  if (!brickTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c2b49a";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(90,75,55,0.5)";
    ctx.lineWidth = 1.6;
    for (let row = 0; row < 6; row++) {
      const y = row * 11;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y);
      ctx.stroke();
      const off = row % 2 ? 0 : 8;
      for (let xCol = off; xCol < 64; xCol += 16) {
        ctx.beginPath();
        ctx.moveTo(xCol, y);
        ctx.lineTo(xCol, y + 11);
        ctx.stroke();
      }
    }
    brickTexture = new THREE.CanvasTexture(c);
    brickTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return brickTexture;
}

/** A gold crescent-and-orb finial that tops domes and spires. */
function crescentFinial(s: number): THREE.Group {
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
function onionDome(r: number, color: number): THREE.Group {
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
function makeLantern(s = 1): THREE.Group {
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
function archGateway(): THREE.Group {
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

function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.15 : 0.85;
  const height = king ? 2.0 : 1.55;

  // Two-step stone platform under the keep, gold-trimmed like CR.
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.9, 0.18, radius * 2.9),
    toon(0xcfc4ab),
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
    toon(0x9c8d74),
  );
  plinth.position.y = 0.32;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const wallMat = new THREE.MeshToonMaterial({ map: brickTex() });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2, height, radius * 2),
    wallMat,
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // Gold trim band under the battlements (CR's royal touch).
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.15, 0.14, radius * 2.15),
    toon(0xf2c14e),
  );
  trim.position.y = height - 0.16;
  trim.castShadow = true;
  root.add(trim);

  // Merlons along the four roof edges.
  const merlon = toon(0x9c8d74);
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.18), merlon);
      a.position.set(i * radius * 0.7, height + 0.1, side * radius * 0.92);
      a.castShadow = true;
      root.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.3), merlon);
      b.position.set(side * radius * 0.92, height + 0.1, i * radius * 0.7);
      b.castShadow = true;
      root.add(b);
    }
  }

  // Door + team banner facing the enemy.
  const facing = e.side === "player" ? -1 : 1;

  // Arabic theme: crown the tower with onion-dome cupolas at the corners and
  // a big central dome (king) or crescent spire (princess) toward the rear,
  // so the tower crew stays visible up front.
  if (arabic) {
    const domeColor = king ? THEME.turquoise : THEME.teal;
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
  const defender = king ? buildTowerKing() : buildTowerPrincess();
  articulate(defender);
  outlineRig(defender.group);
  defender.group.scale.setScalar(king ? 0.85 : 0.8);
  if (defender.arm) defender.arm.rotation.x = defender.armRest;
  const mount = new THREE.Group();
  mount.position.y = height + 0.18;
  mount.add(defender.group);
  root.add(mount);
  view.defender = defender;
  view.defenderMount = mount;

  if (king) {
    const zzz = makeZzzSprite();
    zzz.position.y = height + 2.0;
    root.add(zzz);
    view.zzz = zzz;
  }

  const barWidth = king ? 2.2 : 1.8;
  const barY = height + (king ? 1.5 : 1.2);
  // Sit the bar behind the tower, on its outer side: above enemy towers
  // (-z, the top), below the player's (+z, the bottom). Keyed to the
  // canonical side, so it mirrors correctly under the guest's flipped view.
  const barZ = (e.side === "player" ? 1 : -1) * (king ? 1.7 : 1.4);
  const bar = makeHpBar(barWidth, HP_COLOR[e.side], barY);
  bar.group.position.z = barZ;
  root.add(bar.group);
  view.hpGroup = bar.group;
  view.hpFill = bar.fill;

  // CR pill: the HP number sits inside the bar, level badge at the end.
  const badge = makeLevelBadge(e.side);
  badge.position.set(-barWidth / 2, 0, 0.06);
  bar.group.add(badge);
  const hpText = makeHpText(barY + 0.02);
  hpText.sprite.scale.set(1.1, 0.4, 1);
  hpText.sprite.position.z = barZ + 0.2;
  root.add(hpText.sprite);
  view.hpText = hpText.text;

  view.flashMats = collectFlashMats(root);
  view.lastHp = e.hp;
  view.flashT = 0;
  view.spawnT = SPAWN_POP_TIME; // towers don't pop in
  view.isTroop = false;
  view.baseScale = 1.5; // towers stand 50% larger for prominence
  root.scale.setScalar(1.5);
  return view as EntityView;
}

/** Gravestone for the Tombstone spawner: slab, mound, tiny skull. */
function buildTombstoneMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.22, 10), toon(0x6b5b45));
  mound.position.y = 0.11;
  mound.castShadow = true;
  mound.receiveShadow = true;
  root.add(mound);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.2), toon(0x9aa3ad));
  slab.position.set(0, 0.6, -0.12);
  slab.castShadow = true;
  root.add(slab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12, 1, false, 0, Math.PI), toon(0x9aa3ad));
  cap.rotation.z = Math.PI / 2;
  cap.rotation.y = Math.PI / 2;
  cap.position.set(0, 1.02, -0.12);
  cap.castShadow = true;
  root.add(cap);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.05), toon(0x78909c));
  cross.position.set(0, 0.78, -0.01);
  root.add(cross);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), toon(0xf5f2ea));
  skull.position.set(0.32, 0.12, 0.32);
  root.add(skull);
  const glowOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    unlitGlow(0x76ff03),
  );
  glowOrb.position.set(0, 1.02, 0.02);
  root.add(glowOrb);

  const bar = makeHpBar(1.4, HP_COLOR[e.side], 1.6);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 1.95;
  root.add(label);
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

/** Elixir collector: a wooden vat brimming with glowing elixir. */
function buildCollectorMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.3, 10), toon(0x8d6e63));
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.65, 12), toon(0x6d4c41));
  vat.position.y = 0.62;
  vat.castShadow = true;
  root.add(vat);
  for (const a of [0, 1, 2, 3]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.59 - a * 0.015, 0.025, 6, 14),
      toon(0x4e342e),
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = 0.38 + a * 0.16;
    root.add(hoop);
  }
  const brew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12),
    unlitGlow(0xd946ef),
  );
  brew.position.y = 0.96;
  root.add(brew);
  const drop = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    unlitGlow(0xe879f9),
  );
  drop.position.y = 1.25;
  root.add(drop);

  const bar = makeHpBar(1.4, HP_COLOR[e.side], 1.7);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 2.05;
  root.add(label);
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

function buildBuildingMesh(e: Entity): EntityView {
  if (e.cardId === "tombstone") return buildTombstoneMesh(e);
  if (e.cardId === "elixir-collector") return buildCollectorMesh(e);
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.25, 10), toon(0x8d6e63));
  base.position.y = 0.12;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), toon(0x4e342e));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.62, 0.22, 0);
    wheel.castShadow = true;
    root.add(wheel);
  }
  const barrel = new THREE.Group();
  barrel.position.y = 0.5;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12), toon(0x37474f));
  tube.rotation.x = Math.PI / 2 - 0.18;
  tube.position.z = 0.25;
  tube.castShadow = true;
  barrel.add(tube);
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), toon(0x263238));
  breech.castShadow = true;
  barrel.add(breech);
  root.add(barrel);

  const bar = makeHpBar(1.4, HP_COLOR[e.side], 1.15);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 1.5;
  root.add(label);
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    barrel,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

function buildTroopMesh(e: Entity): EntityView {
  const rig = buildTroop(e.cardId!);
  const root = new THREE.Group();
  // CR proportions: troops read big against the field, with tanks
  // visibly towering over swarm units.
  // Modest size: towers stay the prominent 1.5x landmarks.
  const scale = (e.cardId === "giant" || e.cardId === "pekka" ? 1.35 : 1.25) * 0.95;
  rig.group.scale.setScalar(scale);
  root.add(rig.group);

  // Team ring on the ground.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(e.radius * 0.75, e.radius * 0.95, 24),
    new THREE.MeshBasicMaterial({
      color: SIDE_COLOR[e.side],
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  // Flyers get a soft blob shadow tying them to the ground.
  let blobShadow: THREE.Mesh | undefined;
  if (rig.hover) {
    blobShadow = new THREE.Mesh(
      new THREE.CircleGeometry(e.radius * 0.8, 20),
      new THREE.MeshBasicMaterial({ color: 0x0a0e16, transparent: true, opacity: 0.3 }),
    );
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.025;
    root.add(blobShadow);
  }

  const lift = (rig.hover ?? 0) + rig.height * scale;
  const bar = makeHpBar(0.9, HP_COLOR[e.side], lift + 0.25);
  bar.group.visible = false; // shown once damaged
  root.add(bar.group);

  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = lift + 0.62;
  root.add(label);
  return {
    root,
    rig,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: true,
    blobShadow,
    spawnStyle: spawnStyle(e.cardId),
  };
}

export class Battle3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly views = new Map<number, EntityView>();
  private effects: EffectView[] = [];
  private dying: DyingView[] = [];
  private readonly hoverDisc: THREE.Mesh;
  private ghost: { id: CardId; rig: TroopRig } | null = null;
  /** Trauma-based camera shake; big impacts punch harder than small ones. */
  private readonly shakeCtl = new ShakeController();
  private shakeTime = 0;
  /** Pooled hit sparks / debris, mirrored into one InstancedMesh. */
  private readonly sparks = new ParticleField(PARTICLE_CAP);
  private sparkMesh!: THREE.InstancedMesh;
  /** Rubble piles left by fallen towers; cleared on reset. */
  private rubble: THREE.Object3D[] = [];
  /** Sim projectile meshes by projectile id. */
  private projViews = new Map<number, THREE.Object3D>();
  /** Spectator bodies/heads; they jump when a crown falls. */
  private crowdParts: THREE.Mesh[] = [];
  /** Seconds of crowd cheering left. */
  private cheer = 0;
  /** Seconds until the next ambient bird flyover. */
  private birdTimer = 4;
  /** Scrolling river texture + accumulated flow time. */
  private waterTex: THREE.CanvasTexture | null = null;
  private waterTime = 0;
  private readonly zonePlane: THREE.Mesh;
  private readonly enemyZonePlane: THREE.Mesh;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // CR daylight grade: filmic tone mapping with a touch of extra
    // exposure keeps the greens punchy without blowing highlights.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(ARENA_PALETTE.sky);
    this.scene.fog = new THREE.Fog(ARENA_PALETTE.sky, 45, 75);

    // One InstancedMesh draws every hit spark; unlit + glowing so they pop.
    const sparkMat = new THREE.MeshBasicMaterial();
    sparkMat.toneMapped = false;
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      sparkMat,
      PARTICLE_CAP,
    );
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.scene.add(this.sparkMesh);

    // Orthographic = no perspective convergence, so the arena reads
    // as a perfectly straight board (not a trapezoid). Angled from
    // the player's elevated side, not straight down from the sky.
    this.camera = new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120);
    this.camera.position.copy(CAM_HOME);
    this.camera.lookAt(0, 0, 0);
    this.frameOrtho();

    this.buildLights();
    this.buildArena();

    this.hoverDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    this.hoverDisc.rotation.x = -Math.PI / 2;
    this.hoverDisc.position.y = 0.03;
    this.hoverDisc.visible = false;
    this.scene.add(this.hoverDisc);

    this.zonePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT / 2 - 1),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.13 }),
    );
    this.zonePlane.rotation.x = -Math.PI / 2;
    this.zonePlane.position.set(0, 0.025, ARENA_HEIGHT / 4 + 0.5);
    this.zonePlane.visible = false;
    this.scene.add(this.zonePlane);

    // CR-style "can't deploy there": the enemy half goes dark while
    // a troop card is being placed.
    this.enemyZonePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT / 2 + 1),
      new THREE.MeshBasicMaterial({ color: 0x1a0b10, transparent: true, opacity: 0.38 }),
    );
    this.enemyZonePlane.rotation.x = -Math.PI / 2;
    this.enemyZonePlane.position.set(0, 0.026, -ARENA_HEIGHT / 4 + 0.5);
    this.enemyZonePlane.visible = false;
    this.scene.add(this.enemyZonePlane);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a5f3c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.7);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 60;
    this.scene.add(sun);
  }

  private decorate(): void {
    // Distant ground so the arena never floats in a void.
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshToonMaterial({ color: ARENA_PALETTE.far }),
    );
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.45;
    this.scene.add(far);

    // Outer apron framing the arena.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_WIDTH + 10, 0.36, ARENA_HEIGHT + 10),
      toon(ARENA_PALETTE.apron),
    );
    apron.position.y = -0.24;
    apron.receiveShadow = true;
    this.scene.add(apron);

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
          toon(0x6e4a28),
        );
        post.position.set(
          from[0] + (to[0] - from[0]) * t,
          0.1,
          from[1] + (to[1] - from[1]) * t,
        );
        post.castShadow = true;
        this.scene.add(post);
      }
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), toon(0x7d5a36));
      rail.position.set((from[0] + to[0]) / 2, 0.3, (from[1] + to[1]) / 2);
      rail.rotation.y = -Math.atan2(to[1] - from[1], to[0] - from[0]);
      this.scene.add(rail);
    };
    addFenceRun([-fenceHw, -fenceHd], [fenceHw, -fenceHd], 10);
    addFenceRun([-fenceHw, fenceHd], [fenceHw, fenceHd], 10);
    addFenceRun([-fenceHw, -fenceHd], [-fenceHw, fenceHd], 16);
    addFenceRun([fenceHw, -fenceHd], [fenceHw, fenceHd], 16);

    // Long spectator stands flanking the arena: stone galleries with
    // pitched roofs — red on the enemy half, blue on the player half
    // (CR arenas are walled in by these).
    const stand = (x: number, zCenter: number, len: number, roofColor: number): void => {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, len), toon(0xb3a890));
      wall.position.y = 0.55;
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);

      // A crowd of spectators leaning over the field-side parapet.
      const innerX = -Math.sign(x) * 0.92;
      const CROWD_SKIN = [0xf6c9a0, 0x9c6644, 0xcfa07a] as const;
      const CROWD_GARB = [0xe53935, 0x3b82f6, 0xf2c14e, 0x66bb6a, 0xab47bc] as const;
      const seats = Math.floor(len / 1.1);
      for (let i = 0; i < seats; i++) {
        const z = -len / 2 + 0.7 + i * 1.1 + ((i * 7) % 3) * 0.12;
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.13, 0.26, 6),
          toon(CROWD_GARB[(i * 3 + Math.round(x)) % CROWD_GARB.length]),
        );
        body.position.set(innerX, 1.06, z);
        body.userData.baseY = 1.06;
        g.add(body);
        this.crowdParts.push(body);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 8, 6),
          toon(CROWD_SKIN[(i + Math.abs(Math.round(zCenter))) % CROWD_SKIN.length]),
        );
        head.position.set(innerX, 1.28, z);
        head.userData.baseY = 1.28;
        g.add(head);
        this.crowdParts.push(head);
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
      this.scene.add(g);
    };
    const standX = ARENA_WIDTH / 2 + 6.2;
    const standLen = ARENA_HEIGHT / 2 - 2.5;
    for (const sx of [-1, 1]) {
      stand(sx * standX, -ARENA_HEIGHT / 4 - 1, standLen, 0xb02e22); // enemy side
      stand(sx * standX, ARENA_HEIGHT / 4 + 1, standLen, 0x2c55b8); // player side
    }

    // Striped spectator tents in the corners, team-colored.
    const tent = (x: number, z: number, color: number): void => {
      const g = new THREE.Group();
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.3, 8), toon(color));
      roof.position.y = 1.15;
      roof.castShadow = true;
      g.add(roof);
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.15, 0.9, 8),
        toon(0xe8e3d8),
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
      this.scene.add(g);
    };
    const tHw = ARENA_WIDTH / 2 + 3.1;
    const tHd = ARENA_HEIGHT / 2 + 3.0;
    tent(-tHw, tHd, 0x3b6fd4);
    tent(tHw, tHd, 0x3b6fd4);
    tent(-tHw, -tHd, 0xd44a3b);
    tent(tHw, -tHd, 0xd44a3b);

    // Lanterns (arabic) or torches (normal) flanking each bridge approach.
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      for (const sz of [-1, 1]) {
        if (arabic) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 6), toon(THEME.stone));
          pole.position.set(w.x + 1.45, 0.55, sz * 2.2);
          pole.castShadow = true;
          this.scene.add(pole);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 4), toon(THEME.gold));
          arm.rotation.z = Math.PI / 2;
          arm.position.set(w.x + 1.32, 1.08, sz * 2.2);
          this.scene.add(arm);
          const lantern = makeLantern(0.95);
          lantern.position.set(w.x + 1.2, 0.92, sz * 2.2);
          this.scene.add(lantern);
        } else {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), toon(0x5a4632));
          pole.position.set(w.x + 1.45, 0.55, sz * 2.2);
          pole.castShadow = true;
          this.scene.add(pole);
          const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), unlitGlow(0xffa726));
          flame.position.set(w.x + 1.45, 1.2, sz * 2.2);
          this.scene.add(flame);
        }
      }
    }

    // Date palms (arabic) or pines (normal).
    const tree = (x: number, z: number, s: number): void => {
      const g = new THREE.Group();
      if (arabic) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 8), toon(0x8a6a3e));
        trunk.position.y = 0.75;
        trunk.rotation.z = 0.06;
        trunk.castShadow = true;
        g.add(trunk);
        for (let i = 0; i < 7; i++) {
          const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.0, 5), toon(i % 2 ? 0x3f8f45 : 0x57a83f));
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
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 8), toon(0x6e4a28));
        trunk.position.y = 0.25;
        trunk.castShadow = true;
        g.add(trunk);
        for (let i = 0; i < 3; i++) {
          const layer = new THREE.Mesh(new THREE.ConeGeometry(0.75 - i * 0.18, 0.7, 10), toon(i % 2 ? 0x3f8f45 : 0x4ba14f));
          layer.position.y = 0.62 + i * 0.42;
          layer.castShadow = true;
          g.add(layer);
        }
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      this.scene.add(g);
    };
    const rock = (x: number, z: number, s: number): void => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), toon(0x8e9aa5));
      m.position.set(x, 0.16 * s, z);
      m.scale.set(s, s * 0.7, s);
      m.castShadow = true;
      this.scene.add(m);
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

    // Flower dots on the playfield grass.
    const flowerSpots: Array<[number, number, number]> = [
      [1.5, -11, 0xfff176], [-6.5, -4, 0xf48fb1], [6.8, -13, 0xffffff],
      [-2.2, 11, 0xfff176], [7.1, 5.5, 0xf48fb1], [-7.4, 13.2, 0xffffff],
      [4.4, 9.8, 0xf48fb1], [-4.8, -13.5, 0xffffff],
    ];
    for (const [x, z, color] of flowerSpots) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), toon(color));
      f.position.set(x, 0.06, z);
      this.scene.add(f);
    }
  }

  /** Flat golden crescent moon inlaid in the floor (arena centerpiece). */
  private makeCrescentEmblem(z: number): THREE.Group {
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
    const crescent = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(0xe8b948));
    crescent.rotation.x = -Math.PI / 2;
    crescent.rotation.z = 0; // open the crescent vertically (down the board)
    crescent.position.set(0, 0.03, z);
    crescent.receiveShadow = true;
    g.add(crescent);
    return g;
  }

  /** Original winter floor: sandy stone blocks with mortar lines. */
  private makeStoneTexture(): THREE.CanvasTexture {
    const tile = 32;
    const c = document.createElement("canvas");
    c.width = ARENA_WIDTH * tile;
    c.height = ARENA_HEIGHT * tile;
    const ctx = c.getContext("2d")!;
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffff) / 0xffff;
    };
    const block = tile * 2;
    for (let y = 0; y < c.height; y += block) {
      for (let x = 0; x < c.width; x += block) {
        const shade = 0.92 + rand() * 0.08;
        ctx.fillStyle = `rgb(${Math.round(214 * shade)},${Math.round(196 * shade)},${Math.round(158 * shade)})`;
        ctx.fillRect(x, y, block, block);
        ctx.fillStyle = "rgba(120,100,70,0.10)";
        for (let s = 0; s < 6; s++) ctx.fillRect(x + rand() * block, y + rand() * block, 2, 2);
      }
    }
    ctx.strokeStyle = "rgba(120,100,70,0.45)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= c.width; x += block) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    for (let y = 0; y <= c.height; y += block) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Islamic zellige floor: 8-point-star-and-cross tilework, gold strapwork. */
  private makeZelligeTexture(): THREE.CanvasTexture {
    const tile = 32; // px per arena unit
    const c = document.createElement("canvas");
    c.width = ARENA_WIDTH * tile;
    c.height = ARENA_HEIGHT * tile;
    const ctx = c.getContext("2d")!;

    // Pale warm plaster base — kept light so the units read clearly on top.
    ctx.fillStyle = "#efe7cf";
    ctx.fillRect(0, 0, c.width, c.height);

    const cell = tile * 4; // one star motif every 4 arena units
    const R = cell * 0.46;
    const inner = R * 0.41;
    const star8 = (cx: number, cy: number, o: number, i2: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI / 8) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? o : i2;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    const diamond = (cx: number, cy: number, s: number): void => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
    };

    ctx.lineJoin = "round";
    // Everything is drawn as a faint tint + thin strapwork so the pattern
    // stays a quiet "watermark" the troops read clearly against.
    for (let y = 0; y <= c.height; y += cell) {
      for (let x = 0; x <= c.width; x += cell) {
        diamond(x, y, cell * 0.2);
        ctx.fillStyle = "rgba(184,92,56,0.10)";
        ctx.fill();
        ctx.strokeStyle = "rgba(202,162,63,0.20)";
        ctx.lineWidth = tile * 0.05;
        ctx.stroke();
      }
    }
    for (let y = cell / 2; y < c.height; y += cell) {
      for (let x = cell / 2; x < c.width; x += cell) {
        star8(x, y, R, inner);
        ctx.fillStyle = "rgba(26,163,160,0.12)";
        ctx.fill();
        ctx.strokeStyle = "rgba(202,162,63,0.28)";
        ctx.lineWidth = tile * 0.06;
        ctx.stroke();
      }
    }
    // Whisper-faint gold lattice for the interlaced look.
    ctx.strokeStyle = "rgba(202,162,63,0.07)";
    ctx.lineWidth = tile * 0.04;
    for (let x = cell / 2; x < c.width; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    for (let y = cell / 2; y < c.height; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** A lumpy mound edging the field (snow drift / sand dune by theme). */
  private makeSnowDrift(x: number, z: number, scale: number): THREE.Mesh {
    const drift = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      toon(ARENA_PALETTE.drift),
    );
    drift.scale.set(scale, scale * 0.45, scale);
    drift.position.set(x, -0.05, z);
    drift.castShadow = true;
    drift.receiveShadow = true;
    return drift;
  }

  private buildArena(): void {
    // One checkered playfield slab instead of two flat halves.
    const fieldMat = new THREE.MeshToonMaterial({
      map: arabic ? this.makeZelligeTexture() : this.makeStoneTexture(),
    });
    const field = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.4, ARENA_HEIGHT),
      [
        toon(ARENA_PALETTE.fieldSide).clone(), // stone sides
        toon(ARENA_PALETTE.fieldSide).clone(),
        fieldMat, // top
        toon(ARENA_PALETTE.fieldSide).clone(),
        toon(ARENA_PALETTE.fieldSide).clone(),
        toon(ARENA_PALETTE.fieldSide).clone(),
      ],
    );
    field.position.set(0, -0.2, 0);
    field.receiveShadow = true;
    this.scene.add(field);

    // Snow drifts piled along the playfield edges (winter theme).
    const dhw = ARENA_WIDTH / 2 + 1.1;
    const dhd = ARENA_HEIGHT / 2 + 0.6;
    const driftSpots: Array<[number, number, number]> = [
      [-dhw, -11, 1.6], [-dhw, -3, 1.3], [-dhw, 6, 1.7], [-dhw, 13, 1.4],
      [dhw, -13, 1.5], [dhw, -5, 1.6], [dhw, 4, 1.3], [dhw, 12, 1.7],
      [-5, -dhd, 1.8], [5, -dhd, 1.5], [-6, dhd, 1.6], [6, dhd, 1.9],
    ];
    for (const [x, z, sc] of driftSpots) {
      this.scene.add(this.makeSnowDrift(x, z, sc));
    }

    // Edging around the playfield, post at each corner.
    const hw = ARENA_WIDTH / 2 + 0.45;
    const hd = ARENA_HEIGHT / 2 + 0.15;
    const stone = ARENA_PALETTE.edging;
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, ARENA_HEIGHT + 0.9), toon(stone));
      rail.position.set(side * hw, 0.05, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(ARENA_WIDTH + 1.4, 0.34, 0.5), toon(stone));
      cap.position.set(0, 0.05, side * hd);
      cap.castShadow = true;
      cap.receiveShadow = true;
      this.scene.add(cap);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), toon(0xb3a890));
        post.position.set(sx * hw, 0.18, sz * hd);
        post.castShadow = true;
        this.scene.add(post);
      }
    }
    this.decorate();

    // CR-style golden dirt lanes from each bridge to the towers.
    const laneCanvas = document.createElement("canvas");
    laneCanvas.width = 32;
    laneCanvas.height = 256;
    const lctx = laneCanvas.getContext("2d")!;
    const grad = lctx.createLinearGradient(0, 0, 32, 0);
    grad.addColorStop(0, "rgba(214,178,94,0)");
    grad.addColorStop(0.18, "rgba(214,178,94,0.9)");
    grad.addColorStop(0.5, "rgba(222,189,108,0.95)");
    grad.addColorStop(0.82, "rgba(214,178,94,0.9)");
    grad.addColorStop(1, "rgba(214,178,94,0)");
    lctx.fillStyle = grad;
    lctx.fillRect(0, 0, 32, 256);
    // Speckled wear so the path reads as trodden dirt.
    lctx.fillStyle = "rgba(160,124,58,0.5)";
    for (let i = 0; i < 90; i++) {
      lctx.fillRect((i * 13) % 30, (i * 47) % 254, 2, 1.5);
    }
    lctx.fillStyle = "rgba(255,236,170,0.35)";
    for (let i = 0; i < 60; i++) {
      lctx.fillRect((i * 19 + 5) % 30, (i * 31 + 9) % 254, 1.5, 1);
    }
    const laneTex = new THREE.CanvasTexture(laneCanvas);
    laneTex.colorSpace = THREE.SRGBColorSpace;
    for (const bx of BRIDGE_XS) {
      const lane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, ARENA_HEIGHT - 1.2),
        new THREE.MeshToonMaterial({ map: laneTex, transparent: true }),
      );
      lane.rotation.x = -Math.PI / 2;
      const w = toWorld(bx, ARENA_HEIGHT / 2);
      lane.position.set(w.x, 0.012, 0);
      lane.receiveShadow = true;
      this.scene.add(lane);
    }

    // Bright CR-blue water with drifting light streaks.
    const waterCanvas = document.createElement("canvas");
    waterCanvas.width = 128;
    waterCanvas.height = 32;
    const wctx = waterCanvas.getContext("2d")!;
    wctx.fillStyle = "#3f97e0";
    wctx.fillRect(0, 0, 128, 32);
    wctx.strokeStyle = "rgba(255,255,255,0.5)";
    wctx.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) {
      const y = 3 + ((i * 37) % 26);
      const x = (i * 29) % 110;
      wctx.beginPath();
      wctx.moveTo(x, y);
      wctx.quadraticCurveTo(x + 7, y - 2, x + 14, y);
      wctx.stroke();
    }
    this.waterTex = new THREE.CanvasTexture(waterCanvas);
    this.waterTex.wrapS = THREE.RepeatWrapping;
    this.waterTex.colorSpace = THREE.SRGBColorSpace;
    const river = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.22, 2.2),
      new THREE.MeshToonMaterial({ map: this.waterTex }),
    );
    river.position.set(0, -0.04, 0);
    this.scene.add(river);

    // Golden crescent emblem inlaid on each player's half.
    for (const sz of [-1, 1]) {
      const z = sz * (ARENA_HEIGHT / 4 + 0.5);
      this.scene.add(this.makeCrescentEmblem(z));
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
        this.scene.add(deck);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.06, 2.66), toon(THEME.gold));
        rim.position.set(w.x, 0.21, 0);
        this.scene.add(rim);
        const gate = archGateway();
        gate.position.set(w.x, 0.2, 0);
        this.scene.add(gate);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 2.6), toon(THEME.stone));
          wall.position.set(w.x + side * 0.92, 0.34, 0);
          wall.castShadow = true;
          this.scene.add(wall);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 2.66), toon(THEME.gold));
          cap.position.set(w.x + side * 0.92, 0.53, 0);
          this.scene.add(cap);
          for (const ez of [-1.2, 1.2]) {
            const post = onionDome(0.16, THEME.teal);
            post.position.set(w.x + side * 0.92, 0.4, ez);
            this.scene.add(post);
          }
        }
      }
    } else {
      // Original golden-plank boardwalk bridges.
      const plankCanvas = document.createElement("canvas");
      plankCanvas.width = 64;
      plankCanvas.height = 64;
      const pctx = plankCanvas.getContext("2d")!;
      pctx.fillStyle = "#e0b04f";
      pctx.fillRect(0, 0, 64, 64);
      pctx.fillStyle = "#c2913a";
      for (let i = 0; i < 8; i++) pctx.fillRect(0, i * 8, 64, 1.6);
      pctx.fillStyle = "rgba(122,86,28,0.5)";
      for (let i = 0; i < 10; i++) pctx.fillRect((i * 23) % 60, ((i * 17) % 7) * 8 + 3, 2.5, 1.5);
      pctx.fillStyle = "rgba(255,235,170,0.4)";
      for (let i = 0; i < 8; i++) pctx.fillRect((i * 29 + 7) % 60, ((i * 13) % 7) * 8 + 1, 3, 1);
      const plankTex = new THREE.CanvasTexture(plankCanvas);
      plankTex.colorSpace = THREE.SRGBColorSpace;
      for (const bx of BRIDGE_XS) {
        const w = toWorld(bx, RIVER_Y);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 2.6), new THREE.MeshToonMaterial({ map: plankTex }));
        deck.position.set(w.x, 0.1, 0);
        deck.castShadow = true;
        deck.receiveShadow = true;
        this.scene.add(deck);
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 2.6), toon(0xb8893a));
          rail.position.set(w.x + side * 0.95, 0.3, 0);
          rail.castShadow = true;
          this.scene.add(rail);
          for (const ez of [-1.18, 1.18]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), toon(0x5d3f24));
            post.position.set(w.x + side * 0.95, 0.32, ez);
            post.castShadow = true;
            this.scene.add(post);
          }
        }
      }
    }
  }

  /** Fit the arena to the viewport with an orthographic frustum. */
  private frameOrtho(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    // World-units of half-height the view must cover so the whole
    // board (incl. towers + edging) fits; width follows the aspect.
    const halfH = 15.5;
    const halfW = Math.max(halfH * aspect, 10.5);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.frameOrtho();
  }

  /**
   * Choose which side sits at the bottom of the screen. The host views as
   * "player" (default); an online guest views as "enemy" so they too look at
   * their own towers from below. Call before a match builds its entities.
   */
  setViewpoint(side: Side): void {
    viewSide = side;
    this.camera.position.set(CAM_HOME.x, CAM_HOME.y, cameraZForView());
    this.camera.lookAt(0, 0, 0);
    const m = side === "player" ? 1 : -1;
    this.zonePlane.position.z = m * (ARENA_HEIGHT / 4 + 0.5);
    this.enemyZonePlane.position.z = -m * (ARENA_HEIGHT / 4 - 0.5);
  }

  /** Convert a pointer event to arena tile coordinates, if on the field. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
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
  ): void {
    if (!pos) {
      this.hoverDisc.visible = false;
      return;
    }
    const w = toWorld(pos.x, pos.y);
    this.hoverDisc.visible = true;
    this.hoverDisc.position.set(w.x, 0.03, w.z);
    this.hoverDisc.scale.setScalar(radiusTiles / 0.6);
    (this.hoverDisc.material as THREE.MeshBasicMaterial).color.set(
      !valid ? 0xef4444 : spell ? 0xff8c1a : 0x4ade80,
    );
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
      const rig = buildTroop(cardId);
      rig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = (mesh.material as THREE.Material).clone() as THREE.Material & {
            opacity: number;
          };
          mat.transparent = true;
          mat.opacity = 0.45;
          mesh.material = mat;
          mesh.castShadow = false;
        }
      });
      this.scene.add(rig.group);
      this.ghost = { id: cardId, rig };
    }
    const w = toWorld(pos.x, pos.y);
    this.ghost.rig.group.visible = true;
    this.ghost.rig.group.position.set(w.x, this.ghost.rig.hover ?? 0, w.z);
  }

  setZoneVisible(visible: boolean): void {
    this.zonePlane.visible = visible;
    this.enemyZonePlane.visible = visible;
  }

  private addEffect(
    obj: THREE.Object3D,
    ttl: number,
    update: (frac: number) => void,
    delay = 0,
  ): void {
    if (delay > 0) obj.visible = false;
    this.scene.add(obj);
    this.effects.push({ obj, ttl, ttl0: ttl, delay, update });
  }

  private blast(ax: number, ay: number, radius: number, color: number, delay = 0): void {
    const w = toWorld(ax, ay);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    ball.position.set(w.x, 0.4, w.z);
    this.addEffect(
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
    this.addEffect(
      ring,
      0.45,
      (frac) => {
        ring.scale.setScalar(0.3 + (1 - frac) * radius * 1.15);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * frac;
      },
      delay,
    );
  }

  private puff(ax: number, ay: number, color: number, size = 0.5): void {
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
    group.position.set(w.x, 0.1, w.z);
    this.addEffect(group, 0.45, (frac) => {
      group.scale.setScalar(1 + (1 - frac) * 1.6);
      group.position.y = 0.1 + (1 - frac) * 0.5;
      for (const child of group.children) {
        ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * frac;
      }
    });
  }

  /** A small arrow-shaped missile oriented along its flight path. */
  private makeArrow(color: number, length = 0.7): THREE.Group {
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
  private projectile(ev: Extract<BattleEvent, { type: "attack" }>): void {
    const style = projectileStyle(ev.cardId, ev.kind);
    if (!style.muzzleFlash) return;
    const from = toWorld(ev.x, ev.y);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true }),
    );
    (flash.material as THREE.MeshBasicMaterial).toneMapped = false; // stays hot
    flash.position.set(from.x, ev.kind === "troop" ? 0.9 : 1.6, from.z);
    this.addEffect(flash, 0.1, (frac) => {
      flash.scale.setScalar(1 + (1 - frac) * 1.8);
      (flash.material as THREE.MeshBasicMaterial).opacity = frac;
    });
  }

  /** Mirror the sim's in-flight projectiles as meshes. */
  private syncProjectiles(state: BattleState): void {
    const seen = new Set<number>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let view = this.projViews.get(p.id);
      if (!view) {
        const style = projectileStyle(p.cardId, p.sourceKind);
        if (style.form === "arrow") {
          view = this.makeArrow(style.color);
        } else {
          const mat = style.glow
            ? unlitGlow(style.color)
            : new THREE.MeshBasicMaterial({ color: style.color });
          const orb = new THREE.Mesh(new THREE.SphereGeometry(style.size, 8, 6), mat);
          if (style.glow) {
            const trail = new THREE.Mesh(
              new THREE.SphereGeometry(style.size * 0.8, 8, 6),
              new THREE.MeshBasicMaterial({
                color: style.color,
                transparent: true,
                opacity: 0.4,
              }),
            );
            trail.scale.z = 3.2;
            trail.position.z = -style.size * 2.2;
            orb.add(trail);
          }
          view = orb;
        }
        this.scene.add(view);
        this.projViews.set(p.id, view);
      }
      // Arc by flight progress: launch point -> current target leg.
      const style = projectileStyle(p.cardId, p.sourceKind);
      const target = state.entities.find((o) => o.id === p.targetId);
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
    for (const [id, view] of this.projViews) {
      if (!seen.has(id)) {
        // Spark where the shot landed (or fizzled) for a crisp impact.
        this.sparks.emit({
          x: view.position.x, y: view.position.y, z: view.position.z,
          count: 5, speed: 3, spread: 1.4, life: 0.4, size: 0.09, color: 0xfff1c4,
        });
        this.scene.remove(view);
        disposeDeep(view);
        this.projViews.delete(id);
      }
    }
  }

  /** Fireball: a flaming meteor crashes down, then explodes. */
  private fireballStrike(ax: number, ay: number): void {
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
    this.addEffect(meteor, FALL, (frac) => {
      const t = 1 - frac;
      meteor.position.set(
        start.x + (w.x - start.x) * t,
        start.y + (0.3 - start.y) * t,
        start.z + (w.z - start.z) * t,
      );
    });
    this.blast(ax, ay, 2.5, 0xff7814, FALL);
  }

  /** Zap: a jagged lightning bolt slams down with an electric flash. */
  private zapStrike(ax: number, ay: number, radius: number): void {
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
    this.addEffect(bolt, 0.25, (frac) => {
      bolt.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.transparent = true;
          mat.opacity = frac;
        }
      });
    });
    this.blast(ax, ay, radius, 0xfff176, 0.1);
  }

  /** Rage: a pulsing purple ring marks the boost zone for its lifetime. */
  private rageZone(ax: number, ay: number, radius: number, seconds: number): void {
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
    this.addEffect(group, seconds, (frac) => {
      const pulse = 1 + Math.sin((1 - frac) * seconds * Math.PI * 4) * 0.04;
      group.scale.set(pulse, 1, pulse);
      const fade = frac < 0.15 ? frac / 0.15 : 1;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
      (haze.material as THREE.MeshBasicMaterial).opacity = 0.16 * fade;
    });
  }

  /** Freeze: an icy flash, then a lingering frost ring while frozen. */
  private freezeBlast(ax: number, ay: number, radius: number, seconds: number): void {
    const w = toWorld(ax, ay);
    this.blast(ax, ay, radius, 0xb2ebff, 0);
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
    this.addEffect(frost, seconds, (frac) => {
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
      this.addEffect(shard, seconds, (frac) => {
        const grow = Math.min(1, (1 - frac) * seconds * 3);
        shard.scale.setScalar(Math.max(0.05, grow));
        shard.position.y = 0.25 * grow;
        (shard.material as THREE.MeshToonMaterial).opacity = Math.min(1, frac * 3);
      });
    }
  }

  /** Arrows: a volley rains down across the radius, then a ring pop. */
  private arrowVolley(ax: number, ay: number, radius: number): void {
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + (i % 3) * 0.4;
      const r = radius * (0.25 + 0.7 * ((i * 37) % 10) * 0.1);
      const ox = Math.cos(angle) * r;
      const oz = Math.sin(angle) * r;
      const w = toWorld(ax, ay);
      const arrow = this.makeArrow(0x4e342e, 0.6);
      const x = w.x + ox;
      const z = w.z + oz;
      const y0 = 6 + (i % 4) * 0.5;
      arrow.position.set(x + 0.6, y0, z - 1.2);
      arrow.lookAt(x, 0.05, z);
      this.addEffect(
        arrow,
        0.3,
        (frac) => {
          const t = 1 - frac;
          arrow.position.set(x + 0.6 * (1 - t), y0 * (1 - t) + 0.05 * t, z - 1.2 * (1 - t));
        },
        i * 0.035,
      );
    }
    this.blast(ax, ay, radius, 0xdce6ff, 0.32);
  }

  /** Permanent pile of broken masonry where a tower used to stand. */
  private dropRubble(ax: number, ay: number, king: boolean): void {
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
    this.scene.add(pile);
    this.rubble.push(pile);
  }

  /** Roaring red shockwave + steam when a sleeping king wakes up. */
  private kingWakeBurst(side: Side): void {
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
    this.addEffect(ring, 0.7, (frac) => {
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
      this.addEffect(
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
    this.addShake(0.35);
  }

  /** Kick the camera; trauma stacks but is clamped. */
  private addShake(amount: number): void {
    this.shakeCtl.add(amount);
  }

  /** Throw a burst of glowing sparks at an arena point. */
  private emitSparks(
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
    this.sparks.emit({ x: w.x, y: height, z: w.z, count, speed, spread, life, size, color });
  }

  /** Dark necromantic disc that summoned skeletons rise through. */
  private summonPortal(ax: number, ay: number): void {
    const w = toWorld(ax, ay);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x2e1a47, transparent: true }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(w.x, 0.04, w.z);
    this.addEffect(disc, 0.6, (frac) => {
      disc.scale.setScalar(0.4 + (1 - frac) * 0.8);
      (disc.material as THREE.MeshBasicMaterial).opacity = frac * 0.75;
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 24),
      new THREE.MeshBasicMaterial({
        color: 0x76ff03,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(w.x, 0.05, w.z);
    this.addEffect(ring, 0.6, (frac) => {
      ring.scale.setScalar(0.5 + (1 - frac) * 1.1);
      (ring.material as THREE.MeshBasicMaterial).opacity = frac * 0.8;
    });
  }

  /** Bone shards scattering from a fallen skeleton. */
  private boneScatter(ax: number, ay: number, color: number): void {
    const w = toWorld(ax, ay);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + i;
      const bone = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.22, 0.06),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      const vx = Math.cos(a) * (1.2 + (i % 3) * 0.5);
      const vz = Math.sin(a) * (1.2 + (i % 3) * 0.5);
      this.addEffect(bone, 0.55, (frac) => {
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
  private sparkBurst(ax: number, ay: number, color: number): void {
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
      this.addEffect(spark, 0.4, (frac) => {
        const t = 1 - frac;
        spark.position.set(
          w.x + Math.cos(a) * r * t,
          0.7 + (i % 2) * 0.8 * t,
          w.z + Math.sin(a) * r * t,
        );
        (spark.material as THREE.MeshBasicMaterial).opacity = frac;
      });
    }
    this.blast(ax, ay, 0.9, color, 0);
  }

  /** The balloon envelope spirals down, shrinking as it vents. */
  private deflate(ax: number, ay: number, color: number): void {
    const w = toWorld(ax, ay);
    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    envelope.scale.y = 1.15;
    this.addEffect(envelope, 0.9, (frac) => {
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
  private damagePopup(
    x: number,
    y: number,
    z: number,
    label: { text: string; scale: number; color: string },
  ): void {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 44px 'Chalkboard SE', 'Comic Sans MS', 'Trebuchet MS', sans-serif";
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
    this.addEffect(sprite, 0.75, (frac) => {
      const t = 1 - frac;
      sprite.position.y = y + 0.3 + t * 1.1;
      const pop = Math.min(1, t * 8);
      sprite.scale.set(s * 2 * pop, s * pop, 1);
      sprite.material.opacity = frac < 0.25 ? frac / 0.25 : 1;
    });
  }

  /** A golden crown rises, spins, and fades over a fallen tower. */
  private crownPop(ax: number, ay: number): void {
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
    this.addEffect(crown, 1.2, (frac) => {
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

  /** An emote bubble floating above a side's king tower. */
  showEmote(side: Side, emoji: string): void {
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
    this.addEffect(sprite, 2.4, (frac) => {
      const t = 1 - frac;
      const pop = Math.min(1, t * 6);
      sprite.scale.setScalar(2.2 * (0.2 + 0.8 * pop));
      sprite.position.y = 4.2 + t * 0.5;
      sprite.material.opacity = frac < 0.15 ? frac / 0.15 : 1;
    });
  }

  /** Visual reactions to gameplay events. */
  onEvent(ev: BattleEvent): void {
    switch (ev.type) {
      case "spell":
        if (ev.cardId === "fireball") this.fireballStrike(ev.x, ev.y);
        else if (ev.cardId === "zap") this.zapStrike(ev.x, ev.y, 2);
        else if (ev.cardId === "rage") this.rageZone(ev.x, ev.y, 2.5, 6);
        else if (ev.cardId === "freeze") this.freezeBlast(ev.x, ev.y, 3, 4);
        else this.arrowVolley(ev.x, ev.y, 4);
        break;
      case "attack":
        if (ev.ranged) {
          this.projectile(ev);
        } else {
          // Melee landed: sparks fly off the struck target and a heavy
          // bruiser kicks the camera. (Ranged hits spark when the shot lands.)
          const s = impactStyle(ev.cardId);
          this.emitSparks(ev.targetX, ev.targetY, 0.8, s.particles, s.speed, s.spread, s.color, s.size);
          if (s.trauma > 0) this.addShake(s.trauma);
        }
        break;
      case "death":
        if (ev.kind === "troop") {
          const style = deathStyle(ev.cardId);
          if (style.kind === "bones") this.boneScatter(ev.x, ev.y, style.color);
          else if (style.kind === "sparks") this.sparkBurst(ev.x, ev.y, style.color);
          else if (style.kind === "deflate") this.deflate(ev.x, ev.y, style.color);
          else this.puff(ev.x, ev.y, style.color, 0.5);
          // A little extra crunch on every troop death.
          this.emitSparks(ev.x, ev.y, 0.6, 6, 3.5, 1.5, style.color, 0.09, 0.5);
        } else {
          this.puff(ev.x, ev.y, 0x8b7c69, 1.6);
          if (ev.kind !== "building") {
            this.crownPop(ev.x, ev.y);
            this.cheer = 1.8; // the stands go wild
            this.dropRubble(ev.x, ev.y, ev.kind === "king-tower");
            this.addShake(ev.kind === "king-tower" ? 0.9 : 0.55);
          }
        }
        break;
      case "king-wake":
        this.kingWakeBurst(ev.side);
        break;
      default:
        break;
    }
  }

  /** Start the topple/sink-and-fade animation for a removed entity. */
  private beginDeath(view: EntityView): void {
    const fadeMats: DyingView["fadeMats"] = [];
    view.root.traverse((o) => {
      const sprite = o as THREE.Sprite;
      if (sprite.isSprite) {
        // Label materials are shared between units — hide, don't fade.
        sprite.visible = false;
        return;
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material & { opacity: number };
        mat.transparent = true;
        fadeMats.push(mat);
      }
    });
    this.dying.push({
      view,
      t: 0,
      duration: view.isTroop ? TROOP_DEATH_TIME : TOWER_DEATH_TIME,
      topple: view.isTroop ? (view.root.position.x > 0 ? 1.35 : -1.35) : 0.12,
      fadeMats,
    });
  }

  /** Create/update/remove meshes to mirror the battle state. */
  sync(state: BattleState, dt: number): void {
    this.syncProjectiles(state);
    const seen = new Set<number>();
    for (const e of state.entities) {
      seen.add(e.id);
      let view = this.views.get(e.id);
      if (!view) {
        view =
          e.kind === "troop"
            ? buildTroopMesh(e)
            : e.kind === "building"
              ? buildBuildingMesh(e)
              : buildTowerMesh(e);
        this.views.set(e.id, view);
        this.scene.add(view.root);
        // Entry flourish: a dark portal for risers, dust for poppers.
        if (view.spawnStyle === "rise") this.summonPortal(e.x, e.y);
        else if (view.isTroop) this.puff(e.x, e.y, 0xd9cdb8, 0.45);
      }
      const w = toWorld(e.x, e.y);
      view.root.position.x = w.x;
      view.root.position.z = w.z;

      // Spawn entrance: rise out of the ground, or pop-in bounce.
      const baseScale = view.baseScale ?? 1;
      if (view.spawnT < SPAWN_POP_TIME) {
        view.spawnT += dt;
        const f = Math.min(1, view.spawnT / SPAWN_POP_TIME);
        if (view.spawnStyle === "rise") {
          view.root.position.y = -1.0 * (1 - f) * (1 - f);
          view.root.scale.setScalar(baseScale);
        } else {
          view.root.scale.setScalar(Math.max(0.05, easeOutBack(f) * baseScale));
        }
      } else if (view.root.scale.x !== baseScale || view.root.position.y !== 0) {
        view.root.scale.setScalar(baseScale);
        view.root.position.y = 0;
      }

      // Emissive glow chain: damage flash > rage pink > charge gold.
      const lost = view.lastHp - e.hp;
      if (lost > 0.5) view.flashT = FLASH_TIME;
      view.lastHp = e.hp;

      // Floating combat text, batched so swarms don't spam numbers.
      if (lost > 0.5) view.pendingDmg = (view.pendingDmg ?? 0) + lost;
      view.popupT = Math.max(0, (view.popupT ?? 0) - dt);
      if ((view.pendingDmg ?? 0) > 0 && view.popupT === 0) {
        const label = damageLabel(view.pendingDmg!);
        view.pendingDmg = 0;
        view.popupT = 0.35;
        if (label) {
          const lift = view.rig
            ? (view.rig.hover ?? 0) + view.rig.height
            : e.kind === "building"
              ? 1.2
              : 2.4;
          this.damagePopup(w.x, lift, w.z, label);
        }
      }
      const raged = e.kind === "troop" && isRaged(state, e);
      const charging = e.chargeDistance > 0 && e.chargeProgress >= e.chargeDistance;
      if (view.flashT > 0) {
        view.flashT = Math.max(0, view.flashT - dt);
        const k = view.flashT / FLASH_TIME;
        for (const f of view.flashMats) f.mat.emissive.setRGB(k, k, k);
        view.glowing = true;
      } else if (raged) {
        const pulse = 0.32 + Math.sin(state.time * 9) * 0.1;
        for (const f of view.flashMats) f.mat.emissive.setRGB(pulse, 0.05, 0.18);
        view.glowing = true;
      } else if (charging) {
        const k = 0.25 + Math.sin(state.time * 14) * 0.12;
        for (const f of view.flashMats) f.mat.emissive.setRGB(k, k * 0.75, 0);
        view.glowing = true;
      } else if (view.glowing) {
        for (const f of view.flashMats) f.mat.emissive.setHex(f.orig);
        view.glowing = false;
      }

      // Seeing stars while stunned.
      if (e.stunTimer > 0 && e.kind === "troop") {
        if (!view.stunStars) {
          view.stunStars = makeStunSprite();
          const lift = view.rig ? (view.rig.hover ?? 0) + view.rig.height : 1.4;
          view.stunStars.position.y = lift + 0.35;
          view.root.add(view.stunStars);
        }
        view.stunStars.visible = true;
        view.stunStars.material.rotation = state.time * 4;
      } else if (view.stunStars) {
        view.stunStars.visible = false;
      }

      if (view.barrel) {
        const target = state.entities.find((o) => o.id === e.targetId);
        if (target) {
          const tw = toWorld(target.x, target.y);
          view.barrel.rotation.y = Math.atan2(tw.x - w.x, tw.z - w.z);
        }
      }

      // Tower crew: aim at the target, swing on attack, and let the
      // sleeping king slump over his battlements.
      if (view.defender && view.defenderMount) {
        const target = state.entities.find((o) => o.id === e.targetId);
        const swing = attackSwing(e, target !== undefined);
        animateTroop(view.defender, {
          moving: false,
          swing,
          time: state.time,
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

      const barWidth =
        e.kind === "troop" ? 0.9 : e.kind === "building" ? 1.4 : e.kind === "king-tower" ? 2.2 : 1.8;
      setHpFill(view, e.hp / e.maxHp, barWidth);
      if (e.kind === "troop" && e.hp < e.maxHp) view.hpGroup.visible = true;
      if (view.hpText) updateHpText(view.hpText, e.hp);
      if (view.zzz) view.zzz.visible = !e.active;

      if (view.rig) {
        const target = state.entities.find((o) => o.id === e.targetId);
        const inRange =
          !!target &&
          distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
        const swing = attackSwing(e, inRange);
        const moving = !inRange && e.deployTimer <= 0;
        animateTroop(view.rig, {
          moving,
          swing,
          time: state.time,
          phase: e.id * 1.7,
          charging,
        });

        // Flyer blob shadow tracks the bob; walkers kick up dust.
        if (view.blobShadow && view.rig.hover) {
          const s = blobShadowScale(view.rig.hover, view.rig.group.position.y);
          view.blobShadow.scale.setScalar(s);
        }
        if (!view.rig.hover && moving && e.stunTimer <= 0) {
          view.dustT = (view.dustT ?? Math.random() * DUST_INTERVAL) - dt;
          if (view.dustT <= 0) {
            view.dustT = DUST_INTERVAL;
            this.puff(e.x, e.y, 0xcfc4b2, 0.16);
          }
        }
        // Face the attack target, or the spot being walked toward —
        // turning smoothly rather than snapping.
        let targetYaw: number | null = null;
        if (target) {
          const goal = inRange ? target : moveGoal(e, target);
          const gw = toWorld(goal.x, goal.y);
          if (Math.hypot(gw.x - w.x, gw.z - w.z) > 1e-3) {
            targetYaw = Math.atan2(gw.x - w.x, gw.z - w.z);
          }
        } else {
          targetYaw = e.side === "player" ? Math.PI : 0;
        }
        if (targetYaw !== null) {
          const cur = view.root.rotation.y;
          let delta = targetYaw - cur;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          view.root.rotation.y = cur + delta * Math.min(1, dt * 10);
        }
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.views.delete(id);
        this.beginDeath(view);
      }
    }
  }

  /** Advance the spark pool and mirror live particles into the mesh. */
  private syncSparks(dt: number): void {
    this.sparks.update(dt, SPARK_GRAVITY);
    const mesh = this.sparkMesh;
    let i = 0;
    for (const p of this.sparks.particles) {
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

  render(dt: number): void {
    // The river drifts sideways forever.
    if (this.waterTex) {
      this.waterTime += dt;
      this.waterTex.offset.x = this.waterTime * 0.04;
    }

    // Crowd cheering: spectators hop while the cheer lasts.
    if (this.cheer > 0) {
      this.cheer = Math.max(0, this.cheer - dt);
      this.crowdParts.forEach((m, i) => {
        const base = m.userData.baseY as number;
        m.position.y =
          this.cheer > 0
            ? base + Math.abs(Math.sin(this.waterTime * 11 + i * 1.3)) * 0.16
            : base;
      });
    }

    // Ambient bird flyovers keep the sky alive.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 9 + ((this.waterTime * 7) % 8);
      const dir = this.waterTime % 2 < 1 ? 1 : -1;
      const z = -12 + ((this.waterTime * 13) % 22);
      const bird = new THREE.Group();
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.04, 0.16),
          new THREE.MeshBasicMaterial({ color: 0xf4f6fa }),
        );
        wing.position.x = s * 0.26;
        bird.add(wing);
      }
      const startX = -dir * 22;
      this.addEffect(bird, 6, (frac) => {
        const t = 1 - frac;
        bird.position.set(startX + dir * t * 44, 7.5 + Math.sin(t * 9) * 0.4, z);
        bird.children.forEach((w, wi) => {
          w.rotation.z = (wi === 0 ? 1 : -1) * Math.sin(t * 40) * 0.7;
        });
      });
    }

    // Camera shake: trauma² jitter around the fixed viewpoint.
    if (this.shakeCtl.active) {
      this.shakeTime += dt;
      const s = this.shakeCtl.intensity * 0.7;
      this.camera.position.set(
        Math.sin(this.shakeTime * 53) * s,
        CAM_HOME.y + Math.sin(this.shakeTime * 61) * s * 0.6,
        cameraZForView() + Math.cos(this.shakeTime * 47) * s,
      );
      this.shakeCtl.update(dt, 1.8);
      if (!this.shakeCtl.active) {
        this.camera.position.set(0, CAM_HOME.y, cameraZForView());
      }
    }

    // Advance and draw the hit-spark pool through one InstancedMesh.
    this.syncSparks(dt);

    this.effects = this.effects.filter((f) => {
      if (f.delay > 0) {
        f.delay -= dt;
        if (f.delay > 0) return true;
        f.obj.visible = true;
      }
      f.ttl -= dt;
      if (f.ttl <= 0) {
        this.scene.remove(f.obj);
        disposeDeep(f.obj);
        return false;
      }
      f.update(f.ttl / f.ttl0);
      return true;
    });

    this.dying = this.dying.filter((d) => {
      d.t += dt;
      const f = Math.min(1, d.t / d.duration);
      if (f >= 1) {
        this.scene.remove(d.view.root);
        disposeDeep(d.view.root);
        return false;
      }
      const ease = f * f;
      d.view.root.rotation.z = d.topple * ease;
      d.view.root.position.y = d.view.isTroop ? -0.3 * ease : -1.6 * ease;
      for (const mat of d.fadeMats) mat.opacity = 1 - f;
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }

  /** Remove every entity mesh (used on battle restart). */
  reset(): void {
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
}
