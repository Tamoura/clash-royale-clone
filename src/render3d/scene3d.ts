import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, BRIDGE_XS, RIVER_Y, type Side } from "../game/arena";
import {
  distance,
  type BattleEvent,
  type BattleState,
  type Entity,
} from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { moveGoal } from "../game/sim";
import { animateTroop, buildTroop, toon, type TroopRig } from "./characters3d";

/** Arena tiles → world units: x centered, arena y becomes world z. */
function toWorld(ax: number, ay: number): { x: number; z: number } {
  return { x: ax - ARENA_WIDTH / 2, z: ay - ARENA_HEIGHT / 2 };
}

const SIDE_COLOR: Record<Side, number> = { player: 0x3b82f6, enemy: 0xef4444 };

const TROOP_DEATH_TIME = 0.5;
const TOWER_DEATH_TIME = 0.8;
const SPAWN_POP_TIME = 0.35;
const FLASH_TIME = 0.12;

interface EntityView {
  root: THREE.Group;
  rig: TroopRig | null;
  hpFill: THREE.Mesh;
  hpGroup: THREE.Group;
  crown?: THREE.Group;
  zzz?: THREE.Sprite;
  /** Cannon barrel, aimed at the current target. */
  barrel?: THREE.Group;
  /** Live numeric HP readout (towers). */
  hpText?: HpText;
  /** Materials with an emissive channel, for damage flashes. */
  flashMats: { mat: THREE.Material & { emissive: THREE.Color }; orig: number }[];
  lastHp: number;
  flashT: number;
  spawnT: number;
  isTroop: boolean;
}

interface DyingView {
  view: EntityView;
  t: number;
  duration: number;
  /** Corpses topple to a side; buildings sink. */
  topple: number;
  fadeMats: (THREE.Material & { opacity: number })[];
}

interface HpText {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: number;
}

interface EffectView {
  obj: THREE.Object3D;
  ttl: number;
  ttl0: number;
  delay: number;
  update: (frac: number) => void;
}

function makeHpText(y: number): { sprite: THREE.Sprite; text: HpText } {
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

function updateHpText(t: HpText, hp: number): void {
  const value = Math.max(0, Math.ceil(hp));
  if (value === t.last) return;
  t.last = value;
  const ctx = t.ctx;
  ctx.clearRect(0, 0, 128, 48);
  ctx.font = "bold 30px 'Trebuchet MS', sans-serif";
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

function makeHpBar(width: number, color: number, y: number): {
  group: THREE.Group;
  fill: THREE.Mesh;
} {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x10141c }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.16),
    new THREE.MeshBasicMaterial({ color }),
  );
  fill.position.z = 0.01;
  group.add(bg, fill);
  group.position.y = y;
  group.rotation.x = -0.65; // face the tilted camera
  return { group, fill };
}

function setHpFill(view: EntityView, frac: number, width: number): void {
  const f = Math.max(0, Math.min(1, frac));
  view.hpFill.scale.x = Math.max(0.001, f);
  view.hpFill.position.x = (-(1 - f) * width) / 2;
}

/** One shared sprite material per card+side; labels never change. */
const nameMaterials = new Map<string, THREE.SpriteMaterial>();

