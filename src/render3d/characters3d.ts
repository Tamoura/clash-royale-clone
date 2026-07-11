import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CardId } from "../game/cards";
import { ARABIC, THEME } from "./theme";

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

/** Shared four-band gradient for a softer toy-like cel transition. */
let toonGradient: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (!toonGradient) {
    const data = new Uint8Array([62, 132, 205, 255]);
    toonGradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
    toonGradient.minFilter = THREE.NearestFilter;
    toonGradient.magFilter = THREE.NearestFilter;
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
 * Inject a cool Fresnel rim-light into a lit material's fragment shader —
 * a bright edge where the surface turns away from the camera. This single
 * touch makes every rounded shape read as 3D and gives the whole roster a
 * premium "lit figurine" pop. Shared source ⇒ Three reuses one program.
 */
function addRimLight(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
       _rim = smoothstep(0.72, 1.0, _rim) * 0.26;
       gl_FragColor.rgb += _rim * vec3(0.42, 0.56, 0.80);
       #include <dithering_fragment>`,
    );
  };
  // Explicit key lets Three share this one shader variant across the roster.
  mat.customProgramCacheKey = () => "premium-toon-rim-v1";
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
 * Unlit "glow" material: MeshBasic ignores lighting and tone-mapping
 * mutes emissives far less, so gems, orbs, and robot eyes stay hot.
 */
function glow(color: number, _intensity = 1.6): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color });
  mat.toneMapped = false; // full saturation, no filmic rolloff
  return mat;
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
  const geo = cachedGeo(`s:${r}`, () => new THREE.SphereGeometry(r, 20, 16));
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
    () => new THREE.CylinderGeometry(rt, rb, h, 20),
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

/**
 * Expressive face: white-sclera eyes with pupils, mood-angled brows,
 * and a simple mouth (smile for cute, line otherwise).
 */
function addEyes(head: Ctx3, r: number, spread = 0.38, up = 0.1, mood: Mood = "brave"): void {
  for (const s of [-1, 1]) {
    // Dark rim so white sclera reads even on pale heads.
    const rim = sphere(r * 0.2, 0x2b2333, s * r * spread, r * up, r * 0.78);
    rim.name = "eyerim";
    head.add(rim);
    const eye = sphere(r * 0.17, 0xffffff, s * r * spread, r * up, r * 0.82);
    eye.name = "eye";
    head.add(eye);
    const pupil = sphere(r * 0.09, 0x1f2430, s * r * spread, r * up, r * 0.95);
    pupil.name = "pupil";
    head.add(pupil);
    const brow = box(r * 0.3, r * 0.07, r * 0.07, 0x2b2118, s * r * spread, r * (up + 0.27), r * 0.86);
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
 */
function turban(r: number, cloth: number, gem = 0xc0392b): THREE.Group {
  const g = new THREE.Group();
  const wrap = sphere(r * 1.14, cloth, 0, r * 0.5, 0);
  wrap.scale.set(1, 0.72, 1);
  g.add(wrap);
  const fold = sphere(r * 1.04, cloth, 0, r * 0.28, 0.04);
  fold.scale.set(1.06, 0.5, 1.06);
  g.add(fold);
  const band = box(r * 0.5, r * 0.16, r * 0.06, gem, 0, r * 0.46, r * 1.0);
  g.add(band);
  g.add(sphere(r * 0.12, gem, 0, r * 0.46, r * 1.06)); // front jewel
  g.add(cone(r * 0.16, r * 0.3, cloth, 0, r * 1.02, 0)); // top peak
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
  const BLUE = 0x2f6bd8, BLUEDK = 0x244e9c, STEEL = 0xb9c4d2, GOLD = 0xf2c14e, LEATHER = 0x5a3a1c, RED = 0xc23b3b;
  const legs = [makeLeg(BLUEDK, -0.16, 0.32, 0.18), makeLeg(BLUEDK, 0.16, 0.32, 0.18)];
  for (const leg of legs) leg.add(sphere(0.1, GOLD, 0, -0.18, 0.12)); // knee rivet
  g.add(...legs);

  // Layered torso: tunic, breastplate, chainmail collar, belt, tabard, emblem.
  g.add(cyl(0.3, 0.36, 0.5, BLUE, 0, 0.56, 0));
  g.add(box(0.56, 0.48, 0.42, STEEL, 0, 0.66, 0));
  g.add(cyl(0.28, 0.28, 0.12, 0x9aa6b5, 0, 0.92, 0));
  g.add(cyl(0.37, 0.37, 0.09, LEATHER, 0, 0.34, 0));
  g.add(box(0.13, 0.13, 0.06, GOLD, 0, 0.34, 0.28)); // buckle
  g.add(box(0.24, 0.46, 0.04, BLUEDK, 0, 0.52, 0.25)); // tabard
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
    g.add(box(0.14, 0.58, 0.2, RED, 0, 1.86, -0.06)); // plume
  }
  const cape = box(0.5, 0.7, 0.05, 0x7a1f2b, 0, 0.62, -0.28);
  cape.rotation.x = 0.08;
  g.add(cape);

  // Shield arm: a gold-bordered kite shield with a boss + emblem.
  const offArm = new THREE.Group();
  offArm.position.set(-0.42, 0.82, 0);
  offArm.add(box(0.14, 0.32, 0.14, BLUE, 0, -0.16, 0));
  offArm.add(sphere(0.11, STEEL, 0, -0.32, 0.02)); // gauntlet
  offArm.add(box(0.42, 0.56, 0.05, GOLD, -0.1, -0.28, 0.16)); // border
  offArm.add(box(0.34, 0.48, 0.07, RED, -0.1, -0.28, 0.18)); // face
  offArm.add(sphere(0.08, STEEL, -0.1, -0.22, 0.24)); // boss
  offArm.add(cone(0.07, 0.16, GOLD, -0.1, -0.4, 0.24)); // emblem
  g.add(offArm);

  // Sword arm: gauntlet, crossguard, fullered blade, gold pommel.
  const arm = new THREE.Group();
  arm.position.set(0.42, 0.84, 0);
  arm.add(box(0.15, 0.32, 0.15, BLUE, 0, -0.16, 0));
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
  g.add(cyl(0.29, 0.29, 0.07, 0x6d4c41, 0, 0.3, 0)); // belt
  for (const s of [-1, 1]) g.add(box(0.08, 0.14, 0.1, 0x6d4c41, s * 0.18, 0.7, 0.1)); // bracers cue
  const head = sphere(0.32, SKIN, 0, 0.96, 0);
  addEyes(head, 0.32, 0.36, 0.1, "cute");
  g.add(head);
  if (ARABIC) {
    const t = turban(0.32, 0x9c3848);
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
  const quiver = cyl(0.07, 0.07, 0.34, 0x6d4c41, -0.12, 0.62, -0.2);
  quiver.rotation.z = 0.35;
  g.add(quiver);
  g.add(cone(0.05, 0.1, 0xe53935, -0.18, 0.84, -0.2));
  g.add(cone(0.05, 0.1, 0xe53935, -0.08, 0.86, -0.2));

  const offArm = new THREE.Group();
  offArm.position.set(0.3, 0.62, 0);
  offArm.add(box(0.11, 0.26, 0.11, SKIN, 0, -0.13, 0));
  g.add(offArm);

  // Bow arm, held out front — the whole group thrusts on release.
  const arm = new THREE.Group();
  arm.position.set(-0.3, 0.66, 0.05);
  arm.add(box(0.11, 0.26, 0.11, SKIN, 0, -0.13, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.035, 8, 16, Math.PI),
    toon(0x8d6e63),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.26, 0.16);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.015, 0.66, 0.015, 0xe8e3d8, 0, -0.26, 0.16)); // string
  // Nocked arrow so the shot reads clearly.
  const nocked = new THREE.Group();
  nocked.position.set(0, -0.26, 0.18);
  const shaft = cyl(0.018, 0.018, 0.5, 0xd7ccc8, 0, 0, 0);
  shaft.rotation.x = Math.PI / 2;
  nocked.add(shaft);
  const tip = cone(0.04, 0.1, 0x9aa3ad, 0, 0, 0.28);
  tip.rotation.x = Math.PI / 2;
  nocked.add(tip);
  arm.add(nocked);
  g.add(arm);
  return { group: g, arm, armRest: -1.05, swingAmp: 0.7, height: 1.25, legs, offArm };
}

