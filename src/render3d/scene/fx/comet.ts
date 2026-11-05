/**
 * The Comet's fall (render-only). While a delayed spell waits in
 * BattleState.pendingSpells, a pulsing target ring marks where it will land
 * and the flaming rock streaks down from the sky. Both are placed from the
 * spell's own `ttl` every frame (blended by the frame's tick alpha), so the
 * rock touches the ground on the very tick the sim lands it, whatever the
 * frame rate, hit-stop or game speed. The 'spell-land' event then plays the
 * impact: a shockwave, fire, flying rock, embers, a crater and a scorch.
 *
 * One pooled view per comet in flight: built once, reused, never disposed
 * mid-battle (the battle reset drops them all).
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { BattleState, PendingSpell } from "../../../game/battle";
import { getCard, type CardId } from "../../../game/cards";
import { SIM_DT, clampAlpha } from "../../anim/interp";
import { buildCometRock } from "../../characters3d";
import { MODE_GROUND, clearSpec, type ParticleSpec } from "../../particles";
import { teamColor } from "../../teamColors";
import type { Battle3D } from "../../scene3d";
import { cameraZForView, disposeDeep, toWorld, viewSide } from "../common";
import { CELL, SMOKE_CELLS } from "./atlas";
import type { VfxPool } from "./pool";

/** World height the rock starts its fall from. */
export const COMET_SKY_HEIGHT = 10;
/**
 * How far beyond the target it starts, away from the camera (world z), and
 * sideways (world x, toward the caster's right). Falling away from the
 * camera keeps the flame tail across the screen instead of pointing at it.
 */
export const COMET_BACK = 3;
export const COMET_SIDE = 3.5;
/** Fall curve exponent: the rock accelerates into the ground. */
export const COMET_EASE = 1.6;

/** The fall's total length for a delayed spell (the card's landDelay). */
export function landDelayOf(cardId: CardId): number {
  const card = getCard(cardId);
  return card.kind === "spell" ? (card.landDelay ?? 0) : 0;
}

/**
 * How far through its fall a pending spell is drawn, 0 at the cast and 1 the
 * moment it lands. `alpha` (0..1) is the fraction of a sim tick elapsed
 * since the state was ticked: the frame shows the ttl that far ahead.
 */
export function cometProgress(ttl: number, total: number, alpha: number): number {
  if (total <= 0) return 1;
  const shown = ttl - clampAlpha(alpha) * SIM_DT;
  return Math.min(1, Math.max(0, 1 - shown / total));
}

/**
 * The rock's world position at fall progress `f`: from high in the sky,
 * beyond the target as the camera sees it (`camSign` is the sign of the
 * camera's world z: +1 for the host's view, -1 for an online guest's) and
 * off to its caster's right, down onto the target (world tx, tz), easing in.
 * At f = 1 it sits exactly on the target, at ground level. Writes `out`.
 */
export function cometPosition(
  tx: number,
  tz: number,
  side: Side,
  f: number,
  out: THREE.Vector3,
  camSign = 1,
): THREE.Vector3 {
  // World +z is the sim player's half; each side's right hand is its own +x / -x.
  const right = side === "player" ? 1 : -1;
  const k = 1 - Math.pow(Math.min(1, Math.max(0, f)), COMET_EASE);
  out.set(tx + right * COMET_SIDE * k, COMET_SKY_HEIGHT * k, tz - camSign * COMET_BACK * k);
  return out;
}

interface CometView {
  root: THREE.Group;
  sky: THREE.Group;
  rock: THREE.Group;
  tail: THREE.Group;
  ring: THREE.Mesh;
  closing: THREE.Mesh;
  fill: THREE.Mesh;
  shadow: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  closingMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  shadowMat: THREE.MeshBasicMaterial;
  /** Presentation time of the last ember puff. */
  emberAt: number;
  spin: number;
}

interface CometState {
  live: Map<PendingSpell, CometView>;
  free: CometView[];
  seen: Set<PendingSpell>;
  clock: number;
}

const STATES = new WeakMap<Battle3D, CometState>();

function cometState(b: Battle3D): CometState {
  let s = STATES.get(b);
  if (!s) {
    s = { live: new Map(), free: [], seen: new Set(), clock: 0 };
    STATES.set(b, s);
  }
  return s;
}

function basic(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.toneMapped = false;
  return m;
}

/** Ground quad lying flat (a ring, disc or shadow), `order` drawn over the arena. */
function flat(geo: THREE.BufferGeometry, mat: THREE.Material, y: number, order: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = order;
  return m;
}

let GEO: { ring: THREE.RingGeometry; thin: THREE.RingGeometry; disc: THREE.CircleGeometry; cone: THREE.ConeGeometry } | null = null;

function geos(): NonNullable<typeof GEO> {
  if (!GEO) {
    GEO = {
      ring: new THREE.RingGeometry(0.9, 1, 64),
      thin: new THREE.RingGeometry(0.95, 1, 64),
      disc: new THREE.CircleGeometry(1, 48),
      cone: new THREE.ConeGeometry(1, 1, 16, 1, true),
    };
    for (const g of Object.values(GEO)) g.userData.shared = true;
  }
  return GEO;
}

