/**
 * Rig baking: a hand-built troop is 20-80 little meshes (a Knight was 83,
 * each with its own outline hull), which is where a busy fight's draw calls
 * went. bakeRig() folds every part that never moves relative to its
 * animated node (root, arms, legs, wings, the head, anything the idle
 * quirks drive) into ONE vertex-coloured mesh per node, plus one outline
 * mesh per node, and merges the mirrored face parts of a node so a whole
 * unit lands at 14 meshes or fewer (MESH_BUDGET, outline hulls aside).
 *
 * What stays a separate mesh, on purpose:
 *  - `team` parts (the teamPalette repaint targets them), merged per node
 *    into one mesh that keeps name "team": userData.team is "main", "dark" or
 *    "both" (the dark parts then read the material's teamDark colour);
 *  - the face (eye, brow, mouth): blinks, squints, brows and KO eyes drive
 *    them by name. The sclera, its dark rim and the pupils become one "eye"
 *    mesh that scales about the shared eye line, so a blink looks the same
 *    (a knocked-out unit keeps its pupils under the X eyes). Brows and mouth
 *    are recoloured in place;
 *  - `orb`, anything with userData.noBake, hidden, transparent, emissive or
 *    double-sided parts, and any mesh whose material the animation drives.
 *
 * Which nodes animate is not guessed: the rig is posed through animateTroop
 * in a handful of walk/attack poses and every object that moved, scaled,
 * toggled or changed material is an audit hit (this is how extras callbacks
 * are covered: whatever they drive is found, not listed by hand). When a
 * rig has more nodes than the budget allows, the nodes that move least
 * (a tail flick, an ear, the head's stun wobble) fold into their parent
 * first; their motion is a pixel or two at battle zoom.
 *
 * The audit result and the merged geometry are cached per card and edition
 * (the geometry holds no team colour, so the side and palette share it) and
 * shared by reference (userData.shared) between every unit of the card.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { weldVertices } from "./weld";
import { DEFAULT_ARCHETYPE, archetypeFor } from "./anim/archetypes";
import { type AnimateOpts, GRAINLESS_UV, animateTroop, bakedToon, buildTroop, teamToon, unitBakedToon, type TroopRig } from "./characters3d";
import { OUTLINE_MIN_RADIUS, ensureOutlineNormals, fitInk, outlineHull } from "./outlineMaterial";
import { bake as bakeWorld } from "./staticBatch";
import { ARABIC } from "./theme";
import { TEAM_MESH } from "./teamColors";
import { type CardId, getCard } from "../game/cards";

/** Names that never fold into a node's baked mesh. */
const FACE_NAMES = new Set(["eye", "eyerim", "pupil", "brow", "mouth", "xeyes"]);
const KEEP_NAMES = new Set([TEAM_MESH, "orb", "ice", "outline", ...FACE_NAMES]);

/** Mesh budget a baked troop must fit (outline hulls not counted). */
export const MESH_BUDGET = 14;
/**
 * Small units (body radius at most SMALL_RADIUS: skeletons, bats, minions)
 * are a few pixels tall at battle zoom, where a blink or a brow is under a
 * pixel yet five face meshes cost five draws each. Their face parts bake in
 * static, so they lose the blink, brow and mouth animation (and, with no face
 * to find, shatter when they die instead of falling over).
 */
export const SMALL_RADIUS = 0.32;
/** Cards that field this many units at once (the Skeleton Army's fifteen) also bake to SWARM_BUDGET meshes. */
export const SWARM_COUNT = 6;
export const SWARM_BUDGET = 5;
/** Radians the stun daze rolls the head by (see views/animate.ts). */
const HEAD_WOBBLE = 0.2;
/** Nodes that travel farther than this (rig units, about 9 px) never fold away. */
const FOLD_REACH_MAX = 0.45;

const EPS = 1e-6;

/** What a bake did, for tests and the perf tools. */
export interface BakeStats {
  baked: boolean;
  /** Meshes before and after, outline hulls included. */
  before: number;
  after: number;
  /** Meshes after, outline hulls excluded (what MESH_BUDGET limits). */
  parts: number;
  /** Animated nodes that kept their own mesh (root included). */
  nodes: number;
  /** Nodes folded into their parent to fit the budget. */
  folded: number;
}

// ---------------------------------------------------------------------------
// Audit: which objects animate, and by how much?
// ---------------------------------------------------------------------------

type MatLike = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };

/** Transform + visibility. */
function snapshot(o: THREE.Object3D): number[] {
  return [
    o.position.x, o.position.y, o.position.z,
    o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w,
    o.scale.x, o.scale.y, o.scale.z,
    o.visible ? 1 : 0,
  ];
}

/** The material values a flicker would drive. */
function materialSnapshot(o: THREE.Object3D): number[] {
  const m = (o as THREE.Mesh).material as MatLike | MatLike[] | undefined;
  if (!m || Array.isArray(m)) return [];
  const c = m.color;
  const e = m.emissive;
  return [c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, e?.r ?? 0, e?.g ?? 0, e?.b ?? 0, m.emissiveIntensity ?? 0, m.opacity];
}

