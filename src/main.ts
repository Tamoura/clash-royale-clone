import "./ui/tokens.css";
import "./ui/style.css";
import { SoundEngine } from "./audio/sound";
import {
  checkDeploy,
  createBattle,
  deployCard,
  type BattleState,
  type CardLevels,
} from "./game/battle";
import { createBot, tickBot, type BotProfile, type BotState } from "./game/bot";
import {
  DECK,
  DEFAULT_DECK,
  crazyCards,
  getCard,
  setCardOverrides,
  type CardId,
} from "./game/cards";
import type { Side } from "./game/arena";
import { cardDisplayName } from "./render/cardNames";
import { SANDBOX_ELIXIR_RATE, isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D } from "./render3d/scene3d";
import {
  ARENA_THEME_KEY,
  ARABIC,
  applyEditionTokens,
  STORED_EDITION,
  EDITION_CHOSEN,
} from "./render3d/theme";
import { RoomClient, type NetSocket } from "./net/roomClient";
import { Lockstep } from "./net/lockstep";
import { sideForRole, type Role, type MatchMode } from "./net/protocol";
import { stateChecksum } from "./net/checksum";
import {
  loadMode as loadVariant,
  saveMode as saveVariant,
  type GameMode as GameVariant,
} from "./launcher/mode";
import { makeCardCanvas } from "./ui/cardFrame";
import {
  loadProfile,
  saveProfile,
  applyMatchResult as applyMetaMatchResult,
  tryUpgradeCard,
  tryOpenChest,
  ownedSet,
  isOwnedDeck,
  MAX_CARD_LEVEL,
  type PlayerProfile,
} from "./meta/progress";
import {
  arenaNameForUnlock,
  cardsAvailableAt,
  trophyProgress,
} from "./meta/arenas";
import { canPutInDeck, isUnlockedAt } from "./meta/collection";
import { isChestReady } from "./meta/chests";
import { CHEST_SKIP_GEMS, upgradeCost } from "./meta/economy";

// Apply edition-aware CSS variables before any DOM is rendered.
applyEditionTokens(STORED_EDITION);

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

// Sandbox-only in-battle reset (wired to sandboxReset() further down,
// after the battle state it restarts is declared).
const sandboxResetBtn = document.createElement("button");
sandboxResetBtn.className = "sandbox-reset";
sandboxResetBtn.textContent = "↺ Reset";
sandboxResetBtn.setAttribute("aria-label", "Reset the sandbox battle");
sandboxResetBtn.style.display = "none";
stage.appendChild(sandboxResetBtn);

// ---- Meta progression (gold/gems/owned/chests) --------------------------

let profile: PlayerProfile = loadProfile(localStorage);
let playerDeck: CardId[] = profile.deck;
let cardLevels: CardLevels = profile.levels;

function persistProfile(): void {
  profile = { ...profile, deck: playerDeck, levels: cardLevels };
  saveProfile(localStorage, profile);
  refreshMetaChips();
}

/** Bot drafts from cards unlocked at the player's arena (fair ladder). */
function botDeck(): CardId[] {
  const available = cardsAvailableAt(profile.trophies);
  const pool = available.length >= 8 ? [...available] : [...DEFAULT_DECK];
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
  { id: "crazy", name: "Crazy 🎲", blurb: "Every card scrambled — counts, spawns & stats go wild", elixirRate: 1, mirror: false },
  { id: "sandbox", name: "Sandbox 🛠️", blurb: "Practice: infinite elixir, sleeping bot, reset anytime — no rewards", elixirRate: SANDBOX_ELIXIR_RATE, mirror: false },
];

function isSandbox(): boolean {
  return gameMode.id === "sandbox";
}

/** Sandbox is a solo practice space; friend matches fall back to Classic. */
function netGameMode(): GameMode {
  return gameMode.id === "sandbox" ? GAME_MODES[0] : gameMode;
}

const MODE_KEY = "cr-clone-mode";

function loadMode(): GameMode {
  const id = localStorage.getItem(MODE_KEY);
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
}

let gameMode = loadMode();

// ---- Game variant (Clash Royale clone vs Islamic version) ---------------
// The variant is the arena theme under the hood; switching reloads the page.
// (Named "variant" to avoid colliding with the in-match GameMode rulesets.)
// Null until the player picks an edition in the lobby.
const variant: GameVariant | null = loadVariant(localStorage);

