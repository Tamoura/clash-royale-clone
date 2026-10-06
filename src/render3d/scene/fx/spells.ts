/**
 * Spell set pieces, built from pooled particles, decals and the freeze dome
 * (no meshes or materials are made per cast). Every area effect is drawn
 * at the radius the sim actually used: card radii come from getCard(), and
 * the few sim literals (Electro Wizard's landing zap, the Mega Knight slam)
 * are mirrored here and checked against battle.ts by fx.test.ts.
 */
import type { AbilityId } from "../../../game/abilities";
import { RALLY_SECONDS, SALVO_RADIUS } from "../../../game/abilities";
import type { Side } from "../../../game/arena";
import { getCard, type CardId } from "../../../game/cards";
import { MODE_GROUND, MODE_SEGMENT, clearSpec, makeRng, seedFrom, type ParticleSpec } from "../../particles";
import { toWorld } from "../common";
import { CELL, SMOKE_CELLS } from "./atlas";
import type { VfxPool } from "./pool";
import * as THREE from "three";

/** battle.ts deployCard: the Electro Wizard lands with a zap of this radius. */
export const EWIZ_ZAP_RADIUS = 2.5;
/** battle.ts deployCard: the Mega Knight's landing slam radius. */
export const MEGA_SLAM_RADIUS = 3;
/** Seconds the fireball takes to fall before it bursts. */
export const FIREBALL_FALL = 0.32;
/** Seconds an arrow volley flies. */
export const ARROW_FLIGHT = 0.55;
/** Seconds a Mega Knight drop takes to land (matches the spawn hop). */
export const SLAM_LAND = 0.26;

/** What else the sim did on the tick a spell event was raised. */
export interface SpellContext {
  /** A King's Salvo shot (smaller blast than a Fireball card). */
  salvo?: boolean;
  /** The Electro Wizard's landing zap. */
  ewiz?: boolean;
}

/** The radius (tiles) the sim applied for this spell event. */
export function spellRadius(cardId: CardId, ctx: SpellContext = {}): number {
  if (cardId === "fireball" && ctx.salvo) return SALVO_RADIUS;
  if (cardId === "zap" && ctx.ewiz) return EWIZ_ZAP_RADIUS;
  if (cardId === "mega-knight") return MEGA_SLAM_RADIUS;
  const card = getCard(cardId);
  return card.kind === "spell" && card.radius > 0 ? card.radius : 1.5;
}

const S = clearSpec({} as ParticleSpec);
const TMP = new THREE.Color();

function color(s: ParticleSpec, c0: number, h0: number, a0: number, c1: number, h1: number, a1: number): void {
  TMP.setHex(c0);
  s.r0 = TMP.r * h0;
  s.g0 = TMP.g * h0;
  s.b0 = TMP.b * h0;
  s.a0 = a0;
  TMP.setHex(c1);
  s.r1 = TMP.r * h1;
  s.g1 = TMP.g * h1;
  s.b1 = TMP.b * h1;
  s.a1 = a1;
}

