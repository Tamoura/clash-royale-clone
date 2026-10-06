/**
 * Unit meshes: troop and building views with their team disc, name chip,
 * contact shadow and HP bar, the shared HP/label/status sprites, and the
 * translucent deploy ghost. Optional KayKit glTF models load on demand.
 * Team colours follow the player's teamPalette pref live (no reload).
 */
import * as THREE from "three";
import type { Side } from "../../../game/arena";
import type { Entity } from "../../../game/battle";
import type { CardId } from "../../../game/cards";
import { cardDisplayName } from "../../../render/cardNames";
import { buildTroop, toon, type TroopRig } from "../../characters3d";
import { spawnRecipe } from "../../spawnfx";
import { makeTeamDisc, refreshTeamDisc } from "../../teamBase";
import { applyTeam, teamColor, teamCss, teamPalette } from "../../teamColors";
import { onPrefs, type TeamPalette } from "../../../ui/prefs";
import { ARABIC } from "../../theme";
import { kaykitOptIn } from "../../modelsOptIn";
import {
  BAR_TILT,
  GAME_FONT,
  HP_COLOR,
  unlitGlow,
  viewSide,
  type EntityView,
  type HpText,
} from "../common";

type GlbModule = typeof import("../../glbModels");
/** The KayKit model module, once loaded (never in the default build path). */
let glb: GlbModule | null = null;

/**
 * Fetch the KayKit glTF code and models only for players who opted in with
 * `?models=kaykit` (remembered), and never in the Arabic edition: the loader
 * stays out of the main bundle. Units built before the models arrive use
 * the hand-built rigs, exactly as when the preload was still in flight.
 */
export function loadGlbModels(): void {
  const optIn = kaykitOptIn(); // always: it also remembers ?models=...
  if (ARABIC || !optIn || glb) return;
  import("../../glbModels")
    .then((m) => {
      glb = m;
      m.preloadGlbModels();
    })
    .catch(() => {}); // offline / chunk missing: keep the rig roster
}

