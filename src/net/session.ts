/**
 * OnlineSession: one player's whole online experience, from dialling the
 * relay to the last frame of a rematch. It wraps a RoomClient (the socket)
 * and a Lockstep (the tick scheduler) and drives the shared simulation.
 *
 * It owns no DOM: the lobby, the overlay and main.ts read {@link view} and
 * subscribe to the callbacks, and tests drive it with fake sockets.
 *
 * What it adds over the raw transport:
 * - pending spend: a queued deploy reserves its card and elixir until the
 *   lockstep executes it, so rapid taps can never overspend;
 * - stall tracking: 25 s without the peer's input ends the match;
 * - resume: a socket that dies mid-match is redialled with backoff and the
 *   seat reclaimed with its token; missed frames are replayed and the sim
 *   fast-forwards headless;
 * - drift checks: a checksum every second, a mismatch ends the match as
 *   "no contest" for both players;
 * - rematch, pause relaying and RTT.
 */
import { useAbility } from "../game/abilities";
import type { Side } from "../game/arena";
import { createBattle, deployCard, effectiveCard, type BattleState } from "../game/battle";
import { crazyCards, setCardOverrides, type CardId } from "../game/cards";
import { tick } from "../game/sim";
import { stateChecksum } from "./checksum";
import { Lockstep, type DeployCommand, type InputFrame } from "./lockstep";
import { sideForRole, type ErrorReason, type Loadout, type MatchMode, type Role } from "./protocol";
import { RoomClient, type NetSocket, type StartPayload } from "./roomClient";

export const SIM_DT = 1 / 30;
/** Ticks between drift checksums (one a second). */
export const SYNC_EVERY = 30;
/** Seconds without the peer's input before the match is called off. */
export const STALL_LIMIT_MS = 25_000;
/** Delays before each resume attempt after the socket drops mid-match. */
export const RESUME_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
/** Most ticks run in one step() while catching up after a resume. */
export const CATCH_UP_TICKS = 600;
/** One emote per this many milliseconds. */
export const EMOTE_GAP_MS = 2000;
/** The relay accepts at most this many deploys in one frame. */
const MAX_COMMANDS_PER_FRAME = 3;
/** Own frames kept for re-sending after a resume. */
const OWN_FRAME_HISTORY = 160;
/** A desync is announced, then the room is left after this long (ms). */
const DESYNC_LEAVE_MS = 3000;
/** Normal frames never bank more than this many ticks of wall time. */
const MAX_BACKLOG_TICKS = 3;

/** Why a match (or the attempt to start one) ended. */
export type EndReason =
  | "finished" // the battle reached its result
  | "opponent-left" // the peer left, dropped for good or stalled 25 s: you win
  | "desync" // checksums disagreed: no contest
  | "connection-lost" // our socket died and could not resume
  | "left" // we left on purpose
  | "forfeit" // we gave up: a loss
  | "server-restart"
  | "expired";

/** Lobby-stage failures: relay errors plus "unreachable" (socket never worked). */
export type FailReason = ErrorReason | "unreachable";

export type SessionView =
  | { t: "idle" }
  | { t: "connecting" }
  | { t: "waiting"; code: string }
  | { t: "queued"; position: number }
  | { t: "failed"; reason: FailReason }
  | { t: "playing" }
  | { t: "stalled"; ms: number }
  | { t: "peerDropped"; graceLeft: number }
  | { t: "peerPaused" }
  | { t: "reconnecting"; attempt: number }
  | { t: "rematchWait" }
  | { t: "ended"; reason: EndReason };

/** Everything the UI needs when a match (or a rematch) begins. */
export interface MatchInfo {
  battle: BattleState;
  side: Side;
  role: Role;
  mode: MatchMode;
  me: Loadout | null;
  opponent: Loadout | null;
  /** 1 for the first match with this opponent, 2 for the first rematch… */
  round: number;
}

export type DeployVerdict = "ok" | "pending" | "no-elixir" | "not-in-hand" | "busy" | "not-playing";

