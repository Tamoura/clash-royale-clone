// First: page-wide error listeners feed the local problem log before any
// other module runs (src/app/errorTraps.ts; nothing leaves the device).
import "./app/errorTraps";
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

import { browserOfflineDeps, startOfflineSupport } from "./app/offline";
import { showNoWebgl } from "./app/noWebgl";

// Offline play (src/app/offline.ts): the service worker registers in
// production builds only (in dev it would cache Vite's module graph and
// fight hot reload). Once per device, a note says the game is ready offline,
// on a menu screen (never over a battle's cards). It runs before the boot
// shows its first screen, so the note's gate sees every screen.
startOfflineSupport({
  ...browserOfflineDeps(import.meta.env.BASE_URL, () =>
    toast(tr("Ready to play offline!", "اللعبة جاهزة للعب بلا إنترنت!"), "success", 4000),
  ),
  ...(import.meta.env.PROD ? {} : { container: null }),
});
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
import { BOT_PROFILE_DEFAULTS, createBot, tickBot, type BotProfile, type BotState } from "./game/bot";
import {
  DEFAULT_DECK,
  crazyCards,
  getCard,
  setCardOverrides,
  type CardId,
} from "./game/cards";
import { ARENA_WIDTH, type Side } from "./game/arena";
import { isDoubleElixir, tick } from "./game/sim";
import { Hud } from "./render3d/hud";
import { Battle3D, setTowerFlair, type CanvasRect } from "./render3d/scene3d";
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
import { loadTowerTroop, type TowerTroopId } from "./game/towers";
import {
  ABILITIES,
  loadAbility,
  useAbility,
  type AbilityId,
} from "./game/abilities";
import { applyWaves, challengeStatus, type Challenge } from "./game/challenges";
import { dailyDeck, dateKey } from "./game/daily";
import { checkSeason, loadAchievements, loadSeason, saveSeason, seasonKey } from "./meta/achievements";
import { SEASON_TOAST_MS, seasonStartText } from "./ui/seasonBanner";
import { toast } from "./ui/components";
import { EMOTES, EMOTE_PICKER, botReaction, emoteGlyph, type BotMoment } from "./ui/emotes";
import { seasonName } from "./ui/screens/pass";
import { loadQuests } from "./meta/quests";
import { registerRewards } from "./meta/rewardsWire";
import { registerNewCards } from "./ui/newCards";
import type { AppCtx, MetaState } from "./app/ctx";
import { registerLifecycle } from "./app/lifecycle";
import {
  emit,
  on,
  presentTimeScale,
  registerSimHold,
  shouldRender,
  simHeld,
  type BattleKind,
} from "./app/hooks";
import { beginCastBattle, castReady } from "./render3d/cast/index";
import {
  avgDeckLevel,
  botLevels,
  installAutoDifficulty,
  ensureAutoState,
  ladderProfile,
  loadAutoState,
  loadDifficulty,
  resolveTier,
  tierProfile,
  type Tier,
} from "./match/difficulty";
import { loadMode } from "./match/modes";
import {
  clearOnline,
  forfeitOnline,
  handleJoinLink,
  leaveOnline,
  onlineOpponentLabel,
  onlineSession,
  restartOnline,
  sendOnlineEmote,
  setOnlineEmotes,
  stepOnline,
} from "./match/online";
import { CHAMPION_BONUS_GOLD, currentStreak, settleMatch } from "./match/rewards";
import {
  botTrophies,
  checkBanners,
  getPhase,
  reduceMotion,
  setPhase,
  showBanner,
  showVersus,
  startCountdown,
  tickCountdown,
} from "./ui/banner";
import { fmtNum, tr } from "./ui/i18n";
import { installLayout } from "./ui/layoutWire";
import { getPrefs, onPrefs, reducedMotion } from "./ui/prefs";
import { isChestReady } from "./meta/chests";
import { trophyLossAt } from "./meta/economy";
import { openChallenges } from "./ui/screens/challenges";
import { openChests } from "./ui/screens/chests";
import { openCollection } from "./ui/screens/collection";
import { openDeckPicker } from "./ui/screens/deckPicker";
import { openDraft } from "./ui/screens/draft";
import { buildHome } from "./ui/screens/home";
import { openFriendLobby } from "./ui/screens/lobby";
import { openStudio } from "./ui/screens/studio";
import { startTutorial, tutorialDone } from "./ui/tutorialOverlay";
import {
  MATCH_CLOCK,
  badSpotReason,
  badSpotText,
  challengeClock,
  laneLabelText,
  lanePillBox,
  placeVerdict,
  previewBox,
  type ScreenRect,
} from "./render3d/hudModel";
import { applyMotionAttr } from "./ui/motionAttr";
import { pickBotLoadout, type BotLoadout } from "./match/botLoadout";
import {
  browserLiveMatchGuard,
  clearMatchMarker,
  markMatchStart,
  marksLeftMatch,
  takeLeftMatchUnlessLive,
} from "./match/leftMatch";
import { applyMatchResult } from "./match/rewards";
import { defaultKV } from "./meta/kv";
import { reachedArenaIndex } from "./meta/unlocks";
import { registerHomeSlot } from "./app/slots";
import { localizeStaticMarkup } from "./app/brand";
import { battleMenuOpen } from "./ui/battleMenu";
import { signed } from "./render3d/result";
import { installCrashShield } from "./app/shieldWire";
import { MatchSettler, playBattleEvents, type EventStep } from "./match/battleEvents";
import { problemLog } from "./app/problemLog";
import { QUALITY_LEVELS, currentQuality } from "./render3d/quality";

// ---- Feature registration: side-effect modules that subscribe to src/app/hooks.
import "./audio/wire";
import "./ui/keepSafeWire";

