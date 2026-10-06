/**
 * Damage numbers without a canvas per hit: the glyphs 0-9 - + ! and a star
 * are pre-rendered once, in the game font with a dark outline, into a
 * 1024x256 atlas (8x2 cells of 128px). A popup is a handful of pooled
 * instanced quads with per-glyph UV cells and offsets; the vertex shader
 * pops, raises and fades them over POPUP_LIFE on the shared FX clock.
 *
 * The atlas keeps the fill mask in red and the outline in green, so one
 * texture serves every number colour: the shader blends outline ink into
 * the per-popup fill colour.
 */
import * as THREE from "three";
import { POPUP_LIFE } from "../../popups";
import { GAME_FONT } from "../common";

/** Glyph order in the atlas; '*' is drawn as a star. */
export const GLYPHS = "0123456789-+!*";
const COLS = 8;
const ROWS = 2;
const CELL = 128;
const FONT_PX = 100;
/** Glyph quads the pool can hold (about 40 numbers on screen). */
export const GLYPH_CAP = 192;
/** Fallback advance (in glyph heights) before the font is measured. */
const DEFAULT_ADVANCE = 0.6;

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

/** Paint every glyph (outline green, fill red) and return the advances. */
function paintGlyphs(ctx: CanvasRenderingContext2D, advances: number[]): void {
  ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.font = `${FONT_PX}px ${GAME_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 18;
  for (let i = 0; i < GLYPHS.length; i++) {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    const ch = GLYPHS[i];
    if (ch === "*") {
      paintStar(ctx, cx, cy + 2, 40);
      ctx.strokeStyle = "#00ff00";
      ctx.stroke();
      ctx.fillStyle = "#ff0000";
      ctx.fill();
      advances[i] = 0.82;
      continue;
    }
    ctx.strokeStyle = "#00ff00";
    ctx.strokeText(ch, cx, cy + 6);
    ctx.fillStyle = "#ff0000";
    ctx.fillText(ch, cx, cy + 6);
    const w = ctx.measureText(ch).width;
    advances[i] = w > 0 ? Math.min(0.95, (w + 14) / CELL) : DEFAULT_ADVANCE;
  }
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLife;
attribute vec4 aAnchor; // world x, y, z, birth
attribute vec4 aG;      // cell, x offset (glyph heights), height (world), unused
attribute vec3 aCol;
varying vec2 vUv;
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
    vCol = vec3(0.0);
    vAlpha = 0.0;
    return;
  }
  float t = age / uLife;
  float rise = 1.1 * (1.0 - (1.0 - t) * (1.0 - t));
  vAlpha = t < 0.65 ? 1.0 : max(0.0, 1.0 - (t - 0.65) / 0.35);
  float h = aG.z * popScale(t);
  vec4 mv = viewMatrix * vec4(aAnchor.x, aAnchor.y + rise, aAnchor.z, 1.0);
  mv.xy += vec2(position.x + aG.y, position.y) * h;
  float cell = aG.x;
  vec2 cxy = vec2(mod(cell, ${COLS}.0), floor(cell / ${COLS}.0));
  vUv = vec2((cxy.x + uv.x) / ${COLS}.0, (${ROWS - 1}.0 - cxy.y + uv.y) / ${ROWS}.0);
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uInk;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vAlpha;
  if (a < 0.004) discard;
  float fill = clamp(tex.r / max(tex.r + tex.g, 1e-3), 0.0, 1.0);
  gl_FragColor = vec4(mix(uInk, vCol, fill), a);
  #include <colorspace_fragment>
}`;

const TMP = new THREE.Color();

export class GlyphLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly advances: number[] = Array.from({ length: GLYPHS.length }, () => DEFAULT_ADVANCE);
  private head = 0;
  private total = 0;
  private dirty = false;
  private liveUntil = -1;
  private readonly anchor: THREE.InstancedBufferAttribute;
  private readonly g: THREE.InstancedBufferAttribute;
  private readonly col: THREE.InstancedBufferAttribute;
  private readonly quads: GlyphQuad[] = [];
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
    TMP.setRGB(0.04, 0.055, 0.086, THREE.SRGBColorSpace);
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

  /** A number rising from world (x, y, z); `scale` 1 is a normal hit. */
  popup(x: number, y: number, z: number, text: string, scale: number, color: string, crit: boolean, now: number): void {
    const quads = this.layout(text, crit);
    if (quads.length === 0) return;
    TMP.set(color);
    const h = 1.05 * scale;
    const A = this.anchor.array as Float32Array;
    const G = this.g.array as Float32Array;
    const C = this.col.array as Float32Array;
    for (const q of quads) {
      const i = this.head;
      this.head = (this.head + 1) % GLYPH_CAP;
      this.total++;
      A[i * 4] = x;
      A[i * 4 + 1] = y + 0.3;
      A[i * 4 + 2] = z;
      A[i * 4 + 3] = now;
      G[i * 4] = q.cell;
      G[i * 4 + 1] = q.x;
      G[i * 4 + 2] = h;
      C[i * 3] = TMP.r;
      C[i * 3 + 1] = TMP.g;
      C[i * 3 + 2] = TMP.b;
    }
    this.dirty = true;
    this.liveUntil = now + POPUP_LIFE;
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
    this.head = 0;
    this.total = 0;
    this.dirty = true;
    this.liveUntil = -1;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
