import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CardId } from "../game/cards";
import { loadChampion, normalizeChampion, type ChampionDef } from "../game/customcard";
import type { Side } from "../game/arena";
import { applyTeam, teamPart } from "./teamColors";
import { INK_FRAGMENT, OUTLINE_MIN_RADIUS, installInk, outlineHull } from "./outlineMaterial";
import {
  ALBEDO_SATURATION,
  GROUND_AO,
  INK_DEPTH,
  INK_PX,
  RIM_COLOR,
  RIM_STRENGTH,
  RIM_UNIFORM,
  TINT_MAX,
  TOON_RAMP,
  TROOP_FLASH_MAX,
  rimGlsl,
  syncRim,
  toonRampGlsl,
} from "./look/material";
import { currentQuality } from "./quality";
import { ARABIC, THEME } from "./theme";
import { cameraZForView } from "./scene/common";
import { rigArchetype, type AttackStyle, type QuadGait, type Weight } from "./anim/archetypes";
import { BASE_CADENCE, hopScale, legPhase, stepSquash } from "./anim/gait";

/**
 * Chunky cel-shaded characters built from primitives — big heads,
 * stubby bodies, oversized weapons (toy-box style). No model files.
 * Every troop is a THREE.Group standing on y=0, facing +z.
 *
 * Rig conventions:
 * - `arm` is the weapon shoulder group, rotated on attack.
 * - `offArm` (optional) counter-sways while walking.
 * - `legs` are hip-pivot groups that swing alternately while walking.
 * - `wings` flap continuously for flyers.
 */

const SKIN = 0xf6c9a0;

/**
 * Shared painted light ramp (CR look): three soft bands that also carry
 * COLOUR — shadows fall toward a cool blue-violet, the lit side stays a
 * warm cream — instead of a grey multiply. The shader patch in
 * addRimLight() reads the ramp's RGB (stock three.js reads only red).
 */
let toonGradient: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (!toonGradient) {
    // A 64-texel ramp with two soft steps (cel bands with anti-aliased
    // edges): cool violet shade, a lavender half-tone, warm cream light.
    const N = 64;
    const data = new Uint8Array(N * 4);
    const shade = [92, 100, 158];
    const mid = [186, 186, 216];
    const light = [255, 249, 234];
    const sm = (e0: number, e1: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const a = sm(0.43, 0.53, u);
      const b = sm(0.66, 0.8, u);
      for (let k = 0; k < 3; k++) {
        const v = shade[k] + (mid[k] - shade[k]) * a;
        data[i * 4 + k] = Math.round(v + (light[k] - v) * b);
      }
      data[i * 4 + 3] = 255;
    }
    toonGradient = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
    toonGradient.minFilter = THREE.LinearFilter;
    toonGradient.magFilter = THREE.LinearFilter;
    toonGradient.colorSpace = THREE.NoColorSpace;
    toonGradient.userData.shared = true;
    toonGradient.needsUpdate = true;
  }
  return toonGradient;
}

/**
 * Shared hand-painted grain map (3d-texturing: a detail/AO-style
 * map gives flat toon surfaces tactile variation without breaking
 * the cel look). Near-white so it only gently darkens the base
 * color — soft paper speckle plus a faint diagonal cloth weave.
 */
let grainTexture: THREE.DataTexture | null = null;

function grainMap(): THREE.DataTexture {
  if (!grainTexture) {
    // Procedural (DataTexture, no DOM): bright base with a faint
    // diagonal weave + deterministic speckle, all in 0.86..1.0 so
    // it only gently darkens — punchy colors, tactile surface.
    const s = 64;
    const data = new Uint8Array(s * s * 4);
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffff) / 0xffff;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const weave = (x + y) % 4 === 0 ? 0.97 : 1; // diagonal threads (subtle)
        const speckle = 1 - rand() * 0.06;
        const v = Math.round(255 * weave * speckle);
        const i = (y * s + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    // Texel (0,0) is left pure white: baked rigs point the UVs of grainless
    // parts (skin, faces) at it, so one material serves both looks.
    data[0] = data[1] = data[2] = 255;
    grainTexture = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    grainTexture.wrapS = grainTexture.wrapT = THREE.RepeatWrapping;
    grainTexture.repeat.set(2, 2); // finer grain across each face
    grainTexture.minFilter = THREE.LinearMipmapLinearFilter;
    grainTexture.magFilter = THREE.LinearFilter;
    grainTexture.generateMipmaps = true;
    grainTexture.userData.shared = true; // disposeDeep must skip it
    // This is scalar surface variation, not authored display color.
    grainTexture.colorSpace = THREE.NoColorSpace;
    grainTexture.needsUpdate = true;
  }
  return grainTexture;
}

/**
 * The art bible's material language for baked rigs (creatures, buildings and
 * the procedural fallback cast), matching the KayKit cast's (cast/bake.ts):
 * - a three-band toon ramp at 0.62 / 0.86 / 1.0 with soft 0.04 edges;
 * - a cool rim (#BFE3FF at 0.35), off at the quality levels without rim light;
 * - painted ground occlusion: the lowest 18% of the unit darkens by up to 15%;
 * - silhouette-only ink at 1.6 CSS px: the shell sits behind the body along
 *   the view, so only the outline survives (no fins, no crease lines);
 * - status and hit tints MIX toward their colour, never add light, so a
 *   flash can never cross the bloom threshold.
 * Each wave-1 package holds these constants locally; ship unifies them.
 */
export const RIG_RAMP = TOON_RAMP;
export const RIG_RIM = { color: RIM_COLOR, strength: RIM_STRENGTH } as const;
export const RIG_INK_PX = INK_PX;
/** World units the ink shell sits behind the body (silhouette-only ink). */
export const RIG_INK_DEPTH = INK_DEPTH;
export const RIG_AO = GROUND_AO;
/** Albedo saturation multiplier applied when a rig is baked. */
export const RIG_SATURATION = ALBEDO_SATURATION;
/** The most a status tint (freeze, rage, slow) may pull a pixel toward its colour. */
export const RIG_TINT_MAX = TINT_MAX;
/** The most a hit flash (a near-white tint) may: art bible 6, 0.35 on troops. */
export const RIG_FLASH_MAX = TROOP_FLASH_MAX;
/** Rim on (1) or off (0): the SAME uniform object as the cast's (look/material.ts RIM_UNIFORM). */
export const RIG_RIM_UNIFORM = RIM_UNIFORM;

/** Keep the shared rim switch in step with the live quality level (called per animated rig). */
function syncRigRim(): void {
  syncRim(currentQuality());
}

/** The vertex and fragment changes that give a baked rig material the art bible's language. */
function installRigLanguage(sh: THREE.WebGLProgramParametersWithUniforms): void {
  sh.uniforms.uRigRim = RIG_RIM_UNIFORM;
  if (!sh.uniforms.uAoTop) sh.uniforms.uAoTop = { value: 0.55 };
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\n varying float vGroundY;")
    .replace("#include <fog_vertex>", "vGroundY = (modelMatrix * vec4(transformed, 1.0)).y;\n #include <fog_vertex>")
    // Silhouette-only ink: push the shell back along the view before widening it.
    .replace(
      "vec3 nView = normalize(normalMatrix * outlineNormal);",
      `vec3 _back = projectionMatrix[3][3] > 0.5 ? vec3(0.0, 0.0, -${RIG_INK_DEPTH.toFixed(3)}) : normalize(mvPosition.xyz) * ${RIG_INK_DEPTH.toFixed(3)};
           gl_Position = projectionMatrix * vec4(mvPosition.xyz + _back, 1.0);
           vec3 nView = normalize(normalMatrix * outlineNormal);`,
    );
  // The line is RIG_INK_PX wide: the shared ink's own width (INK_PX), no rescale.
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\n varying float vGroundY;\n uniform float uRigRim;\n uniform float uAoTop;")
    .replace("#include <gradientmap_pars_fragment>", toonRampGlsl())
    .replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n vec3 _tint = totalEmissiveRadiance;\n totalEmissiveRadiance = vec3(0.0);",
    )
    .replace(
      "#include <dithering_fragment>",
      `${INK_FRAGMENT}
         gl_FragColor.rgb *= 1.0 - ${RIG_AO.dark.toFixed(2)} * (1.0 - smoothstep(0.0, uAoTop, vGroundY));
         ${rimGlsl("uRigRim")}
         float _k = max(_tint.r, max(_tint.g, _tint.b));
         // A white or warm-white tint is a hit flash: art bible 6 caps it at RIG_FLASH_MAX.
         float _cap = min(_tint.r, min(_tint.g, _tint.b)) >= 0.6 * _k ? ${RIG_FLASH_MAX.toFixed(2)} : ${RIG_TINT_MAX.toFixed(2)};
         if (_k > 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, _tint / _k, min(_k, _cap));
       }
       #include <dithering_fragment>`,
    );
}

/**
 * Inject a cool Fresnel rim-light into a lit material's fragment shader —
 * a bright edge where the surface turns away from the camera. This single
 * touch makes every rounded shape read as 3D and gives the whole roster a
 * premium "lit figurine" pop. Shared source ⇒ Three reuses one program.
 */
function addRimLight(
  mat: THREE.Material,
  cacheKey = "premium-toon-rim-v2",
  ink = false,
  dark: THREE.Color | null = null,
): void {
  mat.onBeforeCompile = (sh) => {
    if (ink) installInk(sh);
    if (ink && mat.userData.aoTop) sh.uniforms.uAoTop = mat.userData.aoTop;
    if (dark) {
      // A second team shade rides in a vertex attribute (see teamToon).
      sh.uniforms.uDark = { value: dark };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n attribute float aDark;\n varying float vDark;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n vDark = aDark;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n uniform vec3 uDark;\n varying float vDark;")
        .replace("#include <map_fragment>", "diffuseColor.rgb = mix(diffuse, uDark, vDark);\n #include <map_fragment>");
    }
    if (ink) {
      // Baked rigs speak the cast's material language (see installRigLanguage).
      installRigLanguage(sh);
      return;
    }
    // Coloured light ramp: sample the gradient's RGB, not just red.
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <gradientmap_pars_fragment>",
      `#ifdef USE_GRADIENTMAP
         uniform sampler2D gradientMap;
       #endif
       vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
         float dotNL = dot( normal, lightDirection );
         vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
         #ifdef USE_GRADIENTMAP
           return texture2D( gradientMap, coord ).rgb;
         #else
           return vec3( 1.0 );
         #endif
       }`,
    );
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `{
         float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
         _rim = smoothstep(0.72, 1.0, _rim) * 0.26;
         gl_FragColor.rgb += _rim * vec3(0.42, 0.56, 0.80);
       }
       #include <dithering_fragment>`,
    );
  };
  // Explicit key lets Three share this one shader variant across the roster.
  mat.customProgramCacheKey = () => cacheKey;
}

export function toon(color: number): THREE.MeshToonMaterial {
  // Punch up saturation for bold, candy-cartoon colors (CR look).
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l);
  const mat = new THREE.MeshToonMaterial({
    color: c,
    gradientMap: gradientMap(),
    map: grainMap(),
  });
  addRimLight(mat);
  return mat;
}

/**
 * UV that samples the grain map's pure-white texel (see grainMap): the
 * texture repeats 2x, so the centre of texel (0,0) sits at 0.5 / 64 / 2.
 */
export const GRAINLESS_UV = 0.25 / 64;

/** The unit the baked-rig material shares across every unit of a rig. */
let bakedBase: THREE.MeshToonMaterial | null = null;

/**
 * The material baked rigs draw with: vertex colours carry each part's
 * colour, the gradient ramp, grain map and rim light are the ones toon()
 * parts use. One shared instance; every unit takes a clone (unitBakedToon).
 */
export function bakedToon(): THREE.MeshToonMaterial {
  if (!bakedBase) {
    bakedBase = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: gradientMap(),
      map: grainMap(),
    });
    addRimLight(bakedBase, "baked", true);
    bakedBase.userData.shared = true;
    bakedBase.userData.baked = true;
  }
  return bakedBase;
}

/**
 * A unit's own copy of the baked material: its emissive carries the flash,
 * rage and freeze glows, so it can never be shared between units.
 */
export function unitBakedToon(aoTop = 0.55): THREE.MeshToonMaterial {
  const mat = bakedToon().clone();
  // The ground-occlusion band (world units): the lowest RIG_AO.share of this unit.
  mat.userData.aoTop = { value: aoTop };
  addRimLight(mat, "baked", true); // clone() drops shader hooks
  mat.userData.shared = false;
  mat.userData.baked = true;
  return mat;
}

/**
 * The material of a baked node's merged team mesh. Its colour is the team's
 * main shade (applyTeam sets it); parts of the dark shade carry aDark = 1 and
 * take userData.teamDark instead, so one mesh holds both shades and still
 * repaints with the palette. It can also host the node's ink triangles when
 * the node has no body mesh (see installInk).
 */
export function teamToon(): THREE.MeshToonMaterial {
  const mat = toon(0xffffff);
  const dark = new THREE.Color(0xffffff);
  mat.userData.teamDark = dark;
  addRimLight(mat, "team-ink", true, dark);
  return mat;
}

/** Give any toon material the painted colour ramp + rim light. */
export function paintedToon(mat: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
  mat.gradientMap = gradientMap();
  addRimLight(mat);
  return mat;
}

/**
 * Unlit "glow" material: MeshBasic ignores lighting and tone-mapping
 * mutes emissives far less, so gems, orbs, and robot eyes stay hot.
 */
function glow(color: number, _intensity = 1.6): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: underBloom(color) });
  mat.toneMapped = false; // full saturation, no filmic rolloff
  return mat;
}

/** The brightest linear luminance a rig's glow part may have (art bible 5: under the 0.9 bloom threshold). */
export const RIG_GLOW_MAX = 0.8;

/** `hex` scaled down, if need be, so its linear luminance stays at or under RIG_GLOW_MAX. */
export function underBloom(hex: number): THREE.Color {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum > RIG_GLOW_MAX) c.multiplyScalar(RIG_GLOW_MAX / lum);
  return c;
}

type Ctx3 = THREE.Object3D;

function shadowed<T extends THREE.Mesh>(m: T, x: number, y: number, z: number): T {
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Shared geometry cache (three-best-practices: memory-reuse-objects).
 * Primitive dimensions repeat constantly across rigs; every identical
 * primitive shares one BufferGeometry, marked so disposal skips it.
 */
const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geo.userData.shared = true;
    geoCache.set(key, geo);
  }
  return geo;
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  // Vinyl-toy finish: every "box" is softly rounded, never hard-edged.
  const geo = cachedGeo(`b:${w}:${h}:${d}`, () => {
    const bevel = Math.min(w, h, d) * 0.28;
    return new RoundedBoxGeometry(w, h, d, 2, bevel);
  });
  return shadowed(new THREE.Mesh(geo, toon(color)), x, y, z);
}

function sphere(r: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  // Detail scales with size: eyes and studs don't need 24 segments.
  const geo = cachedGeo(`s:${r}`, () =>
    r < 0.06 ? new THREE.SphereGeometry(r, 10, 8) : r < 0.14 ? new THREE.SphereGeometry(r, 16, 12) : new THREE.SphereGeometry(r, 24, 18),
  );
  return shadowed(new THREE.Mesh(geo, toon(color)), x, y, z);
}

function cyl(
  rt: number,
  rb: number,
  h: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const geo = cachedGeo(
    `c:${rt}:${rb}:${h}`,
    () => new THREE.CylinderGeometry(rt, rb, h, Math.max(rt, rb) < 0.06 ? 10 : Math.max(rt, rb) < 0.14 ? 16 : 24),
  );
  return shadowed(new THREE.Mesh(geo, toon(color)), x, y, z);
}

function cone(r: number, h: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const geo = cachedGeo(`k:${r}:${h}`, () => new THREE.ConeGeometry(r, h, 16));
  return shadowed(new THREE.Mesh(geo, toon(color)), x, y, z);
}

/** How a face reads: drives brow angle and mouth shape. */
export type Mood = "brave" | "angry" | "cute" | "wicked" | "calm";

/** Brow tilt (radians, inward) per mood. */
const BROW_TILT: Record<Mood, number> = {
  brave: 0.3,
  angry: 0.55,
  wicked: 0.7,
  calm: 0.08,
  cute: -0.18, // raised, innocent
};

/** Face options: `eyeScale` sizes the eyes (1.25 humanoids, 1 skeletons/robots). */
export interface EyeOpts {
  eyeScale?: number;
}

/** Eye size for humanoid faces: big toy eyes read at phone size. */
export const HUMANOID_EYE_SCALE = 1.25;

/**
 * Expressive face: white-sclera eyes with pupils, mood-angled brows,
 * and a simple mouth (smile for cute, line otherwise). Eye, pupil, brow
 * and mouth stay separate named meshes: the face animation (blinks,
 * squints, KO X-eyes) drives them individually.
 */
function addEyes(
  head: Ctx3,
  r: number,
  spread = 0.38,
  up = 0.1,
  mood: Mood = "brave",
  opts: EyeOpts = {},
): void {
  const k = opts.eyeScale ?? HUMANOID_EYE_SCALE;
  // Radii grow with k; the depths keep each layer's front just ahead of
  // the one behind it (rim < sclera < pupil), so nothing z-fights.
  const rimR = r * round3(0.2 * k);
  const eyeR = r * round3(0.17 * k);
  const pupilR = r * round3(0.09 * k);
  for (const s of [-1, 1]) {
    // Dark rim so white sclera reads even on pale heads.
    const rim = sphere(rimR, 0x2b2333, s * r * spread, r * up, r * 0.78);
    rim.name = "eyerim";
    head.add(rim);
    const eye = sphere(eyeR, 0xffffff, s * r * spread, r * up, r * (0.78 + 0.04 * k));
    eye.name = "eye";
    head.add(eye);
    const pupil = sphere(pupilR, 0x1f2430, s * r * spread, r * up, r * (0.78 + 0.17 * k));
    pupil.name = "pupil";
    head.add(pupil);
    const browUp = up + 0.27 + 0.17 * (k - 1);
    const brow = box(r * 0.3, r * 0.07, r * 0.07, 0x2b2118, s * r * spread, r * browUp, r * 0.86);
    brow.name = "brow";
    brow.rotation.z = -s * BROW_TILT[mood];
    head.add(brow);
  }
  if (mood === "cute") {
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.16, r * 0.035, 6, 10, Math.PI),
      toon(0x1f2430),
    );
    smile.name = "mouth";
    smile.position.set(0, r * (up - 0.32), r * 0.88);
    smile.rotation.z = Math.PI;
    head.add(smile);
  } else {
    const w = mood === "calm" ? 0.26 : 0.2;
    const mouth = box(r * w, r * 0.06, r * 0.05, 0x1f2430, 0, r * (up - 0.34), r * 0.92);
    mouth.name = "mouth";
    if (mood === "angry" || mood === "wicked") mouth.rotation.z = 0.12;
    head.add(mouth);
  }
}

/** Stable geometry-cache keys for scaled face radii. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Hip-pivot leg: group at the hip, limb hanging below. */
function makeLeg(
  color: number,
  x: number,
  hipY: number,
  w: number,
  z = 0,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, hipY, z);
  g.add(box(w, hipY, w, color, 0, -hipY / 2, 0));
  return g;
}

export interface Wing {
  obj: THREE.Object3D;
  base: number;
  amp: number;
}

export interface TroopRig {
  group: THREE.Group;
  arm: THREE.Group | null;
  armRest: number;
  swingAmp: number;
  height: number;
  hover?: number;
  wings?: Wing[];
  legs?: THREE.Group[];
  offArm?: THREE.Group;
  /** Per-character idle quirk, driven every frame with (time, phase). */
  extras?: (t: number, phase: number) => void;
}

/**
 * A wrapped turban for the Arabic theme — layered cloth folds, a jewelled
 * front band, and a small peak. Centred on the head; the caller positions it.
 * `team` dyes the cloth in the unit's team colour (the Islamic edition's
 * most readable team cue: the top of the head faces the camera).
 */
function turban(r: number, cloth: number, gem = 0xe8c45f, team = false): THREE.Group {
  const g = new THREE.Group();
  const wrap = sphere(r * 1.14, cloth, 0, r * 0.5, 0);
  wrap.scale.set(1, 0.72, 1);
  g.add(team ? teamPart(wrap) : wrap);
  const fold = sphere(r * 1.04, cloth, 0, r * 0.28, 0.04);
  fold.scale.set(1.06, 0.5, 1.06);
  g.add(team ? teamPart(fold, "dark") : fold);
  const band = box(r * 0.5, r * 0.16, r * 0.06, gem, 0, r * 0.46, r * 1.0);
  g.add(band);
  g.add(sphere(r * 0.12, gem, 0, r * 0.46, r * 1.06)); // front jewel
  const peak = cone(r * 0.16, r * 0.3, cloth, 0, r * 1.02, 0);
  g.add(team ? teamPart(peak) : peak); // top peak
  return g;
}

/** A curved scimitar: gold hilt + crossguard and a swept steel blade. */
function scimitar(): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.05, 0.2, 0x6d4c41, 0, -0.1, 0)); // grip
  g.add(box(0.22, 0.05, 0.09, 0xf2c14e, 0, 0.0, 0)); // crossguard
  g.add(sphere(0.05, 0xf2c14e, 0, -0.21, 0)); // pommel
  const blade = new THREE.Mesh(
    cachedGeo("scimitar-blade", () => new THREE.TorusGeometry(0.46, 0.045, 6, 18, Math.PI * 0.82)),
    toon(0xdde4ec),
  );
  blade.scale.set(1, 1, 0.42); // flatten the ring into a blade
  blade.position.set(-0.36, 0.08, 0);
  blade.rotation.z = -0.5;
  blade.castShadow = true;
  g.add(blade);
  return g;
}

/** A gold diamond stud (heraldic, no cross). */
function diamond(r: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const geo = cachedGeo(`oct:${r}`, () => new THREE.OctahedronGeometry(r));
  return shadowed(new THREE.Mesh(geo, toon(color)), x, y, z);
}

function buildKnight(): TroopRig {
  const g = new THREE.Group();
  // Steel tunic, not blue: the team colour lives on tabard, cape and shield.
  const TUNIC = 0x7a8797, TUNICDK = 0x5b6675, STEEL = 0xb9c4d2, GOLD = 0xf2c14e, LEATHER = 0x5a3a1c;
  const legs = [makeLeg(TUNICDK, -0.16, 0.32, 0.18), makeLeg(TUNICDK, 0.16, 0.32, 0.18)];
  for (const leg of legs) leg.add(sphere(0.1, GOLD, 0, -0.18, 0.12)); // knee rivet
  g.add(...legs);

  // Layered torso: tunic, breastplate, chainmail collar, belt, tabard, emblem.
  g.add(cyl(0.3, 0.36, 0.5, TUNIC, 0, 0.56, 0));
  g.add(box(0.56, 0.48, 0.42, STEEL, 0, 0.66, 0));
  g.add(cyl(0.28, 0.28, 0.12, 0x9aa6b5, 0, 0.92, 0));
  g.add(cyl(0.37, 0.37, 0.09, LEATHER, 0, 0.34, 0));
  g.add(box(0.13, 0.13, 0.06, GOLD, 0, 0.34, 0.28)); // buckle
  g.add(teamPart(box(0.24, 0.46, 0.04, TUNICDK, 0, 0.52, 0.25))); // tabard
  g.add(diamond(0.1, GOLD, 0, 0.7, 0.27)); // chest emblem
  for (const sx of [-1, 1]) {
    g.add(sphere(0.18, STEEL, sx * 0.38, 0.82, 0)); // pauldron
    g.add(sphere(0.055, GOLD, sx * 0.38, 0.92, 0.1)); // rivet
  }

  // Bigger head + face + helmet (CR chunky toy proportions).
  const head = sphere(0.44, SKIN, 0, 1.22, 0);
  addEyes(head, 0.44, 0.3, 0.08, "brave");
  // Hero cue: oversized blonde handlebar moustache (CR knight read).
  const stache = box(0.38, 0.09, 0.08, 0xd9b34a, 0, -0.14, 0.4);
  stache.name = "mustache";
  head.add(stache);
  for (const s of [-1, 1]) {
    const tip = sphere(0.07, 0xd9b34a, s * 0.2, -0.16, 0.42);
    tip.name = "mustache";
    tip.scale.set(1.1, 0.7, 0.8);
    head.add(tip);
  }
  g.add(head);
  if (ARABIC) {
    const t = turban(0.44, 0x2e6f6b);
    t.position.y = 1.22;
    g.add(t);
  } else {
    // Chainmail coif shell framing the face (not a closed helm).
    const coif = sphere(0.46, 0x9aa6b5, 0, 1.28, -0.04);
    coif.name = "coif";
    coif.scale.set(1.05, 0.85, 1.0);
    g.add(coif);
    g.add(cyl(0.47, 0.47, 0.1, STEEL, 0, 1.42, 0)); // coif rim
    g.add(box(0.1, 0.22, 0.08, STEEL, 0, 1.12, 0.4)); // nose guard
    // Fore-aft blade crest: thin from the front, a bold red comb from the
    // side and back — nothing like the Valkyrie's lateral gold wings.
    const crest = box(0.1, 0.34, 0.68, GOLD, 0, 1.78, -0.08);
    crest.rotation.x = -0.1;
    g.add(crest);
    g.add(box(0.06, 0.12, 0.72, 0xfff2c8, 0, 1.98, -0.1)); // bright crest spine
  }
  const cape = teamPart(box(0.5, 0.7, 0.05, 0x1c2f66, 0, 0.62, -0.28), "dark");
  cape.rotation.x = 0.08;
  g.add(cape);

  // Shield arm: a gold-bordered kite shield with a boss + emblem.
  const offArm = new THREE.Group();
  offArm.position.set(-0.42, 0.82, 0);
  offArm.add(box(0.14, 0.32, 0.14, TUNIC, 0, -0.16, 0));
  offArm.add(sphere(0.11, STEEL, 0, -0.32, 0.02)); // gauntlet
  offArm.add(box(0.54, 0.72, 0.05, GOLD, -0.16, -0.3, 0.16)); // border
  offArm.add(teamPart(box(0.44, 0.62, 0.07, TUNICDK, -0.16, -0.3, 0.18))); // face
  offArm.add(sphere(0.09, STEEL, -0.16, -0.22, 0.24)); // boss
  offArm.add(cone(0.08, 0.2, GOLD, -0.16, -0.44, 0.24)); // emblem
  g.add(offArm);

  // Sword arm: gauntlet, crossguard, fullered blade, gold pommel.
  const arm = new THREE.Group();
  arm.position.set(0.42, 0.84, 0);
  arm.add(box(0.15, 0.32, 0.15, TUNIC, 0, -0.16, 0));
  arm.add(sphere(0.12, STEEL, 0, -0.33, 0.02)); // gauntlet
  if (ARABIC) {
    const s = scimitar();
    s.position.set(0, -0.34, 0.02);
    arm.add(s);
  } else {
    arm.add(box(0.28, 0.07, 0.1, GOLD, 0, -0.3, 0.02)); // crossguard
    arm.add(box(0.08, 0.82, 0.14, 0xe7ecf3, 0, 0.13, 0.02)); // blade
    arm.add(sphere(0.06, GOLD, 0, -0.44, 0.02)); // pommel
  }
  g.add(arm);

  return { group: g, arm, armRest: -0.5, swingAmp: 1.7, height: 1.6, legs, offArm };
}

