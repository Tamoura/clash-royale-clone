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
import { animateTroop, buildTroop, type TroopRig } from "./characters3d";

/** Arena tiles → world units: x centered, arena y becomes world z. */
function toWorld(ax: number, ay: number): { x: number; z: number } {
  return { x: ax - ARENA_WIDTH / 2, z: ay - ARENA_HEIGHT / 2 };
}

const SIDE_COLOR: Record<Side, number> = { player: 0x3b82f6, enemy: 0xef4444 };

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

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
}

interface HpText {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: number;
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

interface EffectView {
  obj: THREE.Object3D;
  ttl: number;
  ttl0: number;
  update: (frac: number) => void;
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

function buildTowerMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  const king = e.kind === "king-tower";
  const radius = king ? 1.15 : 0.85;
  const height = king ? 2.0 : 1.55;
  const stone = king ? 0xa89884 : 0xb8a98f;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius, height, 12),
    lambert(stone),
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
      lambert(king ? 0x8b7c69 : 0x9c8d74),
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
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.1),
    lambert(0x4a3826),
  );
  door.position.set(0, 0.35, (e.side === "player" ? -1 : 1) * radius * 0.97);
  root.add(door);

  // Team flag.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6),
    lambert(0x5a4632),
  );
  pole.position.set(0, height + 0.5, 0);
  root.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.32),
    new THREE.MeshLambertMaterial({
      color: SIDE_COLOR[e.side],
      side: THREE.DoubleSide,
    }),
  );
  flag.position.set(0.3, height + 0.72, 0);
  root.add(flag);

  const view: Partial<EntityView> & { root: THREE.Group } = { root, rig: null };

  if (king) {
    // Gold crown, hidden while the king sleeps.
    const crown = new THREE.Group();
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 0.26, 10),
      lambert(0xfbbf24),
    );
    band.castShadow = true;
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.22, 6),
        lambert(0xfbbf24),
      );
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

  // Live hit-point readout above the bar.
  const hpText = makeHpText(barY + 0.45);
  root.add(hpText.sprite);
  view.hpText = hpText.text;
  return view as EntityView;
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

  // Flyers carry their bar/label up at hover height.
  const lift = (rig.hover ?? 0) + rig.height * scale;
  const bar = makeHpBar(0.9, SIDE_COLOR[e.side], lift + 0.25);
  bar.group.visible = false; // shown once damaged
  root.add(bar.group);

  // Name floating above the character (above the HP bar).
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(1.7, 0.42, 1);
  label.position.y = lift + 0.62;
  root.add(label);
  return { root, rig, hpGroup: bar.group, hpFill: bar.fill };
}

function buildBuildingMesh(e: Entity): EntityView {
  const root = new THREE.Group();
  // Wooden platform.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.78, 0.25, 10),
    lambert(0x8d6e63),
  );
  base.position.y = 0.12;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12),
      lambert(0x4e342e),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.62, 0.22, 0);
    wheel.castShadow = true;
    root.add(wheel);
  }
  // Barrel on a pivot so it can aim.
  const barrel = new THREE.Group();
  barrel.position.y = 0.5;
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12),
    lambert(0x37474f),
  );
  tube.rotation.x = Math.PI / 2 - 0.18; // slight upward tilt
  tube.position.z = 0.25;
  tube.castShadow = true;
  barrel.add(tube);
  const breech = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    lambert(0x263238),
  );
  breech.castShadow = true;
  barrel.add(breech);
  root.add(barrel);

  const bar = makeHpBar(1.4, SIDE_COLOR[e.side], 1.15);
  root.add(bar.group);
  const label = new THREE.Sprite(nameSpriteMaterial(e.cardId!, e.side));
  label.scale.set(1.7, 0.42, 1);
  label.position.y = 1.5;
  root.add(label);
  return { root, rig: null, hpGroup: bar.group, hpFill: bar.fill, barrel };
}

