/**
 * VfxPool: the battle's effects engine behind the FxApi.
 *
 * - Two InstancedMesh pools of camera-facing quads share one procedural
 *   atlas: an additive pool (hot, HDR colours that feed the bloom) and an
 *   alpha pool (smoke, chips, bones). Motion is evaluated in the vertex
 *   shader from `uTime`; the CPU only writes a particle's record when it is
 *   born, into a ring buffer, and uploads just the written ranges.
 * - Ground decals (decals.ts), damage numbers (glyphs.ts) and freeze domes
 *   (iceDome.ts) run on the same clock.
 * - A few pooled set pieces (crowns, emote bubbles) are built here once.
 *
 * Everything GPU-side is created in the constructor; after that, emitting
 * never constructs a geometry, a material or a canvas.
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import { toon } from "../../characters3d";
import { Ring, makeRng, type ParticleSpec } from "../../particles";
import { particleScale } from "../../quality";
import { reducedMotion } from "../../../ui/prefs";
import { toWorld } from "../common";
import type { DecalKindName, FxApi } from "./api";
import { ATLAS_GRID, makeParticleAtlas } from "./atlas";
import { DecalLayer, type DecalOpts } from "./decals";
import { GlyphLayer } from "./glyphs";
import { IceDomes } from "./iceDome";
import { emitPreset, type EmitOpts, type PoolKind, type Spawner } from "./presets";

/** Pool capacities before the quality scale. */
export const ADD_CAP = 1024;
export const ALPHA_CAP = 512;

/** Whatever owns the scene the effects draw into (Battle3D, or a test stub). */
export interface VfxHost {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** The canvas container (its CSS width converts pixels to world units). */
  container: { clientWidth: number };
  /** Camera trauma. */
  shake?(amount: number): void;
  /** Full-screen additive flash, 0..1 (post pass; may be absent). */
  setFlash?(a: number): void;
}