/** The bot levels up with your trophies, one level per 150. */
function botLevels(): CardLevels {
  const lvl = Math.min(MAX_CARD_LEVEL, 1 + Math.floor(profile.trophies / 150));
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
  // Crazy mode rerolls a scrambled card set each match; other modes use stock.
  setCardOverrides(gameMode.id === "crazy" ? crazyCards() : null);
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
  hud.setOpponentName(isSandbox() ? "Training dummy" : "Bot");
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = isSandbox() ? "" : "none";
  startCountdown();
}

/** Instant sandbox restart — no countdown between experiments. */
function sandboxReset(): void {
  restart();
  phase = "playing";
  showBanner("Reset!", true);
}
sandboxResetBtn.addEventListener("click", () => {
  sandboxReset();
  sandboxResetBtn.blur();
});

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
  sandboxResetBtn.style.display = "none";
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
  // has both sides battle the host's deck. Never crazy (it uses Math.random,
  // which would desync the lockstep).
  setCardOverrides(null);
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
  hud.setOpponentName("Bot");
  setTimeout(openHome, 1800);
}

// ---- Meta chips (top bar) + home / collection / chests / deck ----------

const pickerRoot = document.getElementById("deckpicker")!;

/** Card tile canvas reused in the deck tray and collection grid. */
function cardTileCanvas(id: CardId): HTMLCanvasElement {
  return makeCardCanvas(id, { style: "tile", size: 128 });
}

