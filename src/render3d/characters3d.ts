import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CardId } from "../game/cards";

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

/** Shared 3-step gradient for the toon (cel) shading. */
let toonGradient: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (!toonGradient) {
    // Three hard bands with a deeper core shadow → bolder cel pop.
    const data = new Uint8Array([74, 172, 255]);
    toonGradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
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
    grainTexture.colorSpace = THREE.SRGBColorSpace;
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

  // Bigger head + face + helmet.
  const head = sphere(0.36, SKIN, 0, 1.16, 0);
  addEyes(head, 0.36, 0.32, 0.08, "brave");
  head.add(box(0.24, 0.06, 0.05, 0xd9b34a, 0, -0.12, 0.33)); // blond mustache
  g.add(head);
  g.add(cyl(0.39, 0.39, 0.12, 0x9aa6b5, 0, 1.32, 0)); // helmet brim
  const dome = sphere(0.37, STEEL, 0, 1.4, 0);
  dome.scale.y = 0.82;
  g.add(dome);
  g.add(box(0.07, 0.22, 0.06, STEEL, 0, 1.08, 0.34)); // nose guard
  g.add(box(0.1, 0.5, 0.16, 0xe23b3b, 0, 1.74, -0.05)); // plume
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
  arm.add(box(0.28, 0.07, 0.1, GOLD, 0, -0.3, 0.02)); // crossguard
  arm.add(box(0.08, 0.82, 0.14, 0xe7ecf3, 0, 0.13, 0.02)); // blade
  arm.add(sphere(0.06, GOLD, 0, -0.44, 0.02)); // pommel
  g.add(arm);

  return { group: g, arm, armRest: -0.5, swingAmp: 1.7, height: 1.6, legs, offArm };
}

function buildArcher(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x254d28, -0.11, 0.26, 0.13), makeLeg(0x254d28, 0.11, 0.26, 0.13)];
  g.add(...legs);
  g.add(cyl(0.24, 0.3, 0.4, 0x2e7d32, 0, 0.46, 0)); // tunic
  g.add(cyl(0.31, 0.31, 0.07, 0x6d4c41, 0, 0.3, 0)); // belt
  const head = sphere(0.28, SKIN, 0, 0.94, 0);
  addEyes(head, 0.28, 0.38, 0.1, "cute");
  g.add(head);
  const hair = sphere(0.29, 0xec5fa3, 0, 1.02, -0.02);
  hair.scale.set(1, 0.62, 1);
  g.add(hair);
  g.add(sphere(0.13, 0xec5fa3, 0, 1.12, -0.24)); // bun
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
  g.add(sphere(0.09, 0xf2c14e, 0, 0.55, 0.6)); // buckle
  const head = sphere(0.42, SKIN, 0, 1.72, 0);
  addEyes(head, 0.42, 0.34, 0.18, "calm");
  g.add(head);
  const beard = sphere(0.4, 0x8a5a35, 0, 1.56, 0.14);
  beard.scale.set(1, 0.62, 0.85);
  g.add(beard);
  g.add(box(0.5, 0.07, 0.06, 0x5d3d22, 0, 1.92, 0.36)); // heavy brow
  g.add(sphere(0.09, SKIN, 0, 1.74, 0.42)); // nose

  const offArm = new THREE.Group();
  offArm.position.set(-0.66, 1.28, 0);
  offArm.add(box(0.24, 0.5, 0.24, SKIN, 0, -0.3, 0));
  offArm.add(sphere(0.21, SKIN, 0, -0.62, 0));
  offArm.rotation.x = -0.2;
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.66, 1.28, 0);
  arm.add(box(0.24, 0.5, 0.24, SKIN, 0, -0.3, 0));
  arm.add(sphere(0.23, SKIN, 0, -0.64, 0));
  g.add(arm);
  return { group: g, arm, armRest: -0.35, swingAmp: 1.4, height: 2.1, legs, offArm };
}