function nameSpriteMaterial(cardId: CardId, side: Side): THREE.SpriteMaterial {
  const key = `${cardId}:${side}`;
  const cached = nameMaterials.get(key);
  if (cached) return cached;
  const name = getCard(cardId).name;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  let size = 34;
  ctx.font = `bold ${size}px 'Trebuchet MS', sans-serif`;
  while (ctx.measureText(name).width > 236 && size > 16) {
    size -= 2;
    ctx.font = `bold ${size}px 'Trebuchet MS', sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(10,14,22,0.9)";
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = side === "player" ? "#aecdff" : "#ffb9b3";
  ctx.fillText(name, 128, 34);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
  });
  nameMaterials.set(key, mat);
  return mat;
}

function makeZzzSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 30px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("z", 22, 44);
  ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
  ctx.fillText("z", 42, 26);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }),
  );
  sprite.scale.set(1.2, 1.2, 1);
  return sprite;
}

/** Materials with an emissive channel under this object, for flashes. */
function collectFlashMats(root: THREE.Object3D): EntityView["flashMats"] {
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

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.15 : 0.85;
  const height = king ? 2.0 : 1.55;
  const stone = king ? 0xa89884 : 0xb8a98f;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius, height, 12),
    toon(stone),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // Crenellations.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.24, 0.18),
      toon(king ? 0x8b7c69 : 0x9c8d74),
    );
    m.position.set(
      Math.cos(a) * radius * 0.85,
      height + 0.1,
      Math.sin(a) * radius * 0.85,
    );
    m.lookAt(0, height + 0.1, 0);
    m.castShadow = true;
    root.add(m);
  }

  // Door facing the enemy.
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), toon(0x4a3826));
  door.position.set(0, 0.35, (e.side === "player" ? -1 : 1) * radius * 0.97);
  root.add(door);

  // Team flag.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6),
    toon(0x5a4632),
  );
  pole.position.set(0, height + 0.5, 0);
  root.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.32),
    new THREE.MeshToonMaterial({ color: SIDE_COLOR[e.side], side: THREE.DoubleSide }),
  );
  flag.position.set(0.3, height + 0.72, 0);
  root.add(flag);

  const view: Partial<EntityView> & { root: THREE.Group } = { root, rig: null };

  if (king) {
    const crown = new THREE.Group();
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 0.26, 10),
      toon(0xfbbf24),
    );
    band.castShadow = true;
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), toon(0xfbbf24));
      spike.position.set(Math.cos(a) * 0.38, 0.22, Math.sin(a) * 0.38);
      crown.add(spike);
    }
    crown.position.y = height + 0.32;
    root.add(crown);
    const zzz = makeZzzSprite();
    zzz.position.y = height + 1.1;
    root.add(zzz);
    view.crown = crown;
    view.zzz = zzz;
  }

  const barWidth = king ? 2.2 : 1.8;
  const barY = height + (king ? 1.5 : 1.2);
  const bar = makeHpBar(barWidth, SIDE_COLOR[e.side], barY);
  root.add(bar.group);
  view.hpGroup = bar.group;
  view.hpFill = bar.fill;

  const hpText = makeHpText(barY + 0.45);
  root.add(hpText.sprite);
  view.hpText = hpText.text;

  view.flashMats = collectFlashMats(root);
  view.lastHp = e.hp;
  view.flashT = 0;
  view.spawnT = SPAWN_POP_TIME; // towers don't pop in
  view.isTroop = false;
  return view as EntityView;
}

function buildBuildingMesh(e: Entity): EntityView {
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

  const bar = makeHpBar(1.4, SIDE_COLOR[e.side], 1.15);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(1.7, 0.42, 1);
  label.position.y = 1.5;
  root.add(label);
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

function buildTroopMesh(e: Entity): EntityView {
  const rig = buildTroop(e.cardId!);
  const root = new THREE.Group();
  const scale = e.cardId === "giant" ? 1.0 : 0.95;
  rig.group.scale.setScalar(scale);
  root.add(rig.group);

  // Team ring on the ground.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(e.radius * 0.75, e.radius * 0.95, 24),
    new THREE.MeshBasicMaterial({
      color: SIDE_COLOR[e.side],
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  const lift = (rig.hover ?? 0) + rig.height * scale;
  const bar = makeHpBar(0.9, SIDE_COLOR[e.side], lift + 0.25);
  bar.group.visible = false; // shown once damaged
  root.add(bar.group);

  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(1.7, 0.42, 1);
  label.position.y = lift + 0.62;
  root.add(label);
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
  };
}

export class Battle3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly views = new Map<number, EntityView>();
  private effects: EffectView[] = [];
  private dying: DyingView[] = [];
  private readonly hoverDisc: THREE.Mesh;
  private readonly zonePlane: THREE.Mesh;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b2433);
    this.scene.fog = new THREE.Fog(0x1b2433, 45, 75);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    this.camera.position.set(0, 24, 27);
    this.camera.lookAt(0, 0, 1.5);

    this.buildLights();
    this.buildArena();

    this.hoverDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    this.hoverDisc.rotation.x = -Math.PI / 2;
    this.hoverDisc.position.y = 0.03;
    this.hoverDisc.visible = false;
    this.scene.add(this.hoverDisc);

    this.zonePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT / 2 - 1),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.13 }),
    );
    this.zonePlane.rotation.x = -Math.PI / 2;
    this.zonePlane.position.set(0, 0.025, ARENA_HEIGHT / 4 + 0.5);
    this.zonePlane.visible = false;
    this.scene.add(this.zonePlane);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a5f3c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.7);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 60;
    this.scene.add(sun);
  }

  private buildArena(): void {
    const halfD = ARENA_HEIGHT / 2;
    const mkHalf = (color: number, zCenter: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.4, halfD),
        toon(color),
      );
      m.position.set(0, -0.2, zCenter);
      m.receiveShadow = true;
      return m;
    };
    this.scene.add(mkHalf(0x4c9e4f, -halfD / 2), mkHalf(0x55a858, halfD / 2));

    for (const bx of BRIDGE_XS) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, ARENA_HEIGHT),
        new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.05 }),
      );
      stripe.rotation.x = -Math.PI / 2;
      const w = toWorld(bx, ARENA_HEIGHT / 2);
      stripe.position.set(w.x, 0.005, 0);
      stripe.receiveShadow = true;
      this.scene.add(stripe);
    }

    const river = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.22, 2.2),
      toon(0x3b82c4),
    );
    river.position.set(0, -0.04, 0);
    this.scene.add(river);

    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 2.6), toon(0x9a6b3f));
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.scene.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 2.6), toon(0x6e4a28));
        rail.position.set(w.x + side * 0.95, 0.3, 0);
        rail.castShadow = true;
        this.scene.add(rail);
      }
    }
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Convert a pointer event to arena tile coordinates, if on the field. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const ax = hit.x + ARENA_WIDTH / 2;
    const ay = hit.z + ARENA_HEIGHT / 2;
    if (ax < 0 || ax > ARENA_WIDTH || ay < 0 || ay > ARENA_HEIGHT) return null;
    return { x: ax, y: ay };
  }

  setHover(pos: { x: number; y: number } | null, radiusTiles: number, spell: boolean): void {
    if (!pos) {
      this.hoverDisc.visible = false;
      return;
    }
    const w = toWorld(pos.x, pos.y);
    this.hoverDisc.visible = true;
    this.hoverDisc.position.set(w.x, 0.03, w.z);
    this.hoverDisc.scale.setScalar(radiusTiles / 0.6);
    (this.hoverDisc.material as THREE.MeshBasicMaterial).color.set(
      spell ? 0xff8c1a : 0xffffff,
    );
  }

  setZoneVisible(visible: boolean): void {
    this.zonePlane.visible = visible;
  }

  private addEffect(
    obj: THREE.Object3D,
    ttl: number,
    update: (frac: number) => void,
    delay = 0,
  ): void {
    if (delay > 0) obj.visible = false;
    this.scene.add(obj);
    this.effects.push({ obj, ttl, ttl0: ttl, delay, update });
  }

  private blast(ax: number, ay: number, radius: number, color: number, delay = 0): void {
    const w = toWorld(ax, ay);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    ball.position.set(w.x, 0.4, w.z);
    this.addEffect(
      ball,
      0.5,
      (frac) => {
        ball.scale.setScalar(0.3 + (1 - frac) * radius);
        (ball.material as THREE.MeshBasicMaterial).opacity = 0.55 * frac;
      },
      delay,
    );
    // Expanding ground ring for readability.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(w.x, 0.04, w.z);
    this.addEffect(
      ring,
      0.45,
      (frac) => {
        ring.scale.setScalar(0.3 + (1 - frac) * radius * 1.15);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * frac;
      },
      delay,
    );
  }

  private puff(ax: number, ay: number, color: number, size = 0.5): void {
    const w = toWorld(ax, ay);
    const group = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.16 * size + 0.05 * i, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
      );
      s.position.set((i % 2 ? 1 : -1) * 0.15 * i, 0.2 + 0.12 * i, (i > 1 ? 1 : -1) * 0.12);
      group.add(s);
    }
    group.position.set(w.x, 0.1, w.z);
    this.addEffect(group, 0.45, (frac) => {
      group.scale.setScalar(1 + (1 - frac) * 1.6);
      group.position.y = 0.1 + (1 - frac) * 0.5;
      for (const child of group.children) {
        ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * frac;
      }
    });
  }

  /** A small arrow-shaped missile oriented along its flight path. */
  private makeArrow(color: number, length = 0.5): THREE.Group {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, length, 6),
      new THREE.MeshBasicMaterial({ color }),
    );
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.12, 6),
      new THREE.MeshBasicMaterial({ color: 0x9aa3ad }),
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = length / 2;
    g.add(tip);
    return g;
  }

  /** A projectile streaking from attacker to target. */
  private projectile(ev: Extract<BattleEvent, { type: "attack" }>): void {
    const from = toWorld(ev.x, ev.y);
    const to = toWorld(ev.targetX, ev.targetY);
    const y0 = ev.kind === "troop" ? 0.9 : 1.6;
    const y1 = 0.7;

    const isArrow = ev.cardId === "archers" || ev.kind !== "troop";
    let obj: THREE.Object3D;
    let arc = 0.4;
    if (isArrow) {
      obj = this.makeArrow(ev.kind !== "troop" ? 0xffe082 : 0xd7ccc8);
      arc = 0.8;
    } else {
      const style =
        ev.cardId === "wizard"
          ? { color: 0xff8c1a, size: 0.16, glow: true }
          : ev.cardId === "baby-dragon"
            ? { color: 0x8bc34a, size: 0.15, glow: true }
            : ev.cardId === "cannon"
              ? { color: 0x263238, size: 0.15 }
              : { color: 0x37474f, size: 0.08 }; // musket ball
      const mat = style.glow
        ? new THREE.MeshStandardMaterial({
            color: style.color,
            emissive: style.color,
            emissiveIntensity: 1.5,
          })
        : new THREE.MeshBasicMaterial({ color: style.color });
      obj = new THREE.Mesh(new THREE.SphereGeometry(style.size, 8, 6), mat);
      arc = ev.cardId === "cannon" ? 0.8 : 0.25;
    }

    obj.position.set(from.x, y0, from.z);
    obj.lookAt(to.x, y1, to.z);
    const duration = isArrow ? 0.22 : 0.16;
    this.addEffect(obj, duration, (frac) => {
      const t = 1 - frac;
      obj.position.set(
        from.x + (to.x - from.x) * t,
        y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * arc,
        from.z + (to.z - from.z) * t,
      );
    });
  }

  /** Fireball: a flaming meteor crashes down, then explodes. */
  private fireballStrike(ax: number, ay: number): void {
    const w = toWorld(ax, ay);
    const start = { x: w.x + 1.5, y: 8, z: w.z - 4 };
    const meteor = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffb300,
        emissive: 0xff6a00,
        emissiveIntensity: 2,
      }),
    );
    meteor.add(core);
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.4, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.7 }),
    );
    tail.position.set(0.25, 0.8, -0.7);
    tail.rotation.x = -0.5;
    meteor.add(tail);
    const FALL = 0.32;
    this.addEffect(meteor, FALL, (frac) => {
      const t = 1 - frac;
      meteor.position.set(
        start.x + (w.x - start.x) * t,
        start.y + (0.3 - start.y) * t,
        start.z + (w.z - start.z) * t,
      );
    });
    this.blast(ax, ay, 2.5, 0xff7814, FALL);
  }

  /** Arrows: a volley rains down across the radius, then a ring pop. */
  private arrowVolley(ax: number, ay: number, radius: number): void {
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + (i % 3) * 0.4;
      const r = radius * (0.25 + 0.7 * ((i * 37) % 10) * 0.1);
      const ox = Math.cos(angle) * r;
      const oz = Math.sin(angle) * r;
      const w = toWorld(ax, ay);
      const arrow = this.makeArrow(0xd7ccc8, 0.45);
      const x = w.x + ox;
      const z = w.z + oz;
      const y0 = 6 + (i % 4) * 0.5;
      arrow.position.set(x + 0.6, y0, z - 1.2);
      arrow.lookAt(x, 0.05, z);
      this.addEffect(
        arrow,
        0.3,
        (frac) => {
          const t = 1 - frac;
          arrow.position.set(x + 0.6 * (1 - t), y0 * (1 - t) + 0.05 * t, z - 1.2 * (1 - t));
        },
        i * 0.035,
      );
    }
    this.blast(ax, ay, radius, 0xdce6ff, 0.32);
  }

  /** Visual reactions to gameplay events. */
  onEvent(ev: BattleEvent): void {
    switch (ev.type) {
      case "spell":
        if (ev.cardId === "fireball") this.fireballStrike(ev.x, ev.y);
        else this.arrowVolley(ev.x, ev.y, 4);
        break;
      case "attack":
        if (ev.ranged) this.projectile(ev);
        break;
      case "death":
        if (ev.kind === "troop") this.puff(ev.x, ev.y, 0xcccccc, 0.5);
        else this.puff(ev.x, ev.y, 0x8b7c69, 1.6);
        break;
      default:
        break;
    }
  }

  /** Start the topple/sink-and-fade animation for a removed entity. */
  private beginDeath(view: EntityView): void {
    const fadeMats: DyingView["fadeMats"] = [];
    view.root.traverse((o) => {
      const sprite = o as THREE.Sprite;
      if (sprite.isSprite) {
        // Label materials are shared between units — hide, don't fade.
        sprite.visible = false;
        return;
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material & { opacity: number };
        mat.transparent = true;
        fadeMats.push(mat);
      }
    });
    this.dying.push({
      view,
      t: 0,
      duration: view.isTroop ? TROOP_DEATH_TIME : TOWER_DEATH_TIME,
      topple: view.isTroop ? (view.root.position.x > 0 ? 1.35 : -1.35) : 0.12,
      fadeMats,
    });
  }

  /** Create/update/remove meshes to mirror the battle state. */
  sync(state: BattleState, dt: number): void {
    const seen = new Set<number>();
    for (const e of state.entities) {
      seen.add(e.id);
      let view = this.views.get(e.id);
      if (!view) {
        view =
          e.kind === "troop"
            ? buildTroopMesh(e)
            : e.kind === "building"
              ? buildBuildingMesh(e)
              : buildTowerMesh(e);
        this.views.set(e.id, view);
        this.scene.add(view.root);
      }
      const w = toWorld(e.x, e.y);
      view.root.position.x = w.x;
      view.root.position.z = w.z;

      // Spawn pop-in.
      if (view.spawnT < SPAWN_POP_TIME) {
        view.spawnT += dt;
        const k = easeOutBack(Math.min(1, view.spawnT / SPAWN_POP_TIME));
        view.root.scale.setScalar(Math.max(0.05, k));
      } else if (view.root.scale.x !== 1) {
        view.root.scale.setScalar(1);
      }

      // Damage flash.
      if (e.hp < view.lastHp - 0.5) view.flashT = FLASH_TIME;
      view.lastHp = e.hp;
      if (view.flashT > 0) {
        view.flashT = Math.max(0, view.flashT - dt);
        const k = view.flashT / FLASH_TIME;
        for (const f of view.flashMats) f.mat.emissive.setRGB(k, k, k);
      } else if (view.flashMats.length > 0 && view.flashT === 0) {
        for (const f of view.flashMats) f.mat.emissive.setHex(f.orig);
      }

      if (view.barrel) {
        const target = state.entities.find((o) => o.id === e.targetId);
        if (target) {
          const tw = toWorld(target.x, target.y);
          view.barrel.rotation.y = Math.atan2(tw.x - w.x, tw.z - w.z);
        }
      }

      const barWidth =
        e.kind === "troop" ? 0.9 : e.kind === "building" ? 1.4 : e.kind === "king-tower" ? 2.2 : 1.8;
      setHpFill(view, e.hp / e.maxHp, barWidth);
      if (e.kind === "troop" && e.hp < e.maxHp) view.hpGroup.visible = true;
      if (view.hpText) updateHpText(view.hpText, e.hp);
      if (view.crown) view.crown.visible = e.active;
      if (view.zzz) view.zzz.visible = !e.active;

      if (view.rig) {
        const target = state.entities.find((o) => o.id === e.targetId);
        const inRange =
          !!target &&
          distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
        const swing =
          e.cooldown > e.hitSpeed - 0.3 ? (e.cooldown - (e.hitSpeed - 0.3)) / 0.3 : 0;
        animateTroop(view.rig, {
          moving: !inRange && e.deployTimer <= 0,
          swing,
          time: state.time,
          phase: e.id * 1.7,
        });
        // Face the attack target, or the spot being walked toward —
        // turning smoothly rather than snapping.
        let targetYaw: number | null = null;
        if (target) {
          const goal = inRange ? target : moveGoal(e, target);
          const gw = toWorld(goal.x, goal.y);
          if (Math.hypot(gw.x - w.x, gw.z - w.z) > 1e-3) {
            targetYaw = Math.atan2(gw.x - w.x, gw.z - w.z);
          }
        } else {
          targetYaw = e.side === "player" ? Math.PI : 0;
        }
        if (targetYaw !== null) {
          const cur = view.root.rotation.y;
          let delta = targetYaw - cur;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          view.root.rotation.y = cur + delta * Math.min(1, dt * 10);
        }
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.views.delete(id);
        this.beginDeath(view);
      }
    }
  }

  render(dt: number): void {
    this.effects = this.effects.filter((f) => {
      if (f.delay > 0) {
        f.delay -= dt;
        if (f.delay > 0) return true;
        f.obj.visible = true;
      }
      f.ttl -= dt;
      if (f.ttl <= 0) {
        this.scene.remove(f.obj);
        return false;
      }
      f.update(f.ttl / f.ttl0);
      return true;
    });

    this.dying = this.dying.filter((d) => {
      d.t += dt;
      const f = Math.min(1, d.t / d.duration);
      if (f >= 1) {
        this.scene.remove(d.view.root);
        return false;
      }
      const ease = f * f;
      d.view.root.rotation.z = d.topple * ease;
      d.view.root.position.y = d.view.isTroop ? -0.3 * ease : -1.6 * ease;
      for (const mat of d.fadeMats) mat.opacity = 1 - f;
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }

  /** Remove every entity mesh (used on battle restart). */
  reset(): void {
    for (const view of this.views.values()) this.scene.remove(view.root);
    this.views.clear();
    for (const f of this.effects) this.scene.remove(f.obj);
    this.effects = [];
    for (const d of this.dying) this.scene.remove(d.view.root);
    this.dying = [];
  }
}
