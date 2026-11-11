/**
 * The FX library the scene modules call: hit sparks, puffs, contact rings,
 * crowns, death scatter, deploy feedback and telegraphs, emotes, the sim
 * projectile meshes, and fxOnEvent, which turns battle events into these
 * effects and the spell recipes in spells.ts.
 *
 * Everything draws through the VfxPool that initFx() hangs on `b.fx`: after
 * init, none of these paths creates a geometry, a material or a canvas
 * (projectile meshes reuse cached geometry/materials and pooled objects).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Side } from "../../../game/arena";
import type { BattleEvent, BattleState, Entity } from "../../../game/battle";
import { getCard, type CardId } from "../../../game/cards";
import { deathStyle } from "../../deathfx";
import { impactStyle } from "../../impactfx";
import { MODE_GROUND, MODE_SEGMENT, clearSpec, type ParticleSpec } from "../../particles";
import { FLETCH_CREAM, projectileStyle, type ProjectileStyle } from "../../projectiles";
import { towerHitLabel, type DamageLabel } from "../../popups";
import type { Battle3D } from "../../scene3d";
import { LOOK_AT, PREV_POS, arabic, disposeDeep, toWorld, viewSide, type EntityView } from "../common";
import { addShake } from "../camera";
import { CELL } from "./atlas";
import { VfxPool } from "./pool";
import { castAbility, castSpell, fxTeamColor, megaSlam as slamRecipe, spellRadius, type SpellContext } from "./spells";
import { cometImpact } from "./comet";
import { diggerEmerge } from "./burrow";

/** The pool behind b.fx (initFx always installs one). */
function V(b: Battle3D): VfxPool {
  return b.fx as VfxPool;
}

/** A spell event held until the frame's events are all in (see flushCasts). */
interface PendingCast {
  cardId: CardId;
  x: number;
  y: number;
  side: Side;
  ctx: SpellContext;
}

interface FxState {
  pending: PendingCast[];
  /** The last Electro Wizard drop this frame: its landing zap is smaller. */
  ewiz: { x: number; y: number; side: Side } | null;
  /** Pooled projectile objects by style key. */
  freeProj: Map<string, THREE.Object3D[]>;
}

const STATE = new WeakMap<Battle3D, FxState>();

function fxState(b: Battle3D): FxState {
  let s = STATE.get(b);
  if (!s) {
    s = { pending: [], ewiz: null, freeProj: new Map() };
    STATE.set(b, s);
  }
  return s;
}

/**
 * Build the effects engine and install it as `b.fx`. Called once from the
 * Battle3D constructor, after the camera exists.
 */
export function initFx(b: Battle3D): VfxPool {
  const v = new VfxPool(
    {
      scene: b.scene,
      get camera() {
        return b.camera;
      },
      container: b.container,
      shake: (a) => addShake(b, a),
      // The post pass may expose a flash uniform; feature-detect it.
      setFlash: (a) => (b as Battle3D & { setFlash?: (a: number) => void }).setFlash?.(a),
    },
    { arabic },
  );
  v.beforeUpdate = () => flushCasts(b);
  b.fx = v;
  return v;
}

/**
 * Spells raised this frame play once every event of the frame has been
 * seen, so a King's Salvo (whose 'ability' event follows its fireballs)
 * draws its smaller blasts at the sim's radius.
 */
function flushCasts(b: Battle3D): void {
  const st = fxState(b);
  const v = V(b);
  for (const c of st.pending) castSpell(v, c.cardId, c.x, c.y, c.side, c.ctx);
  st.pending.length = 0;
  st.ewiz = null;
}

const S = clearSpec({} as ParticleSpec);
const TMP = new THREE.Color();

/** Outlined puff of smoke/dust in `color`; `size` 0.5 is a footstep-ish puff, 1+ a burst (capped). */
export function puff(b: Battle3D, ax: number, ay: number, color: number, size = 0.5, lift = 0): void {
  V(b).emit("smoke", ax, ay, { z: lift, color, radius: Math.min(1.25, Math.max(0.35, size * 1.1)) });
}

