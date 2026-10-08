import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type Loadout,
  type MatchMode,
  type Role,
  type ServerMsg,
  type StartMsg,
} from "./protocol";

/** Minimal subset of the browser WebSocket the client needs (mockable). */
export interface NetSocket {
  send(data: string): void;
  close(): void;
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
  /** The room code (for resuming), or null from a relay that omits it. */
  code: string | null;
}

export interface RoomClientOptions {
  /** Millisecond clock for RTT measurement (default performance.now). */
  now?: () => number;
  /** Give up if the socket has not opened by then (default 8s). */
  connectTimeoutMs?: number;
}

export const CONNECT_TIMEOUT_MS = 8000;
/** Pings sent right after connecting, to seed the relay's RTT estimate. */
const BURST_PINGS = 5;
const BURST_GAP_MS = 250;
const PING_EVERY_MS = 5000;
/** Ping interval while a match runs: a silent socket shows within seconds. */
export const MATCH_PING_EVERY_MS = 2000;
const RTT_SAMPLES = 5;

function toPayload(msg: StartMsg): StartPayload {
  return {
    role: msg.role,
    hostDeck: msg.hostDeck,
    guestDeck: msg.guestDeck,
    mode: msg.mode,
    hostLoadout: msg.hostLoadout ?? null,
    guestLoadout: msg.guestLoadout ?? null,
    delay: msg.delay ?? 4,
    token: msg.token ?? "",
    code: msg.code ?? null,
  };
}

/**
 * Browser-side wrapper over the relay connection. Buffers sends until the
 * socket is open, fans incoming server messages out to typed handlers, and
 * keeps the relay's RTT estimate fresh with periodic pings.
 *
 * Messages carry the protocol version `v` only when the caller passes v2 data
 * (a loadout, or a quick match); calls without one stay v1-shaped, so the
 * relay keeps treating that client as an old LAN client (word-only codes,
 * immediate peer-left on a drop).
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
  onPong: ((rtt: number) => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  /** Fired once: the socket closed, errored, or never opened in time. */
  onClose: (() => void) | null = null;

  private open = false;
  private closed = false;
  private readonly backlog: ClientMsg[] = [];
  private readonly rtts: number[] = [];
  private readonly now: () => number;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimers: ReturnType<typeof setTimeout>[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingEvery = PING_EVERY_MS;
  private heardAt: number;

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
      if (this.closed) return;
      this.open = true;
      this.clearConnectTimer();
      for (const msg of this.backlog) this.socket.send(JSON.stringify(msg));
      this.backlog.length = 0;
      this.startPinging();
    };
    socket.onmessage = (ev) => {
      this.heardAt = this.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data) as ServerMsg;
      } catch {
        return; // ignore malformed input
      }
      this.handle(msg);
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
    if (!this.open) return;
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

  /** Leave on purpose: the peer is told at once (no resume grace), then close. */
  leave(): void {
    if (this.open && !this.closed) this.socket.send(JSON.stringify({ t: "leave" } satisfies ClientMsg));
    this.socket.close();
  }

  private send(msg: ClientMsg): void {
    if (this.closed) return;
    if (this.open) this.socket.send(JSON.stringify(msg));
    else this.backlog.push(msg);
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

  /** Stop timers and report the close exactly once. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.clearConnectTimer();
    for (const t of this.pingTimers) clearTimeout(t);
    this.pingTimers = [];
    if (this.pingInterval !== null) clearInterval(this.pingInterval);
    this.pingInterval = null;
    this.onClose?.();
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "created":
        this.onCreated?.(msg.code, msg.token);
        break;
      case "start":
        this.onStart?.(toPayload(msg));
        break;
      case "queued":
        this.onQueued?.(msg.position);
        break;
      case "frame":
        this.onFrame?.(msg.frame);
        break;
      case "sync":
        this.onSync?.(msg.tick, msg.checksum);
        break;
      case "pong": {
        const rtt = Math.max(0, this.now() - msg.at);
        this.rtts.push(rtt);
        if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
        this.onPong?.(rtt);
        break;
      }
      case "peer-dropped":
        this.onPeerDropped?.(msg.graceSec);
        break;
      case "peer-back":
        this.onPeerBack?.();
        break;
      case "peer-left":
        this.onPeerLeft?.();
        break;
      case "peer-paused":
        this.onPeerPaused?.(msg.paused);
        break;
      case "resumed":
        this.onResumed?.(msg.frames, toPayload(msg.start));
        break;
      case "rematch-wait":
        this.onRematchWait?.();
        break;
      case "error":
        this.onError?.(msg.reason);
        break;
    }
  }
}