function buildPrincess(): TroopRig {
  // A regal archer: long cream-and-rose gown, golden crown, and a
  // golden longbow that looses a flaming arrow.
  const GOWN = 0xf6e7ef, GOWNDK = 0xe39ec4, GOLD = 0xf2c14e, HAIR = 0xffe082;
  const g = new THREE.Group();
  g.add(cyl(0.18, 0.46, 0.9, GOWN, 0, 0.46, 0)); // flowing gown
  g.add(cyl(0.46, 0.48, 0.1, GOWNDK, 0, 0.05, 0)); // rose hem
  g.add(cyl(0.27, 0.3, 0.36, GOWNDK, 0, 0.78, 0)); // rose bodice
  g.add(cyl(0.3, 0.3, 0.06, GOLD, 0, 0.62, 0)); // golden belt
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
  arm.add(box(0.1, 0.26, 0.1, SKIN, 0, -0.13, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.035, 8, 16, Math.PI),
    toon(GOLD),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.26, 0.18);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.015, 0.78, 0.015, 0xfff3c4, 0, -0.26, 0.18)); // string
  const nocked = new THREE.Group();
  nocked.position.set(0, -0.26, 0.2);
  const shaft = cyl(0.018, 0.018, 0.55, 0x6d4c41, 0, 0, 0);
  shaft.rotation.x = Math.PI / 2;
  nocked.add(shaft);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(0xff7043, 2));
  flame.position.set(0, 0, 0.32);
  nocked.add(flame);
  arm.add(nocked);
  g.add(arm);
  const flicker = (t: number, phase: number) => {
    flame.scale.setScalar(1 + Math.sin(t * 13 + phase) * 0.2);
  };
  return { group: g, arm, armRest: -1.05, swingAmp: 0.7, height: 1.35, offArm, extras: flicker };
}

function buildGiant(): TroopRig {
  const g = new THREE.Group();
  const legs = [
    makeLeg(0x7a5230, -0.26, 0.34, 0.26),
    makeLeg(0x7a5230, 0.26, 0.34, 0.26),
  ];
  g.add(...legs);
  const belly = sphere(0.62, 0xc98850, 0, 0.95, 0);
  belly.scale.set(1, 0.95, 0.82);
  g.add(belly);
  g.add(box(0.34, 0.26, 0.06, 0xa96f3d, 0.2, 0.85, 0.49)); // patch
  g.add(cyl(0.63, 0.63, 0.12, 0x7a5230, 0, 0.55, 0)); // belt
  g.add(sphere(0.11, 0xf2c14e, 0, 0.55, 0.6)); // buckle
  g.add(cyl(0.5, 0.6, 0.34, 0x8a5a35, 0, 0.4, 0)); // loincloth skirt
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "calm");
  g.add(head);
  const beard = sphere(0.4, 0x8a5a35, 0, 1.56, 0.14);
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  g.add(box(0.5, 0.07, 0.06, 0x5d3d22, 0, 1.92, 0.36)); // heavy brow
  g.add(sphere(0.09, SKIN, 0, 1.74, 0.42)); // nose
  if (ARABIC) {
    const t = turban(0.42, 0x9c5a2a, 0xf2c14e);
    t.position.y = 1.78;
    g.add(t);
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.66, 1.28, 0);
  offArm.add(box(0.24, 0.5, 0.24, SKIN, 0, -0.3, 0));
  offArm.add(cyl(0.16, 0.16, 0.12, 0xf2c14e, 0, -0.5, 0)); // gold wristband
  offArm.add(sphere(0.21, SKIN, 0, -0.62, 0));
  offArm.rotation.x = -0.2;
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.66, 1.28, 0);
  arm.add(box(0.24, 0.5, 0.24, SKIN, 0, -0.3, 0));
  arm.add(cyl(0.17, 0.17, 0.12, 0xf2c14e, 0, -0.52, 0)); // gold wristband
  arm.add(sphere(0.23, SKIN, 0, -0.64, 0));
  g.add(arm);
  return { group: g, arm, armRest: -0.35, swingAmp: 1.4, height: 2.1, legs, offArm };
}

/**
 * Islamic mode's Giant: a caparisoned WAR ELEPHANT carrying a turbaned rider
 * (mahout) in a domed howdah. Same role/stats as the Giant — a slow, towering
 * tank that walks past troops to smash the tower — but a wholly new silhouette.
 * The rider's spear is the rig's attack arm; the trunk and ears sway in idle.
 */
function buildWarElephant(): TroopRig {
  const g = new THREE.Group();
  const GRAY = 0x8d8f96, GRAYDK = 0x6d6f77, IVORY = 0xf1e7cf;
  const GOLD = THEME.goldLight, CLOTH = THEME.terracotta, CLOTH2 = THEME.deepBlue;

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
  body.scale.set(1.05, 0.95, 1.55);
  g.add(body);
  const rump = sphere(0.66, GRAY, 0, 1.28, -0.9);
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
    ear.position.set(s * 0.5, 1.55, 0.85);
    const flap = sphere(0.4, GRAYDK, s * 0.18, 0, 0);
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
  const drape = box(1.55, 0.7, 1.7, CLOTH, 0, 1.2, -0.05);
  g.add(drape);
  g.add(box(1.6, 0.12, 1.75, GOLD, 0, 0.9, -0.05)); // gold hem
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.4;
    for (const s of [-1, 1]) {
      g.add(cone(0.07, 0.18, GOLD, x, 0.78, s * 0.85)); // hem tassels
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
    group: g, arm, armRest: -0.25, swingAmp: 1.0, height: 2.9, legs, offArm,
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
  const ARMOR = 0x2e4a8a, ARMORDK = 0x1c2f5e, GOLD = 0xf2c14e, IRON = 0x59626e, IRONDK = 0x2b3138;
  const g = new THREE.Group();
  const legs = [makeLeg(ARMORDK, -0.26, 0.34, 0.26), makeLeg(ARMORDK, 0.26, 0.34, 0.26)];
  g.add(...legs);
  const belly = sphere(0.62, 0xc98850, 0, 0.95, 0); // bare-bellied bruiser
  belly.scale.set(1, 0.95, 0.82);
  g.add(belly);
  g.add(box(0.42, 0.72, 0.1, ARMOR, 0, 0.96, 0.49)); // royal tabard
  g.add(box(0.12, 0.72, 0.02, GOLD, 0, 0.96, 0.55)); // gold stripe
  g.add(cyl(0.63, 0.63, 0.12, GOLD, 0, 0.55, 0)); // gold belt
  g.add(sphere(0.11, 0xff5252, 0, 0.55, 0.6)); // ruby buckle
  g.add(cyl(0.5, 0.6, 0.34, ARMORDK, 0, 0.4, 0)); // armoured skirt
  for (const s of [-1, 1]) g.add(sphere(0.26, IRON, s * 0.6, 1.34, 0)); // pauldrons
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "brave");
  g.add(head);
  const beard = sphere(0.4, 0xb08038, 0, 1.56, 0.14); // golden beard
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
    g.add(sphere(0.06, 0xff5252, 0, 2.14, 0.4)); // crown ruby
  }

  // Off arm braces the cannon's underside.
  const offArm = new THREE.Group();
  offArm.position.set(-0.46, 1.0, 0.24);
  offArm.add(box(0.24, 0.46, 0.24, SKIN, 0, -0.2, 0));
  offArm.add(sphere(0.2, SKIN, 0, -0.42, 0.08));
  offArm.rotation.x = -0.55;
  g.add(offArm);

  // Main arm hoists a huge forward-pointing cannon (the attack).
  const arm = new THREE.Group();
  arm.position.set(0.62, 1.2, 0);
  arm.add(box(0.24, 0.46, 0.24, SKIN, 0, -0.24, 0)); // upper arm
  arm.add(sphere(0.2, SKIN, 0, -0.46, 0.12)); // fist
  const cannon = new THREE.Group();
  cannon.position.set(-0.12, -0.42, 0.2);
  const barrel = cyl(0.2, 0.24, 1.1, IRON, 0, 0, 0);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.55;
  cannon.add(barrel);
  const breech = sphere(0.26, IRONDK, 0, 0, -0.04);
  cannon.add(breech);
  const band = cyl(0.27, 0.27, 0.12, GOLD, 0, 0, 0);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.7;
  cannon.add(band);
  const muzzle = cyl(0.28, 0.28, 0.12, GOLD, 0, 0, 0);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 1.12;
  cannon.add(muzzle);
  arm.add(cannon);
  g.add(arm);
  return { group: g, arm, armRest: -0.08, swingAmp: 0.4, height: 2.1, legs, offArm };
}

