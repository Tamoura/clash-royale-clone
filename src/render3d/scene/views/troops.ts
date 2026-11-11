/**
 * Unit meshes: troop and building views with their team disc, contact
 * shadow and HP bar, the shared HP/status sprites, and the translucent
 * deploy ghost. Humanoid troops are the modelled cast (./../../cast/) when
 * the battle fields it, else the procedural roster. Every troop body hangs
 * under a LEAN node (tipped toward the camera each frame in animate.ts);
 * the disc, contact shadow and HP bar do not lean. Team colours follow the
 * player's teamPalette pref live (no reload). No floating name tags.
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { Entity } from "../../../game/battle";
import type { CardId } from "../../../game/cards";
import { buildBuildingRig, buildTroop, type TroopRig } from "../../characters3d";
import { bakeRig } from "../../rigBake";
import { spawnRecipe } from "../../spawnfx";
import { FLYER_DISC_OPACITY, FLYER_DISC_SCALE, makeTeamDisc, refreshTeamDisc } from "../../teamBase";
import { applyTeam, teamColor, teamCss, teamPalette } from "../../teamColors";
import { onPrefs, type TeamPalette } from "../../../ui/prefs";
import { ARABIC } from "../../theme";
import { registerTroopCaster } from "../post";
import { castActiveForBattle, hasKitTroop, kitTroopCards, loadKitTroops, makeKitGhost, makeKitTroop, setCastPalette } from "../../cast/index";
import { invalidatePortrait } from "../../cardportraits";
import {
  BAR_TILT,
  GAME_FONT,
  HP_COLOR,
  viewSide,
  type EntityView,
  type HpText,
} from "../common";

/**
 * Start loading the modelled cast (both editions; the loader code and the
 * pack stay out of the main bundle). Card art drawn before it arrived is
 * redrawn on next use. Kept under its old name: the scene calls it at boot.
 */
export function loadGlbModels(): void {
  void loadKitTroops().then((ok) => {
    if (ok) for (const id of kitTroopCards()) invalidatePortrait(id as CardId);
  });
}

/** Whether a card's units in this battle are cast characters. */
function castFor(cardId: CardId): boolean {
  return castActiveForBattle() && hasKitTroop(cardId);
}

/**
 * Everything built here that wears team colours and is still on stage:
 * rig team parts, the disc and the HP fill are repainted when the
 * teamPalette pref changes. Entries drop out once their root leaves the
 * scene (death, reset, ghost swap).
 */
interface TeamLive {
  root: THREE.Object3D;
  side: Side;
  disc?: THREE.Mesh;
  hpFill?: THREE.Mesh;
}
const teamLive = new Set<TeamLive>();
let livePalette: TeamPalette | null = null;

function pruneTeamLive(): void {
  for (const t of teamLive) if (!t.root.parent) teamLive.delete(t);
}

/** Repaint every live unit and level shield for a palette. */
function repaintTeams(palette: TeamPalette): void {
  setCastPalette(palette); // every cast unit's cloth, live
  pruneTeamLive();
  for (const t of teamLive) {
    applyTeam(t.root, t.side, palette);
    if (t.disc) refreshTeamDisc(t.disc, palette);
    if (t.hpFill) setHpFillColor(t.hpFill, t.hpFill.userData.troopBar ? troopHpColor(t.side, palette) : unitHpColor(t.side, palette));
  }
  for (const b of levelBadges.values()) drawLevelBadge(b, palette);
}

function trackTeam(entry: TeamLive): void {
  if (livePalette === null) {
    livePalette = teamPalette();
    onPrefs((p) => {
      if (p.teamPalette === livePalette) return;
      livePalette = p.teamPalette;
      repaintTeams(p.teamPalette);
    });
  }
  if (teamLive.size > 64) pruneTeamLive();
  teamLive.add(entry);
}

