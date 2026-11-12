/**
 * Damage numbers without a canvas per hit: the glyphs 0-9 - + ! and a star
 * are pre-rendered once, in the game font, into a 1024x256 atlas (8x2 cells
 * of 128px). A popup is a handful of pooled instanced quads with per-glyph
 * UV cells and offsets; the vertex shader pops, raises and fades them over
 * POPUP_LIFE on the shared FX clock.
 *
 * Art bible 8: a gold fill, a 3 CSS px dark stroke and a soft drop shadow.
 * The atlas keeps three masks in three channels, so one texture serves
 * every number colour: red is the fill, green the stroke (fill included),
 * blue the blurred shadow. The shader composites shadow, ink and fill.
 *
 * Hits on the same target within MERGE_WINDOW merge into one number, and a
 * new number that would overlap one still on screen stacks above it (a
 * view-space lift), so "160" and "80" never print over each other.
 */
import * as THREE from "three";
import { POPUP_LIFE, damageLabel, popupRise } from "../../popups";
import { GAME_FONT } from "../common";

/** Glyph order in the atlas; '*' is drawn as a star. */
export const GLYPHS = "0123456789-+!*";
const COLS = 8;
const ROWS = 2;
const CELL = 128;
const FONT_PX = 96;
/** Stroke width in atlas px: about 3 CSS px round a normal number on a 390 px phone. */
const STROKE_PX = 30;
/** Glyph quads the pool can hold (about 40 numbers on screen). */
export const GLYPH_CAP = 192;
/** Fallback advance (in glyph heights) before the font is measured. */
const DEFAULT_ADVANCE = 0.6;
/** World height of a scale-1 number's quad. */
export const GLYPH_HEIGHT = 1.25;
/** Seconds within which a second hit on the same target merges into the first number. */
export const MERGE_WINDOW = 0.15;
/**
 * Damage numbers on a phone-width board (under PHONE_POPUP_WIDTH CSS px) are
 * drawn at this share of their size: a normal hit about 18 CSS px tall and a
 * crit about 22, instead of 25-30 px numbers covering the bridge and lanes.
 */
export const PHONE_POPUP_SCALE = 0.75;
export const PHONE_POPUP_WIDTH = 500;
/** Ink and shadow colours (art bible 8: #1D1630 stroke). */
export const GLYPH_INK = 0x1d1630;

export interface GlyphQuad {
  cell: number;
  /** Centre offset from the popup anchor, in glyph heights. */
  x: number;
}

/**
 * Lay `text` out as centred quads: each glyph advances by `advance(ch)`
 * (in glyph heights) and the run is centred on 0. Characters outside the
 * atlas are skipped. Writes into `out` and returns it.
 */
export function layoutGlyphs(text: string, advance: (cell: number) => number, out: GlyphQuad[] = []): GlyphQuad[] {
  out.length = 0;
  let total = 0;
  for (const ch of text) {
    const cell = GLYPHS.indexOf(ch);
    if (cell < 0) continue;
    const a = advance(cell);
    out.push({ cell, x: total + a / 2 });
    total += a;
  }
  for (const q of out) q.x -= total / 2;
  return out;
}

/** A number on screen, as the merge and stack rules see it (view space, world units). */
export interface LivePopup {
  id: number;
  /** View-space anchor at birth, before the stack lift. */
  vx: number;
  vy: number;
  /** View-space lift from stacking. */
  lift: number;
  birth: number;
  /** The number shown (NaN for text that is not a plain number). */
  value: number;
  /** Quad height and run width (view units). */
  h: number;
  w: number;
  scale: number;
  crit: boolean;
  color: string;
  /** The entity the number is about, when the caller knows it (merges go by it). */
  target?: number;
}

/**
 * The lift (view units) that keeps a new number of height `h` and width `w`
 * at view (vx, vy) clear of every live number for the rest of both lives.
 * `riseK` converts popupRise's world rise into view units. Pure (tests).
 */
