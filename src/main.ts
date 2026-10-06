import "./ui/tokens.css";
import "@fontsource/lilita-one/400.css";
// Arabic glyphs: a rounded display face to pair with Lilita One (SIL OFL).
// Arabic subset only, so the classic edition never downloads it.
import "@fontsource/baloo-bhaijaan-2/arabic-700.css";
import "@fontsource/baloo-bhaijaan-2/arabic-800.css";
import "./ui/style.css";
import { icon } from "./ui/icons";

// Warm the display face now so the first in-battle canvas labels (HP
// numbers, level shields, damage pops) never bake in a fallback font.
void document.fonts?.load("32px 'Lilita One'").catch(() => undefined);

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
  spawnUnits,
  type BattleState,
  type CardLevels,
} from "./game/battle";
import { createBot, tickBot, type BotProfile, type BotState } from "./game/bot";
import {
  DEFAULT_DECK,
  crazyCards,
  getCard,
  setCardOverrides,
  type CardId,
} from "./game/cards";
import type { Side } from "./game/arena";
import { isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D, setTowerFlair } from "./render3d/scene3d";
import {
  ARENA_THEME_KEY,
  ARABIC,
  applyEditionTokens,
  STORED_EDITION,
  EDITION_CHOSEN,
} from "./render3d/theme";
import { stateChecksum } from "./net/checksum";
import { loadMode as loadVariant, type GameMode as GameVariant } from "./launcher/mode";
import { hasSavedChampion, initChampion } from "./game/customcard";
import { loadProfile, saveProfile } from "./meta/progress";
import { ARENAS, arenaIndexAt, cardsAvailableAt } from "./meta/arenas";
import { TOWER_TROOP_IDS, loadTowerTroop, type TowerTroopId } from "./game/towers";
import {
  ABILITIES,
  ABILITY_IDS,
  loadAbility,
  useAbility,
  type AbilityId,
} from "./game/abilities";
import { applyWaves, challengeStatus, type Challenge } from "./game/challenges";
import { dailyDeck, dateKey } from "./game/daily";
import { checkSeason, loadAchievements, loadSeason, saveSeason, seasonKey } from "./meta/achievements";
import { loadQuests } from "./meta/quests";
import type { AppCtx, MetaState } from "./app/ctx";
import {
  emit,
  presentTimeScale,
  shouldRender,
  simHeld,
  type BattleKind,
} from "./app/hooks";
import { DIFFICULTIES, botLevels, loadDifficulty } from "./match/difficulty";
import { loadMode } from "./match/modes";
import { clearOnline, onlineSession, stepOnline } from "./match/online";
import { CHAMPION_BONUS_GOLD, currentStreak, settleMatch } from "./match/rewards";
import {
  checkBanners,
  getPhase,
  reduceMotion,
  setPhase,
  showBanner,
  showVersus,
  startCountdown,
  tickCountdown,
} from "./ui/banner";
import { tr } from "./ui/i18n";
import { openChallenges } from "./ui/screens/challenges";
import { openChests } from "./ui/screens/chests";
import { openCollection } from "./ui/screens/collection";
import { openDeckPicker } from "./ui/screens/deckPicker";
import { openDraft } from "./ui/screens/draft";
import { buildHome } from "./ui/screens/home";
import { openFriendLobby } from "./ui/screens/lobby";
import { openStudio } from "./ui/screens/studio";

// Apply edition-aware CSS variables before any DOM is rendered.
applyEditionTokens(STORED_EDITION);
// Canvas labels (unit names, banners) are painted once, so warm the
// Arabic face up front in the Islamic edition.
if (ARABIC) {
  for (const w of ["700", "800"]) void document.fonts?.load(`${w} 32px 'Baloo Bhaijaan 2'`, "عربي").catch(() => undefined);
}

// Make the saved Studio champion live before any card art or sim uses it.
initChampion();

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
const emoteBar = document.getElementById("emotes")!;

