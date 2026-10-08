/**
 * Painted canvas textures for the arena: tower brick per variant. (The
 * court floors, classic and zellige, are painted by groundPaint.ts.)
 */
import * as THREE from "three";
import type { BrickVariant } from "../../arenaLooks";

/** Shared stone-brick texture for tower walls. */
const brickTextures: Partial<Record<BrickVariant, THREE.CanvasTexture>> = {};

const BRICK_TINTS: Record<BrickVariant, { base: string; mortar: string }> = {
  sand: { base: "#c2b49a", mortar: "rgba(90,75,55,0.5)" },
  // Neon arena team stone: enemy towers magenta, player towers blue-slate.
  pink: { base: "#d873cf", mortar: "rgba(120,40,110,0.55)" },
  blue: { base: "#93a9d1", mortar: "rgba(45,65,105,0.55)" },
  grey: { base: "#a9b0ba", mortar: "rgba(60,70,85,0.55)" },
  marble: { base: "#d9d2e8", mortar: "rgba(90,70,120,0.45)" },
  dark: { base: "#4a4a55", mortar: "rgba(255,120,40,0.35)" },
  ice: { base: "#c8e0f0", mortar: "rgba(80,120,160,0.5)" },
  moss: { base: "#7f9a5a", mortar: "rgba(40,60,25,0.55)" },
  bone: { base: "#e2d8c0", mortar: "rgba(110,90,70,0.5)" },
};

export function brickTex(variant: BrickVariant = "sand"): THREE.CanvasTexture {
  if (!brickTextures[variant]) {
    const c = document.createElement("canvas");
    c.width = c.height = 128; // 2x for crisp mortar lines up close
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.fillStyle = BRICK_TINTS[variant].base;
    ctx.fillRect(0, 0, 64, 64);
    // Painted bricks: each block gets its own shade, a lit top edge and a
    // shaded bottom edge, so walls read as carved stone, not a flat decal.
    let seed = 11;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffff) / 0xffff;
    };
    for (let row = 0; row < 6; row++) {
      const by = row * 11;
      const boff = row % 2 ? 0 : 8;
      for (let bx = boff - 16; bx < 64; bx += 16) {
        const v = rand();
        ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${(0.5 - v) * 0.16})` : `rgba(255,255,255,${(v - 0.5) * 0.18})`;
        ctx.fillRect(bx + 1, by + 1, 14, 9);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(bx + 1, by + 1, 14, 1.4);
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(bx + 1, by + 8.6, 14, 1.4);
      }
    }
    ctx.strokeStyle = BRICK_TINTS[variant].mortar;
    ctx.lineWidth = 1.6;
    for (let row = 0; row < 6; row++) {
      const y = row * 11;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y);
      ctx.stroke();
      const off = row % 2 ? 0 : 8;
      for (let xCol = off; xCol < 64; xCol += 16) {
        ctx.beginPath();
        ctx.moveTo(xCol, y);
        ctx.lineTo(xCol, y + 11);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.shared = true;
    brickTextures[variant] = tex;
  }
  return brickTextures[variant]!;
}