function buildMusketeer(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x283593, -0.12, 0.28, 0.14), makeLeg(0x283593, 0.12, 0.28, 0.14)];
  g.add(...legs);
  g.add(cyl(0.26, 0.38, 0.48, 0x3f51b5, 0, 0.52, 0)); // flared coat
  g.add(cyl(0.34, 0.36, 0.08, 0x283593, 0, 0.36, 0)); // sash
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
    const plume = cone(0.06, 0.32, 0x3b82f6, 0, 1.54, -0.02); // aigrette plume
    plume.rotation.z = -0.3;
    g.add(plume);
  } else {
    for (const s of [-1, 1]) {
      g.add(sphere(0.14, 0x8347c2, s * 0.22, 1.08, -0.14)); // curls
      g.add(sphere(0.1, 0x8347c2, s * 0.28, 0.94, -0.06)); // side curls
    }
    const helm = sphere(0.34, 0x9aa3ad, 0, 1.2, 0);
    helm.name = "helm";
    helm.scale.y = 0.72;
    g.add(helm);
    g.add(cyl(0.345, 0.355, 0.08, 0x78909c, 0, 1.12, 0)); // helmet rim
    const feather = cone(0.07, 0.36, 0x3b82f6, 0.22, 1.5, 0);
    feather.name = "feather";
    feather.rotation.z = -0.6;
    g.add(feather);
  }
  g.add(sphere(0.15, 0x9aa3ad, 0.36, 0.76, 0)); // shoulder pad

  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.72, 0);
  offArm.add(box(0.12, 0.28, 0.12, 0x3f51b5, 0, -0.14, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.34, 0.74, 0);
  arm.add(box(0.12, 0.26, 0.12, SKIN, 0, -0.13, 0));
  arm.add(box(0.1, 0.12, 0.55, 0x6d4c41, 0, -0.26, 0.2)); // stock braced to shoulder
  // Long-barreled musket — the range read.
  const barrel = cyl(0.035, 0.045, 0.85, 0x9aa3ad);
  barrel.name = "musket";
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.24, 0.78);
  arm.add(barrel);
  arm.add(cyl(0.055, 0.055, 0.06, 0x78909c, 0, -0.24, 1.18)); // muzzle
  g.add(arm);
  return { group: g, arm, armRest: -0.18, swingAmp: 0.4, height: 1.5, legs, offArm };
}

function buildMiniPekka(): TroopRig {
  const g = new THREE.Group();
  const STEEL = 0x3a4d6e, STEELDK = 0x202b3d, CYAN = 0x4fd8ff;
  const legs = [makeLeg(0x10141c, -0.15, 0.3, 0.18), makeLeg(0x10141c, 0.15, 0.3, 0.18)];
  g.add(...legs);
  g.add(box(0.56, 0.44, 0.4, STEELDK, 0, 0.52, 0)); // chunky body
  g.add(box(0.46, 0.16, 0.44, STEEL, 0, 0.66, 0.02)); // chest plate
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
    g.add(sphere(0.16, STEEL, s * 0.36, 0.72, 0)); // bulky pauldron
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
  g.add(box(0.26, 0.03, 0.16, BONEDK, 0, 0.3, 0));
  g.add(box(0.26, 0.03, 0.16, BONEDK, 0, 0.38, 0));
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
}

const CLASSIC_WIZARD: WizardTheme = {
  robe: 0x2456c8,
  robeDk: 0x18337e,
  trim: 0xf2c14e,
  hair: 0x6b4a2e, // brown, per the CR reference (not white)
  beard: 0x6b4a2e,
  orb: 0xff7a00,
  crystal: 0x59c8ff,
  tip: 0xfff1a8,
  mood: "brave",
  headgear: "hat",
};

function buildWizard(theme: WizardTheme = CLASSIC_WIZARD): TroopRig {
  // Premium classic wizard: flared star-trimmed robe, glowing crystal staff,
  // and a casting orb. Themed variants (electro/ice) reskin the same rig.
  const ROBE = theme.robe, ROBEDK = theme.robeDk, TRIM = theme.trim, HAIR = theme.hair;
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.52, 0.92, ROBE, 0, 0.47, 0)); // flared robe
  g.add(cyl(0.52, 0.54, 0.1, ROBEDK, 0, 0.05, 0)); // hem
  g.add(cyl(0.4, 0.42, 0.08, 0x5a3a1c, 0, 0.76, 0)); // belt
  g.add(box(0.1, 0.1, 0.05, TRIM, 0, 0.76, 0.42)); // buckle
  for (let i = 0; i < 3; i++) g.add(sphere(0.045, TRIM, 0, 0.62 - i * 0.17, 0.4)); // star buttons
  const head = sphere(0.32, SKIN, 0, 1.12, 0);
  addEyes(head, 0.32, 0.32, 0.08, theme.mood);
  g.add(head);
  // Hair tufts + short beard, kept clear of the lit face.
  for (const s of [-1, 1]) g.add(sphere(0.12, HAIR, s * 0.28, 1.02, 0.04));
  const beard = cone(0.2, 0.42, theme.beard, 0, 0.84, 0.12);
  beard.rotation.x = Math.PI;
  g.add(beard);
  let antennae: THREE.Object3D | null = null;
  if (ARABIC) {
    const t = turban(0.32, 0x2f6f6b, 0x76ff03); // teal turban, green mage jewel
    t.position.y = 1.12;
    g.add(t);
  } else if (theme.headgear === "electro") {
    // No hat: a wild electric mohawk and a crackling bolt antenna.
    for (let i = 0; i < 5; i++) {
      const spike = cone(0.06, 0.34 - Math.abs(i - 2) * 0.05, HAIR, (i - 2) * 0.1, 1.36, -0.02);
      g.add(spike);
    }
    antennae = new THREE.Group();
    const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glow(theme.tip, 2.2));
    bolt.position.set(0, 1.66, -0.02);
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
    g.add(cyl(0.46, 0.46, 0.1, ROBE, 0, 1.26, 0)); // brim band
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
  const flicker = (t: number, phase: number) => {
    const s = 1 + Math.sin(t * 11 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.05;
    orb.scale.setScalar(s);
    crystal.rotation.y = t * 1.5;
    if (antennae) antennae.rotation.y = t * 4;
  };
  return { group: g, arm, armRest: -0.9, swingAmp: 1.1, height: 1.7, offArm, extras: flicker };
}

