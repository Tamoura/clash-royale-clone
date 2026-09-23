/**
 * Static batching: merge meshes that never move and look identical
 * (same material settings, same shadow flags) into one mesh per look, so
 * a set dressed from hundreds of little props costs a handful of draw
 * calls. Call once, right after a set is built and before it renders.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TMP = new THREE.Matrix4();

/** Everything that changes how a material renders; equal keys ⇒ mergeable. */
function materialKey(m: THREE.Material): string {
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
    a.color?.getHexString() ?? "",
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
function bake(mesh: THREE.Mesh, toRoot: THREE.Matrix4): THREE.BufferGeometry {
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
  return g;
}

/**
 * Merge the static meshes under `root`. `skip(o)` excludes an object and
 * its whole subtree (animated props). A subtree whose root has
 * `userData.batchRoot` is batched on its own, so it can still be shown or
 * hidden as a unit. Returns the number of meshes removed.
 */
export function batchStatic(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  let removed = 0;

  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (skip(c) || !c.visible) continue;
      if (c.userData.batchRoot) {
        removed += batchStatic(c, skip);
        continue;
      }
      if (eligible(c)) {
        const key = `${materialKey(c.material as THREE.Material)}#${c.castShadow ? 1 : 0}${
          c.receiveShadow ? 1 : 0
        }#${c.renderOrder}`;
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
    const merged = mergeGeometries(list.map((m) => bake(m, toRoot)), false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.name = "batched";
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
