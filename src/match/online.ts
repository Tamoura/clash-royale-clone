/**
 * Online 1v1: the glue between an OnlineSession (src/net/session.ts) and
 * the app. It owns the one live session, starts each match (and rematch)
 * on screen, routes abilities and emotes through the lockstep, relays page
 * visibility as pause, and closes the socket on every exit.
 *
 * main.ts asks it four things: onlineSession() (is a networked match on?),
 * stepOnline(dt) from the loop, leaveOnline() on every exit and
 * restartOnline() for the result screen's button.
 */
import type { Side } from "../game/arena";
import type { CardId } from "../game/cards";
import { DEFAULT_DECK } from "../game/cards";
import type { Loadout, MatchMode } from "../net/protocol";
import { resolveRelayUrl, type RelayTarget } from "../net/relayUrl";
import { OnlineSession, type MatchInfo } from "../net/session";
import type { AppCtx } from "../app/ctx";
import { emit, on, setPendingSpend } from "../app/hooks";
import { showBanner, showVersus, startCountdown } from "../ui/banner";
import { getPrefs, sanitizePlayerName } from "../ui/prefs";
import { tr } from "../ui/i18n";
import { OnlineOverlay } from "../ui/onlineOverlay";
import { GAME_MODES, type GameMode } from "./modes";

/** Key of the friendly-win counter (online wins, never trophies). */
export const FRIENDLY_WINS_KEY = "cr-clone-friendly-wins";

let session: OnlineSession | null = null;
let overlay: OnlineOverlay | null = null;
let emoteGlyphs: readonly string[] = [];
const listeners = new Set<(s: OnlineSession) => void>();

// ---- Relay -----------------------------------------------------------------

let relay: RelayTarget | null = null;

/** Where the relay lives (resolved once per page load), url null = not set up. */
export function relayTarget(): RelayTarget {
  if (!relay) {
    let store: Storage | undefined;
    try {
      store = localStorage;
    } catch {
      store = undefined;
    }
    relay = resolveRelayUrl(location, import.meta.env, store);
  }
  return relay;
}

/**
 * The relay to name in invite links: only one the player chose by hand
 * (?relay=), so a friend opening the link reaches the same server. The
 * build's own relay and the implied LAN relay need no parameter.
 */
export function inviteRelayParam(): string | null {
  const t = relayTarget();
  if (!t.url || t.lan) return null;
  const env = import.meta.env.VITE_RELAY_URL?.trim();
  if (env && t.url.replace(/^ws:/, "wss:") === env.replace(/^ws:/, "wss:")) return null;
  return t.url;
}

// ---- Loadout and decks -------------------------------------------------------

/** Who I am online: Profile name and crest, saved tower troop and ability. */
export function myLoadout(ctx: AppCtx): Loadout {
  const p = getPrefs();
  return {
    name: sanitizePlayerName(p.playerName),
    crest: p.crest,
    tower: ctx.meta.towerTroop,
    ability: ctx.meta.abilityChoice,
  };
}

/**
 * The deck sent online. The Studio champion is each player's own design,
 * so the relay refuses it; it is swapped for the first stock card the deck
 * lacks. Returns the swap so the lobby can explain it.
 */
export function onlineDeck(deck: readonly CardId[]): { deck: CardId[]; swappedFor: CardId | null } {
  if (!deck.includes("champion")) return { deck: [...deck], swappedFor: null };
  const sub = DEFAULT_DECK.find((id) => !deck.includes(id)) ?? "knight";
  return { deck: deck.map((id) => (id === "champion" ? sub : id)), swappedFor: sub };
}

/** The modes offered online (the relay accepts elixir rates 1, 3 and 7). */
export const ONLINE_MODE_IDS = ["classic", "triple", "mega", "crazy"] as const;
export type OnlineModeId = (typeof ONLINE_MODE_IDS)[number];

