/**
 * The placement map: ONE plane over the field (2 triangles, 1 draw) whose
 * shader reads the deploy map painted by ../deployZone.ts into a small R8
 * signed-distance texture. It answers "where can I put this card?" in
 * shapes, not only colours (some kids are colour-blind):
 *
 *   - YES: a bold light line just inside every allowed edge (an ink rim just
 *     outside it), a soft glow hugging it; the opened enemy pocket is lit as
 *     new ground, the brightest thing on the board.
 *   - NO: darker ground with 45-degree ink stripes (the river calmer, no
 *     stripes). The King's keep-clear is a striped bite with an outlined arc.
 *
 * When a lane opens with no card in hand, the pocket alone lights up, grown
 * from the ruin (the "reveal"), so the kid sees "you can go here now" at the
 * moment it becomes true. When it opens with a card held, that lane
 * cross-fades from its closed look to its open look.
 *
 * The rules live in deployZone.ts (pinned to checkDeploy by
 * deployZone.grid.test.ts); this file is cosmetics and clocks. It reads no
 * DOM and no prefs: reduced motion ("still") and the day phase come in.
 * Battle3D adds `mesh` to its scene (not the arena group, so arena look
 * rebuilds never dispose it) and frees it with dispose().
 */
import * as THREE from "three";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_HALF_WIDTH,
  BRIDGE_XS,
  RIVER_HALF_WIDTH,
  RIVER_Y,
  type OpenLanes,
  type Side,
} from "../../game/arena";
import { openLanes, type BattleState } from "../../game/battle";
import type { ArenaLook } from "../arenaLooks";
import {
  FIELD_H,
  FIELD_W,
  KING_KEEP_CLEAR,
  digKey,
  enemyKingSpot,
  laneAnchor,
  laneLabelBand,
  paintZoneField,
  ruinSpot,
  sampleField,
  troopKey,
  troopShapeFor,
  zoneShape,
  type Lane,
  type ZoneMode,
} from "../deployZone";
import { teamColor } from "../teamColors";
import { CAM_HOME } from "./common";

// ---- Timings (seconds, presentation clock) ----------------------------------
/** Nothing new for this long after a fall: the collapse and the crown read first. */
export const REVEAL_DELAY = 0.6;
/** The lit pocket grows from the ruin over this long (smoothstep). */
export const REVEAL_GROW = 1.0;
/**
 * The wave's final radius (tiles). The farthest pocket point from its ruin is
 * the pocket's river corner at the middle seam, 10.12 tiles away (the
 * spec's first 15 left the pocket at 62% of the grow, so the sweep stopped
 * dead after 0.6 s); 10.5 just clears it, so the front sweeps the whole second.
 */
export const REVEAL_RADIUS = 10.5;
/** The pocket stays lit until this age, then fades out. */
export const REVEAL_END = 4.0;
export const REVEAL_FADE = 0.6;
export const REVEAL_LIFE = REVEAL_END + REVEAL_FADE; // 4.6
/** Reduced motion: the whole pocket fades in over this long instead of growing. */
export const STILL_FADE_IN = 0.3;
/** A lane opening under a held card cross-fades closed -> open over this long. */
export const HELD_OPEN_FADE = 0.25;
/** The map fades in and out over this long as a card is picked up or put down. */
export const HOLD_FADE = 0.12;
/** The "Drop troops here now!" label's window and its fade-out. */
export const CALLOUT_FROM = 1.0;
export const CALLOUT_TO = 4.0;
export const CALLOUT_FADE = 0.25;
export const CALLBACK_EASE = 0.12;
export const REFUSE_OUTLINE = 0.8;
export const REFUSE_FLASH = 0.6;
export const WELCOME = 0.7;
export const DIG_REPAINT_MIN = 0.25;
/** A radius this big means "no wave": the whole pocket. */
export const REVEAL_DONE = 99;