function formatRemain(ms: number): string {
  if (ms <= 0) return "Ready!";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function appendEditionToggle(parent: HTMLElement): void {
  const editionRow = document.createElement("div");
  editionRow.className = "edition-row";
  editionRow.setAttribute("role", "group");
  editionRow.setAttribute("aria-label", "Choose edition");
  const MODE_LABEL: Record<GameVariant, string> = {
    clash: "⚔️ Clash Royale",
    islamic: "🌙 Islamic",
  };
  for (const v of ["clash", "islamic"] as GameVariant[]) {
    const btn = document.createElement("button");
    btn.className = "edition-btn";
    btn.textContent = MODE_LABEL[v];
    const chosen = variant === v;
    btn.setAttribute("aria-pressed", String(chosen));
    btn.classList.toggle("chosen", chosen);
    btn.addEventListener("click", () => {
      if (v === variant) return;
      saveVariant(localStorage, v);
      location.reload();
    });
    editionRow.appendChild(btn);
  }
  parent.appendChild(editionRow);
  const editionNote = document.createElement("div");
  editionNote.className = "edition-note";
  editionNote.textContent = variant
    ? variant === "islamic"
      ? "Islamic Golden Age — Faris, camels, war elephants & crescents."
      : "The classic clone — Western knights, wizards, P.E.K.K.A."
    : "Pick Clash Royale or Islamic Golden Age to begin.";
  parent.appendChild(editionNote);
}

function buildHome(): void {
  pickerRoot.innerHTML = "";

  const crest = document.createElement("div");
  crest.className = "cr-crest";
  crest.setAttribute("aria-hidden", "true");
  crest.textContent = !EDITION_CHOSEN ? "⚔️" : ARABIC ? "🌙" : "👑";
  pickerRoot.appendChild(crest);

  const title = document.createElement("h2");
  title.textContent = !EDITION_CHOSEN
    ? "Choose your edition"
    : ARABIC
      ? "ساحة التدريب"
      : "Home";
  pickerRoot.appendChild(title);

  appendEditionToggle(pickerRoot);

  if (!EDITION_CHOSEN || !variant) {
    const gate = document.createElement("div");
    gate.className = "edition-gate";
    gate.textContent = "Select an edition above to enter the arena.";
    pickerRoot.appendChild(gate);
    return;
  }

  const prog = trophyProgress(profile.trophies);
  const arenaBlock = document.createElement("div");
  arenaBlock.className = "home-arena";
  arenaBlock.innerHTML =
    `<div class="home-arena-name">${prog.current.name}</div>` +
    `<div class="home-trophy-row">🏆 ${profile.trophies}` +
    (prog.next ? ` / ${prog.next.trophies}` : " · Peak") +
    `</div>`;
  const bar = document.createElement("div");
  bar.className = "home-trophy-bar";
  const fill = document.createElement("div");
  fill.className = "home-trophy-fill";
  fill.style.width = `${Math.round(prog.ratio * 100)}%`;
  bar.appendChild(fill);
  arenaBlock.appendChild(bar);
  if (prog.next) {
    const hint = document.createElement("div");
    hint.className = "home-arena-next";
    hint.textContent = `Next: ${prog.next.name}`;
    arenaBlock.appendChild(hint);
  }
  pickerRoot.appendChild(arenaBlock);

  const currency = document.createElement("div");
  currency.className = "home-currency";
  currency.innerHTML =
    `<span class="chip gold">🪙 ${profile.gold}</span>` +
    `<span class="chip gems">💎 ${profile.gems}</span>`;
  pickerRoot.appendChild(currency);

  const nav = document.createElement("div");
  nav.className = "home-nav";
  const mk = (label: string, cls: string, fn: () => void): void => {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.textContent = label;
    btn.addEventListener("click", fn);
    nav.appendChild(btn);
  };
  mk("⚔️ Battle", "battle-btn", () => openDeckPicker({ mode: "battle" }));
  mk("🃏 Deck", "battle-btn friend", () => openDeckPicker({ mode: "deck" }));
  mk("📚 Collection", "battle-btn friend", () => openCollection());
  mk("🎁 Chests", "battle-btn friend", () => openChests());
  pickerRoot.appendChild(nav);
}

function buildCollection(): void {
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Collection";
  pickerRoot.appendChild(title);

  const currency = document.createElement("div");
  currency.className = "home-currency";
  currency.innerHTML =
    `<span class="chip gold">🪙 ${profile.gold}</span>` +
    `<span class="chip gems">💎 ${profile.gems}</span>`;
  pickerRoot.appendChild(currency);

  const detail = document.createElement("div");
  detail.className = "collect-detail";
  detail.textContent = "Tap a card to upgrade";
  pickerRoot.appendChild(detail);

  const grid = document.createElement("div");
  grid.className = "picker-grid collection-grid";
  pickerRoot.appendChild(grid);

  const owned = ownedSet(profile.owned);
  for (const id of DECK) {
    const card = getCard(id);
    const have = owned.has(id);
    const unlocked = isUnlockedAt(id, profile.trophies);
    const btn = document.createElement("button");
    btn.className = "pick" + (have ? "" : " locked");
    btn.dataset.card = id;
    btn.dataset.rarity = card.rarity;
    const level = cardLevels[id] ?? 1;
    const shards = profile.shards[id] ?? 0;
    if (have) {
      btn.appendChild(cardTileCanvas(id));
      const name = document.createElement("div");
      name.textContent = `${cardDisplayName(id)} · Lv.${level}`;
      btn.appendChild(name);
      const cost = document.createElement("div");
      cost.className = "pcost";
      cost.textContent = String(card.cost);
      btn.appendChild(cost);
      const shardBar = document.createElement("div");
      shardBar.className = "shard-bar";
      const upc = upgradeCost(card.rarity, level);
      const need = upc?.shards ?? 0;
      shardBar.textContent = upc ? `${shards}/${need} shards` : "MAX";
      btn.appendChild(shardBar);
      btn.addEventListener("click", () => {
        const upc2 = upgradeCost(card.rarity, cardLevels[id] ?? 1);
        if (!upc2) {
          detail.textContent = `${cardDisplayName(id)} is max level.`;
          return;
        }
        const result = tryUpgradeCard(
          { ...profile, deck: playerDeck, levels: cardLevels },
          id,
        );
        if (!result.ok) {
          detail.textContent =
            result.reason === "afford"
              ? `Need ${upc2.gold} gold + ${upc2.shards} shards`
              : "Can't upgrade";
          return;
        }
        profile = result.profile;
        cardLevels = profile.levels;
        persistProfile();
        buildCollection();
      });
    } else {
      const sil = document.createElement("div");
      sil.className = "pick-silhouette";
      sil.textContent = "❔";
      btn.appendChild(sil);
      const name = document.createElement("div");
      name.textContent = unlocked
        ? cardDisplayName(id)
        : `Unlock at ${arenaNameForUnlock(id)}`;
      btn.appendChild(name);
      btn.disabled = true;
    }
    grid.appendChild(btn);
  }

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = "← Home";
  back.addEventListener("click", () => openHome());
  pickerRoot.appendChild(back);
}

function buildChests(): void {
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Chests";
  pickerRoot.appendChild(title);

  const currency = document.createElement("div");
  currency.className = "home-currency";
  currency.innerHTML =
    `<span class="chip gold">🪙 ${profile.gold}</span>` +
    `<span class="chip gems">💎 ${profile.gems}</span>`;
  pickerRoot.appendChild(currency);

  const note = document.createElement("div");
  note.className = "collect-label";
  note.textContent = `Win battles to fill slots · Skip timer for ${CHEST_SKIP_GEMS} 💎`;
  pickerRoot.appendChild(note);

  const reveal = document.createElement("div");
  reveal.className = "chest-reveal";
  pickerRoot.appendChild(reveal);

  const row = document.createElement("div");
  row.className = "chest-slots";
  pickerRoot.appendChild(row);

  const now = Date.now();
  profile.chests.forEach((slot, i) => {
    const cell = document.createElement("div");
    cell.className = "chest-slot" + (slot ? "" : " empty");
    if (!slot) {
      cell.textContent = "Empty";
      row.appendChild(cell);
      return;
    }
    const ready = isChestReady(slot, now);
    const label = document.createElement("div");
    label.className = "chest-rarity";
    label.textContent = slot.rarity === "rare" ? "🎁 Rare" : "📦 Free";
    cell.appendChild(label);
    const timer = document.createElement("div");
    timer.className = "chest-timer";
    timer.textContent = ready ? "Ready!" : formatRemain(slot.readyAt - now);
    cell.appendChild(timer);
    const openBtn = document.createElement("button");
    openBtn.className = "chest-open-btn";
    openBtn.textContent = ready ? "Open" : `Open (${CHEST_SKIP_GEMS}💎)`;
    openBtn.addEventListener("click", () => {
      const result = tryOpenChest(
        { ...profile, deck: playerDeck, levels: cardLevels },
        i,
        Date.now(),
        undefined,
        { skipWithGems: !ready },
      );
      if (!result.ok || !result.rewards) {
        reveal.textContent =
          result.reason === "gems"
            ? "Not enough gems"
            : result.reason === "locked"
              ? "Still locked"
              : "Can't open";
        return;
      }
      profile = result.profile;
      persistProfile();
      const r = result.rewards;
      const bits: string[] = [`+${r.gold} 🪙`];
      if (r.gems) bits.push(`+${r.gems} 💎`);
      if (r.newCard) bits.push(`New: ${cardDisplayName(r.newCard)}!`);
      const shardBits = Object.entries(r.shards)
        .map(([id, n]) => `${cardDisplayName(id as CardId)} +${n}`)
        .join(", ");
      if (shardBits) bits.push(shardBits);
      reveal.textContent = bits.join(" · ");
      // Rebuild after a beat so the player can read the reveal.
      window.setTimeout(() => buildChests(), 900);
    });
    cell.appendChild(openBtn);
    row.appendChild(cell);
  });

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = "← Home";
  back.addEventListener("click", () => openHome());
  pickerRoot.appendChild(back);
}

function buildDeckPicker(opts: { mode: "battle" | "deck" }): void {
  pickerRoot.innerHTML = "";

  const crest = document.createElement("div");
  crest.className = "cr-crest";
  crest.setAttribute("aria-hidden", "true");
  crest.textContent = ARABIC ? "🌙" : "👑";
  pickerRoot.appendChild(crest);

  const title = document.createElement("h2");
  title.textContent =
    opts.mode === "battle"
      ? ARABIC
        ? "ابنِ سطحك الحربي"
        : "Battle deck"
      : ARABIC
        ? "عدّل سطحك"
        : "Edit deck";
  pickerRoot.appendChild(title);

  const owned = ownedSet(profile.owned);
  const deck: CardId[] = playerDeck.filter((id) => owned.has(id)).slice(0, 8);

  const deckRow = document.createElement("div");
  deckRow.className = "deck-slots";
  pickerRoot.appendChild(deckRow);

  const count = document.createElement("div");
  count.className = "deck-count";
  pickerRoot.appendChild(count);

  const collectLabel = document.createElement("div");
  collectLabel.className = "collect-label";
  collectLabel.textContent = "Owned cards — tap to add";
  pickerRoot.appendChild(collectLabel);

  const grid = document.createElement("div");
  grid.className = "picker-grid";
  pickerRoot.appendChild(grid);

  if (opts.mode === "battle") {
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
  }

  const startBtn = document.createElement("button");
  startBtn.className = "battle-btn";
  startBtn.textContent =
    opts.mode === "battle" ? "⚔️ Battle the Bot" : "💾 Save deck";
  startBtn.setAttribute(
    "aria-label",
    opts.mode === "battle" ? "Start a battle against the bot" : "Save deck",
  );
  pickerRoot.appendChild(startBtn);

  let friendBtn: HTMLButtonElement | null = null;
  if (opts.mode === "battle") {
    friendBtn = document.createElement("button");
    friendBtn.className = "battle-btn friend";
    friendBtn.textContent = "🤝 Play a Friend";
    friendBtn.setAttribute("aria-label", "Start an online match with a friend");
    pickerRoot.appendChild(friendBtn);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = "← Home";
  backBtn.addEventListener("click", () => openHome());
  pickerRoot.appendChild(backBtn);

  const remove = (id: CardId): void => {
    const i = deck.indexOf(id);
    if (i >= 0) deck.splice(i, 1);
    sync();
  };
  const add = (id: CardId): void => {
    if (!canPutInDeck(id, owned)) return;
    if (!deck.includes(id) && deck.length < 8) deck.push(id);
    else if (deck.includes(id)) remove(id);
    sync();
  };

  function sync(): void {
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
        slot.title = `Remove ${cardDisplayName(id)}`;
        slot.addEventListener("click", () => remove(id));
      }
      deckRow.appendChild(slot);
    }
    const costs = deck.map((id) => getCard(id).cost);
    const avg = costs.length
      ? (costs.reduce((s, c) => s + c, 0) / costs.length).toFixed(1)
      : "0.0";
    count.textContent = `${deck.length} / 8 cards · average ${avg} elixir`;
    const legal = isOwnedDeck(deck, owned);
    startBtn.disabled = !legal;
    if (friendBtn) friendBtn.disabled = !legal;
    grid.querySelectorAll<HTMLButtonElement>("button.pick").forEach((btn) => {
      btn.classList.toggle("chosen", deck.includes(btn.dataset.card as CardId));
    });
  }

  for (const id of DECK) {
    if (!owned.has(id)) continue;
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.card = id;
    btn.dataset.rarity = card.rarity;
    btn.setAttribute(
      "aria-label",
      `${cardDisplayName(id)}, ${card.rarity}, ${card.cost} elixir`,
    );
    btn.appendChild(cardTileCanvas(id));
    const name = document.createElement("div");
    name.textContent = cardDisplayName(id);
    btn.appendChild(name);
    const cost = document.createElement("div");
    cost.className = "pcost";
    cost.setAttribute("aria-hidden", "true");
    cost.textContent = String(card.cost);
    btn.appendChild(cost);
    btn.addEventListener("click", () => add(id));
    grid.appendChild(btn);
  }
  sync();

  function commitDeck(): boolean {
    if (!isOwnedDeck(deck, owned)) return false;
    playerDeck = deck.slice();
    profile = { ...profile, deck: playerDeck };
    persistProfile();
    return true;
  }

  startBtn.addEventListener("click", () => {
    if (!commitDeck()) return;
    if (opts.mode === "battle") {
      closeDeckPicker();
      restart();
    } else {
      openHome();
    }
  });

  friendBtn?.addEventListener("click", () => {
    if (!commitDeck()) return;
    openFriendLobby(deck.slice());
  });
}