function buildMusketeer(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x283593, -0.12, 0.28, 0.14), makeLeg(0x283593, 0.12, 0.28, 0.14)];
  g.add(...legs);
  g.add(cyl(0.26, 0.38, 0.48, 0x3f51b5, 0, 0.52, 0)); // flared coat
  g.add(cyl(0.34, 0.36, 0.08, 0x283593, 0, 0.36, 0)); // sash
  g.add(sphere(0.07, 0xf2c14e, 0, 0.52, 0.31)); // button
  const head = sphere(0.29, SKIN, 0, 1.0, 0);
  addEyes(head, 0.29, 0.38, 0.1, "brave");
  g.add(head);
  // CR look: purple coiffed curls under a steel helmet with a
  // team-colored feather, plus a metal shoulder pad.
  for (const s of [-1, 1]) {
    g.add(sphere(0.12, 0x8347c2, s * 0.2, 1.06, -0.14)); // curls
    g.add(sphere(0.09, 0x8347c2, s * 0.26, 0.92, -0.06)); // side curls
  }
  const helm = sphere(0.31, 0x9aa3ad, 0, 1.18, 0);
  helm.scale.y = 0.72;
  g.add(helm);
  g.add(cyl(0.315, 0.325, 0.08, 0x78909c, 0, 1.1, 0)); // helmet rim
  const feather = cone(0.07, 0.34, 0x3b82f6, 0.2, 1.46, 0);
  feather.rotation.z = -0.6;
  g.add(feather); // team-colored feather
  g.add(sphere(0.14, 0x9aa3ad, 0.34, 0.74, 0)); // shoulder pad

  const offArm = new THREE.Group();
  offArm.position.set(-0.34, 0.72, 0);
  offArm.add(box(0.12, 0.28, 0.12, 0x3f51b5, 0, -0.14, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.34, 0.74, 0);
  arm.add(box(0.12, 0.26, 0.12, SKIN, 0, -0.13, 0));
  arm.add(box(0.09, 0.1, 0.5, 0x6d4c41, 0, -0.26, 0.18)); // stock
  const barrel = cyl(0.035, 0.045, 0.62, 0x9aa3ad);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.24, 0.66);
  arm.add(barrel);
  arm.add(cyl(0.055, 0.055, 0.06, 0x78909c, 0, -0.24, 0.95)); // muzzle
  g.add(arm);
  return { group: g, arm, armRest: -0.18, swingAmp: 0.4, height: 1.45, legs, offArm };
}

function buildMiniPekka(): TroopRig {
  const g = new THREE.Group();
  const legs = [makeLeg(0x10141c, -0.15, 0.3, 0.18), makeLeg(0x10141c, 0.15, 0.3, 0.18)];
  g.add(...legs);
  g.add(box(0.52, 0.42, 0.36, 0x202b3d, 0, 0.5, 0)); // body
  g.add(sphere(0.08, 0x4fd8ff, 0, 0.56, 0.19)); // chest light
  g.add(box(0.6, 0.5, 0.54, 0x26334a, 0, 1.02, 0)); // helmet head
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.04), glow(0x4fd8ff, 2.2));
  eye.position.set(0, 1.04, 0.28);
  g.add(eye);
  for (const s of [-1, 1]) {
    const horn = cone(0.08, 0.36, 0xb7c2cc, s * 0.34, 1.36, 0);
    horn.rotation.z = -s * 0.55;
    g.add(horn);
    g.add(sphere(0.07, 0xb7c2cc, s * 0.31, 0.62, 0)); // shoulder bolt
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.36, 0.66, 0);
  offArm.add(box(0.13, 0.3, 0.13, 0x202b3d, 0, -0.15, 0));
  g.add(offArm);

  const arm = new THREE.Group();
  arm.position.set(0.38, 0.7, 0);
  arm.add(box(0.13, 0.28, 0.13, 0x202b3d, 0, -0.14, 0));
  arm.add(box(0.06, 0.2, 0.06, 0x6d4c41, 0, -0.38, 0)); // handle
  arm.add(box(0.05, 0.62, 0.34, 0xb7c2cc, 0, -0.1, 0.1)); // cleaver
  g.add(arm);
  return { group: g, arm, armRest: -0.5, swingAmp: 1.9, height: 1.65, legs, offArm };
}

