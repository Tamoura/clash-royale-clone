import "./ui/tokens.css";
import "./ui/style.css";

// Offline PWA: register the service worker in production builds only —
// in dev it would cache Vite's module graph and fight hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // offline install is a bonus, never a blocker
    });
  });
}
import { SoundEngine } from "./audio/sound";
import {
  checkDeploy,
  createBattle,
  deployCard,
  effectiveCard,
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
import { Battle3D, disposeDeep, setTowerFlair } from "./render3d/scene3d";
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
import * as THREE from "three";
import {
  CHAMPION_LIMITS,
  CHAMPION_PALETTE,
  DEFAULT_CHAMPION,
  MAX_CHAMPION_COST,
  championCostInfo,
  deleteChampion,
  hasSavedChampion,
  initChampion,
  loadChampion,
  normalizeChampion,
  saveChampion,
  type ChampionDef,
} from "./game/customcard";
import { animateTroop, buildChampionRig, type TroopRig } from "./render3d/characters3d";
import { invalidatePortrait } from "./render3d/cardportraits";
import {
  loadProfile,
  saveProfile,
  applyMatchResult as applyMetaMatchResult,
  tryUpgradeCard,
  tryOpenChest,
  ownedSet,
  isOwnedDeck,
  clampDeckToOwned,
  MAX_CARD_LEVEL,
  type PlayerProfile,
} from "./meta/progress";
import {
  ARENAS,
  arenaIndexAt,
  arenaNameForUnlock,
  cardsAvailableAt,
  trophyProgress,
} from "./meta/arenas";
import { addShards, canPutInDeck, isUnlockedAt } from "./meta/collection";
import { isChestReady } from "./meta/chests";
import { CHEST_SKIP_GEMS, SHARD_GOLD_PRICE, spendGold, upgradeCost } from "./meta/economy";
import {
  DRAFT_ROUNDS,
  createDraft,
  isDraftComplete,
  pickCard as pickDraftCard,
  type DraftState,
} from "./game/draft";
import {
  CHALLENGES,
  applyWaves,
  challengeStatus,
  type Challenge,
} from "./game/challenges";
import { dailyDeck, dateKey } from "./game/daily";
import {
  ACHIEVEMENTS,
  achievementProgress,
  checkSeason,
  claimAchievement,
  isEarned,
  loadAchievements,
  loadSeason,
  recordChest as recordChestAch,
  recordMatch as recordAchMatch,
  saveAchievements,
  saveSeason,
  seasonKey,
  type SeasonState,
} from "./meta/achievements";
import {
  claimQuest,
  isComplete,
  loadQuests,
  questDef,
  recordMatch as recordQuestMatch,
  saveQuests,
} from "./meta/quests";

// Apply edition-aware CSS variables before any DOM is rendered.
applyEditionTokens(STORED_EDITION);

// Make the saved Studio champion live before any card art or sim uses it.
initChampion();

/** Edition-aware UI string: English, or Arabic in the Arabic edition. */
const tr = (en: string, ar: string): string => (ARABIC ? ar : en);

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
// ---- Match replays -------------------------------------------------------
// Solo ladder matches record the bot's seed/profile and the player's exact
// deploy ticks; the sim is deterministic, so that's the whole match.
const REPLAY_KEY = "cr-clone-replay";
interface ReplayData {
  v: 1;
  playerDeck: CardId[];
  enemyDeck: CardId[];
  playerLevels: CardLevels;
  enemyLevels: CardLevels;
  elixirRate: number;
  botSeed: number;
  botProfile: BotProfile;
  opponent: string;
  deploys: Array<{ t: number; c: CardId; x: number; y: number }>;
}
let replaying = false;
let replaySpeed = 1;
let soloTick = 0;
let recording: ReplayData | null = null;
let replayDeploys: ReplayData["deploys"] = [];
let playbackCursor = 0;

const replaySpeedBtn = document.createElement("button");
replaySpeedBtn.className = "sandbox-reset";
replaySpeedBtn.textContent = "⏩ x1";
replaySpeedBtn.setAttribute("aria-label", "Toggle replay speed");
replaySpeedBtn.style.display = "none";
replaySpeedBtn.addEventListener("click", () => {
  replaySpeed = replaySpeed === 1 ? 2 : 1;
  replaySpeedBtn.textContent = `⏩ x${replaySpeed}`;
  replaySpeedBtn.blur();
});

const sandboxResetBtn = document.createElement("button");
sandboxResetBtn.className = "sandbox-reset";
sandboxResetBtn.textContent = "↺ Reset";
sandboxResetBtn.setAttribute("aria-label", "Reset the sandbox battle");
sandboxResetBtn.style.display = "none";
stage.appendChild(sandboxResetBtn);
stage.appendChild(replaySpeedBtn);


// ---- Meta progression (gold/gems/owned/chests) --------------------------

let profile: PlayerProfile = loadProfile(localStorage);
let playerDeck: CardId[] = profile.deck;
let cardLevels: CardLevels = profile.levels;

// ---- Daily quests ---------------------------------------------------------
let quests = loadQuests(dateKey(new Date()));
let battleCardsPlayed = 0;
const towerTimeline: string[] = [];
let questsBattleRef: BattleState | null = null;
let achievements = loadAchievements();

// ---- Seasons: monthly soft-reset above the 1000-trophy floor ------------
let season: SeasonState;
{
  const roll = checkSeason(loadSeason(), seasonKey(new Date()), profile.trophies);
  season = roll.state;
  saveSeason(season);
  if (roll.reset) {
    const from = profile.trophies;
    profile = { ...profile, trophies: roll.trophies };
    saveProfile(localStorage, profile);
    // Banner once the UI exists — boot runs before the stage is built.
    window.setTimeout(() => {
      showBanner(
        tr(
          `New season! Trophies: ${from} → ${roll.trophies}`,
          `موسم جديد! الكؤوس: ${from} ← ${roll.trophies}`,
        ),
      );
    }, 1200);
  }
}

function persistProfile(): void {
  profile = { ...profile, deck: playerDeck, levels: cardLevels };
  saveProfile(localStorage, profile);
  refreshMetaChips();
  applyTowerFlair();
}

/** Cosmetic tower tiers unlocked by climbing: 600 gilded, 1200 jeweled. */
function applyTowerFlair(): void {
  setTowerFlair(profile.trophies >= 1200 ? 2 : profile.trophies >= 600 ? 1 : 0);
}
applyTowerFlair();

// ---- Bot archetypes: each ladder opponent has a personality -------------
type ArchetypeId = "balanced" | "beatdown" | "cycle" | "siege";
const ARCHETYPE_NAMES: Record<ArchetypeId, [string, string]> = {
  balanced: ["Duelist Bot", "روبوت مبارز"],
  beatdown: ["Crusher Bot", "روبوت ساحق"],
  cycle: ["Cycler Bot", "روبوت سريع"],
  siege: ["Siege Bot", "روبوت حصار"],
};

function pickArchetype(): ArchetypeId {
  const r = Math.random();
  return r < 0.25 ? "balanced" : r < 0.5 ? "beatdown" : r < 0.75 ? "cycle" : "siege";
}

/** Bot drafts from cards unlocked at the player's arena (fair ladder). */
function botDeck(archetype: ArchetypeId = "balanced"): CardId[] {
  const available = cardsAvailableAt(profile.trophies);
  let pool = available.length >= 8 ? [...available] : [...DEFAULT_DECK];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (archetype === "cycle") {
    // Cheap-first: out-tempo the player with a low curve.
    const cheap = pool.filter((id) => getCard(id).cost <= 3);
    pool = [...cheap, ...pool.filter((id) => !cheap.includes(id))];
  } else if (archetype === "beatdown") {
    // Heavies-first: guarantee tanks/win-conditions lead the deck.
    const heavy = pool.filter((id) => {
      const c = getCard(id);
      return c.kind === "troop" && (c.unit.targetsBuildingsOnly || c.unit.maxHp >= 1400);
    });
    pool = [...heavy.slice(0, 3), ...pool.filter((id) => !heavy.slice(0, 3).includes(id))];
  } else if (archetype === "siege") {
    // Turtle kit: buildings + long-range troops lead; win by outlasting.
    const siegey = pool.filter((id) => {
      const c = getCard(id);
      return c.kind === "building" || (c.kind === "troop" && c.unit.attackRange >= 4.5);
    });
    pool = [...siegey.slice(0, 4), ...pool.filter((id) => !siegey.slice(0, 4).includes(id))];
  }
  const deck = pool.slice(0, 8);
  // The twist: hard bots sometimes wield YOUR champion design against you.
  if (difficulty === "hard" && hasSavedChampion() && !deck.includes("champion") && Math.random() < 0.5) {
    deck[deck.length - 1] = "champion";
  }
  return deck;
}

// ---- Win/loss streaks: open rubber-banding ------------------------------
// 3 straight losses quietly ease the next bot; 3 straight wins summon a
// crowned "Champion Bot" that thinks faster but pays bonus gold.
const STREAK_KEY = "cr-clone-streak";
let streak = { wins: 0, losses: 0 };
try {
  const raw = localStorage.getItem(STREAK_KEY);
  if (raw) streak = { wins: 0, losses: 0, ...JSON.parse(raw) };
} catch {
  // fresh streak
}
function saveStreak(): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  } catch {
    // storage unavailable
  }
}
const CHAMPION_BONUS_GOLD = 40;
let championBotMatch = false;

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