function buildArcher(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x254d28, -0.11, 0.26, 0.13), makeLeg(0x254d28, 0.11, 0.26, 0.13)];
  g.add(...legs);
  // Sleeveless green tunic (CR archer silhouette).
  g.add(cyl(0.22, 0.28, 0.42, 0x2e7d32, 0, 0.48, 0));
  g.add(teamPart(cyl(0.29, 0.29, 0.07, 0x6d4c41, 0, 0.3, 0))); // belt
  for (const s of [-1, 1]) g.add(box(0.08, 0.14, 0.1, 0x6d4c41, s * 0.18, 0.7, 0.1)); // bracers cue
  const head = sphere(0.32, SKIN, 0, 0.96, 0);
  addEyes(head, 0.32, 0.36, 0.1, "cute");
  g.add(head);
  if (ARABIC) {
    const t = turban(0.32, 0x9c3848, undefined, true);
    t.position.y = 0.96;
    g.add(t);
  } else {
    // Magenta bob: blunt fringe + side braid (CR signature hair).
    const hair = sphere(0.34, 0xec5fa3, 0, 1.04, -0.02);
    hair.name = "pink-hair";
    hair.scale.set(1, 0.7, 1);
    g.add(hair);
    const fringe = box(0.42, 0.1, 0.08, 0xec5fa3, 0, 1.12, 0.28);
    fringe.name = "fringe";
    g.add(fringe);
    const braid = cyl(0.07, 0.045, 0.42, 0xec5fa3, 0.26, 0.78, -0.06);
    braid.name = "braid";
    braid.rotation.z = 0.35;
    g.add(braid);
  }
  // Quiver on the back.
  const quiver = teamPart(cyl(0.07, 0.07, 0.34, 0x6d4c41, -0.12, 0.62, -0.2));
  quiver.rotation.z = 0.35;
  g.add(quiver);
  g.add(cone(0.05, 0.1, 0xf5f2ea, -0.18, 0.84, -0.2)); // white fletching
  g.add(cone(0.05, 0.1, 0xf5f2ea, -0.08, 0.86, -0.2));

  const offArm = new THREE.Group();
  offArm.position.set(0.3, 0.62, 0);
  offArm.add(box(0.11, 0.26, 0.11, SKIN, 0, -0.13, 0));
  g.add(offArm);

  // Bow arm, held out front — the whole group thrusts on release.
  const arm = new THREE.Group();
  arm.position.set(-0.3, 0.66, 0.05);
  arm.rotation.y = -0.55; // yawed outboard so the bow clears her face
  arm.add(box(0.11, 0.26, 0.11, SKIN, 0, -0.13, 0));
  // Bow held low and forward so it never crosses her face at rest.
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.035, 8, 16, Math.PI),
    toon(0x8d6e63),
  );
  teamPart(bow, "dark");
  bow.castShadow = true;
  bow.position.set(0, -0.36, 0.22);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.015, 0.66, 0.015, 0xe8e3d8, 0, -0.36, 0.22)); // string
  // Nocked arrow so the shot reads clearly.
  const nocked = new THREE.Group();
  nocked.position.set(0, -0.36, 0.24);
  const shaft = cyl(0.018, 0.018, 0.5, 0xd7ccc8, 0, 0, 0);
  shaft.rotation.x = Math.PI / 2;
  nocked.add(shaft);
  const tip = cone(0.04, 0.1, 0x9aa3ad, 0, 0, 0.28);
  tip.rotation.x = Math.PI / 2;
  nocked.add(tip);
  arm.add(nocked);
  g.add(arm);
  return { group: g, arm, armRest: -0.9, swingAmp: 0.7, height: 1.25, legs, offArm };
}

function buildPrincess(): TroopRig {
  // A regal archer: long cream-and-rose gown, golden crown, and a
  // golden longbow that looses a flaming arrow.
  const GOWN = 0xf6e7ef, GOWNDK = 0xe39ec4, GOLD = 0xf2c14e, HAIR = 0xffe082;
  const g = new THREE.Group();
  g.add(cyl(0.18, 0.46, 0.9, GOWN, 0, 0.46, 0)); // flowing gown
  g.add(teamPart(cyl(0.46, 0.48, 0.1, GOWNDK, 0, 0.05, 0), "dark")); // hem
  g.add(cyl(0.27, 0.3, 0.36, GOWNDK, 0, 0.78, 0)); // rose bodice
  g.add(teamPart(cyl(0.3, 0.3, 0.06, GOLD, 0, 0.62, 0))); // belt
  const head = sphere(0.27, SKIN, 0, 1.12, 0);
  addEyes(head, 0.27, 0.36, 0.1, "calm");
  g.add(head);
  // Long blonde hair flowing down her back.
  const hair = sphere(0.29, HAIR, 0, 1.18, -0.04);
  hair.scale.set(1, 0.7, 1);
  g.add(hair);
  const braid = cyl(0.09, 0.05, 0.6, HAIR, 0, 0.92, -0.2);
  g.add(braid);
  if (ARABIC) {
    const t = turban(0.27, 0xc2185b, GOLD);
    t.position.y = 1.12;
    g.add(t);
  } else {
    // Golden three-point crown.
    g.add(cyl(0.28, 0.3, 0.1, GOLD, 0, 1.34, 0));
    for (const dx of [-0.18, 0, 0.18]) g.add(cone(0.05, 0.16, GOLD, dx, 1.46, 0));
    g.add(sphere(0.05, 0xff4081, 0, 1.4, 0.26)); // pink gem
  }

  const offArm = new THREE.Group();
  offArm.position.set(0.3, 0.78, 0);
  offArm.add(box(0.1, 0.26, 0.1, SKIN, 0, -0.13, 0));
  g.add(offArm);

  // Bow arm with a golden longbow and a glowing flaming arrow.
  const arm = new THREE.Group();
  arm.position.set(-0.3, 0.82, 0.05);
  arm.rotation.y = -0.55; // yawed outboard so the bow clears her face
  arm.add(box(0.1, 0.26, 0.1, SKIN, 0, -0.13, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.035, 8, 16, Math.PI),
    toon(GOLD),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.36, 0.24);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.015, 0.78, 0.015, 0xfff3c4, 0, -0.36, 0.24)); // string
  const nocked = new THREE.Group();
  nocked.position.set(0, -0.36, 0.26);
  const shaft = cyl(0.018, 0.018, 0.55, 0x6d4c41, 0, 0, 0);
  shaft.rotation.x = Math.PI / 2;
  nocked.add(shaft);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(0xff9a3c, 2));
  flame.position.set(0, 0, 0.32);
  nocked.add(flame);
  arm.add(nocked);
  g.add(arm);
  const flicker = (t: number, phase: number) => {
    flame.scale.setScalar(1 + Math.sin(t * 13 + phase) * 0.2);
  };
  return { group: g, arm, armRest: -0.9, swingAmp: 0.7, height: 1.35, offArm, extras: flicker };
}

function buildGiant(): TroopRig {
  const g = new THREE.Group();
  const legs = [
    makeLeg(0x7a5230, -0.3, 0.34, 0.3),
    makeLeg(0x7a5230, 0.3, 0.34, 0.3),
  ];
  g.add(...legs);
  // The belly IS the character: a barrel wider than the head is tall,
  // with a small head perched on top and heavy slouched shoulders.
  // Muted tan leather: the old saturated tan lit up as the cb enemy orange.
  const belly = sphere(0.74, 0xb08a62, 0, 0.98, 0);
  belly.scale.set(1, 0.92, 0.85);
  g.add(belly);
  g.add(box(0.38, 0.3, 0.06, 0x8a6d4a, 0.24, 0.9, 0.58)); // patch
  g.add(teamPart(cyl(0.74, 0.74, 0.13, 0x7a5230, 0, 0.5, 0))); // belt
  g.add(sphere(0.12, 0xf2c14e, 0, 0.5, 0.71)); // buckle
  g.add(teamPart(cyl(0.58, 0.7, 0.36, 0x8a5a35, 0, 0.36, 0), "dark")); // loincloth skirt
  const head = sphere(0.38, SKIN, 0, 1.86, 0);
  addEyes(head, 0.38, 0.34, 0.18, "calm");
  g.add(head);
  const beard = sphere(0.37, 0x6b4a32, 0, 1.7, 0.13);
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  g.add(box(0.46, 0.07, 0.06, 0x5d3d22, 0, 2.04, 0.32)); // heavy brow
  g.add(sphere(0.09, SKIN, 0, 1.88, 0.38)); // nose
  if (ARABIC) {
    const t = turban(0.38, 0x9c5a2a, 0xf2c14e);
    t.position.y = 1.92;
    g.add(t);
  }

  // Slouched shoulders: arms hang low and forward off the barrel,
  // ending in fists nearly as big as the head.
  const offArm = new THREE.Group();
  offArm.position.set(-0.76, 1.34, 0.08);
  offArm.add(box(0.26, 0.56, 0.26, SKIN, 0, -0.32, 0));
  offArm.add(cyl(0.18, 0.18, 0.12, 0xf2c14e, 0, -0.56, 0)); // gold wristband
  offArm.add(sphere(0.27, SKIN, 0, -0.72, 0));
  offArm.rotation.x = -0.24;
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.76, 1.34, 0.08);
  arm.add(box(0.26, 0.56, 0.26, SKIN, 0, -0.32, 0));
  arm.add(cyl(0.19, 0.19, 0.12, 0xf2c14e, 0, -0.58, 0)); // gold wristband
  arm.add(sphere(0.29, SKIN, 0, -0.74, 0));
  g.add(arm);
  return { group: g, arm, armRest: -0.35, swingAmp: 1.4, height: 2.25, legs, offArm };
}

/**
 * Islamic mode's Giant: a caparisoned WAR ELEPHANT carrying a turbaned rider
 * (mahout) in a domed howdah. Same role/stats as the Giant — a slow, towering
 * tank that walks past troops to smash the tower — but a wholly new silhouette.
 * The rider's spear is the rig's attack arm; the trunk and ears sway in idle.
 */
/**
 * Muted brick for the Islamic rigs' large untagged cloth. THEME.terracotta
 * leaves toon() as a saturated orange (#bf5000) that reads as the
 * colour-blind palette's enemy orange; brick stays a warm earth tone
 * without claiming a team hue in either palette.
 */
const BRICK = 0x9a5a44, BRICK_DK = 0x5e3426;

/** The war elephant's body scale inside its rig (see buildWarElephant). */
export const ELEPHANT_SCALE = 0.72;

function buildWarElephant(): TroopRig {
  // Built at full size inside a body group scaled ELEPHANT_SCALE, so the
  // field's giant scale lands the head-top in the art bible's large band
  // (3.3-3.8) and the body stays about two tiles wide.
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(ELEPHANT_SCALE);
  root.add(g);
  const GRAY = 0x8d8f96, GRAYDK = 0x6d6f77, IVORY = 0xf1e7cf;
  // Art bible 7: the ONE team slot is the saddle cloth (the caparison); the
  // howdah, canopy and medallion keep the edition's emerald, turquoise and gold.
  const GOLD = THEME.goldLight, CLOTH = THEME.emerald, CLOTH2 = THEME.turquoise;

  // Four heavy pillar legs (front pair, back pair) for a quadruped gait.
  const legs = [
    makeLeg(GRAYDK, -0.42, 0.78, 0.34, 0.5),
    makeLeg(GRAYDK, 0.42, 0.78, 0.34, 0.5),
    makeLeg(GRAYDK, -0.42, 0.78, 0.34, -0.55),
    makeLeg(GRAYDK, 0.42, 0.78, 0.34, -0.55),
  ];
  g.add(...legs);

  // Barrel body.
  const body = sphere(0.82, GRAY, 0, 1.28, -0.05);
  body.scale.set(0.84, 0.95, 1.55);
  g.add(body);
  const rump = sphere(0.66, GRAY, 0, 1.28, -0.9);
  rump.scale.set(0.86, 1, 1);
  g.add(rump);
  const tail = cyl(0.05, 0.04, 0.5, GRAYDK, 0, 1.05, -1.5);
  tail.rotation.x = 0.35;
  g.add(tail);

  // Head + flapping ears at the front.
  const head = sphere(0.52, GRAY, 0, 1.42, 1.0);
  head.scale.set(1, 1.02, 0.95);
  g.add(head);
  g.add(box(0.5, 0.07, 0.06, 0x55575e, 0, 1.78, 1.28)); // brow ridge
  for (const s of [-1, 1]) {
    g.add(sphere(0.07, 0x1f2430, s * 0.22, 1.5, 1.36)); // small eye
    const ear = new THREE.Group();
    ear.name = "ear";
    ear.position.set(s * 0.44, 1.55, 0.85);
    const flap = sphere(0.36, GRAYDK, s * 0.14, 0, 0);
    flap.scale.set(0.28, 1.05, 1.1);
    ear.add(flap);
    g.add(ear);
  }

  // Curved downward trunk (a pivoted group so it can sway in idle).
  const trunk = new THREE.Group();
  trunk.position.set(0, 1.42, 1.32);
  const t1 = cyl(0.16, 0.13, 0.46, GRAY, 0, -0.2, 0.06);
  t1.name = "trunk"; t1.rotation.x = 0.5;
  trunk.add(t1);
  const t2 = cyl(0.13, 0.1, 0.42, GRAY, 0, -0.56, 0.2);
  t2.name = "trunk"; t2.rotation.x = 0.9;
  trunk.add(t2);
  const t3 = cyl(0.1, 0.07, 0.34, GRAYDK, 0, -0.82, 0.42);
  t3.name = "trunk"; t3.rotation.x = 1.25;
  trunk.add(t3);
  g.add(trunk);

  // Tusks: ivory cones sweeping forward.
  for (const s of [-1, 1]) {
    const tusk = cone(0.07, 0.6, IVORY, s * 0.24, 1.18, 1.34);
    tusk.name = "tusk";
    tusk.rotation.set(1.15, 0, -s * 0.18);
    g.add(tusk);
  }

  // Caparison: jewel-toned cloth draped over the body with a gold hem and
  // hanging tassels — Moorish parade barding.
  // The saddle cloth hangs off both flanks (wider than the body, so it shows
  // from every side) with a blanket on top that the howdah sits on.
  const drape = box(1.56, 0.66, 1.62, 0xffffff, 0, 1.26, -0.05);
  drape.name = "saddle-cloth";
  g.add(teamPart(drape));
  const blanket = box(1.24, 0.1, 1.34, 0xffffff, 0, 1.8, -0.15);
  blanket.name = "saddle-cloth";
  g.add(teamPart(blanket));
  g.add(box(1.6, 0.12, 1.66, GOLD, 0, 0.96, -0.05)); // gold hem
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.4;
    for (const s of [-1, 1]) {
      g.add(cone(0.07, 0.18, GOLD, s * 0.82, 0.84, x)); // hem tassels
    }
  }
  g.add(box(0.5, 0.4, 0.04, CLOTH2, 0, 1.5, 1.32)); // brow medallion cloth
  g.add(diamond(0.1, GOLD, 0, 1.5, 1.36)); // forehead jewel

  // Domed howdah (the carriage) seated on the back.
  const howdah = box(1.0, 0.16, 1.0, 0x7a5230, 0, 1.85, -0.15); // floor
  g.add(howdah);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.05, 0.05, 0.55, GOLD, sx * 0.42, 2.18, -0.15 + sz * 0.42)); // posts
  }
  g.add(box(0.92, 0.22, 0.92, CLOTH, 0, 2.06, -0.15)); // side panels
  const dome = sphere(0.5, CLOTH2, 0, 2.5, -0.15); // canopy dome
  dome.scale.set(1.1, 0.7, 1.1);
  g.add(dome);
  g.add(cyl(0.52, 0.52, 0.08, GOLD, 0, 2.34, -0.15)); // canopy rim
  // Crescent finial crowning the canopy (Islamic motif).
  const finial = new THREE.Mesh(
    cachedGeo("crescent:0.16", () => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 0.16, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0.07, 0, 0.13, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
    }),
    toon(GOLD),
  );
  finial.position.set(0, 2.86, -0.15);
  finial.castShadow = true;
  g.add(finial);

  // Turbaned rider seated in the howdah.
  g.add(cyl(0.22, 0.28, 0.42, THEME.cream, 0, 2.18, 0.18)); // robe
  g.add(cyl(0.29, 0.29, 0.07, GOLD, 0, 1.98, 0.18)); // sash
  const rhead = sphere(0.26, SKIN, 0, 2.56, 0.2);
  addEyes(rhead, 0.26, 0.38, 0.1, "brave");
  const beard = sphere(0.2, 0x4a3526, 0, -0.16, 0.16);
  beard.scale.set(0.95, 0.8, 0.7);
  rhead.add(beard);
  g.add(rhead);
  const t = turban(0.27, THEME.emerald, GOLD);
  t.position.set(0, 2.56, 0.2);
  g.add(t);

  // Off hand braces on the howdah rail.
  const offArm = new THREE.Group();
  offArm.position.set(-0.28, 2.34, 0.18);
  offArm.add(box(0.12, 0.34, 0.12, THEME.cream, 0, -0.17, 0));
  offArm.add(sphere(0.1, SKIN, 0, -0.36, 0.04));
  g.add(offArm);

  // Spear arm — the elephant's "attack": the rider thrusts forward.
  const arm = new THREE.Group();
  arm.position.set(0.3, 2.42, 0.18);
  arm.add(box(0.12, 0.34, 0.12, THEME.cream, 0, -0.17, 0));
  arm.add(sphere(0.1, SKIN, 0, -0.36, 0.06));
  const spear = cyl(0.035, 0.035, 1.7, 0x6d4c41, 0, -0.3, 0.85);
  spear.rotation.x = Math.PI / 2;
  arm.add(spear);
  const spearTip = cone(0.07, 0.26, 0xdde4ec, 0, -0.3, 1.78);
  spearTip.rotation.x = Math.PI / 2;
  arm.add(spearTip);
  g.add(arm);

  // Idle life: the trunk curls and the ears flap gently.
  const ears = g.children.filter((c) => c.name === "ear");
  const rig: TroopRig = {
    group: root, arm, armRest: -0.25, swingAmp: 1.0, height: 2.9 * ELEPHANT_SCALE, legs, offArm,
    extras: (time, phase) => {
      trunk.rotation.x = Math.sin(time * 2 + phase) * 0.18;
      for (let i = 0; i < ears.length; i++) {
        ears[i].rotation.y = Math.sin(time * 3 + phase + i) * 0.22 * (i === 0 ? 1 : -1);
      }
    },
  };
  return rig;
}

function buildRoyalGiant(): TroopRig {
  // A royal-armoured giant who hoists an enormous cannon and lobs
  // cannonballs at the enemy's towers.
  // Steel plate, not royal blue: the team colour is the cape and breastplate.
  const ARMOR = 0x7a8797, ARMORDK = 0x55606e, GOLD = 0xf2c14e, IRON = 0x59626e, IRONDK = 0x2b3138;
  const g = new THREE.Group();
  const legs = [makeLeg(ARMORDK, -0.26, 0.34, 0.26), makeLeg(ARMORDK, 0.26, 0.34, 0.26)];
  g.add(...legs);
  // Full royal-blue cuirass — no bare belly, so he never reads as a
  // re-colored Giant. The Giant is skin and leather; this is a wall of armor.
  const cuirass = sphere(0.6, ARMOR, 0, 0.96, 0);
  cuirass.scale.set(1, 1.0, 0.8);
  g.add(cuirass);
  g.add(teamPart(box(0.46, 0.76, 0.1, ARMORDK, 0, 0.96, 0.46), "dark")); // breastplate panel
  g.add(box(0.12, 0.76, 0.02, GOLD, 0, 0.96, 0.52)); // gold stripe
  g.add(cyl(0.62, 0.62, 0.12, GOLD, 0, 0.52, 0)); // gold belt
  g.add(sphere(0.11, 0x2fbf71, 0, 0.52, 0.56)); // emerald buckle
  g.add(cyl(0.5, 0.6, 0.34, ARMORDK, 0, 0.38, 0)); // armoured skirt
  // Long royal cape — a back-view silhouette no other heavy has.
  const cape = teamPart(box(0.74, 0.95, 0.07, 0x9c2430, 0, 1.02, -0.5));
  cape.rotation.x = 0.08;
  g.add(cape);
  g.add(box(0.8, 0.12, 0.1, GOLD, 0, 1.5, -0.44)); // cape clasp bar
  for (const s of [-1, 1]) g.add(sphere(0.26, IRON, s * 0.6, 1.34, 0)); // pauldrons
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "brave");
  g.add(head);
  const beard = sphere(0.4, 0xd4a84a, 0, 1.56, 0.14); // golden beard (dark gold toons to cb orange)
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  g.add(box(0.5, 0.07, 0.06, 0x5d3d22, 0, 1.92, 0.36)); // heavy brow
  g.add(sphere(0.09, SKIN, 0, 1.74, 0.42)); // nose
  if (ARABIC) {
    const t = turban(0.42, ARMOR, GOLD);
    t.position.y = 1.78;
    g.add(t);
  } else {
    // Golden royal crown ringed with points and a ruby.
    g.add(cyl(0.4, 0.44, 0.16, GOLD, 0, 2.06, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.add(cone(0.06, 0.18, GOLD, Math.cos(a) * 0.34, 2.22, Math.sin(a) * 0.34));
    }
    g.add(sphere(0.06, 0x2fbf71, 0, 2.14, 0.4)); // crown emerald
  }

  // Off arm cradles the next cannonball.
  const offArm = new THREE.Group();
  offArm.position.set(-0.62, 1.2, 0);
  offArm.add(box(0.24, 0.46, 0.24, ARMOR, 0, -0.24, 0));
  offArm.add(sphere(0.2, SKIN, 0, -0.48, 0.1));
  offArm.add(sphere(0.19, IRONDK, 0, -0.52, 0.3)); // cannonball
  offArm.rotation.x = -0.3;
  g.add(offArm);

  // Main arm shoulders the huge cannon (the attack) — carried high like
  // artillery, not hanging at his side like the Giant's fist.
  const arm = new THREE.Group();
  arm.position.set(0.6, 1.34, 0);
  arm.add(box(0.24, 0.44, 0.24, ARMOR, 0, -0.22, 0)); // armored arm
  arm.add(sphere(0.2, SKIN, 0, -0.44, 0.1)); // fist
  const cannon = new THREE.Group();
  cannon.position.set(0.04, 0.16, -0.08);
  cannon.rotation.x = -0.14; // tilted up for the lob
  const barrel = cyl(0.2, 0.24, 1.15, IRON, 0, 0, 0);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.28;
  cannon.add(barrel);
  cannon.add(sphere(0.27, IRONDK, 0, 0, -0.34)); // breech
  const band = cyl(0.27, 0.27, 0.12, GOLD, 0, 0, 0);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.44;
  cannon.add(band);
  const muzzle = cyl(0.28, 0.28, 0.12, GOLD, 0, 0, 0);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 0.86;
  cannon.add(muzzle);
  arm.add(cannon);
  g.add(arm);
  return { group: g, arm, armRest: -0.08, swingAmp: 0.4, height: 2.3, legs, offArm };
}

function buildMusketeer(): TroopRig {
  const g = new THREE.Group();
  // Teal coat, not indigo: blue belongs to the team plume and sash.
  const COAT = 0x2a7f7a, COATDK = 0x1d5a56;
  const legs = [makeLeg(COATDK, -0.12, 0.28, 0.14), makeLeg(COATDK, 0.12, 0.28, 0.14)];
  g.add(...legs);
  g.add(cyl(0.26, 0.38, 0.48, COAT, 0, 0.52, 0)); // flared coat
  g.add(teamPart(cyl(0.34, 0.36, 0.08, COATDK, 0, 0.36, 0), "dark")); // sash
  g.add(box(0.08, 0.36, 0.04, 0xf2c14e, 0.18, 0.56, 0.3)); // gold trim stripe
  g.add(sphere(0.07, 0xf2c14e, 0, 0.52, 0.31)); // button
  const head = sphere(0.32, SKIN, 0, 1.02, 0);
  addEyes(head, 0.32, 0.36, 0.1, "brave");
  g.add(head);
  // CR look: purple coiffed curls under a steel helmet with a
  // team-colored feather, plus a metal shoulder pad.
  if (ARABIC) {
    const t = turban(0.32, 0x3a2f7a, 0xf2c14e); // indigo turban, gold band
    t.position.y = 1.02;
    g.add(t);
    const plume = teamPart(cone(0.06, 0.32, 0x3b82f6, 0, 1.54, -0.02)); // aigrette plume
    plume.rotation.z = -0.3;
    g.add(plume);
  } else {
    for (const s of [-1, 1]) {
      g.add(sphere(0.14, 0x8347c2, s * 0.22, 1.04, -0.12)); // curls
      g.add(sphere(0.1, 0x8347c2, s * 0.28, 0.92, -0.04)); // side curls
    }
    // Wide-brimmed cavalier hat with a swooping feather — reads
    // "musketeer" from any angle, unlike a low steel dome.
    const brim = cyl(0.46, 0.5, 0.05, 0x1f4f4c, 0, 1.2, 0);
    brim.name = "helm";
    g.add(brim);
    g.add(teamPart(cyl(0.24, 0.3, 0.26, COAT, 0, 1.34, 0))); // hat crown
    g.add(cyl(0.305, 0.315, 0.07, 0xf2c14e, 0, 1.25, 0)); // gold hatband
    const feather = cone(0.09, 0.52, 0x3b82f6, 0.32, 1.46, -0.1);
    feather.name = "feather";
    teamPart(feather);
    feather.rotation.z = -0.85;
    g.add(feather);
  }
  g.add(sphere(0.15, 0x9aa3ad, 0.36, 0.76, 0)); // shoulder pad
  // Powder bandolier slung across the coat.
  const bandolier = cyl(0.34, 0.34, 0.08, 0x6d4c41, 0, 0.6, 0);
  bandolier.rotation.z = 0.55;
  g.add(bandolier);
  g.add(sphere(0.07, 0x4a3325, -0.24, 0.48, 0.24)); // powder pouch

  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.72, 0);
  offArm.add(box(0.12, 0.28, 0.12, COAT, 0, -0.14, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.34, 0.74, 0);
  arm.add(box(0.12, 0.26, 0.12, SKIN, 0, -0.13, 0));
  arm.add(box(0.1, 0.12, 0.55, 0x6d4c41, 0, -0.26, 0.2)); // stock braced to shoulder
  // Long-barreled musket — the range read.
  const barrel = cyl(0.035, 0.05, 0.95, 0x9aa3ad);
  barrel.name = "musket";
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.24, 0.82);
  arm.add(barrel);
  arm.add(box(0.06, 0.08, 0.34, 0x6d4c41, 0, -0.28, 0.52)); // wooden forestock
  arm.add(cyl(0.06, 0.06, 0.07, 0x78909c, 0, -0.24, 1.27)); // flared muzzle
  g.add(arm);
  return { group: g, arm, armRest: -0.18, swingAmp: 0.4, height: 1.62, legs, offArm };
}

function buildMiniPekka(): TroopRig {
  const g = new THREE.Group();
  // Gunmetal, not steel-blue: the team colour is the chest plate and pauldrons.
  const STEEL = 0x5a6270, STEELDK = 0x3c424c, CYAN = 0x4fd8ff;
  const legs = [makeLeg(0x2a2e36, -0.15, 0.3, 0.18), makeLeg(0x2a2e36, 0.15, 0.3, 0.18)];
  g.add(...legs);
  g.add(box(0.56, 0.44, 0.4, STEELDK, 0, 0.52, 0)); // chunky body
  g.add(teamPart(box(0.46, 0.16, 0.44, STEEL, 0, 0.66, 0.02))); // chest plate
  g.add(sphere(0.08, CYAN, 0, 0.52, 0.22)); // chest light
  // Smooth featureless helmet — only a cyan slit "face".
  const helm = sphere(0.36, STEEL, 0, 1.08, 0);
  helm.name = "helm";
  helm.scale.set(1.05, 0.95, 1.05);
  g.add(helm);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), glow(CYAN, 2.2));
  eye.name = "visor";
  eye.position.set(0, 1.08, 0.34);
  g.add(eye);
  for (const s of [-1, 1]) {
    g.add(teamPart(sphere(0.16, STEEL, s * 0.36, 0.72, 0))); // bulky pauldron
    g.add(sphere(0.06, 0xb7c2cc, s * 0.36, 0.8, 0.1)); // bolt
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.38, 0.68, 0);
  offArm.add(box(0.14, 0.3, 0.14, STEELDK, 0, -0.15, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.4, 0.72, 0);
  arm.add(box(0.14, 0.28, 0.14, STEELDK, 0, -0.14, 0));
  arm.add(box(0.06, 0.2, 0.06, 0x6d4c41, 0, -0.38, 0)); // handle
  // Oversized pancake-cleaver.
  arm.add(box(0.06, 0.7, 0.4, 0xb7c2cc, 0, -0.08, 0.12));
  const cleaverEdge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.06), glow(0x76e6ff, 2.0));
  cleaverEdge.position.set(0, -0.08, 0.34);
  arm.add(cleaverEdge);
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.9, height: 1.7, legs, offArm };
}