function differs(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return true;
  return false;
}

interface Audit {
  /** Traversal indices of objects whose transform or visibility changes. */
  moving: number[];
  /** Traversal indices of meshes whose material values change. */
  glowing: number[];
  /** How far (rig units) the farthest point under a moving object travels between poses. */
  reach: Record<number, number>;
  /** Each moving object's transform in every audit pose (see snapshot). */
  poses: Record<number, number[][]>;
}

function posesFor(style: AnimateOpts["style"]): AnimateOpts[] {
  const base = { phase: 0.2, style };
  return [
    { ...base, moving: false, swing: 0, time: 0.31 },
    { ...base, moving: true, swing: 0, time: 1.07, stride: 0.9 },
    { ...base, moving: true, swing: 0, time: 2.2, stride: 2.4 },
    { ...base, moving: false, swing: -0.7, time: 3.4 },
    { ...base, moving: false, swing: 1, time: 4.1 },
    { ...base, moving: false, swing: 0, time: 5.3, ready: 1 },
  ];
}

const BOX = new THREE.Box3();

/** Corners of the subtree's bounding box in the node's own frame (rest pose). */
function localCorners(node: THREE.Object3D): THREE.Vector3[] {
  BOX.makeEmpty();
  BOX.setFromObject(node);
  if (BOX.isEmpty()) return [];
  const inv = node.matrixWorld.clone().invert();
  const out: THREE.Vector3[] = [];
  for (const x of [BOX.min.x, BOX.max.x]) {
    for (const y of [BOX.min.y, BOX.max.y]) {
      for (const z of [BOX.min.z, BOX.max.z]) out.push(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    }
  }
  return out;
}

/** Farthest distance from a node's pivot to anything under it. */
function extentOf(node: THREE.Object3D): number {
  let r = 0;
  for (const c of localCorners(node)) r = Math.max(r, c.length());
  return r;
}

/**
 * Pose the rig a few ways and report every object that changed between
 * poses. The rig is put back exactly as found.
 */
function auditRig(rig: TroopRig, list: THREE.Object3D[], arch: ReturnType<typeof archetypeFor>): Audit {
  const rest = list.map((o) => ({ t: snapshot(o), m: materialSnapshot(o) }));
  const hadRestScale = "restScale" in rig.group.userData;
  const frames: { t: number[]; m: number[] }[][] = [];
  for (const pose of posesFor(arch.attackStyle)) {
    animateTroop(rig, { ...pose, weight: arch.weight, quad: arch.quad });
    frames.push(list.map((o) => ({ t: snapshot(o), m: materialSnapshot(o) })));
  }
  const moving: number[] = [];
  const glowing: number[] = [];
  const reach: Record<number, number> = {};
  const poses: Record<number, number[][]> = {};
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const ma = new THREE.Matrix4();
  const mb = new THREE.Matrix4();
  const compose = (m: THREE.Matrix4, t: number[]): void => {
    m.compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(t[3], t[4], t[5], t[6]), new THREE.Vector3(t[7], t[8], t[9]));
  };
  for (let i = 0; i < list.length; i++) {
    let moved = false;
    for (let f = 1; f < frames.length; f++) {
      if (differs(frames[0][i].t, frames[f][i].t)) moved = true;
      if (differs(frames[0][i].m, frames[f][i].m)) {
        glowing.push(i);
        break;
      }
    }
    if (!moved) continue;
    moving.push(i);
    poses[i] = frames.map((fr) => fr[i].t);
    const corners = localCorners(list[i]);
    let best = 0;
    for (let f = 0; f < frames.length; f++) {
      for (let g = f + 1; g < frames.length; g++) {
        compose(ma, frames[f][i].t);
        compose(mb, frames[g][i].t);
        for (const c of corners) {
          pa.copy(c).applyMatrix4(ma);
          pb.copy(c).applyMatrix4(mb);
          best = Math.max(best, pa.distanceTo(pb));
        }
      }
    }
    reach[i] = best;
  }
  // Put everything back: transforms, visibility, material values.
  list.forEach((o, i) => {
    const s = rest[i].t;
    o.position.set(s[0], s[1], s[2]);
    o.quaternion.set(s[3], s[4], s[5], s[6]);
    o.scale.set(s[7], s[8], s[9]);
    o.visible = s[10] === 1;
    const m = (o as THREE.Mesh).material as MatLike | MatLike[] | undefined;
    if (m && !Array.isArray(m) && rest[i].m.length) {
      const v = rest[i].m;
      m.color?.setRGB(v[0], v[1], v[2]);
      m.emissive?.setRGB(v[3], v[4], v[5]);
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = v[6];
      m.opacity = v[7];
    }
  });
  // animateTroop remembers the scale it first saw; the real one is set later.
  if (!hadRestScale) delete (rig.group.userData as { restScale?: number }).restScale;
  return { moving, glowing, reach, poses };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * team: merged per node. face: eye/rim/pupil merge into one, brow and
 * mouth recolour in place. toon/basic: fold into the node's mesh (or, for a
 * node mesh, into itself). solo: stays a mesh, recoloured onto a shared
 * material. keep: untouched.
 */