export interface SessionOpts {
  url: string;
  loadout: Loadout;
  /** Opens a socket to the relay (default: the browser WebSocket). */
  connect?: (url: string) => NetSocket;
  /** Millisecond clock (default performance.now). */
  now?: () => number;
}

interface Reservation {
  cardId: CardId;
  cost: number;
  /** Execution tick, once the frame carrying it has been produced. */
  tick: number | null;
}

/** Small seeded PRNG (mulberry32): identical sequences on every engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the canonical battle both peers simulate: host = player, guest =
 * enemy, no card levels, each side's tower troop and ability from its
 * loadout, and Crazy's scramble rolled from the relay's seed.
 */
export function buildOnlineBattle(start: StartPayload): BattleState {
  const mode = start.mode;
  setCardOverrides(mode.crazy ? crazyCards(mulberry32(mode.seed ?? 1)) : null);
  const enemyDeck = mode.mirror ? start.hostDeck : start.guestDeck;
  const host = start.hostLoadout;
  const guest = start.guestLoadout;
  return createBattle(
    start.hostDeck,
    enemyDeck,
    {},
    mode.elixirRate,
    { player: host?.tower, enemy: guest?.tower },
    { player: host?.ability ?? null, enemy: guest?.ability ?? null },
  );
}

const defaultConnect = (url: string): NetSocket => new WebSocket(url) as unknown as NetSocket;

export class OnlineSession {
  /** Any change worth redrawing (state, queue position, RTT…). */
  onChange: ((s: OnlineSession) => void) | null = null;
  /** A match or rematch is built; the UI should show it. */
  onMatch: ((m: MatchInfo) => void) | null = null;
  /** An emote lands on this tick (render only). */
  onEmote: ((side: Side, emote: number) => void) | null = null;

  private readonly url: string;
  private readonly loadout: Loadout;
  private readonly connect: (url: string) => NetSocket;
  private readonly now: () => number;

  private client: RoomClient | null = null;
  private phase: "idle" | "lobby" | "match" | "rematchWait" | "ended" | "failed" = "idle";
  private lobby: { t: "connecting" } | { t: "waiting"; code: string } | { t: "queued"; position: number } = {
    t: "connecting",
  };
  private failReason: FailReason = "unreachable";
  private endReason: EndReason = "finished";
  private leaving = false;

  // ---- Match state
  private ls: Lockstep | null = null;
  private start: StartPayload | null = null;
  private code: string | null = null;
  private token = "";
  private round = 0;
  private acc = 0;
  private stallMs = 0;
  private catchingUp = false;
  private lastPeerTick = -1;
  private ownFrames: InputFrame[] = [];
  private reservations: Reservation[] = [];
  private abilityTick: number | null | undefined = undefined; // undefined: none pending
  private queuedThisFrame = 0;
  private lastEmoteAt = -Infinity;
  private readonly mySums = new Map<number, number>();
  private readonly peerSums = new Map<number, number>();

  // ---- Peer and connection health
  private peerDroppedAt: number | null = null;
  private peerGraceSec = 0;
  private peerPaused = false;
  /** The peer is gone for good (left, or never coming back). */
  private peerGone = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private desyncTimer: ReturnType<typeof setTimeout> | null = null;

  battle: BattleState | null = null;
  side: Side = "player";

  constructor(opts: SessionOpts) {
    this.url = opts.url;
    this.loadout = opts.loadout;
    this.connect = opts.connect ?? defaultConnect;
    this.now = opts.now ?? (() => performance.now());
  }

  // ---- Lobby -------------------------------------------------------------

  /** Host a friend room; the code arrives as view {t:'waiting'}. */
  create(deck: CardId[], mode: MatchMode): void {
    this.dial().create(deck, mode, this.loadout);
  }

  /** Join a friend's room by code. */
  join(code: string, deck: CardId[]): void {
    this.code = code.trim().toUpperCase();
    this.dial().join(this.code, deck, this.loadout);
  }

  /** Enter the quick-match queue. */
  quick(deck: CardId[], mode: MatchMode): void {
    this.dial().quick(deck, this.loadout, mode);
  }