// Sandbox-only in-battle reset (wired to sandboxReset() further down,
// after the battle state it restarts is declared).
// ---- Match replays -------------------------------------------------------
// Solo ladder matches record the bot's seed/profile and the player's exact
// deploy ticks; the sim is deterministic, so that's the whole match.
const REPLAY_KEY = "cr-clone-replay";
// v2: the sim became engine-exact (no hypot/sin/cos), so v1 tapes no
// longer reproduce their match and are ignored.
interface ReplayData {
  v: 2;
  playerDeck: CardId[];
  enemyDeck: CardId[];
  playerLevels: CardLevels;
  enemyLevels: CardLevels;
  elixirRate: number;
  botSeed: number;
  botProfile: BotProfile;
  opponent: string;
  towers: { player: TowerTroopId; enemy: TowerTroopId };
  abilities: { player: AbilityId | null; enemy: AbilityId | null };
  abilityUses: number[];
  deploys: Array<{ t: number; c: CardId; x: number; y: number }>;
}
/** The saved tape, or null when there is none or it predates the current
 *  sim. A stale (pre-v2 or unreadable) tape is deleted on sight. */
function storedReplay(): ReplayData | null {
  try {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (!raw) return null;
    let rep: ReplayData | null = null;
    try {
      rep = JSON.parse(raw) as ReplayData;
    } catch {
      /* corrupt: dropped below */
    }
    if (rep && rep.v === 2) return rep;
    localStorage.removeItem(REPLAY_KEY);
  } catch {
    /* storage blocked */
  }
  return null;
}
// Purge a stale tape at boot, so any plain `getItem(REPLAY_KEY)` presence
// check (e.g. the home screen's Last Battle entry) stays truthful.
storedReplay();
// ---- Tower Troops: the player's chosen tower defender ---------------------
function botTowerTroop(): TowerTroopId {
  return TOWER_TROOP_IDS[Math.floor(Math.random() * TOWER_TROOP_IDS.length)];
}

// ---- King's Ability: the player's chosen power ----------------------------
function botAbility(): AbilityId {
  return ABILITY_IDS[Math.floor(Math.random() * ABILITY_IDS.length)];
}

/** Fire the local King's Ability (button / "Q"); replays are watch-only. */
function triggerAbility(): void {
  if (replaying || battle.result || getPhase() === "countdown") return;
  if (onlineSession()) return; // not lockstep-synced yet
  if (!useAbility(battle, localSide())) {
    hud.flashError("elixir");
    audio.error();
    return;
  }
  if (recording && mode() === "solo") recording.abilityUses.push(soloTick);
  showBanner(tr(ABILITIES[meta.abilityChoice].name, ABILITIES[meta.abilityChoice].ar));
  emit("input", { kind: "ability" });
}

let replaying = false;
let replaySpeed = 1;
let soloTick = 0;
let recording: ReplayData | null = null;
let replayDeploys: ReplayData["deploys"] = [];
let playbackCursor = 0;
let replayAbilityUses: number[] = [];
let abilityCursor = 0;

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
sandboxResetBtn.textContent = tr("↺ Reset", "↺ إعادة");
sandboxResetBtn.setAttribute("aria-label", "Reset the sandbox battle");
sandboxResetBtn.style.display = "none";
stage.appendChild(sandboxResetBtn);
stage.appendChild(replaySpeedBtn);

// ---- Meta progression (gold/gems/owned/chests) --------------------------
// One shared object: screens read and update it through ctx.meta.

const loadedProfile = loadProfile(localStorage);
// ---- Seasons: monthly soft-reset above the 1000-trophy floor ------------
const seasonRoll = checkSeason(loadSeason(), seasonKey(new Date()), loadedProfile.trophies);
const meta: MetaState = {
  profile: loadedProfile,
  playerDeck: loadedProfile.deck,
  cardLevels: loadedProfile.levels,
  // ---- Daily quests
  quests: loadQuests(dateKey(new Date())),
  achievements: loadAchievements(),
  season: seasonRoll.state,
  difficulty: loadDifficulty(),
  gameMode: loadMode(),
  towerTroop: loadTowerTroop(),
  abilityChoice: loadAbility(),
};
let battleCardsPlayed = 0;
const towerTimeline: string[] = [];
let questsBattleRef: BattleState | null = null;