type Kind = "toon" | "basic" | "team" | "face" | "solo" | "keep";

function isMeshObj(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function plainMesh(m: THREE.Mesh): boolean {
  return (
    !(m as THREE.InstancedMesh).isInstancedMesh &&
    !(m as THREE.SkinnedMesh).isSkinnedMesh &&
    !Array.isArray(m.material) &&
    !!m.geometry.attributes.position &&
    !m.geometry.morphAttributes.position &&
    m.renderOrder === 0 &&
    m.frustumCulled
  );
}

/** A toon material the baked material can stand in for (colour aside). */
function toonBakeable(mat: THREE.Material): boolean {
  const t = mat as THREE.MeshToonMaterial;
  if (!t.isMeshToonMaterial) return false;
  const base = bakedToon();
  return (
    !t.transparent &&
    t.opacity === 1 &&
    t.side === THREE.FrontSide &&
    t.alphaTest === 0 &&
    t.emissive.getHex() === 0 &&
    !t.vertexColors &&
    !t.wireframe &&
    !t.alphaMap &&
    t.fog &&
    t.depthWrite &&
    t.depthTest &&
    t.gradientMap === base.gradientMap &&
    (t.map === null || t.map === base.map)
  );
}

function basicBakeable(mat: THREE.Material): boolean {
  const b = mat as THREE.MeshBasicMaterial;
  return (
    b.isMeshBasicMaterial === true &&
    !b.transparent &&
    b.opacity === 1 &&
    b.side === THREE.FrontSide &&
    b.alphaTest === 0 &&
    !b.map &&
    !b.alphaMap &&
    !b.vertexColors &&
    !b.wireframe &&
    b.fog &&
    b.depthWrite &&
    b.depthTest
  );
}

// Shared glow material (vertex coloured MeshBasic), one per tone-mapping flag.
const basicShared = new Map<boolean, THREE.MeshBasicMaterial>();

function sharedBasic(toneMapped: boolean): THREE.MeshBasicMaterial {
  let m = basicShared.get(toneMapped);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    m.toneMapped = toneMapped;
    m.userData.shared = true;
    basicShared.set(toneMapped, m);
  }
  return m;
}

/** The toon-boosted skin tone toon() turns the builders' SKIN into (see anim/face). */
const SKIN_HEX = ((): number => {
  const c = new THREE.Color(0xf6c9a0);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l);
  return c.getHex();
})();

// ---------------------------------------------------------------------------
// Geometry products (cached per card + edition)
// ---------------------------------------------------------------------------

interface EyeSpot {
  x: number;
  z: number;
  r: number;
}

interface Plan {
  sig: string;
  audit: Audit;
  geos: Map<string, THREE.BufferGeometry>;
  meta: Map<string, { spots: EyeSpot[] }>;
}

const plans = new Map<string, Plan>();

/** Forget cached bakes (tests; a redesigned champion). */
export function clearBakeCache(): void {
  for (const p of plans.values()) for (const g of p.geos.values()) g.dispose();
  plans.clear();
}

/** Cached geometries held, for the dispose test. */
export function bakeCacheSize(): number {
  let n = 0;
  for (const p of plans.values()) n += p.geos.size;
  return n;
}

function planKey(key: string): string {
  // `${cardId}:${side}:${edition}:${teamPalette}`: baked geometry carries
  // no team colour, so only the card and edition shape it.
  const [card, , edition] = key.split(":");
  return `${card}:${edition ?? (ARABIC ? "arabic" : "normal")}`;
}

function cardOf(key: string): CardId | null {
  const id = key.split(":")[0];
  return id ? (id as CardId) : null;
}

/** How light this key bakes: small bodies (and tower crews) get static faces, swarms also a tighter budget. */
function lodOf(key: string): { small: boolean; swarm: boolean } {
  const id = cardOf(key);
  // Tower crews are only ever posed by animateTroop; nothing blinks or knits
  // their brows, so their faces can bake in static at no loss at all.
  if (id?.startsWith("tower-")) return { small: true, swarm: false };
  if (!id) return { small: false, swarm: false };
  try {
    const card = getCard(id);
    if (card.kind !== "troop") return { small: false, swarm: false };
    return { small: card.unit.radius <= SMALL_RADIUS, swarm: card.count >= SWARM_COUNT };
  } catch {
    return { small: false, swarm: false };
  }
}

/** The archetype the views will pose this rig with (tower crews run the default). */
function archetypeOfKey(key: string): ReturnType<typeof archetypeFor> {
  const id = cardOf(key);
  return !id || id.startsWith("tower-") ? DEFAULT_ARCHETYPE : archetypeFor(id, { arabic: ARABIC });
}

