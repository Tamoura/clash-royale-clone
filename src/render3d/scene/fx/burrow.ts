/**
 * The Digger's tunnel (render-only). While a troop is burrowed
 * (Entity.burrowTimer > 0) its body stays hidden and a dirt mound ploughs
 * from its own King tower, where the sim starts the tunnel, to the spot it
 * was played on, leaving a dark furrow of turned earth and flicking clods.
 * The mound is placed from the burrow timer itself every frame, so it
 * arrives on the tick the sim surfaces the unit; the 'emerge' event then
 * bursts the ground open (diggerEmerge).
 */
import * as THREE from "three";
import { towerSpots, type Side } from "../../../game/arena";
import type { BattleState, Entity } from "../../../game/battle";
import { SIM_DT, clampAlpha } from "../../anim/interp";
import { toon } from "../../characters3d";
import { MODE_GROUND, clearSpec, type ParticleSpec } from "../../particles";
import { teamColor } from "../../teamColors";
import type { Battle3D } from "../../scene3d";
import { arabic, disposeDeep, toWorld, viewSide } from "../common";
import { CELL, SMOKE_CELLS } from "./atlas";
import type { VfxPool } from "./pool";

/** Turned earth: loam on grass arenas, sand in the Golden Age bazaar. */
export const DIRT = arabic ? 0xc8a874 : 0x8a6a44;
const DIRT_DARK = arabic ? 0x9a7f52 : 0x5a4330;
/** Seconds between furrow marks (render time). */
export const FURROW_EVERY = 0.05;

/** Where a side's tunnel starts: its King tower (alive or not, the sim uses the spot). */
export function burrowStart(state: BattleState, side: Side): { x: number; y: number } {
  const king = state.entities.find((e) => e.side === side && e.kind === "king-tower") ?? towerSpots(side).find((t) => t.kind === "king")!;
  return { x: king.x, y: king.y };
}

/**
 * How far along its tunnel a burrowed unit is drawn: 0 at the play, 1 the
 * moment it surfaces. `alpha` is the frame's fraction of a sim tick.
 */
export function burrowProgress(burrowTimer: number, burrowTotal: number, alpha: number): number {
  if (burrowTotal <= 0) return 1;
  const shown = burrowTimer - clampAlpha(alpha) * SIM_DT;
  return Math.min(1, Math.max(0, 1 - shown / burrowTotal));
}

interface Mound {
  root: THREE.Group;
  hump: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  sx: number;
  sy: number;
  markAt: number;
  wobble: number;
}

interface BurrowState {
  live: Map<number, Mound>;
  free: Mound[];
  seen: Set<number>;
  clock: number;
}

const STATES = new WeakMap<Battle3D, BurrowState>();

function burrowState(b: Battle3D): BurrowState {
  let s = STATES.get(b);
  if (!s) {
    s = { live: new Map(), free: [], seen: new Set(), clock: 0 };
    STATES.set(b, s);
  }
  return s;
}

let HUMP_GEO: THREE.SphereGeometry | null = null;
let CLOD_GEO: THREE.SphereGeometry | null = null;
let RING_GEO: THREE.RingGeometry | null = null;