export function stackLift(live: readonly LivePopup[], vx: number, vy: number, w: number, h: number, now: number, riseK: number): number {
  let lift = 0;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const p of live) {
      const age = now - p.birth;
      // A number in its last moments is fading: it may be overlapped.
      if (age < 0 || age > POPUP_LIFE - 0.15) continue;
      if (Math.abs(vx - p.vx) >= (w + p.w) * 0.5) continue;
      const need = 0.4 * (h + p.h);
      const py = p.vy + p.lift + popupRise(age / POPUP_LIFE) * riseK;
      const ny = vy + lift;
      // Above it already: the newer number rises faster, so the gap only grows.
      if (ny - py >= need) continue;
      // Below it for the older one's whole remaining life (the gap shrinks to its end).
      const left = (POPUP_LIFE - age) / POPUP_LIFE;
      const endGap = p.vy + p.lift + popupRise(1) * riseK - (ny + popupRise(left) * riseK);
      if (py - ny >= need && endGap >= need) continue;
      lift = py - vy + need;
      moved = true;
    }
    if (!moved) break;
  }
  return lift;
}

function paintStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.48;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Paint every glyph into the three masks and return the advances: on an
 * opaque black canvas, 'lighter' adds each layer's coverage into its own
 * channel (blue shadow, green stroke, red fill).
 */
function paintGlyphs(ctx: CanvasRenderingContext2D, advances: number[]): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.globalCompositeOperation = "lighter";
  ctx.font = `${FONT_PX}px ${GAME_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const at = (i: number): [number, number] => [(i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2 + 2];
  const shape = (i: number, x: number, y: number, mode: "stroke" | "fill", width = 0): void => {
    const ch = GLYPHS[i];
    if (ch === "*") {
      paintStar(ctx, x, y, 34);
      if (mode === "stroke") {
        ctx.lineWidth = width;
        ctx.stroke();
      }
      ctx.fill();
      return;
    }
    if (mode === "stroke") {
      ctx.lineWidth = width;
      ctx.strokeText(ch, x, y);
    }
    ctx.fillText(ch, x, y);
  };
  for (let i = 0; i < GLYPHS.length; i++) {
    const [cx, cy] = at(i);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - CELL / 2, cy - 2 - CELL / 2, CELL, CELL);
    ctx.clip();
    // Soft drop shadow: the stroked shape, blurred, offset down-right.
    ctx.filter = "blur(3px)";
    ctx.fillStyle = ctx.strokeStyle = "#0000ff";
    shape(i, cx + 2, cy + 5, "stroke", STROKE_PX + 2);
    ctx.filter = "none";
    ctx.fillStyle = ctx.strokeStyle = "#00ff00";
    shape(i, cx, cy, "stroke", STROKE_PX);
    ctx.fillStyle = "#ff0000";
    shape(i, cx, cy, "fill");
    ctx.restore();
    if (GLYPHS[i] === "*") {
      advances[i] = 0.78;
      continue;
    }
    const w = ctx.measureText(GLYPHS[i]).width;
    // The stroke overlaps the neighbour's: ink merges, the run stays tight.
    advances[i] = w > 0 ? Math.min(0.92, (w + STROKE_PX * 0.55) / CELL) : DEFAULT_ADVANCE;
  }
  ctx.restore();
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLife;
attribute vec4 aAnchor; // world x, y, z, birth
attribute vec4 aG;      // cell, x offset (glyph heights), height (world), view-space stack lift
attribute vec3 aCol;
varying vec2 vUv;
varying float vLy;
varying vec3 vCol;
varying float vAlpha;
float popScale(float t) {
  if (t < 0.12) return 0.3 + 0.95 * (t / 0.12);
  if (t < 0.25) return 1.25 - 0.25 * ((t - 0.12) / 0.13);
  return 1.0;
}
void main() {
  float age = uTime - aAnchor.w;
  if (age < 0.0 || age > uLife) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vLy = 0.0;
    vCol = vec3(0.0);
    vAlpha = 0.0;
    return;
  }
  float t = age / uLife;
  float rise = 1.1 * (1.0 - (1.0 - t) * (1.0 - t));
  vAlpha = t < 0.65 ? 1.0 : max(0.0, 1.0 - (t - 0.65) / 0.35);
  float h = aG.z * popScale(t);
  vec4 mv = viewMatrix * vec4(aAnchor.x, aAnchor.y + rise, aAnchor.z, 1.0);
  mv.y += aG.w;
  mv.xy += vec2(position.x + aG.y, position.y) * h;
  float cell = aG.x;
  vec2 cxy = vec2(mod(cell, ${COLS}.0), floor(cell / ${COLS}.0));
  vUv = vec2((cxy.x + uv.x) / ${COLS}.0, (${ROWS - 1}.0 - cxy.y + uv.y) / ${ROWS}.0);
  vLy = uv.y;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uInk;
varying vec2 vUv;
varying float vLy;
varying vec3 vCol;
varying float vAlpha;
void main() {
  vec3 m = texture2D(uMap, vUv).rgb;
  float s = m.b * 0.32; // a tight, light drop shadow: no dark smudge on the lawn
  float g = m.g;
  float r = m.r;
  // Shadow, then ink, then fill ("over", premultiplied).
  vec3 c = uInk * s;
  float a = s;
  c = uInk * g + c * (1.0 - g);
  a = g + a * (1.0 - g);
  // The fill brightens toward its top, deepens toward its foot (toy candy).
  vec3 fill = vCol * mix(vec3(1.0, 0.74, 0.5), vec3(1.0, 1.06, 1.25), smoothstep(0.3, 0.68, vLy));
  c = fill * r + c * (1.0 - r);
  a = r + a * (1.0 - r);
  if (a * vAlpha < 0.004) discard;
  gl_FragColor = vec4(c / max(a, 1e-3), a * vAlpha);
  #include <colorspace_fragment>
}`;