/** staticBatch's world bake, minus an outline direction some shared geometry picked up. */
function bake(mesh: THREE.Mesh, toRoot: THREE.Matrix4, tint = false): THREE.BufferGeometry {
  const g = bakeWorld(mesh, toRoot, tint);
  g.deleteAttribute("outlineNormal");
  return g;
}

/** Merge, weld shared vertices and mark shared. */
function finish(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return null;
  const welded = weldVertices(merged);
  merged.dispose();
  welded.computeBoundingSphere();
  welded.computeBoundingBox();
  welded.userData.shared = true;
  return welded;
}

/**
 * A node's outline as one welded hull geometry (position, normal and the
 * smoothed outlineNormal), from every static part big enough to read.
 */
function hullGeometry(parts: THREE.Mesh[], inv: THREE.Matrix4): THREE.BufferGeometry | null {
  const gs: THREE.BufferGeometry[] = [];
  for (const m of parts) {
    const g = bake(m, inv, false);
    g.computeBoundingSphere();
    if ((g.boundingSphere?.radius ?? 0) < OUTLINE_MIN_RADIUS) {
      g.dispose();
      continue;
    }
    g.deleteAttribute("uv");
    gs.push(g);
  }
  const merged = finish(gs);
  return merged ? ensureOutlineNormals(merged) : null;
}

/**
 * Ink triangles for a baked body: the hull wound inside-out (so a front-face
 * material draws what a back-face one would), coloured ink, carrying the
 * outlineNormal that tells the shader to extrude them. Body vertices get a
 * zero outlineNormal. Returns one geometry holding both.
 */
function withInk(
  body: THREE.BufferGeometry,
  hull: THREE.BufferGeometry | null,
  coloured = true,
  prepare?: (hull: THREE.BufferGeometry) => void,
): THREE.BufferGeometry {
  const n = body.getAttribute("position").count;
  body.setAttribute("outlineNormal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  if (!hull) return body;
  const h = hull.clone();
  const count = h.getAttribute("position").count;
  const idx = h.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  if (coloured) h.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uv = new Float32Array(count * 2).fill(GRAINLESS_UV);
  h.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  prepare?.(h);
  const merged = mergeGeometries([body, h], false);
  body.dispose();
  h.dispose();
  if (!merged) throw new Error("ink merge failed");
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  merged.userData.shared = true;
  return merged;
}

/** Point every vertex's UV at the grain map's white texel (no grain). */
function grainless(g: THREE.BufferGeometry): void {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, GRAINLESS_UV, GRAINLESS_UV);
}

/** A coloured copy of a mesh's own geometry in its own frame (brow, mouth, glow). */
function localColoured(mesh: THREE.Mesh, flat: boolean): THREE.BufferGeometry {
  const g = bake(mesh, mesh.matrixWorld.clone().invert(), true);
  if (flat) grainless(g);
  const out = weldVertices(g);
  g.dispose();
  out.computeBoundingSphere();
  out.userData.shared = true;
  return out;
}

function posIn(node: THREE.Object3D, m: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld.clone().invert().multiply(m.matrixWorld));
}

// ---------------------------------------------------------------------------
// The bake
// ---------------------------------------------------------------------------

function nearestNode(
  o: THREE.Object3D,
  nodes: Set<THREE.Object3D>,
  twins: Map<THREE.Object3D, THREE.Object3D>,
): THREE.Object3D | null {
  for (let p = o.parent; p; p = p.parent) {
    if (nodes.has(p)) return p;
    const twin = twins.get(p);
    if (twin) return twin;
  }
  return null;
}

/**
 * Nodes that swing in lockstep about one shared axis (a mount's front legs,
 * mirrored about the body) can share a mesh exactly: same pivot height and
 * depth, identical rotation about x in every audit pose, same scale. The
 * second becomes a twin of the first and its parts bake into the first's
 * frame, offset sideways along the axis they both turn about.
 */
function findTwins(
  nodes: Set<THREE.Object3D>,
  audit: Audit,
  index: Map<THREE.Object3D, number>,
): Map<THREE.Object3D, THREE.Object3D> {
  const twins = new Map<THREE.Object3D, THREE.Object3D>();
  const cands = [...nodes].filter((n) => !isMeshObj(n) && audit.poses[index.get(n)!] && n.parent);
  for (let i = 0; i < cands.length; i++) {
    const a = cands[i];
    if (twins.has(a)) continue;
    for (let j = i + 1; j < cands.length; j++) {
      const b = cands[j];
      if (twins.has(b) || a.parent !== b.parent) continue;
      if (hasNodeBelow(a, nodes) || hasNodeBelow(b, nodes)) continue;
      if (Math.abs(a.position.y - b.position.y) > 1e-4 || Math.abs(a.position.z - b.position.z) > 1e-4) continue;
      const pa = audit.poses[index.get(a)!];
      const pb = audit.poses[index.get(b)!];
      const same = pa.every((fa, f) => {
        const fb = pb[f];
        for (let k = 1; k < fa.length; k++) if (Math.abs(fa[k] - fb[k]) > EPS) return false; // all but x
        return Math.abs(fa[4]) < EPS && Math.abs(fa[5]) < EPS; // a pure turn about x
      });
      if (same) twins.set(b, a);
    }
  }
  return twins;
}