/**
 * The team a unit WEARS, relative to the viewer: "player" (blue, plain
 * disc, green HP, bar only once hurt) always means yours and "enemy"
 * (red or orange, notched disc, bar always on) your opponent, also for an
 * online guest who plays the sim's "enemy" side. Every team cue built
 * here (rig parts, disc, HP fill, name tint, level shield) goes through
 * it, so colour and the notch can never disagree with the HP-bar rule.
 * viewSide is set before the scene resets, so views are built with the
 * final viewpoint.
 */
export function teamSide(side: Side): Side {
  return side === viewSide ? "player" : "enemy";
}

/**
 * HP fill for troops and buildings: the classic green-for-yours and
 * red-for-theirs, or the colour-blind blue/orange team pair (green and
 * orange collide under deuteranopia).
 */
export function unitHpColor(side: Side, palette: TeamPalette = teamPalette()): number {
  return palette === "cb" ? teamColor(side, "main", "cb") : HP_COLOR[side];
}

export function makeHpText(y: number): { sprite: THREE.Sprite; text: HpText } {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.5, 0.56, 1);
  sprite.position.y = y;
  return { sprite, text: { ctx, tex, last: -1 } };
}

export function updateHpText(t: HpText, hp: number): void {
  const value = Math.max(0, Math.ceil(hp));
  if (value === t.last) return;
  t.last = value;
  const ctx = t.ctx;
  ctx.clearRect(0, 0, 128, 48);
  ctx.font = `bold 30px ${GAME_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(String(value), 64, 26);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(value), 64, 26);
  t.tex.needsUpdate = true;
}

/** Shared rounded-pill trough texture for HP bars. */
let pillTexture: THREE.CanvasTexture | null = null;

export function pillTex(): THREE.CanvasTexture {
  if (!pillTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#10141c";
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(2, 2, 124, 28, 14);
    ctx.fill();
    ctx.stroke();
    pillTexture = new THREE.CanvasTexture(c);
    pillTexture.userData.shared = true;
  }
  return pillTexture;
}

interface HpBarUniforms {
  uFrac: { value: number };
  uColor: { value: THREE.Color };
  uMap: { value: THREE.Texture };
  uPad: { value: THREE.Vector2 };
}

const HP_BAR_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const HP_BAR_FRAG = `varying vec2 vUv;
uniform sampler2D uMap; uniform vec3 uColor; uniform float uFrac; uniform vec2 uPad;
void main(){
  vec4 base = texture2D(uMap, vUv);
  float inY = step(uPad.y, vUv.y) * step(vUv.y, 1.0 - uPad.y);
  float inX = step(uPad.x, vUv.x) * step(vUv.x, uPad.x + (1.0 - 2.0 * uPad.x) * uFrac);
  float fill = inX * inY;
  gl_FragColor = vec4(mix(base.rgb, uColor, fill), max(base.a, fill));
}`;

/**
 * Troop HP bar in a single draw: the pill trough and the fill share one
 * quad, the fill drawn by a fraction uniform. Swarms pay one draw per bar
 * instead of two.
 */
function makeFlatHpBar(width: number, color: number, y: number, height: number): {
  group: THREE.Group;
  fill: THREE.Mesh;
} {
  const uniforms: HpBarUniforms = {
    uFrac: { value: 1 },
    uColor: { value: new THREE.Color(color) },
    uMap: { value: pillTex() },
    uPad: { value: new THREE.Vector2(0.03 / width, 0.15) },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.ShaderMaterial({ uniforms: uniforms as never, vertexShader: HP_BAR_VERT, fragmentShader: HP_BAR_FRAG, transparent: true }),
  );
  mesh.userData.hpBar = uniforms;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.y = y;
  if (viewSide === "enemy") group.rotation.set(BAR_TILT, Math.PI, 0, "YXZ");
  else group.rotation.x = BAR_TILT;
  return { group, fill: mesh };
}

/** Recolour an HP bar fill (single-draw or classic two-mesh form). */
export function setHpFillColor(fill: THREE.Mesh, hex: number): void {
  const u = fill.userData.hpBar as HpBarUniforms | undefined;
  if (u) u.uColor.value.setHex(hex);
  else (fill.material as THREE.MeshBasicMaterial).color.setHex(hex);
}

export function makeHpBar(width: number, color: number, y: number, height = 0.2, gloss = true): {
  group: THREE.Group;
  fill: THREE.Mesh;
} {
  if (!gloss) return makeFlatHpBar(width, color, y, height);
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: pillTex(), transparent: true }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.06, height * 0.7),
    new THREE.MeshBasicMaterial({ color }),
  );
  fill.position.z = 0.01;
  // Gloss highlight rides the fill so it scales with it. Troop bars skip it:
  // the strip is about a pixel tall at battle zoom and costs a draw per unit.
  if (gloss) {
    const shine = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.06, height * 0.25),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    shine.position.set(0, height * 0.2, 0.01);
    fill.add(shine);
  }
  group.add(bg, fill);
  group.position.y = y;
  // Face the steep camera; for the enemy viewpoint, also spin 180° about Y.
  if (viewSide === "enemy") group.rotation.set(BAR_TILT, Math.PI, 0, "YXZ");
  else group.rotation.x = BAR_TILT;
  return { group, fill };
}

/** A cached level shield: its canvas is redrawn when the palette changes. */
interface LevelBadge {
  side: Side;
  level: number;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.SpriteMaterial;
}
/** Shared level-shield materials, one per side + level. */
const levelBadges = new Map<string, LevelBadge>();

function drawLevelBadge(b: LevelBadge, palette: TeamPalette): void {
  const { ctx, side, level } = b;
  ctx.clearRect(0, 0, 64, 64);
  // Shield: flat top, pointed bottom — a crest, not a coin.
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(56, 8);
  ctx.lineTo(56, 36);
  ctx.quadraticCurveTo(56, 52, 32, 60);
  ctx.quadraticCurveTo(8, 52, 8, 36);
  ctx.closePath();
  ctx.fillStyle =
    palette === "cb" ? teamCss(side, "dark", "cb") : side === "player" ? "#2c55b8" : "#b02e22";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#f2c14e";
  ctx.stroke();
  ctx.font = `36px ${GAME_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(10,14,22,0.85)";
  ctx.strokeText(String(level), 32, 33);
  ctx.fillStyle = "#fff";
  ctx.fillText(String(level), 32, 33);
  b.tex.needsUpdate = true;
}

/**
 * CR-style level shield capping an HP bar (towers and troops). `simSide`
 * is the entity's sim side; the shield wears the viewer-relative team.
 */
export function makeLevelBadge(simSide: Side, level = 9): THREE.Sprite {
  const side = teamSide(simSide);
  const key = `${side}:${level}`;
  let badge = levelBadges.get(key);
  if (!badge) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    mat.userData.shared = true;
    badge = { side, level, ctx: c.getContext("2d")!, tex, mat };
    drawLevelBadge(badge, teamPalette());
    levelBadges.set(key, badge);
  }
  const sprite = new THREE.Sprite(badge.mat);
  sprite.scale.set(0.42, 0.42, 1);
  return sprite;
}