  /** Leave on purpose, from any state. Safe to call twice. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.clearTimers();
    if (this.phase !== "ended" && this.phase !== "failed") {
      this.phase = "ended";
      this.endReason = "left";
    }
    // `leave` also takes us out of the quick-match queue.
    const c = this.client;
    this.client = null;
    c?.leave();
    this.changed();
  }

  /** Give up the running match: the peer wins, we take the loss. */
  forfeit(): void {
    if (this.phase === "match" && this.battle && !this.battle.result) {
      this.declareWinner(this.side === "player" ? "enemy" : "player");
    }
    this.phase = "ended";
    this.endReason = "forfeit";
    this.leave();
  }

  /** Ask for a rematch after a finished match. False if that can't happen. */
  rematch(): boolean {
    if (!this.canRematch()) return false;
    this.phase = "rematchWait";
    this.client!.rematch();
    this.changed();
    return true;
  }

  /** A rematch is still possible: the match finished and both are here. */
  canRematch(): boolean {
    return (
      this.phase === "ended" && this.endReason === "finished" && !this.peerGone && !this.leaving && this.client !== null
    );
  }

  /** Tell the peer this page was hidden or shown again. */
  setPaused(paused: boolean): void {
    if (this.phase === "match") this.client?.pause(paused);
  }

  // ---- Reading ---------------------------------------------------------

  /** What the UI should show right now. */
  view(): SessionView {
    switch (this.phase) {
      case "idle":
        return { t: "idle" };
      case "lobby":
        return this.lobby;
      case "failed":
        return { t: "failed", reason: this.failReason };
      case "rematchWait":
        return { t: "rematchWait" };
      case "ended":
        return { t: "ended", reason: this.endReason };
      case "match":
        if (this.reconnectAttempt > 0) return { t: "reconnecting", attempt: this.reconnectAttempt };
        if (this.peerDroppedAt !== null) {
          const left = this.peerGraceSec - (this.now() - this.peerDroppedAt) / 1000;
          return { t: "peerDropped", graceLeft: Math.max(0, Math.ceil(left)) };
        }
        if (this.peerPaused) return { t: "peerPaused" };
        if (this.stallMs > 0) return { t: "stalled", ms: this.stallMs };
        return { t: "playing" };
    }
  }

  /** In a match, or past one that has not been left yet. */
  get inMatch(): boolean {
    return this.battle !== null && !this.leaving;
  }

  /** The next tick to simulate. */
  get tick(): number {
    return this.ls?.tick ?? 0;
  }

  /** Median round trip to the relay (ms), or null before the first pong. */
  get rtt(): number | null {
    return this.client?.rtt ?? null;
  }

  get opponent(): Loadout | null {
    if (!this.start) return null;
    return this.start.role === "host" ? this.start.guestLoadout : this.start.hostLoadout;
  }

  get matchMode(): MatchMode | null {
    return this.start?.mode ?? null;
  }

  /** Elixir promised to queued deploys that have not executed yet. */
  reserved(): number {
    let sum = 0;
    for (const r of this.reservations) sum += r.cost;
    return sum;
  }

  /** The card is queued and waiting for its tick. */
  isPending(cardId: CardId): boolean {
    return this.reservations.some((r) => r.cardId === cardId);
  }

  // ---- Input -----------------------------------------------------------

  /**
   * Schedule a local deploy. The card and its elixir stay reserved until the
   * lockstep executes it, so a second tap on the same card, or a card the
   * remaining (unreserved) elixir can't cover, is refused here.
   */
  queueDeploy(cardId: CardId, x: number, y: number): DeployVerdict {
    const battle = this.battle;
    if (!this.ls || !battle || this.phase !== "match" || battle.result) return "not-playing";
    const me = this.side === "player" ? battle.player : battle.enemy;
    if (!me.hand.cards.includes(cardId)) return "not-in-hand";
    if (this.isPending(cardId)) return "pending";
    if (this.queuedThisFrame >= MAX_COMMANDS_PER_FRAME) return "busy";
    const eff = effectiveCard(battle, this.side, cardId);
    if (!eff) return "not-in-hand";
    if (me.elixir.amount - this.reserved() < eff.cost) return "no-elixir";
    const cmd: DeployCommand = { side: this.side, cardId, x, y };
    this.ls.queue(cmd);
    this.queuedThisFrame++;
    this.reservations.push({ cardId, cost: eff.cost, tick: null });
    return "ok";
  }