function hasNodeBelow(n: THREE.Object3D, nodes: Set<THREE.Object3D>): boolean {
  let found = false;
  n.traverse((o) => {
    if (o !== n && nodes.has(o)) found = true;
  });
  return found;
}

export function countMeshes(root: THREE.Object3D, hulls = true): number {
  let n = 0;
  root.traverse((o) => {
    if (isMeshObj(o) && (hulls || o.name !== "outline")) n++;
  });
  return n;
}

/**
 * Bake `rig` in place. `key` is `${cardId}:${side}:${edition}:${teamPalette}`.
 * Returns what happened; a rig that cannot be baked is left as built.
 */
export function bakeRig(rig: TroopRig, key: string): BakeStats {
  const group = rig.group;
  const before = countMeshes(group);
  if (group.userData.baked) {
    return { baked: true, before, after: before, parts: countMeshes(group, false), nodes: 0, folded: 0 };
  }
  try {
    return bakeUnsafe(rig, key, before);
  } catch (err) {
    console.warn("bakeRig failed; keeping the unbaked rig", err);
    return { baked: false, before, after: countMeshes(group), parts: countMeshes(group, false), nodes: 0, folded: 0 };
  }
}

/** Parts grouped by the animated node they ride. */
interface Bucket {
  toon: THREE.Mesh[];
  basic: Map<boolean, THREE.Mesh[]>;
  team: THREE.Mesh[];
  eyes: THREE.Mesh[];
  solo: THREE.Mesh[];
  outline: THREE.Mesh[];
}

interface Analysis {
  kind: Map<THREE.Mesh, Kind>;
  buckets: Map<THREE.Object3D, Bucket>;
  /** Parts that vanish into merged meshes. */
  removed: Set<THREE.Object3D>;
  /** Predicted mesh count (hulls excluded). */
  count: number;
}