export function setHpFill(view: EntityView, frac: number, width: number): void {
  const f = Math.max(0, Math.min(1, frac));
  const u = view.hpFill.userData.hpBar as HpBarUniforms | undefined;
  if (u) {
    u.uFrac.value = f;
    return;
  }
  view.hpFill.scale.x = Math.max(0.001, f);
  view.hpFill.position.x = (-(1 - f) * (width - 0.06)) / 2;
}

/** Name of a unit's soft contact / blob shadow mesh. */
export const CONTACT_SHADOW = "contactShadow";

/** Shared soft radial contact-shadow texture (dark centre, feathered edge). */
let contactShadowTexture: THREE.CanvasTexture | null = null;
export function contactShadowTex(): THREE.CanvasTexture {
  if (!contactShadowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(10,12,28,0.85)");
    g.addColorStop(0.55, "rgba(10,12,28,0.45)");
    g.addColorStop(1, "rgba(10,12,28,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    contactShadowTexture = new THREE.CanvasTexture(c);
    contactShadowTexture.userData.shared = true;
  }
  return contactShadowTexture;
}

/** Shared "seeing stars" texture for stunned units. */
let stunTexture: THREE.CanvasTexture | null = null;

export function makeStunSprite(): THREE.Sprite {
  if (!stunTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 48;
    const ctx = c.getContext("2d")!;
    ctx.font = `bold 30px ${GAME_FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe14d";
    ctx.strokeStyle = "rgba(10,14,22,0.9)";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    for (const [x, y] of [
      [24, 32],
      [64, 24],
      [104, 34],
    ] as const) {
      ctx.strokeText("★", x, y + 8);
      ctx.fillText("★", x, y + 8);
    }
    stunTexture = new THREE.CanvasTexture(c);
    stunTexture.userData.shared = true;
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: stunTexture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.3, 0.5, 1);
  return sprite;
}

export function makeZzzSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = `bold 30px ${GAME_FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("z", 22, 44);
  ctx.font = `bold 20px ${GAME_FONT}`;
  ctx.fillText("z", 42, 26);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  sprite.scale.set(1.2, 1.2, 1);
  return sprite;
}

/**
 * Materials with an emissive channel under this object, for flashes. Each
 * material once: a baked unit shares one between all its baked meshes.
 */
export function collectFlashMats(root: THREE.Object3D): EntityView["flashMats"] {
  const out: EntityView["flashMats"] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material & { emissive?: THREE.Color };
    if (mat.emissive && !seen.has(mat)) {
      seen.add(mat);
      out.push({
        mat: mat as THREE.Material & { emissive: THREE.Color },
        orig: mat.emissive.getHex(),
      });
    }
  });
  return out;
}

/**
 * A card building (cannon, tombstone, elixir collector): the baked
 * creatures-fx rig in the cast's material language, wearing its team on one
 * slot. The cannon's barrel is an animated node updateTower aims at the
 * target; the HP bar sits at the rig's barY. trackTeam re-runs applyTeam on
 * the rig when the palette changes, as for troops.
 */
export function buildBuildingMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const team = teamSide(e.side);
  const rig = buildBuildingRig(e.cardId!, team);
  let barY = 1.6;
  let barrel: THREE.Group | undefined;
  if (rig) {
    bakeRig(rig, `${e.cardId}:${team}:${ARABIC ? "arabic" : "normal"}:${teamPalette()}`);
    root.add(rig.group);
    barY = rig.barY;
    barrel = rig.barrel;
    // Static buildings keep casting into the sun's shadow map like the old
    // hand-built ones did (the bake leaves its merged meshes non-casting).
    rig.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === "outline" || mesh.name === "baked-glow") return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat) || mat.transparent) return;
      mesh.castShadow = true;
    });
  }
  const bar = makeHpBar(1.4, unitHpColor(team), barY);
  root.add(bar.group);
  trackTeam({ root, side: team, hpFill: bar.fill });
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    barrel,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