function buildSkeleton(): TroopRig {
  const g = new THREE.Group();
  const BONE = 0xf5f2ea, BONEDK = 0xcfc8b8;
  const legs = [
    makeLeg(BONE, -0.08, 0.18, 0.07),
    makeLeg(BONE, 0.08, 0.18, 0.07),
  ];
  g.add(...legs);
  g.add(box(0.24, 0.22, 0.14, BONE, 0, 0.3, 0)); // tiny ribcage
  g.add(teamPart(box(0.26, 0.03, 0.16, BONEDK, 0, 0.3, 0))); // team-dyed rib wraps
  g.add(teamPart(box(0.26, 0.03, 0.16, BONEDK, 0, 0.38, 0)));
  // Exaggerated goofy skull — the swarm's readable silhouette.
  const skull = sphere(0.3, BONE, 0, 0.72, 0);
  skull.name = "skull";
  g.add(skull);
  skull.add(sphere(0.09, 0x1f2430, -0.11, 0.04, 0.24)); // oversized socket
  skull.add(sphere(0.09, 0x1f2430, 0.11, 0.04, 0.24));
  skull.add(box(0.16, 0.07, 0.1, BONEDK, 0, -0.22, 0.12)); // jaw
  for (const s of [-1, 1]) skull.add(box(0.03, 0.06, 0.03, 0xffffff, s * 0.05, -0.18, 0.22)); // goofy teeth

  const offArm = new THREE.Group();
  offArm.position.set(-0.16, 0.42, 0);
  offArm.add(box(0.055, 0.18, 0.055, BONE, 0, -0.09, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.16, 0.44, 0);
  arm.add(box(0.055, 0.16, 0.055, BONE, 0, -0.08, 0));
  arm.add(box(0.035, 0.36, 0.07, 0xe8e3d8, 0, 0, 0)); // short bone sword
  g.add(arm);
  return { group: g, arm, armRest: -0.55, swingAmp: 1.6, height: 1.0, legs, offArm };
}

type EyeMood = "brave" | "angry" | "calm" | "cute" | "wicked";

interface WizardTheme {
  robe: number;
  robeDk: number;
  trim: number;
  hair: number;
  beard: number;
  orb: number; // casting orb / attack element
  crystal: number; // staff crystal
  tip: number; // headgear accent glow
  mood: EyeMood;
  headgear: "hat" | "electro" | "ice";
  /** Face color — the Ice Wizard is frost-blue, everyone else skin-toned. */
  skin: number;
  /** Ambient glowing orbiters circling the caster (fire embers / ice shards). */
  orbit: "embers" | "shards" | null;
  /** Thick white winter fur collar (the Ice Wizard). */
  fur: boolean;
  /** Beard cone length override — the Electro Wizard wears a short goatee. */
  beardLen?: number;
  /** Twin tesla-coil pack on the back (the Electro Wizard). */
  coils?: boolean;
}

/**
 * The classic wizard reads FIRE at a glance: crimson robes, a flame-tipped
 * hat, and embers circling his casting hand — no longer confusable with
 * the pale-blue Ice Wizard across a busy field.
 */
const CLASSIC_WIZARD: WizardTheme = {
  robe: 0x84399a, // plum: crimson read as the red team
  robeDk: 0x521f60,
  trim: 0xf2c14e,
  hair: 0x6b4a2e, // brown, per the CR reference (not white)
  beard: 0x6b4a2e,
  orb: 0xff7a00,
  crystal: 0xffb35c,
  tip: 0xffc46b,
  mood: "brave",
  headgear: "hat",
  skin: SKIN,
  orbit: "embers",
  fur: false,
};

function buildWizard(theme: WizardTheme = CLASSIC_WIZARD): TroopRig {
  // Premium classic wizard: flared star-trimmed robe, glowing crystal staff,
  // and a casting orb. Themed variants (electro/ice) reskin the same rig.
  const ROBE = theme.robe, ROBEDK = theme.robeDk, TRIM = theme.trim, HAIR = theme.hair;
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.52, 0.92, ROBE, 0, 0.47, 0)); // flared robe
  g.add(teamPart(cyl(0.52, 0.54, 0.1, ROBEDK, 0, 0.05, 0), "dark")); // hem
  g.add(teamPart(cyl(0.4, 0.42, 0.08, 0x5a3a1c, 0, 0.76, 0))); // belt
  g.add(box(0.1, 0.1, 0.05, TRIM, 0, 0.76, 0.42)); // buckle
  for (let i = 0; i < 3; i++) g.add(sphere(0.045, TRIM, 0, 0.62 - i * 0.17, 0.4)); // star buttons
  const head = sphere(0.32, theme.skin, 0, 1.12, 0);
  addEyes(head, 0.32, 0.32, 0.08, theme.mood);
  g.add(head);
  // Hair tufts + short beard, kept clear of the lit face.
  for (const s of [-1, 1]) g.add(sphere(0.12, HAIR, s * 0.28, 1.02, 0.04));
  const beardLen = theme.beardLen ?? (theme.fur ? 0.58 : 0.42);
  const beard = cone(0.2, beardLen, theme.beard, 0, theme.fur ? 0.76 : 0.84, 0.12);
  beard.rotation.x = Math.PI;
  g.add(beard);
  if (theme.fur) {
    // Winter kit: a thick white fur collar with shoulder puffs.
    g.add(cyl(0.3, 0.36, 0.16, 0xf2f6f8, 0, 0.9, 0));
    for (const s of [-1, 1]) g.add(sphere(0.15, 0xf2f6f8, s * 0.3, 0.88, 0));
  }
  if (theme.coils) {
    // Twin tesla coils leaning wide over the shoulders from a back pack —
    // an angular, technological outline no other robed caster shares.
    g.add(box(0.36, 0.3, 0.14, ROBEDK, 0, 0.86, -0.32));
    for (const s of [-1, 1]) {
      const coil = cyl(0.05, 0.1, 0.52, ROBEDK, s * 0.32, 1.16, -0.28);
      coil.rotation.z = s * 0.42;
      g.add(coil);
      const ring = cyl(0.11, 0.11, 0.05, TRIM, s * 0.4, 1.28, -0.28);
      ring.rotation.z = s * 0.42;
      g.add(ring);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glow(theme.tip, 2.4));
      spark.position.set(s * 0.46, 1.42, -0.28);
      g.add(spark);
    }
  }
  let antennae: THREE.Object3D | null = null;
  if (ARABIC) {
    const t = turban(0.32, 0x2f6f6b, 0x76ff03); // teal turban, green mage jewel
    t.position.y = 1.12;
    g.add(t);
  } else if (theme.headgear === "electro") {
    // No hat: a tall crest of hair swept BACK by its own static charge —
    // deliberately not a ring of spikes, which reads like Ice's crown.
    for (let i = 0; i < 3; i++) {
      const hSpike = 0.62 - i * 0.16;
      const spike = cone(0.1 - i * 0.015, hSpike, HAIR, 0, 1.34 + hSpike * 0.3, -0.06 - i * 0.15);
      spike.rotation.x = -0.5 - i * 0.25; // raked backward
      g.add(spike);
    }
    antennae = new THREE.Group();
    const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glow(theme.tip, 2.2));
    bolt.position.set(0, 1.82, -0.14);
    antennae.add(bolt);
    g.add(antennae);
  } else if (theme.headgear === "ice") {
    // A jagged frozen crown of pale crystal shards.
    g.add(cyl(0.36, 0.4, 0.12, ROBEDK, 0, 1.32, 0)); // icy circlet
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const shard = cone(0.05, 0.26, theme.tip, Math.cos(a) * 0.3, 1.5, Math.sin(a) * 0.3);
      g.add(shard);
    }
    const crownTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), glow(theme.tip, 1.6));
    crownTip.position.set(0, 1.62, 0);
    g.add(crownTip);
  } else {
    // Pointed hat with brim band + glowing tip star.
    const hat = cone(0.44, 1.0, ROBEDK, 0, 1.66, -0.05);
    hat.rotation.x = -0.1;
    g.add(hat);
    g.add(teamPart(cyl(0.46, 0.46, 0.1, ROBE, 0, 1.26, 0))); // brim band
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), glow(theme.tip, 1.8));
    tip.position.set(0.08, 2.12, -0.16);
    g.add(tip);
  }

  // Staff hand with a glowing crystal.
  const offArm = new THREE.Group();
  offArm.position.set(-0.4, 0.78, 0);
  offArm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  offArm.add(cyl(0.032, 0.038, 1.15, 0x6d4c41, 0, -0.12, 0.08)); // shaft
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), glow(theme.crystal, 1.8));
  crystal.position.set(0, 0.5, 0.08);
  offArm.add(crystal);
  g.add(offArm);

  // Casting hand with the elemental orb (the attack).
  const arm = new THREE.Group();
  arm.position.set(0.4, 0.8, 0);
  arm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glow(theme.orb, 1.8));
  orb.position.set(0, -0.34, 0.1);
  arm.add(orb);
  g.add(arm);

  // Elemental orbiters: embers (fire) or crystal shards (ice) circling the
  // caster — a moving silhouette cue readable even at phone size.
  const orbiters: THREE.Mesh[] = [];
  if (theme.orbit) {
    for (let i = 0; i < 3; i++) {
      const m =
        theme.orbit === "shards"
          ? new THREE.Mesh(new THREE.OctahedronGeometry(0.075), glow(theme.tip, 1.6))
          : new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow(theme.orb, 1.8));
      g.add(m);
      orbiters.push(m);
    }
  }

  const flicker = (t: number, phase: number) => {
    const s = 1 + Math.sin(t * 11 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.05;
    orb.scale.setScalar(s);
    crystal.rotation.y = t * 1.5;
    if (antennae) antennae.rotation.y = t * 4;
    for (let i = 0; i < orbiters.length; i++) {
      const a = t * 2.2 + phase + (i / orbiters.length) * Math.PI * 2;
      orbiters[i].position.set(
        Math.cos(a) * 0.52,
        0.95 + Math.sin(t * 3 + i * 2.1) * 0.14,
        Math.sin(a) * 0.52,
      );
      orbiters[i].rotation.y = a;
    }
  };
  return { group: g, arm, armRest: -0.9, swingAmp: 1.1, height: 1.7, offArm, extras: flicker };
}

function buildElectroWizard(): TroopRig {
  // Storm-charcoal, a color no other caster wears: white read as an Ice
  // Wizard palette swap, and indigo collided with the Musketeer's coat.
  return buildWizard({
    robe: 0x3a4653,
    robeDk: 0x232c36,
    trim: 0x4fd2ff,
    hair: 0x45e8ff,
    beard: 0xd9f6ff,
    orb: 0x5ad1ff,
    crystal: 0x9bf0ff,
    tip: 0xb8f3ff,
    mood: "angry",
    headgear: "electro",
    skin: SKIN,
    orbit: null,
    fur: false,
    beardLen: 0.2, // short goatee — the long beard belongs to Ice
    coils: true,
  });
}

/**
 * The Ice Wizard is unmistakably WINTER now: frost-blue skin, a deep
 * arctic robe under a thick white fur collar, a long snowy beard, and
 * ice shards slowly orbiting him.
 */
function buildIceWizard(): TroopRig {
  return buildWizard({
    robe: 0x25688e,
    robeDk: 0x143c54,
    trim: 0xeafaff,
    hair: 0xeafaff,
    beard: 0xf2f8ff,
    orb: 0xbfeaff,
    crystal: 0xdff6ff,
    tip: 0xd8f4ff,
    mood: "calm",
    headgear: "ice",
    skin: 0x9fd8ec, // frost-touched face
    orbit: "shards",
    fur: true,
  });
}

function buildWitch(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.46, 0.7, 0x4a148c, 0, 0.4, 0)); // dark robe
  g.add(teamPart(cyl(0.37, 0.4, 0.08, 0x7b1fa2, 0, 0.5, 0), "dark")); // sash
  g.add(sphere(0.07, 0x76ff03, 0, 0.62, 0.3)); // glowing brooch
  const head = sphere(0.29, 0xcfd4f1, 0, 1.04, 0); // pale skin
  addEyes(head, 0.29, 0.38, 0.1, "wicked");
  // Signature glowing magenta-pink eyes over the pupils.
  for (const s of [-1, 1]) {
    const gleam = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), glow(0xff4fd8, 2));
    gleam.name = "eyeglow";
    gleam.position.set(s * 0.29 * 0.38, 0.29 * 0.1, 0.29 * 0.99);
    head.add(gleam);
  }
  g.add(head);
  const hair = sphere(0.3, 0xe8e3d8, 0, 1.1, -0.06);
  hair.scale.set(1, 0.7, 1.05);
  g.add(hair);
  // Long violet strands spilling from under the hat.
  for (const s of [-1, 1]) {
    const strand = cyl(0.07, 0.04, 0.55, 0xe8e3d8, s * 0.26, 0.82, -0.08);
    strand.rotation.z = s * 0.18;
    g.add(strand);
  }
  // Redesign: the classic crooked witch hat — a wide brim, a tall cone,
  // and a bent tip flopping sideways. Reads "witch" from across the arena
  // where the old hood blended into every other robed caster.
  g.add(cyl(0.5, 0.52, 0.06, 0x38106b, 0, 1.27, -0.02)); // wide brim
  g.add(cone(0.34, 0.58, 0x4a148c, 0, 1.58, -0.02)); // crown
  const hatTip = cone(0.15, 0.42, 0x4a148c, 0.2, 1.86, -0.02);
  hatTip.rotation.z = -0.9; // the tip flops over
  g.add(hatTip);
  g.add(sphere(0.06, 0x76ff03, 0.38, 1.94, -0.02)); // soul-green tip bauble
  g.add(teamPart(cyl(0.36, 0.38, 0.09, 0x2e7d32, 0, 1.33, -0.02))); // hat band
  g.add(box(0.09, 0.09, 0.04, 0xd9a93f, 0, 1.33, 0.35)); // gold buckle
  for (const s of [-1, 1]) {
    const whiteHair = cyl(0.06, 0.045, 0.4, 0xe8e3d8, s * 0.24, 0.86, 0.12);
    whiteHair.rotation.z = s * 0.14;
    g.add(whiteHair);
    const goldSkull = sphere(0.08, 0xd9a93f, s * 0.34, 0.74, 0.05);
    g.add(goldSkull); // golden shoulder skulls
  }
  g.add(box(0.1, 0.1, 0.05, 0xd9a93f, 0, 0.5, 0.42)); // golden skull belt
  // A little skull familiar circling low behind her shoulders.
  const skull = sphere(0.09, 0xf5f2ea, -0.55, 0.82, -0.2);
  skull.add(sphere(0.025, 0x1f2430, -0.03, 0.01, 0.075));
  skull.add(sphere(0.025, 0x1f2430, 0.03, 0.01, 0.075));
  g.add(skull);
  const orbitSkull = (t: number, phase: number) => {
    const a = t * 1.6 + phase;
    skull.position.set(
      Math.cos(a) * 0.62,
      0.82 + Math.sin(t * 3 + phase) * 0.07,
      Math.sin(a) * 0.62 - 0.05,
    );
    skull.rotation.y = -a + Math.PI / 2; // always faces outward
  };

  // Staff hand: CR's ram-skull staff with golden horns.
  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.78, 0);
  offArm.add(box(0.11, 0.26, 0.11, 0x4a148c, 0, -0.13, 0));
  offArm.add(cyl(0.03, 0.03, 0.95, 0x3e2723, 0, -0.1, 0.08)); // shaft
  const ramSkull = sphere(0.11, 0xf5f2ea, 0, 0.42, 0.08);
  ramSkull.scale.set(0.9, 1.1, 0.8);
  offArm.add(ramSkull);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.028, 6, 10, Math.PI * 1.2),
      toon(0xd9a93f),
    );
    horn.position.set(s * 0.13, 0.46, 0.08);
    horn.rotation.y = s * 0.4;
    horn.rotation.z = s * 1.9;
    horn.castShadow = true;
    offArm.add(horn); // golden ram horns
  }
  g.add(offArm);

  // Casting hand wreathed in green soul-fire.
  const arm = new THREE.Group();
  arm.position.set(0.34, 0.8, 0);
  arm.add(box(0.11, 0.26, 0.11, 0x4a148c, 0, -0.13, 0));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), glow(0x76ff03, 1.8));
  orb.position.set(0, -0.34, 0.1);
  arm.add(orb);
  g.add(arm);
  return { group: g, arm, armRest: -0.9, swingAmp: 1.1, height: 1.8, offArm, extras: orbitSkull };
}

/**
 * Art bible 7: a creature wears its team colour on ONE cloth or trim slot.
 * A scarf knotted round the neck: the wrap, a knot at the nape and two
 * tails streaming out behind (so the side also reads from the back). All
 * in one node, so the bake merges it into one team mesh. `back` is how far
 * behind the neck the tails fly (clear of the body).
 */
function teamScarf(r: number, y: number, z: number, back: number, tilt = 0.3): THREE.Mesh[] {
  const wrap = new THREE.Mesh(cachedGeo(`scarf:${r}`, () => new THREE.TorusGeometry(r, r * 0.3, 8, 22)), toon(0xffffff));
  wrap.rotation.x = Math.PI / 2 + tilt;
  shadowed(wrap, 0, y, z);
  wrap.name = "scarf";
  const knot = sphere(round3(r * 0.36), 0xffffff, 0, y + r * 0.15, z - r * 0.95);
  knot.name = "scarf";
  const parts: THREE.Mesh[] = [teamPart(wrap), teamPart(knot, "dark")];
  for (const s of [-1, 1]) {
    const tail = box(round3(r * 0.5), round3(r * 1.5), round3(r * 0.14), 0xffffff, s * r * 0.32, y + r * 0.05, z - back);
    tail.rotation.set(-1.2, 0, s * 0.35);
    tail.name = "scarf";
    parts.push(teamPart(tail, "dark"));
  }
  return parts;
}

/** A team collar: a thick ring round the neck with a stud in front (one slot). */
function teamCollar(r: number, y: number, z: number, tilt = 0.25): THREE.Mesh[] {
  const ring = new THREE.Mesh(cachedGeo(`collar:${r}`, () => new THREE.TorusGeometry(r, r * 0.26, 8, 22)), toon(0xffffff));
  ring.rotation.x = Math.PI / 2 + tilt;
  shadowed(ring, 0, y, z);
  ring.name = "collar";
  return [teamPart(ring)];
}

/** A team bandana tied round a head: a band and two short tails behind (one slot). */
function teamBandana(r: number, y: number, z: number): THREE.Mesh[] {
  const band = new THREE.Mesh(cachedGeo(`bandana:${r}`, () => new THREE.TorusGeometry(r, r * 0.2, 8, 22)), toon(0xffffff));
  band.rotation.x = Math.PI / 2 - 0.25;
  shadowed(band, 0, y, z);
  band.name = "bandana";
  const parts: THREE.Mesh[] = [teamPart(band)];
  for (const s of [-1, 1]) {
    const tail = box(round3(r * 0.34), round3(r * 0.75), round3(r * 0.1), 0xffffff, s * r * 0.24, y - r * 0.32, z - r * 1.02);
    tail.rotation.set(-0.7, 0, s * 0.45);
    tail.name = "bandana";
    parts.push(teamPart(tail, "dark"));
  }
  return parts;
}

/**
 * A membrane wing: three rounded lobes fanned from the shoulder (a scalloped
 * trailing edge), a darker bone along the leading edge and a claw at its tip.
 */
function membraneWing(s: number, span: number, depth: number, skin: number, rib: number): THREE.Group {
  const wing = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = -0.42 + i * 0.42;
    const len = span * (1 - i * 0.16);
    const m = lobe(skin);
    m.scale.set(len, 0.06, depth * 0.62);
    m.position.set(s * len * 0.5 * Math.cos(a), -i * 0.012, -Math.sin(Math.abs(a) + 0.2) * depth * 0.42);
    m.rotation.y = s * a;
    m.name = "wing-membrane";
    wing.add(m);
  }
  const bone = box(round3(span * 0.9), 0.07, 0.07, rib, s * span * 0.45, 0.03, depth * 0.24);
  bone.name = "wing-rib";
  wing.add(bone);
  const claw = cone(0.05, 0.12, rib, s * span * 0.92, 0.06, depth * 0.26);
  claw.rotation.z = -s * Math.PI / 2;
  wing.add(claw);
  return wing;
}

/** A flattened wing lobe: a low-poly sphere (it is squashed flat, so 12 x 8 segments read smooth). */
function lobe(color: number): THREE.Mesh {
  return shadowed(new THREE.Mesh(cachedGeo("lobe", () => new THREE.SphereGeometry(0.5, 12, 8)), toon(color)), 0, 0, 0);
}

/** A feathered wing: three long rounded feathers fanned from the shoulder, darker at the tips. */
function featherWing(s: number, span: number, depth: number, feather: number, tip: number, name: string): THREE.Group {
  const wing = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = -0.3 + i * 0.32;
    const len = span * (1 - i * 0.14);
    const f = lobe(feather);
    f.scale.set(len, 0.07, depth * 0.42);
    f.position.set(s * len * 0.5 * Math.cos(a), -i * 0.015, -Math.sin(a + 0.3) * depth * 0.5);
    f.rotation.y = s * a;
    f.name = name;
    wing.add(f);
    const t = lobe(tip);
    t.scale.set(len * 0.34, 0.075, depth * 0.36);
    t.position.set(s * len * 0.84 * Math.cos(a), -i * 0.015 + 0.004, -Math.sin(a + 0.3) * depth * 0.5);
    t.rotation.y = s * a;
    wing.add(t);
  }
  return wing;
}

/**
 * BALLOON (art bible 7): a panelled parchment hot-air envelope with tan ribs
 * and ONE team stripe round its middle, a wicker basket and a skeleton pilot
 * in an aviator cap and goggles (the cast's skeleton look), dropping a bomb.
 */
function buildBalloon(): TroopRig {
  const g = new THREE.Group();
  // Parchment with tan ribs and trim: a light neutral clear of every team
  // family in both palettes (a sunflower envelope sat 14 degrees from the
  // colour-blind orange and swallowed the enemy's stripe), so blue, red and
  // orange stripes all pop on it.
  const PARCH = 0xefe2c2, TRIM = 0x9c7a55, TAN = 0xb08a5e, WICKER = 0x8f6c4a, WICKERDK = 0x6a5038;
  const BONE = 0xece4cf, LEATHER = 0x7a4e2c, BRASS = 0xd9b04a;
  const envelope = sphere(0.62, PARCH, 0, 1.55, 0);
  envelope.scale.set(1, 1.15, 1);
  envelope.name = "envelope";
  g.add(envelope);
  // Tan ribs: four meridians, so the envelope reads as sewn panels.
  for (const ry of [0, Math.PI / 2]) {
    const rib = new THREE.Mesh(cachedGeo("balloon-rib", () => new THREE.TorusGeometry(0.625, 0.03, 6, 32)), toon(TAN));
    rib.scale.set(1, 1.15, 1);
    rib.rotation.y = ry;
    shadowed(rib, 0, 1.55, 0);
    g.add(rib);
  }
  const crown = sphere(0.26, TRIM, 0, 2.22, 0);
  crown.scale.set(1, 0.45, 1);
  g.add(crown);
  // The ONE team slot: a broad stripe round the envelope's upper shoulder,
  // where the battle camera (and the player) look down on it.
  const stripe = cyl(0.555, 0.64, 0.34, 0xffffff, 0, 1.76, 0);
  stripe.name = "envelope-stripe";
  g.add(teamPart(stripe));
  g.add(cyl(0.2, 0.13, 0.22, TRIM, 0, 0.84, 0)); // skirt
  for (const s of [-1, 1]) {
    for (const z of [-1, 1]) {
      const rope = cyl(0.015, 0.015, 0.4, TAN, s * 0.17, 0.72, z * 0.12);
      rope.rotation.z = -s * 0.32;
      g.add(rope);
    }
  }
  // Wicker basket with a rim.
  g.add(cyl(0.28, 0.22, 0.3, WICKER, 0, 0.42, 0));
  g.add(cyl(0.3, 0.3, 0.06, WICKERDK, 0, 0.58, 0));
  // Skeleton pilot: a big skull in a leather aviator cap with brass goggles.
  const skull = sphere(0.17, BONE, 0, 0.74, 0.04);
  skull.add(sphere(0.045, 0x2b2333, -0.06, 0.0, 0.14));
  skull.add(sphere(0.045, 0x2b2333, 0.06, 0.0, 0.14));
  g.add(skull);
  const cap = sphere(0.18, LEATHER, 0, 0.8, 0.02);
  cap.scale.set(1.02, 0.7, 1.02);
  cap.name = "aviator-cap";
  g.add(cap);
  for (const s of [-1, 1]) {
    const flap = box(0.06, 0.14, 0.1, LEATHER, s * 0.16, 0.7, 0.02);
    g.add(flap);
    const goggle = cyl(0.05, 0.05, 0.04, BRASS, s * 0.06, 0.86, 0.15);
    goggle.rotation.x = Math.PI / 2 - 0.4;
    g.add(goggle);
  }
  // Bomb-dropping arm: a bony arm holding a fizzing bomb under the basket.
  const arm = new THREE.Group();
  arm.position.set(0.26, 0.5, 0.1);
  arm.add(box(0.06, 0.2, 0.06, BONE, 0, -0.1, 0));
  const bomb = sphere(0.16, 0x2f3540, 0, -0.3, 0.04);
  arm.add(bomb);
  const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(0xffa000, 2));
  fuse.position.set(0, -0.12, 0.04);
  arm.add(fuse);
  g.add(arm);
  return { group: g, arm, armRest: -0.3, swingAmp: 1.4, height: 2.3, hover: 1.7 };
}

/**
 * BABY DRAGON (art bible 7): a chubby green dragon that never blooms. Big
 * leafy wings, ivory horns, a spiny back ridge and a spade-tipped tail read
 * from any side; its ONE team slot is a scarf knotted round the neck.
 */
function buildBabyDragon(): TroopRig {
  const g = new THREE.Group();
  const BODY = 0x5cb84a, BODYDK = 0x3f8f3a, BELLY = 0xf2e3a2, WING = 0x3c9a6a, WINGDK = 0x2a7050, IVORY = 0xf3ead2;
  const body = sphere(0.5, BODY, 0, 0.52, 0);
  body.scale.set(0.95, 0.92, 1.1);
  g.add(body);
  const belly = sphere(0.38, BELLY, 0, 0.44, 0.2);
  belly.scale.set(0.8, 0.75, 0.6);
  g.add(belly);
  const head = sphere(0.4, BODY, 0, 1.1, 0.22);
  g.add(head);
  const snout = sphere(0.24, 0x6cc458, 0, 1.0, 0.56);
  snout.scale.set(1, 0.7, 0.9);
  g.add(snout);
  for (const s of [-1, 1]) g.add(sphere(0.035, 0x2b2333, s * 0.08, 1.05, 0.76)); // nostrils
  const tongue = sphere(0.08, 0xff9fb6, 0, 0.88, 0.64);
  tongue.name = "tongue";
  tongue.scale.set(0.8, 0.4, 1.3);
  tongue.rotation.x = 0.35;
  g.add(tongue);
  // Big toy eyes.
  for (const s of [-1, 1]) {
    g.add(sphere(0.12, 0x2b2333, s * 0.18, 1.22, 0.47));
    g.add(sphere(0.105, 0xfffbea, s * 0.18, 1.22, 0.5));
    g.add(sphere(0.055, 0x1f2430, s * 0.18, 1.22, 0.59));
  }
  // Ivory horns swept back, and a spiny ridge down the back.
  for (const s of [-1, 1]) {
    const horn = cone(0.09, 0.3, IVORY, s * 0.17, 1.46, 0.06);
    horn.name = "horn";
    horn.rotation.z = -s * 0.3;
    horn.rotation.x = -0.45;
    g.add(horn);
  }
  for (let i = 0; i < 3; i++) {
    const spine = cone(0.08 - i * 0.012, 0.2 - i * 0.03, BODYDK, 0, 0.98 - i * 0.2, -0.38 - i * 0.12);
    spine.rotation.x = -0.6 - i * 0.2;
    spine.name = "spine";
    g.add(spine);
  }
  const tail = cone(0.15, 0.7, BODY, 0, 0.44, -0.72);
  tail.rotation.x = Math.PI / 2.3;
  const spade = diamond(0.13, BODYDK, 0, -0.38, 0);
  spade.scale.set(1.2, 0.8, 0.4);
  tail.add(spade);
  g.add(tail);
  const wagTail = (t: number, phase: number) => {
    tail.rotation.z = Math.sin(t * 5 + phase) * 0.35;
  };
  g.add(sphere(0.14, BODY, -0.22, 0.12, 0.1));
  g.add(sphere(0.14, BODY, 0.22, 0.12, 0.1));
  g.add(...teamScarf(0.34, 0.9, 0.16, 0.62));

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = membraneWing(s, 0.62, 0.5, WING, WINGDK);
    wing.position.set(s * 0.36, 0.9, -0.12);
    wing.rotation.z = s * 0.3;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.3, amp: s * 0.6 });
  }
  return {
    group: g,
    arm: null,
    armRest: 0,
    swingAmp: 0,
    height: 1.6,
    hover: 1.0,
    wings,
    extras: wagTail,
  };
}