/** Fast, low contact ring for melee readability without obscuring units. */
export function contactRing(b: Battle3D, ax: number, ay: number, radius: number, color: number): void {
  if (radius <= 0) return;
  V(b).emit("contact", ax, ay, { radius, color });
}

/** Whether `color` is a dull material (stone, dust) rather than something hot. */
function dull(color: number): boolean {
  TMP.setHex(color).getHSL(HSL);
  return HSL.s < 0.35 || HSL.l < 0.3;
}

/**
 * Throw a burst of glowing sparks at an arena point. A dull colour (masonry,
 * dust) throws ramp-shaded chips instead: stone never glows (bloom contract).
 */
export function emitSparks(
  b: Battle3D,
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
  const v = V(b);
  const w = toWorld(ax, ay);
  const n = Math.max(1, Math.round(count * v.scale()));
  if (dull(color)) {
    v.emitWorld("chips", w.x, height, w.z, { color, count: Math.max(2, Math.round(count * 0.7)), radius: Math.max(0.5, size * 5) });
    return;
  }
  TMP.setHex(color);
  for (let i = 0; i < n; i++) {
    const s = clearSpec(S);
    const th = v.rand() * Math.PI * 2;
    const ph = v.rand() * spread;
    const sp = speed * (0.7 + v.rand() * 0.5);
    s.x = w.x;
    s.y = height;
    s.z = w.z;
    s.vx = Math.sin(ph) * Math.cos(th) * sp;
    s.vz = Math.sin(ph) * Math.sin(th) * sp;
    s.vy = Math.cos(ph) * sp;
    s.gravity = 7;
    s.drag = 0.6;
    s.life = life * (0.75 + v.rand() * 0.4);
    s.size0 = size * 2.4;
    s.size1 = size * 0.8;
    s.r0 = TMP.r * 1.8;
    s.g0 = TMP.g * 1.8;
    s.b0 = TMP.b * 1.8;
    s.r1 = TMP.r;
    s.g1 = TMP.g;
    s.b1 = TMP.b;
    s.a0 = 1;
    s.a1 = 0;
    s.cell = i % 3 === 0 ? CELL.STREAK : CELL.EMBER;
    s.stretch = i % 3 === 0 ? 0.6 : 0;
    v.spawn("add", s);
  }
}

/** Muzzle flash at fire time; the shot itself is sim-driven. */
export function projectile(b: Battle3D, ev: Extract<BattleEvent, { type: "attack" }>): void {
  const style = projectileStyle(ev.cardId, ev.kind);
  if (!style.muzzleFlash) return;
  V(b).emit("muzzle", ev.x, ev.y, { z: ev.kind === "troop" ? 0.9 : 1.6, color: style.impactColor });
}

// --- sim projectiles: cached geometry/materials, pooled objects -----------

const GEO = new Map<string, THREE.BufferGeometry>();
const MAT = new Map<string, THREE.Material>();

function sharedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    GEO.set(key, g);
  }
  return g;
}

function sharedMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = MAT.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    MAT.set(key, m);
  }
  return m;
}

function styleKey(s: ProjectileStyle): string {
  return `${s.form}|${s.color}|${s.size}|${s.glow ? 1 : 0}|${s.trail}|${s.fletch ?? 0}`;
}

const HSL = { h: 0, s: 0, l: 0 };

/** A copy of `g` (non-indexed) with every vertex coloured `hex` times `k`. */
function paint(g: THREE.BufferGeometry, hex: number, k = 1, m?: THREE.Matrix4): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();
  if (m) out.applyMatrix4(m);
  out.deleteAttribute("uv");
  const n = out.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  TMP.setHex(hex);
  for (let i = 0; i < n; i++) {
    col[i * 3] = TMP.r * k;
    col[i * 3 + 1] = TMP.g * k;
    col[i * 3 + 2] = TMP.b * k;
  }
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S3 = new THREE.Vector3();
const P3 = new THREE.Vector3();

function xform(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return M4.compose(P3.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)).clone();
}

function merged(key: string, parts: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  return sharedGeo(key, () => {
    const list = parts();
    const g = mergeGeometries(list, false) ?? list[0];
    for (const p of list) if (p !== g) p.dispose();
    return g;
  });
}

