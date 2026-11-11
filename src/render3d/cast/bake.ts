/**
 * Baking a cast VARIANT into one skinned draw: the body meshes, the rigid
 * props (skinned to their bone with weight 1), our own primitives and an
 * inside-out ink shell share one geometry, one atlas and one material, so
 * a unit is ONE draw call. The geometry and atlas are team-neutral and
 * shared by every unit of the card; the team colour is a pair of shared
 * uniforms per side (TEAM_UNIFORMS), so a palette switch repaints units
 * already on the field.
 *
 * Material (art bible 6): a 3-band toon ramp (0.62 / 0.86 / 1.0, soft 0.04
 * edges), a cool rim (#BFE3FF at 0.35, off at L4), albedo saturation x1.12
 * with a brightening lift, painted ground occlusion on the lowest 18% of
 * the body (up to 15% darker), ink at 1.6 CSS px, and status / hit tints
 * that MIX toward their colour (hit flash at most 0.35) instead of adding
 * light, so nothing crosses the bloom threshold.
 */
import * as THREE from "three";
import type { Side } from "../../game/arena";
import type { TeamPalette } from "../../ui/prefs";
import { INK_FRAGMENT, OUTLINE_CSS_PX, fitInk, installInk, registerInkGeometry, smoothedNormals } from "../outlineMaterial";
import { teamColor, teamPalette } from "../teamColors";
import { BONE_INDEX, HEAD_BONE, sources, type Source } from "./loader";
import { CLOTH_SWATCHES, SKIN_SWATCHES } from "./rules";
import type { FileId, Paint, Swatch, Variant } from "./types";

/** Kit heads are scaled up this much about the neck (art bible 1). */
export const HEAD_SCALE = 1.12;
/** The packs' capes reach the heels and hide the figure from behind: cut to a short mantle. */
export const CAPE_LENGTH = 0.56;
/** The Mage's hat brim hides the whole wizard from the battle camera: narrowed to show the shoulders. */
export const HAT_BRIM = 0.8;
/** Ink width of the cast in CSS px (the shared shell shader is written for OUTLINE_CSS_PX). */
export const CAST_INK_PX = 1.6;
/** Ground occlusion: the lowest share of the body, and how much darker its foot gets. */
export const GROUND_AO_HEIGHT = 0.18;
export const GROUND_AO_DARK = 0.15;
/** Albedo saturation multiplier. */
export const ALBEDO_SATURATION = 1.12;

// ---------------------------------------------------------------- team

/** The team colour every cast unit of a (viewer-relative) side wears: shared, live uniforms. */
export const TEAM_UNIFORMS: Record<Side, { main: { value: THREE.Color }; dark: { value: THREE.Color } }> = {
  player: { main: { value: new THREE.Color() }, dark: { value: new THREE.Color() } },
  enemy: { main: { value: new THREE.Color() }, dark: { value: new THREE.Color() } },
};
let paintedPalette: TeamPalette | null = null;

/** Repaint every cast unit for a team palette (cheap: four uniform colours). */
export function setCastPalette(palette: TeamPalette): void {
  paintedPalette = palette;
  for (const side of ["player", "enemy"] as const) {
    TEAM_UNIFORMS[side].main.value.setHex(teamColor(side, "main", palette));
    TEAM_UNIFORMS[side].dark.value.setHex(teamColor(side, "dark", palette));
  }
}

/** The palette the team uniforms hold (filled on first use). */
export function castPalette(): TeamPalette {
  if (paintedPalette === null) setCastPalette(teamPalette());
  return paintedPalette!;
}

/** Rim light strength (0 at the quality levels without rim light): shared by every cast material. */
export const RIM_UNIFORM = { value: 1 };

// ---------------------------------------------------------------- palette

/** Atlas tile size: the packs' 1024 px palettes are flat gradient swatches. */
const TILE = 256;
const HSL = { h: 0, s: 0, l: 0 };
const COL = new THREE.Color();

function hslOf(hex: number): { h: number; s: number; l: number } {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(out, THREE.SRGBColorSpace);
  return out;
}

/** Skin, repainted a warm peach (the lift alone washes the packs' skin to egg white). */
export const SKIN = 0xee9c68;

