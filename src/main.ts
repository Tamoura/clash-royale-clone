import { SoundEngine } from "./audio/sound";
import { createBattle, deployCard, type BattleState } from "./game/battle";
import { createBot, tickBot, type BotState } from "./game/bot";
import { getCard, type CardId } from "./game/cards";
import { tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";

const stage = document.getElementById("stage")!;
const topbar = document.getElementById("topbar")!;
const hudRoot = document.getElementById("hud")!;
const overlay = document.getElementById("overlay")!;

let battle: BattleState = createBattle();
let bot: BotState = createBot(Date.now() & 0xffff);
let selectedCard: CardId | null = null;

const scene = new Battle3D(stage);
const audio = new SoundEngine();

function selectCard(id: CardId | null): void {
  selectedCard = id;
  hud.setSelected(id);
  scene.setZoneVisible(id !== null && getCard(id).kind === "troop");
}

function restart(): void {
  battle = createBattle();
  bot = createBot(Date.now() & 0xffff);
  selectCard(null);
  scene.reset();
  audio.restartMusic();
}

const hud = new Hud(topbar, hudRoot, overlay, {
  onSelectCard: selectCard,
  onRestart: restart,
  onToggleSound: () => {
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
});

// Audio can only start from a user gesture.
window.addEventListener("pointerdown", () => audio.resume(), { once: false });

scene.renderer.domElement.addEventListener("click", (ev) => {
  if (battle.result || !selectedCard) return;
  const pos = scene.pick(ev.clientX, ev.clientY);
  if (pos && deployCard(battle, "player", selectedCard, pos.x, pos.y)) {
    selectCard(null);
    scene.setHover(null, 0, false);
  }
});

scene.renderer.domElement.addEventListener("pointermove", (ev) => {
  if (!selectedCard) {
    scene.setHover(null, 0, false);
    return;
  }
  const card = getCard(selectedCard);
  scene.setHover(
    scene.pick(ev.clientX, ev.clientY),
    card.kind === "spell" ? card.radius : 0.6,
    card.kind === "spell",
  );
});

window.addEventListener("keydown", (ev) => {
  const n = Number(ev.key);
  if (n >= 1 && n <= 4) selectCard(battle.player.hand.cards[n - 1]);
  if (ev.key === "Escape") selectCard(null);
});

const SIM_DT = 1 / 30;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  acc += dt;
  last = now;
  while (acc >= SIM_DT) {
    tick(battle, SIM_DT);
    tickBot(battle, bot, SIM_DT);
    acc -= SIM_DT;
  }
  for (const ev of battle.events.splice(0)) {
    audio.onEvent(ev);
    scene.onEvent(ev);
  }
  scene.sync(battle);
  scene.render(dt);
  hud.update(battle);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