/** Every troop stands this much larger than its old size, so faces and weapons read on a phone. */
const TROOP_POP = 1.14;
/** The Golden Age war elephant's rig scale (the Classic Giant's is 1.48): still in the large band (head-top 3.3+). */
export const GOLDEN_GIANT_SCALE = 1.3;

/** Troop HP bar size (world units): wide and tall enough for a 2 px outline at phone size. */
export const TROOP_BAR_W = 1.0;
export const TROOP_BAR_H = 0.3;

/**
 * The troop HP fill: the team colour, lifted a little so it reads on the
 * dark trough (blue yours, red or orange theirs).
 */
export function troopHpColor(side: Side, palette: TeamPalette = teamPalette()): number {
  return new THREE.Color().setHex(teamColor(side, "main", palette)).lerp(WHITE, 0.12).getHex();
}
const WHITE = new THREE.Color(0xffffff);

/** Shared troop-bar trough: a 2 px dark outline round a dark well (the fill sits inside the outline). */
let troopPillTexture: THREE.CanvasTexture | null = null;
function troopPillTex(): THREE.CanvasTexture {
  if (!troopPillTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 40;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1d1630";
    ctx.beginPath();
    ctx.roundRect(1, 1, 126, 38, 12);
    ctx.fill();
    ctx.fillStyle = "#3a3450";
    ctx.beginPath();
    ctx.roundRect(9, 9, 110, 22, 6);
    ctx.fill();
    troopPillTexture = new THREE.CanvasTexture(c);
    troopPillTexture.colorSpace = THREE.SRGBColorSpace;
    troopPillTexture.userData.shared = true;
  }
  return troopPillTexture;
}