saveSeason(meta.season);
if (seasonRoll.reset) {
  const from = meta.profile.trophies;
  meta.profile = { ...meta.profile, trophies: seasonRoll.trophies };
  saveProfile(localStorage, meta.profile);
  // Banner once the UI exists — boot runs before the stage is built.
  window.setTimeout(() => {
    showBanner(
      tr(
        `New season! Trophies: ${from} → ${seasonRoll.trophies}`,
        `موسم جديد! الكؤوس: ${from} ← ${seasonRoll.trophies}`,
      ),
    );
  }, 1200);
}

function persistProfile(): void {
  meta.profile = { ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels };
  saveProfile(localStorage, meta.profile);
  refreshMetaChips();
  applyTowerFlair();
}

/**
 * Which trophy-road arena the next battle is staged in. `?arena=<id>` in
 * the URL previews any arena (dev/testing); otherwise it's the arena the
 * player's trophies stand in.
 */
function battleArenaId(): string {
  const forced = new URLSearchParams(location.search).get("arena");
  if (forced && ARENAS.some((a) => a.id === forced)) return forced;
  return ARENAS[arenaIndexAt(meta.profile.trophies)].id;
}

/** Cosmetic tower tiers unlocked by climbing: 600 gilded, 1200 jeweled. */
function applyTowerFlair(): void {
  setTowerFlair(meta.profile.trophies >= 1200 ? 2 : meta.profile.trophies >= 600 ? 1 : 0);
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
  const available = cardsAvailableAt(meta.profile.trophies);
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
  if (meta.difficulty === "hard" && hasSavedChampion() && !deck.includes("champion") && Math.random() < 0.5) {
    deck[deck.length - 1] = "champion";
  }
  return deck;
}

// ---- Win/loss streaks (match/rewards.ts): 3 straight wins summon a
// crowned "Champion Bot" that thinks faster but pays bonus gold.
let championBotMatch = false;

// ---- Game modes ----------------------------------------------------------

function isSandbox(): boolean {
  return meta.gameMode.id === "sandbox";
}

// ---- Special solo battles (draft / challenge / daily) --------------------
// "ladder" is the normal bot match that moves trophies/chests; the special
// kinds replay themselves on "Play again" and never touch the ladder.

let battleKind: BattleKind = "ladder";
let activeChallenge: Challenge | null = null;
let waveCursor = { next: 0 };
let draftDecks: { mine: CardId[]; bot: CardId[] } | null = null;

// ---- Game variant (Clash Royale clone vs Islamic version) ---------------
// The variant is the arena theme under the hood; switching reloads the page.
// (Named "variant" to avoid colliding with the in-match GameMode rulesets.)
// Null until the player picks an edition in the lobby.
const variant: GameVariant | null = loadVariant(localStorage);

let battle: BattleState = createBattle(meta.playerDeck, botDeck(), {
  player: meta.cardLevels,
  enemy: botLevels(meta.profile.trophies),
});
let bot: BotState = createBot(Date.now() & 0xffff, DIFFICULTIES[meta.difficulty]);
let selectedCard: CardId | null = null;

// ---- Online 1v1 (LAN lockstep) lives in match/online.ts -----------------

/** "online" while a networked match runs, else "solo". */
const mode = (): "solo" | "online" => (onlineSession() ? "online" : "solo");

/** Which side the local player controls (host=player, guest=enemy, solo=player). */
function localSide(): Side {
  return onlineSession()?.side ?? "player";
}

/** The local player's side-state (hand, elixir) in the current battle. */
function mySideState(): BattleState["player"] {
  return localSide() === "player" ? battle.player : battle.enemy;
}