/** A dirt hump with a few clods on a team-coloured ring (whose Digger is coming). */
function buildMound(): Mound {
  HUMP_GEO ??= new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  CLOD_GEO ??= new THREE.SphereGeometry(0.14, 8, 6);
  RING_GEO ??= new THREE.RingGeometry(0.62, 0.78, 32);
  for (const g of [HUMP_GEO, CLOD_GEO, RING_GEO]) g.userData.shared = true;
  const root = new THREE.Group();
  root.name = "burrow-mound";
  const hump = new THREE.Group();
  const dirt = toon(DIRT);
  const dark = toon(DIRT_DARK);
  const body = new THREE.Mesh(HUMP_GEO, dirt);
  body.scale.set(1, 0.7, 1.35); // long along the tunnel
  hump.add(body);
  for (const [x, y, z, s] of [[0.32, 0.18, 0.4, 1], [-0.3, 0.14, 0.2, 0.8], [0.1, 0.32, -0.3, 0.9], [-0.18, 0.08, -0.62, 0.7]] as const) {
    const clod = new THREE.Mesh(CLOD_GEO, s > 0.85 ? dark : dirt);
    clod.position.set(x, y, z);
    clod.scale.setScalar(s);
    hump.add(clod);
  }
  root.add(hump);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
  ringMat.toneMapped = false;
  const ring = new THREE.Mesh(RING_GEO, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.renderOrder = 3;
  root.add(ring);
  return { root, hump, ringMat, sx: 0, sy: 0, markAt: -Infinity, wobble: 0 };
}

const S = clearSpec({} as ParticleSpec);
const TMP = new THREE.Color();

function tint(s: ParticleSpec, c: number, a0: number, a1: number): void {
  TMP.setHex(c);
  s.r0 = s.r1 = TMP.r;
  s.g0 = s.g1 = TMP.g;
  s.b0 = s.b1 = TMP.b;
  s.a0 = a0;
  s.a1 = a1;
}

/** The furrow: a dark smudge of turned earth plus a clod flicked out behind. */
function furrow(v: VfxPool, wx: number, wz: number, hx: number, hz: number): void {
  const s = clearSpec(S);
  s.x = wx;
  s.y = 0.035;
  s.z = wz;
  s.mode = MODE_GROUND;
  s.life = 2.2;
  s.size0 = 0.85;
  s.size1 = 1.05;
  s.rot = v.rand() * 6;
  s.cell = SMOKE_CELLS[Math.floor(v.rand() * SMOKE_CELLS.length)];
  tint(s, DIRT_DARK, 0.8, 0);
  v.spawn("alpha", s);
  const c = clearSpec(S);
  c.x = wx + (v.rand() - 0.5) * 0.5;
  c.y = 0.25;
  c.z = wz + (v.rand() - 0.5) * 0.5;
  c.vx = -hx * 1.4 + (v.rand() - 0.5) * 2;
  c.vy = 2 + v.rand() * 1.6;
  c.vz = -hz * 1.4 + (v.rand() - 0.5) * 2;
  c.gravity = 14;
  c.life = 0.45;
  c.size0 = 0.18 + v.rand() * 0.1;
  c.size1 = 0.14;
  c.spin = (v.rand() - 0.5) * 16;
  c.cell = CELL.CHIP;
  tint(c, v.rand() < 0.5 ? DIRT : DIRT_DARK, 1, 0.4);
  v.spawn("alpha", c);
}

function moundColor(side: Side): number {
  return teamColor(side === viewSide ? "player" : "enemy");
}

/**
 * Mirror every burrowed troop as a travelling mound. Call once per frame
 * after the state was ticked. A finished match (state.result) stops the
 * sim, so a mound still on its way would freeze mid-field: it draws none.
 */
export function syncBurrows(b: Battle3D, state: BattleState, dt: number, alpha: number): void {
  const st = burrowState(b);
  st.clock += dt;
  st.seen.clear();
  const v = b.fx as VfxPool;
  for (const e of state.entities) {
    if (state.result || e.kind !== "troop" || e.burrowTimer <= 0) continue;
    st.seen.add(e.id);
    let m = st.live.get(e.id);
    if (!m) {
      m = st.free.pop() ?? buildMound();
      const from = burrowStart(state, e.side);
      m.sx = from.x;
      m.sy = from.y;
      m.markAt = -Infinity;
      m.ringMat.color.setHex(moundColor(e.side));
      b.scene.add(m.root);
      st.live.set(e.id, m);
      // Mark where it will pop up for the whole dig.
      v.decal("ring", e.x, e.y, 0.9, { color: moundColor(e.side), hdr: 1.4, life: e.burrowTimer + 0.25, alpha: 0.7, grow: 0.3 });
    }
    poseMound(m, e, burrowProgress(e.burrowTimer, e.burrowTotal, alpha), dt, st.clock, v);
  }
  for (const [id, m] of st.live) {
    if (st.seen.has(id)) continue;
    b.scene.remove(m.root);
    st.live.delete(id);
    st.free.push(m);
  }
}

function poseMound(m: Mound, e: Entity, p: number, dt: number, now: number, v: VfxPool): void {
  const a = toWorld(m.sx, m.sy);
  const t = toWorld(e.x, e.y);
  const hx = t.x - a.x;
  const hz = t.z - a.z;
  const len = Math.hypot(hx, hz) || 1;
  const wx = a.x + hx * p;
  const wz = a.z + hz * p;
  m.root.position.set(wx, 0, wz);
  m.root.rotation.y = Math.atan2(hx, hz);
  // The hump heaves as it ploughs: a quick shiver plus a slow swell.
  m.wobble += dt;
  const heave = 1 + Math.sin(m.wobble * 22) * 0.08 + Math.sin(m.wobble * 5) * 0.05;
  m.hump.scale.set(1 / Math.sqrt(heave), heave, 1);
  m.hump.position.y = -0.04 + Math.abs(Math.sin(m.wobble * 11)) * 0.04;
  if (now - m.markAt >= FURROW_EVERY) {
    m.markAt = now;
    furrow(v, wx, wz, hx / len, hz / len);
  }
}

/** How many tunnels are drawn right now (tests, dev tools). */
export function burrowsInFlight(b: Battle3D): number {
  return burrowState(b).live.size;
}

/** Drop every mound (battle restart / teardown). */
export function resetBurrows(b: Battle3D): void {
  const st = burrowState(b);
  for (const m of [...st.live.values(), ...st.free]) {
    b.scene.remove(m.root);
    disposeDeep(m.root);
  }
  st.live.clear();
  st.free.length = 0;
}

/**
 * The Digger breaks the surface: dirt clods and a dust ring burst out of a
 * fresh hole, with a small camera bump.
 */
export function diggerEmerge(v: VfxPool, x: number, y: number): void {
  const w = toWorld(x, y);
  // The fountain twice over: loam clods, then darker ones a beat later.
  v.emitWorld("dirt-burst", w.x, 0, w.z, { radius: 1.1, color: DIRT });
  v.emitWorld("dirt-burst", w.x, 0, w.z, { radius: 0.9, color: DIRT_DARK, delay: 0.06, count: 10 });
  v.emitWorld("deployPuff", w.x, 0, w.z, { radius: 1.6, color: arabic ? 0xe2cfa4 : 0xb59a78 });
  v.emitWorld("ring", w.x, 0, w.z, { radius: 1.2, color: 0xfff1c4 });
  // The hole it climbed out of: a dark ground patch that lingers, plus a crater.
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.04;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 3.5;
  s.size0 = 1.1;
  s.size1 = 1.5;
  s.cell = CELL.SOFT;
  tint(s, DIRT_DARK, 0.85, 0);
  v.spawn("alpha", s);
  v.decal("crater", x, y, 0.8, { life: 4 });
  v.shake(0.22);
}