// ---- Look ---------------------------------------------------------------------
/** Plane height: clears the river's bank lips (top 0.13). */
export const LIFT = 0.15;
/** Slide along the camera ray so the lifted lines sit over the ground the finger picks. */
export const VIEW_SHIFT = (LIFT * CAM_HOME.z) / CAM_HOME.y; // 0.13
export const INK = 0x1f1a2e;
const LINE_GAIN = 0.88; // linear: under the 0.92 bloom threshold
const LINE_CLASSIC = 0xffffff;
const LINE_GOLDEN = 0xfff3d6;
const LIT_GOLDEN = 0x2bb7b0;
/** How far the lit colour is mixed toward white (Golden Age: lighter than the sand it sits on, so it reads as lit). */
export const LIT_WHITE_CLASSIC = 0.45;
export const LIT_WHITE_GOLDEN = 0.4;
/** The open pocket's fill alpha by day (Golden Age: its mint barely shows on sand at the Classic 0.20). */
export const FILL_CLASSIC = 0.2;
export const FILL_GOLDEN = 0.3;
const WELCOME_GAIN = 0.16;
/** The Digger's collars hide mostly under the tower bodies: its outline and rim are this much bolder. */
export const DIG_THICK = 1.6;
/** How much the pocket's fill, glows and lit colour calm down by night (dayPhase 1). */
export const NIGHT_FILL_CUT = 0.6;
/** Golden Age's brighter day fill calms down further, to about the Classic night fill (0.075 vs 0.08): never milky. */
export const NIGHT_FILL_CUT_GOLDEN = 0.75;
export const NIGHT_GLOW_CUT = 0.45;
export const NIGHT_LIT_CUT = 0.2;
const FLASH_ALPHA = 0.22;
/**
 * Floors darker than this (sRGB luma) get light stripes: ink would vanish.
 * The spec's 0.30 missed the forge (#5c5660, 0.345), whose grade and lights
 * render its floor far darker than its swatch: by night its ink stripes were
 * all but gone in the look sheet. The next darkest floor is 0.45 (mystic).
 */
export const DARK_FLOOR_LUMA = 0.36;
/**
 * Mid-dark floors (swamp, jungle, mystic; Golden Age souk, copper, medina)
 * keep their ink stripes, but by night ink on a darkened floor all but
 * vanishes: each stripe gets a light hairline on one edge that fades in with
 * the night (alpha NIGHT_EDGE_ALPHA x dayPhase).
 */
export const NIGHT_EDGE_LUMA = 0.53;
export const NIGHT_EDGE_ALPHA = 0.2;

/** The colour a look's field floor is painted: Golden Age courts are plaster (their `floor` is the shared base's). */
export function floorSwatch(look: Pick<ArenaLook, "floor" | "islamic">): string {
  return look.islamic?.plaster ?? look.floor.a;
}

export type RefuseReason = "side" | "lane" | "river" | "king" | "tower" | "dig";
const FLASH_KIND: Record<RefuseReason, number> = { side: 1, lane: 2, king: 3, river: 4, tower: 5, dig: 5 };

/** A number as a GLSL float literal (always with a decimal point). */
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

// The arena's geometry, from the sim's exported constants: the shader's
// cosmetics (calmer water, which half is lit, the lane split, the flash
// regions) follow them if they ever change. The allowed shape itself comes
// only from the texture (pinned by deployZone.grid.test.ts).
const G = {
  W: glslFloat(ARENA_WIDTH),
  H: glslFloat(ARENA_HEIGHT),
  MID: glslFloat(ARENA_WIDTH / 2),
  HALF_H: glslFloat(ARENA_HEIGHT / 2),
  RIVER: glslFloat(RIVER_Y),
  RIVER_HALF: glslFloat(RIVER_HALF_WIDTH),
  BRIDGE: BRIDGE_XS.map((bx) => `abs(vTile.x - ${glslFloat(bx)}) <= ${glslFloat(BRIDGE_HALF_WIDTH)}`).join(" || "),
  /** The King flash: the keep-clear and a hair more, so its arc flashes too. */
  KING_FLASH: glslFloat(KING_KEEP_CLEAR + 0.2),
};

