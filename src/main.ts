import { SoundEngine } from "./audio/sound";
import {
  checkDeploy,
  createBattle,
  deployCard,
  isValidDeck,
  type BattleState,
  type CardLevels,
} from "./game/battle";
import { createBot, tickBot, type BotProfile, type BotState } from "./game/bot";
import { DECK, DEFAULT_DECK, getCard, type CardId } from "./game/cards";
import { drawCardArt } from "./render/characters";
import { CARD_COLOR } from "./render/cardcolors";
import { isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";
import { loadMode, saveMode, type GameMode } from "./launcher/mode";
import { launchUnity } from "./launcher/unityPanel";

const stage = document.getElementById("stage")!;

// Character portrait studio: ?gallery=<cardId|tower-princess|tower-king>
const gallerySubject = new URLSearchParams(location.search).get("gallery");
if (gallerySubject) {
  for (const id of ["topbar", "hud", "overlay", "banner", "emotes", "deckpicker"]) {
    const node = document.getElementById(id);
    if (node) node.style.display = "none";
  }
  void import("./render3d/gallery").then(({ startGallery }) =>
    startGallery(stage, gallerySubject),
  );
  throw new Error("gallery mode"); // stop the battle bootstrap
}
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

// ---- Bot difficulty ------------------------------------------------------

const DIFF_KEY = "cr-clone-difficulty";
const DIFFICULTIES: Record<string, BotProfile> = {
  easy: { thinkInterval: 1.8, pushAt: 9 },
  normal: { thinkInterval: 1.0, pushAt: 8 },
  hard: { thinkInterval: 0.55, pushAt: 6 },
};

function loadDifficulty(): string {
  const saved = localStorage.getItem(DIFF_KEY) ?? "normal";
  return saved in DIFFICULTIES ? saved : "normal";
}

let difficulty = loadDifficulty();

// ---- Native vs Unity edition (chosen on the intro) ----------------------

const unityStage = document.getElementById("unity-stage")!;
let gameMode: GameMode = loadMode(localStorage);

// ---- Trophies + card levels (persisted progression) --------------------

const TROPHY_KEY = "cr-clone-trophies";
const LEVELS_KEY = "cr-clone-levels";
const MAX_LEVEL = 11;

let trophies = parseInt(localStorage.getItem(TROPHY_KEY) ?? "0", 10) || 0;

function loadLevels(): CardLevels {
  try {
    return JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}") as CardLevels;
  } catch {
    return {};
  }
}

let cardLevels: CardLevels = loadLevels();

/** The bot levels up with your trophies, one level per 150. */
function botLevels(): CardLevels {
  const lvl = Math.min(MAX_LEVEL, 1 + Math.floor(trophies / 150));
  const out: CardLevels = {};
  for (const id of DECK) out[id] = lvl;
  return out;
}

let battle: BattleState = createBattle(playerDeck, botDeck(), {
  player: cardLevels,
  enemy: botLevels(),
});
let bot: BotState = createBot(Date.now() & 0xffff, DIFFICULTIES[difficulty]);
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
  battle = createBattle(playerDeck, botDeck(), {
    player: cardLevels,
    enemy: botLevels(),
  });
  bot = createBot(Date.now() & 0xffff, DIFFICULTIES[difficulty]);
  selectCard(null);
  hud.setReward(null);
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
}

// ---- Deck picker ---------------------------------------------------------

const pickerRoot = document.getElementById("deckpicker")!;

/** Small card tile canvas reused in the deck row and collection grid. */
function cardTileCanvas(id: CardId): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = CARD_COLOR[id];
  ctx.beginPath();
  ctx.roundRect(0, 0, 48, 48, 7);
  ctx.fill();
  drawCardArt(ctx, id, 24, 26, 26);
  return c;
}