/**
 * GARGOYLES (art bible 7): little stone imps with stone bat wings, curled
 * horns and amber eyes; the ONE team slot is a collar.
 */
function buildGargoyle(): TroopRig {
  const g = new THREE.Group();
  const STONE = 0x948f86, STONEDK = 0x6b675f, WING = 0x7a766e, HORN = 0xd8cfb8;
  const body = sphere(0.25, STONE, 0, 0.4, 0);
  body.scale.set(1, 1.2, 0.9);
  g.add(body);
  const head = sphere(0.23, STONE, 0, 0.8, 0.04);
  g.add(head);
  g.add(box(0.36, 0.07, 0.1, STONEDK, 0, 0.9, 0.2)); // heavy brow
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), glow(0xffdf5a, 2));
    eye.name = "eyeglow";
    eye.position.set(s * 0.09, 0.82, 0.2);
    g.add(eye);
    const horn = new THREE.Mesh(cachedGeo("garg-horn", () => new THREE.TorusGeometry(0.1, 0.035, 6, 10, Math.PI * 1.1)), toon(HORN));
    horn.name = "horn";
    horn.rotation.set(0, s * 1.3, s * 0.4);
    shadowed(horn, s * 0.16, 0.98, -0.02);
    g.add(horn);
    g.add(box(0.03, 0.07, 0.025, 0xece4cf, s * 0.05, 0.66, 0.21)); // fang
  }
  g.add(...teamCollar(0.17, 0.6, 0.02));
  const legs = [makeLeg(STONEDK, -0.09, 0.17, 0.07), makeLeg(STONEDK, 0.09, 0.17, 0.07)];
  g.add(...legs);
  const offArm = new THREE.Group();
  offArm.position.set(-0.23, 0.5, 0);
  offArm.add(box(0.08, 0.22, 0.08, STONE, 0, -0.11, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.23, 0.5, 0);
  arm.add(box(0.08, 0.22, 0.08, STONE, 0, -0.11, 0));
  arm.add(cone(0.045, 0.12, HORN, 0, -0.25, 0.03)); // claw
  g.add(arm);
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = membraneWing(s, 0.46, 0.36, WING, STONEDK);
    wing.position.set(s * 0.18, 0.66, -0.12);
    wing.rotation.z = s * 0.45;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.45, amp: s * 0.8 });
  }
  return { group: g, arm, armRest: -0.45, swingAmp: 1.3, height: 1.1, hover: 0.9, wings, legs };
}

function buildValkyrie(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x4e342e, -0.13, 0.26, 0.16), makeLeg(0x4e342e, 0.13, 0.26, 0.16)];
  g.add(...legs);
  g.add(cyl(0.3, 0.5, 0.5, 0x9a7a4a, 0, 0.5, 0)); // khaki-bronze dress (crimson read as red, bright bronze as cb orange)
  g.add(cyl(0.5, 0.53, 0.1, 0xe8e3d8, 0, 0.28, 0)); // fur-trimmed hem
  g.add(cyl(0.38, 0.4, 0.09, 0x6d4c41, 0, 0.34, 0)); // belt
  const head = sphere(0.3, SKIN, 0, 1.04, 0);
  addEyes(head, 0.3, 0.38, 0.1, "angry");
  g.add(head);
  if (ARABIC) {
    const t = turban(0.3, 0x9c3848, 0xf2c14e, true); // team headscarf, gold band
    t.position.y = 1.04;
    g.add(t);
  } else {
    // Big wild mane with heavy outswept braids — her head outline stops
    // matching the Knight's smooth steel dome.
    // Flaxen, not ginger: orange hair read as the colour-blind enemy orange.
    const hair = sphere(0.34, 0xe9c46a, 0, 1.13, -0.03);
    hair.scale.set(1.08, 0.7, 1.05);
    g.add(hair);
    for (const s of [-1, 1]) {
      const braid = cyl(0.11, 0.07, 0.68, 0xe9c46a, s * 0.34, 0.78, -0.12);
      braid.rotation.z = s * 0.48;
      g.add(braid);
      g.add(sphere(0.09, 0x6b4226, s * 0.5, 0.5, -0.12)); // leather braid tie
    }
    // Broad gold valkyrie wings flaring from the circlet — matched to her
    // headband, not to steel, so nothing up top echoes the Knight's helm.
    for (const s of [-1, 1]) {
      const wing = cone(0.18, 0.46, 0xf2c14e, s * 0.42, 1.36, -0.04);
      wing.scale.z = 0.3; // flat feathered fan
      wing.rotation.z = -s * 1.15; // sweeping up and outward
      g.add(wing);
    }
  }
  // Team-dyed fur mantle on the shoulders (seen from every side) and a
  // leather chest guard — no steel up top, that's the Knight's material.
  for (const s of [-1, 1]) {
    g.add(teamPart(sphere(0.17, 0xe8e3d8, s * 0.37, 0.78, 0))); // team-dyed fur pauldron
    g.add(sphere(0.05, 0xf2c14e, s * 0.37, 0.9, 0.06)); // gold stud
  }
  g.add(teamPart(box(0.36, 0.3, 0.3, 0x6b4a2a, 0, 0.66, 0.06), "dark")); // chest guard
  g.add(diamond(0.07, 0xf2c14e, 0, 0.7, 0.24)); // emblem
  g.add(teamPart(cyl(0.31, 0.31, 0.06, 0xf2c14e, 0, 1.22, 0))); // headband

  const offArm = new THREE.Group();
  offArm.position.set(-0.38, 0.74, 0);
  offArm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  g.add(offArm);

  // Huge double axe with gold hubs and a haft spike.
  const arm = new THREE.Group();
  arm.position.set(0.38, 0.78, 0);
  arm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  arm.add(cyl(0.035, 0.035, 0.85, 0x6d4c41, 0, -0.1, 0.16)); // haft
  arm.add(cone(0.05, 0.2, 0xc7d0dd, 0, 0.42, 0.16)); // haft spike
  // Broad flat half-moon blades facing the swing plane — the old edge-on
  // squashed discs read as a grey ball, not her signature great-axe.
  for (const s of [-1, 1]) {
    const blade = cyl(0.33, 0.33, 0.055, 0xb7c2cc, s * 0.28, 0.28, 0.16);
    blade.rotation.x = Math.PI / 2; // flat face forward
    blade.scale.x = 0.82;
    arm.add(blade);
    const edge = cyl(0.35, 0.35, 0.04, 0xe7edf4, s * 0.37, 0.28, 0.16);
    edge.rotation.x = Math.PI / 2; // bright cutting rim biased outward
    edge.scale.x = 0.45;
    arm.add(edge);
  }
  const hub = cyl(0.1, 0.1, 0.1, 0xf2c14e, 0, 0.28, 0.16);
  hub.rotation.x = Math.PI / 2; // gold boss where the blades meet the haft
  arm.add(hub);
  g.add(arm);
  return { group: g, arm, armRest: -0.55, swingAmp: 1.9, height: 1.45, legs, offArm };
}

function buildPrince(): TroopRig {
  const g = new THREE.Group();
  const HORSE = 0x8d6e63;
  // Galloping pony legs.
  const legs = [
    makeLeg(HORSE, -0.24, 0.42, 0.14, 0.4),
    makeLeg(HORSE, 0.24, 0.42, 0.14, 0.4),
    makeLeg(HORSE, -0.24, 0.42, 0.14, -0.4),
    makeLeg(HORSE, 0.24, 0.42, 0.14, -0.4),
  ];
  g.add(...legs);
  const horse = sphere(0.42, 0x9c7b66, 0, 0.7, 0);
  horse.scale.set(0.75, 0.7, 1.5);
  g.add(horse);
  // Proper pony head: tall snout, big ears, broad mane.
  const horseHead = sphere(0.24, HORSE, 0, 1.14, 0.62);
  horseHead.scale.set(0.95, 1.1, 1.15);
  g.add(horseHead);
  const muzzle = sphere(0.13, 0x7a5548, 0, 1.02, 0.82);
  muzzle.scale.set(0.85, 0.62, 0.7);
  g.add(muzzle);
  g.add(sphere(0.025, 0x1f2430, -0.05, 1.04, 0.9)); // nostril
  g.add(sphere(0.025, 0x1f2430, 0.05, 1.04, 0.9)); // nostril
  for (const s of [-1, 1]) {
    g.add(sphere(0.05, 0xffffff, s * 0.11, 1.24, 0.76)); // horse sclera
    g.add(sphere(0.028, 0x1f2430, s * 0.11, 1.24, 0.8)); // horse pupil
    const ear = cone(0.07, 0.2, HORSE, s * 0.13, 1.42, 0.52);
    ear.rotation.z = -s * 0.25;
    g.add(ear); // big alert ears
  }
  g.add(box(0.12, 0.34, 0.5, 0x5d4037, 0, 1.3, 0.28)); // broad mane
  g.add(box(0.1, 0.16, 0.18, 0x5d4037, 0, 1.42, 0.5)); // forelock
  const tail = cone(0.08, 0.45, 0x5d4037, 0, 0.78, -0.7);
  tail.rotation.x = -Math.PI / 2.5;
  g.add(tail);
  g.add(teamPart(box(0.5, 0.08, 0.5, 0xb71c1c, 0, 1.0, -0.1), "dark")); // saddle blanket

  // Rider.
  g.add(teamPart(cyl(0.2, 0.26, 0.4, 0xfafafa, 0, 1.28, -0.1))); // tabard
  g.add(cyl(0.27, 0.27, 0.07, 0xf2c14e, 0, 1.12, -0.1)); // gold trim
  const head = sphere(0.3, SKIN, 0, 1.7, -0.1);
  addEyes(head, 0.3, 0.38, 0.11, "brave");
  // CR prince: brown goatee under the visored golden helm.
  const goatee = sphere(0.1, 0x5b3a21, 0, -0.2, 0.22);
  goatee.scale.set(0.9, 0.8, 0.6);
  head.add(goatee);
  g.add(head);
  if (ARABIC) {
    // Royal gold turban with an emerald jewel, in place of the helm.
    const t = turban(0.31, 0xf2c14e, 0x2fbf71);
    t.position.set(0, 1.7, -0.1);
    g.add(t);
  } else {
    // Golden helm with a raised visor and a team-colored feather.
    g.add(cyl(0.32, 0.34, 0.22, 0xf2c14e, 0, 1.9, -0.1)); // helmet band
    const helmDome = sphere(0.33, 0xf2c14e, 0, 2.0, -0.1);
    helmDome.scale.y = 0.72;
    g.add(helmDome);
    g.add(box(0.44, 0.08, 0.07, 0xd9a93f, 0, 2.02, 0.14)); // raised visor
    for (const s of [-1, 1]) {
      g.add(box(0.07, 0.2, 0.18, 0xf2c14e, s * 0.3, 1.74, -0.04)); // cheek guard
    }
  }
  const plume = teamPart(cone(0.1, 0.48, 0x3b82f6, 0, 2.32, -0.16));
  plume.rotation.x = 0.25;
  g.add(plume); // team-colored feather
  const offArm = new THREE.Group();
  offArm.position.set(-0.3, 1.34, -0.1);
  offArm.add(box(0.1, 0.26, 0.1, 0xfafafa, 0, -0.13, 0));
  g.add(offArm);

  // Lance.
  const arm = new THREE.Group();
  arm.position.set(0.32, 1.38, -0.05);
  arm.add(box(0.1, 0.24, 0.1, SKIN, 0, -0.12, 0));
  const lance = cyl(0.035, 0.07, 1.5, 0xd7ccc8);
  lance.rotation.x = Math.PI / 2;
  lance.position.set(0, -0.22, 0.7);
  arm.add(lance);
  const guard = cone(0.13, 0.18, 0xf2c14e);
  guard.rotation.x = -Math.PI / 2;
  guard.position.set(0, -0.22, 0.12);
  arm.add(guard);
  const tip = cone(0.06, 0.22, 0xb7c2cc);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, -0.22, 1.5);
  arm.add(tip);
  g.add(arm);
  return { group: g, arm, armRest: -0.12, swingAmp: 0.6, height: 2.2, legs, offArm };
}

function buildHogRider(): TroopRig {
  const g = new THREE.Group();
  const HOG = 0x8a6a52;
  // Four stout hog legs.
  const legs = [
    makeLeg(0x6f5340, -0.22, 0.36, 0.14, 0.34),
    makeLeg(0x6f5340, 0.22, 0.36, 0.14, 0.34),
    makeLeg(0x6f5340, -0.22, 0.36, 0.14, -0.34),
    makeLeg(0x6f5340, 0.22, 0.36, 0.14, -0.34),
  ];
  g.add(...legs);
  const hogBody = sphere(0.42, HOG, 0, 0.62, 0);
  hogBody.scale.set(0.85, 0.75, 1.4);
  g.add(hogBody);
  const snout = sphere(0.18, 0xc99b84, 0, 0.6, 0.66);
  snout.scale.set(1, 0.8, 0.7);
  g.add(snout);
  g.add(sphere(0.035, 0x1f2430, -0.06, 0.62, 0.78)); // nostril
  g.add(sphere(0.035, 0x1f2430, 0.06, 0.62, 0.78)); // nostril
  g.add(sphere(0.05, 0x1f2430, -0.13, 0.78, 0.56)); // hog eye
  g.add(sphere(0.05, 0x1f2430, 0.13, 0.78, 0.56)); // hog eye
  for (const s of [-1, 1]) {
    const tusk = cone(0.045, 0.16, 0xf5f2ea, s * 0.16, 0.52, 0.62);
    tusk.rotation.x = -0.9;
    g.add(tusk);
    const ear = cone(0.07, 0.16, 0x6f5340, s * 0.18, 0.92, 0.36);
    ear.rotation.z = -s * 0.5;
    g.add(ear);
  }

  // Bare-chested rider with top-knot + roaring beard (CR hog personality).
  const RIDER = 0x9c6644; // darker skin
  g.add(cyl(0.2, 0.24, 0.36, RIDER, 0, 1.06, -0.12)); // torso
  g.add(teamPart(cyl(0.26, 0.26, 0.08, 0x4e342e, 0, 0.9, -0.12), "dark")); // belt
  const head = sphere(0.28, RIDER, 0, 1.52, -0.12);
  addEyes(head, 0.28, 0.36, 0.08, "angry");
  g.add(head);
  if (ARABIC) {
    const t = turban(0.28, 0x6f5340, 0xf2c14e); // brown turban, gold jewel
    t.position.set(0, 1.52, -0.12);
    g.add(t);
  } else {
    // Top-knot bun (not a flat mohawk) — CR hog-rider hair cue.
    const knot = sphere(0.12, 0x2d1b0e, 0, 1.82, -0.18);
    knot.name = "topknot";
    g.add(knot);
    g.add(cyl(0.05, 0.05, 0.14, 0x2d1b0e, 0, 1.7, -0.16)); // knot stem
  }
  // Huge dark beard + wide-open shouting mouth.
  const beard = sphere(0.22, 0x2d1b0e, 0, 1.36, 0.04);
  beard.name = "beard";
  beard.scale.set(1.1, 0.85, 0.8);
  g.add(beard);
  const mouth = sphere(0.1, 0x3a1010, 0, 1.44, 0.24);
  mouth.name = "yell";
  mouth.scale.set(1.2, 0.75, 0.7);
  g.add(mouth);
  for (const s of [-1, 1]) {
    g.add(sphere(0.05, 0xf2c14e, s * 0.26, 1.5, -0.1)); // gold earring
  }
  // Leather bandolier across the bare chest.
  const strap = teamPart(box(0.09, 0.46, 0.05, 0x4e342e, 0, 1.06, 0.06));
  strap.rotation.z = 0.7;
  g.add(strap);
  g.add(sphere(0.045, 0xf2c14e, 0.12, 1.14, 0.1)); // strap stud

  const offArm = new THREE.Group();
  offArm.position.set(-0.26, 1.18, -0.12);
  offArm.add(box(0.1, 0.26, 0.1, RIDER, 0, -0.13, 0));
  g.add(offArm);

  // Massive war hammer (the whole point of the hog rider).
  const arm = new THREE.Group();
  arm.position.set(0.28, 1.2, -0.08);
  arm.add(box(0.1, 0.24, 0.1, RIDER, 0, -0.12, 0));
  arm.add(cyl(0.04, 0.04, 0.8, 0x5d4037, 0, 0.1, 0.1)); // haft
  arm.add(box(0.3, 0.3, 0.46, 0x78909c, 0, 0.52, 0.1)); // hammer head
  arm.add(cyl(0.165, 0.165, 0.48, 0x546e7a, 0, 0.52, 0.1)); // head band
  arm.add(box(0.32, 0.08, 0.48, 0x546e7a, 0, 0.66, 0.1)); // top plate
  g.add(arm);
  return { group: g, arm, armRest: -0.4, swingAmp: 1.8, height: 1.95, legs, offArm };
}

/**
 * Islamic mode's Hog Rider: a CAMEL RAIDER — a desert warrior on a tasselled
 * dromedary. Same role (fast river-jumping building-seeker), new silhouette:
 * long-necked camel with a saddled hump, and a turbaned rider whose raised
 * scimitar is the rig's attack arm. The neck bobs and the tail flicks in idle.
 */
function buildCamelRaider(): TroopRig {
  const g = new THREE.Group();
  const CAMEL = 0xc9a165, CAMELDK = 0xa9834e;
  const GOLD = THEME.goldLight, CLOTH = BRICK, CLOTH2 = THEME.deepBlue;

  // Four tall slender legs (front pair, back pair) for the quadruped gait.
  const legs = [
    makeLeg(CAMELDK, -0.2, 0.62, 0.14, 0.38),
    makeLeg(CAMELDK, 0.2, 0.62, 0.14, 0.38),
    makeLeg(CAMELDK, -0.2, 0.62, 0.14, -0.42),
    makeLeg(CAMELDK, 0.2, 0.62, 0.14, -0.42),
  ];
  g.add(...legs);

  // Barrel body with the signature hump.
  const body = sphere(0.44, CAMEL, 0, 0.86, -0.05);
  body.scale.set(0.9, 0.8, 1.5);
  g.add(body);
  const hump = sphere(0.3, CAMEL, 0, 1.16, -0.25);
  g.add(hump);
  const tail = cyl(0.035, 0.025, 0.4, CAMELDK, 0, 0.92, -0.72);
  tail.name = "tail";
  tail.rotation.x = 0.5;
  g.add(tail);

  // Long upright neck (a pivoted group so it can bob while walking).
  const neck = new THREE.Group();
  neck.name = "neck";
  neck.position.set(0, 0.98, 0.52);
  const nape = cyl(0.13, 0.16, 0.62, CAMEL, 0, 0.26, 0.1);
  nape.rotation.x = -0.25;
  neck.add(nape);
  const chead = sphere(0.17, CAMEL, 0, 0.62, 0.22);
  chead.scale.set(0.9, 0.85, 1.25);
  neck.add(chead);
  const muzzle = sphere(0.1, CAMELDK, 0, 0.56, 0.42);
  muzzle.scale.set(0.8, 0.65, 0.9);
  neck.add(muzzle);
  for (const s of [-1, 1]) {
    neck.add(sphere(0.035, 0x1f2430, s * 0.08, 0.68, 0.34)); // sleepy eye
    const ear = cone(0.04, 0.1, CAMELDK, s * 0.1, 0.78, 0.14);
    ear.rotation.z = -s * 0.35;
    neck.add(ear);
  }
  // Bridle with a gold cheek medallion.
  neck.add(cyl(0.105, 0.105, 0.04, CLOTH, 0, 0.58, 0.42));
  neck.add(sphere(0.035, GOLD, 0, 0.52, 0.5));
  g.add(neck);

  // Saddle cloth over the hump with a gold hem and tassels.
  const drape = teamPart(box(0.72, 0.34, 0.9, CLOTH, 0, 1.06, -0.12));
  g.add(drape);
  g.add(box(0.76, 0.08, 0.94, GOLD, 0, 0.9, -0.12)); // gold hem
  for (const s of [-1, 1]) {
    g.add(cone(0.05, 0.14, GOLD, s * 0.34, 0.78, 0.18)); // tassels
    g.add(cone(0.05, 0.14, GOLD, s * 0.34, 0.78, -0.42));
  }
  g.add(box(0.34, 0.1, 0.4, 0x6d4c41, 0, 1.28, -0.12)); // saddle seat

  // Turbaned desert raider seated on the saddle.
  const RIDER = 0x9c6644;
  g.add(cyl(0.17, 0.21, 0.34, THEME.cream, 0, 1.5, -0.12)); // robe
  g.add(teamPart(cyl(0.22, 0.22, 0.06, CLOTH2, 0, 1.34, -0.12), "dark")); // sash
  const head = sphere(0.24, RIDER, 0, 1.88, -0.12);
  addEyes(head, 0.24, 0.38, 0.1, "angry");
  const beard = sphere(0.16, 0x2d1b0e, 0, -0.14, 0.12);
  beard.scale.set(1.0, 0.75, 0.7);
  head.add(beard);
  g.add(head);
  const t = turban(0.25, CLOTH, GOLD);
  t.position.set(0, 1.88, -0.12);
  g.add(t);

  // Off hand grips the reins.
  const offArm = new THREE.Group();
  offArm.position.set(-0.24, 1.56, -0.08);
  offArm.add(box(0.09, 0.24, 0.09, RIDER, 0, -0.12, 0));
  g.add(offArm);
  const rein = cyl(0.012, 0.012, 0.62, 0x4e342e, -0.2, 1.42, 0.22);
  rein.rotation.x = 0.9;
  g.add(rein);

  // Scimitar arm raised high — the raider's attack.
  const arm = new THREE.Group();
  arm.position.set(0.26, 1.6, -0.08);
  arm.add(box(0.09, 0.24, 0.09, RIDER, 0, -0.12, 0));
  const sword = scimitar();
  sword.position.set(0, -0.26, 0.04);
  arm.add(sword);
  g.add(arm);

  return {
    group: g, arm, armRest: -0.4, swingAmp: 1.8, height: 2.15, legs, offArm,
    extras: (time, phase) => {
      neck.rotation.x = Math.sin(time * 4 + phase) * 0.08;
      tail.rotation.z = Math.sin(time * 5 + phase) * 0.3;
    },
  };
}

/**
 * Islamic mode's Balloon: a FIRE-KITE — a great paper war-kite with gold ribs
 * and streaming cloth tails, carrying a hanging brazier that drops fire pots.
 * Same role (slow flying building-seeker with a death blast), new silhouette:
 * a diamond canopy instead of a balloon envelope. Tails flutter in idle.
 */
/** How far the fire kite's sail tips back from upright (radians). */
const KITE_TILT = 1.0;

const KITE_FWD = new THREE.Vector3();

/**
 * The yaw (in `rig`'s own frame) that turns a child toward the camera's
 * horizontal view direction, whichever way the unit faces: the host's camera
 * sits at +z, an online guest's at -z (cameraZForView). Reads the rig's live
 * world transform, so the lean, the body twist and the facing all count.
 */
export function yawTowardCamera(rig: THREE.Object3D): number {
  rig.getWorldDirection(KITE_FWD);
  const worldYaw = Math.atan2(KITE_FWD.x, KITE_FWD.z);
  const camYaw = cameraZForView() >= 0 ? 0 : Math.PI;
  let d = camYaw - worldYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function buildFireKite(): TroopRig {
  const g = new THREE.Group();
  // Turquoise silk on gold spars (the edition's colours, never a team hue);
  // the ONE team slot is the pair of cloth tails.
  const PAPER = THEME.turquoise;
  const GOLD = THEME.goldLight, CLOTH = 0xffffff;

  // Diamond canopy: a flattened octahedron with gold spars.
  const canopy = new THREE.Mesh(
    cachedGeo("kite-canopy", () => new THREE.OctahedronGeometry(0.72)),
    toon(PAPER),
  );
  canopy.scale.set(0.8, 1.1, 0.26);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  // The sail flies tipped back toward the sky, and its mount turns it to the
  // camera every frame (yawTowardCamera), so the battle camera sees its face
  // whichever way the kite flies: your own kite flies away from you, and a
  // sail tipped in the rig's frame showed you its edge. An upright sail was
  // a thin edge from above. The mount carries the sail and its tails.
  const mount = new THREE.Group();
  mount.name = "kite-mount";
  mount.position.set(0, 1.5, 0);
  mount.userData.animated = true; // the bake keeps it a node of its own
  g.add(mount);
  const sail = new THREE.Group();
  sail.name = "kite-sail";
  sail.rotation.x = -KITE_TILT;
  sail.add(canopy);
  sail.add(box(0.06, 1.5, 0.05, GOLD, 0, 0, 0.1)); // vertical spar
  sail.add(box(1.1, 0.06, 0.05, GOLD, 0, 0, 0.1)); // cross spar
  sail.add(diamond(0.12, GOLD, 0, 0, 0.16)); // center boss
  mount.add(sail);
  // Crescent finial at the kite's crown.
  const finial = new THREE.Mesh(
    cachedGeo("crescent:0.12", () => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 0.12, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0.05, 0, 0.1, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
    }),
    toon(GOLD),
  );
  finial.position.set(0, 0.86, 0);
  finial.castShadow = true;
  sail.add(finial);

  // Fluttering cloth tails off the kite's lower point.
  const tails: THREE.Mesh[] = [];
  for (const [dx, len, color] of [
    [-0.17, 0.82, CLOTH],
    [0, 0.6, GOLD],
    [0.17, 0.82, CLOTH],
  ] as const) {
    // From the sail's lower point (tipped forward by KITE_TILT), in the mount's frame.
    const tail = box(color === CLOTH ? 0.15 : 0.08, len, 0.04, color, dx, -0.79 * Math.cos(KITE_TILT) - len / 2, 0.79 * Math.sin(KITE_TILT));
    tail.name = "kite-tail";
    if (color === CLOTH) teamPart(tail); // the two cloth tails fly team colours
    tails.push(tail);
    mount.add(tail);
  }

  // Hanging brazier basket on ropes below the canopy.
  for (const s of [-1, 1]) {
    const rope = cyl(0.014, 0.014, 0.42, 0xd7ccc8, s * 0.16, 0.68, 0.06);
    rope.rotation.z = -s * 0.3;
    g.add(rope);
  }
  const basket = cyl(0.22, 0.16, 0.24, 0x8d6e63, 0, 0.42, 0.06);
  g.add(basket);
  g.add(cyl(0.23, 0.23, 0.05, GOLD, 0, 0.55, 0.06)); // gold rim
  // Glowing coals in the brazier.
  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glow(0xff8a3c, 2));
  coals.position.set(0, 0.54, 0.06);
  g.add(coals);

  // Fire-pot dropping arm below the basket (the attack).
  const arm = new THREE.Group();
  arm.position.set(0.2, 0.44, 0.12);
  arm.add(box(0.06, 0.18, 0.06, 0x8d6e63, 0, -0.09, 0));
  const pot = sphere(0.13, 0x5d4037, 0, -0.26, 0.03);
  arm.add(pot);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow(0xffb300, 2));
  flame.position.set(0, -0.12, 0.03);
  arm.add(flame);
  g.add(arm);

  return {
    group: g, arm, armRest: -0.3, swingAmp: 1.4, height: 2.3, hover: 1.7,
    extras: (time, phase) => {
      mount.rotation.y = yawTowardCamera(g);
      for (let i = 0; i < tails.length; i++) {
        tails[i].rotation.x = Math.sin(time * 6 + phase + i * 1.1) * 0.35;
      }
      flame.scale.setScalar(1 + Math.sin(time * 12 + phase) * 0.25);
    },
  };
}

