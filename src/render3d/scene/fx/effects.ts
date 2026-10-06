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
import type { Side } from "../../../game/arena";
import type { BattleEvent, BattleState, Entity } from "../../../game/battle";
import { getCard, type CardId } from "../../../game/cards";
import { deathStyle } from "../../deathfx";
import { impactStyle } from "../../impactfx";
import { MODE_GROUND, clearSpec, type ParticleSpec } from "../../particles";
import { getPrefs } from "../../../ui/prefs";
import { projectileStyle, type ProjectileStyle } from "../../projectiles";
import type { DamageLabel } from "../../popups";
import type { Battle3D } from "../../scene3d";
import { LOOK_AT, PREV_POS, SIDE_COLOR, arabic, disposeDeep, toWorld, type EntityView } from "../common";
import { addShake } from "../camera";
import { CELL } from "./atlas";
import { VfxPool } from "./pool";
import { castAbility, castSpell, megaSlam as slamRecipe, type SpellContext } from "./spells";

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

/** Puff of smoke/dust in `color`; `size` 0.5 is a footstep-ish puff, 1+ a burst. */
export function puff(b: Battle3D, ax: number, ay: number, color: number, size = 0.5, lift = 0): void {
  V(b).emit("smoke", ax, ay, { z: lift, color, radius: Math.max(0.35, size * 1.1) });
}

/** Fast, low contact ring for melee readability without obscuring units. */
export function contactRing(b: Battle3D, ax: number, ay: number, radius: number, color: number): void {
  if (radius <= 0) return;
  V(b).emit("contact", ax, ay, { radius, color });
}

/** Throw a burst of glowing sparks at an arena point. */
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
    s.r0 = TMP.r * 2.4;
    s.g0 = TMP.g * 2.4;
    s.b0 = TMP.b * 2.4;
    s.r1 = TMP.r * 1.2;
    s.g1 = TMP.g * 1.2;
    s.b1 = TMP.b * 1.2;
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
  return `${s.form}|${s.color}|${s.size}|${s.glow ? 1 : 0}|${s.trail}`;
}

/** A small arrow-shaped missile oriented along its flight path. */
export function makeArrow(color: number, length = 0.7): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    sharedGeo(`shaft|${length}`, () => new THREE.CylinderGeometry(0.05, 0.05, length, 8)),
    sharedMat(`basic|${color}`, () => new THREE.MeshBasicMaterial({ color })),
  );
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(
    sharedGeo("tip", () => new THREE.ConeGeometry(0.11, 0.24, 8)),
    sharedMat("basic|tip", () => new THREE.MeshBasicMaterial({ color: 0x37474f })),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = length / 2;
  g.add(tip);
  return g;
}