/** Unlit vertex-coloured material; `hot` keeps HDR colours (cores) and adds light. */
function vcMat(key: string, hot: boolean, additive = false): THREE.Material {
  return sharedMat(`vc|${key}`, () => {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    if (hot) m.toneMapped = false;
    if (additive) {
      m.transparent = true;
      m.depthWrite = false;
      m.blending = THREE.AdditiveBlending;
    }
    return m;
  });
}

/** The core colour of a hot shot: its own hue, lifted above the bloom threshold. */
function coreColor(hex: number, out: THREE.Color): THREE.Color {
  out.setHex(hex).getHSL(HSL);
  out.setHSL(HSL.h, Math.min(1, HSL.s), 0.72);
  return out.multiplyScalar(2.3);
}

/** A fireball's petals and core are drawn this much larger than the style's orb size. */
export const FIREBALL_SCALE = 1.4;

/** Three-tone toon flame petals (red-orange shell, orange body) round a core, pointing back. */
function fireballGeometry(size: number): THREE.BufferGeometry {
  return merged(`fireball-petals|${size}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const ox = Math.cos(a) * size * 0.42;
      const oy = Math.sin(a) * size * 0.42;
      // Each petal tilts outward from the flight axis (-z is behind the shot).
      const tilt = 0.42;
      parts.push(paint(new THREE.SphereGeometry(size * 0.62, 10, 8), 0xe2471b, 1, xform(ox, oy, -size * 0.75, Math.sin(a) * tilt, -Math.cos(a) * tilt, 0, 0.72, 0.72, 1.9)));
      parts.push(paint(new THREE.SphereGeometry(size * 0.48, 10, 8), 0xff9a2e, 1, xform(ox * 0.8, oy * 0.8, -size * 0.45, Math.sin(a) * tilt, -Math.cos(a) * tilt, 0, 0.72, 0.72, 1.6)));
    }
    return parts;
  });
}

/** A fletched arrow, one draw: shaft, steel head and three feathers. */
function arrowGeometry(shaft: number, fletch: number, length = 0.78): THREE.BufferGeometry {
  return merged(`arrow|${shaft}|${fletch}|${length}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(paint(new THREE.CylinderGeometry(0.04, 0.04, length, 6), shaft, 1, xform(0, 0, 0, Math.PI / 2)));
    // A four-sided steel head (an octahedron stretched forward).
    parts.push(paint(new THREE.OctahedronGeometry(0.11), 0x3d4650, 1, xform(0, 0, length / 2 + 0.06, 0, 0, 0, 0.9, 0.9, 1.7)));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(paint(new THREE.BoxGeometry(0.02, 0.15, 0.26), fletch, 1, xform(Math.sin(a) * 0.075, Math.cos(a) * 0.075, -length / 2 + 0.12, 0, 0, -a)));
    }
    return parts;
  });
}