function buildElectroWizard(): TroopRig {
  return buildWizard({
    robe: 0xf4f8ff,
    robeDk: 0x2a6fb0,
    trim: 0x4fd2ff,
    hair: 0x6fe3ff,
    beard: 0xeaf6ff,
    orb: 0x5ad1ff,
    crystal: 0x9bf0ff,
    tip: 0xb8f3ff,
    mood: "angry",
    headgear: "electro",
  });
}

function buildIceWizard(): TroopRig {
  return buildWizard({
    robe: 0x7ec8f0,
    robeDk: 0x2e6fa0,
    trim: 0xeafaff,
    hair: 0xeafaff,
    beard: 0xd6f2ff,
    orb: 0xbfeaff,
    crystal: 0xdff6ff,
    tip: 0xeafaff,
    mood: "calm",
    headgear: "ice",
  });
}

function buildWitch(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.46, 0.7, 0x4a148c, 0, 0.4, 0)); // dark robe
  g.add(cyl(0.37, 0.4, 0.08, 0x7b1fa2, 0, 0.5, 0)); // sash
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
  // CR look: violet hood draped over white hair, golden shoulder skulls.
  const hood = sphere(0.36, 0x4a148c, 0, 1.16, -0.04);
  hood.scale.set(1, 0.95, 1.02);
  g.add(hood);
  const hoodPeak = cone(0.16, 0.3, 0x4a148c, 0, 1.5, -0.12);
  hoodPeak.rotation.x = -0.35; // drapes backward
  g.add(hoodPeak);
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

function buildBalloon(): TroopRig {
  const g = new THREE.Group();
  // CR palette: dark navy/teal patched envelope, not a carnival red one.
  const NAVY = 0x224b5e, NAVYDK = 0x18374a;
  const envelope = sphere(0.55, NAVY, 0, 1.5, 0);
  envelope.scale.set(1, 1.15, 1);
  g.add(envelope);
  for (const a of [-0.6, 0.6]) {
    const stripe = cyl(0.46, 0.46, 0.14, NAVYDK, 0, 1.5 + a * 0.45, 0);
    stripe.scale.x = 1.2;
    g.add(stripe);
  }
  const patch = box(0.26, 0.22, 0.06, 0xcdb079, 0.28, 1.62, 0.42); // tan patch
  patch.rotation.z = 0.3;
  g.add(patch);
  g.add(cone(0.16, 0.22, NAVYDK, 0, 0.78, 0)); // throat
  // Wicker basket on ropes.
  const basket = cyl(0.26, 0.2, 0.3, 0x8d6e63, 0, 0.42, 0);
  g.add(basket);
  g.add(cyl(0.27, 0.27, 0.05, 0x6d4c41, 0, 0.58, 0)); // rim
  for (const s of [-1, 1]) {
    const rope = cyl(0.015, 0.015, 0.45, 0xd7ccc8, s * 0.22, 0.78, 0);
    rope.rotation.z = -s * 0.35;
    g.add(rope);
  }
  // Skeleton pilot peeking out.
  const skull = sphere(0.14, 0xf5f2ea, 0, 0.68, 0.12);
  skull.add(sphere(0.035, 0x1f2430, -0.05, 0.01, 0.115));
  skull.add(sphere(0.035, 0x1f2430, 0.05, 0.01, 0.115));
  g.add(skull);

  // Bomb-dropping arm: bony arm holding a fizzing bomb under the basket.
  const arm = new THREE.Group();
  arm.position.set(0.24, 0.5, 0.1);
  arm.add(box(0.06, 0.2, 0.06, 0xf5f2ea, 0, -0.1, 0));
  const bomb = sphere(0.16, 0x263238, 0, -0.3, 0.04);
  arm.add(bomb);
  const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(0xffa000, 2));
  fuse.position.set(0, -0.12, 0.04);
  arm.add(fuse);
  g.add(arm);
  return { group: g, arm, armRest: -0.3, swingAmp: 1.4, height: 2.2, hover: 1.7 };
}

function buildBabyDragon(): TroopRig {
  const g = new THREE.Group();
  const BODY = 0x4caf50, BELLY = 0xd4e8a8, TEAL = 0x26a69a, TEALDK = 0x1a7a72;
  const body = sphere(0.5, BODY, 0, 0.52, 0);
  body.scale.set(0.95, 0.92, 1.1);
  g.add(body);
  const belly = sphere(0.38, BELLY, 0, 0.44, 0.2);
  belly.scale.set(0.8, 0.75, 0.6);
  g.add(belly);
  const head = sphere(0.4, 0x59b75d, 0, 1.08, 0.24);
  g.add(head);
  const snout = sphere(0.22, 0x66bb6a, 0, 0.98, 0.56);
  snout.scale.set(1, 0.7, 0.9);
  g.add(snout);
  g.add(sphere(0.035, 0x1f2430, -0.07, 1.02, 0.72));
  g.add(sphere(0.035, 0x1f2430, 0.07, 1.02, 0.72));
  // Signature lolling blue tongue under the snout.
  const tongue = sphere(0.08, 0x4f9fd8, 0, 0.86, 0.64);
  tongue.name = "tongue";
  tongue.scale.set(0.8, 0.4, 1.3);
  tongue.rotation.x = 0.35;
  g.add(tongue);
  // Big yellow toy eyes.
  for (const s of [-1, 1]) {
    g.add(sphere(0.1, 0xfff59d, s * 0.18, 1.2, 0.48));
    g.add(sphere(0.05, 0x1f2430, s * 0.18, 1.2, 0.56));
  }
  // Teal back-swept horns (CR baby-dragon palette).
  for (const s of [-1, 1]) {
    const horn = cone(0.08, 0.24, TEAL, s * 0.16, 1.42, 0.08);
    horn.name = "horn";
    horn.rotation.z = -s * 0.25;
    horn.rotation.x = -0.35;
    g.add(horn);
  }
  const tail = cone(0.14, 0.65, BODY, 0, 0.44, -0.7);
  tail.rotation.x = Math.PI / 2.3;
  g.add(tail);
  const wagTail = (t: number, phase: number) => {
    tail.rotation.z = Math.sin(t * 5 + phase) * 0.35;
  };
  g.add(sphere(0.13, 0x59b75d, -0.22, 0.12, 0.1));
  g.add(sphere(0.13, 0x59b75d, 0.22, 0.12, 0.1));

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.38, 0.88, -0.1);
    // Stubby teal membranes relative to chubby body (toy-like).
    const membrane = box(0.58, 0.05, 0.38, TEAL, s * 0.32, 0, 0);
    membrane.name = "wing-membrane";
    wing.add(membrane);
    wing.add(box(0.56, 0.04, 0.06, TEALDK, s * 0.31, 0.03, 0.18));
    wing.rotation.z = s * 0.3;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.3, amp: s * 0.6 });
  }
  return {
    group: g,
    arm: null,
    armRest: 0,
    swingAmp: 0,
    height: 1.55,
    hover: 1.0,
    wings,
    extras: wagTail,
  };
}