let scene: Battle3D;
try {
  scene = new Battle3D(stage);
  // `?sky=0..1` pins the living sky for previews/screenshots.
  const sky = new URLSearchParams(location.search).get("sky");
  if (sky !== null && !Number.isNaN(Number(sky))) {
    scene.forceDayPhase(Math.max(0, Math.min(1, Number(sky))));
  }
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
  if (id !== null) emit("input", { kind: "select", cardId: id });
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
  clearOnline();
  // Crazy mode rerolls a scrambled card set each match; other modes use stock.
  setCardOverrides(meta.gameMode.id === "crazy" ? crazyCards() : null);
  const archetype = pickArchetype();
  // Mirror mode: player and bot share one random deck for a pure-skill match.
  const shared = meta.gameMode.mirror ? botDeck() : null;
  const myDeck = shared ?? meta.playerDeck;
  const foeDeck = shared ?? botDeck(archetype);
  const foeLevels = botLevels(meta.profile.trophies);
  const towers = { player: meta.towerTroop, enemy: botTowerTroop() };
  const abilities = { player: meta.abilityChoice, enemy: botAbility() };
  battle = createBattle(
    myDeck,
    foeDeck,
    { player: meta.cardLevels, enemy: foeLevels },
    meta.gameMode.elixirRate,
    towers,
    abilities,
  );
  const base = DIFFICULTIES[meta.difficulty];
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
  const streak = currentStreak();
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
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = isSandbox() ? "" : "none";
  replaySpeedBtn.style.display = "none";
  // Crazy mode scrambles card stats each match, so it can't replay.
  recording =
    isSandbox() || meta.gameMode.id === "crazy"
      ? null
      : {
          v: 2,
          playerDeck: [...myDeck],
          enemyDeck: [...foeDeck],
          playerLevels: { ...meta.cardLevels },
          enemyLevels: { ...foeLevels },
          elixirRate: meta.gameMode.elixirRate ?? 1,
          botSeed,
          botProfile: banded,
          opponent: baseName,
          towers,
          abilities,
          abilityUses: [],
          deploys: [],
        };
  if (!isSandbox()) {
    showVersus(championBotMatch ? `👑 ${baseName}` : baseName, {
      trophies: meta.profile.trophies,
      towerTroop: meta.towerTroop,
      ability: meta.abilityChoice,
    });
  }
  startCountdown(!isSandbox());
  maybeShowFirstBattleTips();
  announceMatchStart();
}

/** Rewatch the saved recording: same decks, same bot seed, same deploys. */
function startReplay(): void {
  const rep = storedReplay();
  if (!rep) return;
  battleKind = "ladder";
  activeChallenge = null;
  clearOnline();
  setCardOverrides(null);
  battle = createBattle(
    rep.playerDeck,
    rep.enemyDeck,
    { player: rep.playerLevels, enemy: rep.enemyLevels },
    rep.elixirRate,
    rep.towers ?? { player: "princess", enemy: "princess" },
    rep.abilities ?? {},
  );
  replayAbilityUses = rep.abilityUses ?? [];
  abilityCursor = 0;
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
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
  window.setTimeout(
    () => showBanner(tr("REPLAY — ⏩ to speed up", "إعادة — ⏩ للتسريع")),
    2600,
  );
  announceMatchStart();
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
    [5000, tr("Tap a card, then tap your half to deploy!", "اضغط بطاقة ثم اضغط نصفك لتنشرها!")],
    [10000, tr("Destroy their towers — protect your own!", "دمّر أبراجهم واحمِ أبراجك!")],
    [15000, tr("Full elixir wastes away — keep spending!", "الإكسير الممتلئ يُهدر — واصل الإنفاق!")],
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
  clearOnline();
  setCardOverrides(null);
  // Level playing field: no card levels in special modes.
  battle = createBattle(mine, theirs, {}, 1, { player: meta.towerTroop, enemy: botTowerTroop() }, { player: meta.abilityChoice, enemy: botAbility() });
  recording = null;
  replaying = false;
  replaySpeedBtn.style.display = "none";
  bot = createBot(Date.now() & 0xffff, DIFFICULTIES[meta.difficulty]);
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName(opponentName);
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = "none";
  closeDeckPicker();
  startCountdown();
  announceMatchStart();
}

