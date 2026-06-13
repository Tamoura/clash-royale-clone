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
import type { Side } from "./game/arena";
import { drawCardArt } from "./render/characters";
import { CARD_COLOR } from "./render/cardcolors";
import { isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";
import { RoomClient, type NetSocket } from "./net/roomClient";
import { Lockstep } from "./net/lockstep";
import { sideForRole, type Role, type MatchMode } from "./net/protocol";
import { stateChecksum } from "./net/checksum";

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

// ---- Game modes ----------------------------------------------------------

interface GameMode {
  id: string;
  name: string;
  blurb: string;
  /** Flat elixir rate (1 normal, 3 triple, 7 mega). */
  elixirRate: number;
  /** Both players battle with the same random deck. */
  mirror: boolean;
}

const GAME_MODES: GameMode[] = [
  { id: "classic", name: "Classic", blurb: "Your deck, normal elixir", elixirRate: 1, mirror: false },
  { id: "triple", name: "Triple Elixir ⚡3", blurb: "3× elixir the whole match", elixirRate: 3, mirror: false },
  { id: "mega", name: "Mega Elixir ⚡7", blurb: "7× elixir — total chaos", elixirRate: 7, mirror: false },
  { id: "mirror", name: "Mirror Match", blurb: "Both get the same random deck", elixirRate: 1, mirror: true },
];

const MODE_KEY = "cr-clone-mode";

function loadMode(): GameMode {
  const id = localStorage.getItem(MODE_KEY);
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
}

let gameMode = loadMode();

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

// ---- Online 1v1 (LAN lockstep) -----------------------------------------

const INPUT_DELAY = 4; // ticks of input latency hidden (~133ms at 30Hz)
const SYNC_EVERY = 30; // exchange a drift checksum once a second

let mode: "solo" | "online" = "solo";
interface OnlineSession {
  client: RoomClient;
  ls: Lockstep;
  side: Side;
  tick: number;
  sums: Map<number, number>; // my checksum per sync tick, for drift detection
}
let online: OnlineSession | null = null;

/** Which side the local player controls (host=player, guest=enemy, solo=player). */
function localSide(): Side {
  return online ? online.side : "player";
}

/** The local player's side-state (hand, elixir) in the current battle. */
function mySideState(): BattleState["player"] {
  return localSide() === "player" ? battle.player : battle.enemy;
}

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

// Dev aid: ?viewpoint=enemy previews the online guest's flipped camera.
if (import.meta.env.DEV) {
  const v = new URLSearchParams(location.search).get("viewpoint");
  if (v === "enemy" || v === "player") scene.setViewpoint(v);
}

function selectCard(id: CardId | null): void {
  selectedCard = id;
  hud.setSelected(id);
  scene.setZoneVisible(id !== null && getCard(id).kind === "troop");
}

function restart(): void {
  mode = "solo";
  online = null;
  // Mirror mode: player and bot share one random deck for a pure-skill match.
  const shared = gameMode.mirror ? botDeck() : null;
  battle = createBattle(
    shared ?? playerDeck,
    shared ?? botDeck(),
    { player: cardLevels, enemy: botLevels() },
    gameMode.elixirRate,
  );
  bot = createBot(Date.now() & 0xffff, DIFFICULTIES[difficulty]);
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName("Rival Bot");
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
}

/** Begin a networked match once the relay pairs both players. */
function startOnlineMatch(
  client: RoomClient,
  role: Role,
  hostDeck: CardId[],
  guestDeck: CardId[],
  matchMode: MatchMode,
): void {
  const side = sideForRole(role);
  mode = "online";
  const session: OnlineSession = {
    client,
    ls: new Lockstep(side, INPUT_DELAY),
    side,
    tick: 0,
    sums: new Map(),
  };
  online = session;
  // Identical canonical battle on both peers: host=player, guest=enemy.
  // No card levels online — a fair, fully-deterministic match. Mirror mode
  // has both sides battle the host's deck.
  const enemyDeck = matchMode.mirror ? hostDeck : guestDeck;
  battle = createBattle(hostDeck, enemyDeck, {}, matchMode.elixirRate);
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName("Friend");
  scene.setViewpoint(side);
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();

  // In-match networking: if the peer drops, the lockstep would stall forever,
  // so end gracefully; compare drift checksums to catch desync early.
  client.onFrame = (frame) => session.ls.receive(frame);
  client.onPeerLeft = () => endOnlineMatch("Your friend left the game.");
  client.onClose = () => endOnlineMatch("Lost connection to your friend.");
  client.onSync = (tick, checksum) => {
    const mine = session.sums.get(tick);
    if (mine !== undefined && mine !== checksum) {
      showBanner("Connection out of sync");
    }
  };

  // Opening frames unblock the first ticks before any deploy can be scheduled.
  for (const f of session.ls.bootstrap()) client.sendFrame(f);
  startCountdown();
}

/** Tear down a networked match and return to the menu with a message. */
function endOnlineMatch(message: string): void {
  if (mode !== "online") return;
  online?.client.leave();
  online = null;
  mode = "solo";
  showBanner(message);
  scene.setViewpoint("player");
  hud.setOpponentName("Rival Bot");
  setTimeout(openDeckPicker, 1800);
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

  // Game-mode selector (applies to Battle the Bot and, for the host, online).
  const modeLabel = document.createElement("div");
  modeLabel.className = "collect-label";
  modeLabel.textContent = "Game mode";
  pickerRoot.appendChild(modeLabel);

  const modeRow = document.createElement("div");
  modeRow.className = "mode-row";
  const modeBlurb = document.createElement("div");
  modeBlurb.className = "mode-blurb";
  for (const m of GAME_MODES) {
    const btn = document.createElement("button");
    btn.className = "mode-btn";
    btn.textContent = m.name;
    btn.classList.toggle("chosen", m.id === gameMode.id);
    btn.addEventListener("click", () => {
      gameMode = m;
      localStorage.setItem(MODE_KEY, m.id);
      modeRow.querySelectorAll("button").forEach((b) => b.classList.toggle("chosen", b === btn));
      modeBlurb.textContent = m.blurb;
    });
    modeRow.appendChild(btn);
  }
  modeBlurb.textContent = gameMode.blurb;
  pickerRoot.appendChild(modeRow);
  pickerRoot.appendChild(modeBlurb);

  const startBtn = document.createElement("button");
  startBtn.className = "battle-btn";
  startBtn.textContent = "Battle the Bot";
  pickerRoot.appendChild(startBtn);

  const friendBtn = document.createElement("button");
  friendBtn.className = "battle-btn friend";
  friendBtn.textContent = "Play a Friend";
  pickerRoot.appendChild(friendBtn);

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
    friendBtn.disabled = deck.length !== 8;
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

  function saveDeck(): void {
    playerDeck = deck.slice();
    localStorage.setItem(DECK_KEY, JSON.stringify(playerDeck));
  }

  startBtn.addEventListener("click", () => {
    saveDeck();
    pickerRoot.classList.remove("show");
    restart();
  });

  friendBtn.addEventListener("click", () => {
    saveDeck();
    openFriendLobby(deck.slice());
  });
}

// ---- Friend lobby (create / join a LAN room) ---------------------------

function connectRoom(): RoomClient {
  // The browser WebSocket satisfies NetSocket at runtime; its DOM event-handler
  // typings differ only in the (ignored) event argument.
  const sock = new WebSocket(`ws://${location.hostname}:3110`) as unknown as NetSocket;
  return new RoomClient(sock);
}

function openFriendLobby(deck: CardId[]): void {
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Play a Friend";
  pickerRoot.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "lobby-hint";
  hint.innerHTML = `Mode: <b>${gameMode.name}</b><br/>You both need to be on the same Wi-Fi.`;
  pickerRoot.appendChild(hint);

  const status = document.createElement("div");
  status.className = "lobby-status";
  pickerRoot.appendChild(status);

  const createBtn = document.createElement("button");
  createBtn.className = "battle-btn";
  createBtn.textContent = "Create a game";
  pickerRoot.appendChild(createBtn);

  const joinRow = document.createElement("div");
  joinRow.className = "join-row";
  const codeInput = document.createElement("input");
  codeInput.className = "code-input";
  codeInput.placeholder = "CODE";
  codeInput.maxLength = 5;
  codeInput.autocapitalize = "characters";
  const joinBtn = document.createElement("button");
  joinBtn.className = "battle-btn join";
  joinBtn.textContent = "Join";
  joinRow.append(codeInput, joinBtn);
  pickerRoot.appendChild(joinRow);

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = "← Back";
  pickerRoot.appendChild(backBtn);

  let client: RoomClient | null = null;
  const wire = (c: RoomClient): void => {
    client = c;
    c.onCreated = (code) => {
      status.innerHTML =
        `Your code: <b class="big-code">${code}</b><br/>Tell your friend, then wait…`;
    };
    c.onStart = (p) => {
      pickerRoot.classList.remove("show");
      startOnlineMatch(c, p.role, p.hostDeck, p.guestDeck, p.mode);
    };
    c.onError = (reason) => {
      createBtn.disabled = false;
      status.textContent =
        reason === "no-such-room"
          ? "No game with that code."
          : reason === "room-full"
            ? "That game is already full."
            : "Couldn't join that game.";
    };
    c.onPeerLeft = () => {
      status.textContent = "Your friend left the game.";
    };
    c.onClose = () => {
      if (mode !== "online") status.textContent = "Couldn't reach the game server.";
    };
  };

  createBtn.addEventListener("click", () => {
    if (client) return;
    status.textContent = "Connecting…";
    createBtn.disabled = true;
    const c = connectRoom();
    wire(c);
    // Mirror mode: the host supplies one random deck both players battle with.
    const hostDeck = gameMode.mirror ? botDeck() : deck;
    c.create(hostDeck, { elixirRate: gameMode.elixirRate, mirror: gameMode.mirror });
  });
  joinBtn.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      status.textContent = "Type your friend's code first.";
      return;
    }
    status.textContent = "Connecting…";
    const c = connectRoom();
    wire(c);
    c.join(code, deck);
  });
  backBtn.addEventListener("click", () => {
    client?.leave();
    openDeckPicker();
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
    scene.showEmote(localSide(), emoji);
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
    checkDeploy(battle, localSide(), selectedCard, pos.x, pos.y) === "ok";
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
  const side = localSide();
  const verdict = checkDeploy(battle, side, selectedCard, pos.x, pos.y);
  if (verdict === "ok") {
    if (online) {
      // Lockstep: schedule the deploy; both peers apply it at the same tick.
      online.ls.queue({ side, cardId: selectedCard, x: pos.x, y: pos.y });
      selectCard(null);
      clearPreview();
      return;
    }
    if (deployCard(battle, side, selectedCard, pos.x, pos.y)) {
      selectCard(null);
      clearPreview();
      return;
    }
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
  if (n >= 1 && n <= 4) selectCard(mySideState().hand.cards[n - 1]);
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
  } else if (mode === "online" && online) {
    acc += dt;
    while (acc >= SIM_DT) {
      // Lockstep: advance only when the peer's frame for this tick is in hand.
      if (!online.ls.ready()) break;
      const { commands, outgoing } = online.ls.step();
      for (const c of commands) deployCard(battle, c.side, c.cardId, c.x, c.y);
      tick(battle, SIM_DT);
      online.client.sendFrame(outgoing);
      online.tick++;
      if (online.tick % SYNC_EVERY === 0) {
        const cs = stateChecksum(battle);
        online.sums.set(online.tick, cs);
        if (online.sums.size > 10) online.sums.delete([...online.sums.keys()][0]);
        online.client.sendSync(online.tick, cs);
      }
      acc -= SIM_DT;
    }
    // While stalled on the peer, don't bank a backlog that bursts on resume.
    acc = Math.min(acc, SIM_DT * 3);
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
    if (ev.type === "crown" && mode === "solo") botEmote(ev.winner === "enemy" ? "😂" : "😭");
    if (ev.type === "finish") {
      // Online friendly matches don't touch trophies/levels.
      if (mode === "solo") {
        botEmote(ev.winner === "enemy" ? "🎉" : "😭");
        applyMatchResult(ev.winner);
      }
    }
  }
  checkBanners();
  // Music tension follows the match: double elixir, then overtime.
  if (!battle.result) {
    audio.setIntensity(battle.overtime ? 2 : isDoubleElixir(battle) ? 1 : 0);
  }
  scene.sync(battle, dt);
  scene.render(dt);
  hud.update(battle, localSide());
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev-only hook for the lockstep determinism test (stripped from prod builds).
if (import.meta.env.DEV) {
  (window as unknown as { __cr: unknown }).__cr = {
    sum: () => stateChecksum(battle),
    tick: () => online?.tick ?? 0,
    mode: () => mode,
  };
}