function buildGargoyle(): TroopRig {
  const g = new THREE.Group();
  const SKINB = 0x3d4f7a, SKINDK = 0x2a3758, MEMBRANE = 0x7b4db8;
  const body = sphere(0.24, SKINB, 0, 0.38, 0);
  body.scale.set(1, 1.2, 0.9);
  g.add(body);
  const head = sphere(0.22, 0x4a5f8c, 0, 0.76, 0.04);
  g.add(head);
  // Glowing violet eyes (CR Minions read) + snaggle fangs + little horns.
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow(0xb666ff, 2));
    eye.name = "eyeglow";
    eye.position.set(s * 0.09, 0.8, 0.2);
    g.add(eye);
    const ear = cone(0.065, 0.2, SKINDK, s * 0.14, 0.96, -0.02);
    ear.name = "horn";
    ear.rotation.z = -s * 0.4;
    g.add(ear);
    g.add(box(0.028, 0.07, 0.025, 0xffffff, s * 0.045, 0.62, 0.2)); // fang
  }
  const legs = [
    makeLeg(SKINDK, -0.08, 0.16, 0.06),
    makeLeg(SKINDK, 0.08, 0.16, 0.06),
  ];
  g.add(...legs);

  const offArm = new THREE.Group();
  offArm.position.set(-0.22, 0.48, 0);
  offArm.add(box(0.07, 0.2, 0.07, SKINB, 0, -0.1, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.22, 0.48, 0);
  arm.add(box(0.07, 0.2, 0.07, SKINB, 0, -0.1, 0));
  arm.add(cone(0.04, 0.1, 0xb7c2cc, 0, -0.22, 0.03)); // claw
  g.add(arm);

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.18, 0.64, -0.12);
    const membrane = box(0.48, 0.035, 0.32, MEMBRANE, s * 0.26, 0, 0);
    membrane.name = "wing-membrane";
    wing.add(membrane);
    wing.rotation.z = s * 0.45;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.45, amp: s * 0.8 });
  }
  return {
    group: g,
    arm,
    armRest: -0.45,
    swingAmp: 1.3,
    height: 1.05,
    hover: 0.9,
    wings,
    legs,
  };
}

function buildValkyrie(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x4e342e, -0.13, 0.26, 0.16), makeLeg(0x4e342e, 0.13, 0.26, 0.16)];
  g.add(...legs);
  g.add(cyl(0.3, 0.44, 0.5, 0xb71c1c, 0, 0.5, 0)); // dress
  g.add(cyl(0.38, 0.4, 0.09, 0x6d4c41, 0, 0.34, 0)); // belt
  const head = sphere(0.3, SKIN, 0, 1.04, 0);
  addEyes(head, 0.3, 0.38, 0.1, "angry");
  g.add(head);
  if (ARABIC) {
    const t = turban(0.3, 0x9c3848, 0xf2c14e); // crimson headscarf, gold band
    t.position.y = 1.04;
    g.add(t);
  } else {
    const hair = sphere(0.31, 0xe07b39, 0, 1.12, -0.03);
    hair.scale.set(1, 0.66, 1);
    g.add(hair);
    for (const s of [-1, 1]) {
      const braid = cyl(0.07, 0.05, 0.5, 0xe07b39, s * 0.27, 0.84, -0.1);
      braid.rotation.z = s * 0.25;
      g.add(braid);
    }
  }
  // Battle armor: steel pauldrons with rivets, a leather chest guard,
  // and a gold headband.
  for (const s of [-1, 1]) {
    g.add(sphere(0.15, 0x9aa3ad, s * 0.36, 0.78, 0)); // pauldron
    g.add(sphere(0.05, 0xf2c14e, s * 0.36, 0.86, 0.08)); // rivet
  }
  g.add(box(0.36, 0.3, 0.3, 0x6b4a2a, 0, 0.66, 0.06)); // chest guard
  g.add(diamond(0.07, 0xf2c14e, 0, 0.7, 0.24)); // emblem
  g.add(cyl(0.31, 0.31, 0.06, 0xf2c14e, 0, 1.22, 0)); // headband

  const offArm = new THREE.Group();
  offArm.position.set(-0.38, 0.74, 0);
  offArm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  g.add(offArm);

  // Huge double axe with gold hubs and a haft spike.
  const arm = new THREE.Group();
  arm.position.set(0.38, 0.78, 0);
  arm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  arm.add(cyl(0.035, 0.035, 0.85, 0x6d4c41, 0, -0.1, 0.16)); // haft
  arm.add(cone(0.05, 0.2, 0xc7d0dd, 0, 0.4, 0.16)); // haft spike
  for (const s of [-1, 1]) {
    const blade = cyl(0.22, 0.22, 0.06, 0xb7c2cc, s * 0.18, 0.28, 0.16);
    blade.rotation.z = Math.PI / 2;
    blade.scale.y = 0.4;
    arm.add(blade);
    const hub = cyl(0.09, 0.09, 0.08, 0xf2c14e, s * 0.1, 0.28, 0.16);
    hub.rotation.z = Math.PI / 2;
    arm.add(hub);
  }
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
  g.add(box(0.5, 0.08, 0.5, 0xb71c1c, 0, 1.0, -0.1)); // saddle blanket

  // Rider.
  g.add(cyl(0.2, 0.26, 0.4, 0xfafafa, 0, 1.28, -0.1)); // tabard
  g.add(cyl(0.27, 0.27, 0.07, 0xf2c14e, 0, 1.12, -0.1)); // gold trim
  const head = sphere(0.3, SKIN, 0, 1.7, -0.1);
  addEyes(head, 0.3, 0.38, 0.11, "brave");
  // CR prince: brown goatee under the visored golden helm.
  const goatee = sphere(0.1, 0x5b3a21, 0, -0.2, 0.22);
  goatee.scale.set(0.9, 0.8, 0.6);
  head.add(goatee);
  g.add(head);
  if (ARABIC) {
    // Royal gold turban with a ruby jewel, in place of the helm.
    const t = turban(0.31, 0xf2c14e, 0xb71c1c);
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
  const plume = cone(0.1, 0.48, 0x3b82f6, 0, 2.32, -0.16);
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
  g.add(cyl(0.26, 0.26, 0.08, 0x4e342e, 0, 0.9, -0.12)); // belt
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
  const strap = box(0.09, 0.46, 0.05, 0x4e342e, 0, 1.06, 0.06);
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
  const GOLD = THEME.goldLight, CLOTH = THEME.terracotta, CLOTH2 = THEME.deepBlue;

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
  const drape = box(0.72, 0.34, 0.9, CLOTH, 0, 1.06, -0.12);
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
  g.add(cyl(0.22, 0.22, 0.06, CLOTH2, 0, 1.34, -0.12)); // sash
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
function buildFireKite(): TroopRig {
  const g = new THREE.Group();
  const PAPER = THEME.terracotta;
  const GOLD = THEME.goldLight, CLOTH = THEME.deepBlue;

  // Diamond canopy: a flattened octahedron with gold spars.
  const canopy = new THREE.Mesh(
    cachedGeo("kite-canopy", () => new THREE.OctahedronGeometry(0.72)),
    toon(PAPER),
  );
  canopy.scale.set(0.8, 1.1, 0.26);
  canopy.position.set(0, 1.5, 0);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  g.add(canopy);
  g.add(box(0.06, 1.5, 0.05, GOLD, 0, 1.5, 0.1)); // vertical spar
  g.add(box(1.1, 0.06, 0.05, GOLD, 0, 1.5, 0.1)); // cross spar
  g.add(diamond(0.12, GOLD, 0, 1.5, 0.16)); // center boss
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
  finial.position.set(0, 2.36, 0);
  finial.castShadow = true;
  g.add(finial);

  // Fluttering cloth tails off the kite's lower point.
  const tails: THREE.Mesh[] = [];
  for (const [dx, len, color] of [
    [-0.14, 0.5, CLOTH],
    [0, 0.62, GOLD],
    [0.14, 0.5, CLOTH],
  ] as const) {
    const tail = box(0.09, len, 0.03, color, dx, 0.52 - len / 2, -0.05);
    tail.name = "kite-tail";
    tails.push(tail);
    g.add(tail);
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
    makeLeg(0x10141c, -0.22, 0.4, 0.24),
    makeLeg(0x10141c, 0.22, 0.4, 0.24),
  ];
  g.add(...legs);
  g.add(box(0.78, 0.62, 0.52, 0x1a2333, 0, 0.7, 0)); // armored body
  g.add(box(0.5, 0.1, 0.54, 0x39455c, 0, 0.95, 0)); // chest plate ridge
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(0x8c7bff, 1.8));
  chest.position.set(0, 0.74, 0.28);
  g.add(chest);
  g.add(box(0.86, 0.62, 0.7, 0x222f47, 0, 1.5, 0)); // massive helmet head
  // Wide burning eye-slit (unlit, so it stays hot pink).
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.05), glow(0xff4fd8, 2.4));
  eye.position.set(0, 1.52, 0.36);
  g.add(eye);
  for (const s of [-1, 1]) {
    // Swept butterfly-wing horns, P.E.K.K.A's signature silhouette.
    const horn = cone(0.16, 0.8, 0xb7c2cc, s * 0.58, 1.92, 0);
    horn.rotation.z = -s * 1.05;
    horn.scale.z = 0.45; // bladed, not round
    g.add(horn);
    const hornTip = cone(0.07, 0.34, 0xdde4ec, s * 0.94, 2.08, 0);
    hornTip.rotation.z = -s * 1.25;
    hornTip.scale.z = 0.45;
    g.add(hornTip);
    g.add(sphere(0.13, 0xb7c2cc, s * 0.46, 0.98, 0)); // shoulder bolt
    g.add(cone(0.09, 0.24, 0xb7c2cc, s * 0.5, 1.18, 0)); // shoulder spike
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.52, 0.92, 0);
  offArm.add(box(0.2, 0.46, 0.2, 0x1a2333, 0, -0.24, 0));
  offArm.add(sphere(0.13, 0x39455c, 0, -0.5, 0)); // gauntlet
  g.add(offArm);

  // Two-handed great sword, carried high so the blade clears the helm.
  const arm = new THREE.Group();
  arm.position.set(0.56, 1.1, 0);
  arm.add(box(0.2, 0.42, 0.2, 0x1a2333, 0, -0.22, 0));
  arm.add(box(0.44, 0.09, 0.16, 0x39455c, 0, -0.46, 0)); // crossguard
  arm.add(box(0.13, 1.3, 0.26, 0xdde4ec, 0, 0.24, 0)); // huge blade
  arm.add(box(0.05, 1.28, 0.04, 0x9aa8bd, 0, 0.24, 0.12)); // fuller line
  // Glowing energy edges (unlit → bloom-ready).
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.3, 0.07), glow(0x76e6ff, 2.2));
    edge.position.set(s * 0.075, 0.24, 0);
    arm.add(edge);
  }
  arm.add(cone(0.13, 0.24, 0xdde4ec, 0, 1.0, 0)); // blade point
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
  arm.add(box(0.1, 0.24, 0.1, SKIN, 0, -0.12, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.03, 8, 16, Math.PI),
    toon(0x8d6e63),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.22, 0.14);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.012, 0.58, 0.012, 0xe8e3d8, 0, -0.22, 0.14)); // string
  g.add(arm);
  return { group: g, arm, armRest: -1.0, swingAmp: 0.7, height: 1.2, offArm };
}