function buildProjectile(style: ProjectileStyle): THREE.Object3D {
  let view: THREE.Object3D;
  if (style.form === "arrow") {
    view = makeArrow(style.color);
  } else {
    const mat = sharedMat(`${style.glow ? "glow" : "basic"}|${style.color}`, () => {
      const m = new THREE.MeshBasicMaterial({ color: style.color });
      if (style.glow) m.toneMapped = false;
      return m;
    });
    view = new THREE.Mesh(sharedGeo(`orb|${style.size}`, () => new THREE.SphereGeometry(style.size, 8, 6)), mat);
  }
  if (style.trail !== "none") {
    const trailLength = style.trail === "electric" ? 1.15 : style.trail === "embers" ? 0.8 : 0.62;
    const radius = style.form === "arrow" ? 0.045 : style.size * 0.72;
    const trail = new THREE.Mesh(
      sharedGeo(`trail|${radius}|${trailLength}`, () => new THREE.ConeGeometry(radius, trailLength, 8)),
      sharedMat(`trail|${style.color}|${style.trail}`, () =>
        new THREE.MeshBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: style.trail === "electric" ? 0.8 : 0.48,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    );
    trail.rotation.x = -Math.PI / 2;
    trail.position.z = -trailLength * 0.55;
    view.add(trail);
  }
  return view;
}

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
    view.position.set(w.x, y0 + (0.7 - y0) * frac + Math.sin(frac * Math.PI) * style.arc, w.z);
    if (PREV_POS.lengthSq() > 0) {
      LOOK_AT.copy(view.position).multiplyScalar(2).sub(PREV_POS);
      view.lookAt(LOOK_AT);
    }
    // Hot shots shed embers / crackle as they fly.
    if (style.trail === "embers" || style.trail === "electric") {
      const s = clearSpec(S);
      s.x = view.position.x;
      s.y = view.position.y;
      s.z = view.position.z;
      s.vx = (v.rand() - 0.5) * 0.8;
      s.vy = 0.3 + v.rand() * 0.6;
      s.vz = (v.rand() - 0.5) * 0.8;
      s.drag = 2;
      s.life = 0.22 + v.rand() * 0.15;
      const big = style.form === "orb" ? style.size : 0.12;
      s.size0 = big * 1.5;
      s.size1 = 0.03;
      TMP.setHex(style.trail === "embers" ? 0xff9a3c : style.color);
      s.r0 = TMP.r * 2.6;
      s.g0 = TMP.g * 2.6;
      s.b0 = TMP.b * 2.6;
      s.r1 = TMP.r;
      s.g1 = TMP.g;
      s.b1 = TMP.b;
      s.cell = CELL.EMBER;
      v.spawn("add", s);
    }
  }
  for (const [id, view] of b.projViews) {
    if (!seen.has(id)) {
      // Spark where the shot landed (or fizzled) for a crisp impact.
      v.emitWorld("hitSpark", view.position.x, view.position.y, view.position.z, {
        color: (view.userData.impactColor as number | undefined) ?? 0xfff1c4,
        count: 4,
        radius: 0.8,
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

/** Team colour for telegraphs (honours the colour-blind palette). */
function teamColor(side: Side): number {
  if (getPrefs().teamPalette === "cb") return side === "player" ? 0x2f80ff : 0xff8a00;
  return SIDE_COLOR[side];
}

/**
 * Deploy telegraph, for both sides: a team-coloured ring at the drop point
 * and a falling shadow that shrinks onto it in 0.35 s.
 */
export function deployTelegraph(b: Battle3D, side: Side, cardId: CardId, ax: number, ay: number): void {
  const v = V(b);
  const card = getCard(cardId);
  const r = card.kind === "building" ? 1.35 : card.kind === "troop" && card.count > 3 ? 1.5 : 1.05;
  v.decal("ring", ax, ay, r, { color: teamColor(side), hdr: 1.6, r0: r * 1.45, grow: 0.35, life: 1.3, alpha: 0.95 });
  v.decal("shadow", ax, ay, r * 0.45, { r0: r * 1.5, grow: 0.35, life: 0.35, alpha: 0.55 });
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

/** Floating combat text that rises and fades (pooled glyph quads). */
export function damagePopup(b: Battle3D, x: number, y: number, z: number, label: DamageLabel): void {
  const v = V(b);
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

/** Brief white flash at a deploy point (CR drop feedback). */
export function deployFlash(b: Battle3D, ax: number, ay: number): void {
  const v = V(b);
  const w = toWorld(ax, ay);
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.05;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 0.28;
  s.size0 = 1.8;
  s.size1 = 4.2;
  s.cell = CELL.SOFT;
  s.r0 = s.g0 = s.b0 = 1.3;
  s.r1 = s.g1 = s.b1 = 1;
  s.a0 = 0.75;
  s.a1 = 0;
  v.spawn("add", s);
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
  if (view.spawnStyle === "rise") summonPortal(b, e.x, e.y, view.spawnColor);
  else if (view.spawnStyle === "slam") megaSlam(b, e.x, e.y);
  else if (view.isTroop) {
    const burst = view.spawnBurst ?? 0.45;
    V(b).emit("deployPuff", e.x, e.y, { color: view.spawnColor ?? 0xd9cdb8, radius: Math.max(0.6, burst * 1.6) });
    contactRing(b, e.x, e.y, Math.min(0.85, burst), view.spawnColor ?? 0xffffff);
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
      castAbility(v, ev.ability, ev.x, ev.y);
      break;
    case "attack":
      if (ev.ranged) {
        projectile(b, ev);
      } else {
        // Melee landed: streak sparks fly off the struck target (camera kick
        // and hit-stop follow in viewsOnEvent). Ranged hits spark on landing.
        const s = impactStyle(ev.cardId);
        const w = toWorld(ev.targetX, ev.targetY);
        v.emitWorld("hitSpark", w.x, 0.8, w.z, { color: s.color, count: Math.max(2, Math.round(s.particles * 0.6)), radius: Math.max(0.7, s.size * 9) });
        contactRing(b, ev.targetX, ev.targetY, s.ringRadius, s.accent);
        if (s.kind === "crush") v.emitWorld("dust", w.x, 0, w.z, { radius: 1.3 });
      }
      break;
    case "death":
      if (ev.kind === "troop") {
        const style = deathStyle(ev.cardId);
        if (style.kind === "bones") boneScatter(b, ev.x, ev.y, style.color);
        else if (style.kind === "sparks") sparkBurst(b, ev.x, ev.y, style.color);
        else if (style.kind === "deflate") deflate(b, ev.x, ev.y, style.color);
        else puff(b, ev.x, ev.y, style.color, style.scale);
        emitSparks(b, ev.x, ev.y, 0.6, style.particles, 3.5, 1.5, style.color, 0.09 * style.scale, 0.5);
      }
      break;
    default:
      break;
  }
}
