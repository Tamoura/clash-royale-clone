import type { CardId } from "../game/cards";

/**
 * Hand-drawn vector characters, replacing emoji placeholders.
 * Each troop is designed in a local space where the unit's radius is
 * 10 units; callers translate/scale so designs stay resolution-free.
 */
export interface Anim {
  /** Vertical hop offset in design units while walking. */
  bob: number;
  /** 1 right after an attack, decaying to 0 — drives weapon swings. */
  swing: number;
  /** Mirror the character (enemy units face the other way). */
  flip: boolean;
}

export const STILL: Anim = { bob: 0, swing: 0, flip: false };

const SKIN = "#f6c9a0";
const OUTLINE = "rgba(20,26,38,0.45)";

type Ctx = CanvasRenderingContext2D;

function outlined(ctx: Ctx, fill: string, draw: () => void): void {
  draw();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  outlined(ctx, fill, () => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  });
}

function box(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  outlined(ctx, fill, () => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  });
}

function eyes(ctx: Ctx, y: number, dx = 1.8, r = 0.8): void {
  ctx.fillStyle = "#1f2430";
  ctx.beginPath();
  ctx.arc(-dx, y, r, 0, Math.PI * 2);
  ctx.arc(dx, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawKnight(ctx: Ctx, anim: Anim): void {
  // Sword arm behind the torso, swinging forward on attack.
  ctx.save();
  ctx.translate(6, 1);
  ctx.rotate(0.6 - anim.swing * 1.5);
  box(ctx, -1, -11, 2.4, 9, 1, "#cfd8e3"); // blade
  box(ctx, -2.6, -2.6, 5.6, 2, 1, "#8d6e63"); // guard
  circle(ctx, 0, 1, 1.6, "#6d4c41"); // pommel hand
  ctx.restore();

  box(ctx, -5.5, -1, 11, 9, 3, "#54606f"); // armored torso
  box(ctx, -5.5, 5.2, 11, 2.2, 1, "#3a2a1c"); // belt
  circle(ctx, 0, -5, 5.6, SKIN); // head
  outlined(ctx, "#94a1ae", () => {
    // helmet dome
    ctx.beginPath();
    ctx.arc(0, -6, 5.9, Math.PI, 0);
    ctx.closePath();
  });
  box(ctx, -0.9, -6.5, 1.8, 4.5, 0.8, "#94a1ae"); // nose guard
  eyes(ctx, -3.6);
  // mustache
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(-2, -0.8, 2, Math.PI * 0.15, Math.PI * 0.85);
  ctx.moveTo(4, -0.8);
  ctx.arc(2, -0.8, 2, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}

function drawArcher(ctx: Ctx, anim: Anim): void {
  // Bow held out front; arrow nocks back on attack.
  ctx.save();
  ctx.translate(-6.2, -1);
  ctx.strokeStyle = "#8d6e63";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, 6, -Math.PI * 0.38, Math.PI * 0.38); // bow limb
  ctx.stroke();
  ctx.strokeStyle = "#e8e3d8";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  const tipY = 6 * Math.sin(Math.PI * 0.38);
  const tipX = 6 * Math.cos(Math.PI * 0.38);
  ctx.moveTo(tipX, -tipY);
  ctx.lineTo(anim.swing * 3, 0); // string draws back
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  if (anim.swing > 0.1) {
    ctx.strokeStyle = "#c8b89a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(anim.swing * 3, 0);
    ctx.lineTo(-4, 0);
    ctx.stroke();
  }
  ctx.restore();

  box(ctx, -4.5, -1, 9, 8, 3, "#2e7d32"); // tunic
  circle(ctx, 0, -5, 5, SKIN); // head
  outlined(ctx, "#ec5fa3", () => {
    // pink hair
    ctx.beginPath();
    ctx.arc(0, -6, 5.3, Math.PI * 0.95, Math.PI * 0.05);
    ctx.closePath();
  });
  circle(ctx, 4.8, -8.2, 2, "#ec5fa3"); // bun
  eyes(ctx, -4);
}

function drawGiant(ctx: Ctx, anim: Anim): void {
  // Fists; the leading one punches forward on attack.
  circle(ctx, -8.2, 3, 2.6, SKIN);
  circle(ctx, 8.2, 3 - anim.swing * 4, 2.8, SKIN);

  box(ctx, -7.5, -3, 15, 12, 5, "#c98850"); // barrel torso
  box(ctx, -2, 3, 4.5, 3.5, 1, "#a96f3d"); // patch
  ctx.strokeStyle = "rgba(20,26,38,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(0, 2); // shirt seam
  ctx.stroke();
  circle(ctx, 0, -7.5, 6, SKIN); // bald head
  outlined(ctx, "#8a5a35", () => {
    // beard around the jaw
    ctx.beginPath();
    ctx.arc(0, -6.2, 5.6, Math.PI * 0.12, Math.PI * 0.88);
    ctx.closePath();
  });
  eyes(ctx, -8.4);
  // heavy brow
  ctx.strokeStyle = "#5d3d22";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-3.6, -10.4);
  ctx.lineTo(-0.6, -9.8);
  ctx.moveTo(3.6, -10.4);
  ctx.lineTo(0.6, -9.8);
  ctx.stroke();
}

function drawMusketeer(ctx: Ctx, anim: Anim): void {
  // Musket across the front, kicking up on fire.
  ctx.save();
  ctx.translate(1, 0.5);
  ctx.rotate(-0.5 - anim.swing * 0.25);
  box(ctx, -3, -1.2, 7, 2.4, 1, "#6d4c41"); // stock
  box(ctx, 3.5, -0.8, 8.5, 1.6, 0.8, "#9aa3ad"); // barrel
  if (anim.swing > 0.35) {
    circle(ctx, 13.2, 0, 2.2 * anim.swing, "#ffb74d"); // muzzle flash
  }
  ctx.restore();

  box(ctx, -5, -1, 10, 9, 3, "#3f51b5"); // coat
  box(ctx, -5, 3.2, 10, 1.6, 0.8, "#283593"); // sash
  circle(ctx, 0, -5.5, 5, SKIN); // head
  outlined(ctx, "#263238", () => {
    // wide-brim hat
    ctx.beginPath();
    ctx.ellipse(0, -8.2, 7.4, 2.1, 0, 0, Math.PI * 2);
  });
  outlined(ctx, "#263238", () => {
    ctx.beginPath();
    ctx.arc(0, -8.4, 4.2, Math.PI, 0);
    ctx.closePath();
  });
  ctx.strokeStyle = "#e53935"; // feather
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(4, -11.5, 3.4, Math.PI * 0.6, Math.PI * 1.1);
  ctx.stroke();
  eyes(ctx, -4.6);
}

function drawMiniPekka(ctx: Ctx, anim: Anim): void {
  // Cleaver behind, chopping on attack.
  ctx.save();
  ctx.translate(6.4, -2);
  ctx.rotate(0.5 - anim.swing * 1.8);
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.lineTo(-3.4, -9);
    ctx.lineTo(2.8, -9);
    ctx.lineTo(1.6, 0);
    ctx.closePath();
  });
  box(ctx, -1.2, 0, 2.4, 3.4, 1, "#6d4c41"); // handle
  ctx.restore();

  box(ctx, -5, -2, 10, 9, 2, "#202b3d"); // metal body
  box(ctx, -5.6, -11.5, 11.2, 9, 2.5, "#26334a"); // helmet head
  // horns
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.moveTo(-5, -10);
    ctx.lineTo(-8.4, -14);
    ctx.lineTo(-3.4, -11.5);
    ctx.closePath();
  });
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.moveTo(5, -10);
    ctx.lineTo(8.4, -14);
    ctx.lineTo(3.4, -11.5);
    ctx.closePath();
  });
  // glowing eye
  ctx.save();
  ctx.shadowColor = "#4fd8ff";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#4fd8ff";
  ctx.beginPath();
  ctx.arc(0, -7, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  box(ctx, -3.5, 1, 7, 1.4, 0.7, "#10141c"); // chest slit
}