// ---- Friend lobby (create / join a LAN room) ---------------------------

function connectRoom(): RoomClient {
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
  hint.innerHTML = `Mode: <b>${netGameMode().name}</b><br/>You both need to be on the same Wi-Fi.`;
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
      closeDeckPicker();
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
    const netMode = netGameMode();
    const hostDeck = netMode.mirror ? botDeck() : deck;
    c.create(hostDeck, { elixirRate: netMode.elixirRate, mirror: netMode.mirror });
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
    openDeckPicker({ mode: "battle" });
  });
}

function showPicker(): void {
  pickerRoot.classList.add("show");
  topbar.style.display = "none";
  sandboxResetBtn.style.display = "none";
}

function openHome(): void {
  buildHome();
  showPicker();
}

function openCollection(): void {
  buildCollection();
  showPicker();
}

function openChests(): void {
  buildChests();
  showPicker();
}

function openDeckPicker(opts: { mode: "battle" | "deck" } = { mode: "deck" }): void {
  buildDeckPicker(opts);
  showPicker();
}

/** Restore the in-battle HUD bar when leaving the deck picker. */
function closeDeckPicker(): void {
  pickerRoot.classList.remove("show");
  topbar.style.display = "";
}

const hud = new Hud(topbar, hudRoot, overlay, {
  onSelectCard: selectCard,
  onDeployAt: (x, y) => tryDeployAt(x, y),
  onRestart: restart,
  onToggleSound: () => {
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  onElixirLeak: () => audio.elixirLeak(),
});

// Audio can only start from a user gesture.
window.addEventListener("pointerdown", () => audio.resume(), { once: false });

// Home / deck buttons in the top bar.
const homeBtn = document.createElement("button");
homeBtn.className = "mute";
homeBtn.textContent = "🏠";
homeBtn.title = "Home";
homeBtn.addEventListener("click", openHome);
topbar.appendChild(homeBtn);

const deckBtn = document.createElement("button");
deckBtn.className = "mute";
deckBtn.textContent = "🃏";
deckBtn.title = "Edit deck";
deckBtn.addEventListener("click", () => openDeckPicker({ mode: "deck" }));
topbar.appendChild(deckBtn);
openHome();

// Trophy + currency chips in the top bar.
const trophyChip = document.createElement("div");
trophyChip.className = "crowns player meta-chip";
topbar.appendChild(trophyChip);

function refreshMetaChips(): void {
  trophyChip.innerHTML =
    `🏆 <span>${profile.trophies}</span>` +
    ` · 🪙 <span>${profile.gold}</span>` +
    ` · 💎 <span>${profile.gems}</span>`;
}
refreshMetaChips();

function applyMatchResult(winner: "player" | "enemy" | "draw"): void {
  const { profile: next, summary } = applyMetaMatchResult(
    { ...profile, deck: playerDeck, levels: cardLevels },
    winner,
  );
  profile = next;
  cardLevels = profile.levels;
  playerDeck = profile.deck;
  persistProfile();
  hud.setReward(summary.rewardLine);
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
  const radius =
    card.kind === "spell"
      ? card.radius
      : card.kind === "building"
        ? Math.max(0.7, card.unit.radius)
        : 0.55;
  scene.setHover(pos, radius, card.kind === "spell", valid, selectedCard);
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
      scene.deployFlash(pos.x, pos.y);
      selectCard(null);
      clearPreview();
      return;
    }
    if (deployCard(battle, side, selectedCard, pos.x, pos.y)) {
      scene.deployFlash(pos.x, pos.y);
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

// Tap-to-place: release on the field deploys the selected card.
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
  // "T" switches the arena theme (Arabic ⇄ normal); reloads to rebuild.
  // No-op until an edition has been chosen.
  if (ev.key === "t" || ev.key === "T") {
    if (!EDITION_CHOSEN) return;
    const cur = localStorage.getItem(ARENA_THEME_KEY) === "normal" ? "normal" : "arabic";
    localStorage.setItem(ARENA_THEME_KEY, cur === "arabic" ? "normal" : "arabic");
    location.reload();
  }
});