function startChallenge(ch: Challenge): void {
  activeChallenge = ch;
  waveCursor = { next: 0 };
  startSpecialBattle("challenge", ch.deck, ch.deck, tr(ch.name, ch.nameAr));
}

function startDaily(): void {
  activeChallenge = null;
  const deckOfDay = dailyDeck(dateKey(new Date()));
  startSpecialBattle("daily", deckOfDay, deckOfDay, "Daily Bot");
}

/** Instant sandbox restart — no countdown between experiments. */
function sandboxReset(): void {
  restart();
  setPhase("playing");
  showBanner("Reset!", true);
}
sandboxResetBtn.addEventListener("click", () => {
  sandboxReset();
  sandboxResetBtn.blur();
});

/** Tell the hooks a solo match (ladder, special or replay) just started. */
function announceMatchStart(): void {
  emit("matchStart", { kind: battleKind, battle, mySide: localSide(), online: false, replay: replaying });
}

// ---- Screens (src/ui/screens/*) -----------------------------------------

const pickerRoot = document.getElementById("deckpicker")!;

/** Show the (already built) picker as screen `id`. */
function showPicker(id: string): void {
  pickerRoot.classList.add("show");
  topbar.style.display = "none";
  sandboxResetBtn.style.display = "none";
  // The home shell is a cut-out onto the live arena; every other screen is opaque.
  const diorama = pickerRoot.querySelector(":scope > .home-shell") !== null;
  emit("screen", { id, sceneMode: diorama ? "diorama" : "none" });
}

function openHome(): void {
  buildHome(ctx);
  showPicker("home");
}

/** Restore the in-battle HUD bar when leaving the deck picker. */
function closeDeckPicker(): void {
  pickerRoot.classList.remove("show");
  topbar.style.display = "";
  emit("screen", { id: "battle", sceneMode: "battle" });
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
  onAbility: triggerAbility,
});

// Audio can only start from a user gesture.
window.addEventListener("pointerdown", () => audio.resume(), { once: false });

const ctx: AppCtx = {
  startLadder,
  startDaily,
  startDraft: (mine, bot) => {
    draftDecks = { mine, bot };
    startSpecialBattle("draft", mine, bot, "Draft Bot");
  },
  startChallenge,
  startReplay,
  openHome,
  openDeckPicker: (opts) => openDeckPicker(ctx, opts),
  openCollection: () => openCollection(ctx),
  openChests: () => openChests(ctx),
  openChallenges: () => openChallenges(ctx),
  openDraft: () => openDraft(ctx),
  openStudio: () => openStudio(ctx),
  openLobby: (opts) => openFriendLobby(ctx, meta.playerDeck.slice(), opts),
  scene,
  sound: audio,
  hud,
  tr,
  meta,
  persistProfile,
  variant,
  pickerRoot,
  stage,
  showPicker,
  closeDeckPicker,
  battleArenaId,
  botDeck: () => botDeck(),
  hasReplay: () => !!storedReplay(),
  setBattle: (b) => {
    battle = b;
  },
  selectCard,
  hideSandboxReset: () => {
    sandboxResetBtn.style.display = "none";
  },
};

// Home / deck buttons in the top bar.
const homeBtn = document.createElement("button");
homeBtn.className = "mute";
homeBtn.innerHTML = icon("home");
homeBtn.title = tr("Home", "الرئيسية");
homeBtn.addEventListener("click", openHome);
topbar.appendChild(homeBtn);

const deckBtn = document.createElement("button");
deckBtn.className = "mute";
deckBtn.innerHTML = icon("cards");
deckBtn.title = tr("Edit deck", "تعديل المجموعة");
deckBtn.addEventListener("click", () => ctx.openDeckPicker({ mode: "deck" }));