function buildSkeleton(): TroopRig {
  const g = new THREE.Group();
  const legs = [
    makeLeg(0xf5f2ea, -0.08, 0.2, 0.07),
    makeLeg(0xf5f2ea, 0.08, 0.2, 0.07),
  ];
  g.add(...legs);
  g.add(box(0.26, 0.26, 0.16, 0xf5f2ea, 0, 0.34, 0)); // ribcage
  g.add(box(0.28, 0.03, 0.18, 0xcfc8b8, 0, 0.34, 0)); // rib line
  g.add(box(0.28, 0.03, 0.18, 0xcfc8b8, 0, 0.42, 0)); // rib line
  const skull = sphere(0.24, 0xf5f2ea, 0, 0.7, 0);
  g.add(skull);
  skull.add(sphere(0.055, 0x1f2430, -0.09, 0.02, 0.2)); // socket
  skull.add(sphere(0.055, 0x1f2430, 0.09, 0.02, 0.2)); // socket
  skull.add(box(0.14, 0.06, 0.1, 0xdcd6c8, 0, -0.2, 0.1)); // jaw

  const offArm = new THREE.Group();
  offArm.position.set(-0.17, 0.46, 0);
  offArm.add(box(0.06, 0.2, 0.06, 0xf5f2ea, 0, -0.1, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.17, 0.48, 0);
  arm.add(box(0.06, 0.18, 0.06, 0xf5f2ea, 0, -0.09, 0));
  arm.add(box(0.035, 0.4, 0.07, 0xe8e3d8, 0, 0, 0)); // bone sword
  g.add(arm);
  return { group: g, arm, armRest: -0.55, swingAmp: 1.6, height: 0.95, legs, offArm };
}

function buildWizard(): TroopRig {
  // Premium classic wizard: flared star-trimmed robe, pointed hat,
  // glowing crystal staff, and the fire-orb casting hand.
  const ROBE = 0x2456c8, ROBEDK = 0x18337e, TRIM = 0xf2c14e, HAIR = 0xeef3fa;
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.52, 0.92, ROBE, 0, 0.47, 0)); // flared robe
  g.add(cyl(0.52, 0.54, 0.1, ROBEDK, 0, 0.05, 0)); // hem
  g.add(cyl(0.4, 0.42, 0.08, 0x5a3a1c, 0, 0.76, 0)); // belt
  g.add(box(0.1, 0.1, 0.05, TRIM, 0, 0.76, 0.42)); // buckle
  for (let i = 0; i < 3; i++) g.add(sphere(0.045, TRIM, 0, 0.62 - i * 0.17, 0.4)); // star buttons
  const head = sphere(0.32, SKIN, 0, 1.12, 0);
  addEyes(head, 0.32, 0.32, 0.08, "brave");
  g.add(head);
  // Pointed hat with brim band + glowing tip star.
  const hat = cone(0.44, 1.0, ROBEDK, 0, 1.66, -0.05);
  hat.rotation.x = -0.1;
  g.add(hat);
  g.add(cyl(0.46, 0.46, 0.1, ROBE, 0, 1.26, 0)); // brim band
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), glow(0xfff1a8, 1.8));
  tip.position.set(0.08, 2.12, -0.16);
  g.add(tip);
  // White hair tufts + short beard, kept clear of the lit face.
  for (const s of [-1, 1]) g.add(sphere(0.12, HAIR, s * 0.28, 1.02, 0.04));
  const beard = cone(0.2, 0.42, HAIR, 0, 0.84, 0.12);
  beard.rotation.x = Math.PI;
  g.add(beard);

  // Staff hand with a glowing crystal.
  const offArm = new THREE.Group();
  offArm.position.set(-0.4, 0.78, 0);
  offArm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  offArm.add(cyl(0.032, 0.038, 1.15, 0x6d4c41, 0, -0.12, 0.08)); // shaft
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), glow(0x59c8ff, 1.8));
  crystal.position.set(0, 0.5, 0.08);
  offArm.add(crystal);
  g.add(offArm);

  // Casting hand with fire orb (the attack).
  const arm = new THREE.Group();
  arm.position.set(0.4, 0.8, 0);
  arm.add(box(0.11, 0.26, 0.11, ROBE, 0, -0.13, 0));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glow(0xff7a00, 1.8));
  orb.position.set(0, -0.34, 0.1);
  arm.add(orb);
  g.add(arm);
  const flicker = (t: number, phase: number) => {
    const s = 1 + Math.sin(t * 11 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.05;
    orb.scale.setScalar(s);
    crystal.rotation.y = t * 1.5;
  };
  return { group: g, arm, armRest: -0.9, swingAmp: 1.1, height: 1.7, offArm, extras: flicker };
}