  /** Fire the King's ability on the next frame. False if it isn't ready. */
  queueAbility(): boolean {
    const battle = this.battle;
    if (!this.ls || !battle || this.phase !== "match" || battle.result) return false;
    const me = this.side === "player" ? battle.player : battle.enemy;
    if (!me.ability || me.abilityCharge < 1 || this.abilityTick !== undefined) return false;
    this.ls.queueAbility();
    this.abilityTick = null;
    return true;
  }

  /** Send an emote (0..7), at most one every {@link EMOTE_GAP_MS}. */
  queueEmote(emote: number): boolean {
    if (!this.ls || this.phase !== "match") return false;
    const now = this.now();
    if (now - this.lastEmoteAt < EMOTE_GAP_MS) return false;
    this.lastEmoteAt = now;
    this.ls.queueEmote(emote);
    return true;
  }

  // ---- The tick driver -------------------------------------------------

  /**
   * Advance the lockstep by wall-clock dt (seconds). Returns the render
   * interpolation alpha: the leftover tick fraction, or 1 while stalled.
   */
  step(dt: number): number {
    const ls = this.ls;
    const battle = this.battle;
    this.queuedThisFrame = 0;
    if (!ls || !battle || this.phase !== "match") return 1;
    this.acc += dt;
    let ran = 0;
    const budget = this.catchingUp ? CATCH_UP_TICKS : Number.POSITIVE_INFINITY;
    while ((this.catchingUp || this.acc >= SIM_DT) && ran < budget && ls.ready()) {
      this.runTick(ls, battle);
      if (!this.catchingUp) this.acc -= SIM_DT;
      ran++;
      if (battle.result) {
        this.finish();
        return 1;
      }
    }
    const ready = ls.ready();
    if (!ready) this.catchingUp = false;
    if (ready || this.reconnectAttempt > 0) {
      this.stallMs = 0;
    } else {
      this.stallMs += dt * 1000;
      if (this.stallMs >= STALL_LIMIT_MS) {
        this.opponentLeft();
        return 1;
      }
    }
    // Never bank a backlog that bursts once the peer catches up.
    this.acc = Math.min(this.acc, SIM_DT * MAX_BACKLOG_TICKS);
    return ready ? Math.min(1, Math.max(0, this.acc / SIM_DT)) : 1;
  }

  private runTick(ls: Lockstep, battle: BattleState): void {
    const t = ls.tick;
    const { commands, outgoing } = ls.step();
    for (const c of commands) {
      try {
        deployCard(battle, c.side, c.cardId, c.x, c.y);
      } catch (err) {
        // Same input on both peers, so a throw here throws there too.
        console.error("[online] deploy failed", err);
      }
    }
    for (const s of ls.abilitiesAt(t)) useAbility(battle, s);
    for (const e of ls.emotesAt(t)) this.onEmote?.(e.side, e.emote);
    // Reservations executed this tick are spent now.
    this.reservations = this.reservations.filter((r) => r.tick === null || r.tick > t);
    if (this.abilityTick !== undefined && this.abilityTick !== null && this.abilityTick <= t) this.abilityTick = undefined;
    tick(battle, SIM_DT);

    // Whatever was queued since the last step rides on this outgoing frame.
    for (const r of this.reservations) if (r.tick === null) r.tick = outgoing.tick;
    if (this.abilityTick === null) this.abilityTick = outgoing.tick;
    this.sendOwn(outgoing);

    const done = t + 1;
    if (done % SYNC_EVERY === 0) {
      const sum = stateChecksum(battle);
      this.mySums.set(done, sum);
      this.client?.sendSync(done, sum);
      this.compareSums(done);
    }
  }

  // ---- Connection ------------------------------------------------------

  private dial(): RoomClient {
    this.phase = "lobby";
    this.lobby = { t: "connecting" };
    this.leaving = false;
    const c = this.openClient();
    this.changed();
    return c;
  }