/** The king himself, enthroned on the king tower. */
export function buildTowerKing(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.48, 0.66, 0x4365c8, 0, 0.38, 0)); // royal robe
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
  offArm.add(box(0.13, 0.28, 0.13, 0x4365c8, 0, -0.14, 0));
  g.add(offArm);

  // Sword arm raised in command.
  const arm = new THREE.Group();
  arm.position.set(0.44, 0.7, 0);
  arm.add(box(0.13, 0.28, 0.13, 0x4365c8, 0, -0.14, 0));
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
  g.add(band);

  const offArm = new THREE.Group();
  offArm.position.set(-0.3, 0.62, 0);
  offArm.add(box(0.11, 0.26, 0.11, 0x2b2333, 0, -0.13, 0)); // dark glove
  g.add(offArm);

  // Oversized firework launcher tube on the shoulder.
  const arm = new THREE.Group();
  arm.position.set(0.32, 0.66, 0.05);
  arm.add(box(0.11, 0.26, 0.11, 0x2b2333, 0, -0.13, 0)); // dark glove
  const tube = cyl(0.15, 0.15, 0.72, 0x8d6e63, 0, -0.24, 0.34);
  tube.name = "launcher";
  tube.rotation.x = Math.PI / 2;
  arm.add(tube);
  arm.add(cyl(0.17, 0.17, 0.06, 0xf2c14e, 0, -0.24, 0.68).rotateX(Math.PI / 2));
  arm.add(sphere(0.08, 0xffd54f, 0, -0.24, 0.74)); // packed firework
  const fuse = cyl(0.012, 0.012, 0.12, 0x4a4a4a, 0.0, -0.1, 0.3);
  fuse.rotation.z = 0.5;
  arm.add(fuse);
  g.add(arm);
  return { group: g, arm, armRest: -0.2, swingAmp: 0.5, height: 1.35, legs, offArm };
}

function buildMagicArcher(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x2a1f44, -0.12, 0.3, 0.14), makeLeg(0x2a1f44, 0.12, 0.3, 0.14)];
  g.add(...legs);
  g.add(cyl(0.24, 0.36, 0.56, 0x5e3aa6, 0, 0.56, 0)); // long mystic robe
  g.add(cyl(0.3, 0.32, 0.07, 0x3c2470, 0, 0.42, 0)); // sash
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
  const hood = sphere(0.32, 0x4a2d8f, 0, 1.12, -0.04);
  hood.scale.set(1, 0.9, 1);
  g.add(hood);
  g.add(cone(0.2, 0.4, 0x4a2d8f, 0, 1.42, -0.06)); // hood point

  const offArm = new THREE.Group();
  offArm.position.set(0.32, 0.76, 0);
  offArm.add(box(0.11, 0.28, 0.11, 0x5e3aa6, 0, -0.14, 0));
  g.add(offArm);

  // Bow arm out front, holding a glowing nocked arrow.
  const arm = new THREE.Group();
  arm.position.set(-0.32, 0.78, 0.05);
  arm.add(box(0.11, 0.28, 0.11, 0x5e3aa6, 0, -0.14, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.035, 8, 16, Math.PI),
    toon(0x37206b),
  );
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