// ---- Special solo battles (draft / challenge / daily) --------------------
// "ladder" is the normal bot match that moves trophies/chests; the special
// kinds replay themselves on "Play again" and never touch the ladder.

type BattleKind = "ladder" | "draft" | "challenge" | "daily";
let battleKind: BattleKind = "ladder";
let activeChallenge: Challenge | null = null;
let waveCursor = { next: 0 };
let draftState: DraftState | null = null;
let draftDecks: { mine: CardId[]; bot: CardId[] } | null = null;

const CHALLENGES_DONE_KEY = "cr-clone-challenges-done";
const DAILY_DONE_KEY = "cr-clone-daily-done";

function challengesDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHALLENGES_DONE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function markChallengeDone(id: string): void {
  const done = challengesDone();
  done.add(id);
  localStorage.setItem(CHALLENGES_DONE_KEY, JSON.stringify([...done]));
}

function isDailyDone(): boolean {
  return localStorage.getItem(DAILY_DONE_KEY) === dateKey(new Date());
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
  if (replaying) id = null; // replays are watch-only
  selectedCard = id;
  hud.setSelected(id);
  scene.setZoneVisible(id !== null && getCard(id).kind === "troop");
}

/** Restart whatever we were just playing (ladder, draft, challenge, daily). */
function restart(): void {
  if (battleKind === "challenge" && activeChallenge) {
    startChallenge(activeChallenge);
    return;
  }
  if (battleKind === "daily") {
    startDaily();
    return;
  }
  if (battleKind === "draft" && draftDecks) {
    startSpecialBattle("draft", draftDecks.mine, draftDecks.bot, "Draft Bot");
    return;
  }
  startLadder();
}

/** A normal trophy/chest bot match with the saved deck + selected mode. */
function startLadder(): void {
  battleKind = "ladder";
  activeChallenge = null;
  mode = "solo";
  online = null;
  // Crazy mode rerolls a scrambled card set each match; other modes use stock.
  setCardOverrides(gameMode.id === "crazy" ? crazyCards() : null);
  const archetype = pickArchetype();
  // Mirror mode: player and bot share one random deck for a pure-skill match.
  const shared = gameMode.mirror ? botDeck() : null;
  const myDeck = shared ?? playerDeck;
  const foeDeck = shared ?? botDeck(archetype);
  const foeLevels = botLevels();
  battle = createBattle(
    myDeck,
    foeDeck,
    { player: cardLevels, enemy: foeLevels },
    gameMode.elixirRate,
  );
  const base = DIFFICULTIES[difficulty];
  // Personality tweaks: beatdown banks bigger pushes, cycle plays faster,
  // siege turtles behind buildings and only commits when fully loaded.
  const tuned: BotProfile =
    archetype === "beatdown"
      ? { thinkInterval: base.thinkInterval, pushAt: Math.min(10, base.pushAt + 1) }
      : archetype === "cycle"
        ? { thinkInterval: base.thinkInterval * 0.85, pushAt: Math.max(4, base.pushAt - 2) }
        : archetype === "siege"
          ? { thinkInterval: base.thinkInterval * 1.1, pushAt: 10 }
          : base;
  championBotMatch = !isSandbox() && streak.wins >= 3;
  const mercy = !isSandbox() && streak.losses >= 3;
  const banded: BotProfile = championBotMatch
    ? { thinkInterval: tuned.thinkInterval * 0.85, pushAt: Math.max(4, tuned.pushAt - 1) }
    : mercy
      ? { thinkInterval: tuned.thinkInterval * 1.35, pushAt: Math.min(10, tuned.pushAt + 1) }
      : tuned;
  const botSeed = Date.now() & 0xffff;
  bot = createBot(botSeed, banded);
  replaying = false;
  soloTick = 0;
  selectCard(null);
  hud.setReward(null);
  const baseName = tr(ARCHETYPE_NAMES[archetype][0], ARCHETYPE_NAMES[archetype][1]);
  hud.setOpponentName(
    isSandbox()
      ? tr("Training dummy", "دمية تدريب")
      : championBotMatch
        ? `👑 ${tr("Champion", "بطل")} ${baseName}`
        : baseName,
  );
  if (championBotMatch) {
    window.setTimeout(
      () =>
        showBanner(
          tr(
            `A Champion Bot approaches — beat it for +${CHAMPION_BONUS_GOLD} 🪙!`,
            `بوت بطل يقترب — اهزمه مقابل +${CHAMPION_BONUS_GOLD} 🪙!`,
          ),
        ),
      2600,
    );
  }
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = isSandbox() ? "" : "none";
  replaySpeedBtn.style.display = "none";
  // Crazy mode scrambles card stats each match, so it can't replay.
  recording =
    isSandbox() || gameMode.id === "crazy"
      ? null
      : {
          v: 1,
          playerDeck: [...myDeck],
          enemyDeck: [...foeDeck],
          playerLevels: { ...cardLevels },
          enemyLevels: { ...foeLevels },
          elixirRate: gameMode.elixirRate ?? 1,
          botSeed,
          botProfile: banded,
          opponent: baseName,
          deploys: [],
        };
  startCountdown();
  maybeShowFirstBattleTips();
}

