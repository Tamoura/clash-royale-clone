import { SoundEngine } from "./audio/sound";
import {
  checkDeploy,
  createBattle,
  deployCard,
  isValidDeck,
  type BattleState,
} from "./game/battle";
import { createBot, tickBot, type BotState } from "./game/bot";
import { DECK, DEFAULT_DECK, getCard, type CardId } from "./game/cards";
import { drawCardArt } from "./render/characters";
import { CARD_COLOR } from "./render/cardcolors";
import { isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";

const stage = document.getElementById("stage")!;
const topbar = document.getElementById("topbar")!;
const hudRoot = document.getElementById("hud")!;
const overlay = document.getElementById("overlay")!;
const bannerEl = document.getElementById("banner")!;
const emoteBar = document.getElementById("emotes")!;

// ---- Player deck (8 cards, persisted) -----------------------------------

const DECK_KEY = "cr-clone-deck";

function loadDeck(): CardId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DECK_KEY) ?? "[]") as CardId[];
    if (isValidDeck(saved)) return saved;
  } catch {
    // fall through to the starter deck
  }
  return [...DEFAULT_DECK];
}

let playerDeck: CardId[] = loadDeck();

/** The bot drafts a random legal deck each match. */
function botDeck(): CardId[] {
  const pool = [...DECK];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 8);
}

let battle: BattleState = createBattle(playerDeck, botDeck());
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
  battle = createBattle(playerDeck, botDeck());
  bot = createBot(Date.now() & 0xffff);
  selectCard(null);
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
}

// ---- Deck picker ---------------------------------------------------------

const pickerRoot = document.getElementById("deckpicker")!;

function buildDeckPicker(): void {
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Build your battle deck";
  pickerRoot.appendChild(title);
  const count = document.createElement("div");
  count.className = "deck-count";
  pickerRoot.appendChild(count);
  const grid = document.createElement("div");
  grid.className = "picker-grid";
  pickerRoot.appendChild(grid);
  const startBtn = document.createElement("button");
  startBtn.className = "battle-btn";
  startBtn.textContent = "Battle!";
  pickerRoot.appendChild(startBtn);

  const chosen = new Set<CardId>(playerDeck);
  const sync = (): void => {
    count.textContent = `${chosen.size} / 8 cards`;
    startBtn.disabled = chosen.size !== 8;
    grid.querySelectorAll<HTMLButtonElement>("button.pick").forEach((btn) => {
      btn.classList.toggle("chosen", chosen.has(btn.dataset.card as CardId));
    });
  };

  for (const id of DECK) {
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.card = id;
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const cctx = c.getContext("2d")!;
    cctx.fillStyle = CARD_COLOR[id];
    cctx.beginPath();
    cctx.roundRect(0, 0, 48, 48, 7);
    cctx.fill();
    drawCardArt(cctx, id, 24, 26, 26);
    btn.appendChild(c);
    const name = document.createElement("div");
    name.textContent = card.name;
    btn.appendChild(name);
    const cost = document.createElement("div");
    cost.className = "pcost";
    cost.textContent = String(card.cost);
    btn.appendChild(cost);
    btn.addEventListener("click", () => {
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < 8) chosen.add(id);
      sync();
    });
    grid.appendChild(btn);
  }
  sync();

  startBtn.addEventListener("click", () => {
    playerDeck = DECK.filter((id) => chosen.has(id)); // stable pool order
    localStorage.setItem(DECK_KEY, JSON.stringify(playerDeck));
    pickerRoot.classList.remove("show");
    restart();
  });
}

function openDeckPicker(): void {
  buildDeckPicker();
  pickerRoot.classList.add("show");
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

// Deck button in the top bar + pick-your-deck on first load.
const deckBtn = document.createElement("button");
deckBtn.className = "mute";
deckBtn.textContent = "🃏";
deckBtn.title = "Edit deck";
deckBtn.addEventListener("click", openDeckPicker);
topbar.appendChild(deckBtn);
openDeckPicker();

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
  if (!pos) return;
  const verdict = checkDeploy(battle, "player", selectedCard, pos.x, pos.y);
  if (verdict === "ok" && deployCard(battle, "player", selectedCard, pos.x, pos.y)) {
    selectCard(null);
    clearPreview();
    return;
  }
  // Tell the player why the play was refused.
  if (verdict === "no-elixir") {
    hud.flashError("elixir");
    audio.error();
  } else if (verdict === "bad-spot") {
    hud.flashError("spot");
    audio.error();
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

  // The world holds its breath while the deck picker is open.
  if (pickerRoot.classList.contains("show")) {
    scene.render(dt);
    requestAnimationFrame(frame);
    return;
  }

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
  // Music tension follows the match: double elixir, then overtime.
  if (!battle.result) {
    audio.setIntensity(battle.overtime ? 2 : isDoubleElixir(battle) ? 1 : 0);
  }
  scene.sync(battle, dt);
  scene.render(dt);
  hud.update(battle);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