function buildBat(): TroopRig {
  const g = new THREE.Group();
  const body = sphere(0.16, 0x3a2f4a, 0, 0.3, 0);
  body.scale.set(1, 1.05, 0.9);
  g.add(body);
  for (const s of [-1, 1]) {
    g.add(cone(0.06, 0.16, 0x2c2338, s * 0.08, 0.46, 0)); // ear
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glow(0xffd54f, 2));
    eye.position.set(s * 0.06, 0.32, 0.13);
    g.add(eye);
    g.add(box(0.02, 0.05, 0.02, 0xffffff, s * 0.03, 0.22, 0.12)); // fang
  }
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.12, 0.32, -0.04);
    wing.add(box(0.34, 0.03, 0.22, 0x2c2338, s * 0.18, 0, 0));
    wing.rotation.z = s * 0.4;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.4, amp: s * 0.9 });
  }
  return { group: g, arm: null, armRest: 0, swingAmp: 0, height: 0.7, hover: 0.85, wings };
}

function buildMinion(): TroopRig {
  const g = new THREE.Group();
  const body = sphere(0.2, 0x2f6fb0, 0, 0.36, 0);
  body.scale.set(1, 1.15, 0.92);
  g.add(body);
  g.add(sphere(0.17, 0x3f7fc0, 0, 0.66, 0.03)); // head
  g.add(cone(0.05, 0.14, 0x9fd0ff, 0, 0.84, 0)); // horn
  const beak = cone(0.05, 0.12, 0xffca28, 0, 0.64, 0.2);
  beak.rotation.x = Math.PI / 2;
  g.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(0xfff1a8, 2));
    eye.position.set(s * 0.07, 0.7, 0.16);
    g.add(eye);
  }
  const offArm = new THREE.Group();
  offArm.position.set(-0.18, 0.44, 0);
  offArm.add(box(0.06, 0.18, 0.06, 0x2f6fb0, 0, -0.09, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.18, 0.44, 0.04);
  arm.add(box(0.06, 0.18, 0.06, 0x2f6fb0, 0, -0.09, 0));
  g.add(arm);
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.16, 0.56, -0.1);
    wing.add(box(0.4, 0.03, 0.26, 0x255f96, s * 0.22, 0, 0));
    wing.rotation.z = s * 0.45;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.45, amp: s * 0.8 });
  }
  return { group: g, arm, armRest: -0.4, swingAmp: 0.8, height: 0.95, hover: 0.88, wings, offArm };
}

function buildExecutioner(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x2f3a2c, -0.16, 0.3, 0.18), makeLeg(0x2f3a2c, 0.16, 0.3, 0.18)];
  g.add(...legs);
  g.add(cyl(0.34, 0.42, 0.5, 0x3f7a4a, 0, 0.56, 0)); // burly tunic
  g.add(cyl(0.44, 0.44, 0.1, 0x2c5836, 0, 0.36, 0)); // belt
  const head = sphere(0.3, SKIN, 0, 1.06, 0);
  addEyes(head, 0.3, 0.34, 0.06, "angry");
  g.add(head);
  const hood = sphere(0.34, 0x2f5d3a, 0, 1.12, -0.04);
  hood.scale.set(1, 0.95, 1);
  g.add(hood);
  g.add(cone(0.18, 0.34, 0x2f5d3a, 0, 1.42, -0.06)); // hood point
  for (const s of [-1, 1]) g.add(sphere(0.16, 0x2c5836, s * 0.4, 0.78, 0)); // shoulder pads

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
  const DARK = 0x2c2748,
    STEEL = 0x9aa6b5,
    DARKSTEEL = 0x3b3a55,
    GOLD = 0xe8b84b,
    SPIKE = 0xd7dee8;

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
    g.add(sphere(0.27, DARKSTEEL, sx * 0.52, 0.96, 0));
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
  g.add(cyl(0.37, 0.4, 0.16, DARK, 0, 1.36, 0));
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

const BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
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
};

/**
 * Islamic musketeer → JANISSARY: tall white börk hat, teal coat with gold
 * trim, and a long matchlock — Ottoman elite gunner silhouette.
 */