function buildPekka(): TroopRig {
  const g = new THREE.Group();
  const legs = [
    makeLeg(0x10141c, -0.26, 0.4, 0.26),
    makeLeg(0x10141c, 0.26, 0.4, 0.26),
  ];
  g.add(...legs);
  // Hunched slab of armor: shoulders far wider than the waist, torso
  // pitched forward so the whole machine looms over its sword.
  g.add(box(0.6, 0.3, 0.46, 0x141b29, 0, 0.5, 0)); // narrow waist
  const torso = box(1.02, 0.56, 0.6, 0x1a2333, 0, 0.84, 0.04);
  torso.rotation.x = 0.12;
  g.add(torso);
  g.add(box(0.62, 0.1, 0.6, 0x39455c, 0, 1.06, 0.08)); // chest plate ridge
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(0xff4fd8, 1.8));
  chest.position.set(0, 0.8, 0.34);
  g.add(chest);
  // Helmet sunk straight into the shoulder line — no neck at all.
  g.add(box(0.92, 0.6, 0.74, 0x222f47, 0, 1.34, 0.1));
  // Wide burning eye-slit (unlit, so it stays hot pink).
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.05), glow(0xff4fd8, 2.4));
  eye.position.set(0, 1.36, 0.48);
  g.add(eye);
  for (const s of [-1, 1]) {
    // Swept butterfly-wing horns, P.E.K.K.A's signature silhouette.
    const horn = cone(0.2, 1.05, 0xb7c2cc, s * 0.66, 1.84, 0.06);
    horn.rotation.z = -s * 1.05;
    horn.scale.z = 0.45; // bladed, not round
    g.add(horn);
    const hornTip = cone(0.08, 0.42, 0xdde4ec, s * 1.1, 2.04, 0.06);
    hornTip.rotation.z = -s * 1.25;
    hornTip.scale.z = 0.45;
    g.add(hornTip);
    // Pauldrons that ride level with the helmet sell the hunch.
    const pauldron = teamPart(sphere(0.3, 0x2a3752, s * 0.6, 1.16, 0.04));
    pauldron.scale.y = 0.8;
    g.add(pauldron);
    g.add(cone(0.11, 0.3, 0xb7c2cc, s * 0.64, 1.4, 0.04)); // shoulder spike
    g.add(sphere(0.09, 0xb7c2cc, s * 0.4, 1.0, 0.32)); // chest rivet
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.72, 1.0, 0.04);
  offArm.add(box(0.26, 0.52, 0.26, 0x1a2333, 0, -0.26, 0));
  offArm.add(sphere(0.17, 0x39455c, 0, -0.58, 0)); // gauntlet
  g.add(offArm);

  // Two-handed great sword, carried high so the blade clears the helm.
  const arm = new THREE.Group();
  arm.position.set(0.72, 1.12, 0.04);
  arm.add(box(0.26, 0.48, 0.26, 0x1a2333, 0, -0.24, 0));
  arm.add(box(0.5, 0.1, 0.18, 0x39455c, 0, -0.5, 0)); // crossguard
  arm.add(box(0.16, 1.5, 0.3, 0xdde4ec, 0, 0.26, 0)); // huge blade
  arm.add(box(0.06, 1.48, 0.05, 0x9aa8bd, 0, 0.26, 0.14)); // fuller line
  // Glowing energy edges (unlit → bloom-ready).
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.5, 0.08), glow(0xff6fe0, 2.2));
    edge.position.set(s * 0.09, 0.26, 0);
    arm.add(edge);
  }
  arm.add(cone(0.16, 0.3, 0xdde4ec, 0, 1.14, 0)); // blade point
  g.add(arm);
  return { group: g, arm, armRest: -0.62, swingAmp: 1.8, height: 2.4, legs, offArm };
}

/** Princess archer perched on top of each crown tower. */
export function buildTowerPrincess(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.22, 0.38, 0.52, 0xe91e63, 0, 0.32, 0)); // gown
  g.add(cyl(0.3, 0.3, 0.07, 0xf2c14e, 0, 0.16, 0)); // gold hem
  const head = sphere(0.28, SKIN, 0, 0.84, 0);
  addEyes(head, 0.28, 0.36, 0.1, "cute");
  g.add(head);
  const hair = sphere(0.3, 0xf6a13b, 0, 0.92, -0.03);
  hair.scale.set(1, 0.66, 1);
  g.add(hair);
  const braid = cyl(0.07, 0.045, 0.5, 0xf6a13b, 0.22, 0.62, -0.12);
  braid.rotation.z = 0.3;
  g.add(braid);
  g.add(cyl(0.12, 0.14, 0.12, 0xf2c14e, 0, 1.1, 0)); // tiara
  g.add(sphere(0.045, 0x4fd8ff, 0, 1.16, 0.1)); // tiara gem

  const offArm = new THREE.Group();
  offArm.position.set(0.26, 0.54, 0);
  offArm.add(box(0.1, 0.24, 0.1, SKIN, 0, -0.12, 0));
  g.add(offArm);

  // Bow arm (same thrust-on-release rig as the field archer).
  const arm = new THREE.Group();
  arm.position.set(-0.26, 0.58, 0.05);
  arm.rotation.y = -0.55; // yawed outboard so the bow clears her face
  arm.add(box(0.1, 0.24, 0.1, SKIN, 0, -0.12, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.03, 8, 16, Math.PI),
    toon(0x8d6e63),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.32, 0.2);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.012, 0.58, 0.012, 0xe8e3d8, 0, -0.32, 0.2)); // string
  g.add(arm);
  return { group: g, arm, armRest: -0.85, swingAmp: 0.7, height: 1.2, offArm };
}

/**
 * Cannoneer tower troop: a stocky gunner in a kettle helm with a stubby
 * mortar-cannon shouldered like a bazooka. Slow, heavy, splashing shots.
 */
export function buildTowerCannoneer(): TroopRig {
  const g = new THREE.Group();
  const COAT = 0x5a4a8c, IRON = 0x3a4150, GOLD = 0xf2c14e;
  g.add(cyl(0.3, 0.4, 0.5, COAT, 0, 0.32, 0)); // barrel-chested coat
  g.add(cyl(0.36, 0.36, 0.08, 0x3a2a1a, 0, 0.2, 0)); // belt
  g.add(box(0.12, 0.12, 0.05, GOLD, 0, 0.2, 0.34)); // buckle
  const head = sphere(0.28, SKIN, 0, 0.84, 0);
  addEyes(head, 0.28, 0.34, 0.08, "brave");
  g.add(head);
  g.add(box(0.3, 0.07, 0.07, 0x4a3020, 0, 0.72, 0.26)); // bushy moustache
  // Kettle helm with a wide brim.
  const helm = sphere(0.31, IRON, 0, 0.96, 0);
  helm.scale.y = 0.75;
  g.add(helm);
  g.add(cyl(0.38, 0.4, 0.06, IRON, 0, 0.9, 0)); // brim
  g.add(sphere(0.06, GOLD, 0, 1.2, 0)); // helm knob
  for (const s of [-1, 1]) g.add(sphere(0.13, IRON, s * 0.34, 0.6, 0)); // pauldrons

  const offArm = new THREE.Group();
  offArm.position.set(-0.32, 0.56, 0);
  offArm.add(box(0.11, 0.26, 0.11, COAT, 0, -0.13, 0));
  g.add(offArm);

  // Shouldered mortar-cannon (the attack arm): a fat short barrel.
  const arm = new THREE.Group();
  arm.position.set(0.32, 0.6, 0.02);
  arm.add(box(0.11, 0.26, 0.11, COAT, 0, -0.13, 0));
  const barrel = cyl(0.13, 0.16, 0.62, IRON, 0.02, 0.1, 0.24);
  barrel.rotation.x = Math.PI / 2 - 0.35; // lobbing angle
  arm.add(barrel);
  arm.add(cyl(0.18, 0.18, 0.08, GOLD, 0.02, 0.24, 0.5).rotateX(Math.PI / 2 - 0.35)); // muzzle band
  arm.add(sphere(0.12, 0x20262b, 0.02, -0.18, -0.02)); // breech ball
  g.add(arm);
  return { group: g, arm, armRest: -0.35, swingAmp: 0.6, height: 1.25, offArm };
}

/**
 * Dagger Duchess tower troop: a raven-haired noblewoman in a violet gown
 * who flings a burst of daggers, then reloads from the bandolier at her hip.
 */
export function buildTowerDuchess(): TroopRig {
  const g = new THREE.Group();
  const GOWN = 0x6a1fa8, GOWNDK = 0x4a1478, GOLD = 0xf2c14e, STEEL = 0xdde4ec;
  g.add(cyl(0.2, 0.4, 0.54, GOWN, 0, 0.3, 0)); // gown
  g.add(cyl(0.32, 0.32, 0.06, GOLD, 0, 0.14, 0)); // gold hem
  g.add(cyl(0.22, 0.22, 0.06, GOWNDK, 0, 0.5, 0)); // waist sash
  // Dagger bandolier across the hip.
  for (let i = 0; i < 4; i++) {
    const dag = box(0.03, 0.12, 0.02, STEEL, -0.16 + i * 0.1, 0.42 - i * 0.03, 0.2);
    dag.rotation.z = 0.5;
    g.add(dag);
  }
  const head = sphere(0.27, SKIN, 0, 0.84, 0);
  addEyes(head, 0.27, 0.36, 0.1, "wicked");
  g.add(head);
  const hair = sphere(0.3, 0x1c1226, 0, 0.9, -0.04);
  hair.scale.set(1, 0.8, 1.05);
  g.add(hair);
  const fall = cyl(0.12, 0.08, 0.5, 0x1c1226, 0, 0.62, -0.2); // long hair fall
  fall.rotation.x = 0.2;
  g.add(fall);
  g.add(cyl(0.14, 0.16, 0.08, GOLD, 0, 1.1, 0)); // tiara
  g.add(sphere(0.04, 0xff4fd8, 0, 1.15, 0.12)); // tiara gem

  const offArm = new THREE.Group();
  offArm.position.set(-0.26, 0.56, 0);
  offArm.add(box(0.09, 0.24, 0.09, GOWN, 0, -0.12, 0));
  offArm.add(box(0.03, 0.22, 0.02, STEEL, 0, -0.28, 0.06)); // spare dagger
  g.add(offArm);

  // Throwing arm with a dagger ready.
  const arm = new THREE.Group();
  arm.position.set(0.26, 0.58, 0.02);
  arm.add(box(0.09, 0.24, 0.09, GOWN, 0, -0.12, 0));
  const blade = box(0.035, 0.28, 0.02, STEEL, 0, -0.32, 0.08);
  blade.rotation.x = -0.3;
  arm.add(blade);
  arm.add(box(0.06, 0.06, 0.04, GOLD, 0, -0.2, 0.08)); // guard
  g.add(arm);
  return { group: g, arm, armRest: -0.7, swingAmp: 1.2, height: 1.2, offArm };
}

/** The king himself, enthroned on the king tower. */
export function buildTowerKing(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.48, 0.66, 0x7a1f3d, 0, 0.38, 0)); // royal robe
  g.add(cyl(0.44, 0.46, 0.09, 0xf2c14e, 0, 0.14, 0)); // gold trim
  const sash = box(0.18, 0.54, 0.05, 0xb71c1c, 0.1, 0.44, 0.34);
  sash.rotation.z = -0.3;
  g.add(sash);
  const head = sphere(0.36, SKIN, 0, 1.04, 0);
  addEyes(head, 0.36, 0.34, 0.08, "calm");
  g.add(head);
  const beard = sphere(0.3, 0xe8e3d8, 0, 0.86, 0.14);
  beard.scale.set(1, 0.75, 0.7);
  g.add(beard);
  // Big golden crown.
  g.add(cyl(0.3, 0.34, 0.2, 0xf2c14e, 0, 1.36, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(cone(0.055, 0.16, 0xf2c14e, Math.cos(a) * 0.26, 1.52, Math.sin(a) * 0.26));
  }
  g.add(sphere(0.055, 0xe53935, 0, 1.4, 0.3)); // crown jewel

  const offArm = new THREE.Group();
  offArm.position.set(-0.44, 0.66, 0);
  offArm.add(box(0.13, 0.28, 0.13, 0x7a1f3d, 0, -0.14, 0));
  g.add(offArm);

  // Sword arm raised in command.
  const arm = new THREE.Group();
  arm.position.set(0.44, 0.7, 0);
  arm.add(box(0.13, 0.28, 0.13, 0x7a1f3d, 0, -0.14, 0));
  arm.add(box(0.22, 0.05, 0.08, 0x8d6e63, 0, -0.3, 0)); // guard
  arm.add(box(0.05, 0.55, 0.1, 0xdde4ec, 0, -0.02, 0)); // blade
  g.add(arm);
  return { group: g, arm, armRest: -0.4, swingAmp: 1.2, height: 1.65, offArm };
}

function buildFirecracker(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x4a2c1a, -0.11, 0.26, 0.13), makeLeg(0x4a2c1a, 0.11, 0.26, 0.13)];
  g.add(...legs);
  // Tan/olive outfit with dark gloves (CR firecracker palette).
  g.add(cyl(0.23, 0.3, 0.4, 0x8a7a4a, 0, 0.46, 0));
  g.add(cyl(0.31, 0.31, 0.07, 0x5a4a2a, 0, 0.3, 0)); // belt
  const head = sphere(0.3, SKIN, 0, 0.94, 0);
  addEyes(head, 0.3, 0.36, 0.08, "brave");
  g.add(head);
  // Magenta-pink ponytail under a blue sweatband.
  const hair = sphere(0.31, 0xe0559d, 0, 1.02, -0.02);
  hair.scale.set(1, 0.62, 1);
  g.add(hair);
  const pony = cyl(0.1, 0.055, 0.5, 0xe0559d, 0, 1.12, -0.28);
  pony.name = "ponytail";
  pony.rotation.x = 0.55;
  g.add(pony);
  const band = cyl(0.31, 0.31, 0.1, 0x2f6bd8, 0, 1.0, 0);
  band.name = "headband";
  teamPart(band);
  g.add(band);

  // Rocket backpack — spare fireworks poking over her shoulders give a
  // spiky back silhouette no other small troop has.
  g.add(box(0.32, 0.34, 0.16, 0x5a4a2a, 0, 0.6, -0.26));
  for (const [i, col] of [0x9c4fd8, 0x3fbf6a, 0xffd54f].entries()) {
    const rx = -0.09 + i * 0.09;
    g.add(cyl(0.05, 0.05, 0.34, col, rx, 0.88, -0.26));
    g.add(cone(0.055, 0.12, 0xdde4ec, rx, 1.1, -0.26));
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.3, 0.62, 0);
  offArm.add(box(0.11, 0.26, 0.11, 0x2b2333, 0, -0.13, 0)); // dark glove
  g.add(offArm);

  // Comically oversized firework launcher tube on the shoulder — longer
  // than she is tall, with carnival stripe bands.
  const arm = new THREE.Group();
  arm.position.set(0.32, 0.66, 0.05);
  arm.add(box(0.11, 0.26, 0.11, 0x2b2333, 0, -0.13, 0)); // dark glove
  const tube = cyl(0.2, 0.2, 0.98, 0x8d6e63, 0, -0.24, 0.4);
  tube.name = "launcher";
  tube.rotation.x = Math.PI / 2;
  arm.add(tube);
  arm.add(teamPart(cyl(0.205, 0.205, 0.1, 0xd84e4e, 0, -0.24, 0.16).rotateX(Math.PI / 2))); // stripe
  arm.add(teamPart(cyl(0.205, 0.205, 0.1, 0xd84e4e, 0, -0.24, 0.56).rotateX(Math.PI / 2))); // stripe
  arm.add(cyl(0.23, 0.23, 0.07, 0xf2c14e, 0, -0.24, 0.86).rotateX(Math.PI / 2)); // gold rim
  arm.add(sphere(0.11, 0xffd54f, 0, -0.24, 0.94)); // packed firework
  const fuse = cyl(0.012, 0.012, 0.14, 0x4a4a4a, 0.0, -0.08, 0.24);
  fuse.rotation.z = 0.5;
  arm.add(fuse);
  g.add(arm);
  return { group: g, arm, armRest: -0.2, swingAmp: 0.5, height: 1.35, legs, offArm };
}

function buildMagicArcher(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x123c30, -0.12, 0.3, 0.14), makeLeg(0x123c30, 0.12, 0.3, 0.14)];
  g.add(...legs);
  g.add(cyl(0.24, 0.36, 0.56, 0x1f7a5f, 0, 0.56, 0)); // long mystic robe
  g.add(teamPart(cyl(0.3, 0.32, 0.07, 0x14523f, 0, 0.42, 0))); // sash
  const head = sphere(0.28, SKIN, 0, 1.06, 0);
  addEyes(head, 0.28, 0.36, 0.08, "calm");
  // Signature teal-glowing eyes over the pupils.
  for (const s of [-1, 1]) {
    const gleam = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), glow(0x4dead1, 2));
    gleam.name = "eyeglow";
    gleam.position.set(s * 0.28 * 0.36, 0.28 * 0.08, 0.28 * 0.99);
    head.add(gleam);
  }
  g.add(head);
  // Swept white-silver fringe peeking out under the hood.
  const fringe = sphere(0.1, 0xdfe6ee, 0, 1.24, 0.18);
  fringe.scale.set(1.6, 0.5, 0.8);
  g.add(fringe);
  // Pointed hood draped over the head.
  const hood = sphere(0.32, 0x1a6350, 0, 1.12, -0.04);
  hood.scale.set(1, 0.9, 1);
  g.add(hood);
  g.add(cone(0.2, 0.4, 0x1a6350, 0, 1.42, -0.06)); // hood point

  const offArm = new THREE.Group();
  offArm.position.set(0.32, 0.76, 0);
  offArm.add(box(0.11, 0.28, 0.11, 0x1f7a5f, 0, -0.14, 0));
  g.add(offArm);

  // Bow arm out front, holding a glowing nocked arrow.
  const arm = new THREE.Group();
  arm.position.set(-0.32, 0.78, 0.05);
  arm.add(box(0.11, 0.28, 0.11, 0x1f7a5f, 0, -0.14, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.035, 8, 16, Math.PI),
    toon(0x37206b),
  );
  teamPart(bow, "dark");
  bow.castShadow = true;
  bow.position.set(0, -0.28, 0.16);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.015, 0.7, 0.015, 0xb39ddb, 0, -0.28, 0.16)); // string
  const glowArrow = cyl(0.03, 0.03, 0.56, 0x35c8b4, 0, -0.28, 0.3);
  glowArrow.rotation.x = Math.PI / 2;
  glowArrow.material = glow(0x53f0dc); // cyan piercing shot (CR signature)
  arm.add(glowArrow);
  const magicTip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(0x9ffcf0, 2));
  magicTip.position.set(0, -0.28, 0.56);
  arm.add(magicTip);
  g.add(arm);
  return { group: g, arm, armRest: -1.0, swingAmp: 0.7, height: 1.5, legs, offArm };
}

/** BATS (art bible 7): violet, with big ears, membrane wings and amber eyes; a team collar. */
function buildBat(): TroopRig {
  const g = new THREE.Group();
  const VIOLET = 0x8257c4, VIOLETDK = 0x55388f, EAR = 0xe8a6cf;
  const body = sphere(0.18, VIOLET, 0, 0.3, 0);
  body.scale.set(1, 1.05, 0.9);
  g.add(body);
  for (const s of [-1, 1]) {
    const ear = cone(0.08, 0.22, VIOLETDK, s * 0.09, 0.5, 0);
    ear.rotation.z = -s * 0.25;
    g.add(ear);
    const inner = cone(0.045, 0.14, EAR, s * 0.09, 0.49, 0.04);
    inner.rotation.z = -s * 0.25;
    g.add(inner);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(0xffdf5a, 2));
    eye.position.set(s * 0.07, 0.33, 0.15);
    g.add(eye);
    g.add(box(0.025, 0.055, 0.02, 0xf0e8d6, s * 0.035, 0.22, 0.14)); // fang
  }
  g.add(...teamCollar(0.12, 0.2, 0.0, 0.1));
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = membraneWing(s, 0.36, 0.28, VIOLETDK, 0x3e2870);
    wing.position.set(s * 0.13, 0.33, -0.04);
    wing.rotation.z = s * 0.4;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.4, amp: s * 0.9 });
  }
  return { group: g, arm: null, armRest: 0, swingAmp: 0, height: 0.75, hover: 0.85, wings };
}

/**
 * MINIONS (art bible 7): purple-grey flying imps, never signature blue: one
 * ivory horn, pointed ears, a big snub nose and grey membrane wings; the ONE
 * team slot is a bandana with its tails flying behind.
 */
function buildMinion(): TroopRig {
  const g = new THREE.Group();
  const SKINP = 0x9a8fb2, SKINDK = 0x6c6286, WING = 0x7d7396, IVORY = 0xf0e6cc;
  const body = sphere(0.21, SKINP, 0, 0.36, 0);
  body.scale.set(1, 1.15, 0.92);
  g.add(body);
  g.add(box(0.2, 0.06, 0.08, 0x5a4a3a, 0, 0.24, 0.12)); // belt
  const head = sphere(0.18, SKINP, 0, 0.67, 0.03);
  g.add(head);
  g.add(...teamBandana(0.17, 0.74, 0.03));
  g.add(cone(0.055, 0.18, IVORY, 0, 0.9, 0)); // horn
  const nose = sphere(0.06, 0xb3a8c8, 0, 0.64, 0.2);
  g.add(nose);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(0xfff1a8, 2));
    eye.position.set(s * 0.075, 0.7, 0.16);
    g.add(eye);
    const ear = cone(0.05, 0.16, SKINDK, s * 0.19, 0.7, 0);
    ear.rotation.z = -s * 1.1;
    g.add(ear);
  }
  const offArm = new THREE.Group();
  offArm.position.set(-0.19, 0.44, 0);
  offArm.add(box(0.07, 0.19, 0.07, SKINP, 0, -0.09, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.19, 0.44, 0.04);
  arm.add(box(0.07, 0.19, 0.07, SKINP, 0, -0.09, 0));
  g.add(arm);
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = membraneWing(s, 0.42, 0.32, WING, SKINDK);
    wing.position.set(s * 0.16, 0.56, -0.1);
    wing.rotation.z = s * 0.45;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.45, amp: s * 0.8 });
  }
  return { group: g, arm, armRest: -0.4, swingAmp: 0.8, height: 1.0, hover: 0.88, wings, offArm };
}

function buildExecutioner(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x2f3a2c, -0.16, 0.3, 0.18), makeLeg(0x2f3a2c, 0.16, 0.3, 0.18)];
  g.add(...legs);
  g.add(cyl(0.34, 0.42, 0.5, 0x3f7a4a, 0, 0.56, 0)); // burly tunic
  g.add(teamPart(cyl(0.44, 0.44, 0.1, 0x2c5836, 0, 0.36, 0))); // belt
  const head = sphere(0.3, SKIN, 0, 1.06, 0);
  addEyes(head, 0.3, 0.34, 0.06, "angry");
  g.add(head);
  const hood = sphere(0.34, 0x2f5d3a, 0, 1.12, -0.04);
  hood.scale.set(1, 0.95, 1);
  g.add(hood);
  g.add(cone(0.18, 0.34, 0x2f5d3a, 0, 1.42, -0.06)); // hood point
  for (const s of [-1, 1]) g.add(teamPart(sphere(0.16, 0x2c5836, s * 0.4, 0.78, 0))); // shoulder pads

  const offArm = new THREE.Group();
  offArm.position.set(-0.42, 0.74, 0);
  offArm.add(box(0.14, 0.34, 0.14, SKIN, 0, -0.17, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.42, 0.76, 0.05);
  arm.add(box(0.14, 0.34, 0.14, SKIN, 0, -0.17, 0)); // forearm
  const handle = cyl(0.04, 0.04, 0.6, 0x6d4c41, 0, -0.1, 0.3);
  handle.rotation.x = Math.PI / 2;
  arm.add(handle);
  arm.add(box(0.1, 0.4, 0.34, 0xc9d2da, 0, -0.1, 0.6)); // wide axe head
  g.add(arm);
  return { group: g, arm, armRest: -0.2, swingAmp: 0.9, height: 1.55, legs, offArm };
}

function buildMegaKnight(): TroopRig {
  const g = new THREE.Group();
  const DARK = 0x35281e,
    STEEL = 0xa89a86,
    DARKSTEEL = 0x4d3d2c,
    GOLD = 0xe8b84b,
    SPIKE = 0xe3cba4;

  // Bulky legs.
  const legs = [makeLeg(DARK, -0.22, 0.34, 0.24), makeLeg(DARK, 0.22, 0.34, 0.24)];
  g.add(...legs);

  // Massive armoured torso.
  g.add(box(0.8, 0.6, 0.58, DARK, 0, 0.66, 0));
  g.add(box(0.62, 0.44, 0.5, STEEL, 0, 0.7, 0.05)); // chest plate
  g.add(diamond(0.13, GOLD, 0, 0.8, 0.31)); // chest gem
  g.add(cyl(0.46, 0.52, 0.14, DARKSTEEL, 0, 0.32, 0)); // skirt

  // Spiked pauldrons.
  for (const sx of [-1, 1]) {
    g.add(teamPart(sphere(0.27, DARKSTEEL, sx * 0.52, 0.96, 0), "dark"));
    for (const a of [-1, 0, 1]) {
      const sp = cone(0.08, 0.28, SPIKE, sx * 0.52, 1.14, a * 0.14);
      sp.rotation.z = -sx * 0.35;
      g.add(sp);
    }
  }

  // Horned helm + fierce eyes.
  const head = sphere(0.34, DARKSTEEL, 0, 1.22, 0);
  addEyes(head, 0.34, 0.3, 0.06, "angry");
  g.add(head);
  g.add(teamPart(cyl(0.37, 0.4, 0.16, DARK, 0, 1.36, 0))); // helm band
  for (const sx of [-1, 1]) {
    const horn = cone(0.08, 0.34, GOLD, sx * 0.24, 1.5, 0);
    horn.rotation.z = sx * 0.55;
    g.add(horn);
  }

  // Spiked fists — the knuckle spikes the player asked for.
  const makeFist = (mx: number): THREE.Group => {
    const a = new THREE.Group();
    a.position.set(mx * 0.52, 0.78, 0.05);
    a.add(box(0.22, 0.36, 0.22, DARK, 0, -0.15, 0)); // forearm
    a.add(sphere(0.22, STEEL, 0, -0.36, 0.04)); // gauntlet fist
    for (const dx of [-0.13, 0, 0.13]) {
      const sp = cone(0.06, 0.24, SPIKE, dx, -0.36, 0.24);
      sp.rotation.x = Math.PI / 2; // point forward off the knuckles
      a.add(sp);
    }
    return a;
  };
  const arm = makeFist(1);
  const offArm = makeFist(-1);
  g.add(arm, offArm);

  return { group: g, arm, armRest: -0.4, swingAmp: 1.8, height: 1.75, legs, offArm };
}

// ---------------------------------------------------------------------------
// Card wave 3: the Stone Golem, its Pebble Golems and the Digger.