/** A troop's HP bar: one draw, outlined trough, team fill (shown only once the unit is hurt). */
function makeTroopHpBar(side: Side, y: number): { group: THREE.Group; fill: THREE.Mesh } {
  const bar = makeFlatHpBar(TROOP_BAR_W, troopHpColor(side), y, TROOP_BAR_H);
  const u = bar.fill.userData.hpBar as HpBarUniforms;
  u.uMap.value = troopPillTex();
  u.uPad.value.set(9 / 128, 9 / 40);
  bar.fill.userData.troopBar = true;
  // Always readable: drawn over every body (a neighbour's head must never hide it).
  (bar.fill.material as THREE.ShaderMaterial).depthTest = false;
  bar.fill.renderOrder = 10;
  return bar;
}

/**
 * The node a troop body hangs under, tipped toward the camera each frame
 * (animate.ts). A flyer pivots at its hover height, so it never slides
 * away from its shadow.
 */
function leanNode(root: THREE.Object3D, body: THREE.Object3D, pivotY: number): THREE.Group {
  const lean = new THREE.Group();
  lean.name = "lean";
  lean.position.y = pivotY;
  root.add(lean);
  if (pivotY !== 0) {
    const back = new THREE.Group();
    back.position.y = -pivotY;
    back.add(body);
    lean.add(back);
  } else {
    lean.add(body);
  }
  return lean;
}