function buildJanissary(): TroopRig {
  const g = new THREE.Group();
  const COAT = THEME.deepBlue, TRIM = THEME.goldLight, HAT = 0xf5f0e6;
  const legs = [makeLeg(COAT, -0.12, 0.28, 0.14), makeLeg(COAT, 0.12, 0.28, 0.14)];
  g.add(...legs);
  g.add(cyl(0.26, 0.4, 0.5, COAT, 0, 0.52, 0));
  g.add(cyl(0.36, 0.36, 0.08, THEME.terracotta, 0, 0.34, 0)); // sash
  g.add(box(0.1, 0.4, 0.04, TRIM, 0.16, 0.56, 0.32));
  const head = sphere(0.3, SKIN, 0, 1.02, 0);
  addEyes(head, 0.3, 0.36, 0.1, "brave");
  g.add(head);
  // Signature tall white börk with a dangling cloth sleeve.
  const bork = cyl(0.22, 0.28, 0.55, HAT, 0, 1.42, -0.02);
  bork.name = "bork";
  g.add(bork);
  g.add(cyl(0.3, 0.3, 0.08, TRIM, 0, 1.16, 0)); // gold band
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
  const MAIL = 0x5a6a78, CLOTH = THEME.terracotta, GOLD = THEME.goldLight, STEEL = 0xb7c2cc;
  const legs = [makeLeg(0x3a4550, -0.13, 0.28, 0.15), makeLeg(0x3a4550, 0.13, 0.28, 0.15)];
  g.add(...legs);
  g.add(cyl(0.24, 0.32, 0.44, MAIL, 0, 0.5, 0));
  g.add(cyl(0.33, 0.33, 0.08, CLOTH, 0, 0.34, 0));
  g.add(diamond(0.08, GOLD, 0, 0.62, 0.28));
  const head = sphere(0.28, SKIN, 0, 0.98, 0);
  addEyes(head, 0.28, 0.36, 0.1, "angry");
  g.add(head);
  const t = turban(0.28, THEME.deepBlue, GOLD);
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
  const ROBE = THEME.terracotta, ROBEDK = 0x8a3a22, GOLD = THEME.goldLight;
  g.add(cyl(0.26, 0.44, 0.68, ROBE, 0, 0.4, 0));
  g.add(cyl(0.36, 0.38, 0.08, THEME.deepBlue, 0, 0.5, 0));
  g.add(diamond(0.08, GOLD, 0, 0.62, 0.32));
  const head = sphere(0.3, SKIN, 0, 1.02, 0);
  addEyes(head, 0.3, 0.36, 0.1, "wicked");
  g.add(head);
  const t = turban(0.3, THEME.emerald, GOLD);
  t.position.y = 1.02;
  g.add(t);
  // Great copper drum strapped to the chest.
  const drum = cyl(0.32, 0.32, 0.36, 0xc47a3a, 0, 0.7, 0.42);
  drum.name = "drum";
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  g.add(cyl(0.34, 0.34, 0.05, GOLD, 0, 0.7, 0.6)); // drum rim
  g.add(cyl(0.34, 0.34, 0.05, GOLD, 0, 0.7, 0.24));
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
  const t = turban(0.32, THEME.deepBlue, 0x76ff03);
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
  g.add(box(0.85, 0.5, 1.4, ARMOR, 0, 0.78, 0));
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
  g.add(cyl(0.3, 0.3, 0.08, THEME.terracotta, 0, 1.14, -0.05));
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
  const PLATE = THEME.deepBlue, STEEL = 0x9aa6b5, GOLD = THEME.goldLight;
  const legs = [makeLeg(PLATE, -0.2, 0.34, 0.22), makeLeg(PLATE, 0.2, 0.34, 0.22)];
  g.add(...legs);
  g.add(box(0.72, 0.55, 0.52, PLATE, 0, 0.64, 0));
  g.add(box(0.55, 0.4, 0.45, STEEL, 0, 0.68, 0.05));
  g.add(diamond(0.12, GOLD, 0, 0.78, 0.3));
  g.add(cyl(0.42, 0.48, 0.12, THEME.terracotta, 0, 0.32, 0));
  for (const sx of [-1, 1]) {
    g.add(sphere(0.24, STEEL, sx * 0.48, 0.92, 0));
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

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.36, 0.86, -0.08);
    const feather = box(0.7, 0.06, 0.42, GOLD, s * 0.38, 0, 0);
    feather.name = "roc-wing";
    wing.add(feather);
    wing.add(box(0.65, 0.04, 0.08, THEME.terracotta, s * 0.36, 0.04, 0.18));
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
  const PLUME = THEME.terracotta, GOLD = THEME.goldLight, BODY = 0xc9a165;
  const body = sphere(0.22, BODY, 0, 0.4, 0);
  body.scale.set(0.9, 1.15, 1.1);
  g.add(body);
  const head = sphere(0.16, BODY, 0, 0.72, 0.12);
  g.add(head);
  const hood = sphere(0.17, PLUME, 0, 0.74, 0.1);
  hood.name = "falcon-hood";
  hood.scale.set(1.05, 0.9, 1.0);
  g.add(hood);
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
    const wing = new THREE.Group();
    wing.position.set(s * 0.14, 0.58, -0.08);
    const tip = box(0.5, 0.03, 0.22, PLUME, s * 0.28, 0, 0);
    tip.name = "falcon-wing";
    wing.add(tip);
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
  const CLOTH = THEME.cream, SASH = THEME.terracotta;
  const legs = [makeLeg(CLOTH, -0.08, 0.18, 0.08), makeLeg(CLOTH, 0.08, 0.18, 0.08)];
  g.add(...legs);
  g.add(cyl(0.14, 0.18, 0.28, CLOTH, 0, 0.34, 0));
  g.add(cyl(0.19, 0.19, 0.05, SASH, 0, 0.24, 0));
  const head = sphere(0.16, SKIN, 0, 0.62, 0);
  addEyes(head, 0.16, 0.4, 0.08, "brave");
  g.add(head);
  const t = turban(0.16, THEME.deepBlue, THEME.goldLight);
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
  const BRONZE = 0xb87333, GOLD = THEME.goldLight, CLOTH = THEME.deepBlue;
  const legs = [makeLeg(0x7a5230, -0.26, 0.34, 0.26), makeLeg(0x7a5230, 0.26, 0.34, 0.26)];
  g.add(...legs);
  const belly = sphere(0.62, 0xc98850, 0, 0.95, 0);
  belly.scale.set(1, 0.95, 0.82);
  g.add(belly);
  g.add(box(0.4, 0.7, 0.08, CLOTH, 0, 0.96, 0.5));
  g.add(box(0.1, 0.7, 0.02, GOLD, 0, 0.96, 0.55));
  g.add(cyl(0.63, 0.63, 0.12, GOLD, 0, 0.55, 0));
  g.add(cyl(0.5, 0.6, 0.34, CLOTH, 0, 0.4, 0));
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "brave");
  g.add(head);
  const beard = sphere(0.4, 0x4a3526, 0, 1.56, 0.14);
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  const t = turban(0.42, CLOTH, GOLD);
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
};

/**
 * Add inverted-hull silhouette outlines to a rig's larger meshes.
 * One black material per rig so death-fade can't bleed across units.
 */
/** Bold CR-style cel outline: near-black and thick. */
const OUTLINE_COLOR = 0x0b0e16;
const OUTLINE_SCALE = 1.075;

export function outlineRig(group: THREE.Group): void {
  const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  const targets: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === "outline") return;
    mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere?.radius ?? 0;
    const s = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
    if (r * s < 0.14) return; // tiny details read better unlined
    targets.push(mesh);
  });
  for (const mesh of targets) {
    const hull = new THREE.Mesh(mesh.geometry, mat);
    hull.name = "outline";
    hull.scale.setScalar(OUTLINE_SCALE);
    hull.castShadow = false;
    hull.receiveShadow = false;
    mesh.add(hull);
  }
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

export function buildTroop(cardId: CardId): TroopRig {
  const builder = (ARABIC && ISLAMIC_BUILDERS[cardId]) || BUILDERS[cardId];
  if (!builder) throw new Error(`No 3D builder for ${cardId}`);
  const rig = builder();
  if (rig.arm) rig.arm.rotation.x = rig.armRest;
  articulate(rig);
  outlineRig(rig.group);
  return rig;
}

/**
 * Full character animation: walk cycle (legs swing, arms counter-sway,
 * body hops with squash & stretch), idle breathing, hover + wing flap
 * for flyers, and the attack swing with a forward lunge.
 * swing is 1 right after a hit, decaying to 0.
 */
export function animateTroop(
  rig: TroopRig,
  opts: {
    moving: boolean;
    swing: number;
    time: number;
    phase: number;
    /** Fully charged (e.g. the Prince): couch the weapon, lean in. */
    charging?: boolean;
  },
): void {
  const t = opts.time;
  const walk = Math.sin(t * 10 + opts.phase);
  const baseScale = rig.group.scale.x;
  const lean = opts.charging ? 0.16 : 0;

  if (rig.hover) {
    rig.group.position.y = rig.hover + Math.sin(t * 3 + opts.phase) * 0.1;
    rig.group.rotation.x = (opts.moving ? 0.14 : 0) + opts.swing * 0.25 + lean;
  } else if (opts.moving) {
    const hop = Math.abs(walk);
    rig.group.position.y = hop * 0.07;
    // Squash on landing, stretch at the top of the hop.
    rig.group.scale.y = baseScale * (0.96 + hop * 0.07);
    rig.group.rotation.x = 0.07 + opts.swing * 0.22 + lean;
  } else {
    // Idle: gentle breathing, squashing under a heavy strike.
    rig.group.position.y = 0;
    const squash = opts.swing > 0 ? opts.swing * 0.05 : 0;
    rig.group.scale.y =
      baseScale * (1 + Math.sin(t * 2.2 + opts.phase) * 0.012 - squash);
    rig.group.rotation.x = opts.swing * 0.22 + lean;
  }

  if (rig.legs) {
    for (let i = 0; i < rig.legs.length; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      rig.legs[i].rotation.x = opts.moving ? walk * 0.6 * dir : 0;
    }
  }
  if (rig.offArm) {
    // Overlapping action: the free arm trails the leg cycle slightly.
    const lagged = Math.sin(t * 10 + opts.phase - 0.55);
    rig.offArm.rotation.x = opts.moving ? -lagged * 0.45 : 0;
  }
  if (rig.wings) {
    for (const wing of rig.wings) {
      wing.obj.rotation.z = wing.base + Math.sin(t * 13 + opts.phase) * wing.amp;
    }
  }
  if (rig.arm) {
    rig.arm.rotation.x =
      rig.armRest -
      rig.swingAmp * opts.swing +
      (opts.moving ? walk * 0.18 : 0) -
      (opts.charging ? 0.55 : 0); // weapon couched for the charge
  }
  rig.extras?.(t, opts.phase);
}