const VERT = /* glsl */ `
  varying vec2 vTile;
  void main() {
    // LOCAL position: the mesh's z shift (VIEW_SHIFT) carries the content
    // along the camera ray, so lines land over the ground they describe.
    vTile = vec2(position.x + ${G.MID}, position.z + ${G.HALF_H});
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uField;
  uniform float uHold;      // 0..1: the held map's fade
  uniform vec2 uEnv;        // pocket-only envelope per lane (left, right)
  uniform vec2 uOpen;       // lanes open for the viewer (left, right)
  uniform vec2 uLaneMix;    // 0 = that lane still looks closed, 1 = open
  uniform vec3 uWaveL;      // reveal wave: ruin x, ruin y, radius
  uniform vec3 uWaveR;
  uniform float uSideSign;  // +1 host (enemy half y < 16), -1 guest
  uniform vec2 uKing;
  uniform float uDig;
  uniform vec3 uLine;
  uniform vec3 uInk;
  uniform vec3 uLit;
  uniform float uLitGain;
  uniform vec3 uStripe;
  uniform float uStripeA;
  uniform float uEdgeA;     // light hairline on each ink stripe (mid-dark floors by night)
  uniform float uNoBase;
  uniform float uFill;
  uniform float uGlowP;
  uniform float uGlowOwn;
  uniform vec2 uWelcome;
  uniform float uThick;
  uniform float uDpr;
  uniform float uFlash;
  uniform float uFlashKind;
  uniform vec2 uFlashAt;
  varying vec2 vTile;

  vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    vec3 c = a > 0.0 ? (top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a : vec3(0.0);
    return vec4(c, a);
  }

  void main() {
    float field = (texture2D(uField, vTile / vec2(${G.W}, ${G.H})).r - 0.5) * 4.0;
    float theirs = uSideSign * (${G.RIVER} - vTile.y);     // > 0 on the viewer's enemy half
    bool isL = vTile.x < ${G.MID};
    bool bridge = ${G.BRIDGE};
    float water = (abs(vTile.y - ${G.RIVER}) < ${G.RIVER_HALF} && !(uDig > 0.5 && bridge)) ? 1.0 : 0.0;

    // A lane revealing with no card held: its pocket is a disc growing from the
    // ruin. Both lanes' wave distances and every derivative are taken without
    // branching on the lane: picking the wave first made d jump across x = 9
    // (and the river) inside one pixel quad, so fwidth(d) blew up and smeared
    // a hairline down the whole seam before the wave got there.
    float wdL = uWaveL.z - length(vTile - uWaveL.xy);
    float wdR = uWaveR.z - length(vTile - uWaveR.xy);
    float aaField = fwidth(field);
    float aaWL = fwidth(wdL);
    float aaWR = fwidth(wdR);
    float wd = isL ? wdL : wdR;
    bool cut = theirs > 0.0 && wd < field;
    float d = cut ? wd : field;
    float aa = max(cut ? (isL ? aaWL : aaWR) : aaField, 1e-4);
    float px = length(fwidth(vTile)) * 0.70710678 * uDpr;   // tiles per CSS px
    float W = max(0.16, 3.0 * px) * uThick;                   // outline core, inside the edge
    float E = max(0.06, 1.5 * px) * (1.0 + (${glslFloat(DIG_THICK)} - 1.0) * uDig); // ink rim, outside
    float inside = smoothstep(-aa, aa, d);
    float core = inside * (1.0 - smoothstep(W - aa, W + aa, d));
    float rim = (1.0 - inside) * smoothstep(-E - aa, -E + aa, d);
    float hug = inside * (1.0 - smoothstep(W, W + 0.8, d));

    // NO: ink base + 45-degree stripes in arena space (the river calmer, no stripes).
    float period = max(0.75, 12.0 * px);
    float s = (vTile.x + vTile.y) * 0.70710678 / period;
    float sw = fwidth(s);
    float stripe = smoothstep(0.325 - sw, 0.325 + sw, abs(fract(s) - 0.5)) * (1.0 - water);
    vec4 no = over(vec4(uStripe, uStripeA * stripe), vec4(uInk, uNoBase * mix(1.0, 0.5, water)));
    if (uEdgeA > 0.0) {
      // A light hairline just past each ink band's trailing edge (fract 0.175).
      float g = fract(s) - 0.175;
      float lw = max(0.06, 2.0 * px) / period;
      float edge = smoothstep(-sw, sw, g) * (1.0 - smoothstep(lw - sw, lw + sw, g)) * (1.0 - water);
      no = over(vec4(1.0, 1.0, 1.0, uEdgeA * edge), no);
    }

    // YES: the opened pocket lit as new ground; your own half only a glow along its line.
    float pocket = inside * step(0.0, theirs) * (1.0 - uDig);
    float welcome = isL ? uWelcome.x : uWelcome.y;
    float yesA = pocket * (uFill + welcome + uGlowP * hug) + (1.0 - pocket) * uGlowOwn * hug * (1.0 - uDig);
    vec4 yes = vec4(uLit * uLitGain, clamp(yesA, 0.0, 1.0));

    vec4 col = mix(no, yes, inside);
    col = over(vec4(uInk, 0.85 * rim), col);
    col = over(vec4(uLine, 0.96 * core), col);

    // A lane that opened under a held troop: still its closed look, fading
    // out. Never on the Digger's map: nothing changed there for it.
    float laneMix = isL ? uLaneMix.x : uLaneMix.y;
    if (uDig < 0.5 && theirs > -0.12 && laneMix < 1.0) col = mix(no, col, laneMix);

    // A refused drop: the region the words mean flashes white over its NOT-allowed ground.
    if (uFlash > 0.0) {
      float region = 0.0;
      if (uFlashKind < 1.5) region = step(-1.0, theirs);
      else if (uFlashKind < 2.5) region = step(0.0, theirs) * (isL == (uFlashAt.x < ${G.MID}) ? 1.0 : 0.0);
      else if (uFlashKind < 3.5) region = step(length(vTile - uKing), ${G.KING_FLASH}) * step(0.0, theirs) * (isL ? uOpen.x : uOpen.y);
      else if (uFlashKind < 4.5) region = step(abs(vTile.y - ${G.RIVER}), ${G.RIVER_HALF});
      else region = step(length(vTile - uFlashAt), 2.5);
      col = over(vec4(1.0, 1.0, 1.0, uFlash * region * (1.0 - inside)), col);
    }

    // Pocket-only (no card held): each open lane's enemy half, the revealing
    // one cut to its wave; water only where the line's rim crosses it.
    float mL = uOpen.x * step(vTile.x, ${G.MID} + 0.1 * (1.0 - uOpen.y)) * uEnv.x * step(-(E + max(aaWL, 1e-4)), wdL);
    float mR = uOpen.y * step(${G.MID} - 0.1 * (1.0 - uOpen.x), vTile.x) * uEnv.y * step(-(E + max(aaWR, 1e-4)), wdR);
    float pm = step(-0.12, theirs) * max(mL, mR) * mix(1.0, rim, water);
    float a = col.a * max(uHold, pm);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col.rgb, a);
  }
`;