/** Deterministic 0..1 hash of a vertex position (boulder jitter). */
function rockHash(x: number, y: number, z: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * A lumpy faceted boulder: an icosahedron whose corners are pushed in and
 * out by a position hash, so shared corners move together (no cracks) and
 * every face keeps its own flat normal (chiselled stone under the toon
 * ramp). Cached per radius and seed like every other primitive.
 */
function boulderGeo(r: number, seed: number, detail = 1): THREE.BufferGeometry {
  return cachedGeo(`rock:${r}:${seed}:${detail}`, () => {
    const geo = new THREE.IcosahedronGeometry(r, detail);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Round first: the same corner on two faces must hash identically.
      const k = 1 + (rockHash(Math.round(x * 1e4), Math.round(y * 1e4), Math.round(z * 1e4), seed) - 0.5) * 0.24;
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  });
}

function boulder(r: number, color: number, x = 0, y = 0, z = 0, seed = 1): THREE.Mesh {
  return shadowed(new THREE.Mesh(boulderGeo(r, seed), toon(color)), x, y, z);
}

/** Stone palette shared by the Classic golems (mossy grey granite). */
const GOLEM = {
  stone: 0x8e928a,
  dark: 0x676b64,
  crack: 0x3a3833,
  moss: 0x6f9c3a,
  mossDark: 0x4e7a2b,
  gem: 0x5ee8bb,
} as const;

/** Sandstone palette for the Golden Age golems (carved stone, turquoise inlay). */
const SAND_GOLEM = {
  stone: 0xc8b898,
  dark: 0x9c8b6e,
  crack: 0x5a4b3a,
  inlay: 0x2fb3a4,
  brass: 0xd8b25a,
  gem: 0x4fe3d6,
} as const;

/**
 * A pair of glowing eye gems in dark sockets, grouped so the idle quirk can
 * pulse them together. `r` is the gem radius; sockets sit just behind.
 */
function eyeGems(r: number, spread: number, y: number, z: number, gem: number, socket: number): THREE.Group {
  const eyes = new THREE.Group();
  eyes.name = "eye-gems";
  eyes.position.set(0, y, z);
  for (const s of [-1, 1]) {
    eyes.add(sphere(r * 1.45, socket, s * spread, 0, -r * 0.5));
    const gemMesh = new THREE.Mesh(cachedGeo(`gem:${r}`, () => new THREE.OctahedronGeometry(r, 1)), glow(gem, 2.2));
    gemMesh.name = "eye-gem";
    gemMesh.position.set(s * spread, 0, r * 0.35);
    eyes.add(gemMesh);
  }
  return eyes;
}

/**
 * A heavy stone arm: a column limb, a cracked boulder fist and a carved
 * band whose rune glows (under the bloom threshold). Not a team slot: a
 * golem's one team slot sits on its chest.
 */
function golemArm(x: number, y: number, s: number, stone: number, dark: number, band: number, seed: number, rune: number = GOLEM.gem): THREE.Group {
  const a = new THREE.Group();
  a.position.set(x, y, 0.05);
  a.add(box(0.36 * s, 0.62 * s, 0.36 * s, dark, 0, -0.34 * s, 0));
  a.add(cyl(round3(0.24 * s), round3(0.24 * s), round3(0.12 * s), band, 0, -0.5 * s, 0)); // carved band
  const glyph = new THREE.Mesh(cachedGeo(`rune:${s}`, () => new THREE.BoxGeometry(0.16 * s, 0.05 * s, 0.03 * s)), glow(rune, 1.4));
  glyph.name = "rune";
  glyph.position.set(0, -0.5 * s, 0.245 * s);
  a.add(glyph);
  a.add(boulder(0.4 * s, stone, 0, -0.86 * s, 0.04 * s, seed)); // boulder fist
  return a;
}

/**
 * STONE GOLEM: a walking boulder. The body is one huge lumpy rock with a
 * small head sunk into it, two glowing eye gems under a heavy brow, moss on
 * the crown and shoulders, dark cracks across the chest, and arms that end
 * in boulders. The team reads from a big chest crystal and the rune bands.
 */
function buildStoneGolem(): TroopRig {
  const g = new THREE.Group();
  const P = GOLEM;
  const legs = [makeLeg(P.dark, -0.36, 0.42, 0.34), makeLeg(P.dark, 0.36, 0.42, 0.34)];
  g.add(...legs);
  g.add(boulder(0.6, P.dark, 0, 0.66, 0, 3)); // hips
  const body = boulder(0.88, P.stone, 0, 1.28, 0, 7);
  body.scale.set(1.12, 0.94, 0.9);
  g.add(body);
  // Cracks: dark zigzags chiselled across the front.
  for (const [x, y, rz, h] of [[0.36, 1.46, 0.5, 0.3], [0.46, 1.2, -0.45, 0.24], [-0.44, 1.04, 0.35, 0.28], [-0.5, 1.26, -0.5, 0.18]] as const) {
    const c = box(0.035, h, 0.03, P.crack, x, y, 0.76 - Math.abs(x) * 0.14);
    c.rotation.z = rz;
    c.name = "crack";
    g.add(c);
  }
  // The team crystal set into the chest.
  const crystalMesh = diamond(0.17, P.dark, 0, 1.3, 0.8);
  crystalMesh.name = "chest-crystal";
  const crystal = teamPart(crystalMesh);
  crystal.scale.set(1, 1.35, 0.7);
  g.add(crystal);
  // Small head sunk into the shoulders, under a heavy brow ridge.
  const head = boulder(0.42, P.stone, 0, 2.02, 0.16, 11);
  head.name = "golem-head";
  g.add(head);
  g.add(box(0.62, 0.14, 0.22, P.dark, 0, 2.16, 0.46)); // brow ridge
  g.add(eyeGems(0.085, 0.16, 2.02, 0.5, P.gem, P.crack));
  // Moss: a cap on the crown and pads on both shoulders, with a few tufts.
  const cap = sphere(0.32, P.moss, 0, 2.34, 0.08);
  cap.scale.set(1.15, 0.36, 1.05);
  cap.name = "moss";
  g.add(cap);
  for (const sx of [-1, 1]) {
    const pad = sphere(0.3, P.moss, sx * 0.66, 1.86, 0);
    pad.scale.set(1.1, 0.42, 1);
    pad.name = "moss";
    g.add(pad);
    g.add(cone(0.06, 0.18, P.mossDark, sx * 0.62, 2.0, 0.12));
  }
  g.add(cone(0.06, 0.2, P.mossDark, 0.1, 2.46, 0.1));
  g.add(cone(0.05, 0.16, P.mossDark, -0.12, 2.44, 0.02));

  const offArm = golemArm(-1.0, 1.7, 1, P.stone, P.dark, P.dark, 13);
  const arm = golemArm(1.0, 1.7, 1, P.stone, P.dark, P.dark, 17);
  g.add(offArm, arm);
  const eyes = g.getObjectByName("eye-gems")!;
  // Idle quirk: the eye gems throb like a slow heartbeat.
  const throb = (t: number, phase: number) => {
    eyes.scale.setScalar(1 + Math.sin(t * 2.6 + phase) * 0.12);
  };
  return { group: g, arm, armRest: -0.3, swingAmp: 1.3, height: 2.5, legs, offArm, extras: throb };
}

/** PEBBLE GOLEM: a small round rock with big glowing eyes and a sprout on top. */
function buildPebbleGolem(): TroopRig {
  const g = new THREE.Group();
  const P = GOLEM;
  const legs = [makeLeg(P.dark, -0.2, 0.24, 0.2), makeLeg(P.dark, 0.2, 0.24, 0.2)];
  g.add(...legs);
  const body = boulder(0.52, P.stone, 0, 0.7, 0, 23);
  body.scale.set(1.08, 0.96, 1);
  g.add(body);
  const nick = box(0.03, 0.16, 0.03, P.crack, -0.3, 0.6, 0.42); // a little crack
  nick.rotation.z = 0.3;
  g.add(nick);
  g.add(eyeGems(0.075, 0.17, 0.8, 0.46, P.gem, P.crack));
  const gem = diamond(0.1, P.dark, 0, 0.5, 0.5);
  gem.name = "chest-gem";
  g.add(teamPart(gem)); // team pebble-gem
  // A mossy tuft with a two-leaf sprout: the cute read.
  const tuft = sphere(0.22, P.moss, 0, 1.16, 0);
  tuft.scale.set(1.2, 0.4, 1.1);
  tuft.name = "moss";
  g.add(tuft);
  g.add(cyl(0.025, 0.025, 0.2, P.mossDark, 0, 1.3, 0));
  for (const s of [-1, 1]) {
    const leaf = sphere(0.07, P.moss, s * 0.08, 1.42, 0);
    leaf.scale.set(1.4, 0.45, 0.8);
    leaf.rotation.z = s * 0.5;
    g.add(leaf);
  }
  const offArm = golemArm(-0.52, 0.82, 0.5, P.stone, P.dark, P.dark, 29);
  const arm = golemArm(0.52, 0.82, 0.5, P.stone, P.dark, P.dark, 31);
  g.add(offArm, arm);
  const eyes = g.getObjectByName("eye-gems")!;
  const throb = (t: number, phase: number) => {
    eyes.scale.setScalar(1 + Math.sin(t * 3.4 + phase) * 0.14);
  };
  return { group: g, arm, armRest: -0.3, swingAmp: 1.2, height: 1.3, legs, offArm, extras: throb };
}

/** A small dome with a brass finial: the Golden Age golems' crown. */
function domeCap(r: number, x: number, y: number, z: number, stone: number, brass: number): THREE.Group {
  const d = new THREE.Group();
  d.position.set(x, y, z);
  const dome = sphere(r, stone);
  dome.scale.set(1, 0.8, 1);
  dome.name = "golem-dome";
  d.add(dome);
  d.add(cyl(r * 1.02, r * 1.02, r * 0.18, brass, 0, -r * 0.05, 0));
  d.add(cyl(r * 0.12, r * 0.18, r * 0.4, brass, 0, r * 0.9, 0));
  d.add(sphere(r * 0.18, brass, 0, r * 1.18, 0));
  return d;
}

/**
 * Golden Age STONE GOLEM: a carved SANDSTONE guardian. A square-shouldered
 * block body inlaid with a turquoise eight-point star, brass bands on the
 * arms, a domed head with a brass finial and glowing turquoise eyes; a team
 * sash crosses the chest.
 */
function buildSandstoneGolem(): TroopRig {
  const g = new THREE.Group();
  const P = SAND_GOLEM;
  const legs = [makeLeg(P.dark, -0.36, 0.42, 0.36), makeLeg(P.dark, 0.36, 0.42, 0.36)];
  g.add(...legs);
  g.add(box(1.1, 0.5, 0.8, P.dark, 0, 0.66, 0)); // hip block
  const body = box(1.6, 1.15, 1.2, P.stone, 0, 1.36, 0);
  g.add(body);
  g.add(box(1.7, 0.14, 1.28, P.dark, 0, 1.96, 0)); // carved cornice
  // Turquoise eight-point star: two squares, one turned 45 degrees.
  for (const rz of [0, Math.PI / 4]) {
    const sq = box(0.42, 0.42, 0.05, P.inlay, 0, 1.36, 0.61);
    sq.rotation.z = rz;
    sq.name = "girih-star";
    g.add(sq);
  }
  g.add(sphere(0.09, P.brass, 0, 1.36, 0.66)); // star boss
  for (const sx of [-1, 1]) g.add(box(0.06, 0.8, 0.05, P.crack, sx * 0.56, 1.3, 0.61)); // carved grooves
  const sashMesh = box(0.26, 1.5, 0.06, P.dark, 0, 1.36, 0.64);
  sashMesh.name = "sash";
  const sash = teamPart(sashMesh);
  sash.rotation.z = 0.72;
  g.add(sash);
  // Domed head, set low between the shoulders.
  const head = box(0.66, 0.5, 0.6, P.stone, 0, 2.24, 0.08);
  head.name = "golem-head";
  g.add(head);
  g.add(box(0.72, 0.1, 0.2, P.dark, 0, 2.38, 0.34)); // brow
  g.add(eyeGems(0.08, 0.15, 2.22, 0.4, P.gem, P.crack));
  g.add(domeCap(0.34, 0, 2.54, 0.06, P.stone, P.brass));

  const mkArm = (x: number, seed: number): THREE.Group => {
    const a = golemArm(x, 1.78, 1, P.stone, P.dark, P.dark, seed, P.gem);
    a.add(cyl(0.25, 0.25, 0.08, P.brass, 0, -0.2, 0)); // brass cuff
    return a;
  };
  const offArm = mkArm(-1.02, 37);
  const arm = mkArm(1.02, 41);
  g.add(offArm, arm);
  const eyes = g.getObjectByName("eye-gems")!;
  const throb = (t: number, phase: number) => {
    eyes.scale.setScalar(1 + Math.sin(t * 2.6 + phase) * 0.12);
  };
  return { group: g, arm, armRest: -0.3, swingAmp: 1.3, height: 2.6, legs, offArm, extras: throb };
}

/** Golden Age PEBBLE GOLEM: a little sandstone block with a dome and turquoise eyes. */
function buildSandPebble(): TroopRig {
  const g = new THREE.Group();
  const P = SAND_GOLEM;
  const legs = [makeLeg(P.dark, -0.2, 0.24, 0.2), makeLeg(P.dark, 0.2, 0.24, 0.2)];
  g.add(...legs);
  g.add(box(0.86, 0.74, 0.74, P.stone, 0, 0.66, 0));
  g.add(eyeGems(0.07, 0.16, 0.78, 0.38, P.gem, P.crack));
  for (const rz of [0, Math.PI / 4]) {
    const sq = box(0.16, 0.16, 0.04, P.inlay, 0, 0.48, 0.38);
    sq.rotation.z = rz;
    g.add(sq);
  }
  const plinth = box(0.9, 0.1, 0.78, P.dark, 0, 0.32, 0);
  plinth.name = "plinth-band";
  g.add(teamPart(plinth)); // team plinth band
  g.add(domeCap(0.22, 0, 1.1, 0, P.stone, P.brass));
  const offArm = golemArm(-0.54, 0.8, 0.5, P.stone, P.dark, P.dark, 43, P.gem);
  const arm = golemArm(0.54, 0.8, 0.5, P.stone, P.dark, P.dark, 47, P.gem);
  g.add(offArm, arm);
  const eyes = g.getObjectByName("eye-gems")!;
  const throb = (t: number, phase: number) => {
    eyes.scale.setScalar(1 + Math.sin(t * 3.4 + phase) * 0.14);
  };
  return { group: g, arm, armRest: -0.3, swingAmp: 1.2, height: 1.35, legs, offArm, extras: throb };
}

/**
 * DIGGER: a stocky miner. A brass hard hat with a glowing headlamp, a big
 * nose and bushy moustache, a work shirt with a team neckerchief and team
 * braces, and a pickaxe that swings in quick chops.
 */
function buildDigger(): TroopRig {
  const g = new THREE.Group();
  const SHIRT = 0x8d6e4a, TROUSER = 0x4f4a44, BOOT = 0x3b2a1e, HAT = 0xe8c547, HATDK = 0xb99a3a;
  const WOOD = 0x7a5536, STEEL = 0xaeb7c2, STACHE = 0x6b4a32;
  const legs = [makeLeg(TROUSER, -0.15, 0.3, 0.17), makeLeg(TROUSER, 0.15, 0.3, 0.17)];
  for (const leg of legs) leg.add(box(0.2, 0.1, 0.24, BOOT, 0, -0.27, 0.03)); // boots
  g.add(...legs);
  g.add(cyl(0.3, 0.36, 0.5, SHIRT, 0, 0.56, 0));
  g.add(cyl(0.37, 0.37, 0.09, BOOT, 0, 0.34, 0)); // belt
  g.add(box(0.12, 0.11, 0.06, 0xd6b25a, 0, 0.34, 0.36)); // buckle
  for (const sx of [-1, 1]) {
    const brace = teamPart(box(0.08, 0.46, 0.05, TROUSER, sx * 0.16, 0.58, 0.3), "dark");
    brace.rotation.z = -sx * 0.08;
    g.add(brace);
  }
  g.add(teamPart(cyl(0.3, 0.33, 0.12, SHIRT, 0, 0.84, 0))); // neckerchief
  g.add(teamPart(cone(0.12, 0.2, SHIRT, 0, 0.74, 0.27), "main")); // its knot

  const head = sphere(0.38, SKIN, 0, 1.18, 0);
  addEyes(head, 0.38, 0.32, 0.1, "brave");
  const nose = sphere(0.12, 0xeab48c, 0, -0.04, 0.38);
  nose.name = "nose";
  head.add(nose);
  const stache = box(0.4, 0.1, 0.1, STACHE, 0, -0.16, 0.33);
  stache.name = "mustache";
  head.add(stache);
  for (const s of [-1, 1]) {
    const tip = sphere(0.08, STACHE, s * 0.21, -0.18, 0.32);
    tip.name = "mustache";
    tip.scale.set(1.1, 0.75, 0.8);
    head.add(tip);
  }
  g.add(head);
  // Hard hat: dome, brim, ridge, and the headlamp out front.
  const hat = sphere(0.41, HAT, 0, 1.36, -0.02);
  hat.scale.set(1, 0.62, 1.02);
  hat.name = "hard-hat";
  g.add(hat);
  g.add(cyl(0.47, 0.47, 0.06, HATDK, 0, 1.32, 0.02)); // brim
  g.add(box(0.08, 0.1, 0.62, HATDK, 0, 1.6, -0.02)); // ridge
  const lampBody = cyl(0.1, 0.12, 0.12, 0x8a7a5a, 0, 1.46, 0.38);
  lampBody.rotation.x = Math.PI / 2;
  g.add(lampBody);
  const lamp = new THREE.Mesh(cachedGeo("s:0.085:lamp", () => new THREE.SphereGeometry(0.085, 12, 10)), glow(0xfff3b0, 2.4));
  lamp.name = "lamp";
  lamp.position.set(0, 1.46, 0.45);
  g.add(lamp);

  const offArm = new THREE.Group();
  offArm.position.set(-0.42, 0.78, 0);
  offArm.add(box(0.14, 0.32, 0.14, SHIRT, 0, -0.16, 0));
  g.add(offArm);
  // Pickaxe arm: a long handle up from the fist, a double pick head on top.
  const arm = new THREE.Group();
  arm.position.set(0.42, 0.8, 0);
  arm.add(box(0.14, 0.32, 0.14, SHIRT, 0, -0.16, 0));
  arm.add(cyl(0.04, 0.045, 0.86, WOOD, 0, 0.02, 0.04)); // handle
  const pick = new THREE.Group();
  pick.name = "pickaxe";
  pick.position.set(0, 0.44, 0.04);
  pick.add(box(0.1, 0.12, 0.22, 0x5d5f66, 0, 0, 0)); // collar
  for (const dz of [-1, 1]) {
    const blade = cone(0.07, 0.38, STEEL, 0, -0.06, dz * 0.28);
    blade.rotation.x = dz * (Math.PI / 2 + 0.35); // curved down at both ends
    pick.add(blade);
  }
  arm.add(pick);
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.9, height: 1.72, legs, offArm };
}

/**
 * Golden Age DIGGER: a desert TREASURE-DIGGER. A team-dyed turban, a pale
 * sand robe with a team sash, a coin sack on the back, a brass oil lamp at
 * the belt, and a long shovel for an attack arm.
 */
function buildTreasureDigger(): TroopRig {
  const g = new THREE.Group();
  const ROBE = 0xe6d8b8, ROBEDK = 0xb9a888, WOOD = 0x7a5536, IRON = 0x9aa3ad, GOLD = THEME.goldLight;
  const legs = [makeLeg(ROBEDK, -0.14, 0.28, 0.16), makeLeg(ROBEDK, 0.14, 0.28, 0.16)];
  g.add(...legs);
  g.add(cyl(0.28, 0.42, 0.6, ROBE, 0, 0.52, 0)); // robe
  g.add(teamPart(cyl(0.36, 0.37, 0.15, ROBEDK, 0, 0.48, 0))); // sash
  g.add(box(0.12, 0.12, 0.05, GOLD, 0.16, 0.48, 0.36)); // sash buckle
  // Coin sack on the back, gold spilling at the neck.
  const sack = sphere(0.24, 0x8a6d4a, 0, 0.72, -0.34);
  sack.name = "treasure-sack";
  g.add(sack);
  for (const dx of [-0.06, 0.06]) g.add(sphere(0.06, GOLD, dx, 0.94, -0.36));
  // Brass oil lamp hanging at the hip, with a little flame.
  g.add(sphere(0.09, GOLD, -0.3, 0.42, 0.16));
  const flame = new THREE.Mesh(cachedGeo("s:0.05:flame", () => new THREE.SphereGeometry(0.05, 10, 8)), glow(0xffe08a, 2.2));
  flame.name = "lamp";
  flame.position.set(-0.3, 0.53, 0.2);
  g.add(flame);

  const head = sphere(0.34, SKIN, 0, 1.06, 0);
  addEyes(head, 0.34, 0.34, 0.08, "brave");
  const beard = sphere(0.26, 0x4a3426, 0, -0.22, 0.12);
  beard.scale.set(0.9, 0.5, 0.75);
  beard.name = "beard";
  head.add(beard);
  g.add(head);
  const t = turban(0.34, ROBEDK, GOLD, true);
  t.position.y = 1.16;
  g.add(t);

  const offArm = new THREE.Group();
  offArm.position.set(-0.38, 0.74, 0);
  offArm.add(box(0.13, 0.3, 0.13, ROBE, 0, -0.15, 0));
  g.add(offArm);
  // Shovel arm: a long shaft with a T grip below and a spade blade on top.
  const arm = new THREE.Group();
  arm.position.set(0.38, 0.76, 0);
  arm.add(box(0.13, 0.3, 0.13, ROBE, 0, -0.15, 0));
  arm.add(cyl(0.035, 0.04, 1.0, WOOD, 0, 0.12, 0.04)); // shaft
  arm.add(box(0.2, 0.05, 0.05, WOOD, 0, -0.38, 0.04)); // T grip
  const shovel = new THREE.Group();
  shovel.name = "shovel";
  shovel.position.set(0, 0.7, 0.04);
  shovel.add(box(0.3, 0.34, 0.05, IRON, 0, 0, 0));
  const tip = sphere(0.15, IRON, 0, 0.17, 0);
  tip.scale.set(1, 0.6, 0.3);
  shovel.add(tip);
  shovel.add(cyl(0.06, 0.06, 0.1, IRON, 0, -0.2, 0)); // socket
  arm.add(shovel);
  g.add(arm);
  const flicker = (time: number, phase: number) => {
    flame.scale.setScalar(1 + Math.sin(time * 12 + phase) * 0.18);
  };
  return { group: g, arm, armRest: -0.5, swingAmp: 1.8, height: 1.62, legs, offArm, extras: flicker };
}

/**
 * The Comet's flaming rock (a spell, so it is no troop rig): a dark basalt
 * boulder split by glowing lava veins. Used by the card portrait and the
 * falling comet in battle. The flame tail is the caller's business.
 */
export function buildCometRock(r = 0.5): THREE.Group {
  const g = new THREE.Group();
  g.name = "comet-rock";
  const rock = new THREE.Mesh(boulderGeo(r, 53), toon(0x5a4740));
  rock.name = "comet-body";
  g.add(rock);
  // Lava veins: thin hot bars wrapped across the faces. The comet's core is
  // one of the few things allowed past the bloom threshold (art bible 5).
  const lava = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(1.6) });
  lava.toneMapped = false;
  for (const [rx, ry, rz] of [[0.3, 0, 0.9], [1.2, 0.6, 0.2], [0.1, 1.4, -0.7]] as const) {
    const vein = new THREE.Mesh(cachedGeo(`vein:${r}`, () => new THREE.TorusGeometry(r * 0.98, r * 0.06, 4, 18, Math.PI * 0.9)), lava);
    vein.name = "comet-vein";
    vein.rotation.set(rx, ry, rz);
    g.add(vein);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Card buildings (art bible 7): cannon, tombstone and elixir collector, in
// the creatures' material language. Each is a TroopRig-shaped group that
// bakeRig() folds into a couple of inked draws like any troop; the cannon's
// barrel is a pivot (userData.animated) the scene aims at its target. Each
// wears its team colour on ONE slot: the cannon's pennant, the tombstone's
// wreath, the collector's rim band. ship wires these into
// scene/views/troops.ts buildBuildingMesh (see notes/features/art-creatures-fx.md).
// ---------------------------------------------------------------------------

/** A card building's rig: the group, its aimable barrel (cannons), and where its HP bar sits. */
export interface BuildingRig extends TroopRig {
  barrel?: THREE.Group;
  /** World height (rig units) for the HP bar above the building. */
  barY: number;
}

/** The buildings with a procedural model. */
export const BUILDING_IDS = ["cannon", "tombstone", "elixir-collector"] as const;

/** A team pennant on a pole: the pole is wood, the flag the ONE team slot. */
function teamPennant(x: number, z: number, h: number): THREE.Mesh[] {
  const pole = cyl(0.03, 0.035, h, 0x6b4a2c, x, h / 2, z);
  const flag = new THREE.Mesh(cachedGeo("pennant", () => {
    const g = new THREE.BufferGeometry();
    // A swallow-free triangle flag, two-sided by thickness (a thin wedge).
    const pts = [
      [0, 0, 0.03], [0.56, -0.13, 0.015], [0, -0.3, 0.03],
      [0, 0, -0.03], [0, -0.3, -0.03], [0.56, -0.13, -0.015],
    ];
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    g.setIndex([0, 2, 1, 3, 5, 4, 0, 1, 3, 3, 1, 5, 2, 4, 1, 4, 5, 1, 0, 3, 2, 3, 4, 2]);
    g.computeVertexNormals();
    return g;
  }), toon(0xffffff));
  shadowed(flag, x + 0.02, h - 0.02, z);
  flag.name = "pennant";
  return [pole, teamPart(flag)];
}

/** CANNON: a bronze barrel on a timber carriage with spoked wheels, shot stacked behind, a team pennant. */
function buildCannonRig(): BuildingRig {
  const g = new THREE.Group();
  const WOOD = 0x8a5a36, WOODDK = 0x5e3d24, IRON = 0x3a3f46;
  const BRONZE = ARABIC ? 0xc2a052 : 0xa9844e, BRONZEDK = ARABIC ? 0x8f7434 : 0x7a5e36, TRIM = ARABIC ? THEME.turquoise : 0xd8b25a;
  // Stone footing so the gun sits on the field like a fixture.
  const base = cyl(0.72, 0.8, 0.16, ARABIC ? THEME.stone : 0x9a958c, 0, 0.08, 0);
  g.add(base);
  // Carriage cheeks and axle.
  for (const sx of [-1, 1]) g.add(box(0.14, 0.34, 0.86, WOOD, sx * 0.27, 0.42, -0.05));
  const axle = cyl(0.05, 0.05, 0.8, WOODDK, 0, 0.32, 0.12);
  axle.rotation.z = Math.PI / 2;
  g.add(axle);
  for (const sx of [-1, 1]) {
    const wheel = cyl(0.3, 0.3, 0.1, WOOD, sx * 0.42, 0.32, 0.12);
    wheel.rotation.z = Math.PI / 2;
    g.add(wheel);
    const tyre = new THREE.Mesh(cachedGeo("cannon-tyre", () => new THREE.TorusGeometry(0.3, 0.045, 6, 18)), toon(IRON));
    tyre.rotation.y = Math.PI / 2;
    shadowed(tyre, sx * 0.42, 0.32, 0.12);
    g.add(tyre);
    const hub = cyl(0.08, 0.08, 0.14, IRON, sx * 0.44, 0.32, 0.12);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
  }
  // Shot stacked behind the carriage.
  for (const [x, y, z] of [[-0.42, 0.25, -0.5], [-0.26, 0.25, -0.56], [-0.34, 0.39, -0.52]] as const) g.add(sphere(0.1, IRON, x, y, z));
  // The barrel: a pivot the scene turns toward the target (+z forward).
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  barrel.userData.animated = true;
  barrel.position.set(0, 0.66, 0);
  const tube = cyl(0.15, 0.21, 1.05, BRONZE, 0, 0.06, 0.28);
  tube.rotation.x = Math.PI / 2 - 0.16;
  barrel.add(tube);
  for (const z of [0.0, 0.42]) {
    const band = cyl(0.205 - z * 0.08, 0.205 - z * 0.08, 0.08, BRONZEDK, 0, 0.06 + z * 0.16, z);
    band.rotation.x = Math.PI / 2 - 0.16;
    barrel.add(band);
  }
  const muzzle = cyl(0.19, 0.17, 0.1, TRIM, 0, 0.14, 0.78);
  muzzle.rotation.x = Math.PI / 2 - 0.16;
  barrel.add(muzzle);
  barrel.add(sphere(0.24, BRONZEDK, 0, 0, -0.22)); // breech
  barrel.add(sphere(0.08, BRONZE, 0, 0, -0.48)); // cascabel knob
  g.add(barrel);
  g.add(...teamPennant(0.38, -0.52, 1.25));
  return { group: g, arm: null, armRest: 0, swingAmp: 0, height: 1.25, barrel, barY: 1.55 };
}

/** TOMBSTONE: a rounded headstone on an earth mound, a carved skull, a green soul-light, a team wreath. */
function buildTombstoneRig(): BuildingRig {
  const g = new THREE.Group();
  const STONE = ARABIC ? 0xcdbb94 : 0x9aa1a8, STONEDK = ARABIC ? 0x9c8b6e : 0x6d747c, EARTH = ARABIC ? 0xa88a5c : 0x6b5a45, BONE = 0xe9dfc8;
  const mound = cyl(0.56, 0.68, 0.22, EARTH, 0, 0.11, 0);
  g.add(mound);
  const bump = sphere(0.36, EARTH, 0.1, 0.2, 0.18);
  bump.scale.set(1.3, 0.35, 1);
  g.add(bump);
  // Headstone: a slab with a round top (an arch top in the Golden Age).
  g.add(box(0.86, 1.0, 0.24, STONE, 0, 0.74, -0.14));
  const cap = cyl(0.43, 0.43, 0.24, STONE, 0, 1.24, -0.14);
  cap.rotation.x = Math.PI / 2;
  g.add(cap);
  if (ARABIC) {
    const tip = cone(0.14, 0.3, STONE, 0, 1.78, -0.14);
    g.add(tip);
    g.add(box(0.7, 0.08, 0.26, THEME.turquoise, 0, 0.5, -0.14)); // inlaid band
  } else {
    const crack = box(0.035, 0.34, 0.03, STONEDK, 0.24, 1.0, -0.01);
    crack.rotation.z = 0.5;
    g.add(crack);
  }
  g.add(box(0.94, 0.1, 0.32, STONEDK, 0, 0.27, -0.14)); // plinth
  // Carved skull on the face.
  const skull = sphere(0.15, BONE, 0, 1.18, -0.01);
  skull.scale.set(1, 0.95, 0.5);
  g.add(skull);
  for (const sx of [-1, 1]) g.add(sphere(0.04, 0x2b2333, sx * 0.055, 1.19, 0.06));
  // The ONE team slot: a wreath hung on the stone's face.
  const wreath = new THREE.Mesh(cachedGeo("wreath", () => new THREE.TorusGeometry(0.22, 0.07, 8, 18)), toon(0xffffff));
  wreath.name = "wreath";
  shadowed(wreath, 0, 0.72, 0.0);
  g.add(teamPart(wreath));
  g.add(teamPart(sphere(0.075, 0xffffff, 0, 0.5, 0.04), "dark")); // its bow
  // Bones on the mound and the soul-light (under the bloom threshold).
  const bone = box(0.26, 0.05, 0.05, BONE, -0.34, 0.24, 0.3);
  bone.rotation.y = 0.6;
  g.add(bone);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glow(0x76ff03, 2));
  orb.name = "soul-light";
  orb.position.set(0, ARABIC ? 1.98 : 1.72, -0.14);
  g.add(orb);
  return { group: g, arm: null, armRest: 0, swingAmp: 0, height: 1.7, barY: 2.05 };
}