function bakeUnsafe(rig: TroopRig, key: string, before: number): BakeStats {
  const group = rig.group;
  group.updateMatrixWorld(true);
  const list: THREE.Object3D[] = [];
  group.traverse((o) => list.push(o));
  const index = new Map<THREE.Object3D, number>();
  list.forEach((o, i) => index.set(o, i));

  // --- plan (audit + product cache) ---
  const sig = `${list.length}:${list.map((o) => (isMeshObj(o) ? "m" : "g") + o.name.length).join("")}`;
  const pk = planKey(key);
  const cacheable = cardOf(key) !== "champion"; // the Studio redesigns it
  let plan = cacheable ? plans.get(pk) : undefined;
  if (!plan || plan.sig !== sig) {
    plan = { sig, audit: auditRig(rig, list, archetypeOfKey(key)), geos: new Map(), meta: new Map() };
    if (cacheable) plans.set(pk, plan);
  }
  const moving = new Set(plan.audit.moving.map((i) => list[i]));
  const glowingMesh = new Set(plan.audit.glowing.map((i) => list[i]));

  // --- nodes: everything that animates ---
  const nodes = new Set<THREE.Object3D>([group]);
  const addNode = (o: THREE.Object3D | null | undefined): void => {
    if (o && index.has(o)) nodes.add(o);
  };
  addNode(rig.arm);
  addNode(rig.offArm);
  for (const leg of rig.legs ?? []) addNode(leg);
  for (const wing of rig.wings ?? []) addNode(wing.obj);
  for (const o of moving) addNode(o);
  for (const o of list) if (o.userData.animated) addNode(o);
  // The head turns and wobbles: the object the first eye hangs on.
  const { small, swarm } = lodOf(key);
  const budget = swarm ? SWARM_BUDGET : MESH_BUDGET;
  let head: THREE.Object3D | null = null;
  if (!small) {
    for (const o of list) {
      if ((o.name === "eye" || o.name === "eyerim") && o.parent && o.parent !== group) {
        head = o.parent;
        break;
      }
    }
  }
  addNode(head);

  const twins = findTwins(nodes, plan.audit, index);
  for (const t of twins.keys()) nodes.delete(t);

  function analyse(nodeSet: Set<THREE.Object3D>): Analysis {
    const kind = new Map<THREE.Mesh, Kind>();
    for (const o of list) {
      if (!isMeshObj(o) || o.name === "outline") continue;
      let k: Kind = "keep";
      if (plainMesh(o) && o.visible && !o.userData.noBake && !glowingMesh.has(o)) {
        const mat = o.material as THREE.Material;
        const isNode = nodeSet.has(o);
        if (o.name === TEAM_MESH) {
          // A team mesh that moves on its own stays as built.
          if (toonBakeable(mat) && !moving.has(o)) k = "team";
        } else if (FACE_NAMES.has(o.name) && !small) {
          if (toonBakeable(mat)) k = "face";
        } else if (o.name === "orb" || (moving.has(o) && isNode)) {
          // Driven meshes keep their own transform; only the colour moves into
          // the vertices so the material can be shared. A moving toon part
          // with children carries them (isNode), a bare one just recolours.
          if (basicBakeable(mat)) k = "solo";
          else if (toonBakeable(mat) && o.name !== "orb") k = isNode ? "toon" : "solo";
        } else if (!KEEP_NAMES.has(o.name) || (small && FACE_NAMES.has(o.name))) {
          if (toonBakeable(mat)) k = "toon";
          else if (basicBakeable(mat)) k = isNode ? "solo" : "basic";
        }
      }
      kind.set(o, k);
    }
    const removed = new Set<THREE.Object3D>();
    for (const o of list) if (isMeshObj(o) && o.name === "outline") removed.add(o);
    const buckets = new Map<THREE.Object3D, Bucket>();
    const bucketOf = (n: THREE.Object3D): Bucket => {
      let b = buckets.get(n);
      if (!b) {
        b = { toon: [], basic: new Map(), team: [], eyes: [], solo: [], outline: [] };
        buckets.set(n, b);
      }
      return b;
    };
    let count = 0;
    for (const [m, k] of kind) {
      const isNode = nodeSet.has(m);
      const owner = isNode ? m : nearestNode(m, nodeSet, twins);
      if (!owner) {
        if (k !== "toon" && k !== "basic" && k !== "team") count++;
        continue;
      }
      const b = bucketOf(owner);
      switch (k) {
        case "toon":
          b.toon.push(m);
          b.outline.push(m);
          if (!isNode) removed.add(m);
          break;
        case "basic": {
          const tm = (m.material as THREE.Material).toneMapped;
          const l = b.basic.get(tm) ?? [];
          l.push(m);
          b.basic.set(tm, l);
          b.outline.push(m);
          removed.add(m);
          break;
        }
        case "team": {
          b.team.push(m);
          b.outline.push(m);
          removed.add(m);
          break;
        }
        case "face":
          if (m.name === "eye" || m.name === "eyerim") b.eyes.push(m);
          else if (m.name === "pupil") b.eyes.push(m); // the pupils ride in the eye mesh
          else b.solo.push(m);
          break;
        case "solo":
          b.solo.push(m);
          break;
        default:
          count++;
          break;
      }
    }
    for (const [node, b] of buckets) {
      if (b.toon.length) count++;
      count += b.basic.size + (b.team.length ? 1 : 0) + b.solo.length;
      for (const parts of [b.eyes]) {
        if (!parts.length) continue;
        const ok = pairable(node, parts);
        if (ok) for (const m of parts) removed.add(m);
        count += ok ? 1 : parts.length;
      }
    }
    return { kind, buckets, removed, count };
  }

  // --- fold the quietest nodes while over budget ---
  const reachOf = (n: THREE.Object3D): number => {
    const r = plan!.audit.reach[index.get(n)!] ?? 0;
    return n === head ? Math.max(r, HEAD_WOBBLE * extentOf(n)) : r;
  };
  let an = analyse(nodes);
  const foldOrder = [...nodes].filter((n) => n !== group).sort((a, b) => reachOf(a) - reachOf(b));
  let folded = 0;
  for (const n of foldOrder) {
    if (an.count <= budget) break;
    if (reachOf(n) > FOLD_REACH_MAX) break; // beyond here the motion shows: keep it
    nodes.delete(n);
    const trial = analyse(nodes);
    if (trial.count < an.count) {
      an = trial;
      folded++;
      if (n === head) head = null;
    } else {
      nodes.add(n); // folding it saves nothing (a bare moving mesh): keep it moving
    }
  }

  // =====================  build products (no scene mutation)  =====================
  const toNode = (n: THREE.Object3D): THREE.Matrix4 => n.matrixWorld.clone().invert();
  const product = (id: string, make: () => THREE.BufferGeometry | null): THREE.BufferGeometry | null => {
    const hit = plan!.geos.get(id);
    if (hit) return hit;
    const made = make();
    if (made) plan!.geos.set(id, made);
    return made;
  };
  const flat = (m: THREE.Mesh, owner: THREE.Object3D): boolean => {
    const mat = m.material as THREE.MeshToonMaterial;
    return m === head || owner === head || mat.color.getHex() === SKIN_HEX || !mat.map || FACE_NAMES.has(m.name);
  };

  interface Face {
    g: THREE.BufferGeometry;
    y: number;
    spots: EyeSpot[];
  }
  interface Built {
    node: THREE.Object3D;
    toon: THREE.BufferGeometry | null;
    carrier: boolean;
    basic: [boolean, THREE.BufferGeometry][];
    team: { g: THREE.BufferGeometry; shade: string; host: boolean; part: unknown } | null;
    eye: Face | null;
    solo: [THREE.Mesh, THREE.BufferGeometry, THREE.Material | null][];
    outline: THREE.BufferGeometry | null;
  }
  const built: Built[] = [];
  const mergedFace = new Set<THREE.Mesh>();
  for (const [node, b] of an.buckets) {
    const ni = index.get(node)!;
    const inv = toNode(node);
    const carrier = isMeshObj(node) && an.kind.get(node) === "toon";
    const out: Built = { node, toon: null, carrier, basic: [], team: null, eye: null, solo: [], outline: null };
    // Outline: every static part big enough to read, welded into one hull.
    const hull = (): THREE.BufferGeometry | null => hullGeometry(b.outline, inv);
    if (b.toon.length) {
      out.toon = product(`${ni}:toon`, () => {
        const body = finish(
          b.toon.map((m) => {
            const g = bake(m, inv, true);
            if (flat(m, node)) grainless(g);
            return g;
          }),
        );
        if (!body) return null;
        // The ink rides in the same mesh: one draw call per node, not two.
        const h = hull();
        const merged = withInk(body, h);
        h?.dispose();
        return merged;
      });
    }
    for (const [tm, parts] of b.basic) {
      const g = product(`${ni}:basic${tm ? 1 : 0}`, () => finish(parts.map((m) => bake(m, inv, true))));
      if (g) out.basic.push([tm, g]);
    }
    let hosted = b.toon.length > 0; // some mesh of this node already carries its ink
    if (b.team.length) {
      // No body mesh here (a wing that is all team cloth): the team mesh hosts the ink.
      const host = !hosted;
      hosted = true;
      const shades = new Set(b.team.map((m) => (m.userData.team === "dark" ? "dark" : "main")));
      const g = product(`${ni}:team${host ? ":ink" : ""}`, () => {
        const gs = b.team.map((m) => {
          const part = bake(m, inv, false);
          const n = part.getAttribute("position").count;
          const dark = m.userData.team === "dark" ? 1 : 0;
          part.setAttribute("aDark", new THREE.BufferAttribute(new Float32Array(n).fill(dark), 1));
          return part;
        });
        const body = finish(gs);
        if (!body || !host) return body;
        const h = hull();
        const merged = withInk(body, h, false, (hg) => {
          hg.setAttribute("aDark", new THREE.BufferAttribute(new Float32Array(hg.getAttribute("position").count), 1));
        });
        h?.dispose();
        return merged;
      });
      if (g) {
        out.team = {
          g,
          shade: shades.size === 2 ? "both" : [...shades][0],
          host,
          part: b.team[0].userData.part,
        };
      }
    }
    const pairMesh = (parts: THREE.Mesh[], id: string): Face | null => {
      if (!parts.length || !pairable(node, parts)) return null;
      const y0 = posIn(node, parts[0]).y;
      const g = product(id, () =>
        finish(
          parts.map((m) => {
            const gg = bake(m, inv, true);
            grainless(gg);
            gg.translate(0, -y0, 0);
            return gg;
          }),
        ),
      );
      if (!g) return null;
      let meta = plan!.meta.get(id);
      if (!meta) {
        meta = {
          spots: parts
            .filter((m) => m.name === "eye")
            .map((m) => {
              m.geometry.computeBoundingSphere();
              const p = posIn(node, m);
              return { x: p.x, z: p.z, r: (m.geometry.boundingSphere?.radius ?? 0.05) * m.scale.x };
            }),
        };
        plan!.meta.set(id, meta);
      }
      for (const m of parts) mergedFace.add(m);
      return { g, y: y0, spots: meta.spots };
    };
    out.eye = pairMesh(b.eyes, `${ni}:eye`);
    b.solo.forEach((m) => {
      const mat = m.material as THREE.Material;
      const basicMat = basicBakeable(mat);
      const g = product(`${ni}:solo:${index.get(m)}`, () => localColoured(m, !basicMat));
      if (g) out.solo.push([m, g, basicMat ? sharedBasic(mat.toneMapped) : null]);
    });
    // Nothing in this node could host its ink (glow parts only): a hull mesh.
    if (!hosted) out.outline = product(`${ni}:outline`, hull);
    built.push(out);
  }

  // =====================  mutation phase  =====================
  const removed = an.removed;
  // Face parts that could not pair stay as they are.
  for (const b of an.buckets.values()) {
    for (const m of b.eyes) if (!mergedFace.has(m)) removed.delete(m);
  }
  // 1. Reattach survivors whose parent folds away, compensating the matrices.
  group.traverse((o) => o.updateMatrix());
  const reparent: [THREE.Object3D, THREE.Object3D, THREE.Matrix4][] = [];
  for (const o of list) {
    if (o === group || removed.has(o) || !o.parent || !removed.has(o.parent)) continue;
    const m = o.matrix.clone();
    let p: THREE.Object3D | null = o.parent;
    while (p && removed.has(p)) {
      m.premultiply(p.matrix);
      p = p.parent;
    }
    if (p) reparent.push([o, p, m]);
  }
  for (const [o, p, m] of reparent) {
    o.removeFromParent();
    p.add(o);
    m.decompose(o.position, o.quaternion, o.scale);
  }
  for (const o of removed) o.removeFromParent();

  // 2. Materials: one baked clone per unit, one team material per unit.
  const unit = unitBakedToon();
  let teamMat: THREE.MeshToonMaterial | null = null;
  // The team colours as applyTeam painted them when the rig was built.
  let mainColor: THREE.Color | null = null;
  let darkColor: THREE.Color | null = null;
  for (const [m, k] of an.kind) {
    if (k !== "team") continue;
    const c = (m.material as THREE.MeshToonMaterial).color;
    if (m.userData.team === "dark") darkColor ??= c.clone();
    else mainColor ??= c.clone();
  }

  // 3. Merged meshes.
  for (const b of built) {
    const node = b.node;
    let holder: THREE.Object3D = node;
    if (b.toon) {
      if (b.carrier) {
        const car = node as THREE.Mesh;
        car.geometry = b.toon;
        car.material = unit;
        car.receiveShadow = true;
        car.castShadow = false;
        car.onBeforeRender = fitInk;
      } else {
        const mesh = new THREE.Mesh(b.toon, unit);
        mesh.name = "baked";
        mesh.receiveShadow = true;
        mesh.onBeforeRender = fitInk;
        node.add(mesh);
        holder = mesh;
      }
    }
    for (const [tm, g] of b.basic) {
      const mesh = new THREE.Mesh(g, sharedBasic(tm));
      mesh.name = "baked-glow";
      node.add(mesh);
    }
    if (b.team) {
      if (!teamMat) {
        teamMat = teamToon();
        if (mainColor) teamMat.color.copy(mainColor);
        if (darkColor) (teamMat.userData.teamDark as THREE.Color).copy(darkColor);
      }
      const mesh = new THREE.Mesh(b.team.g, teamMat);
      if (b.team.host) mesh.onBeforeRender = fitInk;
      mesh.name = TEAM_MESH;
      mesh.userData.team = b.team.shade;
      if (b.team.part) mesh.userData.part = b.team.part;
      mesh.receiveShadow = true;
      node.add(mesh);
    }
    if (b.eye) {
      const face = b.eye;
      const mesh = new THREE.Mesh(face.g, unit);
      mesh.name = "eye";
      mesh.position.y = face.y;
      mesh.userData.spots = face.spots;
      node.add(mesh);
    }
    for (const [m, g, mat] of b.solo) {
      m.geometry = g;
      m.material = mat ?? unit;
    }
    if (b.outline) holder.add(outlineHull(b.outline));
  }

  group.userData.baked = true;
  const parts = countMeshes(group, false);
  return { baked: true, before, after: countMeshes(group), parts, nodes: nodes.size, folded };
}