// Apply edition-aware CSS variables before any DOM is rendered.
applyEditionTokens(STORED_EDITION);
// The tab title, splash and boot labels in the edition's language (Crown Rush).
localizeStaticMarkup(document);
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
  v: 3;
  playerDeck: CardId[];
  enemyDeck: CardId[];
  playerLevels: CardLevels;
  enemyLevels: CardLevels;
  elixirRate: number;
  botSeed: number;
  botProfile: BotProfile;
  opponent: string;
  /** The bot archetype (optional: older tapes carry only the localized name). */
  opponentId?: ArchetypeId;
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
    if (rep && rep.v === 3) return rep;
    localStorage.removeItem(REPLAY_KEY);
  } catch {
    /* storage blocked */
  }
  return null;
}
// Purge a stale tape at boot, so any plain `getItem(REPLAY_KEY)` presence
// check (e.g. the home screen's Last Battle entry) stays truthful.
storedReplay();
// ---- Bot loadout: tower troop + King's Ability --------------------------
// Fair play: the bot only uses what the player could pick at their arena
// (match/botLoadout.ts), so a new kid meets Princess towers and Royal Rally.
function botLoadout(): BotLoadout {
  const best = Math.max(meta.achievements.counters.bestTrophies, meta.season.best);
  return pickBotLoadout(reachedArenaIndex(meta.profile.trophies, best));
}

/** Fire the local King's Ability (button / "Q"); replays are watch-only. */
function triggerAbility(): void {
  if (replaying || battle.result || getPhase() === "countdown") return;
  // Online, the ability rides the next lockstep frame so both peers fire it on the same tick.
  const online = onlineSession();
  if (online ? !online.queueAbility() : !useAbility(battle, localSide())) {
    // Not charged yet: shake KING and say how long (never the elixir bar).
    hud.flashError("ability");
    audio.error();
    return;
  }
  if (recording && mode() === "solo") recording.abilityUses.push(soloTick);
  showBanner(tr(ABILITIES[meta.abilityChoice].name, ABILITIES[meta.abilityChoice].ar));
  emit("input", { kind: "ability" });
}

/** Held while this tab plays a ladder match, so another tab never settles it as left. */
const liveMatch = browserLiveMatchGuard();
let replaying = false;
let replaySpeed = 1;
let soloTick = 0;
let recording: ReplayData | null = null;
let replayDeploys: ReplayData["deploys"] = [];
let playbackCursor = 0;
let replayAbilityUses: number[] = [];
let abilityCursor = 0;

const sandboxResetBtn = document.createElement("button");
sandboxResetBtn.className = "sandbox-reset";
sandboxResetBtn.textContent = tr("↺ Reset", "↺ إعادة");
sandboxResetBtn.setAttribute("aria-label", tr("Reset the sandbox battle", "أعد معركة ساحة التجربة من البداية"));
sandboxResetBtn.style.display = "none";
stage.appendChild(sandboxResetBtn);

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
  meta.profile = { ...meta.profile, trophies: seasonRoll.trophies };
  saveProfile(localStorage, meta.profile);
}
if (seasonRoll.rolled) {
  // A celebration, never a loss: the reset keeps the arena they reached.
  // A toast once the UI exists (boot runs before the stage is built); the
  // battle banner would sit behind Home's panels. It stays up long enough
  // for a young reader (SEASON_TOAST_MS), not the usual 2.4 s.
  const line = seasonStartText(seasonName(seasonRoll.state.key), seasonRoll.trophies, tr);
  window.setTimeout(() => toast(line, "success", SEASON_TOAST_MS), 1200);
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

/** The tier the next bot plays at (the "auto" option follows your results). */
function currentTier(): Tier {
  return resolveTier(meta.difficulty, loadAutoState(meta.profile.trophies));
}

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
  enemy: botLevels(avgDeckLevel(meta.playerDeck, meta.cardLevels), currentTier()),
});
let bot: BotState = createBot(Date.now() & 0xffff, tierProfile(currentTier()));
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
  scene.recoverFromContextLoss(() => battleArenaId()); // a lost GPU context rebuilds, never blanks
  // `?sky=0..1` pins the living sky for previews/screenshots.
  const sky = new URLSearchParams(location.search).get("sky");
  if (sky !== null && !Number.isNaN(Number(sky))) {
    scene.forceDayPhase(Math.max(0, Math.min(1, Number(sky))));
  }
} catch {
  // No 3D in this browser: a friendly card for the kid with a hint for a
  // grown-up, in the edition's language (src/app/noWebgl.ts). It takes the
  // boot splash down; the throw stops the boot here.
  showNoWebgl(document);
  throw new Error("WebGL unavailable");
}
// Battles fill the screen (tall or wide, see ui/layout.ts); menus keep the column.
const layout = installLayout(scene, topbar);
const audio = new SoundEngine();

/**
 * The canvas's page rect. Inside frame()'s preview-and-label step it is read
 * once and shared, so the conversions after the pip's style writes never
 * force another layout; anywhere else each call reads it fresh.
 */
let frameCanvasRect: CanvasRect | null = null;
let sharingCanvasRect = false;
function canvasRect(): CanvasRect {
  if (!sharingCanvasRect) return scene.canvasRect();
  return (frameCanvasRect ??= scene.canvasRect());
}