/** A musket ball with a hot streak behind it (additive, fading to nothing at the tail). */
function tracerGeometry(color: number): THREE.BufferGeometry {
  return sharedGeo(`tracer|${color}`, () => {
    const len = 0.95;
    const g = new THREE.CylinderGeometry(0.06, 0.012, len, 6, 1).toNonIndexed();
    g.applyMatrix4(xform(0, 0, -len / 2, Math.PI / 2));
    g.deleteAttribute("uv");
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const c = coreColor(color, new THREE.Color());
    for (let i = 0; i < pos.count; i++) {
      const f = Math.min(1, Math.max(0, 1 + pos.getZ(i) / len)); // 1 at the head, 0 at the tail
      col[i * 3] = c.r * f * f;
      col[i * 3 + 1] = c.g * f * f;
      col[i * 3 + 2] = c.b * f * f;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const ball = paint(new THREE.SphereGeometry(0.075, 8, 6), 0xffffff, 0, undefined);
    const bc = ball.getAttribute("color");
    for (let i = 0; i < bc.count; i++) bc.setXYZ(i, c.r, c.g, c.b);
    const out = mergeGeometries([g, ball], false)!;
    g.dispose();
    ball.dispose();
    return out;
  });
}

/** An electric core with spikes (additive). */
function boltGeometry(size: number, color: number): THREE.BufferGeometry {
  return merged(`bolt|${size}|${color}`, () => {
    const c = coreColor(color, new THREE.Color());
    const hex = new THREE.Color(c.r / 2.3, c.g / 2.3, c.b / 2.3).getHex();
    return [
      paint(new THREE.SphereGeometry(size * 0.55, 10, 8), hex, 2.3),
      paint(new THREE.OctahedronGeometry(size * 1.15), color, 0.9, xform(0, 0, 0, 0.5, 0.3, 0.7, 1, 0.45, 1)),
      paint(new THREE.OctahedronGeometry(size * 1.0), color, 0.9, xform(0, 0, 0, 1.2, 0.9, 0.1, 0.45, 1, 1)),
    ];
  });
}

/** A pale ice crystal pointing along its flight. */
function shardGeometry(size: number, color: number): THREE.BufferGeometry {
  return merged(`shard|${size}|${color}`, () => [
    paint(new THREE.OctahedronGeometry(size), color, 1, xform(0, 0, 0, 0, 0, Math.PI / 4, 0.55, 0.55, 1.9)),
    paint(new THREE.OctahedronGeometry(size * 0.55), 0xeefaff, 1, xform(0, 0, size * 0.25, 0, 0, Math.PI / 4, 0.5, 0.5, 1.6)),
  ]);
}

/** A small arrow-shaped missile oriented along its flight path (one draw). */
export function makeArrow(color: number, length = 0.7, fletch = FLETCH_CREAM): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(arrowGeometry(color, fletch, length + 0.08), vcMat("plain", false)));
  return g;
}

function buildProjectile(style: ProjectileStyle): THREE.Object3D {
  switch (style.form) {
    case "arrow": {
      const g = makeArrow(style.color, 0.7, style.fletch ?? FLETCH_CREAM);
      if (style.glow) {
        // A magic or flaming arrow carries a small hot tip.
        const tip = new THREE.Mesh(
          sharedGeo("arrow-glow", () => new THREE.SphereGeometry(0.09, 8, 6)),
          sharedMat(`core|${style.fletch}`, () => new THREE.MeshBasicMaterial({ color: coreColor(style.fletch ?? style.color, new THREE.Color()), toneMapped: false })),
        );
        tip.position.z = 0.48;
        g.add(tip);
      }
      return g;
    }
    case "fireball": {
      const g = new THREE.Group();
      // Shots read at phone size: the fireball flies a size up from the old orb.
      const size = style.size * FIREBALL_SCALE;
      const core = new THREE.Mesh(
        sharedGeo(`core|${size}`, () => new THREE.SphereGeometry(size * 0.5, 12, 9)),
        sharedMat(`fire-core|${style.color}`, () => new THREE.MeshBasicMaterial({ color: coreColor(0xffc04a, new THREE.Color()), toneMapped: false })),
      );
      core.name = "core";
      const petals = new THREE.Mesh(fireballGeometry(size), vcMat("plain", false));
      petals.name = "petals";
      g.add(petals, core);
      g.userData.spin = petals;
      return g;
    }
    case "tracer":
      return new THREE.Mesh(tracerGeometry(style.color), vcMat("hot-add", true, true));
    case "bolt": {
      const m = new THREE.Mesh(boltGeometry(style.size, style.color), vcMat("hot-add", true, true));
      m.userData.spin = m;
      return m;
    }
    case "shard": {
      const m = new THREE.Mesh(shardGeometry(style.size, style.color), vcMat("plain", false));
      m.userData.spin = m;
      return m;
    }
    default: {
      // A magic orb keeps its hue (never a white blob): under the bloom threshold, lit only by its trail.
      const mat = sharedMat(`basic|${style.color}`, () => new THREE.MeshBasicMaterial({ color: style.color }));
      return new THREE.Mesh(sharedGeo(`orb|${style.size}`, () => new THREE.SphereGeometry(style.size, 10, 8)), mat);
    }
  }
}