function drawSkeleton(ctx: Ctx, anim: Anim): void {
  // Tiny bone sword.
  ctx.save();
  ctx.translate(5, 0);
  ctx.rotate(0.5 - anim.swing * 1.4);
  box(ctx, -0.8, -7, 1.6, 7, 0.8, "#e8e3d8");
  box(ctx, -2, -1.2, 4, 1.4, 0.7, "#bdb4a2");
  ctx.restore();

  // ribcage
  ctx.strokeStyle = "#f5f2ea";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(-3.4, 0.5 + i * 2.2);
    ctx.lineTo(3.4, 0.5 + i * 2.2);
  }
  ctx.moveTo(0, -1);
  ctx.lineTo(0, 6.5); // spine
  ctx.stroke();
  circle(ctx, 0, -4.5, 4.6, "#f5f2ea"); // skull
  ctx.fillStyle = "#1f2430";
  ctx.beginPath();
  ctx.arc(-1.8, -5, 1.2, 0, Math.PI * 2);
  ctx.arc(1.8, -5, 1.2, 0, Math.PI * 2);
  ctx.fill();
  box(ctx, -1.6, -2.4, 3.2, 1.6, 0.6, "#dcd6c8"); // jaw
}

function drawWizard(ctx: Ctx, _anim: Anim): void {
  // fire orb
  ctx.save();
  ctx.translate(-6.5, 0);
  const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 3);
  g.addColorStop(0, "#ffe082");
  g.addColorStop(1, "#ff6a00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  box(ctx, -4.5, -1, 9, 9, 3, "#7c3aed"); // robe
  box(ctx, -4.5, 2.4, 9, 1.6, 0.8, "#f2c14e"); // sash
  circle(ctx, 0, -5, 5, SKIN); // head
  box(ctx, -2.4, -2.4, 4.8, 3, 1.4, "#e8e3d8"); // beard
  outlined(ctx, "#5b21b6", () => {
    // hat
    ctx.beginPath();
    ctx.moveTo(-7, -7.5);
    ctx.lineTo(7, -7.5);
    ctx.lineTo(1.5, -8.8);
    ctx.lineTo(0.5, -14);
    ctx.lineTo(-3.5, -8.8);
    ctx.closePath();
  });
  eyes(ctx, -5);
}

