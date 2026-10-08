/**
 * Freeze dome: a translucent ice shell over the frozen area. A fresnel
 * ShaderMaterial (rim = pow(1 - dot(N, V), 2)) keeps the middle clear so
 * frozen troops stay readable while the edge glows cold. It grows in over
 * 0.5 s with a little overshoot and fades across the freeze.
 *
 * Two domes are built at init (shared geometry, one material each) and
 * reused, so a cast allocates nothing.
 */
import * as THREE from "three";

/** Seconds the dome takes to reach full size. */
export const DOME_GROW = 0.5;
const DOMES = 2;

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  // Orthographic camera: every view ray is parallel to -z.
  vV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uBody;
uniform float uAlpha;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float rim = pow(1.0 - clamp(abs(dot(normalize(vN), vV)), 0.0, 1.0), 2.0);
  // Faint frost bands drifting up the shell.
  float bands = 0.5 + 0.5 * sin(vH * 26.0 - uTime * 2.0);
  float a = (0.1 + rim * 0.75 + bands * 0.05) * uAlpha;
  vec3 col = mix(uBody, uRim, rim);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/** easeOutBack-style grow factor for the first DOME_GROW seconds. */
export function domeGrow(t: number): number {
  const k = Math.max(0, Math.min(1, t / DOME_GROW));
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

/** Opacity over the freeze: full, then easing to nothing at the end. */
export function domeAlpha(t: number, seconds: number): number {
  if (t >= seconds) return 0;
  const tail = Math.min(0.6, seconds * 0.25);
  const fadeIn = Math.min(1, t / 0.12);
  const fadeOut = t > seconds - tail ? (seconds - t) / tail : 1;
  return fadeIn * Math.max(0, fadeOut) * (1 - 0.35 * (t / seconds));
}

interface Dome {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  seconds: number;
  r: number;
}

export class IceDomes {
  readonly meshes: THREE.Mesh[] = [];
  private readonly domes: Dome[] = [];

  constructor() {
    // A slightly flattened hemisphere; open at the bottom.
    const geo = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.userData.shared = true;
    const rim = new THREE.Color(0xbdf3ff);
    const body = new THREE.Color(0x6fc8f0);
    for (let i = 0; i < DOMES; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uRim: { value: new THREE.Vector3(rim.r * 2.2, rim.g * 2.2, rim.b * 2.2) }, // HDR: blooms
          uBody: { value: new THREE.Vector3(body.r, body.g, body.b) },
          uAlpha: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      mat.userData.shared = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.meshes.push(mesh);
      this.domes.push({ mesh, mat, t: -1, seconds: 0, r: 1 });
    }
  }

  /** Raise a dome of radius `r` at world (wx, wz) for `seconds`. */
  start(wx: number, wz: number, r: number, seconds: number): void {
    let d = this.domes[0];
    for (const k of this.domes) {
      if (k.t < 0) {
        d = k;
        break;
      }
      if (k.t > d.t) d = k; // both busy: replace the older cast
    }
    d.t = 0;
    d.seconds = Math.max(0.5, seconds);
    d.r = r;
    d.mesh.position.set(wx, 0, wz);
    d.mesh.visible = true;
    this.apply(d);
  }

  private apply(d: Dome): void {
    const g = domeGrow(d.t) * d.r;
    d.mesh.scale.set(g, g * 0.62, g);
    d.mat.uniforms["uAlpha"].value = domeAlpha(d.t, d.seconds);
    d.mat.uniforms["uTime"].value = d.t;
  }

  update(dt: number): void {
    for (const d of this.domes) {
      if (d.t < 0) continue;
      d.t += dt;
      if (d.t >= d.seconds) {
        d.t = -1;
        d.mesh.visible = false;
      } else this.apply(d);
    }
  }

  /** Domes currently up. */
  get active(): number {
    let n = 0;
    for (const d of this.domes) if (d.t >= 0) n++;
    return n;
  }

  reset(): void {
    for (const d of this.domes) {
      d.t = -1;
      d.mesh.visible = false;
    }
  }
}
