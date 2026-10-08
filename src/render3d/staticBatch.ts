/**
 * Static batching: merge meshes that never move and look identical
 * (same material settings, same shadow flags) into one mesh per look, so
 * a set dressed from hundreds of little props costs a handful of draw
 * calls. Call once, right after a set is built and before it renders.
 *
 * Two opt-in modes widen it (BatchOptions): `tint` also merges parts that
 * differ only in colour (the colour moves into a vertex attribute), and
 * `local` merges a node's direct parts into that node only, so a rig's
 * animated groups keep moving their own pieces.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TMP = new THREE.Matrix4();

export interface BatchOptions {
  /**
   * Merge parts that differ only in colour: each part's colour is baked into
   * a vertex `color` attribute and the merged mesh draws them all with one
   * vertexColors copy of the bucket's material.
   */
  tint?: boolean;
  /**
   * Root-local mode, for rigs: a node's direct mesh children merge into that
   * node, never across group boundaries, so animated groups keep moving
   * their own parts. A part's ink-outline hulls (children named "outline")
   * merge into one hull per node along with it; named meshes (eye, team...)
   * other than joint balls, and meshes with any other children, stay as
   * they are.
   */
  local?: boolean;
}

/** Everything that changes how a material renders; equal keys ⇒ mergeable. */
function materialKey(m: THREE.Material, withColor = true): string {
  const a = m as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    map?: THREE.Texture | null;
    gradientMap?: THREE.Texture | null;
    flatShading?: boolean;
    fog?: boolean;
  };
  return [
    m.type,
    withColor ? (a.color?.getHexString() ?? "") : "",
    a.emissive?.getHexString() ?? "",
    a.emissiveIntensity ?? "",
    a.map?.uuid ?? "",
    a.gradientMap?.uuid ?? "",
    a.flatShading ? 1 : 0,
    a.fog === false ? 0 : 1,
    m.transparent ? 1 : 0,
    m.opacity,
    m.side,
    m.toneMapped ? 1 : 0,
    m.depthWrite ? 1 : 0,
    m.depthTest ? 1 : 0,
    m.vertexColors ? 1 : 0,
    m.alphaTest,
    m.blending,
    m.polygonOffset ? `${m.polygonOffsetFactor},${m.polygonOffsetUnits}` : "",
    m.customProgramCacheKey(),
  ].join("|");
}

function eligible(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return (
    m.isMesh === true &&
    !(m as THREE.InstancedMesh).isInstancedMesh &&
    !(m as THREE.SkinnedMesh).isSkinnedMesh &&
    !Array.isArray(m.material) &&
    !!m.geometry.attributes.position &&
    !m.geometry.morphAttributes.position &&
    m.userData.noBatch !== true
  );
}

/** A world-baked, non-indexed position/normal/uv copy of `mesh`'s geometry. */
function bake(mesh: THREE.Mesh, toRoot: THREE.Matrix4, tint = false): THREE.BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", src.getAttribute("position"));
  if (src.getAttribute("normal")) g.setAttribute("normal", src.getAttribute("normal"));
  else g.computeVertexNormals();
  const count = g.getAttribute("position").count;
  g.setAttribute(
    "uv",
    src.getAttribute("uv") ?? new THREE.BufferAttribute(new Float32Array(count * 2), 2),
  );
  TMP.multiplyMatrices(toRoot, mesh.matrixWorld);
  g.applyMatrix4(TMP);
  // A mirrored transform flips the triangle winding; flip it back.
  if (TMP.determinant() < 0) {
    for (const name of ["position", "normal", "uv"]) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      const n = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let t = 0; t + 2 < attr.count; t += 3) {
        for (let k = 0; k < n; k++) {
          const i1 = (t + 1) * n + k;
          const i2 = (t + 2) * n + k;
          const tmp = arr[i1];
          arr[i1] = arr[i2];
          arr[i2] = tmp;
        }
      }
    }
  }
  src.dispose();
  if (tint) {
    // Material colours are linear, like vertex colours: copy them as is.
    const c = (mesh.material as THREE.Material & { color?: THREE.Color }).color ?? WHITE;
    const rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) rgb.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  }
  return g;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * The material a tinted batch draws with: a copy of `src` that takes its
 * colour from the vertices. Shader hooks (rim light) are instance fields
 * that clone() drops, so they are carried over by hand.
 */