/** Swatch key of a palette UV. */
export function swatchOf(u: number, v: number): Swatch {
  return `${Math.min(7, Math.max(0, Math.floor(u * 8)))},${Math.min(3, Math.max(0, Math.floor(v * 4)))}`;
}

/** 0 none, 1 team main, 2 team dark: what a paint asks of the team uniforms. */
function teamCode(p: Paint | undefined): number {
  return p === "team" ? 1 : p === "teamDark" ? 2 : 0;
}

/**
 * Re-grade one palette tile in place: brighter and more saturated, with the
 * variant's repaints. Team swatches become a neutral grey ramp (light at the
 * top like the packs' own gradients) that the shader tints per side.
 */
function gradeTile(
  px: Uint8ClampedArray,
  width: number,
  x0: number,
  file: FileId,
  paint: Variant["paint"],
  skin: number,
): void {
  const cell = TILE / 8;
  const targets = new Map<string, { h: number; s: number; l: number }>();
  const team = new Set<string>();
  for (const k of SKIN_SWATCHES[file] ?? []) targets.set(k, hslOf(skin));
  for (const [k, p] of Object.entries(paint ?? {})) {
    if (teamCode(p as Paint)) team.add(k);
    else targets.set(k, hslOf(p as number));
  }
  const top = new Map<string, number>();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * width + x0 + x) * 4;
        COL.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255).getHSL(HSL);
        const key = `${Math.floor(x / cell)},${Math.floor(y / cell) >> 1}`;
        if (pass === 0) {
          top.set(key, Math.max(top.get(key) ?? 0, HSL.l));
          continue;
        }
        const k = HSL.l / Math.max(0.05, top.get(key) ?? 1);
        const t = targets.get(key);
        if (team.has(key)) {
          // Grey ramp: 1 at the lit top of the swatch, about 0.55 at its foot.
          COL.setRGB(1, 1, 1).multiplyScalar(Math.min(1, 0.1 + 0.9 * k));
        } else if (t) {
          COL.setHSL(t.h, t.s, Math.min(0.94, t.l * (0.52 + 0.56 * k)));
        } else if (HSL.s < 0.12) {
          // Steel, bone and cloth greys: lifted, a touch cool.
          COL.setHSL(0.6, 0.08 + HSL.s, Math.min(0.95, Math.pow(HSL.l, 0.72)));
        } else {
          COL.setHSL(HSL.h, Math.min(1, HSL.s * ALBEDO_SATURATION + 0.03), Math.min(0.9, Math.pow(HSL.l, 0.86)));
        }
        px[i] = Math.round(COL.r * 255);
        px[i + 1] = Math.round(COL.g * 255);
        px[i + 2] = Math.round(COL.b * 255);
      }
    }
  }
}

/** The palettes a variant's atlas holds: its own, then any borrowed prop's. */
export function atlasFiles(v: Variant): FileId[] {
  const files: FileId[] = [v.file];
  for (const p of v.props) {
    const from = p.includes(":") ? (p.split(":")[0] as FileId) : v.file;
    if (!files.includes(from)) files.push(from);
  }
  return files;
}

/** Skin tone of a variant (some cards wear their own: bone, a dark-skinned amir, a green goblin...). */
export function skinOf(v: Variant): number {
  return v.skin ?? SKIN;
}

const textures = new Map<string, THREE.Texture>();

/**
 * A variant's atlas: its character's palette, a borrowed prop's palette, a
 * team tile (a grey ramp with a gold hem, tinted per side in the shader)
 * and a white tile (our own primitives, coloured per vertex), side by side.
 * Team-neutral: one atlas per card and edition, shared by both sides.
 */