/** What a shot sheds this frame at world point (x, y, z), moving from `prev`. */
function shedTrail(v: VfxPool, style: ProjectileStyle, x: number, y: number, z: number, prev: THREE.Vector3): void {
  // Trails shed per frame: the quality's particle scale thins them like every preset.
  const roll = v.rand() / Math.max(0.05, v.scale());
  switch (style.trail) {
    case "embers": {
      // The smoke ribbon, with a lick of flame and the odd ember.
      if (roll < 0.75) v.emitWorld("smoke-puff", x, y, z, { color: 0x6e5a4c, radius: style.size / 0.22 });
      if (roll < 0.35) v.emitWorld("flame-lick", x, y, z, { radius: style.size / 0.3, count: 1 });
      if (roll > 0.7 && roll < 1) {
        const s = clearSpec(S);
        s.x = x;
        s.y = y;
        s.z = z;
        s.vx = (v.rand() - 0.5) * 0.8;
        s.vy = 0.3 + v.rand() * 0.6;
        s.vz = (v.rand() - 0.5) * 0.8;
        s.drag = 2;
        s.life = 0.22 + v.rand() * 0.15;
        s.size0 = 0.16;
        s.size1 = 0.03;
        TMP.setHex(0xff9a3c);
        s.r0 = TMP.r * 1.8;
        s.g0 = TMP.g * 1.8;
        s.b0 = TMP.b * 1.8;
        s.r1 = TMP.r;
        s.g1 = TMP.g;
        s.b1 = TMP.b;
        s.cell = CELL.EMBER;
        v.spawn("add", s);
      }
      return;
    }
    case "smoke":
      if (roll < 0.6) v.emitWorld("smoke-puff", x, y, z, { color: 0x6f6a64 });
      return;
    case "frost":
      if (roll < 0.6) v.emitWorld("smoke-puff", x, y, z, { color: 0xbfe6fb, radius: 0.8 });
      return;
    case "sparkle": {
      if (roll > 0.55) return;
      const s = clearSpec(S);
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = (v.rand() - 0.5) * 0.6;
      s.vy = 0.2 + v.rand() * 0.4;
      s.vz = (v.rand() - 0.5) * 0.6;
      s.drag = 2;
      s.life = 0.3;
      s.size0 = 0.2;
      s.size1 = 0.05;
      s.spin = 6;
      TMP.setHex(style.impactColor);
      s.r0 = s.r1 = TMP.r * 1.3;
      s.g0 = s.g1 = TMP.g * 1.3;
      s.b0 = s.b1 = TMP.b * 1.3;
      s.a1 = 0;
      s.cell = CELL.STAR;
      v.spawn("add", s);
      return;
    }
    case "electric": {
      if (prev.lengthSq() === 0) return;
      // A jagged crackle from where the bolt was to where it is.
      const s = clearSpec(S);
      s.x = (x + prev.x) / 2 + (v.rand() - 0.5) * 0.18;
      s.y = (y + prev.y) / 2 + (v.rand() - 0.5) * 0.18;
      s.z = (z + prev.z) / 2 + (v.rand() - 0.5) * 0.18;
      s.vx = (x - prev.x) * 1.6;
      s.vy = (y - prev.y) * 1.6 + (v.rand() - 0.5) * 0.3;
      s.vz = (z - prev.z) * 1.6;
      s.mode = MODE_SEGMENT;
      s.life = 0.14;
      s.size0 = s.size1 = 0.16;
      s.cell = CELL.BOLT;
      TMP.setHex(style.color);
      s.r0 = TMP.r * 1.8;
      s.g0 = TMP.g * 1.8;
      s.b0 = TMP.b * 1.8;
      s.r1 = TMP.r;
      s.g1 = TMP.g;
      s.b1 = TMP.b;
      s.a1 = 0;
      v.spawn("add", s);
      return;
    }
    default:
      return;
  }
}

/** A projectile's view for `style` (tools and tests; the battle pools them in syncProjectiles). */
export function buildProjectileView(style: ProjectileStyle): THREE.Object3D {
  return buildProjectile(style);
}

/** What a shot of `style` sheds at world (x, y, z), having come from `prev` (tools and tests). */
export function shedProjectileTrail(b: Battle3D, style: ProjectileStyle, x: number, y: number, z: number, prev: THREE.Vector3): void {
  shedTrail(V(b), style, x, y, z, prev);
}