/** ELIXIR COLLECTOR: a hooped vat brimming with glowing elixir, a pump, a big drop; a team rim band. */
function buildCollectorRig(): BuildingRig {
  const g = new THREE.Group();
  const WOOD = ARABIC ? 0xb08a4a : 0x8d6e4a, WOODDK = ARABIC ? 0x8a6a34 : 0x5e4632, HOOP = ARABIC ? THEME.goldLight : 0x4a4f57;
  g.add(cyl(0.74, 0.8, 0.18, ARABIC ? THEME.stone : 0x9a958c, 0, 0.09, 0)); // footing
  const vat = cyl(0.56, 0.62, 0.72, WOOD, 0, 0.56, 0);
  g.add(vat);
  for (const y of [0.32, 0.62]) {
    const hoop = new THREE.Mesh(cachedGeo(`vat-hoop:${y}`, () => new THREE.TorusGeometry(0.6 - (y - 0.32) * 0.1, 0.03, 6, 22)), toon(HOOP));
    hoop.rotation.x = Math.PI / 2;
    shadowed(hoop, 0, y, 0);
    g.add(hoop);
  }
  // The ONE team slot: the band round the vat's rim.
  const rim = cyl(0.6, 0.6, 0.12, 0xffffff, 0, 0.92, 0);
  rim.name = "rim-band";
  g.add(teamPart(rim));
  // Elixir (pink-magenta, under the bloom threshold) and its drop.
  const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 18), glow(0xd946ef, 2));
  brew.position.y = 0.96;
  g.add(brew);
  const drop = new THREE.Mesh(cachedGeo("elixir-drop", () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = t * Math.PI;
      pts.push(new THREE.Vector2(Math.sin(a) * 0.18 * (t < 0.5 ? 1 : 1 - (t - 0.5) * 1.6), -Math.cos(a) * 0.18 + t * t * 0.22));
    }
    return new THREE.LatheGeometry(pts, 14);
  }), glow(0xe879f9, 2));
  drop.name = "elixir-drop";
  drop.position.y = 1.3;
  g.add(drop);
  // A little hand pump at the side.
  g.add(box(0.1, 0.5, 0.1, WOODDK, 0.52, 0.86, -0.3));
  const handle = box(0.36, 0.06, 0.06, WOODDK, 0.42, 1.1, -0.3);
  handle.rotation.z = 0.35;
  g.add(handle);
  g.add(cyl(0.05, 0.05, 0.22, HOOP, 0.52, 0.7, -0.12));
  return { group: g, arm: null, armRest: 0, swingAmp: 0, height: 1.45, barY: 1.85 };
}

/**
 * The model for a card building on `side` (the side it wears, as for
 * buildTroop), or null for a building without one. Bake it with bakeRig
 * (key `${id}:${side}:${edition}:${palette}`) like a troop.
 */
export function buildBuildingRig(cardId: CardId | string, side: Side = "player"): BuildingRig | null {
  const rig = cardId === "cannon" ? buildCannonRig() : cardId === "tombstone" ? buildTombstoneRig() : cardId === "elixir-collector" ? buildCollectorRig() : null;
  if (!rig) return null;
  outlineRig(rig.group);
  applyTeam(rig.group, side);
  return rig;
}

/** Darken a hex color by factor f (0..1). */
function shade(color: number, f: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(f);
  return c.getHex();
}

/**
 * The Character Studio rig: one parameterized hero assembled from the
 * player's design — outfit colors, headgear, weapon, face, and wings for
 * flyers. Multi-unit designs shrink so squads read as squads.
 */
export function buildChampionRig(raw: ChampionDef, side: Side = "player"): TroopRig {
  const rig = championBody(raw);
  applyTeam(rig.group, side);
  return rig;
}

function championBody(raw: ChampionDef): TroopRig {
  const def = normalizeChampion(raw);
  const { look, abilities } = def;
  const BODY = look.body;
  const TRIM = look.trim;
  const DARK = shade(BODY, 0.68);
  const STEEL = 0xb9c4d2;
  const g = new THREE.Group();

  const legs = [makeLeg(DARK, -0.14, 0.3, 0.16), makeLeg(DARK, 0.14, 0.3, 0.16)];
  g.add(...legs);

  // Torso: tunic, belt + buckle, pauldrons, chest emblem.
  g.add(cyl(0.28, 0.34, 0.48, BODY, 0, 0.54, 0));
  g.add(teamPart(cyl(0.35, 0.35, 0.09, shade(TRIM, 0.8), 0, 0.33, 0), "dark")); // team belt
  g.add(box(0.12, 0.12, 0.05, TRIM, 0, 0.33, 0.29));
  for (const sx of [-1, 1]) g.add(sphere(0.16, TRIM, sx * 0.36, 0.78, 0));
  g.add(diamond(0.09, TRIM, 0, 0.64, 0.28));

  // Head + face (mood-driven brows/mouth).
  const head = sphere(0.4, SKIN, 0, 1.16, 0);
  addEyes(head, 0.4, 0.36, 0.1, look.mood);
  g.add(head);

  switch (look.headgear) {
    case "helmet": {
      const dome = sphere(0.43, STEEL, 0, 1.26, -0.02);
      dome.scale.set(1.04, 0.82, 1.02);
      g.add(dome);
      g.add(cyl(0.44, 0.44, 0.09, shade(STEEL, 0.8), 0, 1.34, 0));
      g.add(teamPart(box(0.12, 0.4, 0.16, TRIM, 0, 1.66, -0.05))); // plume
      break;
    }
    case "hood": {
      const hood = cone(0.44, 0.6, DARK, 0, 1.44, -0.03);
      hood.rotation.x = -0.08;
      g.add(hood);
      g.add(cyl(0.42, 0.46, 0.16, DARK, 0, 1.1, -0.04)); // cowl collar
      break;
    }
    case "crown": {
      g.add(cyl(0.3, 0.33, 0.14, 0xf2c14e, 0, 1.5, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.add(cone(0.05, 0.14, 0xf2c14e, Math.cos(a) * 0.28, 1.62, Math.sin(a) * 0.28));
      }
      g.add(sphere(0.06, TRIM, 0, 1.6, 0.3)); // front jewel
      break;
    }
    case "horns": {
      const cap = sphere(0.42, DARK, 0, 1.28, -0.02);
      cap.scale.set(1.03, 0.7, 1.0);
      g.add(cap);
      for (const sx of [-1, 1]) {
        const horn = cone(0.09, 0.36, 0xe8e0d0, sx * 0.3, 1.5, 0);
        horn.rotation.z = sx * 0.6;
        g.add(horn);
      }
      break;
    }
    case "turban": {
      const t = turban(0.4, BODY, TRIM);
      t.position.y = 1.18;
      g.add(t);
      break;
    }
    case "none": {
      const hair = sphere(0.41, 0x5a3a1c, 0, 1.3, -0.03);
      hair.scale.set(1.0, 0.55, 1.0);
      g.add(hair);
      break;
    }
  }

  const melee = def.range <= 1;

  // Free arm: fist; melee designs also carry a round trim-rimmed shield.
  const offArm = new THREE.Group();
  offArm.position.set(-0.4, 0.8, 0);
  offArm.add(box(0.14, 0.3, 0.14, BODY, 0, -0.15, 0));
  offArm.add(sphere(0.1, SKIN, 0, -0.32, 0.02));
  if (melee && look.weapon !== "none") {
    const shield = teamPart(cyl(0.26, 0.26, 0.06, BODY, -0.08, -0.24, 0.12)); // team face
    shield.rotation.x = Math.PI / 2;
    offArm.add(shield);
    const rim = cyl(0.28, 0.28, 0.04, TRIM, -0.08, -0.24, 0.09);
    rim.rotation.x = Math.PI / 2;
    offArm.add(rim);
    offArm.add(sphere(0.07, TRIM, -0.08, -0.24, 0.17)); // boss
  }
  g.add(offArm);

  // Weapon arm.
  const arm = new THREE.Group();
  arm.position.set(0.4, 0.82, 0);
  arm.add(box(0.15, 0.3, 0.15, BODY, 0, -0.15, 0));
  arm.add(sphere(0.11, SKIN, 0, -0.33, 0.02));
  const WOOD = 0x6d4c41;
  switch (look.weapon) {
    case "sword":
      arm.add(box(0.26, 0.07, 0.1, TRIM, 0, -0.3, 0.02)); // crossguard
      arm.add(box(0.08, 0.78, 0.13, 0xe7ecf3, 0, 0.1, 0.02)); // blade
      arm.add(sphere(0.06, TRIM, 0, -0.44, 0.02)); // pommel
      break;
    case "axe":
      arm.add(cyl(0.035, 0.045, 0.85, WOOD, 0, -0.02, 0.02));
      arm.add(box(0.3, 0.24, 0.07, STEEL, 0.14, 0.32, 0.02)); // head
      arm.add(box(0.08, 0.28, 0.09, TRIM, 0.28, 0.32, 0.02)); // edge band
      break;
    case "hammer":
      arm.add(cyl(0.04, 0.05, 0.8, WOOD, 0, -0.04, 0.02));
      arm.add(box(0.3, 0.2, 0.3, 0x8a93a3, 0, 0.34, 0.02)); // maul head
      arm.add(box(0.32, 0.06, 0.32, TRIM, 0, 0.44, 0.02)); // cap
      break;
    case "spear":
      arm.add(cyl(0.03, 0.035, 1.15, WOOD, 0, 0.1, 0.02));
      arm.add(cone(0.07, 0.24, STEEL, 0, 0.78, 0.02)); // tip
      arm.add(cyl(0.05, 0.05, 0.06, TRIM, 0, 0.62, 0.02)); // collar
      break;
    case "bow": {
      const bow = new THREE.Mesh(
        cachedGeo("champ-bow", () => new THREE.TorusGeometry(0.42, 0.035, 6, 16, Math.PI * 1.1)),
        toon(WOOD),
      );
      bow.position.set(0, -0.3, 0.06);
      bow.rotation.z = Math.PI * 0.95;
      bow.castShadow = true;
      arm.add(bow);
      arm.add(box(0.02, 0.74, 0.02, 0xe8e4da, 0, -0.3, 0.06)); // string
      break;
    }
    case "staff":
      arm.add(cyl(0.035, 0.045, 1.0, WOOD, 0, 0.04, 0.02));
      arm.add(cyl(0.06, 0.06, 0.06, TRIM, 0, 0.42, 0.02)); // ferrule
      arm.add(shadowed(new THREE.Mesh(
        cachedGeo("s:0.11", () => new THREE.SphereGeometry(0.11, 20, 16)),
        glow(TRIM),
      ), 0, 0.56, 0.02)); // glowing focus orb
      break;
    case "none":
      arm.add(sphere(0.13, SKIN, 0, -0.36, 0.02)); // oversized brawler fist
      break;
  }
  g.add(arm);

  // Wings for flyers (drives the animateTroop flap + hover bob).
  const wings: Wing[] = [];
  if (abilities.flying) {
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(s * 0.28, 0.9, -0.2);
      const membrane = box(0.62, 0.34, 0.05, shade(BODY, 0.85), s * 0.34, 0.1, 0);
      membrane.rotation.z = s * 0.25;
      wing.add(membrane);
      wing.add(box(0.4, 0.16, 0.05, TRIM, s * 0.24, 0.26, 0));
      g.add(wing);
      wings.push({ obj: wing, base: s * 0.3, amp: s * 0.5 });
    }
  }

  // Squads shrink so multi-unit champions read as a squad, not clones.
  const scale = def.count >= 4 ? 0.72 : def.count >= 2 ? 0.85 : 1;
  g.scale.setScalar(scale);

  const ranged = !melee;
  return {
    group: g,
    arm,
    armRest: ranged ? -0.9 : -0.5,
    swingAmp: ranged ? 1.1 : 1.7,
    height: 1.75 * scale,
    hover: abilities.flying ? 0.9 : undefined,
    legs,
    offArm,
    wings: wings.length ? wings : undefined,
  };
}

const BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
  champion: () => championBody(loadChampion()),
  knight: buildKnight,
  archers: buildArcher,
  firecracker: buildFirecracker,
  "magic-archer": buildMagicArcher,
  bats: buildBat,
  minions: buildMinion,
  "skeleton-army": buildSkeleton,
  executioner: buildExecutioner,
  giant: buildGiant,
  musketeer: buildMusketeer,
  "mini-pekka": buildMiniPekka,
  skeletons: buildSkeleton,
  wizard: buildWizard,
  witch: buildWitch,
  "hog-rider": buildHogRider,
  balloon: buildBalloon,
  "baby-dragon": buildBabyDragon,
  gargoyles: buildGargoyle,
  valkyrie: buildValkyrie,
  prince: buildPrince,
  pekka: buildPekka,
  // New cards: distinct themed rigs built on the closest archetype.
  "electro-wizard": buildElectroWizard,
  "ice-wizard": buildIceWizard,
  princess: buildPrincess,
  "mega-knight": buildMegaKnight,
  "royal-giant": buildRoyalGiant,
  // Card wave 3: a mossy boulder, the pebbles it bursts into, and a miner.
  "stone-golem": buildStoneGolem,
  "pebble-golem": buildPebbleGolem,
  digger: buildDigger,
};

/**
 * Islamic musketeer → JANISSARY: tall white börk hat, teal coat with gold
 * trim, and a long matchlock — Ottoman elite gunner silhouette.
 */
function buildJanissary(): TroopRig {
  const g = new THREE.Group();
  // Teal coat (deep blue read as the blue team); the sash is the team colour.
  const COAT = 0x2a7f7a, TRIM = THEME.goldLight, HAT = 0xf5f0e6;
  const legs = [makeLeg(COAT, -0.12, 0.28, 0.14), makeLeg(COAT, 0.12, 0.28, 0.14)];
  g.add(...legs);
  g.add(cyl(0.26, 0.4, 0.5, COAT, 0, 0.52, 0));
  g.add(teamPart(cyl(0.36, 0.36, 0.08, THEME.terracotta, 0, 0.34, 0))); // sash
  g.add(box(0.1, 0.4, 0.04, TRIM, 0.16, 0.56, 0.32));
  const head = sphere(0.3, SKIN, 0, 1.02, 0);
  addEyes(head, 0.3, 0.36, 0.1, "brave");
  g.add(head);
  // Signature tall white börk with a dangling cloth sleeve.
  const bork = cyl(0.22, 0.28, 0.55, HAT, 0, 1.42, -0.02);
  bork.name = "bork";
  g.add(bork);
  g.add(teamPart(cyl(0.3, 0.3, 0.08, TRIM, 0, 1.16, 0))); // hat band
  const sleeve = box(0.12, 0.5, 0.08, HAT, 0.22, 1.55, -0.1);
  sleeve.name = "bork-sleeve";
  sleeve.rotation.z = -0.45;
  g.add(sleeve);
  g.add(diamond(0.07, THEME.emerald, 0, 1.16, 0.3));

  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.72, 0);
  offArm.add(box(0.12, 0.28, 0.12, COAT, 0, -0.14, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.34, 0.74, 0);
  arm.add(box(0.12, 0.26, 0.12, SKIN, 0, -0.13, 0));
  arm.add(box(0.1, 0.12, 0.5, 0x6d4c41, 0, -0.26, 0.18));
  const barrel = cyl(0.035, 0.045, 0.8, 0x9aa3ad);
  barrel.name = "musket";
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.24, 0.74);
  arm.add(barrel);
  arm.add(cyl(0.055, 0.055, 0.06, TRIM, 0, -0.24, 1.12));
  g.add(arm);
  return { group: g, arm, armRest: -0.18, swingAmp: 0.4, height: 1.75, legs, offArm };
}

/**
 * Islamic mini-PEKKA → DUELIST: lean Faris with twin scimitars and a
 * spiked steel buckler — agile swordsman, not a robot knight.
 */
function buildDuelist(): TroopRig {
  const g = new THREE.Group();
  const MAIL = 0x5a6a78, CLOTH = BRICK, GOLD = THEME.goldLight, STEEL = 0xb7c2cc;
  const legs = [makeLeg(0x3a4550, -0.13, 0.28, 0.15), makeLeg(0x3a4550, 0.13, 0.28, 0.15)];
  g.add(...legs);
  g.add(cyl(0.24, 0.32, 0.44, MAIL, 0, 0.5, 0));
  g.add(cyl(0.33, 0.33, 0.08, CLOTH, 0, 0.34, 0));
  g.add(diamond(0.08, GOLD, 0, 0.62, 0.28));
  const head = sphere(0.28, SKIN, 0, 0.98, 0);
  addEyes(head, 0.28, 0.36, 0.1, "angry");
  g.add(head);
  const t = turban(0.28, THEME.deepBlue, GOLD, true);
  t.position.y = 0.98;
  g.add(t);
  for (const s of [-1, 1]) g.add(sphere(0.12, MAIL, s * 0.32, 0.72, 0));

  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.7, 0);
  offArm.add(box(0.12, 0.26, 0.12, MAIL, 0, -0.13, 0));
  const buckler = cyl(0.18, 0.18, 0.06, STEEL, -0.08, -0.28, 0.1);
  buckler.name = "buckler";
  buckler.rotation.y = Math.PI / 2;
  offArm.add(buckler);
  offArm.add(cone(0.05, 0.14, GOLD, -0.08, -0.28, 0.2)); // spike
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.34, 0.72, 0);
  arm.add(box(0.12, 0.26, 0.12, MAIL, 0, -0.13, 0));
  const blade = scimitar();
  blade.position.set(0, -0.3, 0.04);
  arm.add(blade);
  g.add(arm);
  return { group: g, arm, armRest: -0.45, swingAmp: 1.8, height: 1.4, legs, offArm };
}

/**
 * Islamic witch → WAR DRUMMER: crimson-robed drummer with a great
 * copper war-drum; mallet arm is the attack. Spawner role unchanged.
 */
function buildWarDrummer(): TroopRig {
  const g = new THREE.Group();
  const ROBE = BRICK, ROBEDK = BRICK_DK, GOLD = THEME.goldLight;
  g.add(cyl(0.26, 0.44, 0.68, ROBE, 0, 0.4, 0));
  g.add(teamPart(cyl(0.36, 0.38, 0.08, THEME.deepBlue, 0, 0.5, 0))); // sash
  g.add(diamond(0.08, GOLD, 0, 0.62, 0.32));
  const head = sphere(0.3, SKIN, 0, 1.02, 0);
  addEyes(head, 0.3, 0.36, 0.1, "wicked");
  g.add(head);
  const t = turban(0.3, THEME.emerald, GOLD);
  t.position.y = 1.02;
  g.add(t);
  // Great brass drum strapped to the chest (bright copper read as the
  // colour-blind enemy orange).
  const drum = cyl(0.32, 0.32, 0.36, 0x8a6d3b, 0, 0.7, 0.42);
  drum.name = "drum";
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  g.add(teamPart(cyl(0.34, 0.34, 0.05, GOLD, 0, 0.7, 0.6), "dark")); // drum rim
  g.add(teamPart(cyl(0.34, 0.34, 0.05, GOLD, 0, 0.7, 0.24), "dark"));
  g.add(box(0.08, 0.5, 0.04, 0x5d4037, -0.2, 0.85, 0.1));

  const offArm = new THREE.Group();
  offArm.position.set(-0.36, 0.78, 0);
  offArm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  const malletL = cyl(0.03, 0.03, 0.4, 0x6d4c41, 0, -0.2, 0.2);
  malletL.rotation.x = Math.PI / 2;
  offArm.add(malletL);
  offArm.add(sphere(0.08, ROBEDK, 0, -0.2, 0.42));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.36, 0.8, 0);
  arm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  const mallet = cyl(0.03, 0.03, 0.45, 0x6d4c41, 0, -0.18, 0.22);
  mallet.name = "mallet";
  mallet.rotation.x = Math.PI / 2;
  arm.add(mallet);
  arm.add(sphere(0.09, GOLD, 0, -0.18, 0.46));
  g.add(arm);
  const beat = (time: number, phase: number) => {
    drum.position.y = 0.7 + Math.sin(time * 8 + phase) * 0.02;
  };
  return { group: g, arm, armRest: -0.7, swingAmp: 1.3, height: 1.55, offArm, extras: beat };
}

/**
 * Islamic wizard → ALCHEMIST: emerald robe, alembic staff, glowing
 * green elixir orb — Golden Age science mage.
 */
function buildAlchemist(): TroopRig {
  const g = new THREE.Group();
  const ROBE = THEME.emerald, ROBEDK = 0x145a3a, GOLD = THEME.goldLight;
  g.add(cyl(0.26, 0.5, 0.9, ROBE, 0, 0.46, 0));
  g.add(cyl(0.5, 0.52, 0.1, ROBEDK, 0, 0.05, 0));
  g.add(cyl(0.38, 0.4, 0.08, GOLD, 0, 0.74, 0));
  for (let i = 0; i < 3; i++) g.add(sphere(0.045, GOLD, 0, 0.6 - i * 0.16, 0.4));
  const head = sphere(0.32, SKIN, 0, 1.12, 0);
  addEyes(head, 0.32, 0.32, 0.08, "calm");
  g.add(head);
  const beard = cone(0.18, 0.38, 0x6b4a2e, 0, 0.86, 0.12);
  beard.rotation.x = Math.PI;
  g.add(beard);
  const t = turban(0.32, THEME.deepBlue, 0x76ff03, true);
  t.position.y = 1.12;
  g.add(t);

  const offArm = new THREE.Group();
  offArm.position.set(-0.4, 0.78, 0);
  offArm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  offArm.add(cyl(0.032, 0.038, 1.0, 0x6d4c41, 0, -0.05, 0.08));
  const alembic = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glow(0x76ff03, 1.4));
  alembic.name = "alembic";
  alembic.position.set(0, 0.48, 0.08);
  offArm.add(alembic);
  const neck = new THREE.Mesh(
    cachedGeo("c:0.04:0.06:0.18", () => new THREE.CylinderGeometry(0.04, 0.06, 0.18, 20)),
    glow(0x9bf0a0, 1.2),
  );
  neck.position.set(0, 0.62, 0.08);
  offArm.add(neck);
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.4, 0.8, 0);
  arm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glow(0x76ff03, 1.8));
  orb.name = "elixir";
  orb.position.set(0, -0.34, 0.1);
  arm.add(orb);
  g.add(arm);
  const flicker = (tm: number, phase: number) => {
    orb.scale.setScalar(1 + Math.sin(tm * 11 + phase) * 0.12);
    alembic.rotation.y = tm * 1.2;
  };
  return { group: g, arm, armRest: -0.9, swingAmp: 1.1, height: 1.7, offArm, extras: flicker };
}

/**
 * Islamic PEKKA → CATAPHRACT: fully armoured cavalryman on a barded
 * horse — scale mail, nasal helm, heavy kontos lance. Tall tank silhouette.
 */
