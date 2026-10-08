/**
 * Night light: every lantern, torch and brazier the set places pools warm
 * light on the ground beneath it and wears a soft halo, and the towers'
 * windows glow. Pools are additive radial-gradient quads lying just above
 * the floor (under the deploy overlays, which draw after them), halos are
 * camera-facing quads; each family is one InstancedMesh.
 *
 * They fade in from dusk and are full at night; night-native sets (souk,
 * medina, copper) keep them lit from the start.
 */
import * as THREE from "three";
import { towerSpots, type Side } from "../../../game/arena";
import type { BattleState } from "../../../game/battle";
import { toWorld } from "../common";

export interface LightSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  /** Ground pool radius (world units). */
  radius: number;
  /** Turns with the backdrop for the guest view. */
  backdrop?: boolean;
  /** Belongs to the lantern string at that end (hidden with it). */
  end?: "player" | "enemy";
}

/** How lit the pools are: 0 by day, 1 at night; night-native sets start at NIGHT_NATIVE_FLOOR. */
export const NIGHT_NATIVE_FLOOR = 0.7;
export function poolIntensity(dayPhase: number, nightNative = false): number {
  const p = Math.min(1, Math.max(0, dayPhase));
  // Dusk ramp: nothing before a third of the arc, full from 85%.
  const t = Math.min(1, Math.max(0, (p - 0.3) / 0.55));
  const dusk = t * t * (3 - 2 * t);
  return nightNative ? NIGHT_NATIVE_FLOOR + (1 - NIGHT_NATIVE_FLOOR) * dusk : dusk;
}

/** Pool peak opacity: well under the deploy overlay's read. */
const POOL_OPACITY = 0.42;
const HALO_OPACITY = 0.6;

let radialTex: THREE.DataTexture | null = null;
/** A shared soft radial falloff (white centre to clear edge). */
function radial(): THREE.DataTexture {
  if (radialTex) return radialTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = (1 - r) * (1 - r) * (1 - r * 0.4);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  radialTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  radialTex.magFilter = THREE.LinearFilter;
  radialTex.minFilter = THREE.LinearFilter;
  radialTex.userData.shared = true;
  radialTex.needsUpdate = true;
  return radialTex;
}

const HALO_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(instanceMatrix[0].xyz);
    centre.xy += position.xy * size;
    gl_Position = projectionMatrix * centre;
  }
`;
const HALO_FRAG = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - r), 2.2) * uIntensity;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const POS = new THREE.Vector3();
const SCL = new THREE.Vector3();
const COL = new THREE.Color();
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/** Tower window slits: per tower kind, wall half-size and window height (1.1 scale). */
const WINDOW = { princess: { half: 1.05, y: 1.32, dx: 0.5 }, king: { half: 1.41, y: 1.62, dx: 0.66 } } as const;

export class LightPools {
  readonly group = new THREE.Group();
  private readonly pools: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  private readonly windows: THREE.InstancedMesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly windowMat: THREE.MeshBasicMaterial;
  private readonly towers: Array<{ side: Side; x: number; y: number; kind: "princess" | "king" }> = [];
  private alive = -1;
  private view: Side = "player";
  private level = -1;
  private endsShown = { player: true, enemy: true };

  constructor(private readonly spots: LightSpot[], private readonly nightNative: boolean) {
    this.group.name = "light pools";
    this.group.userData.noBatch = true;
    const n = Math.max(1, spots.length);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: radial(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), this.poolMat, n);
    this.pools.renderOrder = -1; // under the deploy overlays
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 } },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.haloMat, n);
    for (const side of ["enemy", "player"] as const) {
      for (const t of towerSpots(side)) this.towers.push({ side, x: t.x, y: t.y, kind: t.kind });
    }
    this.windowMat = new THREE.MeshBasicMaterial({
      color: 0xffc46b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const slit = new THREE.PlaneGeometry(0.16, 0.34);
    this.windows = new THREE.InstancedMesh(slit, this.windowMat, this.towers.length * 2);
    for (const m of [this.pools, this.halos, this.windows]) {
      m.frustumCulled = false;
      m.visible = false;
      m.userData.noBatch = true;
      this.group.add(m);
    }
    spots.forEach((s, i) => {
      COL.set(s.color);
      this.pools.setColorAt(i, COL);
      this.halos.setColorAt(i, COL);
    });
    if (spots.length === 0) {
      // The halo shader reads instanceColor, so it must exist even when unused.
      this.pools.setColorAt(0, COL.set(0));
      this.halos.setColorAt(0, COL);
    }
    this.layout();
  }

  /** Lights by the backdrop turn with it; end strings hide with theirs. */
  orient(view: Side, ends: { player: boolean; enemy: boolean }): void {
    this.view = view;
    this.endsShown = ends;
    this.layout();
    this.alive = -1;
  }

  private layout(): void {
    this.spots.forEach((s, i) => {
      const flip = s.backdrop && this.view === "enemy" ? -1 : 1;
      const shown = !s.end || this.endsShown[s.end];
      const k = shown ? 1 : 0;
      POS.set(s.x * flip, 0.015, s.z * flip);
      SCL.set(s.radius * k, s.radius * k, 1);
      M.compose(POS, FLAT, SCL);
      this.pools.setMatrixAt(i, M);
      POS.set(s.x * flip, s.y, s.z * flip);
      SCL.setScalar(0.85 * k);
      M.compose(POS, Q.identity(), SCL);
      this.halos.setMatrixAt(i, M);
    });
    this.pools.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
  }

  /** Place window glows on the face of every standing tower that looks at the camera. */
  private placeWindows(aliveMask: number): void {
    const face = this.view === "player" ? 1 : -1;
    this.towers.forEach((t, i) => {
      const w = toWorld(t.x, t.y);
      const spec = WINDOW[t.kind];
      const on = (aliveMask >> i) & 1;
      for (let j = 0; j < 2; j++) {
        POS.set(w.x + (j ? spec.dx : -spec.dx), spec.y, w.z + face * (spec.half + 0.02));
        Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, face > 0 ? 0 : Math.PI);
        SCL.setScalar(on);
        M.compose(POS, Q, SCL);
        this.windows.setMatrixAt(i * 2 + j, M);
      }
    });
    this.windows.instanceMatrix.needsUpdate = true;
  }

  /** Per frame: fade with the day phase; windows follow which towers stand. */
  update(dayPhase: number, state: BattleState | undefined): number {
    const level = poolIntensity(dayPhase, this.nightNative);
    if (level !== this.level) {
      this.level = level;
      this.poolMat.opacity = POOL_OPACITY * level;
      this.haloMat.uniforms["uIntensity"].value = HALO_OPACITY * level;
      this.windowMat.opacity = 0.95 * level;
      const on = level > 0.001;
      this.pools.visible = on && this.spots.length > 0;
      this.halos.visible = on && this.spots.length > 0;
      this.windows.visible = on;
    }
    if (this.windows.visible) {
      let mask = 0;
      if (state) {
        for (const e of state.entities) {
          if (e.kind !== "princess-tower" && e.kind !== "king-tower") continue;
          for (let i = 0; i < this.towers.length; i++) {
            const t = this.towers[i];
            if (t.side === e.side && t.x === e.x && t.y === e.y) mask |= 1 << i;
          }
        }
      } else {
        mask = (1 << this.towers.length) - 1;
      }
      if (mask !== this.alive) {
        this.alive = mask;
        this.placeWindows(mask);
      }
    }
    return level;
  }

  /** Free the instance buffers (the meshes' geometry and materials go with the arena). */
  dispose(): void {
    for (const m of [this.pools, this.halos, this.windows]) m.dispose();
  }
}
