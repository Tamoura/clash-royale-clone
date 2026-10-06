import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Side } from "../game/arena";
import {
  DISC_MIN_RADIUS,
  DISC_OUTER,
  DISC_SIZE,
  FILL_ALPHA,
  NOTCH_ANGLES,
  RING_INNER,
  discPixels,
  makeTeamDisc,
  refreshTeamDisc,
  teamDiscTexture,
} from "./teamBase";
import { TEAM } from "./teamColors";

const HALF = DISC_SIZE / 2;
const RADIUS = HALF - 0.5;

/** RGBA at polar coordinates (u = fraction of the outer radius). */
function probe(px: Uint8ClampedArray, u: number, theta: number): [number, number, number, number] {
  const x = Math.floor(HALF + Math.cos(theta) * u * RADIUS);
  const y = Math.floor(HALF + Math.sin(theta) * u * RADIUS); // row 0 at the bottom
  const i = (y * DISC_SIZE + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

/** Gaps (runs of fill-level alpha) around the ring at radius u. */
function ringGaps(px: Uint8ClampedArray, u: number): number {
  const steps = 720;
  const solid = (k: number): boolean => probe(px, u, (k / steps) * Math.PI * 2)[3] > 200;
  let gaps = 0;
  for (let k = 0; k < steps; k++) if (solid(k) && !solid(k + 1)) gaps++;
  return gaps;
}

const mid = (RING_INNER + 1) / 2;
const nearOuter = 1 - (1 - RING_INNER) * 0.2;

describe("team disc texture", () => {
  const player = discPixels("player", "default");
  const enemy = discPixels("enemy", "default");

  it("player and enemy textures differ", () => {
    expect(player.length).toBe(DISC_SIZE * DISC_SIZE * 4);
    let diff = 0;
    for (let i = 0; i < player.length; i++) if (player[i] !== enemy[i]) diff++;
    expect(diff).toBeGreaterThan(DISC_SIZE * DISC_SIZE);
  });

  it("only the enemy ring has notches: three of them", () => {
    expect(ringGaps(player, nearOuter)).toBe(0);
    expect(ringGaps(enemy, nearOuter)).toBe(NOTCH_ANGLES.length);
    expect(NOTCH_ANGLES.length).toBe(3);
    for (const a of NOTCH_ANGLES) {
      // Inside a notch the ring gives way to the translucent fill...
      expect(probe(enemy, nearOuter, a)[3]).toBeLessThan(140);
      expect(probe(player, nearOuter, a)[3]).toBeGreaterThan(200);
    }
    // ...and between notches the enemy ring is as solid as the player's.
    const between = (NOTCH_ANGLES[0] + NOTCH_ANGLES[1]) / 2;
    expect(probe(enemy, mid, between)[3]).toBeGreaterThan(200);
  });

  it("draws a translucent team fill, a solid team ring and a dark outer edge", () => {
    for (const [side, px] of [["player", player], ["enemy", enemy]] as [Side, Uint8ClampedArray][]) {
      const main = TEAM.default[side].main;
      const fill = probe(px, RING_INNER * 0.5, 0.3);
      expect(fill[3]).toBeCloseTo(FILL_ALPHA * 255, -1);
      expect(fill.slice(0, 3)).toEqual([(main >> 16) & 255, (main >> 8) & 255, main & 255]);
      const ring = probe(px, mid, 0.3 + Math.PI); // clear of every notch
      expect(ring[3]).toBeGreaterThan(230);
      expect(ring.slice(0, 3)).toEqual([(main >> 16) & 255, (main >> 8) & 255, main & 255]);
      const rim = probe(px, 0.985, 0.3 + Math.PI);
      expect(rim[0] + rim[1] + rim[2]).toBeLessThan(ring[0] + ring[1] + ring[2]);
      expect(probe(px, 1.15, Math.PI / 4)[3]).toBe(0); // outside the disc
      expect(px[3]).toBe(0); // corner texel
    }
  });

  it("follows the colour-blind palette", () => {
    const cb = discPixels("enemy", "cb");
    const fill = probe(cb, RING_INNER * 0.5, 1);
    expect(fill.slice(0, 3)).toEqual([0xff, 0x8a, 0x00]);
    expect(ringGaps(cb, nearOuter)).toBe(3);
  });

  it("caches one shared texture per side and palette", () => {
    const a = teamDiscTexture("enemy", "default");
    expect(teamDiscTexture("enemy", "default")).toBe(a);
    expect(teamDiscTexture("enemy", "cb")).not.toBe(a);
    expect(teamDiscTexture("player", "default")).not.toBe(a);
    expect(a.userData.shared).toBe(true);
    expect(a.image.width).toBe(DISC_SIZE);
  });
});

describe("team disc mesh", () => {
  it("lies flat, never writes depth and draws above the contact shadow", () => {
    const disc = makeTeamDisc("player", 0.6);
    const mat = disc.material as THREE.MeshBasicMaterial;
    expect(disc.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(disc.renderOrder).toBeGreaterThan(-1); // contact shadow sits at -1
    expect(disc.scale.x).toBeCloseTo(0.6 * DISC_OUTER * 2);
  });

  it("gives swarm units a minimum radius", () => {
    expect(makeTeamDisc("enemy", 0.25).scale.x).toBeCloseTo(DISC_MIN_RADIUS * DISC_OUTER * 2);
  });

  it("swaps to the palette's texture in place", () => {
    const disc = makeTeamDisc("enemy", 0.5);
    refreshTeamDisc(disc, "cb");
    expect((disc.material as THREE.MeshBasicMaterial).map).toBe(teamDiscTexture("enemy", "cb"));
    refreshTeamDisc(disc, "default");
    expect((disc.material as THREE.MeshBasicMaterial).map).toBe(teamDiscTexture("enemy", "default"));
  });
});