/** A troop view (no floating name tag: art bible 6). */
export function buildTroopMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const team = teamSide(e.side);

  // A modelled cast character when the battle fields the cast; else the procedural rig.
  const kitUnit = castFor(e.cardId!) ? makeKitTroop(e.cardId!, team) : null;
  let rig: TroopRig | null = null;
  let lift: number;
  let lean: THREE.Group;
  if (kitUnit) {
    lean = leanNode(root, kitUnit.group, 0);
    lift = kitUnit.height;
  } else {
    rig = buildTroop(e.cardId!, team);
    bakeRig(rig, `${e.cardId}:${team}:${ARABIC ? "arabic" : "normal"}:${teamPalette()}`);
    // CR readability comes from silhouette CONTRAST: tanks tower, swarm
    // units stay small, everyone else sits between.
    const scale =
      (e.cardId === "mega-knight" ? 1.6
      : e.cardId === "pekka" ? 1.5
      // The Golden Age Giant is a war elephant: long-bodied, so a size down keeps it off a whole bridge.
      : e.cardId === "giant" ? (ARABIC ? GOLDEN_GIANT_SCALE : 1.48)
      : e.cardId === "royal-giant" ? 1.42
      : e.radius <= 0.32 ? 1.08 // skeletons, bats, minions — spindly packs
      : 1.25) * TROOP_POP;
    rig.group.scale.setScalar(scale);
    lean = leanNode(root, rig.group, rig.hover ?? 0);
    lift = (rig.hover ?? 0) + rig.height * scale;
  }

  // Bold team disc: at phone size this is the primary "whose unit is
  // that" read, so it has to pop off grass and cream tile alike. Enemy
  // discs are notched, so the side also reads by shape.
  const disc = makeTeamDisc(team, e.radius);
  if (rig?.hover) {
    (disc.material as THREE.MeshBasicMaterial).opacity = FLYER_DISC_OPACITY;
    disc.scale.multiplyScalar(FLYER_DISC_SCALE);
  }
  root.add(disc);

  // Soft contact shadow under every unit (CR grounds everything with one);
  // flyers' shadow also shrinks with altitude (see the render loop).
  let blobShadow: THREE.Mesh | undefined;
  {
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: contactShadowTex(),
        transparent: true,
        depthWrite: false,
        opacity: rig?.hover ? 0.5 : kitUnit ? 0.8 : 0.65,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.02;
    const d = Math.max(0.8, e.radius * 2.6) * (kitUnit ? 1.2 : 1);
    contact.scale.set(d, d, 1);
    contact.renderOrder = -1;
    contact.name = CONTACT_SHADOW;
    // Walkers' blob leans away from the sun where troops cast no real shadow (animate.ts sunBlob).
    if (!rig?.hover) contact.userData.sunBlob = { size: d, lift };
    root.add(contact);
    if (rig?.hover) blobShadow = contact;
  }

  // Units are grounded by the contact shadow above; on the top quality
  // levels their bodies also cast into the sun's shadow map (post.ts flips
  // the troopCaster meshes when the level changes, so it follows the LIVE
  // level). ONE caster per unit: a cast character's single skinned mesh,
  // or a rig's biggest chunk.
  root.traverse((o) => (o.castShadow = false));
  if (kitUnit) {
    registerTroopCaster(kitUnit.caster);
  } else if (rig) {
    rig.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const ranked: Array<{ mesh: THREE.Mesh; extent: number }> = [];
    rig.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === "outline" || !mesh.visible) return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat) || mat.transparent) return;
      box.setFromObject(mesh).getSize(size);
      ranked.push({ mesh, extent: size.x + size.y + size.z });
    });
    ranked.sort((a, b) => b.extent - a.extent);
    for (const { mesh } of ranked.slice(0, 1)) registerTroopCaster(mesh);
  }

  // HP bar clear of the head (the lean tips the head toward the camera, away from the bar).
  const bar = makeTroopHpBar(team, lift + 0.42);
  bar.group.userData.lift = lift; // animate.ts keeps it above the LEANED head
  bar.group.visible = false; // only once hurt (hpBarVisible)
  root.add(bar.group);
  trackTeam({ root, side: team, disc, hpFill: bar.fill });

  const deploy = spawnRecipe(e.cardId);
  return {
    root,
    rig,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: true,
    blobShadow,
    spawnStyle: deploy.kind,
    spawnColor: deploy.color,
    spawnBurst: deploy.burst,
    kit: kitUnit ?? undefined,
    lean,
  };
}

/**
 * Troop HP bars appear only once a unit is hurt (either side), and stay;
 * buildings and towers keep theirs.
 */
export function hpBarVisible(view: EntityView, e: Entity): boolean {
  if (e.burrowTimer > 0) return (view.root.visible = false); // per frame: a tunnelling Digger stays hidden until it surfaces
  return view.hpGroup.visible || (e.kind === "troop" && e.hp < e.maxHp);
}

/** Swarm-sized bodies (skeletons, bats) show a bar once hurt, whichever side they fight for. */
export function isSwarmSized(e: Entity): boolean {
  return e.radius <= SWARM_RADIUS;
}
const SWARM_RADIUS = 0.3;

/** Translucent preview rig of a troop card for the deploy cursor (always yours). */
export function buildGhost(cardId: CardId): TroopRig {
  // The preview is the modelled character the card will field.
  const kitGhost = castFor(cardId) ? makeKitGhost(cardId) : null;
  if (kitGhost) return { group: kitGhost.group, height: kitGhost.height } as unknown as TroopRig;
  const rig = buildTroop(cardId, "player");
  rig.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.name === "outline") {
      // The shared ink shader cannot be cloned per ghost (its width uniforms
      // are shared); a see-through preview goes without ink.
      mesh.visible = false;
    } else if (mesh.isMesh) {
      const mat = (mesh.material as THREE.Material).clone() as THREE.Material & {
        opacity: number;
      };
      mat.transparent = true;
      mat.opacity = 0.45;
      mesh.material = mat;
      mesh.castShadow = false;
    }
  });
  trackTeam({ root: rig.group, side: "player" });
  return rig;
}