/** Rewatch the saved recording: same decks, same bot seed, same deploys. */
function startReplay(): void {
  let rep: ReplayData;
  try {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (!raw) return;
    rep = JSON.parse(raw) as ReplayData;
    if (rep.v !== 1) return;
  } catch {
    return;
  }
  battleKind = "ladder";
  activeChallenge = null;
  mode = "solo";
  online = null;
  setCardOverrides(null);
  battle = createBattle(
    rep.playerDeck,
    rep.enemyDeck,
    { player: rep.playerLevels, enemy: rep.enemyLevels },
    rep.elixirRate,
  );
  bot = createBot(rep.botSeed, rep.botProfile);
  replaying = true;
  recording = null;
  soloTick = 0;
  playbackCursor = 0;
  replayDeploys = rep.deploys;
  replaySpeed = 1;
  replaySpeedBtn.textContent = "⏩ x1";
  replaySpeedBtn.style.display = "";
  sandboxResetBtn.style.display = "none";
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName(`📺 ${rep.opponent}`);
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
  window.setTimeout(
    () => showBanner(tr("REPLAY — ⏩ to speed up", "إعادة — ⏩ للتسريع")),
    2600,
  );
}

/** Three timed hints during the very first battle, then never again. */
function maybeShowFirstBattleTips(): void {
  try {
    if (localStorage.getItem("cr-clone-tutored")) return;
    localStorage.setItem("cr-clone-tutored", "1");
  } catch {
    return;
  }
  const tipBattle = battle;
  const tips: [number, string][] = [
    [5000, tr("Tap a card, then tap your half to deploy!", "!اضغط بطاقة ثم اضغط نصفك لتنشرها")],
    [10000, tr("Destroy their towers — protect your own!", "!دمّر أبراجهم واحمِ أبراجك")],
    [15000, tr("Full elixir wastes away — keep spending!", "!الإكسير الممتلئ يُهدر — واصل الإنفاق")],
  ];
  for (const [delay, text] of tips) {
    window.setTimeout(() => {
      if (battle === tipBattle && !battle.result) showBanner(text);
    }, delay);
  }
}

/** Solo battle with explicit decks; never moves trophies/chests. */
function startSpecialBattle(
  kind: BattleKind,
  mine: CardId[],
  theirs: CardId[],
  opponentName: string,
): void {
  battleKind = kind;
  mode = "solo";
  online = null;
  setCardOverrides(null);
  // Level playing field: no card levels in special modes.
  battle = createBattle(mine, theirs, {});
  recording = null;
  replaying = false;
  replaySpeedBtn.style.display = "none";
  bot = createBot(Date.now() & 0xffff, DIFFICULTIES[difficulty]);
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName(opponentName);
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = "none";
  closeDeckPicker();
  startCountdown();
}

function startChallenge(ch: Challenge): void {
  activeChallenge = ch;
  waveCursor = { next: 0 };
  startSpecialBattle("challenge", ch.deck, ch.deck, ch.name);
}

function startDaily(): void {
  activeChallenge = null;
  const deckOfDay = dailyDeck(dateKey(new Date()));
  startSpecialBattle("daily", deckOfDay, deckOfDay, "Daily Bot");
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
  mk(tr("⚔️ Battle", "⚔️ قتال"), "battle-btn", () => openDeckPicker({ mode: "battle" }));
  mk(tr("🎲 Draft", "🎲 انتقاء"), "battle-btn friend", () => openDraft());
  mk(tr("🧩 Challenges", "🧩 تحديات"), "battle-btn friend", () => openChallenges());
  mk(
    isDailyDone()
      ? tr("📅 Daily ✓ (done today)", "📅 اليومية ✓ (أُنجزت)")
      : tr("📅 Daily Battle", "📅 المعركة اليومية"),
    "battle-btn friend",
    () => startDaily(),
  );
  mk(tr("🃏 Deck", "🃏 المجموعة"), "battle-btn friend", () => openDeckPicker({ mode: "deck" }));
  mk(
    hasSavedChampion()
      ? tr("🛠️ Edit Champion", "🛠️ تعديل البطل")
      : tr("🛠️ Create Champion", "🛠️ إنشاء البطل"),
    "battle-btn friend",
    () => openStudio(),
  );
  mk(tr("📚 Collection", "📚 المقتنيات"), "battle-btn friend", () => openCollection());
  mk(tr("🎁 Chests", "🎁 الصناديق"), "battle-btn friend", () => openChests());
  if (localStorage.getItem(REPLAY_KEY)) {
    mk(tr("📺 Last Battle", "📺 آخر معركة"), "battle-btn friend", () => {
      closeDeckPicker();
      startReplay();
    });
  }
  pickerRoot.appendChild(nav);

  // Daily quest board: three goals, gold on claim, fresh every day.
  const today = dateKey(new Date());
  if (quests.date !== today) {
    quests = loadQuests(today);
    saveQuests(quests);
  }
  const board = document.createElement("div");
  board.className = "quest-board";
  const qTitle = document.createElement("div");
  qTitle.className = "quest-title";
  qTitle.textContent = tr("📜 Daily Quests", "📜 مهام اليوم");
  board.appendChild(qTitle);
  for (const id of quests.active) {
    const def = questDef(id);
    if (!def) continue;
    const row = document.createElement("div");
    row.className = "quest-row";
    const label = document.createElement("div");
    label.className = "quest-label";
    label.textContent = tr(def.en, def.ar);
    row.appendChild(label);
    const done = isComplete(quests, id);
    const claimed = quests.claimed.includes(id);
    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("div");
    fill.className = "quest-fill";
    fill.style.width = `${Math.round(Math.min(1, (quests.progress[id] ?? 0) / def.target) * 100)}%`;
    bar.appendChild(fill);
    const count = document.createElement("span");
    count.className = "quest-count";
    count.textContent = `${Math.min(def.target, Math.round(quests.progress[id] ?? 0))}/${def.target}`;
    bar.appendChild(count);
    row.appendChild(bar);
    const btn = document.createElement("button");
    btn.className = "quest-claim";
    if (claimed) {
      btn.textContent = "✓";
      btn.disabled = true;
    } else if (done) {
      btn.textContent = `🪙 ${def.reward}`;
      btn.addEventListener("click", () => {
        const res = claimQuest(quests, id);
        if (!res) return;
        quests = res.state;
        saveQuests(quests);
        profile = { ...profile, gold: profile.gold + res.reward };
        persistProfile();
        buildHome(); // refresh board + currency
      });
    } else {
      btn.textContent = `🪙 ${def.reward}`;
      btn.disabled = true;
    }
    row.appendChild(btn);
    board.appendChild(row);
  }
  pickerRoot.appendChild(board);

  // Achievements board: lifetime goals under the daily quests, with the
  // current season's badge in the title row.
  const aBoard = document.createElement("div");
  aBoard.className = "quest-board ach-board";
  const aTitle = document.createElement("div");
  aTitle.className = "quest-title";
  aTitle.textContent = tr("🏅 Achievements", "🏅 الإنجازات");
  const seasonChip = document.createElement("span");
  seasonChip.className = "season-chip";
  seasonChip.textContent = tr(
    `Season ${season.key} · best 🏆 ${Math.max(season.best, profile.trophies)}`,
    `موسم ${season.key} · أفضل 🏆 ${Math.max(season.best, profile.trophies)}`,
  );
  aTitle.appendChild(seasonChip);
  aBoard.appendChild(aTitle);
  // Unclaimed-first, then in-progress by closeness, claimed last.
  const sorted = [...ACHIEVEMENTS].sort((a, b) => {
    const rank = (d: (typeof ACHIEVEMENTS)[number]): number =>
      achievements.claimed.includes(d.id) ? 2 : isEarned(achievements, d) ? 0 : 1;
    return rank(a) - rank(b) ||
      achievementProgress(achievements, b) / b.target -
      achievementProgress(achievements, a) / a.target;
  });
  for (const def of sorted) {
    const row = document.createElement("div");
    row.className = "quest-row";
    const label = document.createElement("div");
    label.className = "quest-label";
    label.textContent = tr(def.en, def.ar);
    row.appendChild(label);
    const progress = achievementProgress(achievements, def);
    const earned = isEarned(achievements, def);
    const claimed = achievements.claimed.includes(def.id);
    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("div");
    fill.className = "quest-fill";
    fill.style.width = `${Math.round((progress / def.target) * 100)}%`;
    bar.appendChild(fill);
    const count = document.createElement("span");
    count.className = "quest-count";
    count.textContent = `${Math.round(progress)}/${def.target}`;
    bar.appendChild(count);
    row.appendChild(bar);
    const btn = document.createElement("button");
    btn.className = "quest-claim";
    if (claimed) {
      btn.textContent = "✓";
      btn.disabled = true;
    } else if (earned) {
      btn.textContent = `🪙 ${def.reward}`;
      btn.addEventListener("click", () => {
        const res = claimAchievement(achievements, def.id);
        if (!res) return;
        achievements = res.state;
        saveAchievements(achievements);
        profile = { ...profile, gold: profile.gold + res.reward };
        persistProfile();
        buildHome(); // refresh board + currency
      });
    } else {
      btn.textContent = `🪙 ${def.reward}`;
      btn.disabled = true;
    }
    row.appendChild(btn);
    aBoard.appendChild(row);
  }
  pickerRoot.appendChild(aBoard);
}