/**
 * Whether a node's mirrored face parts (eyes, rims and pupils) can share
 * one mesh: same height above the node's origin (blinks scale about it),
 * upright and unscaled.
 */
function pairable(node: THREE.Object3D, parts: THREE.Mesh[]): boolean {
  const ys = parts.map((m) => posIn(node, m).y);
  if (Math.max(...ys) - Math.min(...ys) > 1e-3) return false;
  return parts.every((m) => {
    const e = new THREE.Euler().setFromQuaternion(m.quaternion);
    return Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z) < 1e-4 && Math.abs(m.scale.x - 1) + Math.abs(m.scale.y - 1) < 1e-4;
  });
}

// ---------------------------------------------------------------------------
// Prewarm
// ---------------------------------------------------------------------------

const warmQueue: CardId[] = [];
const warmed = new Set<string>();
let warming = false;

/**
 * Bake cards ahead of their first deploy, one per timer tick, so the 30-80 ms
 * a card's first bake costs lands in the countdown instead of mid-fight. Only
 * troop cards are baked; each card once per edition.
 */
export function prewarmBakes(cards: readonly CardId[]): void {
  const edition = ARABIC ? "arabic" : "normal";
  for (const id of cards) {
    if (warmed.has(`${id}:${edition}`) || warmQueue.includes(id)) continue;
    try {
      const card = getCard(id);
      if (card.kind !== "troop" || id === "champion") continue;
    } catch {
      continue;
    }
    warmQueue.push(id);
  }
  if (!warming && warmQueue.length) {
    warming = true;
    setTimeout(pumpWarm, 0);
  }
}

function pumpWarm(): void {
  const id = warmQueue.shift();
  if (!id) {
    warming = false;
    return;
  }
  const edition = ARABIC ? "arabic" : "normal";
  try {
    // The rig is thrown away: it never reached the GPU, so there is nothing to
    // free, and the cached geometry is what the real units will share.
    bakeRig(buildTroop(id, "player"), `${id}:player:${edition}:default`);
    warmed.add(`${id}:${edition}`);
  } catch {
    // a card without a rig: nothing to warm
  }
  setTimeout(pumpWarm, 16);
}