function atlas(key: string, v: Variant): THREE.Texture {
  let tex = textures.get(key);
  if (tex) return tex;
  const files = atlasFiles(v);
  const tiles = files.length + 2;
  const c = document.createElement("canvas");
  c.width = tiles * TILE;
  c.height = TILE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  files.forEach((f, i) => ctx.drawImage(sources.get(f)!.image, i * TILE, 0, TILE, TILE));
  const data = ctx.getImageData(0, 0, c.width, c.height);
  files.forEach((f, i) => gradeTile(data.data, c.width, i * TILE, f, i === 0 ? v.paint : v.propPaint, skinOf(v)));
  ctx.putImageData(data, 0, 0);
  // Team tile: four swatch rows, each a grey ramp light at the top like the packs' own.
  for (let r = 0; r < 4; r++) {
    const g = ctx.createLinearGradient(0, r * (TILE / 4), 0, (r + 1) * (TILE / 4));
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#8c8c8c");
    ctx.fillStyle = g;
    ctx.fillRect(files.length * TILE, r * (TILE / 4), TILE, TILE / 4);
    // A gold hem: the packs map a cape's lower edge to the foot of its swatch.
    ctx.fillStyle = "#ffd65a";
    ctx.fillRect(files.length * TILE, (r + 1) * (TILE / 4) - TILE / 28, TILE, TILE / 28);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect((files.length + 1) * TILE, 0, TILE, TILE);
  tex = new THREE.CanvasTexture(c);
  tex.flipY = false; // glTF convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false; // flat swatches: mips would bleed one into the next
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.userData.shared = true;
  textures.set(key, tex);
  return tex;
}

// ------------------------------------------------------------------- bake

export interface Baked {
  geometry: THREE.BufferGeometry;
  /** Index count of the body (the ink shell follows it). */
  bodyCount: number;
  /** The same buffers without the shell, for the see-through deploy ghost. */
  ghost?: THREE.BufferGeometry;
  /** Top of the model in rig units (before the variant scale). */
  top: number;
  /** Half-width of the model in rig units (before the variant scale). */
  halfWidth: number;
  /** Vertices of the body (the shell doubles them). */
  vertices: number;
  atlas: THREE.Texture;
}

interface Part {
  geo: THREE.BufferGeometry;
  /** Rigid parts: the transform into skin space and the bone they ride. */
  matrix: THREE.Matrix4 | null;
  bone: number;
  remap: number[] | null;
  /** Atlas tile, or -1 team tile, -2 white tile. */
  tile: number;
  /** Team code for the whole part (team tile / team extras). */
  team: number;
  color: THREE.Color | null;
  twoSided: boolean;
  /** Our own primitives carry no palette UVs: one flat texel. */
  flat?: boolean;
  crop?: number;
  squeeze?: number;
  /** Grows with the head about the neck. */
  head: boolean;
}

const baked = new Map<string, Baked>();
const M = new THREE.Matrix4();
const V3 = new THREE.Vector3();
const N3 = new THREE.Vector3();
const NM = new THREE.Matrix3();
const PIVOT = new THREE.Vector3();

/** Where a rigid node sits in skin space, riding `bone` of its own character. */
function rigidMatrix(src: Source, bone: number, world: THREE.Matrix4): THREE.Matrix4 {
  // skinned = boneWorld * boneInverse * v, so v = boneInverse^-1 * boneWorldRest^-1 * world * p.
  return new THREE.Matrix4()
    .copy(src.inverses[bone])
    .invert()
    .multiply(M.copy(src.bones[bone].matrixWorld).invert())
    .multiply(world);
}

function boneAbove(o: THREE.Object3D): number {
  for (let p = o.parent; p; p = p.parent) {
    const at = BONE_INDEX.get(p.name);
    if (at !== undefined && (p as THREE.Bone).isBone) return at;
  }
  return 0;
}

/** Bake (once, cached by key) a variant into its shared skinned geometry and atlas. */
export function bakeVariant(key: string, v: Variant): Baked {
  const hit = baked.get(key);
  if (hit) return hit;
  const src = sources.get(v.file)!;
  const files = atlasFiles(v);
  const parts: Part[] = [];
  const cloth = new Set<string>(CLOTH_SWATCHES[v.file] ?? []);

  src.rig.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || v.drop?.test(m.name)) return;
    const glow = ((m.material as THREE.MeshStandardMaterial).map ?? null) === null;
    const team = v.team?.test(m.name) ?? false;
    parts.push({
      geo: m.geometry,
      matrix: null,
      bone: 0,
      remap: src.remap,
      tile: glow ? -2 : team ? -1 : 0,
      team: team ? 1 : 0,
      color: glow ? new THREE.Color(0xbfff6a) : null,
      twoSided: /Cape|Cloak/.test(m.name),
      head: false,
    });
  });
  for (const p of v.props) {
    const [file, node] = p.includes(":") ? (p.split(":") as [FileId, string]) : [v.file, p];
    const from = sources.get(file);
    const mesh = from?.rig.getObjectByName(node) as THREE.Mesh | undefined;
    if (!from || !mesh?.isMesh) {
      console.warn(`cast: ${key} prop ${p} not found`);
      continue;
    }
    const bone = boneAbove(mesh);
    const team = v.team?.test(node) ?? false;
    parts.push({
      geo: mesh.geometry,
      matrix: rigidMatrix(from, bone, mesh.matrixWorld),
      bone,
      remap: null,
      tile: team ? -1 : files.indexOf(file),
      team: team ? 1 : 0,
      color: null,
      twoSided: /Cape|Cloak/.test(node),
      crop: /Cape/.test(node) ? (v.cape ?? CAPE_LENGTH) : undefined,
      squeeze: /Mage_Hat/.test(node) ? (v.brim ?? HAT_BRIM) : undefined,
      head: bone === HEAD_BONE,
    });
  }
  for (const x of v.extras ?? []) {
    const bone = BONE_INDEX.get(x.bone) ?? 0;
    const world = x.local ? src.bones[bone].matrixWorld.clone() : new THREE.Matrix4();
    const team = teamCode(x.color);
    parts.push({
      geo: x.geo(),
      matrix: rigidMatrix(src, bone, world),
      bone,
      remap: null,
      tile: team ? -1 : -2,
      team,
      color: typeof x.color === "number" ? new THREE.Color().setHex(x.color) : null,
      twoSided: x.open === true,
      flat: true,
      head: bone === HEAD_BONE && !x.fixed,
    });
  }

  // The head grows about the neck: the head bone's rest position in skin space.
  PIVOT.setFromMatrixPosition(M.copy(src.inverses[HEAD_BONE]).invert());

  let verts = 0;
  for (const p of parts) verts += p.geo.getAttribute("position").count;
  // Body vertices first, then the same again as the ink shell.
  const position = new Float32Array(verts * 2 * 3);
  const normal = new Float32Array(verts * 2 * 3);
  const uv = new Float32Array(verts * 2 * 2);
  const color = new Float32Array(verts * 2 * 3).fill(1);
  const teamA = new Float32Array(verts * 2);
  const skinIndex = new Uint16Array(verts * 2 * 4);
  const skinWeight = new Float32Array(verts * 2 * 4);
  const outlineNormal = new Float32Array(verts * 2 * 3);
  const index: number[] = [];
  const hull: number[] = [];
  const tiles = files.length + 2;
  let at = 0;
  let top = 0;
  let halfWidth = 0;
  for (const p of parts) {
    const pos = p.geo.getAttribute("position");
    const nor = p.geo.getAttribute("normal");
    const tex = p.geo.getAttribute("uv");
    const si = p.geo.getAttribute("skinIndex");
    const sw = p.geo.getAttribute("skinWeight");
    if (p.matrix) NM.getNormalMatrix(p.matrix);
    let capeTop = -Infinity;
    if (p.crop && p.matrix) {
      for (let i = 0; i < pos.count; i++) capeTop = Math.max(capeTop, V3.fromBufferAttribute(pos, i).applyMatrix4(p.matrix).y);
    }
    for (let i = 0; i < pos.count; i++) {
      const o = at + i;
      V3.fromBufferAttribute(pos, i);
      N3.fromBufferAttribute(nor, i);
      if (p.matrix) {
        V3.applyMatrix4(p.matrix);
        N3.applyMatrix3(NM).normalize();
      }
      if (p.crop) V3.y = capeTop - (capeTop - V3.y) * p.crop;
      if (p.squeeze) {
        V3.x *= p.squeeze;
        V3.z *= p.squeeze;
      }
      // Skin weights (body meshes) or one rigid bone (props, primitives).
      let headW = p.head ? 1 : 0;
      if (p.remap && si && sw) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const weight = sw.getComponent(i, k);
          const bone = weight > 0 ? p.remap[si.getComponent(i, k)] : 0;
          skinIndex[o * 4 + k] = bone;
          skinWeight[o * 4 + k] = weight;
          sum += weight;
        }
        if (sum > 0) {
          for (let k = 0; k < 4; k++) {
            skinWeight[o * 4 + k] /= sum;
            if (skinIndex[o * 4 + k] === HEAD_BONE) headW += skinWeight[o * 4 + k];
          }
        }
      } else {
        skinIndex[o * 4] = p.bone;
        skinWeight[o * 4] = 1;
      }
      if (headW > 0) {
        const s = 1 + (HEAD_SCALE - 1) * Math.min(1, headW);
        V3.sub(PIVOT).multiplyScalar(s).add(PIVOT);
      }
      if (v.girth && headW < 0.5) {
        V3.x *= v.girth;
        V3.z *= v.girth;
      }
      position.set([V3.x, V3.y, V3.z], o * 3);
      normal.set([N3.x, N3.y, N3.z], o * 3);
      top = Math.max(top, V3.y);
      halfWidth = Math.max(halfWidth, Math.abs(V3.x));
      const tile = p.tile === -1 ? files.length : p.tile === -2 ? files.length + 1 : p.tile;
      const u = p.tile < 0 || !tex ? 0.5 : tex.getX(i);
      const w = p.flat ? 0.3 : p.tile === -2 || !tex ? 0.5 : tex.getY(i);
      uv.set([(tile + u) / tiles, w], o * 2);
      if (p.color) color.set([p.color.r, p.color.g, p.color.b], o * 3);
      // Team code: the whole part (capes, team primitives), or a cloth swatch painted team.
      let team = p.team;
      if (!team && p.tile === 0 && tex) {
        const k = swatchOf(tex.getX(i), tex.getY(i));
        const want = teamCode(v.paint?.[k]);
        if (want && cloth.has(k)) team = want;
      }
      teamA[o] = team;
    }
    const idx = p.geo.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = at + (idx ? idx.getX(i) : i);
      const b = at + (idx ? idx.getX(i + 1) : i + 1);
      const c = at + (idx ? idx.getX(i + 2) : i + 2);
      index.push(a, b, c);
      // A cape is one sheet: its back face is drawn too (the shell rules out a double-sided material).
      if (p.twoSided) index.push(a, c, b);
      else hull.push(a + verts, c + verts, b + verts);
    }
    at += pos.count;
  }

  // Painted ground occlusion: the lowest GROUND_AO_HEIGHT of the body darkens toward its feet.
  for (let o = 0; o < verts; o++) {
    const h = position[o * 3 + 1] / Math.max(0.1, top);
    const k = Math.min(1, Math.max(0, h / GROUND_AO_HEIGHT));
    const ao = 1 - GROUND_AO_DARK * (1 - k * k * (3 - 2 * k));
    color[o * 3] *= ao;
    color[o * 3 + 1] *= ao;
    color[o * 3 + 2] *= ao;
  }

  // The ink shell: every body vertex again, pushed out along a normal smoothed over coincident vertices.
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.BufferAttribute(position.subarray(0, verts * 3), 3));
  body.setAttribute("normal", new THREE.BufferAttribute(normal.subarray(0, verts * 3), 3));
  const smooth = smoothedNormals(body);
  position.copyWithin(verts * 3, 0, verts * 3);
  normal.copyWithin(verts * 3, 0, verts * 3);
  uv.copyWithin(verts * 2, 0, verts * 2);
  skinIndex.copyWithin(verts * 4, 0, verts * 4);
  skinWeight.copyWithin(verts * 4, 0, verts * 4);
  outlineNormal.set(smooth, verts * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("teamCode", new THREE.BufferAttribute(teamA, 1));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(outlineNormal, 3));
  geometry.setIndex([...index, ...hull]);
  geometry.userData.shared = true;
  registerInkGeometry(geometry, index.length);
  // Posed far from the rest pose every frame: a fixed, generous sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 3.2);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-3, -0.5, -3), new THREE.Vector3(3, 3.6, 3));
  const out: Baked = { geometry, top, halfWidth, bodyCount: index.length, vertices: verts, atlas: atlas(key, v) };
  baked.set(key, out);
  return out;
}