/** The field's tiles 0..18 x 0..32 on screen (page px; either viewpoint). */
function fieldRect(rect: CanvasRect = canvasRect()): ScreenRect {
  const a = scene.arenaToClient(0, 0, 0, rect);
  const b = scene.arenaToClient(18, 32, 0, rect);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * Where the pointer last was over the page: kept on every move (even with no
 * card held), so a card picked with a key, a tower falling or elixir arriving
 * re-judges the spot under a resting finger or mouse every frame. Cleared
 * when a finger or pen lifts, the window loses focus, and after a refused drop.
 */
let lastPointer: { x: number; y: number; type: string } | null = null;

/** The held card's preview on screen (ghost, hover disc, aim ring), or null: the lane label steps off it. */
let previewOnScreen: ScreenRect | null = null;

/** An empty rect for a hidden pip (no allocation per frame). */
const NO_RECT: ScreenRect = { x: 0, y: 0, w: 0, h: 0 };

/** A preview error was reported (once per session: see safely()). */
let previewFailed = false;

/** The board's viewpoint differs from the side you play (dev aids only): warned once per battle. */
let viewWarned = false;

// Reduced motion for CSS too: <html data-reduce-motion> follows the in-game
// setting (and the OS while it is on "auto"), so stylesheet animations obey it.
applyMotionAttr(document.documentElement, reducedMotion());
onPrefs(() => applyMotionAttr(document.documentElement, reducedMotion()));
try {
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () =>
    applyMotionAttr(document.documentElement, reducedMotion()),
  );
} catch {
  // an old browser without media-query listeners: the setting still applies on change
}

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
  // Troops and buildings show where they may go (the Mirror as what it copies);
  // the placement map picks the lane map or the Digger's dig map from the card.
  const plays = id === null ? null : (effectiveCard(battle, localSide(), id)?.card ?? getCard(id));
  scene.setZoneVisible(plays !== null && plays.kind !== "spell", plays);
  // Nothing selected, nothing previewed: a ghost never outlives its card. A
  // card picked with a key previews at a resting mouse at once.
  if (id === null) clearPreview();
  else safely(refreshPreview);
}

// ---- Battle-start cast gate (render3d/cast) ------------------------------
// The modelled cast loads at boot. A battle fields it only if the pack is in
// when the battle begins: beginCastBattle() (called just before each
// scene.reset()) latches that answer for the WHOLE battle, so modelled and
// procedural troops never mix and nothing swaps mid-fight. A start that
// comes before the pack has settled waits up to CAST_WAIT_MS for it, with
// the solo sim held, then goes ahead with whatever is in (the procedural
// roster if the pack is still loading or failed).
const CAST_WAIT_MS = 3000;
let castSettled = false;
void castReady().then(() => {
  castSettled = true;
});
/** The start waiting on the pack (the latest request wins), or null. */
let castWaiting: (() => void) | null = null;
registerSimHold(() => castWaiting !== null);

/** Run a battle start now if the pack has settled, else after it settles or CAST_WAIT_MS. */
function afterCastGate(start: () => void): void {
  if (castSettled) {
    start();
    return;
  }
  const first = castWaiting === null;
  castWaiting = start;
  if (!first) return;
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, CAST_WAIT_MS));
  void Promise.race([castReady(), timeout]).then(() => {
    const go = castWaiting;
    castWaiting = null;
    go?.();
  });
}

// Online matches (match/online.ts) cannot wait on the pack (lockstep with the
// peer): they latch what is loaded when they begin. matchStart comes right
// after their scene.reset(), before the next sync builds any unit.
on("matchStart", (m) => {
  if (m.online) beginCastBattle();
});