/** Fireball: a comet falls, then a hot flash, shockwave, billows, embers and a scorch. */
export function fireball(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  const k = r / 2.5; // a Salvo shot is a smaller blast
  const sx = w.x + 1.5 * k;
  const sy = 8;
  const sz = w.z - 4 * k;
  const vx = (w.x - sx) / FIREBALL_FALL;
  const vy = (0.35 - sy) / FIREBALL_FALL;
  const vz = (w.z - sz) / FIREBALL_FALL;
  // The comet: hot flare, white core and a velocity-stretched tail (HDR x3).
  const comet = (cell: number, size: number, c: number, h: number, stretch: number, push: number): void => {
    const s = clearSpec(S);
    s.x = sx;
    s.y = sy;
    s.z = sz;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.life = FIREBALL_FALL;
    s.size0 = size;
    s.size1 = size * 0.9;
    s.rot = v.rand() * 6;
    s.spin = 8;
    color(s, c, h, 1, c, h, 1);
    s.cell = cell;
    s.stretch = stretch;
    s.push = push;
    v.spawn("add", s);
  };
  comet(CELL.STREAK, 0.9 * k + 0.3, 0xff8a2a, 2.4, 0.09, 0.5);
  comet(CELL.FLARE, 1.5 * k + 0.4, 0xffa040, 3, 0, 1);
  comet(CELL.SOFT, 0.75 * k + 0.25, 0xfff1c4, 3.5, 0, 1.4);
  // Ember trail shed along the flight path.
  const n = Math.max(4, Math.round(16 * v.scale()));
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const s = clearSpec(S);
    s.x = sx + (w.x - sx) * f;
    s.y = sy + (0.35 - sy) * f;
    s.z = sz + (w.z - sz) * f;
    s.vx = (v.rand() - 0.5) * 1.5;
    s.vy = 0.6 + v.rand() * 1.2;
    s.vz = (v.rand() - 0.5) * 1.5;
    s.drag = 2;
    s.delay = f * FIREBALL_FALL;
    s.life = 0.3 + v.rand() * 0.25;
    s.size0 = 0.32 * k + 0.08;
    s.size1 = 0.05;
    color(s, 0xffc061, 3, 1, 0xff3d00, 1.2, 0);
    s.cell = i % 3 === 0 ? CELL.FLAME : CELL.EMBER;
    s.rot = v.rand() * 6;
    v.spawn("add", s);
  }
  // Impact.
  const d = FIREBALL_FALL;
  v.emitWorld("flash", w.x, 0, w.z, { delay: d, radius: k });
  v.emitWorld("shockwave", w.x, 0, w.z, { delay: d, radius: r });
  v.emitWorld("fire-core", w.x, 0, w.z, { delay: d, radius: k });
  v.emitWorld("fire-billow", w.x, 0, w.z, { delay: d, radius: Math.max(0.6, k) });
  v.emitWorld("debris", w.x, 0, w.z, { delay: d, radius: Math.max(0.5, k * 0.8), color: 0x6b5a48, count: 6 });
  v.emitWorld("embers", w.x, 0, w.z, { delay: d, radius: Math.max(0.6, k) });
  v.decal("scorch", x, y, r * 0.9, { delay: d, life: 7 });
  v.shake(k >= 0.9 ? 0.45 : 0.22, d);
}

/** One jagged lightning path from the sky to (gx, gz), plus forks. */
function bolt(
  v: VfxPool,
  rnd: () => number,
  gx: number,
  gz: number,
  width: number,
  delay: number,
): void {
  const SEG = 9;
  const top = 7.5;
  let px = gx + (rnd() - 0.5) * 1.6;
  let pz = gz - 1.2 + (rnd() - 0.5) * 1.6;
  let py = top;
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, wMul: number, life: number): void => {
    // Core, halo and a dark under-stroke (keeps the bolt legible on pale sand).
    for (let layer = 0; layer < 3; layer++) {
      const s = clearSpec(S);
      s.x = (ax + bx) / 2;
      s.y = (ay + by) / 2;
      s.z = (az + bz) / 2;
      s.vx = bx - ax;
      s.vy = by - ay;
      s.vz = bz - az;
      s.mode = MODE_SEGMENT;
      s.life = life;
      s.delay = delay;
      s.cell = layer === 1 ? CELL.SOFT : CELL.BOLT;
      const sz = width * wMul * (layer === 0 ? 1 : layer === 1 ? 2.4 : 1.9);
      s.size0 = s.size1 = sz;
      if (layer === 2) {
        color(s, 0x0b1838, 1, 0.6, 0x0b1838, 1, 0);
        v.spawn("alpha", s);
        continue;
      }
      // A white-hot core in a saturated blue halo, so it reads on pale sand too.
      if (layer === 0) color(s, 0xf4fdff, 2, 1, 0xbfe9ff, 1.3, 0);
      else color(s, 0x2f8dff, 0.8, 0.35, 0x2f8dff, 0.6, 0);
      v.spawn("add", s);
    }
  };
  for (let i = 1; i <= SEG; i++) {
    const f = i / SEG;
    // Wander narrows toward the strike point so every bolt lands true.
    const wander = 0.75 * (1 - f * 0.85);
    const nx = i === SEG ? gx : px + (gx - px) / (SEG - i + 1) + (rnd() - 0.5) * wander * 2;
    const nz = i === SEG ? gz : pz + (gz - pz) / (SEG - i + 1) + (rnd() - 0.5) * wander * 2;
    const ny = top * (1 - f);
    seg(px, py, pz, nx, ny, nz, 1 - f * 0.25, 0.24);
    // Forks: short branches that die in the air.
    if (i > 1 && i < SEG - 1 && rnd() < 0.42) {
      let bx = nx;
      let by = ny;
      let bz = nz;
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let j = 0; j < 3; j++) {
        const fx = bx + dir * (0.35 + rnd() * 0.45);
        const fy = by - (0.45 + rnd() * 0.4);
        const fz = bz + (rnd() - 0.5) * 0.6;
        seg(bx, by, bz, fx, fy, fz, 0.55 - j * 0.12, 0.18);
        bx = fx;
        by = fy;
        bz = fz;
      }
    }
    px = nx;
    py = ny;
    pz = nz;
  }
  // A hot spot where it lands.
  const s = clearSpec(S);
  s.x = gx;
  s.y = 0.25;
  s.z = gz;
  s.life = 0.2;
  s.delay = delay;
  s.size0 = 0.9;
  s.size1 = 0.5;
  s.cell = CELL.FLARE;
  s.push = 1.5;
  color(s, 0xeefcff, 1.8, 0.8, 0x9fe7ff, 1, 0);
  v.spawn("add", s);
}

