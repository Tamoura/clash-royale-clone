/**
 * The tournament crowd: instanced chibi spectators (art bible section 4).
 * Two draws for the whole crowd: one InstancedMesh of bodies (a rounded
 * torso with two arms, half of them raised to cheer) in shirt colours, one
 * of heads (a round head with a hair cap baked into the vertex colours) in
 * six skin tones. Shirts are drawn from eight colours biased toward the
 * team whose half the seat overlooks.
 *
 * They bob gently (crowdAnim levels), wave when a tower is hit and jump
 * when a crown falls. Posing writes instance matrices only; nothing is
 * allocated per frame.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Side } from "../../../game/arena";
import { toon } from "../../characters3d";
import { teamColor } from "../../teamColors";

export interface CrowdSeat {
  x: number;
  z: number;
  /** World height of the surface the spectator stands on. */
  y: number;
  /** The way the spectator faces (radians about Y; 0 looks toward +z). */
  face: number;
  /** The half of the court the seat overlooks (its shirt bias). */
  side: Side;
}

/** Six skin tones, light to deep. */
export const CROWD_SKIN = [0xf8d2b0, 0xeab48a, 0xd39a6c, 0xb07650, 0x8a5636, 0x5e3a24] as const;
/** Eight shirt colours (team colours are added by the bias). */
const SHIRTS = [0xf2c14e, 0x66bb6a, 0xab47bc, 0xff8a3a, 0xf5f0e6, 0x26a69a, 0xec6fa8, 0x8d6e63] as const;
/** Saturation share kept by the non-team shirts. */
export const SHIRT_SATURATION = 0.75;
/** Share of each half's crowd wearing its team's colour. */
const TEAM_SHARE = 0.42;
/** Spectators are modelled 0.56 tall and drawn this much larger (about 0.75). */
const CROWD_SCALE = 1.32;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3(1, 1, 1);

function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Torso plus arms: arms down, or (cheer = true) raised in a V. */
function bodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Low counts on purpose: about 50 triangles a spectator, 200-odd of them.
  const torso = new THREE.CylinderGeometry(0.12, 0.16, 0.3, 6, 1, true);
  torso.translate(0, 0.15, 0);
  parts.push(torso);
  const shoulders = new THREE.SphereGeometry(0.125, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  shoulders.translate(0, 0.3, 0);
  parts.push(shoulders);
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.04, 0.045, 0.24, 4, 1, true);
    arm.translate(0, 0.12, 0);
    // Raised to the side in a cheering V.
    arm.rotateZ(sx * -2.55);
    arm.translate(sx * 0.13, 0.28, 0);
    parts.push(arm);
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  for (const p of parts) p.dispose();
  return g;
}

/** A round head with a hair cap: the hair is darker vertex colour (times the skin instance colour). */
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.13, 7, 5).toNonIndexed();
  g.translate(0, 0.43, 0);
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - 0.43;
    const z = pos.getZ(i);
    // Hair over the crown and the back of the head.
    const hair = y > 0.05 || (y > -0.06 && z < -0.04);
    const k = hair ? 0.32 : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export interface Crowd {
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  seats: CrowdSeat[];
  /** Per seat: 1 when the arms are raised (cheering pose), else 0. */
  raised: Uint8Array;
}

/** Build the crowd for `seats` (2 draws). */
export function makeCrowd(seats: CrowdSeat[], teamShare = TEAM_SHARE): Crowd | null {
  if (seats.length === 0) return null;
  const n = seats.length;
  const bodyMat = toon(0xffffff);
  const headMat = toon(0xffffff);
  headMat.vertexColors = true;
  const bodies = new THREE.InstancedMesh(bodyGeometry(), bodyMat, n);
  const heads = new THREE.InstancedMesh(headGeometry(), headMat, n);
  bodies.name = "crowd bodies";
  heads.name = "crowd heads";
  bodies.castShadow = heads.castShadow = false;
  bodies.receiveShadow = heads.receiveShadow = true;
  bodies.userData.noBatch = heads.userData.noBatch = true;
  const raised = new Uint8Array(n);
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const vivid = (hex: number): THREE.Color => {
    c.set(hex).getHSL(hsl);
    return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l);
  };
  // The non-team shirts are muted and held to a narrow value band, so the
  // stands read as one warm mass with team colour in it, not barcode noise
  // that outshouts the court (wide-screen review).
  const muted = (hex: number): THREE.Color => {
    c.set(hex).getHSL(hsl);
    return c.setHSL(hsl.h, hsl.s * SHIRT_SATURATION, 0.5 + (hsl.l - 0.5) * 0.7);
  };
  seats.forEach((seat, i) => {
    const team = hash(i, 11) < teamShare;
    const shirt = team ? teamColor(seat.side, hash(i, 12) < 0.5 ? "main" : "dark") : SHIRTS[Math.floor(hash(i, 13) * SHIRTS.length)];
    bodies.setColorAt(i, team ? vivid(shirt) : muted(shirt));
    heads.setColorAt(i, vivid(CROWD_SKIN[Math.floor(hash(i, 14) * CROWD_SKIN.length)]));
    raised[i] = hash(i, 15) < 0.3 ? 1 : 0;
  });
  bodies.instanceColor!.needsUpdate = true;
  heads.instanceColor!.needsUpdate = true;
  const crowd = { bodies, heads, seats, raised };
  poseCrowd(crowd, -1, 0, 0);
  return crowd;
}

/**
 * Pose every spectator. `t` is the clock (s); `bob` (0..1) the idle sway,
 * `jump` (0..1) the crown celebration, `wave` (0..1) the tower-hit wave.
 * `count` limits the work to the first seats (the rest keep their pose).
 */
export function poseCrowd(c: Crowd, t: number, jump: number, wave: number, bob = 0, count = Infinity): void {
  const n = Math.min(count, c.seats.length);
  for (let i = 0; i < n; i++) {
    const s = c.seats[i];
    const ph = hash(i, 21) * 6.283;
    const sp = 0.8 + hash(i, 22) * 0.6;
    const k = CROWD_SCALE * (0.95 + hash(i, 23) * 0.15); // a few taller, a few shorter
    let lift = 0;
    let sway = 0;
    if (t >= 0) {
      lift += bob * Math.max(0, Math.sin(t * 2.2 * sp + ph)) * 0.025;
      lift += jump * Math.abs(Math.sin(t * 10 * sp + ph)) * 0.2;
      sway += (wave + (c.raised[i] ? jump * 0.6 : 0)) * Math.sin(t * 7 * sp + ph) * 0.28;
    }
    E.set(0, s.face, sway);
    Q.setFromEuler(E);
    P.set(s.x, s.y + lift, s.z);
    S.setScalar(k);
    M.compose(P, Q, S);
    c.bodies.setMatrixAt(i, M);
    c.heads.setMatrixAt(i, M);
  }
  c.bodies.instanceMatrix.needsUpdate = true;
  c.heads.instanceMatrix.needsUpdate = true;
  if (t < 0 || n === c.seats.length) {
    c.bodies.computeBoundingSphere();
    c.heads.computeBoundingSphere();
  }
}