const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aPhys;  // gravity, drag, birth, life
attribute vec4 aSize;  // size0, size1, rot, spin
attribute vec4 aCol0;
attribute vec4 aCol1;
attribute vec4 aMisc;  // cell, stretch, mode, push
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float age = uTime - aPhys.z;
  float life = aPhys.w;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vCol = vec4(0.0);
    return;
  }
  float t = age / life;
  float k = aPhys.y;
  float travel = k > 1e-4 ? (1.0 - exp(-k * age)) / k : age;
  vec3 wpos = aPos + aVel * travel;
  wpos.y -= 0.5 * aPhys.x * age * age;
  vec3 vel = aVel * exp(-k * age);
  vel.y -= aPhys.x * age;
  float ts = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(aSize.x, aSize.y, ts);
  float rot = aSize.z + aSize.w * age;
  vCol = mix(aCol0, aCol1, t);
  vCol.a *= min(1.0, t / 0.04);
  float cell = aMisc.x;
  vec2 cxy = vec2(mod(cell, ${ATLAS_GRID}.0), floor(cell / ${ATLAS_GRID}.0));
  vUv = (vec2(cxy.x, ${ATLAS_GRID - 1}.0 - cxy.y) + uv) / ${ATLAS_GRID}.0;
  vec2 c = position.xy;
  float mode = aMisc.z;
  vec4 mv;
  if (mode > 0.5 && mode < 1.5) {
    // Flat on the ground.
    float cr = cos(rot);
    float sr = sin(rot);
    vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * size;
    mv = viewMatrix * vec4(wpos + vec3(r.x, 0.0, r.y), 1.0);
  } else {
    vec2 axis = vec2(cos(rot), sin(rot));
    float len = size;
    float shift = 0.0;
    if (mode > 1.5) {
      // Static segment: aVel is the segment vector, aPos its midpoint.
      mv = viewMatrix * vec4(aPos, 1.0);
      vec2 sv = (viewMatrix * vec4(aVel, 0.0)).xy;
      float l = length(sv);
      axis = l > 1e-5 ? sv / l : vec2(1.0, 0.0);
      len = l + size * 0.5;
    } else {
      mv = viewMatrix * vec4(wpos, 1.0);
      if (aMisc.y > 0.0) {
        // Velocity streak: stretch along screen-space motion, head in front.
        vec2 sv = (viewMatrix * vec4(vel, 0.0)).xy;
        float l = length(sv);
        if (l > 1e-4) {
          axis = sv / l;
          len = size * (1.0 + aMisc.y * l);
          shift = -(len - size) * 0.5;
        }
      }
    }
    vec2 perp = vec2(-axis.y, axis.x);
    mv.xy += axis * (c.x * len + shift) + perp * (c.y * size);
    mv.z += aMisc.w * size;
  }
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * tex.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** One InstancedMesh of particles plus its ring of slots. */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  readonly ring: Ring;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly phys: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly col0: THREE.InstancedBufferAttribute;
  private readonly col1: THREE.InstancedBufferAttribute;
  private readonly misc: THREE.InstancedBufferAttribute;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly ranges: number[] = [];
  /** Pool time when the last live particle dies (the mesh hides after). */
  private liveUntil = -1;

  constructor(readonly capacity: number, material: THREE.ShaderMaterial, renderOrder: number) {
    this.ring = new Ring(capacity);
    const geo = new THREE.PlaneGeometry(1, 1);
    const attr = (size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.pos = attr(3);
    this.vel = attr(3);
    this.phys = attr(4);
    this.size = attr(4);
    this.col0 = attr(4);
    this.col1 = attr(4);
    this.misc = attr(4);
    // Every slot starts dead (life 0, born in the far past).
    for (let i = 0; i < capacity; i++) this.phys.array[i * 4 + 2] = -1e6;
    geo.setAttribute("aPos", this.pos);
    geo.setAttribute("aVel", this.vel);
    geo.setAttribute("aPhys", this.phys);
    geo.setAttribute("aSize", this.size);
    geo.setAttribute("aCol0", this.col0);
    geo.setAttribute("aCol1", this.col1);
    geo.setAttribute("aMisc", this.misc);
    this.attrs = [this.pos, this.vel, this.phys, this.size, this.col0, this.col1, this.misc];
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // positions live in the shader
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Live slots (the ring never holds more than its cap). */
  get count(): number {
    return this.ring.count;
  }

  /** Write one particle born at pool time `now` (+ its delay). */
  write(s: ParticleSpec, now: number): void {
    const i = this.ring.alloc();
    const birth = now + s.delay;
    const p3 = i * 3;
    const p4 = i * 4;
    const pos = this.pos.array as Float32Array;
    pos[p3] = s.x;
    pos[p3 + 1] = s.y;
    pos[p3 + 2] = s.z;
    const vel = this.vel.array as Float32Array;
    vel[p3] = s.vx;
    vel[p3 + 1] = s.vy;
    vel[p3 + 2] = s.vz;
    const phys = this.phys.array as Float32Array;
    phys[p4] = s.gravity;
    phys[p4 + 1] = s.drag;
    phys[p4 + 2] = birth;
    phys[p4 + 3] = Math.max(1e-3, s.life);
    const size = this.size.array as Float32Array;
    size[p4] = s.size0;
    size[p4 + 1] = s.size1;
    size[p4 + 2] = s.rot;
    size[p4 + 3] = s.spin;
    const c0 = this.col0.array as Float32Array;
    c0[p4] = s.r0;
    c0[p4 + 1] = s.g0;
    c0[p4 + 2] = s.b0;
    c0[p4 + 3] = s.a0;
    const c1 = this.col1.array as Float32Array;
    c1[p4] = s.r1;
    c1[p4 + 1] = s.g1;
    c1[p4 + 2] = s.b1;
    c1[p4 + 3] = s.a1;
    const misc = this.misc.array as Float32Array;
    misc[p4] = s.cell;
    misc[p4 + 1] = s.stretch;
    misc[p4 + 2] = s.mode;
    misc[p4 + 3] = s.push;
    this.liveUntil = Math.max(this.liveUntil, birth + s.life);
  }

  /** Upload what was written this frame and decide whether to draw. */
  flush(now: number): void {
    const r = this.ring.flush(this.ranges);
    if (r.length > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        for (let j = 0; j < r.length; j += 2) a.addUpdateRange(r[j] * a.itemSize, r[j + 1] * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this.mesh.count = this.ring.count;
    this.mesh.visible = now <= this.liveUntil && this.mesh.count > 0;
  }

  setScale(q: number): void {
    const before = this.ring.cap;
    this.ring.setCap(Math.round(this.capacity * q));
    if (this.ring.cap !== before) {
      // Slots past the new cap must not resurface later: kill them all.
      const phys = this.phys.array as Float32Array;
      for (let i = 0; i < this.capacity; i++) phys[i * 4 + 2] = -1e6;
      this.ring.reset();
      this.liveUntil = -1;
      this.phys.clearUpdateRanges();
      this.phys.needsUpdate = true;
    }
  }

  reset(): void {
    const phys = this.phys.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) phys[i * 4 + 2] = -1e6;
    this.phys.clearUpdateRanges();
    this.phys.needsUpdate = true;
    this.ring.reset();
    this.liveUntil = -1;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}

export function particleMaterial(map: THREE.Texture, uTime: { value: number }, additive: boolean): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uMap: { value: map } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Ground-mode quads face up; seen from either end of the arena (host
    // or flipped guest view) their winding differs, so draw both faces.
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.toneMapped = !additive; // hot colours stay hot
  mat.userData.shared = true;
  return mat;
}

const CROWN_POOL = 3;
const CROWN_LIFE = 1.2;
const EMOTE_LIFE = 2.4;
const SCHEDULE_CAP = 16;

interface Crown {
  group: THREE.Group;
  mat: THREE.MeshToonMaterial;
  t: number;
  x: number;
  z: number;
}

interface Bubble {
  sprite: THREE.Sprite;
  ctx: CanvasRenderingContext2D | null;
  tex: THREE.CanvasTexture;
  t: number;
}

interface Scheduled {
  at: number;
  kind: 0 | 1; // 0 shake, 1 flash
  value: number;
  frames: number;
}

/** Draw an emote bubble into its (reused) canvas. */
function paintBubble(ctx: CanvasRenderingContext2D, emoji: string): void {
  ctx.clearRect(0, 0, 128, 128);
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
}

export class VfxPool implements FxApi, Spawner {
  /** Pool clock (seconds of presented time); every shader reads it. */
  readonly uTime = { value: 0 };
  readonly add: ParticlePool;
  readonly alpha: ParticlePool;
  readonly decals: DecalLayer;
  readonly glyphs: GlyphLayer;
  readonly domes: IceDomes;
  readonly atlas: THREE.Texture;
  private readonly rng = makeRng(0x5eed);
  private quality = -1;
  private readonly crowns: Crown[] = [];
  private readonly bubbles: Record<Side, Bubble>;
  private readonly schedule: Scheduled[] = [];
  private flashFrames = 0;
  private flashLevel = 0;
  private flashOn = false;
  /** Runs at the start of every update, before uploads (effects.ts flushes queued casts). */
  beforeUpdate: (() => void) | null = null;

  constructor(private readonly host: VfxHost, opts: { arabic?: boolean } = {}) {
    this.atlas = makeParticleAtlas();
    this.alpha = new ParticlePool(ALPHA_CAP, particleMaterial(this.atlas, this.uTime, false), 5);
    this.add = new ParticlePool(ADD_CAP, particleMaterial(this.atlas, this.uTime, true), 6);
    this.decals = new DecalLayer(this.uTime, opts.arabic ?? false);
    this.glyphs = new GlyphLayer(this.uTime);
    this.domes = new IceDomes();
    host.scene.add(this.decals.mesh, this.alpha.mesh, this.add.mesh, this.glyphs.mesh, ...this.domes.meshes);

    // Crowns for fallen towers: shared geometry, one material each (fades).
    const band = new THREE.CylinderGeometry(0.5, 0.6, 0.3, 10);
    const spike = new THREE.ConeGeometry(0.1, 0.28, 6);
    band.userData.shared = spike.userData.shared = true;
    for (let c = 0; c < CROWN_POOL; c++) {
      const mat = toon(0xfbbf24);
      mat.transparent = true;
      mat.userData.shared = true;
      const group = new THREE.Group();
      group.add(new THREE.Mesh(band, mat));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const m = new THREE.Mesh(spike, mat);
        m.position.set(Math.cos(a) * 0.45, 0.26, Math.sin(a) * 0.45);
        group.add(m);
      }
      group.visible = false;
      host.scene.add(group);
      this.crowns.push({ group, mat, t: -1, x: 0, z: 0 });
    }

    // One emote bubble per side, each with its own reused canvas.
    const bubble = (): Bubble => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.userData.shared = true;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      mat.userData.shared = true;
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 21;
      host.scene.add(sprite);
      return { sprite, ctx: c.getContext("2d"), tex, t: -1 };
    };
    this.bubbles = { player: bubble(), enemy: bubble() };
    for (let i = 0; i < SCHEDULE_CAP; i++) this.schedule.push({ at: Infinity, kind: 0, value: 0, frames: 0 });
    this.applyQuality();
  }

  /** Presented seconds since the pool started (the shaders' clock). */
  get now(): number {
    return this.uTime.value;
  }

  rand = (): number => this.rng();

  scale(): number {
    return particleScale();
  }

  spawn(kind: PoolKind, s: ParticleSpec): void {
    (kind === "add" ? this.add : this.alpha).write(s, this.uTime.value);
  }

  /** FxApi: preset at arena tile (x, y), `opts.z` metres up. */
  emit(
    preset: string,
    x: number,
    y: number,
    opts?: { z?: number; color?: number; radius?: number; count?: number; side?: Side; delay?: number },
  ): void {
    const w = toWorld(x, y);
    this.emitWorld(preset, w.x, opts?.z ?? 0, w.z, opts);
  }

  /** Preset at a world point (x, height, z). Unknown names fall back to a ring flash. */
  emitWorld(preset: string, wx: number, wy: number, wz: number, opts?: EmitOpts): void {
    if (!emitPreset(this, preset, wx, wy, wz, opts)) {
      emitPreset(this, "flash", wx, wy, wz, opts);
      emitPreset(this, "ring", wx, wy, wz, opts);
    }
  }

  /** FxApi: a ground mark of radius `r` tiles at arena (x, y). */
  decal(kind: DecalKindName, x: number, y: number, r: number, opts?: DecalOpts): void {
    const w = toWorld(x, y);
    this.decals.add(kind, w.x, w.z, r, this.uTime.value, opts);
  }

  /** Floating damage number at a world point. */
  popup(wx: number, wy: number, wz: number, text: string, scale: number, color: string, crit = false): void {
    this.glyphs.popup(wx, wy, wz, text, scale, color, crit, this.uTime.value);
  }

  /** Freeze dome over arena (x, y). */
  dome(x: number, y: number, r: number, seconds: number): void {
    const w = toWorld(x, y);
    this.domes.start(w.x, w.z, r, seconds);
  }

  /** World units per CSS pixel at the current framing. */
  worldPerPixel(): number {
    const cam = this.host.camera;
    const w = Math.max(1, this.host.container.clientWidth);
    return (cam.right - cam.left) / (cam.zoom || 1) / w;
  }

  /** Camera trauma now or after `delay` seconds. */
  shake(amount: number, delay = 0): void {
    if (delay <= 0) this.host.shake?.(amount);
    else this.later(delay, 0, amount, 0);
  }

  /**
   * A full-screen flash for `frames` rendered frames. Skipped entirely when
   * the player asked for reduced motion, or when the post pass has no flash.
   */
  flash(level: number, frames = 2, delay = 0): void {
    if (reducedMotion() || !this.host.setFlash) return;
    if (delay > 0) {
      this.later(delay, 1, level, frames);
      return;
    }
    this.flashLevel = Math.max(this.flashLevel, level);
    this.flashFrames = Math.max(this.flashFrames, frames);
  }

  private later(delay: number, kind: 0 | 1, value: number, frames: number): void {
    let slot = this.schedule[0];
    for (const s of this.schedule) {
      if (s.at === Infinity) {
        slot = s;
        break;
      }
      if (s.at < slot.at) slot = s;
    }
    slot.at = this.uTime.value + delay;
    slot.kind = kind;
    slot.value = value;
    slot.frames = frames;
  }

  /** A golden crown rises, spins and fades over a fallen tower. */
  crown(x: number, y: number): void {
    let c = this.crowns[0];
    for (const k of this.crowns) {
      if (k.t < 0) {
        c = k;
        break;
      }
      if (k.t > c.t) c = k;
    }
    const w = toWorld(x, y);
    c.t = 0;
    c.x = w.x;
    c.z = w.z;
    c.group.visible = true;
    this.updateCrown(c);
  }

  private updateCrown(c: Crown): void {
    const t = c.t / CROWN_LIFE;
    c.group.position.set(c.x, 0.6 + t * 2.4, c.z);
    c.group.rotation.y = t * Math.PI * 3;
    c.group.scale.setScalar(1 + t * 0.4);
    c.mat.opacity = Math.min(1, (1 - t) * 2.5);
  }

  /** An emote bubble over `side`'s king tower (replaces that side's last one). */
  emote(side: Side, emoji: string, kingZ: number): void {
    const b = this.bubbles[side];
    if (b.ctx) paintBubble(b.ctx, emoji);
    b.tex.needsUpdate = true;
    b.t = 0;
    b.sprite.visible = true;
    b.sprite.position.set(0, 4.2, kingZ);
    b.sprite.scale.setScalar(0.1);
  }

  private applyQuality(): void {
    const q = particleScale();
    if (q === this.quality) return;
    this.quality = q;
    this.add.setScale(q);
    this.alpha.setScale(q);
  }

  update(dt: number): void {
    this.beforeUpdate?.();
    this.applyQuality();
    const now = (this.uTime.value += Math.max(0, dt));
    for (const s of this.schedule) {
      if (s.at > now) continue;
      if (s.kind === 0) this.host.shake?.(s.value);
      else this.flash(s.value, s.frames);
      s.at = Infinity;
    }
    this.add.flush(now);
    this.alpha.flush(now);
    this.decals.flush(now);
    this.glyphs.flush(now);
    this.domes.update(dt);
    for (const c of this.crowns) {
      if (c.t < 0) continue;
      c.t += dt;
      if (c.t >= CROWN_LIFE) {
        c.t = -1;
        c.group.visible = false;
      } else this.updateCrown(c);
    }
    for (const side of ["player", "enemy"] as const) {
      const b = this.bubbles[side];
      if (b.t < 0) continue;
      b.t += dt;
      const frac = 1 - b.t / EMOTE_LIFE;
      if (frac <= 0) {
        b.t = -1;
        b.sprite.visible = false;
        continue;
      }
      const pop = Math.min(1, b.t * 6);
      b.sprite.scale.setScalar(2.2 * (0.2 + 0.8 * pop));
      b.sprite.position.y = 4.2 + b.t * 0.5 / EMOTE_LIFE;
      b.sprite.material.opacity = frac < 0.15 ? frac / 0.15 : 1;
    }
    // Screen flash: hold for its frames, then clear exactly once.
    if (this.flashFrames > 0) {
      this.host.setFlash?.(this.flashLevel);
      this.flashOn = true;
      this.flashFrames--;
      if (this.flashFrames === 0) this.flashLevel = 0;
    } else if (this.flashOn) {
      this.host.setFlash?.(0);
      this.flashOn = false;
    }
  }

  reset(): void {
    this.add.reset();
    this.alpha.reset();
    this.decals.reset();
    this.glyphs.reset();
    this.domes.reset();
    for (const c of this.crowns) {
      c.t = -1;
      c.group.visible = false;
    }
    for (const b of Object.values(this.bubbles)) {
      b.t = -1;
      b.sprite.visible = false;
    }
    for (const s of this.schedule) s.at = Infinity;
    this.flashFrames = 0;
    this.flashLevel = 0;
    if (this.flashOn) this.host.setFlash?.(0);
    this.flashOn = false;
  }
}