// ---- Character Studio ----------------------------------------------------
// Design a card: pick stats, capabilities, and a look. Elixir cost is not
// chosen — it's computed live from what the design can do (customcard.ts).

let studioAnim = 0;
let studioCleanup: (() => void) | null = null;

function openStudio(): void {
  buildStudio(loadChampion());
  showPicker();
}

function closeStudio(): void {
  cancelAnimationFrame(studioAnim);
  studioCleanup?.();
  studioCleanup = null;
}

function buildStudio(def: ChampionDef): void {
  closeStudio();
  pickerRoot.innerHTML = "";
  let cur = normalizeChampion(def);

  const title = document.createElement("h2");
  title.textContent = tr("Character Studio", "ورشة البطل");
  pickerRoot.appendChild(title);

  const hint = document.createElement("div");
  hint.className = "collect-label";
  hint.textContent = hasSavedChampion()
    ? tr("You have one champion — saving replaces it.", "لديك بطل واحد — الحفظ يستبدله.")
    : tr(
        "Design your one champion — its elixir price follows its power.",
        "صمّم بطلك الواحد — سعر الإكسير يتبع قوته.",
      );
  pickerRoot.appendChild(hint);

  const wrap = document.createElement("div");
  wrap.className = "studio-wrap";
  pickerRoot.appendChild(wrap);

  // -- Live 3D preview + computed cost --------------------------------
  const previewPane = document.createElement("div");
  previewPane.className = "studio-preview";
  wrap.appendChild(previewPane);

  const costBadge = document.createElement("div");
  costBadge.className = "studio-cost";
  costBadge.title = "Elixir cost — computed from the design";
  previewPane.appendChild(costBadge);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(230, 250);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  previewPane.appendChild(renderer.domElement);

  const summary = document.createElement("div");
  summary.className = "studio-summary";
  previewPane.appendChild(summary);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5070, 1.3));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
  key.position.set(3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.2);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const pivot = new THREE.Group();
  scene.add(pivot);
  const camera = new THREE.PerspectiveCamera(30, 230 / 250, 0.1, 30);

  let rig: TroopRig | null = null;
  function rebuildRig(): void {
    if (rig) {
      pivot.remove(rig.group);
      disposeDeep(rig.group);
    }
    rig = buildChampionRig(cur);
    pivot.add(rig.group);
    const h = (rig.hover ?? 0) + rig.height;
    camera.position.set(0, h * 0.62, h * 2.5);
    camera.lookAt(0, h * 0.5, 0);
  }

  let walking = true;
  const t0 = performance.now();
  const loop = (): void => {
    studioAnim = requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    if (rig) animateTroop(rig, { moving: walking, swing: 0, time: t, phase: 0 });
    pivot.rotation.y = 0.55 + t * 0.5;
    renderer.render(scene, camera);
  };
  loop();
  studioCleanup = () => {
    if (rig) disposeDeep(rig.group);
    renderer.dispose();
  };

  // -- Controls --------------------------------------------------------
  const controls = document.createElement("div");
  controls.className = "studio-controls";
  wrap.appendChild(controls);

  const refreshers: (() => void)[] = [];
  function refresh(): void {
    cur = normalizeChampion(cur);
    const info = championCostInfo(cur);
    // Over budget: show the HONEST price in red — a design worth more
    // than the elixir bar can pay is blocked, never discounted to 10.
    costBadge.textContent = String(info.overBudget ? info.raw : info.cost);
    costBadge.classList.toggle("over", info.overBudget);
    const bits = [
      `${cur.count > 1 ? `×${cur.count} · ` : ""}${cur.hp} HP · ${cur.damage} dmg`,
      `every ${cur.hitSpeed.toFixed(1)}s · ${cur.range <= 1 ? "melee" : `range ${cur.range}`} · ${cur.speed}`,
    ];
    const caps = Object.entries(cur.abilities)
      .filter(([, on]) => on)
      .map(([k]) => capLabel(k as keyof ChampionDef["abilities"]));
    if (caps.length) bits.push(caps.join(" · "));
    if (info.overBudget) {
      bits.push(
        `<span class="studio-warning">` +
          tr(
            `⚠️ Worth ${info.raw} elixir — the bar only holds ${MAX_CHAMPION_COST}. Tone it down to save.`,
            `⚠️ يستحق ${info.raw} إكسير — الحد الأقصى ${MAX_CHAMPION_COST}. خفّف القوة للحفظ.`,
          ) +
          `</span>`,
      );
    }
    summary.innerHTML = bits.map((b) => `<div>${b}</div>`).join("");
    saveBtn.disabled = info.overBudget;
    saveBtn.textContent = info.overBudget
      ? tr(`🚫 Too powerful (worth ${info.raw})`, `🚫 قوي جدًا (${info.raw})`)
      : tr("💾 Save Champion", "💾 حفظ البطل");
    for (const r of refreshers) r();
    rebuildRig();
  }

  function row(label: string): HTMLElement {
    const r = document.createElement("label");
    r.className = "studio-row";
    const l = document.createElement("span");
    l.textContent = label;
    r.appendChild(l);
    controls.appendChild(r);
    return r;
  }

  // Name.
  {
    const r = row(tr("Name", "الاسم"));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = CHAMPION_LIMITS.nameLength;
    input.value = cur.name;
    input.addEventListener("input", () => {
      cur.name = input.value || "Champion"; // name never affects the price
    });
    r.appendChild(input);
  }

  function slider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string = (v) => String(v),
  ): void {
    const r = row(label);
    const out = document.createElement("b");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener("input", () => {
      set(Number(input.value));
      refresh();
    });
    refreshers.push(() => {
      out.textContent = fmt(get());
      input.value = String(get());
    });
    r.appendChild(input);
    r.appendChild(out);
  }

  // One-tap starting points — each showcases a different corner of the
  // pricing model; Surprise rerolls until the design fits the budget.
  {
    const r = row(tr("Presets", "قوالب"));
    const rowEl = document.createElement("div");
    rowEl.className = "studio-presets";
    const preset = (label: string, apply: () => void): void => {
      const b = document.createElement("button");
      b.className = "studio-walk";
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        apply();
        refresh();
      });
      rowEl.appendChild(b);
    };
    const setAll = (p: Partial<ChampionDef>, caps: Partial<ChampionDef["abilities"]>): void => {
      Object.assign(cur, p);
      cur.abilities = { ...normalizeChampion(DEFAULT_CHAMPION).abilities, ...caps };
    };
    preset(tr("🛡 Tank", "🛡 درع"), () =>
      setAll(
        { count: 1, hp: 3400, damage: 230, hitSpeed: 1.6, range: 0.8, speed: "slow" },
        { buildingsOnly: true },
      ),
    );
    preset(tr("🎯 Sniper", "🎯 قنّاص"), () =>
      setAll(
        { count: 1, hp: 380, damage: 170, hitSpeed: 1.4, range: 8, speed: "medium" },
        { targetsAir: true },
      ),
    );
    preset(tr("👥 Swarm", "👥 حشد"), () =>
      setAll(
        { count: 5, hp: 160, damage: 80, hitSpeed: 1.0, range: 0.8, speed: "fast" },
        {},
      ),
    );
    preset(tr("🎲 Surprise", "🎲 مفاجأة"), () => {
      const L = CHAMPION_LIMITS;
      const ri = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));
      for (let tries = 0; tries < 40; tries++) {
        setAll(
          {
            count: ri(1, 5),
            hp: ri(L.hp.min / 50, 3000 / 50) * 50,
            damage: ri(L.damage.min / 10, 50) * 10,
            hitSpeed: 0.9 + ri(0, 17) * 0.1,
            range: Math.random() < 0.5 ? 0.8 : ri(3, 8),
            speed: (["slow", "medium", "fast"] as const)[ri(0, 2)],
          },
          {},
        );
        for (const k of Object.keys(cur.abilities) as (keyof ChampionDef["abilities"])[]) {
          cur.abilities[k] = Math.random() < 0.22;
        }
        cur = normalizeChampion(cur);
        if (!championCostInfo(cur).overBudget) break;
      }
    });
    r.appendChild(rowEl);
  }

  slider(tr("Units", "الوحدات"), CHAMPION_LIMITS.count.min, CHAMPION_LIMITS.count.max, 1,
    () => cur.count, (v) => (cur.count = v));
  slider(tr("HP", "الصحة"), CHAMPION_LIMITS.hp.min, CHAMPION_LIMITS.hp.max, 50,
    () => cur.hp, (v) => (cur.hp = v));
  slider(tr("Damage", "الضرر"), CHAMPION_LIMITS.damage.min, CHAMPION_LIMITS.damage.max, 10,
    () => cur.damage, (v) => (cur.damage = v));
  slider(tr("Hit every", "يضرب كل"), CHAMPION_LIMITS.hitSpeed.min, CHAMPION_LIMITS.hitSpeed.max, 0.1,
    () => cur.hitSpeed, (v) => (cur.hitSpeed = v), (v) => `${v.toFixed(1)}s`);

  function select<T extends string | number>(
    label: string,
    options: { value: T; text: string }[],
    get: () => T,
    set: (v: T) => void,
  ): void {
    const r = row(label);
    const sel = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = String(o.value);
      opt.textContent = o.text;
      sel.appendChild(opt);
    }
    sel.value = String(get());
    sel.addEventListener("change", () => {
      const v = options.find((o) => String(o.value) === sel.value)!.value;
      set(v);
      refresh();
    });
    refreshers.push(() => (sel.value = String(get())));
    r.appendChild(sel);
  }

  select<number>(
    tr("Reach", "المدى"),
    [
      { value: 0.8, text: tr("Melee", "التحام") },
      ...[3, 4, 5, 6, 7, 8].map((n) => ({ value: n, text: tr(`${n} tiles`, `${n} بلاطات`) })),
    ],
    () => cur.range,
    (v) => (cur.range = v),
  );
  select<ChampionDef["speed"]>(
    tr("Speed", "السرعة"),
    [
      { value: "slow", text: tr("Slow", "بطيء") },
      { value: "medium", text: tr("Medium", "متوسط") },
      { value: "fast", text: tr("Fast", "سريع") },
    ],
    () => cur.speed,
    (v) => (cur.speed = v),
  );

  // Capabilities — each priced into the elixir cost.
  const capsHead = document.createElement("div");
  capsHead.className = "studio-section";
  capsHead.textContent = tr("Capabilities (each adds to the price)", "القدرات (كل قدرة تزيد السعر)");
  controls.appendChild(capsHead);
  const capsGrid = document.createElement("div");
  capsGrid.className = "studio-caps";
  controls.appendChild(capsGrid);
  for (const cap of Object.keys(cur.abilities) as (keyof ChampionDef["abilities"])[]) {
    const lab = document.createElement("label");
    lab.className = "studio-cap";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cur.abilities[cap];
    cb.addEventListener("change", () => {
      cur.abilities[cap] = cb.checked;
      refresh();
    });
    refreshers.push(() => {
      cb.checked = cur.abilities[cap];
      // Pierce needs reach; flyers ignore the river on their own.
      cb.disabled =
        (cap === "pierce" && cur.range <= 1) ||
        (cap === "jumpsRiver" && cur.abilities.flying);
      lab.classList.toggle("off", cb.disabled);
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(capLabel(cap)));
    capsGrid.appendChild(lab);
  }

  // Appearance.
  const lookHead = document.createElement("div");
  lookHead.className = "studio-section";
  lookHead.textContent = tr("Appearance (free — style is never priced)", "المظهر (مجاني — لا يؤثر في السعر)");
  controls.appendChild(lookHead);

  function swatches(label: string, get: () => number, set: (v: number) => void): void {
    const r = row(label);
    const rowEl = document.createElement("div");
    rowEl.className = "studio-swatches";
    for (const c of CHAMPION_PALETTE) {
      const b = document.createElement("button");
      b.className = "studio-swatch";
      b.style.background = `#${c.toString(16).padStart(6, "0")}`;
      b.setAttribute("aria-label", `#${c.toString(16).padStart(6, "0")}`);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        set(c);
        refresh();
      });
      refreshers.push(() => b.classList.toggle("sel", get() === c));
      rowEl.appendChild(b);
    }
    r.appendChild(rowEl);
  }
  swatches(tr("Outfit", "الزي"), () => cur.look.body, (v) => (cur.look.body = v));
  swatches(tr("Trim", "الزخرفة"), () => cur.look.trim, (v) => (cur.look.trim = v));

  select<ChampionDef["look"]["headgear"]>(
    tr("Headgear", "غطاء الرأس"),
    [
      { value: "helmet", text: tr("Helmet", "خوذة") },
      { value: "hood", text: tr("Hood", "قلنسوة") },
      { value: "crown", text: tr("Crown", "تاج") },
      { value: "horns", text: tr("Horns", "قرون") },
      { value: "turban", text: tr("Turban", "عمامة") },
      { value: "none", text: tr("None", "بدون") },
    ],
    () => cur.look.headgear,
    (v) => (cur.look.headgear = v),
  );
  select<ChampionDef["look"]["weapon"]>(
    tr("Weapon", "السلاح"),
    [
      { value: "sword", text: tr("Sword", "سيف") },
      { value: "axe", text: tr("Axe", "فأس") },
      { value: "hammer", text: tr("Hammer", "مطرقة") },
      { value: "spear", text: tr("Spear", "رمح") },
      { value: "bow", text: tr("Bow", "قوس") },
      { value: "staff", text: tr("Staff", "عصا") },
      { value: "none", text: tr("Fists", "قبضات") },
    ],
    () => cur.look.weapon,
    (v) => (cur.look.weapon = v),
  );
  select<ChampionDef["look"]["mood"]>(
    tr("Face", "الوجه"),
    [
      { value: "brave", text: tr("Brave", "شجاع") },
      { value: "angry", text: tr("Angry", "غاضب") },
      { value: "cute", text: tr("Cute", "لطيف") },
      { value: "wicked", text: tr("Wicked", "شرير") },
      { value: "calm", text: tr("Calm", "هادئ") },
    ],
    () => cur.look.mood,
    (v) => (cur.look.mood = v),
  );

  {
    const r = row(tr("Preview", "المعاينة"));
    const b = document.createElement("button");
    b.className = "studio-walk";
    b.textContent = tr("🚶 Walking", "🚶 يمشي");
    b.addEventListener("click", (e) => {
      e.preventDefault();
      walking = !walking;
      b.textContent = walking ? tr("🚶 Walking", "🚶 يمشي") : tr("🧍 Standing", "🧍 واقف");
    });
    r.appendChild(b);
  }

  const saveBtn = document.createElement("button");
  saveBtn.className = "battle-btn";
  saveBtn.textContent = "💾 Save Champion";
  saveBtn.addEventListener("click", () => {
    cur.name = cur.name.trim() || "Champion";
    if (!saveChampion(cur)) return; // over budget — the guardrail refused
    invalidatePortrait("champion");
    if (!profile.owned.includes("champion")) {
      profile = { ...profile, owned: [...profile.owned, "champion"] };
    }
    persistProfile();
    closeStudio();
    openDeckPicker({ mode: "deck" }); // slot it straight into the deck
  });
  pickerRoot.appendChild(saveBtn);

  // Delete the (single) champion: two taps to confirm, then it's removed
  // from the save, the collection, and the deck.
  if (hasSavedChampion()) {
    const delBtn = document.createElement("button");
    delBtn.className = "back-btn studio-delete";
    delBtn.textContent = tr("🗑️ Delete Champion", "🗑️ حذف البطل");
    let armed = false;
    delBtn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = tr("⚠️ Tap again to delete", "⚠️ اضغط مجددًا للحذف");
        delBtn.classList.add("armed");
        return;
      }
      deleteChampion();
      invalidatePortrait("champion");
      const owned = profile.owned.filter((id) => id !== "champion");
      playerDeck = clampDeckToOwned(
        playerDeck.filter((id) => id !== "champion"),
        ownedSet(owned),
      );
      profile = { ...profile, owned, deck: playerDeck };
      persistProfile();
      closeStudio();
      openHome();
    });
    pickerRoot.appendChild(delBtn);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = tr("← Home", "← الرئيسية");
  backBtn.addEventListener("click", () => {
    closeStudio();
    openHome();
  });
  pickerRoot.appendChild(backBtn);

  refresh();
}