/** Restart whatever we were just playing (ladder, draft, challenge, daily). */
function restart(): void {
  // Online: Rematch the same friend, or back to the lobby; never a bot match.
  if (onlineSession()) {
    restartOnline(ctx);
    return;
  }
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
  leaveOnline();
  battleKind = "ladder";
  activeChallenge = null;
  // Crazy mode rerolls a scrambled card set each match; other modes use stock.
  setCardOverrides(meta.gameMode.id === "crazy" ? crazyCards() : null);
  const archetype = pickArchetype();
  // Mirror mode: player and bot share one random deck for a pure-skill match.
  const shared = meta.gameMode.mirror ? botDeck() : null;
  const myDeck = shared ?? meta.playerDeck;
  const foeDeck = shared ?? botDeck(archetype);
  const tier = currentTier();
  const streak = currentStreak();
  championBotMatch = !isSandbox() && streak.wins >= 3;
  // Auto difficulty replaces the 3-loss mercy: it steps down on its own.
  const mercy = !isSandbox() && streak.losses >= 3 && meta.difficulty !== "auto";
  // The bot's cards sit at your deck's level (shifted by tier), so a
  // freshly unlocked card never meets a bot that outgrew it.
  const foeLevels = botLevels(avgDeckLevel(myDeck, meta.cardLevels), tier, championBotMatch ? 1 : 0);
  const foeLoadout = botLoadout();
  const towers = { player: meta.towerTroop, enemy: foeLoadout.towerTroop };
  const abilities = { player: meta.abilityChoice, enemy: foeLoadout.ability };
  battle = createBattle(
    myDeck,
    foeDeck,
    { player: meta.cardLevels, enemy: foeLevels },
    meta.gameMode.elixirRate,
    towers,
    abilities,
  );
  // Personality tweaks (match/difficulty.ts archetypeTweak): beatdown banks
  // bigger pushes, cycle plays faster, siege turtles behind buildings and
  // only commits when fully loaded. Practice to normal are calibrated as a
  // whole (ladder.test, keepsOwnPace), so they keep their own pace.
  const tuned: BotProfile = ladderProfile(tier, archetype);
  const banded: BotProfile = championBotMatch
    ? { ...tuned, thinkInterval: tuned.thinkInterval * 0.85, pushAt: Math.max(4, tuned.pushAt - 1) }
    : mercy
      ? { ...tuned, thinkInterval: tuned.thinkInterval * 1.35, pushAt: Math.min(10, tuned.pushAt + 1) }
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
            `بوت بطل يقترب — اهزمه مقابل +${fmtNum(CHAMPION_BONUS_GOLD)} 🪙!`,
          ),
        ),
      2600,
    );
  }
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  beginCastBattle(); // the whole battle fields the cast or the procedural roster (afterCastGate)
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  sandboxResetBtn.style.display = isSandbox() ? "" : "none";
  // Crazy mode scrambles card stats each match, so it can't replay.
  recording =
    isSandbox() || meta.gameMode.id === "crazy"
      ? null
      : {
          v: 3,
          playerDeck: [...myDeck],
          enemyDeck: [...foeDeck],
          playerLevels: { ...meta.cardLevels },
          enemyLevels: { ...foeLevels },
          elixirRate: meta.gameMode.elixirRate ?? 1,
          botSeed,
          botProfile: banded,
          opponent: baseName,
          opponentId: archetype,
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
  // Tapes from before the optional bot knobs carry only the first two.
  bot = createBot(rep.botSeed, { ...BOT_PROFILE_DEFAULTS, ...rep.botProfile });
  replaying = true;
  recording = null;
  soloTick = 0;
  playbackCursor = 0;
  replayDeploys = rep.deploys;
  replaySpeed = 1;
  sandboxResetBtn.style.display = "none";
  selectCard(null);
  hud.setReward(null);
  // The bot's name in today's edition (tapes from before opponentId keep theirs).
  const archetypeName = rep.opponentId ? ARCHETYPE_NAMES[rep.opponentId] : undefined;
  hud.setOpponentName(archetypeName ? tr(archetypeName[0], archetypeName[1]) : rep.opponent);
  hud.setReplayControl((speed) => {
    replaySpeed = speed;
  }, battle);
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  beginCastBattle(); // the whole battle fields the cast or the procedural roster (afterCastGate)
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  startCountdown();
  // Short enough to sit on the board between the landscape side panels; the
  // speeds are written as the pill writes them (Arabic-Indic in Golden Age).
  window.setTimeout(() => showBanner(tr("REPLAY: tap 2x or 4x", `إعادة: اضغط ${fmtNum(2)}x أو ${fmtNum(4)}x`)), 2600);
  announceMatchStart();
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
  const foeLoadout = botLoadout();
  battle = createBattle(
    mine,
    theirs,
    {},
    1,
    { player: meta.towerTroop, enemy: foeLoadout.towerTroop },
    { player: meta.abilityChoice, enemy: foeLoadout.ability },
  );
  recording = null;
  replaying = false;
  bot = createBot(Date.now() & 0xffff, tierProfile(currentTier()));
  selectCard(null);
  hud.setReward(null);
  hud.setOpponentName(opponentName);
  scene.setArenaLook(battleArenaId());
  scene.setViewpoint("player");
  beginCastBattle(); // the whole battle fields the cast or the procedural roster (afterCastGate)
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
  // The goal is the clock: "SURVIVE 0:45" and a goal card (the tutorial's
  // endless surviveFor keeps the normal clock).
  hud.setClockGoal(battle, challengeClock(ch.surviveFor));
}

function startDaily(): void {
  activeChallenge = null;
  const deckOfDay = dailyDeck(dateKey(new Date()));
  startSpecialBattle("daily", deckOfDay, deckOfDay, "Daily Bot");
}

/** Instant sandbox restart — no countdown between experiments. */
function sandboxReset(): void {
  afterCastGate(() => {
    restart();
    setPhase("playing");
    showBanner(tr("Reset!", "إعادة!"), true);
  });
}
sandboxResetBtn.addEventListener("click", () => {
  sandboxReset();
  sandboxResetBtn.blur();
});

/** Tell the hooks a solo match (ladder, special or replay) just started. */
function announceMatchStart(): void {
  if (!replaying) hud.setReplayControl(null, battle);
  if (battleKind !== "challenge") hud.setClockGoal(battle, MATCH_CLOCK);
  // A trophy match leaves a marker until it ends: a reload mid-battle is a loss.
  if (
    marksLeftMatch({
      kind: battleKind,
      online: onlineSession() !== null,
      replay: replaying,
      sandbox: isSandbox(),
      tutorial: activeChallenge?.id === "tutorial",
    })
  ) {
    markMatchStart(defaultKV(), Date.now(), meta.profile.trophies);
    liveMatch.hold(); // other tabs see it running (a reload or a closed tab lets go)
  }
  emit("matchStart", { kind: battleKind, battle, mySide: localSide(), online: false, replay: replaying });
}

// ---- Screens (src/ui/screens/*) -----------------------------------------

const pickerRoot = document.getElementById("deckpicker")!;

/** Show the (already built) picker as screen `id`. */
function showPicker(id: string): void {
  pickerRoot.classList.add("show");
  // Leaving a battle (Menu > Leave mid-reveal): no card stays held, and no
  // placement map, reveal, pip or "Drop troops here now!" label is left over
  // the menus (they sync with dt 0, so nothing would ever age out).
  selectCard(null);
  scene.leaveZone();
  hud.lanePill(null, "", false, -1, 0);
  topbar.style.display = "none";
  sandboxResetBtn.style.display = "none";
  // The home shell is a cut-out onto the live arena; every other screen is opaque.
  const diorama = pickerRoot.querySelector(":scope > .home-shell") !== null;
  layout.setBattle(false); // back to the menu column before the scene re-fits for it
  emit("screen", { id, sceneMode: diorama ? "diorama" : "none" });
}

function openHome(): void {
  leaveOnline();
  buildHome(ctx);
  showPicker("home");
}