function buildWitch(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.46, 0.7, 0x4a148c, 0, 0.4, 0)); // dark robe
  g.add(cyl(0.37, 0.4, 0.08, 0x7b1fa2, 0, 0.5, 0)); // sash
  g.add(sphere(0.07, 0x76ff03, 0, 0.62, 0.3)); // glowing brooch
  const head = sphere(0.29, 0xcfd4f1, 0, 1.04, 0); // pale skin
  addEyes(head, 0.29, 0.38, 0.1, "wicked");
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
  // Striped envelope.
  const envelope = sphere(0.55, 0xc62828, 0, 1.5, 0);
  envelope.scale.set(1, 1.15, 1);
  g.add(envelope);
  for (const a of [-0.6, 0, 0.6]) {
    const stripe = cyl(0.46, 0.46, 0.14, 0xf2c14e, 0, 1.5 + a * 0.45, 0);
    stripe.scale.x = 1.2;
    g.add(stripe);
  }
  g.add(cone(0.16, 0.22, 0x8e1f1f, 0, 0.78, 0)); // throat
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
  const body = sphere(0.46, 0x4caf50, 0, 0.5, 0);
  body.scale.set(0.95, 0.9, 1.1);
  g.add(body);
  const belly = sphere(0.36, 0xa5d6a7, 0, 0.42, 0.18);
  belly.scale.set(0.8, 0.75, 0.6);
  g.add(belly);
  const head = sphere(0.36, 0x59b75d, 0, 1.04, 0.22);
  g.add(head);
  const snout = sphere(0.2, 0x66bb6a, 0, 0.96, 0.52);
  snout.scale.set(1, 0.7, 0.9);
  g.add(snout);
  g.add(sphere(0.035, 0x1f2430, -0.07, 1.0, 0.68)); // nostril
  g.add(sphere(0.035, 0x1f2430, 0.07, 1.0, 0.68)); // nostril
  // Big cute eyes.
  for (const s of [-1, 1]) {
    g.add(sphere(0.09, 0xffffff, s * 0.16, 1.16, 0.46));
    g.add(sphere(0.045, 0x1f2430, s * 0.16, 1.16, 0.53));
  }
  g.add(cone(0.07, 0.2, 0xa5d6a7, -0.15, 1.36, 0.1)); // horn
  g.add(cone(0.07, 0.2, 0xa5d6a7, 0.15, 1.36, 0.1)); // horn
  const tail = cone(0.12, 0.6, 0x4caf50, 0, 0.42, -0.66);
  tail.rotation.x = Math.PI / 2.3;
  g.add(tail);
  const wagTail = (t: number, phase: number) => {
    tail.rotation.z = Math.sin(t * 5 + phase) * 0.35;
  };
  g.add(sphere(0.12, 0x59b75d, -0.2, 0.12, 0.1)); // foot
  g.add(sphere(0.12, 0x59b75d, 0.2, 0.12, 0.1)); // foot

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.36, 0.84, -0.1);
    const membrane = box(0.62, 0.05, 0.4, 0x81c784, s * 0.34, 0, 0);
    wing.add(membrane);
    wing.add(box(0.6, 0.04, 0.06, 0x66bb6a, s * 0.33, 0.03, 0.2)); // leading edge
    wing.rotation.z = s * 0.3;
    g.add(wing);
    wings.push({ obj: wing, base: s * 0.3, amp: s * 0.6 });
  }
  return {
    group: g,
    arm: null,
    armRest: 0,
    swingAmp: 0,
    height: 1.5,
    hover: 1.0,
    wings,
    extras: wagTail,
  };
}