function capLabel(cap: keyof ChampionDef["abilities"]): string {
  const labels: Record<keyof ChampionDef["abilities"], [string, string]> = {
    flying: ["🕊️ Flies", "🕊️ يطير"],
    targetsAir: ["🎯 Hits air", "🎯 يضرب الجو"],
    splash: ["💥 Splash", "💥 ضرر منطقة"],
    charge: ["🐎 Charge (2x)", "🐎 شحنة (×2)"],
    stun: ["⚡ Stunning hits", "⚡ ضربات صاعقة"],
    chill: ["❄️ Chilling hits", "❄️ ضربات مجمّدة"],
    pierce: ["🏹 Piercing shots", "🏹 سهام خارقة"],
    jumpsRiver: ["🌊 River jump", "🌊 قفز النهر"],
    deathBomb: ["💣 Death bomb", "💣 قنبلة موت"],
    buildingsOnly: ["🏰 Building hunter (cheaper!)", "🏰 صائد المباني (أرخص!)"],
    summoner: ["💀 Summons skeletons", "💀 يستدعي الميليشيا"],
  };
  return tr(labels[cap][0], labels[cap][1]);
}

// ---- Draft screen --------------------------------------------------------

function openDraft(): void {
  draftState = createDraft(Date.now() | 0);
  buildDraft();
  showPicker();
}