function buildDeckPicker(): void {
  pickerRoot.innerHTML = "";

  // Edition toggle: the original in-browser build, or the Unity WebGL build.
  const modeRow = document.createElement("div");
  modeRow.className = "mode-row";
  const modeNote = document.createElement("div");
  modeNote.className = "mode-note";
  const MODE_LABEL: Record<GameMode, string> = {
    native: "Native (Three.js)",
    unity: "Unity (WebGL)",
  };
  const MODE_HELP: Record<GameMode, string> = {
    native: "The original TypeScript + Three.js game runs right here.",
    unity: "Launches the Unity WebGL build served from /unity/.",
  };
  for (const mode of ["native", "unity"] as GameMode[]) {
    const btn = document.createElement("button");
    btn.className = "mode-btn";
    btn.textContent = MODE_LABEL[mode];
    btn.classList.toggle("chosen", mode === gameMode);
    btn.addEventListener("click", () => {
      gameMode = mode;
      saveMode(localStorage, mode);
      modeRow
        .querySelectorAll("button")
        .forEach((b) => b.classList.toggle("chosen", b === btn));
      modeNote.textContent = MODE_HELP[mode];
      startBtn.textContent = mode === "unity" ? "Launch Unity" : "Battle!";
    });
    modeRow.appendChild(btn);
  }
  pickerRoot.appendChild(modeRow);
  modeNote.textContent = MODE_HELP[gameMode];
  pickerRoot.appendChild(modeNote);

  const title = document.createElement("h2");
  title.textContent = "Build your battle deck";
  pickerRoot.appendChild(title);

  // Ordered deck of up to 8; slots fill as you pick, click to remove.
  const deck: CardId[] = playerDeck.slice(0, 8);

  const deckRow = document.createElement("div");
  deckRow.className = "deck-slots";
  pickerRoot.appendChild(deckRow);

  const count = document.createElement("div");
  count.className = "deck-count";
  pickerRoot.appendChild(count);

  const collectLabel = document.createElement("div");
  collectLabel.className = "collect-label";
  collectLabel.textContent = "Collection — tap to add";
  pickerRoot.appendChild(collectLabel);

  const grid = document.createElement("div");
  grid.className = "picker-grid";
  pickerRoot.appendChild(grid);

  const diffRow = document.createElement("div");
  diffRow.className = "diff-row";
  for (const level of Object.keys(DIFFICULTIES)) {
    const btn = document.createElement("button");
    btn.className = "diff-btn";
    btn.textContent = level;
    btn.classList.toggle("chosen", level === difficulty);
    btn.addEventListener("click", () => {
      difficulty = level;
      localStorage.setItem(DIFF_KEY, level);
      diffRow
        .querySelectorAll("button")
        .forEach((b) => b.classList.toggle("chosen", b === btn));
    });
    diffRow.appendChild(btn);
  }
  pickerRoot.appendChild(diffRow);

  const startBtn = document.createElement("button");
  startBtn.className = "battle-btn";
  startBtn.textContent = gameMode === "unity" ? "Launch Unity" : "Battle!";
  pickerRoot.appendChild(startBtn);

  const remove = (id: CardId): void => {
    const i = deck.indexOf(id);
    if (i >= 0) deck.splice(i, 1);
    sync();
  };
  const add = (id: CardId): void => {
    if (!deck.includes(id) && deck.length < 8) deck.push(id);
    else if (deck.includes(id)) remove(id); // tapping an added card removes it
    sync();
  };

  function sync(): void {
    // Rebuild the 8 deck slots (filled in pick order, then empties).
    deckRow.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const id = deck[i];
      const slot = document.createElement("button");
      slot.className = id ? "deck-slot filled" : "deck-slot empty";
      if (id) {
        slot.appendChild(cardTileCanvas(id));
        const cost = document.createElement("div");
        cost.className = "pcost";
        cost.textContent = String(getCard(id).cost);
        slot.appendChild(cost);
        slot.title = `Remove ${getCard(id).name}`;
        slot.addEventListener("click", () => remove(id));
      }
      deckRow.appendChild(slot);
    }
    const costs = deck.map((id) => getCard(id).cost);
    const avg = costs.length
      ? (costs.reduce((s, c) => s + c, 0) / costs.length).toFixed(1)
      : "0.0";
    count.textContent = `${deck.length} / 8 cards · average ${avg} elixir`;
    startBtn.disabled = deck.length !== 8;
    grid.querySelectorAll<HTMLButtonElement>("button.pick").forEach((btn) => {
      btn.classList.toggle("chosen", deck.includes(btn.dataset.card as CardId));
    });
  }

  for (const id of DECK) {
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.card = id;
    btn.appendChild(cardTileCanvas(id));
    const name = document.createElement("div");
    name.textContent = card.name;
    btn.appendChild(name);
    const cost = document.createElement("div");
    cost.className = "pcost";
    cost.textContent = String(card.cost);
    btn.appendChild(cost);
    btn.addEventListener("click", () => add(id));
    grid.appendChild(btn);
  }
  sync();

  startBtn.addEventListener("click", () => {
    playerDeck = deck.slice();
    localStorage.setItem(DECK_KEY, JSON.stringify(playerDeck));
    pickerRoot.classList.remove("show");
    if (gameMode === "unity") {
      void launchUnity(unityStage, openDeckPicker);
    } else {
      restart();
    }
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

// Trophy counter in the top bar.
const trophyChip = document.createElement("div");
trophyChip.className = "crowns player";
trophyChip.innerHTML = `🏆 <span>${trophies}</span>`;
topbar.appendChild(trophyChip);

function applyMatchResult(winner: "player" | "enemy" | "draw"): void {
  let reward: string;
  if (winner === "player") {
    trophies += 30;
    reward = "+30 🏆";
    // Victory levels up two random deck cards.
    const upgradable = playerDeck.filter((id) => (cardLevels[id] ?? 1) < MAX_LEVEL);
    for (let n = 0; n < 2 && upgradable.length > 0; n++) {
      const i = Math.floor(Math.random() * upgradable.length);
      const id = upgradable.splice(i, 1)[0];
      cardLevels[id] = (cardLevels[id] ?? 1) + 1;
      reward += ` · ${getCard(id).name} ↑ Lv.${cardLevels[id]}`;
    }
  } else if (winner === "enemy") {
    trophies = Math.max(0, trophies - 20);
    reward = "-20 🏆";
  } else {
    reward = "🏆 unchanged";
  }
  localStorage.setItem(TROPHY_KEY, String(trophies));
  localStorage.setItem(LEVELS_KEY, JSON.stringify(cardLevels));
  trophyChip.innerHTML = `🏆 <span>${trophies}</span>`;
  hud.setReward(reward);
}

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

// Right-click anywhere on the field cancels the selected card.
scene.renderer.domElement.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  selectCard(null);
  clearPreview();
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
    if (ev.type === "finish") {
      botEmote(ev.winner === "enemy" ? "🎉" : "😭");
      applyMatchResult(ev.winner);
    }
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