  private openClient(): RoomClient {
    const c = new RoomClient(this.connect(this.url), { now: this.now });
    this.client = c;
    const mine = (fn: () => void): void => {
      if (this.client === c) fn();
    };
    c.onCreated = (code, token) =>
      mine(() => {
        this.code = code;
        this.token = token;
        this.lobby = { t: "waiting", code };
        this.changed();
      });
    c.onQueued = (position) =>
      mine(() => {
        this.lobby = { t: "queued", position };
        this.changed();
      });
    c.onStart = (p) => mine(() => this.begin(p));
    c.onFrame = (f) => mine(() => this.receive(f));
    c.onSync = (tickNo, sum) =>
      mine(() => {
        this.peerSums.set(tickNo, sum);
        this.compareSums(tickNo);
      });
    c.onPeerDropped = (graceSec) =>
      mine(() => {
        this.peerDroppedAt = this.now();
        this.peerGraceSec = graceSec;
        this.changed();
      });
    c.onPeerBack = () =>
      mine(() => {
        this.peerDroppedAt = null;
        this.changed();
      });
    c.onPeerPaused = (paused) =>
      mine(() => {
        this.peerPaused = paused;
        this.changed();
      });
    c.onPeerLeft = () => mine(() => this.peerLeft());
    c.onRematchWait = () => mine(() => this.changed());
    c.onResumed = (frames, start) => mine(() => this.resumed(frames, start));
    c.onPong = () => mine(() => this.changed());
    c.onError = (reason) => mine(() => this.error(reason as ErrorReason));
    c.onClose = () => mine(() => this.closed());
    return c;
  }

  private begin(p: StartPayload): void {
    if (this.phase !== "lobby" && this.phase !== "rematchWait") return;
    this.start = p;
    this.token = p.token || this.token;
    this.code = p.code ?? this.code;
    this.side = sideForRole(p.role);
    this.round++;
    const battle = buildOnlineBattle(p);
    const ls = new Lockstep(this.side, p.delay);
    this.battle = battle;
    this.ls = ls;
    this.acc = 0;
    this.stallMs = 0;
    this.catchingUp = false;
    this.lastPeerTick = -1;
    this.ownFrames = [];
    this.reservations = [];
    this.abilityTick = undefined;
    this.mySums.clear();
    this.peerSums.clear();
    this.peerDroppedAt = null;
    this.peerPaused = false;
    this.phase = "match";
    // Opening frames unblock the first ticks before any deploy can land.
    for (const f of ls.bootstrap()) this.sendOwn(f);
    this.onMatch?.({
      battle,
      side: this.side,
      role: p.role,
      mode: p.mode,
      me: p.role === "host" ? p.hostLoadout : p.guestLoadout,
      opponent: this.opponent,
      round: this.round,
    });
    this.changed();
  }

  private receive(f: InputFrame): void {
    if (!this.ls || f.side === this.side) return;
    if (f.tick > this.lastPeerTick) this.lastPeerTick = f.tick;
    this.ls.receive(f);
  }

  private sendOwn(f: InputFrame): void {
    this.ownFrames.push(f);
    if (this.ownFrames.length > OWN_FRAME_HISTORY) this.ownFrames.shift();
    this.client?.sendFrame(f);
  }

  private closed(): void {
    this.client = null;
    if (this.leaving) return;
    switch (this.phase) {
      case "lobby":
        this.fail("unreachable");
        return;
      case "match":
        if (this.code && this.token) this.scheduleResume();
        else this.end("connection-lost");
        return;
      case "rematchWait":
        this.end("connection-lost");
        return;
      case "ended":
        this.peerGone = true; // no socket, no rematch
        this.changed();
        return;
      default:
        return;
    }
  }