function buildDraft(): void {
  const d = draftState;
  if (!d) return;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = `Draft — pick ${d.picks.length + 1} of ${DRAFT_ROUNDS}`;
  pickerRoot.appendChild(title);

  const hint = document.createElement("div");
  hint.className = "collect-label";
  hint.textContent = "Keep one card — the bot grabs one of the others!";
  pickerRoot.appendChild(hint);

  const row = document.createElement("div");
  row.className = "picker-grid draft-row";
  for (const id of d.offers) {
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.rarity = card.rarity;
    btn.setAttribute(
      "aria-label",
      `Keep ${cardDisplayName(id)}, ${card.cost} elixir`,
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
    btn.addEventListener("click", () => {
      const next = pickDraftCard(d, id);
      if (!next) return;
      draftState = next;
      if (isDraftComplete(next)) {
        draftDecks = { mine: next.picks, bot: next.botPicks };
        draftState = null;
        startSpecialBattle("draft", next.picks, next.botPicks, "Draft Bot");
      } else {
        buildDraft();
      }
    });
    row.appendChild(btn);
  }
  pickerRoot.appendChild(row);

  if (d.picks.length > 0) {
    const mine = document.createElement("div");
    mine.className = "collect-label";
    mine.textContent = `Your deck so far: ${d.picks.map(cardDisplayName).join(" · ")}`;
    pickerRoot.appendChild(mine);
  }

  const back = document.createElement("button");
  back.className = "battle-btn friend";
  back.textContent = "← Home";
  back.addEventListener("click", () => openHome());
  pickerRoot.appendChild(back);
}

// ---- Challenges screen ---------------------------------------------------

function openChallenges(): void {
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Challenges";
  pickerRoot.appendChild(title);

  const done = challengesDone();
  for (const ch of CHALLENGES) {
    const row = document.createElement("div");
    row.className = "challenge-row";
    const info = document.createElement("div");
    info.className = "challenge-info";
    info.innerHTML =
      `<div class="challenge-name">${done.has(ch.id) ? "✅ " : ""}${ch.name}</div>` +
      `<div class="challenge-blurb">${ch.blurb}</div>`;
    row.appendChild(info);
    const play = document.createElement("button");
    play.className = "battle-btn challenge-play";
    play.textContent = done.has(ch.id) ? "Replay" : `Play · +${ch.goldReward} 🪙`;
    play.setAttribute("aria-label", `Play challenge ${ch.name}`);
    play.addEventListener("click", () => startChallenge(ch));
    row.appendChild(play);
    pickerRoot.appendChild(row);
  }

  const back = document.createElement("button");
  back.className = "battle-btn friend";
  back.textContent = "← Home";
  back.addEventListener("click", () => openHome());
  pickerRoot.appendChild(back);
  showPicker();
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
          const shardsHave = profile.shards[id] ?? 0;
          const missing = Math.max(0, upc2.shards - shardsHave);
          const craftPrice = missing * SHARD_GOLD_PRICE;
          detail.textContent =
            result.reason === "afford"
              ? `Need ${upc2.gold} gold + ${upc2.shards} shards`
              : "Can't upgrade";
          // Agency: short on shards but flush on gold? Craft them on the spot.
          if (
            result.reason === "afford" &&
            missing > 0 &&
            profile.gold >= upc2.gold + craftPrice
          ) {
            const craft = document.createElement("button");
            craft.className = "quest-claim craft-btn";
            craft.textContent = tr(
              `⚒️ Craft ${missing} shard${missing > 1 ? "s" : ""} — 🪙 ${craftPrice}`,
              `⚒️ اصنع ${missing} شظية — 🪙 ${craftPrice}`,
            );
            craft.addEventListener("click", () => {
              const left = spendGold(profile.gold, craftPrice);
              if (left === null) return;
              profile = {
                ...profile,
                gold: left,
                shards: addShards(profile.shards, id, missing),
              };
              persistProfile();
              buildCollection();
            });
            detail.appendChild(document.createTextNode(" "));
            detail.appendChild(craft);
          }
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
    if (ready) cell.classList.add("ready");
    // CSS-art chest: banded wooden trunk with a gold lock; wobbles when ready.
    const art = document.createElement("div");
    art.className = "chest-art" + (slot.rarity === "rare" ? " rare" : "");
    art.innerHTML =
      '<div class="chest-base"></div><div class="chest-lid"></div>' +
      '<div class="chest-band"></div><div class="chest-lock"></div>';
    cell.appendChild(art);
    const label = document.createElement("div");
    label.className = "chest-rarity";
    label.textContent = slot.rarity === "rare" ? tr("Rare", "نادر") : tr("Free", "مجاني");
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
      // Lid-pop first, then the loot reveal bursts out of the open chest.
      cell.classList.add("opening");
      achievements = recordChestAch(achievements);
      saveAchievements(achievements);
      openBtn.disabled = true;
      window.setTimeout(() => {
        reveal.textContent = bits.join(" · ");
        reveal.classList.remove("burst");
        void reveal.offsetWidth;
        reveal.classList.add("burst");
      }, 350);
      // Rebuild after a beat so the player can read the reveal.
      window.setTimeout(() => buildChests(), 1600);
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
    opts.mode === "battle"
      ? tr("⚔️ Battle the Bot", "⚔️ قتال الروبوت")
      : tr("💾 Save deck", "💾 حفظ المجموعة");
  startBtn.setAttribute(
    "aria-label",
    opts.mode === "battle" ? "Start a battle against the bot" : "Save deck",
  );
  pickerRoot.appendChild(startBtn);

  let friendBtn: HTMLButtonElement | null = null;
  if (opts.mode === "battle") {
    friendBtn = document.createElement("button");
    friendBtn.className = "battle-btn friend";
    friendBtn.textContent = tr("🤝 Play a Friend", "🤝 اللعب مع صديق");
    friendBtn.setAttribute("aria-label", "Start an online match with a friend");
    pickerRoot.appendChild(friendBtn);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = tr("← Home", "← الرئيسية");
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
    if (friendBtn) {
      // The Studio champion exists only in this player's save — the other
      // client can't reproduce it, so online play would desync. Bot-only.
      const hasChampion = deck.includes("champion");
      friendBtn.disabled = !legal || hasChampion;
      friendBtn.title = hasChampion
        ? tr(
            "Your Champion is bot-battles only — remove it to play a friend.",
            "بطلك لمعارك الروبوت فقط — أزله للعب مع صديق.",
          )
        : "";
    }
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
      startLadder();
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

/** First-time gold for beating a challenge / the daily (never trophies). */
function applySpecialReward(): void {
  if (battleKind === "challenge" && activeChallenge) {
    if (challengesDone().has(activeChallenge.id)) return;
    markChallengeDone(activeChallenge.id);
    profile = { ...profile, gold: profile.gold + activeChallenge.goldReward };
    persistProfile();
    hud.setReward(`First clear! +${activeChallenge.goldReward} 🪙`);
  } else if (battleKind === "daily") {
    if (isDailyDone()) return;
    localStorage.setItem(DAILY_DONE_KEY, dateKey(new Date()));
    profile = { ...profile, gold: profile.gold + 100 };
    persistProfile();
    hud.setReward("Daily complete! +100 🪙");
  }
}

function applyMatchResult(winner: "player" | "enemy" | "draw"): void {
  const arenaBefore = arenaIndexAt(profile.trophies);
  const { profile: next, summary } = applyMetaMatchResult(
    { ...profile, deck: playerDeck, levels: cardLevels },
    winner,
  );
  const arenaAfter = arenaIndexAt(next.trophies);
  if (arenaAfter > arenaBefore) {
    window.setTimeout(() => showArenaUp(ARENAS[arenaAfter]), 900);
  }
  profile = next;
  cardLevels = profile.levels;
  playerDeck = profile.deck;
  persistProfile();
  season = { ...season, best: Math.max(season.best, profile.trophies) };
  saveSeason(season);
  achievements = {
    ...achievements,
    counters: {
      ...achievements.counters,
      bestTrophies: Math.max(achievements.counters.bestTrophies, profile.trophies),
    },
  };
  saveAchievements(achievements);
  hud.setReward(summary.rewardLine);
}

/** Full-screen "NEW ARENA" celebration with the newly findable cards. */
function showArenaUp(arena: (typeof ARENAS)[number]): void {
  document.getElementById("arena-up")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "arena-up";
  const inner = document.createElement("div");
  inner.className = "arena-up-card";
  const crown = document.createElement("div");
  crown.className = "arena-up-crown";
  crown.textContent = "🏟️";
  inner.appendChild(crown);
  const title = document.createElement("h2");
  title.textContent = tr("NEW ARENA!", "!ساحة جديدة");
  inner.appendChild(title);
  const name = document.createElement("div");
  name.className = "arena-up-name";
  name.textContent = arena.name;
  inner.appendChild(name);
  if (arena.unlocks.length > 0) {
    const label = document.createElement("div");
    label.className = "arena-up-label";
    label.textContent = tr("New cards now drop from chests:", ":بطاقات جديدة في الصناديق");
    inner.appendChild(label);
    const row = document.createElement("div");
    row.className = "arena-up-cards";
    for (const id of arena.unlocks.slice(0, 4)) {
      const cell = document.createElement("div");
      cell.className = "arena-up-cardcell";
      cell.appendChild(cardTileCanvas(id));
      const n = document.createElement("span");
      n.textContent = cardDisplayName(id);
      cell.appendChild(n);
      row.appendChild(cell);
    }
    inner.appendChild(row);
  }
  const hint = document.createElement("div");
  hint.className = "arena-up-hint";
  hint.textContent = tr("Tap to continue", "اضغط للمتابعة");
  inner.appendChild(hint);
  wrap.appendChild(inner);
  wrap.addEventListener("pointerdown", () => wrap.remove());
  document.body.appendChild(wrap);
  audio.sting();
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
  // Preview what will actually happen: the Mirror aims and ghosts as the
  // card it would copy (blast radius, troop ghost), not as itself.
  const card =
    effectiveCard(battle, localSide(), selectedCard)?.card ?? getCard(selectedCard);
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
  scene.setHover(pos, radius, card.kind === "spell", valid, card.id);
  scene.setGhost(card.kind === "spell" ? null : card.id, pos);
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
      // Replay tape: remember the card and the exact tick it went down.
      if (recording && mode === "solo") {
        recording.deploys.push({ t: soloTick, c: selectedCard, x: pos.x, y: pos.y });
      }
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
  // Typing in a form field (Studio name, room code…) is not a hotkey —
  // without this guard, a name containing "t" reloaded the whole page.
  const el = ev.target as HTMLElement | null;
  if (
    el &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  ) {
    return;
  }
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
      acc += dt * (replaying ? replaySpeed : 1);
      while (acc >= SIM_DT) {
        // Replay: re-issue the recorded player deploys at their exact ticks.
        if (replaying) {
          while (
            playbackCursor < replayDeploys.length &&
            replayDeploys[playbackCursor].t === soloTick
          ) {
            const d = replayDeploys[playbackCursor++];
            deployCard(battle, "player", d.c, d.x, d.y);
          }
        }
        tick(battle, SIM_DT);
        // Sandbox: the bot sleeps (towers still defend) — pure practice.
        // Challenges: the scripted waves ARE the opponent.
        if (!isSandbox() && battleKind !== "challenge") {
          tickBot(battle, bot, SIM_DT);
        }
        soloTick++;
        if (battleKind === "challenge" && activeChallenge && !battle.result) {
          applyWaves(battle, activeChallenge, waveCursor);
          const status = challengeStatus(battle, activeChallenge);
          if (status !== "playing") {
            battle.result = {
              winner: status === "won" ? "player" : "enemy",
              playerCrowns: battle.player.crowns,
              enemyCrowns: battle.enemy.crowns,
            };
            battle.events.push({ type: "finish", winner: battle.result.winner });
          }
        }
        acc -= SIM_DT;
      }
    }
  }
  botEmoteCooldown = Math.max(0, botEmoteCooldown - dt);
  // New battle object → fresh quest counters + report timeline.
  if (questsBattleRef !== battle) {
    questsBattleRef = battle;
    battleCardsPlayed = 0;
    towerTimeline.length = 0;
    hud.setTimeline(towerTimeline);
  }
  for (const ev of battle.events.splice(0)) {
    audio.onEvent(ev);
    scene.onEvent(ev);
    if ((ev.type === "deploy" || ev.type === "spell") && ev.side === localSide()) {
      battleCardsPlayed++;
    }
    if (ev.type === "finish" && recording && mode === "solo" && battleKind === "ladder" && !isSandbox()) {
      try {
        localStorage.setItem(REPLAY_KEY, JSON.stringify(recording));
      } catch {
        // tape too big / storage unavailable — skip silently
      }
      recording = null;
    }
    if (ev.type === "finish" && mode === "solo" && !isSandbox() && !replaying) {
      // Fold the match into today's quests (any real solo battle counts).
      const today = dateKey(new Date());
      if (quests.date !== today) quests = loadQuests(today);
      quests = recordQuestMatch(quests, {
        won: ev.winner === "player",
        cardsPlayed: battleCardsPlayed,
        damage: battle.player.stats.damageDealt,
      });
      saveQuests(quests);
      achievements = recordAchMatch(achievements, {
        won: ev.winner === localSide(),
        crowns: mySideState().crowns,
        cardsPlayed: battleCardsPlayed,
        damage: mySideState().stats.damageDealt,
        durationSec: battle.time,
        deckHadChampion: playerDeck.includes("champion"),
        trophiesAfter: profile.trophies,
      });
      saveAchievements(achievements);
      battleCardsPlayed = 0;
    }
    if (ev.type === "death" && (ev.kind === "princess-tower" || ev.kind === "king-tower")) {
      flashImpact();
      // Report timeline: who lost which tower, and when.
      const mm = Math.floor(battle.time / 60);
      const ss = String(Math.floor(battle.time % 60)).padStart(2, "0");
      const mine = ev.side === localSide();
      const tower =
        ev.kind === "king-tower" ? tr("King", "الملك") : tr("Princess", "الأميرة");
      towerTimeline.push(
        `${mm}:${ss} — ${mine ? "🛡️" : "⚔️"} ${
          mine ? tr(`your ${tower} tower fell`, `سقط برج ${tower} لديك`)
               : tr(`enemy ${tower} tower fell`, `سقط برج ${tower} للخصم`)
        }`,
      );
    }
    if (ev.type === "crown" && mode === "solo") botEmote(ev.winner === "enemy" ? "😂" : "😭");
    if (ev.type === "finish") {
      // Only ladder matches move trophies/levels/chests — online friendlies,
      // sandbox, and the special modes can't farm the ladder.
      if (mode === "solo" && battleKind === "ladder" && !isSandbox() && !replaying) {
        botEmote(ev.winner === "enemy" ? "🎉" : "😭");
        applyMatchResult(ev.winner);
        if (ev.winner === "player") {
          streak = { wins: streak.wins + 1, losses: 0 };
          if (championBotMatch) {
            profile = { ...profile, gold: profile.gold + CHAMPION_BONUS_GOLD };
            persistProfile();
            showBanner(tr(`Champion beaten! +${CHAMPION_BONUS_GOLD} 🪙`, `هزمت البطل! +${CHAMPION_BONUS_GOLD} 🪙`));
            streak = { wins: 0, losses: 0 }; // the gauntlet resets after the boss
          }
        } else if (ev.winner === "enemy") {
          streak = { wins: 0, losses: streak.losses + 1 };
        }
        saveStreak();
      } else if (mode === "solo" && ev.winner === "player" && !replaying) {
        applySpecialReward();
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
