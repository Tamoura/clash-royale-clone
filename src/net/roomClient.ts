import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import { PROTOCOL_VERSION, type ClientMsg, type ErrorReason, type Loadout, type MatchMode, type Role } from "./protocol";
import {
  MAX_RTT_MS,
  cleanErrorReason,
  cleanFrame,
  cleanGraceSec,
  cleanRoomCode,
  cleanStartMsg,
  cleanSync,
  cleanToken,
  playableCardIds,
} from "./validate";

/** Minimal subset of the browser WebSocket the client needs (mockable). */
export interface NetSocket {
  send(data: string): void;
  close(): void;
  /**
   * The browser's WebSocket state (0 connecting, 1 open, 2 closing, 3
   * closed). Sending on a closing socket logs "WebSocket is already in
   * CLOSING or CLOSED state", so nothing is sent unless it reads 1. Fakes
   * may leave it out; then the client trusts its own open/close events.
   */
  readonly readyState?: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface StartPayload {
  role: Role;
  hostDeck: CardId[];
  guestDeck: CardId[];
  mode: MatchMode;
  /** Loadouts, or null for a side whose client did not send one. */
  hostLoadout: Loadout | null;
  guestLoadout: Loadout | null;
  /** Input delay in ticks chosen by the relay; identical for both peers. */
  delay: number;
  /** This seat's resume token. Keep it private. */
  token: string;
  /** The room code (for resuming), or null from a relay that omits it (or sends no real code). */
  code: string | null;
}

export interface RoomClientOptions {
  /** Millisecond clock for RTT measurement (default performance.now). */
  now?: () => number;
  /** Give up if the socket has not opened by then (default 8s). */
  connectTimeoutMs?: number;
}

export const CONNECT_TIMEOUT_MS = 8000;
/** WebSocket.OPEN, spelled out so this module also runs where WebSocket is undefined. */
const WS_OPEN = 1;
/** Pings sent right after connecting, to seed the relay's RTT estimate. */
const BURST_PINGS = 5;
const BURST_GAP_MS = 250;
const PING_EVERY_MS = 5000;
/** Ping interval while a match runs: a silent socket shows within seconds. */
export const MATCH_PING_EVERY_MS = 2000;
const RTT_SAMPLES = 5;

/** A parsed relay message before its fields are checked. */
type RawMsg = Record<string, unknown> & { t: string };

function isMsg(v: unknown): v is RawMsg {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { t?: unknown }).t === "string";
}

/**
 * Browser-side wrapper over the relay connection. Buffers sends until the
 * socket is open, fans incoming server messages out to typed handlers, and
 * keeps the relay's RTT estimate fresh with periodic pings.
 *
 * Handshakes carry the protocol version `v` when the caller passes a loadout
 * (create, join) and always for a quick match. The relay answers a create or
 * join without `v` with `update-required`, so every current caller passes a
 * loadout; the v-less shape only survives for old tests and tools.
 */
export class RoomClient {
  onCreated: ((code: string, token: string) => void) | null = null;
  onStart: ((p: StartPayload) => void) | null = null;
  onFrame: ((frame: InputFrame) => void) | null = null;
  onSync: ((tick: number, checksum: number) => void) | null = null;
  onQueued: ((position: number) => void) | null = null;
  onPeerDropped: ((graceSec: number) => void) | null = null;
  onPeerBack: (() => void) | null = null;
  onPeerLeft: (() => void) | null = null;
  onPeerPaused: ((paused: boolean) => void) | null = null;
  onResumed: ((frames: InputFrame[], start: StartPayload) => void) | null = null;
  onRematchWait: (() => void) | null = null;
  /** The other player asked for a rematch (we have not, yet). */
  onPeerRematch: (() => void) | null = null;
  onPong: ((rtt: number) => void) | null = null;
  /** A refusal from the relay, or "bad-message" when the relay sent something broken (the socket then closes). */
  onError: ((reason: ErrorReason) => void) | null = null;
  /** Fired once: the socket closed, errored, or never opened in time. */
  onClose: (() => void) | null = null;