export class Battle3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly views = new Map<number, EntityView>();
  private effects: EffectView[] = [];
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
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    );
    this.hoverDisc.rotation.x = -Math.PI / 2;
    this.hoverDisc.position.y = 0.03;
    this.hoverDisc.visible = false;
    this.scene.add(this.hoverDisc);

    this.zonePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT / 2 - 1),
      new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.13,
      }),
    );
    this.zonePlane.rotation.x = -Math.PI / 2;
    this.zonePlane.position.set(0, 0.025, ARENA_HEIGHT / 4 + 0.5);
    this.zonePlane.visible = false;
    this.scene.add(this.zonePlane);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a5f3c, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
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
        lambert(color),
      );
      m.position.set(0, -0.2, zCenter);
      m.receiveShadow = true;
      return m;
    };
    this.scene.add(mkHalf(0x4c9e4f, -halfD / 2), mkHalf(0x55a858, halfD / 2));

    // Lane stripes for a bit of texture.
    for (const bx of BRIDGE_XS) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, ARENA_HEIGHT),
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.05,
        }),
      );
      stripe.rotation.x = -Math.PI / 2;
      const w = toWorld(bx, ARENA_HEIGHT / 2);
      stripe.position.set(w.x, 0.005, 0);
      stripe.receiveShadow = true;
      this.scene.add(stripe);
    }

    // River channel.
    const river = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_WIDTH + 0.6, 0.22, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x3b82c4 }),
    );
    river.position.set(0, -0.04, 0);
    this.scene.add(river);

    // Bridges.
    for (const bx of BRIDGE_XS) {
      const w = toWorld(bx, RIVER_Y);
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.18, 2.6),
        lambert(0x9a6b3f),
      );
      deck.position.set(w.x, 0.1, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.scene.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.3, 2.6),
          lambert(0x6e4a28),
        );
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
  ): void {
    this.scene.add(obj);
    this.effects.push({ obj, ttl, ttl0: ttl, update });
  }

  private blast(ax: number, ay: number, radius: number, color: number): void {
    const w = toWorld(ax, ay);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    ball.position.set(w.x, 0.4, w.z);
    this.addEffect(ball, 0.5, (frac) => {
      ball.scale.setScalar(0.3 + (1 - frac) * radius);
      (ball.material as THREE.MeshBasicMaterial).opacity = 0.55 * frac;
    });
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

  /** A small projectile streaking from attacker to target. */
  private projectile(ev: Extract<BattleEvent, { type: "attack" }>): void {
    const from = toWorld(ev.x, ev.y);
    const to = toWorld(ev.targetX, ev.targetY);
    const style: { color: number; size: number; glow?: boolean } =
      ev.cardId === "wizard"
        ? { color: 0xff8c1a, size: 0.16, glow: true }
        : ev.cardId === "baby-dragon"
          ? { color: 0x8bc34a, size: 0.15, glow: true }
          : ev.cardId === "cannon"
            ? { color: 0x263238, size: 0.14 }
            : ev.kind !== "troop"
              ? { color: 0xffe082, size: 0.1 }
              : { color: 0xd7ccc8, size: 0.07 };
    const mat = style.glow
      ? new THREE.MeshStandardMaterial({
          color: style.color,
          emissive: style.color,
          emissiveIntensity: 1.5,
        })
      : new THREE.MeshBasicMaterial({ color: style.color });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(style.size, 8, 6), mat);
    const y0 = ev.kind === "troop" ? 0.9 : 1.6;
    ball.position.set(from.x, y0, from.z);
    this.addEffect(ball, 0.16, (frac) => {
      const t = 1 - frac;
      ball.position.set(
        from.x + (to.x - from.x) * t,
        y0 + (0.7 - y0) * t,
        from.z + (to.z - from.z) * t,
      );
    });
  }

  /** Visual reactions to gameplay events. */
  onEvent(ev: BattleEvent): void {
    switch (ev.type) {
      case "spell":
        this.blast(ev.x, ev.y, ev.cardId === "fireball" ? 2.5 : 4, ev.cardId === "fireball" ? 0xff7814 : 0xdce6ff);
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

  /** Create/update/remove meshes to mirror the battle state. */
  sync(state: BattleState): void {
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

      // Aim the cannon barrel at its target.
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
          moving: !inRange,
          swing,
          time: state.time,
          phase: e.id * 1.7,
        });
        // Face the attack target, or the spot being walked toward
        // (which may be a bridge waypoint, not the target itself).
        if (target) {
          const goal = inRange ? target : moveGoal(e, target);
          const gw = toWorld(goal.x, goal.y);
          if (Math.hypot(gw.x - w.x, gw.z - w.z) > 1e-3) {
            view.root.rotation.y = Math.atan2(gw.x - w.x, gw.z - w.z);
          }
        } else {
          view.root.rotation.y = e.side === "player" ? Math.PI : 0;
        }
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(view.root);
        this.views.delete(id);
      }
    }
  }

  render(dt: number): void {
    this.effects = this.effects.filter((f) => {
      f.ttl -= dt;
      if (f.ttl <= 0) {
        this.scene.remove(f.obj);
        return false;
      }
      f.update(f.ttl / f.ttl0);
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
  }
}