const TRAIL_PREV = new THREE.Vector3();

/** Mirror the sim's in-flight projectiles as meshes. */
export function syncProjectiles(b: Battle3D, state: BattleState): void {
  const st = fxState(b);
  const v = V(b);
  const seen = b.projSeen;
  seen.clear();
  for (const p of state.projectiles) {
    seen.add(p.id);
    const style = projectileStyle(p.cardId, p.sourceKind, p.towerTroop ?? null);
    let view = b.projViews.get(p.id);
    if (!view) {
      const key = styleKey(style);
      view = st.freeProj.get(key)?.pop() ?? buildProjectile(style);
      view.userData.projKey = key;
      view.userData.impactColor = style.impactColor;
      view.position.set(0, 0, 0);
      b.scene.add(view);
      b.projViews.set(p.id, view);
    }
    // Arc by flight progress: launch point -> current target leg.
    const target = b.byId.get(p.targetId);
    const traveled = Math.hypot(p.x - p.sx, p.y - p.sy);
    const remaining = target ? Math.hypot(target.x - p.x, target.y - p.y) : 0;
    const frac = traveled / Math.max(0.001, traveled + remaining);
    const w = toWorld(p.x, p.y);
    const y0 = p.sourceKind === "troop" ? 0.9 : 1.6;
    // Scratch vectors: no allocation in the render loop.
    PREV_POS.copy(view.position);
    TRAIL_PREV.copy(view.position);
    view.position.set(w.x, y0 + (0.7 - y0) * frac + Math.sin(frac * Math.PI) * style.arc, w.z);
    if (PREV_POS.lengthSq() > 0) {
      LOOK_AT.copy(view.position).multiplyScalar(2).sub(PREV_POS);
      view.lookAt(LOOK_AT);
    }
    // Petals and crystals spin about the flight axis.
    const spin = view.userData.spin as THREE.Object3D | undefined;
    if (spin) spin.rotation.z = v.now * 11;
    shedTrail(v, style, view.position.x, view.position.y, view.position.z, TRAIL_PREV);
  }
  for (const [id, view] of b.projViews) {
    if (!seen.has(id)) {
      // Stars where the shot landed (or fizzled) for a crisp impact.
      v.emitWorld("hitSpark", view.position.x, view.position.y, view.position.z, {
        color: (view.userData.impactColor as number | undefined) ?? 0xfff1c4,
        count: 4,
      });
      b.scene.remove(view);
      const key = view.userData.projKey as string;
      let free = st.freeProj.get(key);
      if (!free) st.freeProj.set(key, (free = []));
      free.push(view);
      b.projViews.delete(id);
    }
  }
}

/** Team colour for telegraphs: viewer-relative, in the player's palette. */
function teamColor(side: Side): number {
  return fxTeamColor(side);
}

/**
 * Deploy telegraph, for both sides: a team-coloured ring at the drop point
 * and a falling shadow that shrinks onto it in 0.35 s.
 */
export function deployTelegraph(b: Battle3D, side: Side, cardId: CardId, ax: number, ay: number): void {
  const v = V(b);
  const card = getCard(cardId);
  const r = card.kind === "building" ? 1.35 : card.kind === "troop" && card.count > 3 ? 1.5 : 1.05;
  v.decal("ring", ax, ay, r, { color: teamColor(side), r0: r * 1.45, grow: 0.35, life: 1.3, alpha: 0.95 });
  // A tunneller arrives from below, not from the sky: no falling shadow.
  if (card.kind === "troop" && card.deployAnywhere) return;
  v.decal("shadow", ax, ay, r * 0.45, { r0: r * 1.5, grow: 0.35, life: 0.35, alpha: 0.55 });
}

/**
 * A rock creature crumbling: big stone chunks, grit and a rolling dust
 * ring (the body's own baked parts shatter on top, see deathfx).
 */
export function crumble(b: Battle3D, ax: number, ay: number, color: number, scale: number): void {
  const v = V(b);
  v.emit("debris", ax, ay, { color, radius: 0.9 * scale, count: Math.round(12 * scale) });
  v.emit("chips", ax, ay, { color, radius: 0.8 * scale, z: 0.6 * scale });
  v.emit("deployPuff", ax, ay, { radius: 1.4 * scale });
  if (scale >= 1) v.shake(0.3);
}