  private open = false;
  private closed = false;
  /** leave() was called: nothing more goes out, even before the close lands. */
  private left = false;
  private readonly backlog: ClientMsg[] = [];
  private readonly rtts: number[] = [];
  private readonly now: () => number;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimers: ReturnType<typeof setTimeout>[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingEvery = PING_EVERY_MS;
  private heardAt: number;
  /** Cards a deck or a frame from the relay may name (validate.ts playableCardIds). */
  private readonly cardIds = playableCardIds();

  constructor(
    private readonly socket: NetSocket,
    opts: RoomClientOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.heardAt = this.now();
    this.connectTimer = setTimeout(() => {
      if (this.open) return;
      try {
        this.socket.close();
      } catch {
        // already closing
      }
      this.finish();
    }, opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      if (this.closed || this.left) return;
      this.open = true;
      this.clearConnectTimer();
      const queued = this.backlog.splice(0);
      for (const msg of queued) this.send(msg);
      this.startPinging();
    };
    socket.onmessage = (ev) => {
      this.heardAt = this.now();
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // ignore malformed input
      }
      if (isMsg(msg)) this.handle(msg);
    };
    socket.onclose = () => this.finish();
    socket.onerror = () => this.finish();
  }

  /** Milliseconds since anything last arrived on this socket. */
  silence(): number {
    return this.now() - this.heardAt;
  }

  /** Treat the link as freshly heard from (after this page was frozen or hidden). */
  markHeard(): void {
    this.heardAt = this.now();
  }