const SIM_DT = 1 / 30;
let last = performance.now();
let acc = 0;

const impactFlashEl = document.getElementById("impact-flash");

function flashImpact(): void {
  if (!impactFlashEl) return;
  impactFlashEl.classList.remove("show");
  void impactFlashEl.offsetWidth;
  impactFlashEl.classList.add("show");
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  // Hit-stop drains on wall-clock time. Solo matches freeze presentation +
  // sim accrual for juice; online lockstep never stalls the sim clock.
  scene.hitStop.update(dt);
  const frozen = scene.hitStop.active && mode === "solo";
  const presentDt = scene.hitStop.active ? Math.min(dt, 0.008) : dt;

  // The world holds its breath while the deck picker is open.
  if (pickerRoot.classList.contains("show")) {
    scene.render(dt);
    requestAnimationFrame(frame);
    return;
  }

  if (phase === "countdown") {
    tickCountdown(dt);
  } else if (!frozen) {
    if (mode === "online" && online) {
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
        // Sandbox: the bot sleeps (towers still defend) — pure practice.
        if (!isSandbox()) tickBot(battle, bot, SIM_DT);
        acc -= SIM_DT;
      }
    }
  }
  botEmoteCooldown = Math.max(0, botEmoteCooldown - dt);
  for (const ev of battle.events.splice(0)) {
    audio.onEvent(ev);
    scene.onEvent(ev);
    if (ev.type === "death" && (ev.kind === "princess-tower" || ev.kind === "king-tower")) {
      flashImpact();
    }
    if (ev.type === "crown" && mode === "solo") botEmote(ev.winner === "enemy" ? "😂" : "😭");
    if (ev.type === "finish") {
      // Online friendly matches and sandbox practice don't touch
      // trophies/levels — you can't farm the ladder from either.
      if (mode === "solo" && !isSandbox()) {
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
  scene.sync(battle, presentDt);
  scene.render(presentDt);
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
    entities: () => battle.entities.length,
  };
}