/** Restore the in-battle HUD bar when leaving the deck picker. */
function closeDeckPicker(): void {
  pickerRoot.classList.remove("show");
  topbar.style.display = "";
  layout.setBattle(true);
  emit("screen", { id: "battle", sceneMode: "battle" });
}

const hud = new Hud(topbar, hudRoot, overlay, {
  onSelectCard: selectCard,
  onDeployAt: (x, y) => tryDeployAt(x, y),
  onRestart: () => afterCastGate(restart),
  onMuted: (muted) => audio.setMuted(muted),
  onElixirLeak: () => audio.elixirLeak(),
  onAbility: triggerAbility,
  onHome: openHome,
  onOpenChest: () => ctx.openChests(),
  chestReady: () => meta.profile.chests.some((c) => c !== null && isChestReady(c, Date.now())),
  isOnline: () => onlineSession() !== null,
  // Online opponents are labelled by the online module (hud.setCallbacks).
  opponentLabel: () =>
    onlineSession()
      ? onlineOpponentLabel()
      : {
          badge: fmtNum(Math.max(0, ARENAS.findIndex((a) => a.id === battleArenaId())) + 1),
          trophies: ladderMatch() ? botTrophies(meta.profile.trophies) : undefined,
        },
  onForfeit: forfeitMatch,
  playerTrophies: () => (ladderMatch() ? meta.profile.trophies : null),
  wallet: () => ({ gold: meta.profile.gold, trophies: meta.profile.trophies }),
  leaveCost: () =>
    replaying || (isSandbox() && !onlineSession())
      ? null
      : ladderMatch()
        ? trophyLossAt(meta.profile.trophies)
        : 0,
});
audio.setMuted(getPrefs().muted);

/** A real trophy match: solo ladder, not sandbox practice or a replay. */
function ladderMatch(): boolean {
  return battleKind === "ladder" && !onlineSession() && !replaying && !isSandbox();
}

/**
 * Forfeit from the battle menu: the match ends now as a loss. Solo matches
 * settle through the normal finish path (a ladder forfeit costs trophies);
 * online, by default, leaves the room and shows the loss with no trophies.
 */
function forfeitMatch(): void {
  if (battle.result) return;
  if (onlineSession()) {
    forfeitOnline();
    return;
  }
  const winner: Side = localSide() === "player" ? "enemy" : "player";
  const result = { winner, playerCrowns: battle.player.crowns, enemyCrowns: battle.enemy.crowns };
  recording = null; // a forfeited match is not worth a replay
  setPhase("playing");
  battle.result = result;
  battle.events.push({ type: "finish", winner });
}

// Audio can only be unlocked by a user gesture. resume() never starts music:
// the soundtrack follows the screens and the countdown (src/audio/wire.ts).
window.addEventListener("pointerdown", () => audio.resume(), { passive: true });