// CR-style battle chrome: sound, home and deck live behind one menu
// button instead of a second toolbar row eating the arena.
const battleMenu = document.createElement("div");
battleMenu.className = "battle-menu";
const menuToggle = document.createElement("button");
menuToggle.className = "menu-toggle";
menuToggle.setAttribute("aria-label", "Menu");
menuToggle.setAttribute("aria-expanded", "false");
menuToggle.innerHTML = "<span></span><span></span><span></span>";
const menuPanel = document.createElement("div");
menuPanel.className = "menu-panel";
const hudMute = topbar.querySelector("button.mute");
if (hudMute) menuPanel.appendChild(hudMute);
menuPanel.append(homeBtn, deckBtn);
battleMenu.append(menuToggle, menuPanel);
topbar.appendChild(battleMenu);
const setMenuOpen = (open: boolean): void => {
  battleMenu.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
};
menuToggle.addEventListener("click", (ev) => {
  ev.stopPropagation();
  setMenuOpen(!battleMenu.classList.contains("open"));
});
menuPanel.addEventListener("click", () => setMenuOpen(false));
window.addEventListener("pointerdown", (ev) => {
  if (!battleMenu.contains(ev.target as Node)) setMenuOpen(false);
});

const clockEl = topbar.querySelector<HTMLElement>(".clock");
if (clockEl) clockEl.dataset.label = tr("Time left", "الوقت المتبقي");

// The top bar floats over the arena; tell the camera how much it covers.
new ResizeObserver(() => scene.setTopInset(topbar.offsetHeight)).observe(topbar);

openHome();

// Trophy + currency live on the home screen now; the chip is kept (not
// mounted) so refreshMetaChips() stays a cheap no-op in battle.
const trophyChip = document.createElement("div");
trophyChip.className = "crowns player meta-chip";

function refreshMetaChips(): void {
  trophyChip.innerHTML =
    `🏆 <span>${meta.profile.trophies}</span>` +
    ` · 🪙 <span>${meta.profile.gold}</span>` +
    ` · 💎 <span>${meta.profile.gems}</span>`;
}
refreshMetaChips();

// ---- Emotes ------------------------------------------------------------

// One chat bubble (CR): tap to open the tray, pick an emote, it closes.
const EMOTES = ["😂", "😭", "👍", "😡"];
const emoteToggle = document.createElement("button");
emoteToggle.className = "emote-toggle";
emoteToggle.setAttribute("aria-label", "Emotes");
emoteToggle.setAttribute("aria-expanded", "false");
emoteToggle.innerHTML = '<span class="bubble-dots"><i></i><i></i><i></i></span>';
const emoteTray = document.createElement("div");
emoteTray.className = "emote-tray";
const setEmotesOpen = (open: boolean): void => {
  emoteBar.classList.toggle("open", open);
  emoteToggle.setAttribute("aria-expanded", String(open));
};
emoteToggle.addEventListener("click", (ev) => {
  ev.stopPropagation();
  setEmotesOpen(!emoteBar.classList.contains("open"));
});
for (const emoji of EMOTES) {
  const btn = document.createElement("button");
  btn.textContent = emoji;
  btn.addEventListener("click", () => {
    scene.showEmote(localSide(), emoji);
    audio.emotePop();
    setEmotesOpen(false);
    emit("input", { kind: "emote" });
  });
  emoteTray.appendChild(btn);
}
emoteBar.append(emoteTray, emoteToggle);
window.addEventListener("pointerdown", (ev) => {
  if (!emoteBar.contains(ev.target as Node)) setEmotesOpen(false);
});

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