/** Bone shards scattering from a fallen skeleton. */
export function boneScatter(b: Battle3D, ax: number, ay: number, color: number): void {
  V(b).emit("boneShards", ax, ay, { color });
}

/** Electric burst for a broken war machine. */
export function sparkBurst(b: Battle3D, ax: number, ay: number, color: number): void {
  V(b).emit("spark-burst", ax, ay, { color });
}

/** The balloon envelope tears and vents as it falls. */
export function deflate(b: Battle3D, ax: number, ay: number, color: number): void {
  V(b).emit("deflate", ax, ay, { color });
}

/** Whether world (x, z) is on a tower's footprint (its hits print larger). */
function onTower(b: Battle3D, x: number, z: number): boolean {
  for (const e of b.byId.values()) {
    if (e.kind !== "princess-tower" && e.kind !== "king-tower") continue;
    const w = toWorld(e.x, e.y);
    if (Math.abs(w.x - x) < 1.3 && Math.abs(w.z - z) < 1.3) return true;
  }
  return false;
}

/** Floating combat text that rises and fades (pooled glyph quads). */
export function damagePopup(b: Battle3D, x: number, y: number, z: number, label: DamageLabel): void {
  const v = V(b);
  if (onTower(b, x, z)) label = towerHitLabel(label);
  v.popup(x, y, z, label.text, label.scale, label.color, label.crit === true);
  if (label.crit) v.emitWorld("crit", x, y * 0.6, z, { radius: 0.8 });
}

/** A golden crown rises, spins, and fades over a fallen tower. */
export function crownPop(b: Battle3D, ax: number, ay: number): void {
  const v = V(b);
  v.crown(ax, ay);
  v.emit("crit", ax, ay, { z: 1.2, color: 0xfbbf24, radius: 1.2 });
}

/** Dark necromantic disc that summoned skeletons rise through. */
export function summonPortal(b: Battle3D, ax: number, ay: number, accent = 0x76ff03): void {
  V(b).emit("portal", ax, ay, { color: accent });
}

/** Mega Knight sky-slam, timed to land as he hits the ground. */
export function megaSlam(b: Battle3D, ax: number, ay: number): void {
  slamRecipe(V(b), ax, ay);
}

/** Roaring red shockwave + steam when a sleeping king wakes up. */
export function kingWakeBurst(b: Battle3D, side: Side): void {
  const v = V(b);
  const z = side === "player" ? 14.5 : -14.5; // king tower rows
  v.emitWorld("shockwave", 0, 0.1, z, { radius: 4.5, color: 0xff5252 });
  v.emitWorld("steam", 0, 0, z);
  v.shake(0.35);
}

/** Drop feedback at your deploy point: a soft glow in your team colour on the ground (never white). */
export function deployFlash(b: Battle3D, ax: number, ay: number): void {
  const v = V(b);
  const w = toWorld(ax, ay);
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.05;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 0.3;
  s.size0 = 1.6;
  s.size1 = 3.6;
  s.cell = CELL.SOFT;
  TMP.setHex(fxTeamColor(viewSide));
  s.r0 = s.r1 = TMP.r;
  s.g0 = s.g1 = TMP.g;
  s.b0 = s.b1 = TMP.b;
  s.a0 = 0.45;
  s.a1 = 0;
  v.spawn("alpha", s);
}

/** An emote bubble floating above a side's king tower. */
export function emote(b: Battle3D, side: Side, emoji: string): void {
  V(b).emote(side, emoji, side === "player" ? 13.5 : -13.5); // just above each king tower
}

/**
 * Entry flourish for a freshly built view: a dark portal for risers, a
 * sky-slam shockwave for the Mega Knight, dust for everyone else.
 */
