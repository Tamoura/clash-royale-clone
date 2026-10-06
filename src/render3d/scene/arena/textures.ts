/**
 * Painted canvas textures for the arena: tower brick per variant, the
 * trophy-road court floor and the Islamic zellige floor.
 */
import * as THREE from "three";
import { ARENA_HEIGHT, ARENA_WIDTH, BRIDGE_XS } from "../../../game/arena";
import { ARABIC_LOOK, type BrickVariant } from "../../arenaLooks";
import { LOOK } from "../common";

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

/** Classic CR floor: saturated checker grass with subtle mown variation. */
/**
 * CR lantern-arena floor: pale parchment tiles with a fine grid, worn
 * winding dirt paths from each bridge toward the towers (baked in, so
 * they curve organically like the reference), scattered pebbles, and
 * broken-plank decals in the corners.
 */
export function makeStoneTexture(): THREE.CanvasTexture {
  // Trophy-road court: checker tiles, straight lanes linking bridges and
  // tower rows, an optional crown watermark, and look-specific scatter
  // (confetti, pebbles, grass tufts, bones, embers, snow, crystals).
  const F = LOOK.floor;
  const tile = 48; // px per arena unit -> 1-unit tiles like CR's grid
  const px = tile / 32; // scale for stroke widths tuned at 32px/unit
  const c = document.createElement("canvas");
  c.width = ARENA_WIDTH * tile;
  c.height = ARENA_HEIGHT * tile;
  const ctx = c.getContext("2d")!;
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return ((seed >>> 8) & 0xffff) / 0xffff;
  };

  for (let ty = 0; ty < ARENA_HEIGHT; ty++) {
    for (let tx = 0; tx < ARENA_WIDTH; tx++) {
      const x = tx * tile, y = ty * tile;
      ctx.fillStyle = (tx + ty) % 2 === 0 ? F.a : F.b;
      ctx.fillRect(x, y, tile, tile);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      const h = tile / 2;
      ctx.fillRect(x, y, h, h);
      ctx.fillRect(x + h, y + h, h, h);
      // Painted bevel: every tile lit along its top/left edge and shaded
      // along its bottom/right, so the court reads as laid stone.
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(x, y, tile, 2 * px);
      ctx.fillRect(x, y, 2 * px, tile);
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      ctx.fillRect(x, y + tile - 2 * px, tile, 2 * px);
      ctx.fillRect(x + tile - 2 * px, y, 2 * px, tile);
      ctx.strokeStyle = F.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    }
  }
  // Soft painterly mottling across the whole court.
  for (let i = 0; i < 520; i++) {
    const r = (6 + rand() * 18) * px;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const dark = rand() < 0.55;
    g.addColorStop(0, dark ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(rand() * c.width, rand() * c.height);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // Ambient occlusion where the court meets its walls.
  const ao = (x0: number, y0: number, x1: number, y1: number, w: number, hgt: number): void => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, hgt);
  };
  const edge = tile * 1.1;
  ao(0, 0, edge, 0, edge, c.height);
  ao(c.width, 0, c.width - edge, 0, edge, c.height);
  ao(0, 0, 0, edge, c.width, edge);
  ao(0, c.height, 0, c.height - edge, c.width, edge);

  if (F.watermark) {
    const watermark = (cy: number): void => {
      ctx.save();
      ctx.strokeStyle = F.watermark!;
      ctx.lineWidth = 9 * px;
      const cx = c.width / 2;
      const R = 4.1 * tile;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 7 * px;
      const w = R * 0.95, hgt = R * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy + hgt * 0.4);
      ctx.lineTo(cx + w / 2, cy + hgt * 0.4);
      ctx.moveTo(cx - w / 2, cy + hgt * 0.4);
      ctx.lineTo(cx - w / 2, cy - hgt * 0.25);
      ctx.lineTo(cx - w / 6, cy + hgt * 0.05);
      ctx.lineTo(cx, cy - hgt * 0.55);
      ctx.lineTo(cx + w / 6, cy + hgt * 0.05);
      ctx.lineTo(cx + w / 2, cy - hgt * 0.25);
      ctx.lineTo(cx + w / 2, cy + hgt * 0.4);
      ctx.stroke();
      ctx.restore();
    };
    watermark(c.height * 0.25);
    watermark(c.height * 0.75);
  }

  const lane = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = F.lane;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = F.laneEdge;
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(x + px, y + px, w - 2 * px, h - 2 * px);
  };
  const laneW = 1.7 * tile;
  const rowY = [6.5, ARENA_HEIGHT - 6.5];
  for (const bx of BRIDGE_XS) {
    lane(bx * tile - laneW / 2, rowY[0] * tile - laneW / 2, laneW, (rowY[1] - rowY[0]) * tile + laneW);
  }
  for (const ry of rowY) {
    lane(BRIDGE_XS[0] * tile - laneW / 2, ry * tile - laneW / 2, (BRIDGE_XS[1] - BRIDGE_XS[0]) * tile + laneW, laneW);
  }

  // Look-specific scatter across the court.
  const scatterRect = (colors: string[], n: number, w: number, h: number, alpha: number): void => {
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(rand() * c.width, rand() * c.height);
      ctx.rotate(rand() * Math.PI);
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.globalAlpha = alpha;
      ctx.fillRect(-w * px / 2, -h * px / 2, w * px, h * px);
      ctx.restore();
    }
  };
  const scatterDot = (colors: string[], n: number, r0: number, r1: number, alpha: number): void => {
    for (let i = 0; i < n; i++) {
      const r = (r0 + rand() * (r1 - r0)) * px;
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.ellipse(rand() * c.width, rand() * c.height, r, r * 0.75, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
  switch (F.scatter) {
    case "confetti":
      scatterRect(["#e0455a", "#3b6fe0", "#59d6c8", "#f2c14e", "#e055c8"], 44, 14, 4.4, 0.85);
      break;
    case "pebbles":
      scatterDot(["rgba(148,132,104,1)", "rgba(120,102,78,1)"], 46, 1.5, 4.5, 0.55);
      break;
    case "grass":
      // Mown-stripe hint + tufts.
      scatterRect(["rgba(255,255,255,1)"], 0, 0, 0, 0);
      for (let i = 0; i < 70; i++) {
        const x = rand() * c.width, y = rand() * c.height;
        ctx.strokeStyle = "rgba(40,100,30,0.55)";
        ctx.lineWidth = 1.6 * px;
        for (const dx of [-2, 0, 2]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + dx * px, y - (5 + rand() * 3) * px);
          ctx.stroke();
        }
      }
      break;
    case "bones":
      scatterRect(["#f0e8d8", "#e2d8c0"], 22, 16, 3.5, 0.9);
      scatterDot(["#f0e8d8"], 24, 2, 4, 0.9);
      break;
    case "embers":
      scatterDot(["#ff8a3a", "#ffc46b", "#ff5340"], 60, 1, 2.6, 0.85);
      break;
    case "snow":
      scatterDot(["rgba(255,255,255,1)"], 80, 1.5, 5, 0.7);
      break;
    case "crystals": {
      for (let i = 0; i < 26; i++) {
        ctx.save();
        ctx.translate(rand() * c.width, rand() * c.height);
        ctx.rotate(rand() * Math.PI);
        ctx.fillStyle = rand() < 0.5 ? "#d8c8ff" : "#b08aff";
        ctx.globalAlpha = 0.85;
        const r = (4 + rand() * 4) * px;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.5, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Islamic zellige floor: 8-point-star-and-cross tilework, gold strapwork. */
export function makeZelligeTexture(): THREE.CanvasTexture {
  const tile = 32; // px per arena unit
  const c = document.createElement("canvas");
  c.width = ARENA_WIDTH * tile;
  c.height = ARENA_HEIGHT * tile;
  const ctx = c.getContext("2d")!;

  const Z = LOOK.islamic ?? ARABIC_LOOK.islamic!;
  // Pale plaster base — kept light so the units read clearly on top.
  ctx.fillStyle = Z.plaster;
  ctx.fillRect(0, 0, c.width, c.height);

  const cell = tile * 4; // one star motif every 4 arena units
  const R = cell * 0.46;
  const inner = R * 0.41;
  const star8 = (cx: number, cy: number, o: number, i2: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI / 8) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? o : i2;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  const diamond = (cx: number, cy: number, s: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
  };

  ctx.lineJoin = "round";
  // Everything is drawn as a faint tint + thin strapwork so the pattern
  // stays a quiet "watermark" the troops read clearly against.
  for (let y = 0; y <= c.height; y += cell) {
    for (let x = 0; x <= c.width; x += cell) {
      diamond(x, y, cell * 0.2);
      ctx.fillStyle = Z.diamond;
      ctx.fill();
      ctx.strokeStyle = `rgba(${Z.strap},0.20)`;
      ctx.lineWidth = tile * 0.05;
      ctx.stroke();
    }
  }
  for (let y = cell / 2; y < c.height; y += cell) {
    for (let x = cell / 2; x < c.width; x += cell) {
      star8(x, y, R, inner);
      ctx.fillStyle = Z.star;
      ctx.fill();
      ctx.strokeStyle = `rgba(${Z.strap},0.28)`;
      ctx.lineWidth = tile * 0.06;
      ctx.stroke();
    }
  }
  // Whisper-faint gold lattice for the interlaced look.
  ctx.strokeStyle = `rgba(${Z.strap},0.07)`;
  ctx.lineWidth = tile * 0.04;
  for (let x = cell / 2; x < c.width; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  for (let y = cell / 2; y < c.height; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