function buildView(): CometView {
  const G = geos();
  const root = new THREE.Group();
  root.name = "comet-fall";
  const ringMat = basic(0xffffff, 0.9);
  const closingMat = basic(0xffb347, 0.9, true);
  const fillMat = basic(0xff6a1f, 0.3);
  const shadowMat = basic(0x140806, 0.3);
  const shadow = flat(G.disc, shadowMat, 0.05, 3);
  const fill = flat(G.disc, fillMat, 0.06, 4);
  const ring = flat(G.ring, ringMat, 0.07, 5);
  const closing = flat(G.thin, closingMat, 0.08, 5);
  root.add(shadow, fill, ring, closing);

  const sky = new THREE.Group();
  const rock = buildCometRock(0.75);
  sky.add(rock);
  // The flame tail points back up the fall line (the group's +y).
  const tail = new THREE.Group();
  const flame = (color: number, r: number, h: number, opacity: number): void => {
    const cone = new THREE.Mesh(G.cone, basic(color, opacity, true));
    cone.scale.set(r, h, r);
    cone.position.y = h * 0.5 - 0.1;
    cone.rotation.x = Math.PI; // the wide mouth wraps the rock
    cone.renderOrder = 6;
    tail.add(cone);
  };
  flame(0xff4a12, 1.05, 4.2, 0.55);
  flame(0xff9a2a, 0.8, 3, 0.7);
  flame(0xffe7a0, 0.52, 1.7, 0.85);
  sky.add(tail);
  root.add(sky);
  return { root, sky, rock, tail, ring, closing, fill, shadow, ringMat, closingMat, fillMat, shadowMat, emberAt: -Infinity, spin: 0 };
}

const NO_SPELLS: readonly PendingSpell[] = Object.freeze([]);
const POS = new THREE.Vector3();
const NEXT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();
const S = clearSpec({} as ParticleSpec);
const TMP = new THREE.Color();

/** The caster's colour as the viewer sees it (yours blue, theirs red/orange). */
function casterColor(side: Side): number {
  return teamColor(side === viewSide ? "player" : "enemy");
}

/** Embers and smoke shed by the rock as it falls. */
function shed(v: VfxPool, at: THREE.Vector3, heading: THREE.Vector3): void {
  const n = Math.max(1, Math.round(3 * v.scale()));
  for (let i = 0; i < n; i++) {
    const s = clearSpec(S);
    s.x = at.x + (v.rand() - 0.5) * 0.5;
    s.y = at.y + (v.rand() - 0.5) * 0.5;
    s.z = at.z + (v.rand() - 0.5) * 0.5;
    s.vx = -heading.x * 2 + (v.rand() - 0.5) * 1.5;
    s.vy = -heading.y * 2 + v.rand() * 1.2;
    s.vz = -heading.z * 2 + (v.rand() - 0.5) * 1.5;
    s.drag = 2;
    s.life = 0.35 + v.rand() * 0.3;
    s.size0 = 0.32 + v.rand() * 0.2;
    s.size1 = 0.05;
    TMP.setHex(i % 2 ? 0xffc061 : 0xff6a1f);
    s.r0 = TMP.r * 3;
    s.g0 = TMP.g * 3;
    s.b0 = TMP.b * 3;
    s.r1 = TMP.r;
    s.g1 = TMP.g;
    s.b1 = TMP.b;
    s.cell = i % 2 ? CELL.EMBER : CELL.FLAME;
    s.rot = v.rand() * 6;
    v.spawn("add", s);
  }
  const s = clearSpec(S);
  s.x = at.x;
  s.y = at.y;
  s.z = at.z;
  s.vy = 0.4;
  s.drag = 1.5;
  s.life = 0.7;
  s.size0 = 0.6;
  s.size1 = 1.4;
  s.rot = v.rand() * 6;
  s.spin = 1;
  s.cell = SMOKE_CELLS[Math.floor(v.rand() * SMOKE_CELLS.length)];
  TMP.setHex(0x6a5a50);
  s.r0 = s.r1 = TMP.r;
  s.g0 = s.g1 = TMP.g;
  s.b0 = s.b1 = TMP.b;
  s.a0 = 0.55;
  s.a1 = 0;
  s.push = 0.4;
  v.spawn("alpha", s);
}