/** A lane that opened: its reveal and label clock. */
export interface RevealRecord {
  id: number;
  lane: Lane;
  /** Seconds since the lane opened (presentation clock). */
  age: number;
  /** Grow from the ruin (no card was held); false once a card is picked up. */
  wave: boolean;
  /** The label was dismissed (a successful deploy). */
  dismissed: boolean;
}

export interface LaneCallout {
  id: number;
  lane: Lane;
  /** Arena point the label centres on. */
  ax: number;
  ay: number;
  /**
   * The pocket band (arena y) the label may step along to keep off the held
   * card's preview: `far` just below the King's keep-clear, `near` just
   * above the river (laneLabelBand).
   */
  far: number;
  near: number;
  age: number;
}

export interface ZoneParts {
  shown: boolean;
  mode: ZoneMode | null;
  pocketOnly: boolean;
  open: OpenLanes;
  reveals: { lane: Lane; age: number; wave: boolean }[];
  callout: boolean;
  key: number | string;
}

const smooth = (x: number): number => x * x * (3 - 2 * x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The wave's radius (tiles) at `age`; REVEAL_DONE once the whole pocket shows. */
export function revealRadius(age: number, still: boolean): number {
  if (age < REVEAL_DELAY) return 0;
  if (still) return REVEAL_DONE;
  const g = (age - REVEAL_DELAY) / REVEAL_GROW;
  return g >= 1 ? REVEAL_DONE : REVEAL_RADIUS * smooth(clamp01(g));
}

/** How visible a reveal's pocket is at `age` (0..1). */
export function revealEnvelope(age: number, wave: boolean, still: boolean): number {
  if (age >= REVEAL_LIFE) return 0;
  if (age >= REVEAL_END) return 1 - (age - REVEAL_END) / REVEAL_FADE;
  if (!wave) return 1;
  if (age < REVEAL_DELAY) return 0;
  return still ? clamp01((age - REVEAL_DELAY) / STILL_FADE_IN) : 1;
}

/** The welcome pulse's extra fill at `age` (a sine bump over WELCOME seconds). */
function welcomeBump(age: number): number {
  return age < WELCOME ? WELCOME_GAIN * Math.sin((Math.PI * age) / WELCOME) : 0;
}

/** A held lane's closed -> open cross-fade at `age`. */
export function laneMixAt(age: number): number {
  return clamp01(age / HELD_OPEN_FADE);
}

/** sRGB luma (0..1) of a "#rrggbb" colour. */
export function srgbLuma(hex: string): number {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const LANES: readonly Lane[] = ["left", "right"];
const WHITE = new THREE.Color(0xffffff);

export interface DeployOverlayOptions {
  /** Golden Age: ivory line and a turquoise lit pocket. */
  golden: boolean;
  /** The viewer's team colour now (re-read on every pick-up and reveal). */
  teamTint?: () => number;
}

export class DeployOverlay {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.DataTexture;
  private readonly golden: boolean;
  private readonly teamTint: () => number;
  /** The four troop maps (lanes none / L / R / both) for `cacheSide`, painted once. */
  private readonly troopCache = new Map<number, Uint8Array>();
  private cacheSide: Side | null = null;
  private readonly digData = new Uint8Array(FIELD_W * FIELD_H);
  private data: Uint8Array;
  private key: number | string = -1;
  private digAge = Infinity;

  /** The held card's map, or null. */
  held: ZoneMode | null = null;
  /** The last held mode: shown while the map fades out. */
  private lastMode: ZoneMode = "troop";
  private fade = 0;
  private side: Side = "player";
  private lastState: BattleState | null = null;
  private lastOpen: OpenLanes | null = null;
  private open: OpenLanes = { left: false, right: false };
  private ended = false;
  private records: RevealRecord[] = [];
  private readonly env: Record<Lane, number> = { left: 0, right: 0 };
  private nextId = 1;
  private readonly laneMixAge: Record<Lane, number> = { left: Infinity, right: Infinity };
  private readonly welcomed: Record<Lane, boolean> = { left: false, right: false };
  private readonly welcomeAge: Record<Lane, number> = { left: Infinity, right: Infinity };
  private callBackOn = false;
  private callBackEase = 0;
  private refuseAge = Infinity;
  private flashAge = Infinity;
  private still = false;
  /** Draw once, invisibly, on the first render of a battle: compiles the program and uploads the texture. */
  private warm = false;
  /** The open pocket's fill by day, and how much of it the night takes away (per edition). */
  private readonly fillBase: number;
  private readonly fillNightCut: number;
  /** The look's floor is mid-dark: its ink stripes get a light hairline by night. */
  private nightEdge = false;
  /** The two enemy ruins for the viewer (the reveal grows from them), kept per view: no per-frame lookups. */
  private readonly ruins: Record<Lane, { x: number; y: number }> = {
    left: ruinSpot("player", "left"),
    right: ruinSpot("player", "right"),
  };
  /** Where the "lane opened" label may sit (arena y, see laneLabelBand), kept per view. */
  private band = laneLabelBand("player");

  constructor(opts: DeployOverlayOptions) {
    this.golden = opts.golden;
    this.fillBase = this.golden ? FILL_GOLDEN : FILL_CLASSIC;
    this.fillNightCut = this.golden ? NIGHT_FILL_CUT_GOLDEN : NIGHT_FILL_CUT;
    this.teamTint = opts.teamTint ?? (() => teamColor("player", "main"));
    this.data = new Uint8Array(FIELD_W * FIELD_H);
    this.tex = new THREE.DataTexture(this.data, FIELD_W, FIELD_H, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.flipY = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.needsUpdate = true;
    const line = new THREE.Color(this.golden ? LINE_GOLDEN : LINE_CLASSIC).multiplyScalar(LINE_GAIN);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uField: { value: this.tex },
        uHold: { value: 0 },
        uEnv: { value: new THREE.Vector2(0, 0) },
        uOpen: { value: new THREE.Vector2(0, 0) },
        uLaneMix: { value: new THREE.Vector2(1, 1) },
        uWaveL: { value: new THREE.Vector3(0, 0, REVEAL_DONE) },
        uWaveR: { value: new THREE.Vector3(0, 0, REVEAL_DONE) },
        uSideSign: { value: 1 },
        uKing: { value: new THREE.Vector2(9, 2.5) },
        uDig: { value: 0 },
        uLine: { value: line },
        uInk: { value: new THREE.Color(INK) },
        uLit: { value: new THREE.Color() },
        uLitGain: { value: 1 },
        uStripe: { value: new THREE.Color(INK) },
        uStripeA: { value: 0.67 },
        uEdgeA: { value: 0 },
        uNoBase: { value: 0.58 },
        uFill: { value: this.fillBase },
        uGlowP: { value: 0.22 },
        uGlowOwn: { value: 0.16 },
        uWelcome: { value: new THREE.Vector2(0, 0) },
        uThick: { value: 1 },
        uDpr: { value: 1 },
        uFlash: { value: 0 },
        uFlashKind: { value: 0 },
        uFlashAt: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.refreshLit();
    this.geo = new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT);
    this.geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = "deploy-overlay";
    this.mesh.position.set(0, LIFT, VIEW_SHIFT);
    // After decals (-2), light pools and contact shadows (-1); before team
    // discs, the hover disc and ring, the ghost and every FX (>= 0).
    this.mesh.renderOrder = -0.5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** The viewer's side: the plane's ray shift, its enemy half and the King it bites around. */
  setView(side: Side): void {
    this.side = side;
    this.mesh.position.z = (side === "player" ? 1 : -1) * VIEW_SHIFT;
    const u = this.mat.uniforms;
    u.uSideSign.value = side === "player" ? 1 : -1;
    const k = enemyKingSpot(side);
    (u.uKing.value as THREE.Vector2).set(k.x, k.y);
    for (const lane of LANES) {
      const r = ruinSpot(side, lane);
      this.ruins[lane].x = r.x;
      this.ruins[lane].y = r.y;
    }
    this.band = laneLabelBand(side);
    if (this.cacheSide !== side) this.key = -1; // repaint for this side
  }

  /**
   * The arena look: on a dark floor, ink stripes would vanish, so they turn
   * light; on a mid-dark one they keep their ink and gain a light hairline
   * as night falls.
   */
  setLook(look: Pick<ArenaLook, "floor" | "islamic">): void {
    const luma = srgbLuma(floorSwatch(look));
    const dark = luma < DARK_FLOOR_LUMA;
    (this.mat.uniforms.uStripe.value as THREE.Color).set(dark ? 0xffffff : INK);
    this.mat.uniforms.uStripeA.value = dark ? 0.18 : 0.67;
    this.nightEdge = !dark && luma < NIGHT_EDGE_LUMA;
  }

  /** Whether the light-stripe fallback is on (tests). */
  get lightStripes(): boolean {
    return this.mat.uniforms.uStripeA.value < 0.5;
  }

  /** Whether the ink stripes gain a light hairline by night (tests). */
  get nightEdges(): boolean {
    return this.nightEdge;
  }

  /** Pick up (a mode) or put down (null) a card. */
  hold(mode: ZoneMode | null): void {
    const prev = this.held;
    this.held = mode;
    if (mode === null) return;
    this.lastMode = mode;
    this.refreshLit();
    // A reveal in flight: the full map takes over (its label keeps its window).
    for (const r of this.records) r.wave = false;
    if (mode !== "troop" || prev === "troop") return;
    // The first troop pick-up after a lane opened says hello to that lane once.
    for (const lane of LANES) {
      if (!this.open[lane] || this.welcomed[lane]) continue;
      this.welcomed[lane] = true;
      const active = this.records.some((r) => r.lane === lane);
      if (!active && !this.still) this.welcomeAge[lane] = 0;
    }
  }

  private refreshLit(): void {
    const lit = this.mat.uniforms.uLit.value as THREE.Color;
    if (this.golden) lit.set(LIT_GOLDEN).lerp(WHITE, LIT_WHITE_GOLDEN);
    else lit.set(this.teamTint()).lerp(WHITE, LIT_WHITE_CLASSIC);
  }

  /** Per sync: notice lanes opening, keep the map's texture in step, run the clocks. */
  sync(state: BattleState, side: Side, dt: number, still: boolean): void {
    this.still = still;
    if (side !== this.side) this.setView(side);
    // Clocks first: a lane that opens this frame starts its reveal at age 0.
    this.advance(dt);
    const open = openLanes(state, side);
    if (state !== this.lastState || this.lastOpen === null) {
      // A new battle, a replay start, a restored context or a rejoin: seed quietly.
      this.lastState = state;
      this.records = [];
      this.ended = false;
      this.laneMixAge.left = this.laneMixAge.right = Infinity;
      this.welcomeAge.left = this.welcomeAge.right = Infinity;
      this.welcomed.left = open.left;
      this.welcomed.right = open.right;
      this.refuseAge = this.flashAge = Infinity;
      this.digAge = Infinity; // a held Digger's map is repainted for the new battle at once
      this.warm = true;
    } else if (!state.result) {
      for (const lane of LANES) if (open[lane] && !this.lastOpen[lane]) this.startReveal(lane);
    }
    this.lastOpen = open;
    this.open = open;
    if (state.result) {
      this.ended = true;
      this.records = [];
    }
    this.repaint(state, side, open);
  }

  private startReveal(lane: Lane): void {
    this.refreshLit();
    const held = this.held !== null;
    this.records = this.records.filter((r) => r.lane !== lane);
    this.records.push({ id: this.nextId++, lane, age: 0, wave: !held, dismissed: false });
    // The closed -> open cross-fade (and the welcome it stands in for) belong
    // to the troop map. The Digger's map does not change when a lane opens.
    if (this.held === "troop") {
      this.laneMixAge[lane] = 0;
      this.welcomed[lane] = true;
    }
  }

  private advance(dt: number): void {
    // Per frame: no array is rebuilt unless a record actually ends.
    let ended = false;
    for (const r of this.records) {
      r.age += dt;
      if (r.age >= REVEAL_LIFE) ended = true;
    }
    if (ended) this.records = this.records.filter((r) => r.age < REVEAL_LIFE);
    for (const lane of LANES) {
      this.laneMixAge[lane] += dt;
      this.welcomeAge[lane] += dt;
    }
    const step = dt / HOLD_FADE;
    this.fade = this.held !== null ? Math.min(1, this.fade + step) : Math.max(0, this.fade - step);
    const target = this.callBackOn ? 1 : 0;
    if (this.still) this.callBackEase = target;
    else {
      const s = dt / CALLBACK_EASE;
      this.callBackEase = target > this.callBackEase ? Math.min(target, this.callBackEase + s) : Math.max(target, this.callBackEase - s);
    }
    this.refuseAge += dt;
    this.flashAge += dt;
    this.digAge += dt;
  }

  /** The mode whose map the texture holds: the held one, or the last while it fades out. */
  private get shownMode(): ZoneMode {
    return this.held ?? (this.fade > 0 ? this.lastMode : "troop");
  }

  private repaint(state: BattleState, side: Side, open: OpenLanes): void {
    if (this.cacheSide !== side) {
      this.troopCache.clear();
      for (const left of [false, true]) {
        for (const right of [false, true]) {
          const lanes = { left, right };
          this.troopCache.set(troopKey(side, lanes), paintZoneField(troopShapeFor(side, lanes)));
        }
      }
      this.cacheSide = side;
    }
    if (this.shownMode === "dig") {
      // The bodies are re-listed (a string) at most 4 times a second, not every frame.
      if (this.digAge < DIG_REPAINT_MIN && typeof this.key === "string") return;
      this.digAge = 0;
      const key = digKey(state);
      if (key === this.key) return;
      paintZoneField(zoneShape(state, side, "dig"), this.digData);
      this.use(this.digData, key);
      return;
    }
    const key = troopKey(side, open);
    if (key !== this.key) this.use(this.troopCache.get(key)!, key);
  }

  private use(data: Uint8Array, key: number | string): void {
    this.data = data;
    this.key = key;
    this.tex.image.data = data;
    this.tex.needsUpdate = true;
  }

  /** The live reveal record of `lane`, if any. */
  private recordFor(lane: Lane): RevealRecord | undefined {
    for (const r of this.records) if (r.lane === lane) return r;
    return undefined;
  }

  /** Per-lane pocket-only envelope (0..1), written into one reused object (per frame: no garbage). */
  private envelopes(): Record<Lane, number> {
    const env = this.env;
    env.left = env.right = 0;
    if (this.ended || this.records.length === 0) return env;
    let max = 0;
    for (const r of this.records) max = Math.max(max, revealEnvelope(r.age, r.wave, this.still));
    for (const lane of LANES) {
      if (!this.open[lane]) continue;
      const r = this.recordFor(lane);
      const young = r && r.wave && r.age < REVEAL_DELAY + (this.still ? STILL_FADE_IN : 0);
      env[lane] = young ? revealEnvelope(r.age, r.wave, this.still) : max;
    }
    return env;
  }

  /** Push the uniforms for this frame and decide whether the plane draws. */
  render(dayPhase: number, dpr: number, still: boolean): void {
    this.still = still;
    const u = this.mat.uniforms;
    const hold = this.ended ? 0 : this.fade;
    const env = this.envelopes();
    const shown = hold > 0 || env.left > 0 || env.right > 0;
    this.mesh.visible = shown || this.warm;
    this.warm = false;
    if (!this.mesh.visible) return;
    u.uHold.value = shown ? hold : 0;
    (u.uEnv.value as THREE.Vector2).set(shown ? env.left : 0, shown ? env.right : 0);
    (u.uOpen.value as THREE.Vector2).set(this.open.left ? 1 : 0, this.open.right ? 1 : 0);
    (u.uLaneMix.value as THREE.Vector2).set(laneMixAt(this.laneMixAge.left), laneMixAt(this.laneMixAge.right));
    for (const lane of LANES) {
      const r = this.recordFor(lane);
      const w = (lane === "left" ? u.uWaveL.value : u.uWaveR.value) as THREE.Vector3;
      if (r && r.wave && !still && this.held === null) {
        const spot = this.ruins[lane];
        w.set(spot.x, spot.y, revealRadius(r.age, false));
      } else w.set(0, 0, REVEAL_DONE);
    }
    const dig = this.shownMode === "dig";
    u.uDig.value = dig ? 1 : 0;
    u.uDpr.value = dpr;
    const day = Math.max(0, Math.min(1, dayPhase));
    u.uNoBase.value = 0.58 + (0.44 - 0.58) * day;
    u.uEdgeA.value = this.nightEdge ? NIGHT_EDGE_ALPHA * day : 0;
    // The map is unlit while the field darkens toward night: it calms down
    // with the sky, so the pocket stays "lit ground", never milky.
    u.uFill.value = this.fillBase * (1 - this.fillNightCut * day);
    u.uGlowP.value = 0.22 * (1 - NIGHT_GLOW_CUT * day);
    u.uGlowOwn.value = 0.16 * (1 - NIGHT_GLOW_CUT * day);
    u.uLitGain.value = 1 - NIGHT_LIT_CUT * day;
    (u.uWelcome.value as THREE.Vector2).set(welcomeBump(this.welcomeAge.left), welcomeBump(this.welcomeAge.right));
    const refusing = this.refuseAge < REFUSE_OUTLINE ? 1 : 0;
    u.uThick.value = (dig ? DIG_THICK : 1) * (1 + 0.35 * Math.max(this.callBackEase, refusing));
    if (this.flashAge < REFUSE_FLASH) {
      const t = this.flashAge;
      const envelope = still ? 1 : 0.5 - 0.5 * Math.cos((4 * Math.PI * t) / REFUSE_FLASH);
      u.uFlash.value = FLASH_ALPHA * envelope;
    } else u.uFlash.value = 0;
  }

  /** The pointer rests on a "no" spot: the outline thickens, calling the finger back inside. */
  callBack(on: boolean): void {
    this.callBackOn = on;
  }

  /** A refused drop: thicken the outline and flash the region the words are about. */
  refuse(reason: RefuseReason, x: number, y: number): void {
    this.refuseAge = 0;
    this.flashAge = 0;
    const u = this.mat.uniforms;
    u.uFlashKind.value = FLASH_KIND[reason];
    (u.uFlashAt.value as THREE.Vector2).set(x, y);
  }

  /** The newest reveal while its label should show ("Drop troops here now!"), else null. */
  callout(): LaneCallout | null {
    if (this.ended || this.records.length === 0) return null;
    const r = this.records[this.records.length - 1];
    if (r.dismissed || r.age < CALLOUT_FROM || r.age >= CALLOUT_TO) return null;
    const a = laneAnchor(this.side, r.lane);
    return { id: r.id, lane: r.lane, ax: a.x, ay: a.y, far: this.band.far, near: this.band.near, age: r.age };
  }

  /** Hide the label early (the kid just played a card). */
  dismissCallout(): void {
    for (const r of this.records) r.dismissed = true;
  }

  /** The drawn map's signed distance at (x, y) as the GPU reads it (+ = allowed). */
  sample(x: number, y: number): number {
    return sampleField(this.data, x, y);
  }

  get parts(): ZoneParts {
    const env = this.envelopes();
    const shown = !this.ended && (this.held !== null || env.left > 0 || env.right > 0);
    return {
      shown,
      mode: this.held,
      pocketOnly: !this.ended && this.held === null && this.records.length > 0,
      open: { ...this.open },
      reveals: this.records.map((r) => ({ lane: r.lane, age: r.age, wave: r.wave })),
      callout: this.callout() !== null,
      key: this.key,
    };
  }

  /** The plane's ray shift (tests). */
  get shift(): number {
    return this.mesh.position.z;
  }

  /** Forget the battle: the next sync seeds quietly (a new battle or a restored context). */
  reset(): void {
    this.lastState = null;
    this.lastOpen = null;
    this.records = [];
    this.laneMixAge.left = this.laneMixAge.right = Infinity;
    this.welcomeAge.left = this.welcomeAge.right = Infinity;
    this.refuseAge = this.flashAge = Infinity;
    this.callBackOn = false;
    this.callBackEase = 0;
    this.ended = false;
  }

  /**
   * The battle is left for a menu (Leave, the home screen): put the card
   * down and draw nothing at once. The menus sync with dt 0, so a reveal or
   * a fade left running would stay frozen over the home diorama. The next
   * sync seeds quietly, as after reset().
   */
  leave(): void {
    this.reset();
    this.held = null;
    this.fade = 0;
    this.warm = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.tex.dispose();
    this.mat.dispose();
    this.geo.dispose();
  }
}