/** The loaded glTF module; only views that carry a `glb` unit need it. */
export function glbModels(): GlbModule | null {
  return glb;
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

/** Repaint every live unit, label and level shield for a palette. */
function repaintTeams(palette: TeamPalette): void {
  pruneTeamLive();
  for (const t of teamLive) {
    applyTeam(t.root, t.side, palette);
    if (t.disc) refreshTeamDisc(t.disc, palette);
    if (t.hpFill) (t.hpFill.material as THREE.MeshBasicMaterial).color.setHex(unitHpColor(t.side, palette));
  }
  for (const b of levelBadges.values()) drawLevelBadge(b, palette);
  for (const l of nameLabels.values()) drawNameLabel(l, palette);
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

export function makeHpBar(width: number, color: number, y: number, height = 0.2): {
  group: THREE.Group;
  fill: THREE.Mesh;
} {
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
  // Gloss highlight rides the fill so it scales with it.
  const gloss = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.06, height * 0.25),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  gloss.position.set(0, height * 0.2, 0.01);
  fill.add(gloss);
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
  view.hpFill.scale.x = Math.max(0.001, f);
  view.hpFill.position.x = (-(1 - f) * (width - 0.06)) / 2;
}

/** A cached unit name label: its tint follows the team palette. */
interface NameLabel {
  name: string;
  side: Side;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.SpriteMaterial;
}
/** One shared sprite material per card+side; only the palette tint changes. */
const nameLabels = new Map<string, NameLabel>();

/** Light team tint for name text (pale blue / pale red, or pale orange). */
function labelTint(side: Side, palette: TeamPalette): string {
  if (side === "player") return "#aecdff";
  return palette === "cb" ? "#ffcf94" : "#ffb9b3";
}

function drawNameLabel(l: NameLabel, palette: TeamPalette): void {
  const { ctx, name } = l;
  ctx.clearRect(0, 0, 256, 64);
  let size = 34;
  ctx.font = `bold ${size}px ${GAME_FONT}`;
  while (ctx.measureText(name).width > 236 && size > 16) {
    size -= 2;
    ctx.font = `bold ${size}px ${GAME_FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = labelTint(l.side, palette);
  ctx.fillText(name, 128, 34);
  l.tex.needsUpdate = true;
}

export function nameSpriteMaterial(cardId: CardId, side: Side): THREE.SpriteMaterial {
  // Edition-aware: Arabic-script names in the Arabic edition.
  const name = cardDisplayName(cardId);
  // Keyed by name too: renaming the Studio champion must not reuse a
  // stale label from an earlier battle.
  const key = `${cardId}:${side}:${name}`;
  let label = nameLabels.get(key);
  if (!label) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    mat.userData.shared = true; // cached across every unit label
    label = { name, side, ctx: c.getContext("2d")!, tex, mat };
    drawNameLabel(label, teamPalette());
    nameLabels.set(key, label);
  }
  return label.mat;
}

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

/** Materials with an emissive channel under this object, for flashes. */
export function collectFlashMats(root: THREE.Object3D): EntityView["flashMats"] {
  const out: EntityView["flashMats"] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material & { emissive?: THREE.Color };
    if (mat.emissive) {
      out.push({
        mat: mat as THREE.Material & { emissive: THREE.Color },
        orig: mat.emissive.getHex(),
      });
    }
  });
  return out;
}

/** Gravestone for the Tombstone spawner: slab, mound, tiny skull. */
export function buildTombstoneMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.22, 10), toon(0x6b5b45));
  mound.position.y = 0.11;
  mound.castShadow = true;
  mound.receiveShadow = true;
  root.add(mound);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.2), toon(0x9aa3ad));
  slab.position.set(0, 0.6, -0.12);
  slab.castShadow = true;
  root.add(slab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12, 1, false, 0, Math.PI), toon(0x9aa3ad));
  cap.rotation.z = Math.PI / 2;
  cap.rotation.y = Math.PI / 2;
  cap.position.set(0, 1.02, -0.12);
  cap.castShadow = true;
  root.add(cap);
  // Carved "RIP" plate on the headstone (replaces the old cross bar).
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.04), toon(0x78909c));
  plate.position.set(0, 0.74, 0.01);
  root.add(plate);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), toon(0xf5f2ea));
  skull.position.set(0.32, 0.12, 0.32);
  root.add(skull);
  const glowOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    unlitGlow(0x76ff03),
  );
  glowOrb.position.set(0, 1.02, 0.02);
  root.add(glowOrb);

  const team = teamSide(e.side);
  const bar = makeHpBar(1.4, unitHpColor(team), 1.6);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, team));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 1.95;
  root.add(label);
  trackTeam({ root, side: team, hpFill: bar.fill });
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

/** Elixir collector: a wooden vat brimming with glowing elixir. */
export function buildCollectorMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.3, 10), toon(0x8d6e63));
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.65, 12), toon(0x6d4c41));
  vat.position.y = 0.62;
  vat.castShadow = true;
  root.add(vat);
  for (const a of [0, 1, 2, 3]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.59 - a * 0.015, 0.025, 6, 14),
      toon(0x4e342e),
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = 0.38 + a * 0.16;
    root.add(hoop);
  }
  const brew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12),
    unlitGlow(0xd946ef),
  );
  brew.position.y = 0.96;
  root.add(brew);
  const drop = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    unlitGlow(0xe879f9),
  );
  drop.position.y = 1.25;
  root.add(drop);

  const team = teamSide(e.side);
  const bar = makeHpBar(1.4, unitHpColor(team), 1.7);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, team));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 2.05;
  root.add(label);
  trackTeam({ root, side: team, hpFill: bar.fill });
  return {
    root,
    rig: null,
    hpGroup: bar.group,
    hpFill: bar.fill,
    flashMats: collectFlashMats(root),
    lastHp: e.hp,
    flashT: 0,
    spawnT: 0,
    isTroop: false,
  };
}

export function buildBuildingMesh(e: Entity): EntityView {
  if (e.cardId === "tombstone") return buildTombstoneMesh(e);
  if (e.cardId === "elixir-collector") return buildCollectorMesh(e);
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.25, 10), toon(0x8d6e63));
  base.position.y = 0.12;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), toon(0x4e342e));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.62, 0.22, 0);
    wheel.castShadow = true;
    root.add(wheel);
  }
  const barrel = new THREE.Group();
  barrel.position.y = 0.5;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12), toon(0x37474f));
  tube.rotation.x = Math.PI / 2 - 0.18;
  tube.position.z = 0.25;
  tube.castShadow = true;
  barrel.add(tube);
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), toon(0x263238));
  breech.castShadow = true;
  barrel.add(breech);
  root.add(barrel);

  const team = teamSide(e.side);
  const bar = makeHpBar(1.4, unitHpColor(team), 1.15);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, team));
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 1.5;
  root.add(label);
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

export function buildTroopMesh(e: Entity, withLabel: boolean): EntityView {
  const root = new THREE.Group();
  const team = teamSide(e.side);

  // Real glTF model (KayKit) when this card has one; else the primitive rig.
  const glbUnit = glb?.hasGlbModel(e.cardId!) ? glb.makeGlbUnit(e.cardId!) : null;
  let rig: TroopRig | null = null;
  let lift: number;
  if (glbUnit) {
    root.add(glbUnit.group);
    lift = glbUnit.height;
  } else {
    rig = buildTroop(e.cardId!, team);
    // CR readability comes from silhouette CONTRAST: tanks tower, swarm
    // units stay small, everyone else sits between.
    const scale =
      e.cardId === "mega-knight" ? 1.6
      : e.cardId === "pekka" ? 1.5
      : e.cardId === "giant" ? 1.48
      : e.cardId === "royal-giant" ? 1.42
      : e.radius <= 0.32 ? 1.08 // skeletons, bats, minions — spindly packs
      : 1.25;
    rig.group.scale.setScalar(scale);
    root.add(rig.group);
    lift = (rig.hover ?? 0) + rig.height * scale;
  }

  // Bold team disc: at phone size this is the primary "whose unit is
  // that" read, so it has to pop off grass and cream tile alike. Enemy
  // discs are notched, so the side also reads by shape.
  const disc = makeTeamDisc(team, e.radius);
  root.add(disc);

  // Name chip so cards are tellable apart mid-fight. The caller labels
  // only one unit per deployed group — a flock gets one label, not three.
  if (withLabel) {
    const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, team));
    label.name = "unitLabel";
    label.scale.set(1.7, 0.42, 1);
    label.position.y = lift + 0.62;
    root.add(label);
  }

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
        opacity: rig?.hover ? 0.5 : 0.65,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.02;
    const d = Math.max(0.8, e.radius * 2.6);
    contact.scale.set(d, d, 1);
    contact.renderOrder = -1;
    root.add(contact);
    if (rig?.hover) blobShadow = contact;
  }

  // Units are grounded by the contact shadow above, as in CR; skipping
  // the shadow-map pass for ~40 parts per unit halves a busy fight's cost.
  root.traverse((o) => (o.castShadow = false));

  const bar = makeHpBar(0.9, unitHpColor(team), lift + 0.25);
  bar.group.visible = team === "enemy"; // opponents always; yours once damaged
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
    glb: glbUnit ? { ...glbUnit, current: "idle" } : undefined,
  };
}

/**
 * Troop HP bars: the opponent's troops always show a compact bar (their
 * health is what you plan around); your own appear once hurt, and stay.
 * "Opponent" is relative to the viewpoint, so an online guest sees the
 * host's units barred.
 */
export function hpBarVisible(view: EntityView, e: Entity): boolean {
  return (
    view.hpGroup.visible || (e.kind === "troop" && (teamSide(e.side) === "enemy" || e.hp < e.maxHp))
  );
}

/** Translucent preview rig of a troop card for the deploy cursor (always yours). */
export function buildGhost(cardId: CardId): TroopRig {
  const rig = buildTroop(cardId, "player");
  rig.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
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