/** Place one comet view for fall progress `f` at arena (x, y), radius r. */
function poseView(view: CometView, p: PendingSpell, f: number, r: number, dt: number, now: number, v: VfxPool): void {
  const w = toWorld(p.x, p.y);
  view.root.position.set(w.x, 0, w.z);
  // Ground telegraph: the team ring pulses faster as the rock nears; a hot
  // ring closes in from outside onto its edge; the fill and shadow grow.
  const beat = 3 + 9 * f;
  view.spin += dt * beat;
  const pulse = 0.5 + 0.5 * Math.sin(view.spin * Math.PI);
  view.ring.scale.setScalar(r * (1 + 0.04 * pulse));
  view.ringMat.color.setHex(casterColor(p.side));
  view.ringMat.opacity = 0.55 + 0.4 * pulse;
  view.closing.scale.setScalar(r * (1 + 0.7 * (1 - f)));
  view.closingMat.opacity = 0.35 + 0.6 * f;
  view.fill.scale.setScalar(r * (0.2 + 0.8 * f));
  view.fillMat.opacity = 0.16 + 0.24 * f + 0.08 * pulse;
  view.shadow.scale.setScalar(r * (0.25 + 0.45 * f));
  view.shadowMat.opacity = 0.12 + 0.4 * f;

  // The rock, in root-local space (the root sits on the target).
  const cam = cameraZForView() >= 0 ? 1 : -1;
  cometPosition(0, 0, p.side, f, POS, cam);
  cometPosition(0, 0, p.side, Math.min(1, f + 0.02), NEXT, cam);
  view.sky.position.copy(POS);
  DIR.subVectors(POS, NEXT);
  if (DIR.lengthSq() < 1e-8) cometPosition(0, 0, p.side, 0, DIR, cam);
  DIR.normalize();
  view.tail.quaternion.setFromUnitVectors(UP, DIR);
  view.rock.rotation.x += dt * 5;
  view.rock.rotation.z += dt * 3;
  view.sky.scale.setScalar(0.75 + 0.25 * f);
  if (now - view.emberAt >= 0.04) {
    view.emberAt = now;
    POS.add(view.root.position);
    shed(v, POS, DIR.negate());
  }
}

/**
 * Mirror the state's pending delayed spells: create, pose and retire the
 * fall views. Call once per frame after the state was ticked. Once the
 * match has a result the sim stops ticking, so a rock still in the air
 * would hang there through the KO moment: a finished match draws none.
 */
export function syncComets(b: Battle3D, state: BattleState, dt: number, alpha: number): void {
  const st = cometState(b);
  st.clock += dt;
  const v = b.fx as VfxPool;
  st.seen.clear();
  for (const p of state.result ? NO_SPELLS : state.pendingSpells) {
    const total = landDelayOf(p.cardId);
    if (total <= 0) continue;
    st.seen.add(p);
    let view = st.live.get(p);
    if (!view) {
      view = st.free.pop() ?? buildView();
      view.spin = 0;
      view.emberAt = -Infinity;
      b.scene.add(view.root);
      st.live.set(p, view);
    }
    poseView(view, p, cometProgress(p.ttl, total, alpha), p.radius, dt, st.clock, v);
  }
  for (const [p, view] of st.live) {
    if (st.seen.has(p)) continue;
    b.scene.remove(view.root);
    st.live.delete(p);
    st.free.push(view);
  }
}

/** How many comets are drawn falling right now (tests, dev tools). */
export function cometsInFlight(b: Battle3D): number {
  return cometState(b).live.size;
}

/** Drop every comet view (battle restart / teardown). */
export function resetComets(b: Battle3D): void {
  const st = cometState(b);
  for (const view of [...st.live.values(), ...st.free]) {
    b.scene.remove(view.root);
    disposeDeep(view.root);
  }
  st.live.clear();
  st.free.length = 0;
}

/** The cast: a bright ring pops at the target so the drop point reads at once. */
export function cometCast(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: 0xffb347 });
}

/**
 * The landing: a white-hot flash and two shockwaves, a fire core and
 * billows, rock chunks and embers thrown wide, a crater under a scorch, and
 * a heavy camera kick with a two-frame flash.
 */
export function cometImpact(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  // Some of the blast sits up off the ground, so it still reads when the
  // target is a tower (whose body hides anything at its foot).
  v.emitWorld("flash", w.x, 0.8, w.z, { radius: 1, color: 0xffa860 });
  v.emitWorld("shockwave", w.x, 0, w.z, { radius: r * 1.35 });
  v.emitWorld("shockwave", w.x, 0, w.z, { radius: r * 2, color: 0xff7a2a, delay: 0.08 });
  v.emitWorld("fire-core", w.x, 0.9, w.z, { radius: 1.4 });
  v.emitWorld("fire-billow", w.x, 0.6, w.z, { radius: 1.3 });
  v.emitWorld("debris", w.x, 1.2, w.z, { radius: 1.4, color: 0x4a3b34, count: 16 });
  v.emitWorld("embers", w.x, 1.4, w.z, { radius: 1.5 });
  v.emitWorld("embers", w.x, 0.5, w.z, { radius: 1.1, delay: 0.12 });
  // A glowing ember bed in the crater for a moment.
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.06;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 1.4;
  s.size0 = r * 1.3;
  s.size1 = r * 1.0;
  s.cell = CELL.SOFT;
  TMP.setHex(0xff6a1f);
  s.r0 = TMP.r * 2.2;
  s.g0 = TMP.g * 2.2;
  s.b0 = TMP.b * 2.2;
  s.r1 = TMP.r;
  s.g1 = TMP.g * 0.5;
  s.b1 = TMP.b * 0.3;
  s.a0 = 0.8;
  s.a1 = 0;
  v.spawn("add", s);
  v.decal("crater", x, y, r * 0.65, { life: 8 });
  v.decal("scorch", x, y, r * 1.05, { life: 8 });
  v.shake(0.8);
  v.flash(0.2, 2);
}