function buildCataphract(): TroopRig {
  const g = new THREE.Group();
  const ARMOR = 0x4a5568, ARMORDK = 0x2e3644, GOLD = THEME.goldLight, HORSE = 0x6d5a48;
  const legs = [
    makeLeg(HORSE, -0.24, 0.44, 0.16, 0.4),
    makeLeg(HORSE, 0.24, 0.44, 0.16, 0.4),
    makeLeg(HORSE, -0.24, 0.44, 0.16, -0.4),
    makeLeg(HORSE, 0.24, 0.44, 0.16, -0.4),
  ];
  g.add(...legs);
  const horse = sphere(0.44, HORSE, 0, 0.72, 0);
  horse.scale.set(0.8, 0.72, 1.55);
  g.add(horse);
  g.add(teamPart(box(0.85, 0.5, 1.4, ARMOR, 0, 0.78, 0), "dark")); // barding
  g.add(box(0.9, 0.1, 1.45, GOLD, 0, 0.55, 0));
  const hHead = sphere(0.26, HORSE, 0, 1.16, 0.7);
  g.add(hHead);
  g.add(box(0.4, 0.28, 0.35, ARMOR, 0, 1.2, 0.7)); // chanfron
  for (const s of [-1, 1]) {
    g.add(sphere(0.04, 0x1f2430, s * 0.1, 1.26, 0.88));
    const ear = cone(0.06, 0.16, HORSE, s * 0.12, 1.42, 0.55);
    ear.rotation.z = -s * 0.2;
    g.add(ear);
  }

  g.add(cyl(0.22, 0.28, 0.42, ARMOR, 0, 1.3, -0.05));
  g.add(teamPart(cyl(0.3, 0.3, 0.08, THEME.terracotta, 0, 1.14, -0.05))); // sash
  const head = sphere(0.28, SKIN, 0, 1.72, -0.05);
  addEyes(head, 0.28, 0.34, 0.1, "angry");
  g.add(head);
  const helm = sphere(0.3, ARMORDK, 0, 1.82, -0.05);
  helm.name = "nasal-helm";
  helm.scale.y = 0.75;
  g.add(helm);
  g.add(box(0.08, 0.22, 0.08, ARMORDK, 0, 1.68, 0.22)); // nasal
  g.add(cyl(0.32, 0.32, 0.08, GOLD, 0, 1.92, -0.05));
  for (const s of [-1, 1]) g.add(sphere(0.14, ARMOR, s * 0.34, 1.4, -0.05));

  const offArm = new THREE.Group();
  offArm.position.set(-0.32, 1.38, -0.05);
  offArm.add(box(0.12, 0.28, 0.12, ARMOR, 0, -0.14, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.34, 1.42, 0);
  arm.add(box(0.12, 0.26, 0.12, ARMOR, 0, -0.13, 0));
  const lance = cyl(0.04, 0.06, 1.6, 0xdde4ec);
  lance.name = "kontos";
  lance.rotation.x = Math.PI / 2;
  lance.position.set(0, -0.2, 0.75);
  arm.add(lance);
  const tip = cone(0.08, 0.24, 0xb7c2cc);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, -0.2, 1.6);
  arm.add(tip);
  g.add(arm);
  return { group: g, arm, armRest: -0.2, swingAmp: 1.4, height: 2.35, legs, offArm };
}

/**
 * Islamic mega-knight → MAMLUK AMIR: ornate teal-and-gold plate, fluted
 * helmet with nasal, and spiked mace fists — elite commander on foot.
 */
function buildMamlukAmir(): TroopRig {
  const g = new THREE.Group();
  // Teal plate (deep blue read as the blue team); skirt and pauldrons carry it.
  const PLATE = 0x1d6f74, STEEL = 0x9aa6b5, GOLD = THEME.goldLight;
  const legs = [makeLeg(PLATE, -0.2, 0.34, 0.22), makeLeg(PLATE, 0.2, 0.34, 0.22)];
  g.add(...legs);
  g.add(box(0.72, 0.55, 0.52, PLATE, 0, 0.64, 0));
  g.add(box(0.55, 0.4, 0.45, STEEL, 0, 0.68, 0.05));
  g.add(diamond(0.12, GOLD, 0, 0.78, 0.3));
  g.add(teamPart(cyl(0.42, 0.48, 0.12, THEME.terracotta, 0, 0.32, 0))); // skirt
  for (const sx of [-1, 1]) {
    g.add(teamPart(sphere(0.24, STEEL, sx * 0.48, 0.92, 0), "dark"));
    g.add(cone(0.07, 0.22, GOLD, sx * 0.48, 1.1, 0));
  }
  const head = sphere(0.32, SKIN, 0, 1.2, 0);
  addEyes(head, 0.32, 0.3, 0.06, "angry");
  g.add(head);
  const helm = sphere(0.34, PLATE, 0, 1.3, -0.02);
  helm.name = "mamluk-helm";
  helm.scale.y = 0.8;
  g.add(helm);
  g.add(box(0.08, 0.2, 0.08, STEEL, 0, 1.14, 0.28)); // nasal
  g.add(cyl(0.36, 0.36, 0.1, GOLD, 0, 1.42, 0));
  g.add(cone(0.1, 0.28, GOLD, 0, 1.62, -0.02)); // fluted spike

  const makeMace = (mx: number): THREE.Group => {
    const a = new THREE.Group();
    a.position.set(mx * 0.5, 0.78, 0.05);
    a.add(box(0.2, 0.34, 0.2, PLATE, 0, -0.14, 0));
    a.add(sphere(0.2, STEEL, 0, -0.36, 0.04));
    for (const dx of [-0.12, 0, 0.12]) {
      const sp = cone(0.05, 0.2, GOLD, dx, -0.36, 0.22);
      sp.rotation.x = Math.PI / 2;
      a.add(sp);
    }
    return a;
  };
  const arm = makeMace(1);
  const offArm = makeMace(-1);
  g.add(arm, offArm);
  return { group: g, arm, armRest: -0.4, swingAmp: 1.8, height: 1.8, legs, offArm };
}

/**
 * Islamic baby-dragon → ROC HATCHLING: cream-and-gold mythical chick with
 * hooked beak and broad feathered wings — Arabian Nights flyer.
 */
function buildRocHatchling(): TroopRig {
  const g = new THREE.Group();
  const CREAM = THEME.cream, GOLD = THEME.goldLight, SAND = THEME.sand;
  const body = sphere(0.48, CREAM, 0, 0.52, 0);
  body.scale.set(0.95, 0.9, 1.05);
  g.add(body);
  const belly = sphere(0.36, SAND, 0, 0.44, 0.18);
  belly.scale.set(0.8, 0.75, 0.55);
  g.add(belly);
  const head = sphere(0.36, CREAM, 0, 1.05, 0.2);
  g.add(head);
  const beak = cone(0.12, 0.32, GOLD, 0, 0.96, 0.52);
  beak.name = "beak";
  beak.rotation.x = Math.PI / 2.2;
  g.add(beak);
  for (const s of [-1, 1]) {
    g.add(sphere(0.09, 0xffffff, s * 0.14, 1.16, 0.42));
    g.add(sphere(0.045, 0x1f2430, s * 0.14, 1.16, 0.5));
    const crest = cone(0.06, 0.18, GOLD, s * 0.12, 1.38, 0.05);
    crest.name = "crest";
    g.add(crest);
  }
  const tail = cone(0.14, 0.55, SAND, 0, 0.42, -0.62);
  tail.rotation.x = Math.PI / 2.4;
  g.add(tail);
  g.add(sphere(0.12, GOLD, -0.2, 0.12, 0.1));
  g.add(sphere(0.12, GOLD, 0.2, 0.12, 0.1));
  // Art bible 7: the ONE team slot, a scarf like the Classic dragon's.
  g.add(...teamScarf(0.32, 0.88, 0.16, 0.6));

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = featherWing(s, 0.74, 0.46, GOLD, 0xb98a2e, "roc-wing");
    wing.position.set(s * 0.36, 0.86, -0.08);
    wing.rotation.z = s * 0.28;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.28, amp: s * 0.55 });
  }
  const wag = (tm: number, phase: number) => {
    tail.rotation.z = Math.sin(tm * 4 + phase) * 0.25;
  };
  return {
    group: g, arm: null, armRest: 0, swingAmp: 0, height: 1.5, hover: 1.0, wings, extras: wag,
  };
}

/**
 * Islamic gargoyles/minions → WAR FALCON: sleek hunting falcon with
 * hooded head, talons, and pointed wings — Golden Age aerial scout.
 */
function buildWarFalcon(): TroopRig {
  const g = new THREE.Group();
  // Art bible 7: the ONE team slot is the falconer's hood; the wings are barred brown.
  const PLUME = 0x86694f, GOLD = THEME.goldLight, BODY = 0xc9a165;
  const body = sphere(0.22, BODY, 0, 0.4, 0);
  body.scale.set(0.9, 1.15, 1.1);
  g.add(body);
  const head = sphere(0.16, BODY, 0, 0.72, 0.12);
  g.add(head);
  const hood = sphere(0.17, 0xffffff, 0, 0.74, 0.1);
  hood.name = "falcon-hood";
  hood.scale.set(1.05, 0.9, 1.0);
  g.add(teamPart(hood));
  g.add(box(0.2, 0.04, 0.04, GOLD, 0, 0.74, 0.26)); // hood strap
  const beak = cone(0.04, 0.12, GOLD, 0, 0.68, 0.28);
  beak.name = "beak";
  beak.rotation.x = Math.PI / 2;
  g.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glow(0xffe082, 1.6));
    eye.position.set(s * 0.07, 0.76, 0.22);
    g.add(eye);
  }
  const legs = [
    makeLeg(BODY, -0.08, 0.18, 0.06),
    makeLeg(BODY, 0.08, 0.18, 0.06),
  ];
  g.add(...legs);

  const offArm = new THREE.Group();
  offArm.position.set(-0.16, 0.48, 0);
  offArm.add(box(0.05, 0.14, 0.05, BODY, 0, -0.07, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.16, 0.48, 0.04);
  arm.add(box(0.05, 0.14, 0.05, BODY, 0, -0.07, 0));
  arm.add(cone(0.03, 0.08, GOLD, 0, -0.18, 0.04)); // talon
  g.add(arm);

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = featherWing(s, 0.52, 0.3, PLUME, 0x5c3c22, "falcon-wing");
    wing.position.set(s * 0.14, 0.58, -0.08);
    wing.rotation.z = s * 0.5;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.5, amp: s * 0.75 });
  }
  return {
    group: g, arm, armRest: -0.4, swingAmp: 0.9, height: 1.0, hover: 0.9, wings, legs, offArm,
  };
}

/**
 * Islamic skeletons → MILITIA: tiny turbaned spearmen — same swarm role,
 * human Golden Age silhouette instead of bare bones.
 */
function buildMilitia(): TroopRig {
  const g = new THREE.Group();
  const CLOTH = THEME.cream, SASH = BRICK;
  const legs = [makeLeg(CLOTH, -0.08, 0.18, 0.08), makeLeg(CLOTH, 0.08, 0.18, 0.08)];
  g.add(...legs);
  g.add(cyl(0.14, 0.18, 0.28, CLOTH, 0, 0.34, 0));
  g.add(cyl(0.19, 0.19, 0.05, SASH, 0, 0.24, 0));
  const head = sphere(0.16, SKIN, 0, 0.62, 0);
  addEyes(head, 0.16, 0.4, 0.08, "brave");
  g.add(head);
  const t = turban(0.16, THEME.deepBlue, THEME.goldLight, true);
  t.position.y = 0.62;
  g.add(t);

  const offArm = new THREE.Group();
  offArm.position.set(-0.14, 0.42, 0);
  offArm.add(box(0.06, 0.16, 0.06, CLOTH, 0, -0.08, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.14, 0.44, 0);
  arm.add(box(0.06, 0.14, 0.06, CLOTH, 0, -0.07, 0));
  const spear = cyl(0.02, 0.02, 0.55, 0x6d4c41, 0, 0.05, 0.05);
  spear.name = "spear";
  arm.add(spear);
  arm.add(cone(0.04, 0.1, 0xb7c2cc, 0, 0.36, 0.05));
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.5, height: 0.9, legs, offArm };
}

/**
 * Islamic royal-giant → BOMBARDIER: bare-bellied siege giant hoisting an
 * ornate bronze bombard with Islamic geometric bands.
 */
function buildBombardier(): TroopRig {
  const g = new THREE.Group();
  // Emerald cloth (deep blue read as the blue team, terracotta as red or
  // colour-blind orange); chest panel and turban carry the team colour.
  // Dark bronze for the same reason: polished bronze toons to that orange.
  const BRONZE = 0x8a6d3b, GOLD = THEME.goldLight, CLOTH = THEME.emerald;
  const legs = [makeLeg(0x7a5230, -0.26, 0.34, 0.26), makeLeg(0x7a5230, 0.26, 0.34, 0.26)];
  g.add(...legs);
  const belly = sphere(0.62, 0xb08a62, 0, 0.95, 0); // muted tan (see buildGiant)
  belly.scale.set(1, 0.95, 0.82);
  g.add(belly);
  g.add(teamPart(box(0.4, 0.7, 0.08, CLOTH, 0, 0.96, 0.5))); // chest panel
  g.add(box(0.1, 0.7, 0.02, GOLD, 0, 0.96, 0.55));
  g.add(cyl(0.63, 0.63, 0.12, GOLD, 0, 0.55, 0));
  g.add(cyl(0.5, 0.6, 0.34, CLOTH, 0, 0.4, 0));
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "brave");
  g.add(head);
  const beard = sphere(0.4, 0x4a3526, 0, 1.56, 0.14);
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  const t = turban(0.42, CLOTH, GOLD, true);
  t.position.y = 1.78;
  g.add(t);

  const offArm = new THREE.Group();
  offArm.position.set(-0.46, 1.0, 0.24);
  offArm.add(box(0.24, 0.46, 0.24, SKIN, 0, -0.2, 0));
  offArm.add(sphere(0.2, SKIN, 0, -0.42, 0.08));
  offArm.rotation.x = -0.55;
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.62, 1.2, 0);
  arm.add(box(0.24, 0.46, 0.24, SKIN, 0, -0.24, 0));
  arm.add(sphere(0.2, SKIN, 0, -0.46, 0.12));
  const cannon = new THREE.Group();
  cannon.position.set(-0.12, -0.42, 0.2);
  const barrel = cyl(0.2, 0.24, 1.1, BRONZE, 0, 0, 0);
  barrel.name = "bombard";
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.55;
  cannon.add(barrel);
  cannon.add(sphere(0.26, 0x8a5520, 0, 0, -0.04));
  for (const z of [0.4, 0.7, 1.0]) {
    const band = cyl(0.27, 0.27, 0.08, GOLD, 0, 0, 0);
    band.rotation.x = Math.PI / 2;
    band.position.z = z;
    cannon.add(band);
  }
  arm.add(cannon);
  g.add(arm);
  return { group: g, arm, armRest: -0.08, swingAmp: 0.4, height: 2.15, legs, offArm };
}

/**
 * Islamic-mode silhouette swaps. When the Arabic theme is active, these take
 * precedence over BUILDERS so a card can become a wholly different shape (the
 * Giant → a war elephant), not just gain a turban. Cards that only need light
 * theming keep their single inline-themed builder and stay out of this map.
 */
const ISLAMIC_BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
  giant: buildWarElephant,
  "hog-rider": buildCamelRaider,
  balloon: buildFireKite,
  musketeer: buildJanissary,
  "mini-pekka": buildDuelist,
  witch: buildWarDrummer,
  wizard: buildAlchemist,
  pekka: buildCataphract,
  "mega-knight": buildMamlukAmir,
  "baby-dragon": buildRocHatchling,
  gargoyles: buildWarFalcon,
  minions: buildWarFalcon,
  skeletons: buildMilitia,
  "skeleton-army": buildMilitia,
  "royal-giant": buildBombardier,
  // Card wave 3: a carved sandstone guardian, its little blocks, and a
  // desert treasure-digger with a shovel.
  "stone-golem": buildSandstoneGolem,
  "pebble-golem": buildSandPebble,
  digger: buildTreasureDigger,
};

/**
 * Add ink outlines to a rig's larger meshes: each gets a child hull drawn
 * with the shared constant-width outline material (see outlineMaterial.ts).
 * Baked troop rigs use bakeRig instead, which builds one hull per animated
 * node; this stays the path for rigs that are not baked (card portraits,
 * the gallery, tower crews, the deploy ghost).
 */
/** Face parts and the orb read cleaner without ink, whatever their size. */
const UNLINED = new Set(["eye", "eyerim", "pupil", "brow", "mouth", "xeyes", "orb"]);

export function outlineRig(group: THREE.Group): void {
  const targets: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === "outline" || UNLINED.has(mesh.name)) return;
    mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere?.radius ?? 0;
    const s = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
    if (r * s < OUTLINE_MIN_RADIUS) return; // tiny details read better unlined
    targets.push(mesh);
  });
  for (const mesh of targets) mesh.add(outlineHull(mesh.geometry));
}

/** First mesh child of a limb group that isn't an added joint. */
function limbMesh(group: THREE.Group): THREE.Mesh | null {
  for (const c of group.children) {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh && !mesh.name.startsWith("joint") && mesh.name !== "foot") {
      return mesh;
    }
  }
  return null;
}

/** Sphere joint sharing the limb's material (uniform flash/fade). */
function jointBall(limb: THREE.Mesh, r: number, name: string): THREE.Mesh {
  const geo = cachedGeo(`s:${r}`, () => new THREE.SphereGeometry(r, 20, 16));
  const ball = new THREE.Mesh(geo, limb.material);
  ball.name = name;
  ball.castShadow = true;
  return ball;
}

/**
 * Ball-jointed vinyl articulation: every arm gets a shoulder ball at
 * its pivot and a gloved fist at its end; every leg gets a hip joint
 * and a chunky foot. Derived from each limb's own bounding box, so
 * all 17 rigs upgrade without per-character edits.
 */
export function articulate(rig: TroopRig): void {
  for (const armGroup of [rig.arm, rig.offArm]) {
    if (!armGroup) continue;
    const limb = limbMesh(armGroup);
    if (!limb) continue;
    limb.geometry.computeBoundingBox();
    const bb = limb.geometry.boundingBox!;
    const width = (bb.max.x - bb.min.x) * limb.scale.x;
    const shoulder = jointBall(limb, round2(width * 0.62), "joint-shoulder");
    shoulder.position.set(limb.position.x, 0, limb.position.z);
    armGroup.add(shoulder);
    const fist = jointBall(limb, round2(width * 0.58), "joint-fist");
    fist.position.set(
      limb.position.x,
      limb.position.y + bb.min.y * limb.scale.y,
      limb.position.z,
    );
    armGroup.add(fist);
  }
  for (const leg of rig.legs ?? []) {
    const limb = limbMesh(leg);
    if (!limb) continue;
    limb.geometry.computeBoundingBox();
    const bb = limb.geometry.boundingBox!;
    const width = (bb.max.x - bb.min.x) * limb.scale.x;
    const hip = jointBall(limb, round2(width * 0.62), "joint-hip");
    leg.add(hip);
    const foot = jointBall(limb, round2(width * 0.72), "foot");
    foot.scale.set(1, 0.55, 1.45); // chunky shoe, toes forward
    foot.position.set(0, limb.position.y + bb.min.y * limb.scale.y, width * 0.12);
    leg.add(foot);
  }
}

/** Stable cache keys for derived joint radii. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Build a troop's rig for one side. Bodies are team-neutral; the parts
 * tagged with teamPart() are painted in that side's team colour.
 */
export function buildTroop(cardId: CardId, side: Side = "player"): TroopRig {
  const builder = (ARABIC && ISLAMIC_BUILDERS[cardId]) || BUILDERS[cardId];
  if (!builder) throw new Error(`No 3D builder for ${cardId}`);
  const rig = builder();
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  articulate(rig);
  outlineRig(rig.group);
  applyTeam(rig.group, side);
  return rig;
}

/** Everything animateTroop reads; only the first four are required. */
export interface AnimateOpts {
  moving: boolean;
  /**
   * Signed attack swing: negative while cocking back (anticipation),
   * 1 the instant a blow lands, decaying to 0 through the follow-through.
   */
  swing: number;
  time: number;
  phase: number;
  /** Fully charged (e.g. the Prince): couch the weapon, lean in. */
  charging?: boolean;
  /** Strike pose (default: the rig's registered archetype, else a chop). */
  style?: AttackStyle;
  /** Weight class: scales the hop and waddle (default medium). */
  weight?: Weight;
  /** Four-legged leg order (default trot for four-legged rigs). */
  quad?: QuadGait;
  /** Walk-cycle angle in radians (default: time * 10 + phase). */
  stride?: number;
  /** Anticipation 0..1 (default: derived from a negative swing). */
  windup?: number;
  /** 1 between blows while engaged: a 2 Hz weapon bob and a weight shift. */
  ready?: number;
}

/** The scale a rig was built at, remembered so per-frame squash never drifts. */
function restScale(rig: TroopRig): number {
  const ud = rig.group.userData as { restScale?: number };
  if (ud.restScale === undefined) ud.restScale = rig.group.scale.x;
  return ud.restScale;
}

/**
 * The caster's orb (named 'orb'; older rigs get their glowing hand sphere
 * tagged on first use) and its built scale. Cached per rig.
 */
const ORBS = new WeakMap<TroopRig, { mesh: THREE.Object3D; base: number } | null>();

function orbOf(rig: TroopRig): { mesh: THREE.Object3D; base: number } | null {
  let hit = ORBS.get(rig);
  if (hit !== undefined) return hit;
  let found: THREE.Object3D | null = rig.group.getObjectByName("orb") ?? null;
  if (!found && rig.arm) {
    rig.arm.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (found || !mesh.isMesh) return;
      const geo = mesh.geometry as THREE.BufferGeometry & { type: string };
      if ((mesh.material as THREE.Material).type === "MeshBasicMaterial" && geo.type === "SphereGeometry") {
        found = mesh;
      }
    });
    if (found) (found as THREE.Object3D).name = "orb";
  }
  hit = found ? { mesh: found, base: (found as THREE.Object3D).scale.x } : null;
  ORBS.set(rig, hit);
  return hit;
}

const TAU = Math.PI * 2;

/**
 * Full character animation: walk cycle (legs swing, arms counter-sway,
 * body hops with squash & stretch), idle breathing, hover + wing flap
 * for flyers, and the attack in the unit's own style — a chop's arc, a
 * lance's lunge, a whirling spin, a gun's kickback, a caster's raised
 * arms, a bruiser's overhead slam — with the ready stance between blows.
 * Every channel is written absolutely each call, so the same inputs
 * always give the same pose (a frozen unit holds perfectly still).
 */
export function animateTroop(rig: TroopRig, opts: AnimateOpts): void {
  syncRigRim();
  const t = opts.time;
  const arch = rigArchetype(rig);
  const style: AttackStyle = opts.style ?? arch?.attackStyle ?? "chop";
  const weight: Weight = opts.weight ?? arch?.weight ?? "medium";
  const legCount = rig.legs?.length ?? 0;
  const quad = opts.quad ?? arch?.quad;
  const stride = opts.stride ?? t * BASE_CADENCE + opts.phase;
  const walk = Math.sin(stride);
  const base = restScale(rig);
  const g = rig.group;
  const s = opts.swing;
  const strike = s > 0 ? s : 0;
  const wind = opts.windup ?? Math.min(1, Math.max(0, -s) / 0.7);
  const ready = opts.moving ? 0 : (opts.ready ?? 0);
  const lean = opts.charging ? 0.16 : 0;
  const hopK = hopScale(weight);

  // Body channels, built up below and written once at the end.
  let posY = 0;
  let pitch = 0;
  let roll = 0;
  let yaw = 0;
  let fwd = 0; // body offset along facing (+z)
  let sx = 1;
  let sy = 1;
  let sz = 1;

  if (rig.hover) {
    // Flyers bob on two mixed frequencies so the float never reads as a loop.
    posY =
      rig.hover +
      Math.sin(t * 3 + opts.phase) * 0.1 +
      Math.sin(t * 4.7 + opts.phase * 1.3) * 0.035;
    pitch = (opts.moving ? 0.14 : 0) + lean;
    roll = Math.sin(t * 2.1 + opts.phase) * 0.05; // lazy banking sway
  } else if (opts.moving) {
    const hop = Math.abs(walk);
    posY = hop * 0.09 * hopK;
    // Squash on landing, stretch at the top of the hop.
    sy = 0.95 + hop * 0.09;
    // Heavies sink into every footfall.
    const land = (1 - hop) * (1 - hop) * (1 - hop);
    const sq = stepSquash(weight) * land;
    sy -= sq;
    sx = sz = 1 + sq * 0.5;
    pitch = 0.09 + lean;
    // Waddle: the torso rolls onto each stride like a marching toy.
    roll = walk * 0.07 * hopK;
    if (legCount === 4 && quad === "bound") pitch += Math.sin(stride + Math.PI / 2) * 0.07;
  } else {
    // Idle: gentle breathing; a slow weight-shift instead of a statue.
    sy = 1 + Math.sin(t * 2.2 + opts.phase) * 0.012;
    pitch = lean;
    roll = Math.sin(t * 1.4 + opts.phase) * 0.02;
    if (ready > 0) {
      // Ready stance: weight rocks foot to foot between blows.
      roll += Math.sin(t * TAU + opts.phase) * 0.035 * ready;
      posY += Math.abs(Math.sin(t * TAU + opts.phase)) * 0.015 * ready;
    }
  }

  // Attack body language per style.
  let armX = rig.armRest - (opts.charging ? 0.55 : 0); // weapon couched for the charge
  let offX = 0;
  let offRaised = false;
  switch (style) {
    case "chop":
      armX -= rig.swingAmp * s;
      pitch += s * 0.22;
      yaw = s * 0.2; // wind-up twists away, the blow whips through
      if (!opts.moving && !rig.hover && strike > 0) sy -= strike * 0.05;
      break;
    case "thrust":
      // The arm barely moves: the whole body lunges along the lance.
      armX += 0.3 * wind - rig.swingAmp * 0.55 * strike;
      fwd = 0.15 * strike - 0.06 * wind;
      pitch += 0.12 * strike - 0.08 * wind;
      yaw = s * 0.1;
      break;
    case "spin": {
      // Coil away, then one full whirl through the strike, blade held out.
      const strikeT = strike > 0.35 ? (1 - strike) / 0.65 : strike > 0 ? 1 : 0;
      yaw = -0.6 * wind + TAU * strikeT;
      armX -= rig.swingAmp * 0.55 * Math.min(1, strike * 3) - 0.35 * wind;
      pitch += 0.05 * strike;
      break;
    }
    case "shoot":
      // Aim steady (no arm pitch); the shot kicks the body back.
      fwd = -0.1 * strike;
      pitch += -0.08 * strike + 0.04 * wind;
      sy -= 0.06 * strike;
      sx += 0.03 * strike;
      sz += 0.03 * strike;
      break;
    case "cast":
      // Both arms rise through the windup, then push the spell out.
      armX -= 1.8 * wind + rig.swingAmp * 0.8 * strike;
      offX = -1.6 * wind - 0.6 * strike;
      offRaised = true;
      pitch += -0.06 * wind + 0.1 * strike;
      sy += 0.03 * wind;
      break;
    case "slam":
      // Overhead heave with a stretch, then a crushing squash on impact.
      armX += rig.swingAmp * 0.9 * wind - rig.swingAmp * 1.1 * strike;
      offX = rig.swingAmp * 0.9 * wind - rig.swingAmp * 1.1 * strike;
      offRaised = true;
      pitch += -0.12 * wind + 0.18 * strike;
      sy += 0.06 * wind - 0.12 * strike;
      sx += -0.03 * wind + 0.06 * strike;
      sz += -0.03 * wind + 0.06 * strike;
      break;
  }

  g.position.y = posY;
  g.position.z = fwd;
  g.scale.set(base * sx, base * sy, base * sz);
  g.rotation.x = pitch;
  g.rotation.z = roll;
  g.rotation.y = yaw;

  if (rig.legs) {
    for (let i = 0; i < legCount; i++) {
      rig.legs[i].rotation.x = opts.moving
        ? Math.sin(stride + legPhase(i, legCount, quad)) * 0.7
        : 0;
    }
  }
  if (rig.offArm) {
    // Overlapping action: the free arm trails the leg cycle slightly.
    const lagged = Math.sin(stride - 0.55);
    rig.offArm.rotation.x = (opts.moving ? -lagged * 0.55 : 0) + (offRaised ? offX : 0);
  }
  if (rig.wings) {
    for (const wing of rig.wings) {
      wing.obj.rotation.z = wing.base + Math.sin(t * 13 + opts.phase) * wing.amp;
    }
  }
  if (rig.arm) {
    rig.arm.rotation.x =
      armX +
      (opts.moving ? walk * 0.3 : 0) +
      Math.sin(t * 2 * TAU + opts.phase) * 0.08 * ready; // 2 Hz weapon bob
  }

  // Idle quirks run last; the caster's orb swells through the windup on
  // top of whatever pulse the quirk gives it.
  const orb = style === "cast" ? orbOf(rig) : null;
  if (orb) orb.mesh.scale.setScalar(orb.base);
  rig.extras?.(t, opts.phase);
  if (orb && wind > 0) orb.mesh.scale.multiplyScalar(1 + 0.4 * wind);
}