export function onlineMode(id: OnlineModeId): { game: GameMode; match: MatchMode } {
  const game = GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
  return { game, match: { elixirRate: game.elixirRate, mirror: false, crazy: id === "crazy" } };
}

/** Sandbox is a solo practice space; friend matches fall back to Classic. */
export function netGameMode(gameMode: GameMode): GameMode {
  return gameMode.id === "sandbox" ? GAME_MODES[0] : gameMode;
}

// ---- Session lifecycle ---------------------------------------------------------

/**
 * A fresh session for the lobby (any previous one is left first), or null
 * when this site has no relay. No socket opens until the lobby dials.
 */
export function newOnlineSession(ctx: AppCtx): OnlineSession | null {
  leaveOnline();
  const url = relayTarget().url;
  if (!url) return null;
  const s = new OnlineSession({ url, loadout: myLoadout(ctx) });
  s.onChange = (x) => {
    for (const fn of [...listeners]) fn(x);
  };
  s.onMatch = (m) => beginOnlineMatch(ctx, m);
  s.onEmote = (side, e) => showOnlineEmote(ctx, side, e);
  session = s;
  ensureOverlay(ctx).attach(s);
  return s;
}

/** Subscribe to every change of the live session. */
export function onOnlineChange(fn: (s: OnlineSession) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The session while a networked match is on screen (or just finished), else null. */
export function onlineSession(): OnlineSession | null {
  return session?.inMatch ? session : null;
}

/** Leave the room (if any) and forget the session. Every exit calls this. */
export function leaveOnline(): void {
  const s = session;
  if (!s) return;
  session = null;
  s.onMatch = null;
  s.onEmote = null;
  s.leave();
  s.onChange = null;
  overlay?.detach();
}

/** Kept for the solo start paths: starting solo leaves any room. */
export const clearOnline = leaveOnline;

/** Who we are playing: the opponent's name, or "Friend". */
export function onlineOpponentLabel(): string | null {
  const s = onlineSession();
  if (!s) return null;
  return s.opponent?.name || tr("Friend", "صديق");
}

/**
 * Show a match (or rematch) the session just built: same staging as a
 * solo start, but the viewpoint follows our side and both loadouts come
 * from the relay. The lobby may hold this briefly to show "opponent found".
 */
export function beginOnlineMatch(ctx: AppCtx, m: MatchInfo): void {
  if (!session) return;
  const { hud, scene, sound: audio, meta } = ctx;
  const label = onlineOpponentLabel() ?? tr("Friend", "صديق");
  ctx.hideSandboxReset();
  ctx.closeDeckPicker();
  ctx.setBattle(m.battle);
  ctx.selectCard(null);
  hud.setReward(null);
  hud.setOpponentName(label);
  scene.setArenaLook(ctx.battleArenaId());
  scene.setViewpoint(m.side);
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();
  showVersus(escapeHtml(label), {
    trophies: meta.profile.trophies,
    towerTroop: m.me?.tower ?? meta.towerTroop,
    ability: m.me?.ability ?? meta.abilityChoice,
  });
  startCountdown(true);
  if (m.round > 1) window.setTimeout(() => showBanner(tr("Rematch!", "مباراة إعادة!")), 1700);
  emit("matchStart", { kind: "ladder", battle: m.battle, mySide: m.side, online: true, replay: false });
}

/**
 * Advance the lockstep by wall-clock dt. Returns the interpolation alpha:
 * the leftover fraction of a tick, or 1 while waiting on the peer.
 */
export function stepOnline(dt: number): number {
  return session?.inMatch ? session.step(dt) : 1;
}

/**
 * The result screen's Play again / Rematch. Never falls back to a bot:
 * a rematch when the friend is still here, otherwise the lobby.
 */
export function restartOnline(ctx: AppCtx): void {
  const s = session;
  if (s?.canRematch()) {
    s.rematch();
    return;
  }
  leaveOnline();
  ctx.openLobby();
}

/** Give up the running match (battle menu Forfeit): a loss, and the room closes. */
export function forfeitOnline(): void {
  session?.forfeit();
}

/** Queue the King's ability online. False when it can't fire yet. */
export function queueOnlineAbility(): boolean {
  return onlineSession()?.queueAbility() ?? false;
}

// ---- Emotes ------------------------------------------------------------------

/** The emote glyphs (index = wire id). main.ts owns the list. */
export function setOnlineEmotes(glyphs: readonly string[]): void {
  emoteGlyphs = glyphs;
}

/**
 * Send emote `index` through the lockstep (it shows when it lands, on both
 * screens). Returns false when not online, so the caller shows it locally.
 * Online, extra taps inside the 2 s throttle are dropped quietly.
 */
export function sendOnlineEmote(index: number): boolean {
  const s = onlineSession();
  if (!s) return false;
  if (index >= 0) s.queueEmote(index);
  return true;
}

function showOnlineEmote(ctx: AppCtx, side: Side, e: number): void {
  const glyph = emoteGlyphs[e];
  if (!glyph) return;
  ctx.scene.showEmote(side, glyph);
  ctx.sound.emotePop();
}

// ---- Invite links --------------------------------------------------------------

/** A room code as typed or linked: upper-case letters, digits and '-'. */
export function cleanCode(raw: string | null | undefined): string | null {
  const c = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9-]{3,12}$/.test(c) ? c : null;
}