/** The played card flies from its hand slot to the drop point and shrinks. */
function flyCardToField(cardId: CardId, clientX: number, clientY: number): void {
  if (reduceMotion()) return;
  const btn = document.querySelector<HTMLElement>(`#hud button.card[data-card="${cardId}"]`);
  const art = btn?.querySelector("canvas");
  if (!btn || !art) return;
  const r = btn.getBoundingClientRect();
  const fly = document.createElement("div");
  fly.className = "card-fly";
  fly.style.left = `${r.left}px`;
  fly.style.top = `${r.top}px`;
  fly.style.width = `${r.width}px`;
  fly.style.height = `${r.height}px`;
  fly.style.backgroundImage = `url(${(art as HTMLCanvasElement).toDataURL()})`;
  document.body.appendChild(fly);
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  fly
    .animate(
      [
        { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 30}px) scale(0.7) rotate(-8deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.25) rotate(0deg)`, opacity: 0 },
      ],
      { duration: 320, easing: "cubic-bezier(.4,.1,.6,1)" },
    )
    .finished.finally(() => fly.remove());
}

/** A fallen tower's crown arcs up to the scoreboard of whoever earned it. */
function flyCrown(ax: number, ay: number, towerSide: Side): void {
  if (reduceMotion()) return;
  const earner = towerSide === localSide() ? "enemy" : "player";
  const target = topbar.querySelector<HTMLElement>(`.crowns.${earner} .crown-count`);
  if (!target) return;
  const from = scene.arenaToClient(ax, ay, 3);
  const t = target.getBoundingClientRect();
  const crown = document.createElement("div");
  crown.className = "crown-fly";
  crown.innerHTML = icon("crown");
  crown.style.left = `${from.x - 24}px`;
  crown.style.top = `${from.y - 24}px`;
  document.body.appendChild(crown);
  const dx = t.left + t.width / 2 - from.x;
  const dy = t.top + t.height / 2 - from.y;
  crown
    .animate(
      [
        { transform: "translate(0,0) scale(0.4)", opacity: 0 },
        { transform: "translate(0,-40px) scale(1.6)", opacity: 1, offset: 0.25 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(1.2)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.9 },
      ],
      { duration: 900, easing: "cubic-bezier(.3,.1,.4,1)" },
    )
    .finished.finally(() => crown.remove());
}

function tryDeployAt(clientX: number, clientY: number): void {
  if (battle.result || !selectedCard) return;
  const pos = scene.pick(clientX, clientY);
  if (!pos) return;
  const side = localSide();
  const verdict = checkDeploy(battle, side, selectedCard, pos.x, pos.y);
  if (verdict === "ok") {
    const online = onlineSession();
    if (online) {
      // Lockstep: schedule the deploy; both peers apply it at the same tick.
      online.ls.queue({ side, cardId: selectedCard, x: pos.x, y: pos.y });
      emit("input", { kind: "deploy", cardId: selectedCard });
      flyCardToField(selectedCard, clientX, clientY);
      scene.deployFlash(pos.x, pos.y);
      selectCard(null);
      clearPreview();
      return;
    }
    if (deployCard(battle, side, selectedCard, pos.x, pos.y)) {
      // Replay tape: remember the card and the exact tick it went down.
      if (recording && mode() === "solo") {
        recording.deploys.push({ t: soloTick, c: selectedCard, x: pos.x, y: pos.y });
      }
      emit("input", { kind: "deploy", cardId: selectedCard });
      flyCardToField(selectedCard, clientX, clientY);
      scene.deployFlash(pos.x, pos.y);
      selectCard(null);
      clearPreview();
      return;
    }
  }
  // Tell the player why the play was refused.
  if (verdict === "no-elixir" || verdict === "bad-spot") {
    emit("input", { kind: "invalid", cardId: selectedCard });
  }
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
  if (ev.key === "q" || ev.key === "Q") triggerAbility();
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

/** scene-split gives Battle3D.sync an optional alpha; until it lands this keeps the call compiling. */
type SyncWithAlpha = { sync(state: BattleState, dt: number, alpha?: number): void };

/** Settle a finished match (rewards, quests, streaks), then tell the hooks. */
function finishMatch(winner: Side | "draw"): void {
  const online = onlineSession() !== null;
  const mySide = localSide();
  const settled = settleMatch(ctx, {
    winner,
    kind: battleKind,
    online,
    sandbox: isSandbox(),
    replaying,
    championBotMatch,
    activeChallenge,
    battle,
    mySide,
    cardsPlayed: battleCardsPlayed,
  });
  if (settled.recorded) battleCardsPlayed = 0;
  if (settled.ladder) botEmote(winner === "enemy" ? "🎉" : "😭");
  const mine = mySide === "player" ? battle.player : battle.enemy;
  const theirs = mySide === "player" ? battle.enemy : battle.player;
  emit("matchEnd", {
    // Friendlies have no BattleKind of their own; they count as ladder-style 1v1s.
    kind: online ? "ladder" : battleKind,
    winner,
    mySide,
    myCrowns: mine.crowns,
    theirCrowns: theirs.crowns,
    trophyDelta: settled.trophyDelta,
    online,
    battle,
    replay: replaying,
    sandbox: !online && isSandbox(),
  });
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  // Hit-stop drains on wall-clock time. Solo matches freeze presentation +
  // sim accrual for juice; online lockstep never stalls the sim clock.
  scene.hitStop.update(dt);
  const frozen = scene.hitStop.active && mode() === "solo";
  const presentDt = scene.hitStop.active ? Math.min(dt, 0.008) : dt;

  // The world holds its breath while the deck picker is open.
  if (pickerRoot.classList.contains("show")) {
    scene.sync(battle, 0); // towers etc. exist for the home diorama
    if (shouldRender(now)) scene.render(dt);
    emit("frame", { dt, presentDt, alpha: 1, phase: getPhase(), battle });
    requestAnimationFrame(frame);
    return;
  }

  const online = onlineSession();
  let alpha = 1;
  if (!online && simHeld()) {
    // A feature (pause menu, tutorial…) holds the solo sim, countdown included.
  } else if (getPhase() === "countdown") {
    tickCountdown(dt, audio);
  } else if (!frozen) {
    if (online) {
      alpha = stepOnline(dt);
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
          while (abilityCursor < replayAbilityUses.length && replayAbilityUses[abilityCursor] === soloTick) {
            abilityCursor++;
            useAbility(battle, "player");
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
  if (!online) alpha = Math.min(1, Math.max(0, acc / SIM_DT));
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
    emit("battleEvent", { ev, mySide: localSide() });
    if ((ev.type === "deploy" || ev.type === "spell") && ev.side === localSide()) {
      battleCardsPlayed++;
    }
    if (ev.type === "finish" && recording && mode() === "solo" && battleKind === "ladder" && !isSandbox()) {
      try {
        localStorage.setItem(REPLAY_KEY, JSON.stringify(recording));
      } catch {
        // tape too big / storage unavailable — skip silently
      }
      recording = null;
    }
    if (ev.type === "death" && (ev.kind === "princess-tower" || ev.kind === "king-tower")) {
      flashImpact();
      flyCrown(ev.x, ev.y, ev.side);
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
    if (ev.type === "crown" && mode() === "solo") botEmote(ev.winner === "enemy" ? "😂" : "😭");
    if (ev.type === "finish") finishMatch(ev.winner);
  }
  checkBanners(battle, audio);
  // Music tension follows the match: double elixir, then overtime.
  if (!battle.result) {
    audio.setIntensity(battle.overtime ? 2 : isDoubleElixir(battle) ? 1 : 0);
  }
  const scaledDt = presentDt * presentTimeScale();
  (scene as unknown as SyncWithAlpha).sync(battle, scaledDt, alpha);
  if (shouldRender(now)) scene.render(scaledDt);
  hud.update(battle, localSide());
  emit("frame", { dt, presentDt, alpha, phase: getPhase(), battle });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev-only hook for the lockstep determinism test (stripped from prod builds).
if (import.meta.env.DEV) {
  (window as unknown as { __cr: unknown }).__cr = {
    sum: () => stateChecksum(battle),
    tick: () => onlineSession()?.tick ?? 0,
    mode: () => mode(),
    entities: () => battle.entities.length,
    battle: () => battle,
    scene: () => scene,
    spawn: (side: "player" | "enemy", id: CardId, x: number, y: number) =>
      spawnUnits(battle, side, id, x, y).length,
    arenas: () => ARENAS.map((a) => a.id),
    phase: () => getPhase(),
  };
}