  /** Ping faster, for the duration of a match (see {@link MATCH_PING_EVERY_MS}). */
  pingFast(): void {
    this.pingEvery = MATCH_PING_EVERY_MS;
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => this.ping(), this.pingEvery);
    }
  }

  /**
   * Abandon a socket that has gone silent without sending "leave" (the seat
   * must stay ours for a resume). A dead socket may never fire onclose, so
   * the close is reported here.
   */
  drop(): void {
    try {
      this.socket.close();
    } catch {
      // already closing
    }
    this.finish();
  }

  /** Median of the last few measured round trips (ms), or null before any. */
  get rtt(): number | null {
    if (this.rtts.length === 0) return null;
    const s = [...this.rtts].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  create(deck: CardId[], mode: MatchMode, loadout?: Loadout): void {
    this.send(loadout ? { t: "create", v: PROTOCOL_VERSION, deck, mode, loadout } : { t: "create", deck, mode });
  }

  join(code: string, deck: CardId[], loadout?: Loadout): void {
    const c = code.toUpperCase();
    this.send(loadout ? { t: "join", v: PROTOCOL_VERSION, code: c, deck, loadout } : { t: "join", code: c, deck });
  }

  /** Enter the quick-match queue for `mode`. */
  quick(deck: CardId[], loadout: Loadout, mode: MatchMode): void {
    this.send({ t: "quick", v: PROTOCOL_VERSION, deck, loadout, mode });
  }

  /** Leave the quick-match queue (or close a room nobody joined yet). */
  cancel(): void {
    this.send({ t: "cancel" });
  }

  sendFrame(frame: InputFrame): void {
    this.send({ t: "frame", frame });
  }

  sendSync(tick: number, checksum: number): void {
    this.send({ t: "sync", tick, checksum });
  }

  /** Send a ping now (also done automatically); the reply updates {@link rtt}. */
  ping(): void {
    if (!this.writable()) return;
    const rtt = this.rtts.length > 0 ? Math.round(this.rtts[this.rtts.length - 1]) : undefined;
    this.send(rtt === undefined ? { t: "ping", at: this.now() } : { t: "ping", at: this.now(), rtt });
  }

  rematch(): void {
    this.send({ t: "rematch" });
  }

  /** Re-claim a seat after a reconnect, asking for every frame after `haveTick`. */
  resume(code: string, token: string, haveTick: number): void {
    this.send({ t: "resume", code: code.toUpperCase(), token, haveTick });
  }

  pause(paused: boolean): void {
    this.send({ t: "pause", paused });
  }

  /**
   * Leave on purpose: the peer is told at once (no resume grace), then close.
   * Pings and the connect timer stop right away: a browser socket reports
   * its close a moment later, and a ping sent into that gap would hit a
   * closing socket. The close is still reported once, when it lands.
   */
  leave(): void {
    if (this.left) return;
    if (this.writable()) this.socket.send(JSON.stringify({ t: "leave" } satisfies ClientMsg));
    this.left = true;
    this.backlog.length = 0;
    this.stopTimers();
    try {
      this.socket.close();
    } catch {
      // already closing
    }
  }

  /** The socket is open and ours to write to (see {@link NetSocket.readyState}). */
  private writable(): boolean {
    if (!this.open || this.closed || this.left) return false;
    const state = this.socket.readyState;
    return state === undefined || state === WS_OPEN;
  }

  private send(msg: ClientMsg): void {
    if (this.closed || this.left) return;
    if (!this.open) {
      this.backlog.push(msg);
      return;
    }
    if (this.writable()) this.socket.send(JSON.stringify(msg));
  }

  private startPinging(): void {
    for (let i = 0; i < BURST_PINGS; i++) {
      this.pingTimers.push(setTimeout(() => this.ping(), i * BURST_GAP_MS));
    }
    this.pingInterval = setInterval(() => this.ping(), this.pingEvery);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** Stop the connect timer and every ping. */
  private stopTimers(): void {
    this.clearConnectTimer();
    for (const t of this.pingTimers) clearTimeout(t);
    this.pingTimers = [];
    if (this.pingInterval !== null) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  /** Stop timers and report the close exactly once. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.stopTimers();
    this.onClose?.();
  }

  /**
   * The relay sent something the battle cannot be built from (a broken
   * start or room code): report it as the relay's own "bad-message" refusal,
   * which the lobby already explains, and close the link.
   */
  private broken(): void {
    this.onError?.("bad-message");
    this.drop();
  }

  /**
   * One message from the relay. Nothing from it is trusted: every field is
   * checked (validate.ts) before a handler sees it. A broken start ends the
   * link; a bad frame, sync or pong is dropped, like unparsable text.
   */
  private handle(msg: RawMsg): void {
    switch (msg.t) {
      case "created": {
        const code = cleanRoomCode(msg.code);
        if (code === null) return this.broken();
        this.onCreated?.(code, cleanToken(msg.token));
        break;
      }
      case "start": {
        const start = cleanStartMsg(msg, this.cardIds);
        if (!start) return this.broken();
        this.onStart?.(start);
        break;
      }
      case "queued": {
        const position = msg.position;
        if (typeof position === "number" && Number.isInteger(position) && position >= 0) this.onQueued?.(position);
        break;
      }
      case "frame": {
        const frame = cleanFrame(msg.frame, this.cardIds);
        if (frame) this.onFrame?.(frame);
        break;
      }
      case "sync": {
        const sync = cleanSync(msg.tick, msg.checksum);
        if (sync) this.onSync?.(sync.tick, sync.checksum);
        break;
      }
      case "pong": {
        // `at` is our own clock reading, echoed back.
        if (typeof msg.at !== "number" || !Number.isFinite(msg.at)) break;
        const rtt = Math.max(0, this.now() - msg.at);
        if (rtt > MAX_RTT_MS) break;
        this.rtts.push(rtt);
        if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
        this.onPong?.(rtt);
        break;
      }
      case "peer-dropped":
        this.onPeerDropped?.(cleanGraceSec(msg.graceSec));
        break;
      case "peer-back":
        this.onPeerBack?.();
        break;
      case "peer-left":
        this.onPeerLeft?.();
        break;
      case "peer-paused":
        this.onPeerPaused?.(msg.paused === true);
        break;
      case "resumed": {
        const start = cleanStartMsg(msg.start, this.cardIds);
        if (!start || !Array.isArray(msg.frames)) return this.broken();
        const frames: InputFrame[] = [];
        for (const f of msg.frames) {
          const clean = cleanFrame(f, this.cardIds);
          if (clean) frames.push(clean);
        }
        this.onResumed?.(frames, start);
        break;
      }
      case "rematch-wait":
        this.onRematchWait?.();
        break;
      case "peer-rematch":
        this.onPeerRematch?.();
        break;
      case "error":
        this.onError?.(cleanErrorReason(msg.reason));
        break;
    }
  }
}