/** The link a friend opens to join `code` (carries a hand-picked relay too). */
export function inviteLink(code: string): string {
  const url = new URL(`${location.origin}${import.meta.env.BASE_URL}`);
  url.searchParams.set("join", code);
  const r = inviteRelayParam();
  if (r) url.searchParams.set("relay", r);
  return url.toString();
}

/**
 * Bootstrap: a ?join=CODE link opens the lobby with the code and joins.
 * The parameter is removed from the address bar so a reload doesn't rejoin.
 * Waits for the edition pick on a first visit (that screen reloads the page).
 */
export function handleJoinLink(ctx: AppCtx): void {
  const params = new URLSearchParams(location.search);
  if (!params.has("join") || !ctx.variant) return;
  const code = cleanCode(params.get("join"));
  params.delete("join");
  const qs = params.toString();
  try {
    history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  } catch {
    // replaceState can throw in sandboxed frames; joining still works
  }
  if (code) ctx.openLobby({ code });
}

// ---- Shared wiring (once per page) ----------------------------------------------

function ensureOverlay(ctx: AppCtx): OnlineOverlay {
  overlay ??= new OnlineOverlay({
    onHome: () => {
      leaveOnline();
      ctx.openHome();
    },
    onLobby: () => {
      leaveOnline();
      ctx.openLobby();
    },
    onLeave: () => {
      leaveOnline();
      ctx.openHome();
    },
    onOpponentLeft: () => showBanner(tr("Your friend left — you win!", "غادر صديقك — لقد فزت!")),
  });
  return overlay;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Queued (not yet executed) deploys keep their elixir reserved, so the HUD
// and the deploy check never offer elixir that is already promised.
setPendingSpend(() => onlineSession()?.reserved() ?? 0);

// A hidden page can't step its sim: tell the friend we paused.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => session?.setPaused(document.hidden));
  window.addEventListener("pagehide", (e) => {
    // The tab is closing (not just cached): leave now so the friend isn't
    // left watching a 20 s reconnect countdown that can't succeed.
    if (!e.persisted) leaveOnline();
  });
}

// Friendlies never move trophies, but wins are counted for the profile.
on("matchEnd", (p) => {
  if (!p.online || p.winner !== p.mySide) return;
  try {
    const n = Number(localStorage.getItem(FRIENDLY_WINS_KEY)) || 0;
    localStorage.setItem(FRIENDLY_WINS_KEY, String(n + 1));
  } catch {
    // storage unavailable
  }
});