const ctx: AppCtx = {
  // Every battle start passes the cast gate (afterCastGate, above).
  startLadder: () => afterCastGate(startLadder),
  startDaily: () => afterCastGate(startDaily),
  startDraft: (mine, bot) =>
    afterCastGate(() => {
      draftDecks = { mine, bot };
      startSpecialBattle("draft", mine, bot, "Draft Bot");
    }),
  startChallenge: (ch) => afterCastGate(() => startChallenge(ch)),
  startReplay: () => afterCastGate(startReplay),
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
// Reward loop (chests, Trophy Road, Crown Pass): hooks and Home slots.
registerRewards(ctx);
registerNewCards(ctx);

registerLifecycle(scene); // idle rendering behind opaque screens, hidden-tab sim hold

// The battle menu (Resume, Sound, Forfeit) is the HUD's own top-bar button.

// Trophy + currency live on the home screen now; the chip is kept (not
// mounted) so refreshMetaChips() stays a cheap no-op in battle.
// Declared before the boot below: settling a left match persists the profile.
const trophyChip = document.createElement("div");
trophyChip.className = "crowns player meta-chip";

function refreshMetaChips(): void {
  trophyChip.innerHTML =
    `🏆 <span>${meta.profile.trophies}</span>` +
    ` · 🪙 <span>${meta.profile.gold}</span>` +
    ` · 💎 <span>${meta.profile.gems}</span>`;
}
refreshMetaChips();

// ---- Leaving early (match/leftMatch.ts) ------------------------------------
// A ladder match left by a reload or a closed tab settles as a loss on the
// next boot, through the same rules as any ladder loss (applyMatchResult).
// A marker whose match is still being played in another tab of the same
// profile is left alone (match/leftMatch.ts liveMatchGuard).
let leftNotice: { delta: number } | null = null;
on("matchStart", () => {
  leftNotice = null; // shown on Home until the next match, solo or online
});
let screenNow = "";
on("screen", (s) => {
  screenNow = s.id;
});

async function settleLeftMatch(): Promise<void> {
  const left = await takeLeftMatchUnlessLive(defaultKV(), Date.now(), liveMatch.live);
  if (!left) return;
  const delta = applyMatchResult(ctx, "enemy");
  hud.setReward(null); // the summary belongs to no result screen
  leftNotice = { delta };
  if (screenNow === "home") openHome(); // show the notice and the new trophy count
}

registerHomeSlot("battle-top", (host) => {
  if (!leftNotice) return;
  const note = document.createElement("div");
  note.className = "left-match-note";
  note.setAttribute("role", "status");
  note.innerHTML = icon("flag");
  const text = document.createElement("span");
  text.dir = "auto";
  text.textContent = tr(
    "You left your last battle, so it counted as a loss",
    "غادرت معركتك الأخيرة، لذلك حُسبت خسارة",
  );
  note.appendChild(text);
  if (leftNotice.delta !== 0) {
    const d = document.createElement("b");
    d.className = "left-match-delta";
    d.innerHTML = icon("trophy");
    d.appendChild(document.createTextNode(signed(leftNotice.delta)));
    note.appendChild(d);
  }
  host.appendChild(note);
});

function legacyPlayed(): boolean {
  try {
    return localStorage.getItem("cr-clone-tutored") === "1" || localStorage.getItem("cr-clone-difficulty") !== null;
  } catch {
    return false;
  }
}
// Pin the auto-difficulty record before the tutorial or a first match can
// grant trophies; saves from before this version (a legacy tutored flag or
// any trophies) keep their level.
ensureAutoState(meta.profile.trophies, legacyPlayed());
installAutoDifficulty(() => meta.profile.trophies);
// A first-time player (edition picked) learns in the guided battle first.
if (EDITION_CHOSEN && !tutorialDone()) {
  startTutorial(ctx); // the guided battle comes first, even for a ?join= link
} else {
  openHome();
  // Asks the other tabs first (a few ms with Web Locks), then Home redraws.
  void settleLeftMatch();
  handleJoinLink(ctx); // ?join=CODE invite links open the lobby and join
}

// ---- Emotes ------------------------------------------------------------

// One chat bubble (CR): tap to open the tray, pick an emote, it closes.
// Only friendly emotes (ui/emotes.ts); the wire table keeps old ids stable.
setOnlineEmotes(EMOTES);
const emoteToggle = document.createElement("button");
emoteToggle.className = "emote-toggle";
emoteToggle.setAttribute("aria-label", tr("Emotes", "التعابير"));
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
for (const pick of EMOTE_PICKER) {
  const emoji = EMOTES[pick.id];
  const btn = document.createElement("button");
  btn.textContent = emoji;
  btn.setAttribute("aria-label", tr(...pick.label));
  btn.addEventListener("click", () => {
    // Online emotes travel in the lockstep and pop on both screens together.
    if (!sendOnlineEmote(pick.id)) {
      scene.showEmote(localSide(), emoji);
      audio.emotePop();
    }
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

/**
 * The bot's chat bubble, only ever kind (ui/emotes.ts botReaction: no
 * laughing or gloating); `force` skips the cooldown (the post-match goodwill).
 */
function botEmote(moment: BotMoment, force = false): void {
  const glyph = emoteGlyph(botReaction(moment) ?? -1);
  if (!glyph || (botEmoteCooldown > 0 && !force)) return;
  botEmoteCooldown = 6;
  scene.showEmote("enemy", glyph);
  audio.emotePop();
}

function clearPreview(): void {
  previewOnScreen = null;
  scene.setHover(null, 0, false);
  scene.setGhost(null, null);
  scene.zoneCallBack(false);
  hud.placePip(null, 0, 0, "mouse", NO_RECT);
}

/**
 * The preview under the pointer, re-read from the sim: the hover disc and
 * ring, the ghost, the placement map's call-back and the verdict pip. The
 * disc judges the SPOT only (too little elixir is the hourglass, never red).
 */
function refreshPreview(): void {
  if (!selectedCard || !lastPointer || replaying || battle.result) {
    clearPreview();
    return;
  }
  // Preview what will actually happen: the Mirror aims and ghosts as the
  // card it would copy (blast radius, troop ghost), not as itself.
  const card =
    effectiveCard(battle, localSide(), selectedCard)?.card ?? getCard(selectedCard);
  const rect = canvasRect();
  const pos = scene.pick(lastPointer.x, lastPointer.y, rect);
  const check = pos === null ? null : checkDeploy(battle, localSide(), selectedCard, pos.x, pos.y);
  const placing = card.kind !== "spell";
  const badSpot = check === "bad-spot";
  const radius =
    card.kind === "spell"
      ? card.radius
      : card.kind === "building"
        ? Math.max(0.7, card.unit.radius)
        : 0.55;
  scene.setHover(pos, radius, card.kind === "spell", pos !== null && !badSpot, card.id);
  // Only troops have a see-through ghost; a building previews as its disc.
  scene.setGhost(card.kind === "troop" ? card.id : null, pos, badSpot);
  scene.zoneCallBack(placing && badSpot);
  // Spells go anywhere: their pip only ever says "wait".
  const verdict = placeVerdict(check);
  const pip = verdict && (placing || verdict === "wait") ? verdict : null;
  const field = pos || pip ? fieldRect(rect) : NO_RECT;
  previewOnScreen = pos ? previewBox(lastPointer.x, lastPointer.y, radius, card.kind === "troop", field) : null;
  hud.placePip(pip, lastPointer.x, lastPointer.y, lastPointer.type, pip ? field : NO_RECT);
}

/**
 * The preview and the lane label run every frame (and on presses and card
 * picks). The crash shield schedules the next frame whatever throws, but a
 * broken preview must still never stop the rest of the frame or a card from
 * being placed: a throw clears the preview, goes in the problem log, and is
 * printed once.
 */
function safely(work: () => void): void {
  try {
    work();
  } catch (err) {
    if (!previewFailed) {
      previewFailed = true;
      console.error("[placement] preview failed; the battle goes on without it", err);
    }
    problemLog.record("preview", err);
    try {
      clearPreview();
    } catch {
      // nothing more to undo
    }
  }
}

/** The "Drop troops here now!" label over a pocket that just opened (never in replays or the tutorial). */
function updateLanePill(): void {
  const c =
    !replaying && activeChallenge?.id !== "tutorial" && !battle.result && !scene.koZooming ? scene.laneCallout() : null;
  if (!c) {
    hud.lanePill(null, "", false, -1, 0);
    return;
  }
  const rect = canvasRect();
  const at = (x: number, y: number): { x: number; y: number } => scene.arenaToClient(x, y, 0, rect);
  const half = ARENA_WIDTH / 2;
  const x0 = c.lane === "left" ? 0 : half;
  const box = lanePillBox(at(c.ax, c.ay), at(x0, c.ay), at(x0 + half, c.ay), fieldRect(rect));
  // The pocket band the label may step along to keep off the held card's preview.
  const far = at(c.ax, c.far).y;
  const near = at(c.ax, c.near).y;
  const room = { top: Math.min(far, near), bottom: Math.max(far, near) };
  hud.lanePill(box, laneLabelText(), reduceMotion(), c.id, c.age, room, previewOnScreen);
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
      // Its card and elixir stay reserved until then (no double spends).
      const queued = online.queueDeploy(selectedCard, pos.x, pos.y);
      if (queued !== "ok") {
        if (queued === "no-elixir") {
          emit("input", { kind: "invalid", cardId: selectedCard });
          hud.flashError("elixir");
          audio.error();
        }
        return;
      }
      emit("input", { kind: "deploy", cardId: selectedCard });
      scene.dismissLaneCallout();
      flyCardToField(selectedCard, clientX, clientY);
      scene.deployFlash(pos.x, pos.y);
      selectCard(null);
      clearPreview();
      return;
    }
    if (deployCard(battle, side, selectedCard, pos.x, pos.y)) {
      scene.dismissLaneCallout();
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
    // The answer is on the field, not in the hand: say why at the finger,
    // flash the region the words mean, and drop the ghost there and then.
    audio.error();
    const why = badSpotReason(battle, side, selectedCard, pos.x, pos.y);
    if (why) {
      scene.badSpotPulse(pos.x, pos.y);
      hud.dropHint(badSpotText(why), clientX, clientY);
      scene.zoneRefuse(why, pos.x, pos.y);
    }
    clearPreview();
    lastPointer = null;
  }
}

// Tap-to-place: release on the field deploys the selected card. The press
// already shows the map, the ghost and the pip under the finger.
scene.renderer.domElement.addEventListener("pointerdown", (ev) => {
  lastPointer = { x: ev.clientX, y: ev.clientY, type: ev.pointerType || "mouse" };
  safely(refreshPreview);
});
scene.renderer.domElement.addEventListener("pointerup", (ev) => {
  tryDeployAt(ev.clientX, ev.clientY);
});
// A click listener (a no-op) makes the board a tap target to the browser's
// touch adjustment, which otherwise pulls a fingertip tap on the board next
// to the chat bubble or King onto that button (on phones the board spans
// the screen's width, so they float over its near corners).
scene.renderer.domElement.addEventListener("click", () => {});

// Track the pointer everywhere (window-level so a drag started on a hand
// card previews immediately); the frame loop re-judges it once per frame.
window.addEventListener("pointermove", (ev) => {
  lastPointer = { x: ev.clientX, y: ev.clientY, type: ev.pointerType || "mouse" };
});
// A lifted finger or pen leaves nothing under it (runs after the field's own pointerup).
for (const type of ["pointerup", "pointercancel"] as const) {
  window.addEventListener(type, (ev) => {
    if (ev.pointerType !== "mouse") lastPointer = null;
  });
}
window.addEventListener("blur", () => {
  lastPointer = null;
});
// A mouse that leaves the page leaves nothing behind either: no ghost, disc,
// pip or thickened outline parked at the field's edge until it comes back.
document.addEventListener("pointerout", (ev) => {
  if (ev.relatedTarget === null) lastPointer = null;
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
  // A dialog or sheet already took this key (Esc closes it): leave it be.
  if (ev.defaultPrevented) return;
  // Dev only: "T" switches the edition (Arabic ⇄ normal) and reloads. Never
  // in a real build: it threw away the match a kid was playing.
  if (import.meta.env.DEV && (ev.key === "t" || ev.key === "T")) {
    if (!EDITION_CHOSEN) return;
    const cur = localStorage.getItem(ARENA_THEME_KEY) === "normal" ? "normal" : "arabic";
    localStorage.setItem(ARENA_THEME_KEY, cur === "arabic" ? "normal" : "arabic");
    location.reload();
    return;
  }
  // Battle keys only work with the battle on screen (not behind a menu).
  if (pickerRoot.classList.contains("show")) return;
  if (ev.key === "Escape") {
    // Esc drops the card in hand first; with nothing in hand it opens the menu.
    if (selectedCard) selectCard(null);
    else if (!battle.result) hud.toggleMenu();
    return;
  }
  if (battleMenuOpen()) return;
  const n = Number(ev.key);
  if (n >= 1 && n <= 4) selectCard(mySideState().hand.cards[n - 1]);
  if (ev.key === "q" || ev.key === "Q") triggerAbility();
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

/** Settle a finished match (rewards, quests, streaks), then tell the hooks. */
function finishMatch(winner: Side | "draw"): void {
  clearMatchMarker(defaultKV()); // it ended on screen: nothing left to settle
  liveMatch.release();
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
  // Manners: a thumbs-up when you win, a friendly wave otherwise; never gloating.
  if (settled.ladder) {
    // An emote that fails must not keep the matchEnd hook (the result screen, rewards) from running.
    guardStep("the end emote", () =>
      botEmote({ type: "end", kidWon: winner === "player" ? true : winner === "enemy" ? false : null }, true),
    );
  }
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

/**
 * What each battle event does on this device, step by step. The frame runs
 * every step on its own (match/battleEvents.ts), so one that throws never
 * stops the others, the next event, or the settle (finishMatch, once).
 */
const battleEventSteps: readonly EventStep[] = [
  (ev) => audio.onEvent(ev),
  (ev) => scene.onEvent(ev),
  (ev) => emit("battleEvent", { ev, mySide: localSide() }),
  (ev) => {
    if ((ev.type === "deploy" || ev.type === "spell") && ev.side === localSide()) {
      battleCardsPlayed++;
    }
  },
  (ev) => {
    if (ev.type === "finish" && recording && mode() === "solo" && battleKind === "ladder" && !isSandbox()) {
      try {
        localStorage.setItem(REPLAY_KEY, JSON.stringify(recording));
      } catch {
        // tape too big / storage unavailable — skip silently
      }
      recording = null;
    }
  },
  (ev) => {
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
  },
  (ev) => {
    // The bot says wow when you take its tower, and never laughs when it takes yours.
    // The tower that ends the match gets only the end emote (finishMatch).
    if (ev.type === "crown" && mode() === "solo") {
      botEmote({ type: "crown", byKid: ev.winner === "player", matchOver: battle.result !== null });
    }
  },
];

/** Every battle settles exactly once (its "finish", or the frame's safety net). */
const settler = new MatchSettler(finishMatch);

// ---- Crash shield (src/app/shieldWire.ts): never a frozen battle ----------
// Every frame runs through the shield, which schedules the next one whatever
// throws; a glitch storm holds the battle behind a friendly "Oops!" overlay.
const crash = installCrashShield({
  kv: defaultKV(),
  onMenu: () => pickerRoot.classList.contains("show"),
  online: onlineSession,
  battleOver: () => battle.result !== null,
  leaveOnline,
  releaseLiveMatch: () => liveMatch.release(),
  dismissHud: () => hud.dismiss(),
  openHome,
  abandonBattle: () => settler.noContest(battle),
  context: () => ({
    screen: screenNow === "battle" ? `battle/${getPhase()}` : screenNow || "boot",
    quality: `${getPrefs().quality} L${QUALITY_LEVELS.indexOf(currentQuality())}`,
    edition: STORED_EDITION === "arabic" ? "golden-age" : STORED_EDITION === "normal" ? "classic" : "unset",
    online: onlineSession() !== null,
  }),
});

function frame(now: number): void {
  crash.shield.runFrame(() => frameBody(now), () => requestAnimationFrame(frame));
}

/** Run one part of the frame that must not stop the rest of it (the shield's guard). */
function guardStep(where: string, work: () => void): void {
  crash.shield.guard(where, work);
}

/** One frame of the game (frame() schedules the next one, whatever happens here). */
function frameBody(now: number): void {
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
    return;
  }

  const online = onlineSession();
  // ?oops=1 (a grown-up's test): the next battle throws here a few times.
  crash.oops.tick(getPhase() === "playing" && !battle.result && (online !== null || !simHeld()), dt);
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
    viewWarned = false;
  }
  // Each step of each event runs on its own, and the match always settles
  // (match/battleEvents.ts): one glitch in an effect never costs a result.
  playBattleEvents(battle, battleEventSteps, settler, guardStep);
  checkBanners(battle, audio);
  // Music tension follows the match: double elixir, then overtime.
  if (!battle.result) {
    audio.setIntensity(battle.overtime ? 2 : isDoubleElixir(battle) ? 1 : 0);
  }
  const scaledDt = presentDt * presentTimeScale();
  scene.sync(battle, scaledDt, alpha);
  // The spot under a resting pointer is re-judged every frame (a tower falls,
  // elixir arrives), and the "lane opened" label follows the board. Both
  // share one read of the canvas rect (the pip's style writes come between).
  sharingCanvasRect = true;
  frameCanvasRect = null;
  if (selectedCard) safely(refreshPreview);
  safely(updateLanePill);
  sharingCanvasRect = false;
  frameCanvasRect = null;
  if (import.meta.env.DEV && !viewWarned && scene.viewpoint !== localSide()) {
    viewWarned = true;
    console.warn(`[placement] the board is drawn for '${scene.viewpoint}' but you play '${localSide()}' (dev viewpoint aid or staged view)`);
  }
  if (shouldRender(now)) scene.render(scaledDt);
  hud.update(battle, localSide());
  emit("frame", { dt, presentDt, alpha, phase: getPhase(), battle });
}

requestAnimationFrame(frame);
requestAnimationFrame(() => document.body.classList.add("booted")); // boot splash off after the first frame

// Dev-only hook for the lockstep determinism test (stripped from prod builds).
if (import.meta.env.DEV) {
  (window as unknown as { __cr: unknown }).__cr = {
    sum: () => stateChecksum(battle),
    tick: () => onlineSession()?.tick ?? 0,
    net: () => {
      const s = onlineSession();
      return s && { view: s.view(), side: s.side, rtt: s.rtt, agreed: s.agreedSyncs, reserved: s.reserved() };
    },
    mode: () => mode(),
    entities: () => battle.entities.length,
    battle: () => battle,
    scene: () => scene,
    spawn: (side: "player" | "enemy", id: CardId, x: number, y: number) =>
      spawnUnits(battle, side, id, x, y).length,
    arenas: () => ARENAS.map((a) => a.id),
    phase: () => getPhase(),
    layout: () => ({ mode: document.documentElement.dataset.layout ?? null, framing: scene.framing }),
    /** The field's tiles 0..18 x 0..32 on screen (page px; either viewpoint). */
    fieldRect: () => fieldRect(),
    /** The sim's verdict for the local player dropping `cardId` at (x, y). */
    check: (cardId: CardId, x: number, y: number) => checkDeploy(battle, localSide(), cardId, x, y),
  };
}