/**
 * Zap: two or three forked bolts (camera-facing ribbons at least 4 CSS px
 * wide, shaped by a seed from the cast point), an electric ground ring,
 * sparks and a two-frame screen flash (skipped under reduced motion).
 */
export function zap(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  const rnd = makeRng(seedFrom(x, y));
  // Core ribbon: the bolt cell's hot band is ~45% of the quad.
  const width = Math.max(0.28, 11 * v.worldPerPixel());
  const bolts = r >= 2 ? 3 : 2;
  for (let i = 0; i < bolts; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : r * (0.35 + rnd() * 0.3);
    bolt(v, rnd, w.x + Math.cos(a) * d, w.z + Math.sin(a) * d, width, i * 0.035);
  }
  // A re-strike flicker down the middle.
  bolt(v, rnd, w.x, w.z, width * 0.8, 0.11);
  v.emitWorld("zap-ring", w.x, 0, w.z, { radius: r });
  v.emitWorld("zap-sparks", w.x, 0, w.z, { radius: r / 2 });
  v.decal("crack", x, y, r * 0.55, { life: 3.5, alpha: 0.7 });
  v.flash(0.5, 2);
  v.shake(0.15);
}

/** Freeze: an ice dome over the radius, snowfall, frost mist and a frost decal. */
export function freeze(v: VfxPool, x: number, y: number, r: number, seconds: number): void {
  const w = toWorld(x, y);
  v.dome(x, y, r, seconds);
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: 0xbdf3ff });
  v.emitWorld("flash", w.x, 0, w.z, { radius: r / 3, color: 0xcff6ff });
  v.emitWorld("snow", w.x, 0, w.z, { radius: r });
  v.emitWorld("frost-mist", w.x, 0, w.z, { radius: r * 0.8 });
  // Glints popping on the shell.
  for (let i = 0; i < Math.round(10 * v.scale()); i++) {
    const a = v.rand() * Math.PI * 2;
    const el = v.rand() * 1.2;
    const s = clearSpec(S);
    s.x = w.x + Math.cos(a) * Math.cos(el) * r;
    s.y = Math.sin(el) * r * 0.62;
    s.z = w.z + Math.sin(a) * Math.cos(el) * r;
    s.delay = 0.3 + v.rand() * (seconds - 0.6);
    s.life = 0.35;
    s.size0 = 0.55;
    s.size1 = 0.1;
    s.spin = 3;
    s.cell = CELL.STAR;
    s.push = 1;
    color(s, 0xffffff, 2.6, 1, 0xbdf3ff, 1.5, 0);
    v.spawn("add", s);
  }
  v.decal("frost", x, y, r, { life: seconds + 1.5 });
}

/**
 * Arrows: a volley of glowing tracers lobbed from the caster's side of the
 * arena, raining over the radius with dust kicks where they land.
 */