export function spawnFlourish(b: Battle3D, view: EntityView, e: Entity): void {
  // A tunneller is still underground: its entrance is the emerge burst.
  if (e.burrowTimer > 0) return;
  if (view.spawnStyle === "rise") summonPortal(b, e.x, e.y, view.spawnColor);
  else if (view.spawnStyle === "slam") megaSlam(b, e.x, e.y);
  else if (view.isTroop) {
    // Floor dust rolls out, and the landing bursts in the team colour.
    const burst = view.spawnBurst ?? 0.45;
    const v = V(b);
    v.emit("deployPuff", e.x, e.y, { radius: Math.max(0.6, burst * 1.6) });
    v.emit("deployBurst", e.x, e.y, { color: teamColor(e.side), radius: Math.min(0.9, Math.max(0.55, burst)) });
  }
}

/** Age every timed effect; expired ones leave the scene and free the GPU. */
export function updateEffects(b: Battle3D, dt: number): void {
  if (b.effects.length === 0) return;
  b.effects = b.effects.filter((f) => {
    if (f.delay > 0) {
      f.delay -= dt;
      if (f.delay > 0) return true;
      f.obj.visible = true;
    }
    f.ttl -= dt;
    if (f.ttl <= 0) {
      b.scene.remove(f.obj);
      disposeDeep(f.obj);
      return false;
    }
    f.update(f.ttl / f.ttl0);
    return true;
  });
}

/** Art bible 8: a hit throws 4-6 stars, more for heavier blows. */
export function hitStars(particles: number): number {
  return particles >= 14 ? 6 : particles >= 8 ? 5 : 4;
}

/** Spell, ability, attack, deploy and troop-death effects for a battle event. */
export function fxOnEvent(b: Battle3D, ev: BattleEvent): void {
  const v = V(b);
  const st = fxState(b);
  switch (ev.type) {
    case "deploy":
      deployTelegraph(b, ev.side, ev.cardId, ev.x, ev.y);
      if (ev.cardId === "electro-wizard") st.ewiz = { x: ev.x, y: ev.y, side: ev.side };
      break;
    case "spell": {
      const ctx: SpellContext = {};
      if (ev.cardId === "zap" && st.ewiz && st.ewiz.side === ev.side && st.ewiz.x === ev.x && st.ewiz.y === ev.y) {
        ctx.ewiz = true;
      }
      st.pending.push({ cardId: ev.cardId, x: ev.x, y: ev.y, side: ev.side, ctx });
      break;
    }
    case "ability":
      if (ev.ability === "salvo") {
        for (const c of st.pending) if (c.cardId === "fireball" && c.side === ev.side) c.ctx.salvo = true;
      }
      castAbility(v, ev.ability, ev.x, ev.y, ev.side);
      break;
    case "attack":
      if (ev.ranged) {
        projectile(b, ev);
      } else {
        // Melee landed: streak sparks fly off the struck target (camera kick
        // and hit-stop follow in viewsOnEvent). Ranged hits spark on landing.
        const s = impactStyle(ev.cardId);
        const w = toWorld(ev.targetX, ev.targetY);
        v.emitWorld("hitSpark", w.x, 0.8, w.z, { color: s.color, count: hitStars(s.particles) });
        contactRing(b, ev.targetX, ev.targetY, s.ringRadius, s.accent);
        if (s.kind === "crush") v.emitWorld("dust", w.x, 0, w.z, { radius: 1.0 });
      }
      break;
    case "emerge":
      diggerEmerge(v, ev.x, ev.y);
      break;
    case "spell-land":
      cometImpact(v, ev.x, ev.y, spellRadius(ev.cardId));
      b.hitStop.punch(0.06);
      break;
    case "death":
      if (ev.kind === "troop") {
        const style = deathStyle(ev.cardId);
        if (style.kind === "crumble") crumble(b, ev.x, ev.y, style.color, style.scale);
        else if (style.kind === "bones") boneScatter(b, ev.x, ev.y, style.color);
        else if (style.kind === "sparks") sparkBurst(b, ev.x, ev.y, style.color);
        else if (style.kind === "deflate") deflate(b, ev.x, ev.y, style.color);
        else puff(b, ev.x, ev.y, style.color, style.scale);
        if (style.kind !== "puff") emitSparks(b, ev.x, ev.y, 0.6, style.particles, 3.5, 1.5, style.color, 0.09 * style.scale, 0.5);
      }
      break;
    default:
      break;
  }
}
