import { createBattle, deployCard, type BattleState } from "./game/battle";
import { createBot, tickBot, type BotState } from "./game/bot";
import { tick } from "./game/sim";
import {
  CANVAS_H,
  CANVAS_W,
  canvasToArena,
  cardRects,
  inArenaPixels,
  pointInRect,
} from "./render/layout";
import { render, type UiState } from "./render/renderer";

const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
// Fit tall screens without scrolling.
canvas.style.height = "min(96vh, " + CANVAS_H + "px)";
canvas.style.width = "auto";
const ctx = canvas.getContext("2d")!;

let battle: BattleState = createBattle();
let bot: BotState = createBot(Date.now() & 0xffff);
const ui: UiState = { selectedCard: null, hover: null };

function restart(): void {
  battle = createBattle();
  bot = createBot(Date.now() & 0xffff);
  ui.selectedCard = null;
  ui.hover = null;
}

function canvasPoint(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * CANVAS_W,
    y: ((ev.clientY - rect.top) / rect.height) * CANVAS_H,
  };
}

canvas.addEventListener("click", (ev) => {
  const p = canvasPoint(ev);
  if (battle.result) {
    restart();
    return;
  }
  // Card selection.
  const rects = cardRects();
  for (let i = 0; i < rects.length; i++) {
    if (pointInRect(p.x, p.y, rects[i])) {
      const id = battle.player.hand.cards[i];
      ui.selectedCard = ui.selectedCard === id ? null : id;
      return;
    }
  }
  // Deployment.
  if (ui.selectedCard && inArenaPixels(p.y)) {
    const a = canvasToArena(p.x, p.y);
    if (deployCard(battle, "player", ui.selectedCard, a.x, a.y)) {
      ui.selectedCard = null;
    }
  }
});

canvas.addEventListener("mousemove", (ev) => {
  const p = canvasPoint(ev);
  ui.hover = inArenaPixels(p.y) ? canvasToArena(p.x, p.y) : null;
});

canvas.addEventListener("mouseleave", () => {
  ui.hover = null;
});

// Number keys select cards, Escape deselects.
window.addEventListener("keydown", (ev) => {
  const n = Number(ev.key);
  if (n >= 1 && n <= 4) ui.selectedCard = battle.player.hand.cards[n - 1];
  if (ev.key === "Escape") ui.selectedCard = null;
});

const SIM_DT = 1 / 30;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= SIM_DT) {
    tick(battle, SIM_DT);
    tickBot(battle, bot, SIM_DT);
    acc -= SIM_DT;
  }
  render(ctx, battle, ui);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
