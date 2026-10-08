import * as THREE from "three";

/**
 * Weld a non-indexed geometry into an indexed one: vertices whose every
 * attribute matches (to 1e-4, like BufferGeometryUtils.mergeVertices) become
 * one. mergeVertices builds a string key per vertex, which cost 60-90 ms for
 * a Knight; this hashes quantised integers into an open-addressing table
 * instead, so the first deploy of a card no longer hitches.
 */
export function weldVertices(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const names = Object.keys(src.attributes);
  const attrs = names.map((n) => src.getAttribute(n) as THREE.BufferAttribute);
  const count = src.getAttribute("position").count;
  const stride = attrs.reduce((n, a) => n + a.itemSize, 0);

  // Quantise every component of every vertex into one row of ints.
  const q = new Int32Array(count * stride);
  for (let i = 0; i < count; i++) {
    let o = i * stride;
    for (const a of attrs) {
      for (let c = 0; c < a.itemSize; c++) q[o++] = Math.round(a.getComponent(i, c) * 1e4);
    }
  }

  const size = 1 << Math.max(4, Math.ceil(Math.log2(count * 2 + 1)));
  const table = new Int32Array(size).fill(-1); // slot -> unique index
  const first: number[] = []; // unique index -> source vertex
  const remap = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    let h = 0x811c9dc5;
    const o = i * stride;
    for (let k = 0; k < stride; k++) h = Math.imul(h ^ q[o + k], 0x01000193);
    let slot = (h >>> 0) & (size - 1);
    for (;;) {
      const u = table[slot];
      if (u < 0) {
        table[slot] = first.length;
        remap[i] = first.length;
        first.push(i);
        break;
      }
      const f = first[u] * stride;
      let same = true;
      for (let k = 0; k < stride; k++) {
        if (q[f + k] !== q[o + k]) {
          same = false;
          break;
        }
      }
      if (same) {
        remap[i] = u;
        break;
      }
      slot = (slot + 1) & (size - 1);
    }
  }

  const out = new THREE.BufferGeometry();
  const unique = first.length;
  names.forEach((name, ai) => {
    const a = attrs[ai];
    const arr = new Float32Array(unique * a.itemSize);
    for (let u = 0; u < unique; u++) {
      for (let c = 0; c < a.itemSize; c++) arr[u * a.itemSize + c] = a.getComponent(first[u], c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  });
  out.setIndex(new THREE.BufferAttribute(unique > 65535 ? new Uint32Array(remap) : new Uint16Array(remap), 1));
  return out;
}