  private scheduleResume(): void {
    if (this.reconnectAttempt >= RESUME_BACKOFF_MS.length) {
      this.reconnectAttempt = 0;
      this.end("connection-lost");
      return;
    }
    const delay = RESUME_BACKOFF_MS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.changed();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.leaving || this.phase !== "match" || !this.code) return;
      this.openClient().resume(this.code, this.token, this.lastPeerTick);
    }, delay);
  }

  private resumed(frames: InputFrame[], start: StartPayload): void {
    if (this.phase !== "match" || !this.ls || start.role !== this.start?.role) return;
    this.reconnectAttempt = 0;
    const haveTick = this.lastPeerTick;
    let ownLogged = -1;
    for (const f of frames) {
      if (f.side === this.side) ownLogged = Math.max(ownLogged, f.tick);
      else this.receive(f);
    }
    // Re-send our frames the relay never logged. With none of ours in the
    // replay, the relay has ours at least up to haveTick - delay (the peer
    // could not have produced its frames otherwise); it drops duplicates.
    const from = ownLogged >= 0 ? ownLogged : haveTick - (this.start?.delay ?? 4);
    for (const f of this.ownFrames) if (f.tick > from) this.client?.sendFrame(f);
    this.catchingUp = true;
    this.stallMs = 0;
    this.changed();
  }

  private peerLeft(): void {
    this.peerGone = true;
    if (this.phase === "match") {
      this.opponentLeft();
    } else if (this.phase === "rematchWait") {
      this.end("opponent-left");
      this.leaveQuietly();
    } else {
      this.changed();
    }
  }

  private error(reason: ErrorReason): void {
    if (this.phase === "lobby" || this.phase === "idle") {
      this.fail(reason);
    } else if (this.phase === "match" && this.reconnectAttempt > 0) {
      // resume-failed (or anything else while reclaiming the seat)
      this.end("connection-lost");
      this.leaveQuietly();
    } else if (reason === "server-restart" || reason === "expired") {
      if (this.phase === "match" || this.phase === "rematchWait") this.end(reason);
      else this.peerGone = true;
    }
  }

  // ---- Endings -----------------------------------------------------------

  private finish(): void {
    this.phase = "ended";
    this.endReason = "finished";
    this.reservations = [];
    this.changed();
  }

  /** The peer is gone mid-match: we win, and the room is closed. */
  private opponentLeft(): void {
    if (this.battle && !this.battle.result) this.declareWinner(this.side);
    this.end("opponent-left");
    this.peerGone = true;
    this.leaveQuietly();
  }

  private declareWinner(winner: Side): void {
    const battle = this.battle!;
    battle.result = { winner, playerCrowns: battle.player.crowns, enemyCrowns: battle.enemy.crowns };
    battle.events.push({ type: "finish", winner });
  }

  private compareSums(tickNo: number): void {
    const mine = this.mySums.get(tickNo);
    const theirs = this.peerSums.get(tickNo);
    if (mine === undefined || theirs === undefined) return;
    this.mySums.delete(tickNo);
    this.peerSums.delete(tickNo);
    // Drop stale entries so the maps stay small however long a match runs.
    for (const map of [this.mySums, this.peerSums]) {
      for (const k of map.keys()) if (k < tickNo - SYNC_EVERY * 20) map.delete(k);
    }
    if (mine === theirs || this.phase !== "match") return;
    this.end("desync");
    // Stay a moment so the peer sees our checksum and calls it too.
    this.desyncTimer = setTimeout(() => this.leaveQuietly(), DESYNC_LEAVE_MS);
  }

  private end(reason: EndReason): void {
    if (this.phase === "ended" && this.endReason !== "finished") return;
    this.clearReconnect();
    this.phase = "ended";
    this.endReason = reason;
    this.reservations = [];
    this.changed();
  }

  private fail(reason: FailReason): void {
    this.phase = "failed";
    this.failReason = reason;
    this.leaveQuietly();
    this.changed();
  }

  /** Close the socket without touching the reported state. */
  private leaveQuietly(): void {
    const c = this.client;
    this.client = null;
    this.clearReconnect();
    c?.leave();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  private clearTimers(): void {
    this.clearReconnect();
    if (this.desyncTimer !== null) clearTimeout(this.desyncTimer);
    this.desyncTimer = null;
  }

  private changed(): void {
    this.onChange?.(this);
  }
}