function drawBabyDragon(ctx: Ctx, _anim: Anim): void {
  // wings
  for (const s of [-1, 1]) {
    outlined(ctx, "#81c784", () => {
      ctx.beginPath();
      ctx.moveTo(s * 4, -3);
      ctx.quadraticCurveTo(s * 11, -8, s * 9, 1);
      ctx.closePath();
    });
  }
  circle(ctx, 0, 0, 6.5, "#4caf50"); // body/head
  box(ctx, -2.6, 1.5, 5.2, 3, 1.4, "#66bb6a"); // snout
  ctx.strokeStyle = "#2e7d32";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-2, 3.4);
  ctx.lineTo(2, 3.4);
  ctx.stroke();
  outlined(ctx, "#a5d6a7", () => {
    ctx.beginPath();
    ctx.moveTo(-2.5, -6);
    ctx.lineTo(-3.6, -9);
    ctx.lineTo(-0.9, -6.6);
    ctx.closePath();
  });
  outlined(ctx, "#a5d6a7", () => {
    ctx.beginPath();
    ctx.moveTo(2.5, -6);
    ctx.lineTo(3.6, -9);
    ctx.lineTo(0.9, -6.6);
    ctx.closePath();
  });
  eyes(ctx, -1.5, 2.4, 1);
}

function drawGargoyle(ctx: Ctx, _anim: Anim): void {
  for (const s of [-1, 1]) {
    outlined(ctx, "#4b5563", () => {
      ctx.beginPath();
      ctx.moveTo(s * 3, -2);
      ctx.quadraticCurveTo(s * 10, -7, s * 8, 2);
      ctx.closePath();
    });
  }
  box(ctx, -3.2, -1, 6.4, 7, 2.5, "#6b7280"); // body
  circle(ctx, 0, -4.5, 4.4, "#7b8494"); // head
  outlined(ctx, "#4b5563", () => {
    ctx.beginPath();
    ctx.moveTo(-2, -8);
    ctx.lineTo(-3.2, -11);
    ctx.lineTo(-0.6, -8.6);
    ctx.closePath();
  });
  outlined(ctx, "#4b5563", () => {
    ctx.beginPath();
    ctx.moveTo(2, -8);
    ctx.lineTo(3.2, -11);
    ctx.lineTo(0.6, -8.6);
    ctx.closePath();
  });
  // glowing eyes
  ctx.fillStyle = "#ffd54f";
  ctx.beginPath();
  ctx.arc(-1.7, -5, 1, 0, Math.PI * 2);
  ctx.arc(1.7, -5, 1, 0, Math.PI * 2);
  ctx.fill();
}

function drawValkyrie(ctx: Ctx, _anim: Anim): void {
  // axe at the side
  ctx.save();
  ctx.translate(6.5, -1);
  box(ctx, -0.7, -6, 1.4, 11, 0.7, "#6d4c41"); // haft
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.arc(0, -5.5, 3.4, Math.PI * 0.6, Math.PI * 1.4);
    ctx.closePath();
  });
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.arc(0, -5.5, 3.4, Math.PI * 1.6, Math.PI * 0.4);
    ctx.closePath();
  });
  ctx.restore();

  box(ctx, -4.5, -1, 9, 8, 3, "#b71c1c"); // dress
  circle(ctx, 0, -5, 5, SKIN); // head
  outlined(ctx, "#e07b39", () => {
    // hair
    ctx.beginPath();
    ctx.arc(0, -6, 5.3, Math.PI * 0.95, Math.PI * 0.05);
    ctx.closePath();
  });
  box(ctx, -6.4, -6, 2, 7, 1, "#e07b39"); // braid
  eyes(ctx, -4);
}

