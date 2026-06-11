import {
  ARENA_HEIGHT,
  BRIDGE_XS,
  RIVER_Y,
  type Side,
} from "../game/arena";
import { distance, type BattleState, type Entity } from "../game/battle";
import { ELIXIR_MAX } from "../game/elixir";
import { getCard, type CardId } from "../game/cards";
import { BATTLE_DURATION, OVERTIME_DURATION, isDoubleElixir } from "../game/sim";
import { drawCardArt, drawTroopCharacter, type Anim } from "./characters";
import {
  ARENA_PX_H,
  ARENA_PX_W,
  BOTTOM_BAR,
  CANVAS_H,
  CANVAS_W,
  TILE,
  TOP_BAR,
  arenaToCanvas,
  cardRects,
  nextCardRect,
} from "./layout";

export interface UiState {
  selectedCard: CardId | null;
  /** Arena-space hover position while a card is selected. */
  hover: { x: number; y: number } | null;
}

const SIDE_COLOR: Record<Side, string> = {
  player: "#3b82f6",
  enemy: "#ef4444",
};
const SIDE_DARK: Record<Side, string> = {
  player: "#1d4ed8",
  enemy: "#b91c1c",
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawArena(ctx: CanvasRenderingContext2D): void {
  // Grass, slightly different per half.
  ctx.fillStyle = "#4c9e4f";
  ctx.fillRect(0, TOP_BAR, ARENA_PX_W, ARENA_PX_H / 2);
  ctx.fillStyle = "#55a858";
  ctx.fillRect(0, TOP_BAR + ARENA_PX_H / 2, ARENA_PX_W, ARENA_PX_H / 2);

  // Checker texture.
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let ty = 0; ty < ARENA_HEIGHT; ty++) {
    for (let tx = ty % 2; tx < 18; tx += 2) {
      ctx.fillRect(tx * TILE, TOP_BAR + ty * TILE, TILE, TILE);
    }
  }

  // River.
  const river = arenaToCanvas(0, RIVER_Y - 1);
  ctx.fillStyle = "#3b82c4";
  ctx.fillRect(0, river.y, ARENA_PX_W, 2 * TILE);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(i * 2 * TILE + 6, river.y + 10 + (i % 3) * 12, 22, 3);
  }

  // Bridges.
  for (const bx of BRIDGE_XS) {
    const p = arenaToCanvas(bx - 1, RIVER_Y - 1.2);
    ctx.fillStyle = "#9a6b3f";
    roundRect(ctx, p.x, p.y, 2 * TILE, 2.4 * TILE, 6);
    ctx.fill();
    ctx.strokeStyle = "#6e4a28";
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + (i * 2.4 * TILE) / 5);
      ctx.lineTo(p.x + 2 * TILE, p.y + (i * 2.4 * TILE) / 5);
      ctx.stroke();
    }
  }
}

function drawDeployZone(ctx: CanvasRenderingContext2D, ui: UiState): void {
  if (!ui.selectedCard) return;
  const card = getCard(ui.selectedCard);
  if (card.kind === "troop") {
    const top = arenaToCanvas(0, RIVER_Y + 1);
    ctx.fillStyle = "rgba(59,130,246,0.12)";
    ctx.fillRect(0, top.y, ARENA_PX_W, TOP_BAR + ARENA_PX_H - top.y);
  }
  if (ui.hover) {
    const p = arenaToCanvas(ui.hover.x, ui.hover.y);
    const r = card.kind === "spell" ? card.radius * TILE : 14;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle =
      card.kind === "spell" ? "rgba(255,140,0,0.25)" : "rgba(255,255,255,0.25)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawHpBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  frac: number,
  color: string,
): void {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(cx - w / 2, cy, w, 5);
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, cy, w * Math.max(0, frac), 5);
}

function drawCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
): void {
  const h = w * 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy - h * 0.2);
  ctx.lineTo(cx - w / 4, cy + h * 0.05);
  ctx.lineTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 4, cy + h * 0.05);
  ctx.lineTo(cx + w / 2, cy - h * 0.2);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.closePath();
  ctx.fillStyle = "#fbbf24";
  ctx.fill();
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTower(ctx: CanvasRenderingContext2D, e: Entity): void {
  const p = arenaToCanvas(e.x, e.y);
  const r = e.radius * TILE;
  const king = e.kind === "king-tower";
  const stone = king ? "#a89884" : "#b8a98f";
  const stoneDark = king ? "#8b7c69" : "#9c8d74";

  // Drop shadow.
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + r * 0.95, r * 1.05, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();

  // Stone body.
  ctx.fillStyle = stone;
  roundRect(ctx, p.x - r, p.y - r * 0.75, 2 * r, 1.75 * r, 4);
  ctx.fill();
  ctx.strokeStyle = stoneDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Stone seams.
  ctx.strokeStyle = "rgba(90,75,55,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    const y = p.y - r * 0.75 + (i * 1.75 * r) / 3;
    ctx.moveTo(p.x - r, y);
    ctx.lineTo(p.x + r, y);
  }
  ctx.moveTo(p.x - r * 0.33, p.y - r * 0.75);
  ctx.lineTo(p.x - r * 0.33, p.y - r * 0.75 + (1.75 * r) / 3);
  ctx.moveTo(p.x + r * 0.33, p.y - r * 0.17);
  ctx.lineTo(p.x + r * 0.33, p.y + r * 0.42);
  ctx.stroke();

  // Crenellated top.
  const topY = p.y - r;
  ctx.fillStyle = stoneDark;
  roundRect(ctx, p.x - r * 1.08, topY, 2.16 * r, r * 0.32, 2);
  ctx.fill();
  ctx.fillStyle = stone;
  const merlonW = (2.16 * r) / 5;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(
      p.x - r * 1.08 + (2 * i + 0.35) * merlonW,
      topY - r * 0.22,
      merlonW * 1.3,
      r * 0.24,
    );
  }

  // Door at the base.
  const doorY = p.y + r * 0.4;
  ctx.fillStyle = "#4a3826";
  ctx.beginPath();
  ctx.arc(p.x, doorY + r * 0.28, r * 0.28, Math.PI, 0);
  ctx.lineTo(p.x + r * 0.28, doorY + r * 0.6);
  ctx.lineTo(p.x - r * 0.28, doorY + r * 0.6);
  ctx.closePath();
  ctx.fill();

  // Team banner.
  ctx.fillStyle = SIDE_COLOR[e.side];
  ctx.strokeStyle = SIDE_DARK[e.side];
  ctx.lineWidth = 1;
  const fx = p.x - r * 0.95;
  ctx.beginPath();
  ctx.moveTo(fx, topY - r * 0.55);
  ctx.lineTo(fx + r * 0.5, topY - r * 0.38);
  ctx.lineTo(fx, topY - r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#5a4632";
  ctx.beginPath();
  ctx.moveTo(fx, topY - r * 0.55);
  ctx.lineTo(fx, topY);
  ctx.stroke();

  // King status: crown when awake, Zzz while asleep.
  if (king) {
    if (e.active) {
      drawCrown(ctx, p.x, p.y - r * 0.45, r * 0.85);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `bold ${Math.round(r * 0.5)}px 'Trebuchet MS', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("z z", p.x, p.y - r * 0.4);
    }
  }

  drawHpBar(ctx, p.x, topY - r * 0.22 - 10, 2 * r, e.hp / e.maxHp, SIDE_COLOR[e.side]);
}

/** Swing lasts this long after each hit. */
const SWING_TIME = 0.3;

function troopAnim(state: BattleState, e: Entity): Anim {
  const target = state.entities.find((o) => o.id === e.targetId);
  const inRange =
    !!target &&
    distance(e, target) - e.radius - target.radius <= e.attackRange + 0.05;
  const swing =
    e.cooldown > e.hitSpeed - SWING_TIME
      ? (e.cooldown - (e.hitSpeed - SWING_TIME)) / SWING_TIME
      : 0;
  return {
    bob: inRange ? 0 : Math.abs(Math.sin(state.time * 9 + e.id * 1.7)) * 1.6,
    swing,
    flip: e.side === "enemy",
  };
}

function drawTroop(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  e: Entity,
): void {
  const p = arenaToCanvas(e.x, e.y);
  const r = Math.max(9, e.radius * TILE);
  if (!e.cardId) return;
  drawTroopCharacter(ctx, e.cardId, p.x, p.y, r, SIDE_COLOR[e.side], troopAnim(state, e));
  if (e.hp < e.maxHp) {
    drawHpBar(ctx, p.x, p.y - r * 1.6 - 6, 2 * r, e.hp / e.maxHp, SIDE_COLOR[e.side]);
  }
}

function drawEffects(ctx: CanvasRenderingContext2D, state: BattleState): void {
  for (const f of state.effects) {
    const p = arenaToCanvas(f.x, f.y);
    const alpha = Math.max(0, f.ttl / 0.6);
    ctx.beginPath();
    ctx.arc(p.x, p.y, f.radius * TILE, 0, Math.PI * 2);
    ctx.fillStyle =
      f.cardId === "fireball"
        ? `rgba(255,120,20,${0.45 * alpha})`
        : `rgba(220,230,255,${0.5 * alpha})`;
    ctx.fill();
  }
}

function formatClock(state: BattleState): string {
  const total = state.overtime
    ? BATTLE_DURATION + OVERTIME_DURATION
    : BATTLE_DURATION;
  const left = Math.max(0, Math.ceil(total - state.time));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function drawTopBar(ctx: CanvasRenderingContext2D, state: BattleState): void {
  ctx.fillStyle = "#141a26";
  ctx.fillRect(0, 0, CANVAS_W, TOP_BAR);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = state.overtime ? "#f87171" : "#e5e7eb";
  const label = state.overtime ? `OVERTIME ${formatClock(state)}` : formatClock(state);
  ctx.fillText(label, CANVAS_W / 2, TOP_BAR / 2);
  if (isDoubleElixir(state) && !state.overtime) {
    ctx.font = "11px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#d8b4fe";
    ctx.fillText("2x elixir", CANVAS_W / 2, TOP_BAR - 10);
  }
  drawCrown(ctx, 22, TOP_BAR / 2, 18);
  ctx.font = "bold 16px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = SIDE_COLOR.player;
  ctx.textAlign = "left";
  ctx.fillText(String(state.player.crowns), 38, TOP_BAR / 2);
  drawCrown(ctx, CANVAS_W - 22, TOP_BAR / 2, 18);
  ctx.fillStyle = SIDE_COLOR.enemy;
  ctx.textAlign = "right";
  ctx.fillText(String(state.enemy.crowns), CANVAS_W - 38, TOP_BAR / 2);
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  ui: UiState,
): void {
  const top = TOP_BAR + ARENA_PX_H;
  ctx.fillStyle = "#141a26";
  ctx.fillRect(0, top, CANVAS_W, BOTTOM_BAR);

  // Elixir bar.
  const ex = 14;
  const ew = CANVAS_W - 28;
  const ey = top + 8;
  ctx.fillStyle = "#0b0f17";
  roundRect(ctx, ex, ey, ew, 14, 7);
  ctx.fill();
  const amount = state.player.elixir.amount;
  ctx.fillStyle = "#c026d3";
  roundRect(ctx, ex, ey, ew * (amount / ELIXIR_MAX), 14, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  for (let i = 1; i < ELIXIR_MAX; i++) {
    ctx.beginPath();
    ctx.moveTo(ex + (ew * i) / ELIXIR_MAX, ey);
    ctx.lineTo(ex + (ew * i) / ELIXIR_MAX, ey + 14);
    ctx.stroke();
  }
  ctx.font = "bold 12px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.floor(amount)), ex + 14, ey + 7);

  // Next card preview.
  const next = nextCardRect();
  const nextId = state.player.hand.queue[0];
  ctx.fillStyle = "#1f2937";
  roundRect(ctx, next.x, next.y, next.w, next.h, 6);
  ctx.fill();
  drawCardArt(ctx, nextId, next.x + next.w / 2, next.y + next.h / 2 - 2, 18);
  ctx.font = "9px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#9ca3af";
  ctx.fillText("next", next.x + next.w / 2, next.y + next.h - 7);

  // Hand.
  cardRects().forEach((r, i) => {
    const id = state.player.hand.cards[i];
    const card = getCard(id);
    const affordable = card.cost <= amount;
    const selected = ui.selectedCard === id;
    ctx.fillStyle = selected ? "#3b5bdb" : "#273449";
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = affordable ? 1 : 0.4;
    drawCardArt(ctx, id, r.x + r.w / 2, r.y + 38, 30);
    ctx.font = "bold 11px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(card.name, r.x + r.w / 2, r.y + r.h - 26);
    ctx.globalAlpha = 1;
    // Elixir cost badge.
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h - 9, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#c026d3";
    ctx.fill();
    ctx.font = "bold 11px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(String(card.cost), r.x + r.w / 2, r.y + r.h - 8.5);
  });
}

function drawResult(ctx: CanvasRenderingContext2D, state: BattleState): void {
  if (!state.result) return;
  ctx.fillStyle = "rgba(10,14,22,0.78)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const { winner, playerCrowns, enemyCrowns } = state.result;
  const title =
    winner === "player" ? "VICTORY!" : winner === "enemy" ? "DEFEAT" : "DRAW";
  ctx.font = "bold 52px 'Trebuchet MS', sans-serif";
  ctx.fillStyle =
    winner === "player" ? "#facc15" : winner === "enemy" ? "#f87171" : "#e5e7eb";
  ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2 - 50);
  drawCrown(ctx, CANVAS_W / 2 - 80, CANVAS_H / 2 + 4, 26);
  drawCrown(ctx, CANVAS_W / 2 + 80, CANVAS_H / 2 + 4, 26);
  ctx.font = "26px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(`${playerCrowns}  —  ${enemyCrowns}`, CANVAS_W / 2, CANVAS_H / 2 + 4);
  ctx.font = "18px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#93c5fd";
  ctx.fillText("Click anywhere to play again", CANVAS_W / 2, CANVAS_H / 2 + 52);
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  ui: UiState,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawArena(ctx);
  drawDeployZone(ctx, ui);
  const buildings = state.entities.filter((e) => e.kind !== "troop");
  // Draw back-to-front so southern troops overlap northern ones.
  const troops = state.entities
    .filter((e) => e.kind === "troop")
    .sort((a, b) => a.y - b.y);
  for (const t of buildings) drawTower(ctx, t);
  for (const t of troops) drawTroop(ctx, state, t);
  drawEffects(ctx, state);
  drawTopBar(ctx, state);
  drawHud(ctx, state, ui);
  drawResult(ctx, state);
}