function buildGargoyle(): TroopRig {
  const g = new THREE.Group();
  const body = sphere(0.22, 0x5d6f96, 0, 0.36, 0);
  body.scale.set(1, 1.2, 0.9);
  g.add(body);
  const head = sphere(0.2, 0x6c7fa8, 0, 0.72, 0.04);
  g.add(head);
  // Glowing eyes + fangs.
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(0xffd54f, 2));
    eye.position.set(s * 0.08, 0.76, 0.2);
    g.add(eye);
    const ear = cone(0.06, 0.18, 0x44537a, s * 0.14, 0.92, -0.02);
    ear.rotation.z = -s * 0.4;
    g.add(ear);
    g.add(box(0.025, 0.06, 0.02, 0xffffff, s * 0.04, 0.6, 0.18)); // fang
  }
  const legs = [
    makeLeg(0x44537a, -0.08, 0.16, 0.06),
    makeLeg(0x44537a, 0.08, 0.16, 0.06),
  ];
  g.add(...legs);

  const offArm = new THREE.Group();
  offArm.position.set(-0.2, 0.46, 0);
  offArm.add(box(0.07, 0.2, 0.07, 0x5d6f96, 0, -0.1, 0));
  g.add(offArm);
  const arm = new THREE.Group();
  arm.position.set(0.2, 0.46, 0);
  arm.add(box(0.07, 0.2, 0.07, 0x5d6f96, 0, -0.1, 0));
  arm.add(cone(0.04, 0.1, 0xb7c2cc, 0, -0.22, 0.03)); // claw
  g.add(arm);

  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.18, 0.62, -0.12);
    wing.add(box(0.46, 0.035, 0.3, 0x44537a, s * 0.25, 0, 0));
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
  const hair = sphere(0.31, 0xe07b39, 0, 1.12, -0.03);
  hair.scale.set(1, 0.66, 1);
  g.add(hair);
  for (const s of [-1, 1]) {
    const braid = cyl(0.07, 0.05, 0.5, 0xe07b39, s * 0.27, 0.84, -0.1);
    braid.rotation.z = s * 0.25;
    g.add(braid);
  }

  const offArm = new THREE.Group();
  offArm.position.set(-0.38, 0.74, 0);
  offArm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  g.add(offArm);

  // Huge double axe.
  const arm = new THREE.Group();
  arm.position.set(0.38, 0.78, 0);
  arm.add(box(0.13, 0.28, 0.13, SKIN, 0, -0.14, 0));
  arm.add(cyl(0.035, 0.035, 0.85, 0x6d4c41, 0, -0.1, 0.16)); // haft
  for (const s of [-1, 1]) {
    const blade = cyl(0.22, 0.22, 0.06, 0xb7c2cc, s * 0.18, 0.28, 0.16);
    blade.rotation.z = Math.PI / 2;
    blade.scale.y = 0.4;
    arm.add(blade);
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
  const head = sphere(0.26, SKIN, 0, 1.66, -0.1);
  addEyes(head, 0.26, 0.38, 0.1, "brave");
  // CR prince: brown goatee under the visored golden helm.
  const goatee = sphere(0.09, 0x5b3a21, 0, -0.18, 0.2);
  goatee.scale.set(0.9, 0.8, 0.6);
  head.add(goatee);
  g.add(head);
  // Golden helm with a raised visor and a team-colored feather.
  g.add(cyl(0.28, 0.3, 0.2, 0xf2c14e, 0, 1.84, -0.1)); // helmet band
  const helmDome = sphere(0.29, 0xf2c14e, 0, 1.92, -0.1);
  helmDome.scale.y = 0.72;
  g.add(helmDome);
  g.add(box(0.4, 0.07, 0.06, 0xd9a93f, 0, 1.96, 0.12)); // raised visor
  for (const s of [-1, 1]) {
    g.add(box(0.06, 0.18, 0.16, 0xf2c14e, s * 0.26, 1.7, -0.04)); // cheek guard
  }
  const plume = cone(0.08, 0.4, 0x3b82f6, 0, 2.22, -0.16);
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

  // Bare-chested rider with mohawk.
  const RIDER = 0x9c6644; // darker skin
  g.add(cyl(0.2, 0.24, 0.36, RIDER, 0, 1.06, -0.12)); // torso
  g.add(cyl(0.26, 0.26, 0.08, 0x4e342e, 0, 0.9, -0.12)); // belt
  const head = sphere(0.26, RIDER, 0, 1.5, -0.12);
  addEyes(head, 0.26, 0.38, 0.1, "angry");
  g.add(head);
  const mohawk = box(0.08, 0.26, 0.4, 0x2d1b0e, 0, 1.76, -0.12);
  g.add(mohawk);
  // The iconic big dark beard.
  const beard = sphere(0.2, 0x2d1b0e, 0, 1.36, 0.02);
  beard.scale.set(1.05, 0.8, 0.75);
  g.add(beard);
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
  g.add(cyl(0.2, 0.34, 0.5, 0xe91e63, 0, 0.3, 0)); // gown
  g.add(cyl(0.28, 0.28, 0.06, 0xf2c14e, 0, 0.16, 0)); // gold hem
  const head = sphere(0.24, SKIN, 0, 0.78, 0);
  addEyes(head, 0.24, 0.38, 0.1, "cute");
  g.add(head);
  const hair = sphere(0.25, 0xf6a13b, 0, 0.86, -0.03);
  hair.scale.set(1, 0.66, 1);
  g.add(hair);
  const braid = cyl(0.06, 0.04, 0.45, 0xf6a13b, 0.2, 0.6, -0.12);
  braid.rotation.z = 0.3;
  g.add(braid);
  g.add(cyl(0.1, 0.12, 0.1, 0xf2c14e, 0, 1.02, 0)); // tiara
  g.add(sphere(0.04, 0x4fd8ff, 0, 1.08, 0.08)); // tiara gem

  const offArm = new THREE.Group();
  offArm.position.set(0.24, 0.5, 0);
  offArm.add(box(0.09, 0.22, 0.09, SKIN, 0, -0.11, 0));
  g.add(offArm);

  // Bow arm (same thrust-on-release rig as the field archer).
  const arm = new THREE.Group();
  arm.position.set(-0.24, 0.54, 0.05);
  arm.add(box(0.09, 0.22, 0.09, SKIN, 0, -0.11, 0));
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.03, 8, 16, Math.PI),
    toon(0x8d6e63),
  );
  bow.castShadow = true;
  bow.position.set(0, -0.2, 0.14);
  bow.rotation.set(0, -Math.PI / 2, 0);
  arm.add(bow);
  arm.add(box(0.012, 0.54, 0.012, 0xe8e3d8, 0, -0.2, 0.14)); // string
  g.add(arm);
  return { group: g, arm, armRest: -1.0, swingAmp: 0.7, height: 1.1, offArm };
}