/** Drop every baked geometry and atlas (tests, hot reload). */
export function clearBakes(): void {
  for (const b of baked.values()) {
    b.geometry.dispose();
    b.ghost?.dispose();
  }
  for (const t of textures.values()) t.dispose();
  baked.clear();
  textures.clear();
}

// --------------------------------------------------------------- material

/**
 * A unit's own toon material over its variant's atlas (own instance for
 * the hit and status tints; every unit shares one compiled program).
 */
export function castMaterial(map: THREE.Texture, side: Side): THREE.MeshToonMaterial {
  castPalette(); // fill the team uniforms on first use
  const mat = new THREE.MeshToonMaterial({ map, color: 0xffffff, vertexColors: true });
  const team = TEAM_UNIFORMS[side];
  mat.onBeforeCompile = (sh) => {
    installInk(sh);
    sh.uniforms.uTeamMain = team.main;
    sh.uniforms.uTeamDark = team.dark;
    sh.uniforms.uRim = RIM_UNIFORM;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float teamCode;\nvarying float vTeam;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTeam = teamCode;")
      // The shell rides the bones too: skin its normal before pushing it out.
      .replace(
        "vec3 nView = normalize(normalMatrix * outlineNormal);",
        `#ifdef USE_SKINNING
           vec3 nView = normalize(normalMatrix * (skinMatrix * vec4(outlineNormal, 0.0)).xyz);
         #else
           vec3 nView = normalize(normalMatrix * outlineNormal);
         #endif`,
      )
      // The cast's line is CAST_INK_PX wide (the shared hull is written for OUTLINE_CSS_PX).
      .replace("* uInkPx * 2.0 / uInkViewport", `* uInkPx * ${((2 * CAST_INK_PX) / OUTLINE_CSS_PX).toFixed(4)} / uInkViewport`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTeamMain;\nuniform vec3 uTeamDark;\nuniform float uRim;\nvarying float vTeam;",
      )
      // Team cloth: the atlas holds a grey ramp there; tint it with the side's colour.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         if (vTeam > 0.5) {
           vec4 _tx = texture2D(map, vMapUv);
           float _sat = max(_tx.r, max(_tx.g, _tx.b)) - min(_tx.r, min(_tx.g, _tx.b));
           if (_sat < 0.06) {
             vec3 _base = vTeam > 1.5 ? uTeamDark : uTeamMain;
             float _t = clamp((_tx.g - 0.25) / 0.75, 0.0, 1.0);
             vec3 _c = mix(_base * 0.62, mix(_base, vec3(1.0), 0.1), _t);
             diffuseColor.rgb = _c * vec3(vColor);
           }
         }`,
      )
      // Statuses and hit flashes MIX toward their colour (magnitude = amount): never additive light.
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\nvec3 _tint = totalEmissiveRadiance;\ntotalEmissiveRadiance = vec3(0.0);",
      )
      // Three-band ramp at 0.62 / 0.86 / 1.0 with soft edges.
      .replace(
        "#include <gradientmap_pars_fragment>",
        `vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
           float x = dot( normal, lightDirection ) * 0.5 + 0.5;
           float k = 0.62 + 0.24 * smoothstep(0.40, 0.44, x) + 0.14 * smoothstep(0.68, 0.72, x);
           return vec3(k);
         }`,
      )
      .replace(
        "#include <dithering_fragment>",
        `${INK_FRAGMENT}
           float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
           _rim = smoothstep(0.62, 1.0, _rim) * 0.35 * uRim;
           gl_FragColor.rgb += _rim * vec3(0.749, 0.890, 1.0);
           float _k = max(_tint.r, max(_tint.g, _tint.b));
           if (_k > 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, _tint / _k, min(_k, 0.6));
         }
         #include <dithering_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "cast-v2";
  return mat;
}

/** The skinning space's half-extent used by the coverage tests (rig units). */
export function bakedSize(b: Baked, scale: number): { height: number; width: number } {
  return { height: b.top * scale, width: b.halfWidth * 2 * scale };
}

/** Render hook shared by every cast mesh: keep the ink width in step with the canvas. */
export const castBeforeRender = fitInk;

/** Team code helpers for tests. */
export const TEAM_CODE = { none: 0, main: 1, dark: 2 } as const;

/** For tests: the paint helper. */
export function paintTeamCode(p: Paint | undefined): number {
  return teamCode(p);
}