function tintMaterial(src: THREE.Material): THREE.Material {
  const mat = src.clone() as THREE.Material & { color?: THREE.Color };
  mat.color?.set(0xffffff);
  mat.vertexColors = true;
  mat.onBeforeCompile = src.onBeforeCompile;
  mat.customProgramCacheKey = src.customProgramCacheKey;
  return mat;
}

/** Bucket key: the look (colour excepted when tinting), shadow flags and draw order. */
function bucketKey(m: THREE.Mesh, tint: boolean): string {
  return `${materialKey(m.material as THREE.Material, !tint)}#${m.castShadow ? 1 : 0}${
    m.receiveShadow ? 1 : 0
  }#${m.renderOrder}`;
}

/** Merge `list` (baked into the space `toRoot` maps to) into one mesh. */
function mergeList(list: THREE.Mesh[], toRoot: THREE.Matrix4, tint: boolean, name: string): THREE.Mesh | null {
  const merged = mergeGeometries(list.map((m) => bake(m, toRoot, tint)), false);
  if (!merged) return null;
  merged.computeBoundingSphere();
  const first = list[0];
  const material = tint ? tintMaterial(first.material as THREE.Material) : first.material;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = first.castShadow;
  mesh.receiveShadow = first.receiveShadow;
  mesh.renderOrder = first.renderOrder;
  mesh.name = name;
  return mesh;
}

/**
 * Merge the static meshes under `root`. `skip(o)` excludes an object and
 * its whole subtree (animated props). A subtree whose root has
 * `userData.batchRoot` is batched on its own, so it can still be shown or
 * hidden as a unit. Returns the number of meshes removed.
 */
export function batchStatic(
  root: THREE.Object3D,
  skip: (o: THREE.Object3D) => boolean,
  opts: BatchOptions = {},
): number {
  root.updateMatrixWorld(true);
  if (opts.local) return batchLocal(root, skip, !!opts.tint);
  const tint = !!opts.tint;
  const toRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  let removed = 0;

  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (skip(c) || !c.visible || c.userData.noBatch) continue;
      if (c.userData.batchRoot) {
        removed += batchStatic(c, skip, opts);
        continue;
      }
      if (eligible(c)) {
        const key = bucketKey(c, tint);
        const list = buckets.get(key);
        if (list) list.push(c);
        else buckets.set(key, [c]);
      }
      visit(c);
    }
  };
  visit(root);

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const mesh = mergeList(list, toRoot, tint, "batched");
    if (!mesh) continue;
    root.add(mesh);
    for (const m of list) {
      // Children of a merged mesh (if any) stay put in the scene graph.
      for (const child of [...m.children]) m.parent?.attach(child);
      m.removeFromParent();
    }
    removed += list.length - 1;
  }
  return removed;
}

/**
 * A rig part local mode may merge: unnamed (or one of articulate()'s joint
 * balls, which only ever move with their limb), with only outline hulls
 * under it.
 */
function localEligible(o: THREE.Object3D): o is THREE.Mesh {
  if (!eligible(o) || (o.name !== "" && !o.name.startsWith("joint-"))) return false;
  return o.children.every((c) => c.name === "outline" && eligible(c) && c.children.length === 0);
}

/** Root-local batching (see BatchOptions.local); returns the meshes removed. */
function batchLocal(node: THREE.Object3D, skip: (o: THREE.Object3D) => boolean, tint: boolean): number {
  let removed = 0;
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const c of node.children) {
    if (skip(c) || !c.visible || c.userData.noBatch || !localEligible(c)) continue;
    const key = bucketKey(c, tint);
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }
  const toNode = node.matrixWorld.clone().invert();
  const hullBuckets = new Map<string, THREE.Mesh[]>();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const mesh = mergeList(list, toNode, tint, "batched");
    if (!mesh) continue;
    for (const m of list) {
      for (const hull of m.children as THREE.Mesh[]) {
        const key = bucketKey(hull, false);
        const hulls = hullBuckets.get(key);
        if (hulls) hulls.push(hull);
        else hullBuckets.set(key, [hull]);
      }
      m.removeFromParent();
    }
    node.add(mesh);
    removed += list.length - 1;
  }
  for (const hulls of hullBuckets.values()) {
    const hull = mergeList(hulls, toNode, false, "outline");
    if (!hull) continue;
    for (const h of hulls) h.removeFromParent();
    node.add(hull);
    removed += hulls.length - 1;
  }
  for (const c of [...node.children]) {
    if (skip(c) || c.userData.noBatch) continue;
    removed += batchLocal(c, skip, tint);
  }
  return removed;
}