function drawPrince(ctx: Ctx, _anim: Anim): void {
  // lance
  ctx.save();
  ctx.translate(5, 2);
  ctx.rotate(-0.8);
  box(ctx, -0.8, -10, 1.6, 12, 0.8, "#d7ccc8");
  outlined(ctx, "#b7c2cc", () => {
    ctx.beginPath();
    ctx.moveTo(-1.4, -10);
    ctx.lineTo(0, -13.5);
    ctx.lineTo(1.4, -10);
    ctx.closePath();
  });
  ctx.restore();

  box(ctx, -4.5, -0.5, 9, 8, 3, "#fafafa"); // tabard
  box(ctx, -4.5, 1.6, 9, 1.6, 0.8, "#f2c14e"); // gold trim
  circle(ctx, 0, -5, 5, SKIN); // head
  outlined(ctx, "#f2c14e", () => {
    // gold helmet
    ctx.beginPath();
    ctx.arc(0, -6, 5.4, Math.PI, 0);
    ctx.closePath();
  });
  ctx.strokeStyle = "#e53935"; // plume
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(3.4, -11, 3.2, Math.PI * 0.55, Math.PI * 1.05);
  ctx.stroke();
  eyes(ctx, -4.2);
}

function drawCannon(ctx: Ctx, _anim: Anim): void {
  // wheels
  circle(ctx, -4, 5.5, 2.6, "#4e342e");
  circle(ctx, 4, 5.5, 2.6, "#4e342e");
  circle(ctx, -4, 5.5, 1, "#8d6e63");
  circle(ctx, 4, 5.5, 1, "#8d6e63");
  box(ctx, -6, 2.5, 12, 2.4, 1.2, "#8d6e63"); // carriage
  // barrel angled up-right
  ctx.save();
  ctx.translate(0, 1);
  ctx.rotate(-0.5);
  box(ctx, -2.5, -8.5, 5, 9, 2, "#37474f");
  box(ctx, -3, -9.5, 6, 1.8, 0.9, "#263238"); // muzzle rim
  ctx.restore();
  circle(ctx, 0, 2, 2.6, "#263238"); // breech
}

const TROOP_PAINTERS: Partial<Record<CardId, (ctx: Ctx, anim: Anim) => void>> = {
  knight: drawKnight,
  archers: drawArcher,
  giant: drawGiant,
  musketeer: drawMusketeer,
  "mini-pekka": drawMiniPekka,
  skeletons: drawSkeleton,
  wizard: drawWizard,
  "baby-dragon": drawBabyDragon,
  gargoyles: drawGargoyle,
  valkyrie: drawValkyrie,
  prince: drawPrince,
  cannon: drawCannon,
};

/**
 * Draw a troop centered at (x, y) with pixel radius r.
 * `teamColor` paints the ground ring so sides stay readable.
 */
export function drawTroopCharacter(
  ctx: Ctx,
  cardId: CardId,
  x: number,
  y: number,
  r: number,
  teamColor: string,
  anim: Anim,
): void {
  const painter = TROOP_PAINTERS[cardId];
  if (!painter) return;

  // Ground shadow + team ring.
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.translate(x, y - anim.bob * (r / 10));
  const s = r / 10;
  ctx.scale(anim.flip ? -s : s, s);
  painter(ctx, anim);
  ctx.restore();
}

function drawFireballArt(ctx: Ctx): void {
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
  g.addColorStop(0, "#ffe082");
  g.addColorStop(0.55, "#ff9800");
  g.addColorStop(1, "#e64a19");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  // trailing flames
  ctx.fillStyle = "rgba(255,152,0,0.75)";
  ctx.beginPath();
  ctx.moveTo(-6, -5.5);
  ctx.quadraticCurveTo(-13, -9, -9, -1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-7, 3);
  ctx.quadraticCurveTo(-14, 5, -8, 6.5);
  ctx.closePath();
  ctx.fill();
}

function drawArrowsArt(ctx: Ctx): void {
  ctx.strokeStyle = "#8d6e63";
  ctx.lineWidth = 1.8;
  for (const dx of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(dx + 4, -8);
    ctx.lineTo(dx - 3, 6);
    ctx.stroke();
    // head
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath();
    ctx.moveTo(dx - 3.8, 8.2);
    ctx.lineTo(dx - 4.2, 4.4);
    ctx.lineTo(dx - 0.8, 5.8);
    ctx.closePath();
    ctx.fill();
    // fletching
    ctx.strokeStyle = "#e53935";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(dx + 4, -8);
    ctx.lineTo(dx + 6.5, -9.5);
    ctx.moveTo(dx + 4, -8);
    ctx.lineTo(dx + 2, -10.5);
    ctx.stroke();
    ctx.strokeStyle = "#8d6e63";
    ctx.lineWidth = 1.8;
  }
}

/** Static portrait used for HUD card slots and the next-card preview. */
export function drawCardArt(
  ctx: Ctx,
  cardId: CardId,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  if (cardId === "fireball") drawFireballArt(ctx);
  else if (cardId === "arrows") drawArrowsArt(ctx);
  else TROOP_PAINTERS[cardId]?.(ctx, STILL);
  ctx.restore();
}