export function arrows(v: VfxPool, x: number, y: number, r: number, side: Side): void {
  const w = toWorld(x, y);
  // World +z is the player's half; the volley flies in from the caster's side.
  const dir = side === "player" ? 1 : -1;
  const G = 80;
  const n = Math.max(8, Math.round(18 * v.scale()));
  for (let i = 0; i < n; i++) {
    const a = v.rand() * Math.PI * 2;
    const rr = Math.sqrt(v.rand()) * r * 0.92;
    const tx = w.x + Math.cos(a) * rr;
    const tz = w.z + Math.sin(a) * rr;
    const sx = tx + ((i % 5) - 2) * 0.55;
    const sz = tz + dir * (8.5 + (i % 4) * 0.8);
    const sy = 1.1;
    const T = ARROW_FLIGHT * (0.92 + v.rand() * 0.16);
    const delay = i * 0.022;
    for (let layer = 0; layer < 3; layer++) {
      const s = clearSpec(S);
      s.x = sx;
      s.y = sy;
      s.z = sz;
      s.vx = (tx - sx) / T;
      s.vz = (tz - sz) / T;
      s.vy = (0.05 - sy + 0.5 * G * T * T) / T;
      s.gravity = G;
      s.delay = delay;
      s.life = T;
      s.cell = CELL.STREAK;
      if (layer === 0) {
        s.size0 = s.size1 = 0.24;
        s.stretch = 0.3;
        color(s, 0xfff6dc, 3, 1, 0xffe9a8, 2.6, 1);
      } else if (layer === 1) {
        s.size0 = s.size1 = 0.7;
        s.stretch = 0.12;
        color(s, 0xffb84d, 1.6, 0.55, 0xffb84d, 1.3, 0.5);
      } else {
        // A dark shaft under the glow: the volley still reads on pale ground.
        s.size0 = s.size1 = 0.13;
        s.stretch = 0.3;
        s.push = 0.2;
        color(s, 0x3b2a1a, 1, 0.9, 0x3b2a1a, 1, 0.9);
        v.spawn("alpha", s);
        continue;
      }
      v.spawn("add", s);
    }
    v.emitWorld("dust-kick", tx, 0, tz, { delay: delay + T });
  }
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: 0xdce6ff, delay: ARROW_FLIGHT + 0.05 });
}

/** Heal: plus signs float up over a glowing heal glyph. */
export function heal(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  v.emitWorld("heal-plus", w.x, 0, w.z, { radius: r });
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: 0x6ee7a0 });
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.06;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 0.9;
  s.size0 = r * 1.6;
  s.size1 = r * 2.1;
  s.cell = CELL.SOFT;
  color(s, 0x6ee7a0, 1.3, 0.5, 0x6ee7a0, 1, 0);
  v.spawn("add", s);
  v.decal("heal", x, y, r, { color: 0x7dffb0, hdr: 1.4, life: 3, alpha: 0.85 });
}

/** Rage: a rune circle for the zone's life, pulsing rings and purple embers. */
export function rage(v: VfxPool, x: number, y: number, r: number, seconds: number): void {
  const w = toWorld(x, y);
  v.decal("rune", x, y, r, { color: 0xe07bff, hdr: 2, life: seconds, alpha: 1 });
  v.emitWorld("flash", w.x, 0, w.z, { radius: r / 3, color: 0xd36bff });
  const PULSE = 0.6;
  const pulses = Math.max(1, Math.floor(seconds / PULSE));
  for (let i = 0; i < pulses; i++) {
    const s = clearSpec(S);
    s.x = w.x;
    s.y = 0.07;
    s.z = w.z;
    s.mode = MODE_GROUND;
    s.delay = i * PULSE;
    s.life = PULSE;
    s.size0 = r * 1.7;
    s.size1 = r * 2.04;
    s.cell = CELL.RING;
    color(s, 0xff4db8, 2.2, 0.9, 0xd36bff, 1.2, 0);
    v.spawn("add", s);
    v.emitWorld("rage-ember", w.x, 0, w.z, { radius: r, delay: i * PULSE, count: 6 });
  }
}

/** Tornado: a spinning ground vortex with debris spiralling into the eye. */
export function tornado(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  const s = clearSpec(S);
  s.x = w.x;
  s.y = 0.07;
  s.z = w.z;
  s.mode = MODE_GROUND;
  s.life = 1.2;
  s.size0 = r * 2;
  s.size1 = r * 1.2;
  s.spin = -7;
  s.cell = CELL.SWIRL;
  color(s, 0xe4ebf5, 1.4, 0.9, 0xb7c0cc, 1, 0);
  v.spawn("add", s);
  const ARMS = 3;
  const per = Math.max(8, Math.round(22 * v.scale()));
  for (let arm = 0; arm < ARMS; arm++) {
    for (let j = 0; j < per; j++) {
      const f = j / per;
      const ang = (arm / ARMS) * Math.PI * 2 - f * 7; // the spiral turns as it climbs
      const rad = r * (1 - f * 0.75);
      const p = clearSpec(S);
      p.x = w.x + Math.cos(ang) * rad;
      p.z = w.z + Math.sin(ang) * rad;
      p.y = 0.2 + f * 1.8;
      // Swirl tangentially (clockwise from above) and drift inward and up.
      const sp = 3 + f * 2;
      p.vx = Math.sin(ang) * sp - Math.cos(ang) * 1.2;
      p.vz = -Math.cos(ang) * sp - Math.sin(ang) * 1.2;
      p.vy = 1.4;
      p.drag = 1.2;
      p.delay = f * 0.8;
      p.life = 0.45;
      p.rot = v.rand() * 6;
      p.spin = -5;
      if (j % 2 === 0) {
        p.cell = SMOKE_CELLS[j % 3];
        p.size0 = 0.45;
        p.size1 = 0.85;
        p.push = 0.4;
        color(p, 0xc7cfda, 1, 0.75, 0x9aa3ad, 1, 0);
        v.spawn("alpha", p);
      } else {
        p.cell = CELL.STREAK;
        p.size0 = p.size1 = 0.12;
        p.stretch = 0.5;
        color(p, 0xffffff, 1.8, 0.9, 0xcfd6e0, 1, 0);
        v.spawn("add", p);
      }
    }
  }
  v.emitWorld("tornado-dust", w.x, 0, w.z, { radius: r });
}