/** The king himself, enthroned on the king tower. */
export function buildTowerKing(): TroopRig {
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.44, 0.62, 0x4365c8, 0, 0.36, 0)); // royal robe
  g.add(cyl(0.4, 0.42, 0.08, 0xf2c14e, 0, 0.14, 0)); // gold trim
  const sash = box(0.16, 0.5, 0.05, 0xb71c1c, 0.1, 0.42, 0.32);
  sash.rotation.z = -0.3;
  g.add(sash);
  const head = sphere(0.3, SKIN, 0, 0.98, 0);
  addEyes(head, 0.3, 0.38, 0.1, "calm");
  g.add(head);
  const beard = sphere(0.26, 0xe8e3d8, 0, 0.82, 0.13);
  beard.scale.set(1, 0.75, 0.7);
  g.add(beard);
  // Big golden crown.
  g.add(cyl(0.26, 0.3, 0.18, 0xf2c14e, 0, 1.28, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(cone(0.05, 0.14, 0xf2c14e, Math.cos(a) * 0.24, 1.42, Math.sin(a) * 0.24));
  }
  g.add(sphere(0.05, 0xe53935, 0, 1.32, 0.27)); // crown jewel

  const offArm = new THREE.Group();
  offArm.position.set(-0.4, 0.62, 0);
  offArm.add(box(0.12, 0.26, 0.12, 0x4365c8, 0, -0.13, 0));
  g.add(offArm);

  // Sword arm raised in command.
  const arm = new THREE.Group();
  arm.position.set(0.4, 0.66, 0);
  arm.add(box(0.12, 0.26, 0.12, 0x4365c8, 0, -0.13, 0));
  arm.add(box(0.2, 0.05, 0.08, 0x8d6e63, 0, -0.28, 0)); // guard
  arm.add(box(0.05, 0.5, 0.1, 0xdde4ec, 0, -0.02, 0)); // blade
  g.add(arm);
  return { group: g, arm, armRest: -0.4, swingAmp: 1.2, height: 1.55, offArm };
}

const BUILDERS: Partial<Record<CardId, () => TroopRig>> = {
  knight: buildKnight,
  archers: buildArcher,
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
};

/**
 * Add inverted-hull silhouette outlines to a rig's larger meshes.
 * One black material per rig so death-fade can't bleed across units.
 */
/** Bold CR-style cel outline: near-black and thick. */
const OUTLINE_COLOR = 0x0b0e16;
const OUTLINE_SCALE = 1.09;

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
  const builder = BUILDERS[cardId];
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
