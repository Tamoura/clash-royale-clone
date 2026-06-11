import { SoundEngine } from "./audio/sound";
import { checkDeploy, createBattle, deployCard, type BattleState } from "./game/battle";
import { createBot, tickBot, type BotState } from "./game/bot";
import { getCard, type CardId } from "./game/cards";
import { tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";

const stage = document.getElementById("stage")!;
const topbar = document.getElementById("topbar")!;
const hudRoot = document.getElementById("hud")!;
const overlay = document.getElementById("overlay")!;
const bannerEl = document.getElementById("banner")!;
const emoteBar = document.getElementById("emotes")!;

let battle: BattleState = createBattle();
let bot: BotState = createBot(Date.now() & 0xffff);
let selectedCard: CardId | null = null;

let scene: Battle3D;
try {
  scene = new Battle3D(stage);
} catch {
  stage.innerHTML =
    '<div style="color:#e5e7eb;text-align:center;padding-top:34vh;font-size:18px;line-height:1.7">' +
    "<b>This game needs WebGL (3D graphics).</b><br/>" +
    "In Chrome: open <code>chrome://settings/system</code>,<br/>" +
    "turn on <b>“Use graphics acceleration when available”</b>, and relaunch.<br/>" +
    "(Safari and Firefox usually work out of the box.)</div>";
  throw new Error("WebGL unavailable");
}
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
  startCountdown();
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

// ---- Banners & match phases -------------------------------------------

let phase: "countdown" | "playing" = "countdown";
let countdownStep = 4; // 3, 2, 1, FIGHT!
let countdownTimer = 0;
let lastMinuteShown = false;
let overtimeShown = false;

function showBanner(text: string, big = false): void {
  bannerEl.textContent = text;
  bannerEl.classList.remove("show");
  bannerEl.classList.toggle("countdown", big);
  void bannerEl.offsetWidth; // restart the CSS animation
  bannerEl.classList.add("show");
}

function startCountdown(): void {
  phase = "countdown";
  countdownStep = 4;
  countdownTimer = 0;
  lastMinuteShown = false;
  overtimeShown = false;
}

function tickCountdown(dt: number): void {
  countdownTimer -= dt;
  if (countdownTimer > 0) return;
  countdownTimer = 0.85;
  countdownStep -= 1;
  if (countdownStep > 0) {
    showBanner(String(countdownStep), true);
    audio.countdownBeep(false);
  } else {
    showBanner("FIGHT!", true);
    audio.countdownBeep(true);
    phase = "playing";
  }
}

function checkBanners(): void {
  if (!lastMinuteShown && battle.time >= 120 && !battle.result) {
    lastMinuteShown = true;
    showBanner("Last minute — 2x elixir!");
    audio.sting();
  }
  if (!overtimeShown && battle.overtime && !battle.result) {
    overtimeShown = true;
    showBanner("OVERTIME!");
    audio.sting();
  }
}

// ---- Emotes ------------------------------------------------------------

const EMOTES = ["😂", "😭", "👍", "😡"];
for (const emoji of EMOTES) {
  const btn = document.createElement("button");
  btn.textContent = emoji;
  btn.addEventListener("click", () => {
    scene.showEmote("player", emoji);
    audio.emotePop();
  });
  emoteBar.appendChild(btn);
}

let botEmoteCooldown = 0;

function botEmote(emoji: string): void {
  if (botEmoteCooldown > 0) return;
  botEmoteCooldown = 6;
  scene.showEmote("enemy", emoji);
  audio.emotePop();
}

function clearPreview(): void {
  scene.setHover(null, 0, false);
  scene.setGhost(null, null);
}

function showPreview(clientX: number, clientY: number): void {
  if (!selectedCard) {
    clearPreview();
    return;
  }
  const card = getCard(selectedCard);
  const pos = scene.pick(clientX, clientY);
  const valid =
    pos !== null &&
    checkDeploy(battle, "player", selectedCard, pos.x, pos.y) === "ok";
  scene.setHover(
    pos,
    card.kind === "spell" ? card.radius : 0.6,
    card.kind === "spell",
    valid,
  );
  scene.setGhost(card.kind === "spell" ? null : selectedCard, pos);
}

function tryDeployAt(clientX: number, clientY: number): void {
  if (battle.result || !selectedCard) return;
  const pos = scene.pick(clientX, clientY);
  if (pos && deployCard(battle, "player", selectedCard, pos.x, pos.y)) {
    selectCard(null);
    clearPreview();
  }
}

// Click-to-place and drag-from-hand both end in a pointerup on the field.
scene.renderer.domElement.addEventListener("pointerup", (ev) => {
  tryDeployAt(ev.clientX, ev.clientY);
});

// Show the ghost wherever the pointer goes while a card is selected
// (window-level so a drag started on a hand card previews immediately).
window.addEventListener("pointermove", (ev) => {
  showPreview(ev.clientX, ev.clientY);
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
  last = now;

  if (phase === "countdown") {
    tickCountdown(dt);
  } else {
    acc += dt;
    while (acc >= SIM_DT) {
      tick(battle, SIM_DT);
      tickBot(battle, bot, SIM_DT);
      acc -= SIM_DT;
    }
  }
  botEmoteCooldown = Math.max(0, botEmoteCooldown - dt);
  for (const ev of battle.events.splice(0)) {
    audio.onEvent(ev);
    scene.onEvent(ev);
    // The bot has feelings about crowns.
    if (ev.type === "crown") botEmote(ev.winner === "enemy" ? "😂" : "😭");
    if (ev.type === "finish") botEmote(ev.winner === "enemy" ? "🎉" : "😭");
  }
  checkBanners();
  scene.sync(battle, dt);
  scene.render(dt);
  hud.update(battle);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