/** Skeleton Barrel: the barrel bursts in splinters, bones and smoke. */
export function skeletonBarrel(v: VfxPool, x: number, y: number, r: number): void {
  const w = toWorld(x, y);
  v.emitWorld("debris", w.x, 0, w.z, { color: 0x8a5a30, radius: 0.8 });
  v.emitWorld("boneShards", w.x, 0, w.z);
  v.emitWorld("smoke", w.x, 0, w.z, { color: 0xb59772, radius: 1.2 });
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: 0xc9954a });
}

/** Mega Knight sky-slam: shockwave, debris and a crater, timed to his landing. */
export function megaSlam(v: VfxPool, x: number, y: number): void {
  const w = toWorld(x, y);
  const r = MEGA_SLAM_RADIUS;
  const d = SLAM_LAND;
  v.emitWorld("shockwave", w.x, 0, w.z, { radius: r, color: 0xd8c39a, delay: d });
  v.emitWorld("debris", w.x, 0, w.z, { radius: 1.1, delay: d });
  v.emitWorld("deployPuff", w.x, 0, w.z, { radius: 2.2, color: 0xcdbd9c, delay: d });
  v.emitWorld("flash", w.x, 0, w.z, { radius: 0.8, color: 0xffe7b0, delay: d });
  v.decal("crater", x, y, 1.5, { delay: d, life: 7 });
  v.shake(0.85, d);
}

/** Generic cast for anything without its own recipe: a flash plus a ring. */
export function fallback(v: VfxPool, x: number, y: number, r: number, tint = 0xffd36b): void {
  const w = toWorld(x, y);
  v.emitWorld("flash", w.x, 0, w.z, { radius: Math.max(0.6, r / 2.5), color: tint });
  v.emitWorld("ring", w.x, 0, w.z, { radius: r, color: tint });
}

/** Run the recipe for a 'spell' event. */
export function castSpell(v: VfxPool, cardId: CardId, x: number, y: number, side: Side, ctx: SpellContext = {}): void {
  const r = spellRadius(cardId, ctx);
  const card = getCard(cardId);
  switch (cardId) {
    case "fireball":
      return fireball(v, x, y, r);
    case "zap":
      return zap(v, x, y, r);
    case "freeze":
      return freeze(v, x, y, r, card.kind === "spell" && card.stunSeconds > 0 ? card.stunSeconds : 4);
    case "arrows":
      return arrows(v, x, y, r, side);
    case "heal":
      return heal(v, x, y, r);
    case "rage":
      return rage(v, x, y, r, card.kind === "spell" && card.rageSeconds > 0 ? card.rageSeconds : 6);
    case "tornado":
      return tornado(v, x, y, r);
    case "skeleton-barrel":
      return skeletonBarrel(v, x, y, r);
    case "mega-knight":
      return; // the slam is timed from his sky-drop spawn (spawnFlourish)
    default:
      return fallback(v, x, y, r);
  }
}

/** King's abilities reuse the spell recipes, centred on the king. */
export function castAbility(v: VfxPool, ability: AbilityId, x: number, y: number): void {
  const w = toWorld(x, y);
  if (ability === "rally") rage(v, x, y, 4, RALLY_SECONDS);
  else if (ability === "restore") heal(v, x, y, 3.5);
  else {
    // Salvo: the launch; each shot lands as its own fireball event.
    v.emitWorld("muzzle", w.x, 3.2, w.z, { radius: 2.2 });
    v.emitWorld("smoke", w.x, 3, w.z, { radius: 1.4 });
  }
}