const TMP = new THREE.Color();
const V = new THREE.Vector3();
/** Live numbers the merge and stack rules remember (oldest dropped first). */
const LIVE_CAP = 32;

export class GlyphLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly advances: number[] = Array.from({ length: GLYPHS.length }, () => DEFAULT_ADVANCE);
  /** Size share for every new number (PHONE_POPUP_SCALE on a phone-width board). */
  sizeK = 1;
  private head = 0;
  private total = 0;
  private dirty = false;
  private liveUntil = -1;
  private nextId = 1;
  private readonly anchor: THREE.InstancedBufferAttribute;
  private readonly g: THREE.InstancedBufferAttribute;
  private readonly col: THREE.InstancedBufferAttribute;
  /** Which popup each quad slot belongs to (so a merge only kills its own quads). */
  private readonly owner = new Int32Array(GLYPH_CAP);
  private readonly quads: GlyphQuad[] = [];
  /** Numbers still on screen (merge and stack bookkeeping). */
  readonly live: LivePopup[] = [];
  private readonly advanceOf = (cell: number): number => this.advances[cell];

  constructor(uTime: { value: number }) {
    const canvas = document.createElement("canvas");
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.userData.shared = true;
    if (ctx) {
      paintGlyphs(ctx, this.advances);
      // Repaint into the same canvas once the display face has loaded.
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      fonts
        ?.load(`${FONT_PX}px 'Lilita One'`)
        .then(() => {
          paintGlyphs(ctx, this.advances);
          tex.needsUpdate = true;
        })
        .catch(() => undefined);
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const attr = (name: string, size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(GLYPH_CAP * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.anchor = attr("aAnchor", 4);
    this.g = attr("aG", 4);
    this.col = attr("aCol", 3);
    for (let i = 0; i < GLYPH_CAP; i++) this.anchor.array[i * 4 + 3] = -1e6;
    TMP.setHex(GLYPH_INK);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uLife: { value: POPUP_LIFE },
        uMap: { value: tex },
        uInk: { value: new THREE.Vector3(TMP.r, TMP.g, TMP.b) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false, // numbers always read on top
    });
    mat.userData.shared = true;
    this.mesh = new THREE.InstancedMesh(geo, mat, GLYPH_CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  /** Quads currently allocated (never above GLYPH_CAP). */
  get count(): number {
    return Math.min(this.total, GLYPH_CAP);
  }

  /** Lay out quads for `text` (plus a leading star for crits); exposed for tests. */
  layout(text: string, crit: boolean): GlyphQuad[] {
    return layoutGlyphs(crit ? `*${text}` : text, this.advanceOf, this.quads);
  }

  /**
   * A number rising from world (x, y, z); `scale` 1 is a normal hit. `view`
   * (the camera's matrixWorldInverse) places the merge and stack rules in
   * screen terms; without it they work in world x/y. `target` is the entity
   * hit: two numbers merge only when they are about the same target (both
   * given), or, when either has no target, when they sit on the same spot.
   */
  popup(
    x: number,
    y: number,
    z: number,
    text: string,
    scale: number,
    color: string,
    crit: boolean,
    now: number,
    view?: THREE.Matrix4,
    target?: number,
  ): void {
    // Forget numbers that are gone.
    for (let i = this.live.length - 1; i >= 0; i--) if (now - this.live[i].birth > POPUP_LIFE) this.live.splice(i, 1);
    V.set(x, y + 0.3, z);
    if (view) V.applyMatrix4(view);
    const riseK = view ? view.elements[5] : 1;
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    // Merge: the same target hit again within the window (by id when both
    // numbers know their target, else by the same spot on screen).
    let birth = now;
    let lift = 0;
    for (const p of this.live) {
      if (Number.isNaN(value) || Number.isNaN(p.value)) continue;
      if (now - p.birth > MERGE_WINDOW) continue;
      if (target !== undefined && p.target !== undefined) {
        if (p.target !== target) continue;
      } else if (Math.abs(V.x - p.vx) > 0.5 || Math.abs(V.y - p.vy) > 0.5) continue;
      const sum = p.value + value;
      const label = damageLabel(sum);
      text = String(Math.round(sum));
      scale = Math.max(scale, p.scale, label?.scale ?? 0);
      crit = crit || p.crit || label?.crit === true;
      color = p.color;
      birth = p.birth;
      lift = p.lift;
      this.kill(p.id);
      this.live.splice(this.live.indexOf(p), 1);
      break;
    }
    const quads = this.layout(text, crit);
    if (quads.length === 0) return;
    const h = GLYPH_HEIGHT * scale * this.sizeK;
    let run = 0;
    for (const q of quads) run += this.advances[q.cell];
    const w = run * h;
    if (birth === now) lift = stackLift(this.live, V.x, V.y, w, h, now, riseK);
    const id = this.nextId++;
    this.live.push({ id, vx: V.x, vy: V.y, lift, birth, value: Number.isNaN(value) ? NaN : Number(text), h, w, scale, crit, color, target });
    if (this.live.length > LIVE_CAP) this.live.shift();
    TMP.set(color);
    const A = this.anchor.array as Float32Array;
    const G = this.g.array as Float32Array;
    const C = this.col.array as Float32Array;
    for (const q of quads) {
      const i = this.head;
      this.head = (this.head + 1) % GLYPH_CAP;
      this.total++;
      this.owner[i] = id;
      A[i * 4] = x;
      A[i * 4 + 1] = y + 0.3;
      A[i * 4 + 2] = z;
      A[i * 4 + 3] = birth;
      G[i * 4] = q.cell;
      G[i * 4 + 1] = q.x;
      G[i * 4 + 2] = h;
      G[i * 4 + 3] = lift;
      C[i * 3] = TMP.r;
      C[i * 3 + 1] = TMP.g;
      C[i * 3 + 2] = TMP.b;
    }
    this.dirty = true;
    this.liveUntil = Math.max(this.liveUntil, birth + POPUP_LIFE);
  }

  /** Hide every quad a popup still owns. */
  private kill(id: number): void {
    const A = this.anchor.array as Float32Array;
    for (let i = 0; i < GLYPH_CAP; i++) {
      if (this.owner[i] !== id) continue;
      A[i * 4 + 3] = -1e6;
      this.owner[i] = 0;
    }
  }

  flush(now: number): void {
    if (this.dirty) {
      // A few hundred floats: upload whole rather than track ranges.
      for (const a of [this.anchor, this.g, this.col]) {
        a.clearUpdateRanges();
        a.needsUpdate = true;
      }
      this.dirty = false;
    }
    this.mesh.count = this.count;
    this.mesh.visible = now <= this.liveUntil && this.mesh.count > 0;
  }

  reset(): void {
    const A = this.anchor.array as Float32Array;
    for (let i = 0; i < GLYPH_CAP; i++) A[i * 4 + 3] = -1e6;
    this.owner.fill(0);
    this.live.length = 0;
    this.head = 0;
    this.total = 0;
    this.dirty = true;
    this.liveUntil = -1;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
