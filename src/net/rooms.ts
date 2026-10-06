import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import { base32Code, wordPart } from "./codewords";
import { sideForRole, type Loadout, type MatchMode, type Role, type ServerMsg, type StartMsg } from "./protocol";

/** One message the relay should deliver to a single connection. */
export interface Outbound {
  to: string;
  msg: ServerMsg;
}

/** Clock and randomness, injected so the hub stays pure and testable. */
export interface HubDeps {
  /** Milliseconds; only differences matter. */
  now: () => number;
  /** Uniform in [0, 1). Used for fallback codes and the default token/seed. */
  rng: () => number;
  /** 128-bit hex resume token. The relay passes a crypto source. */
  token: () => string;
  /** Match seed in [0, 2^31). The relay passes a crypto source. */
  seed: () => number;
}

/** How a client joined: its loadout and protocol version (absent for v1). */
export interface SeatOpts {
  loadout?: Loadout | null;
  v?: number;
}

/** Seconds a dropped player has to resume before the match is called off. */
export const GRACE_SEC = 20;
export const WAITING_TTL_MS = 10 * 60_000;
export const MATCH_TTL_MS = 12 * 60_000;
export const QUEUE_TTL_MS = 2 * 60_000;
/** A side's next frame must land within this many ticks of its last one. */
export const TICK_WINDOW = 16;
/** Input delay when either player's RTT is unknown (v1 clients never ping). */
export const DEFAULT_DELAY = 4;
const MAX_CODE_TRIES = 10;
const RTT_SAMPLES = 5;
const TICK_MS = 1000 / 30;

/**
 * Lockstep input delay (ticks) for two players' round-trip times: half the
 * average RTT plus a little jitter room, one tick of slack, clamped to 3..10.
 */
export function inputDelay(rttHost: number | null, rttGuest: number | null): number {
  if (rttHost === null || rttGuest === null) return DEFAULT_DELAY;
  const ticks = Math.ceil(((rttHost + rttGuest) / 2 + 25) / TICK_MS) + 1;
  return Math.min(10, Math.max(3, ticks));
}

interface Seat {
  /** Bound connection, or null while dropped and inside the resume grace. */
  conn: string | null;
  deck: CardId[];
  loadout: Loadout | null;
  token: string;
  /** A v1 client: short word codes and no resume (a drop ends the match). */
  legacy: boolean;
  droppedAt: number | null;
  /** Last tick this side sent; frames must follow it within the window. */
  lastTick: number;
}

interface Room {
  code: string;
  mode: MatchMode;
  host: Seat;
  guest: Seat | null;
  createdAt: number;
  startedAt: number;
  delay: number;
  /** Every relayed frame of the current match, for resumes. */
  log: InputFrame[];
  rematch: Set<Role>;
}

interface QueueEntry {
  conn: string;
  key: string;
  deck: CardId[];
  mode: MatchMode;
  opts: SeatOpts;
  at: number;
}

/**
 * Pure room manager for the relay. It owns no sockets — connections are
 * opaque string IDs and every method returns the messages to deliver, so the
 * whole pairing/relay state machine is unit-testable without a network.
 *
 * Rooms are created by a host and joined by code, or paired by the quick-match
 * queue. The hub rewrites frame sides to the sender's role, enforces a per-side
 * tick window and the sender's deck, logs frames so a dropped player can resume
 * within {@link GRACE_SEC}, and expires everything idle via {@link sweep}.
 */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly connRoom = new Map<string, string>();
  private readonly rtts = new Map<string, number[]>();
  private queue: QueueEntry[] = [];
  private readonly deps: HubDeps;
  private serial = 0;

  constructor(
    private readonly genCode: () => string,
    deps: Partial<HubDeps> = {},
  ) {
    const rng = deps.rng ?? Math.random;
    this.deps = {
      now: deps.now ?? Date.now,
      rng,
      token: deps.token ?? (() => base16(rng, 32)),
      seed: deps.seed ?? (() => Math.floor(rng() * 2 ** 31)),
    };
  }

  create(conn: string, deck: CardId[], mode: MatchMode, opts: SeatOpts = {}): Outbound[] {
    const out = this.leave(conn);
    const host = this.seat(conn, deck, opts);
    const code = this.newCode(host.legacy);
    const now = this.deps.now();
    this.rooms.set(code, {
      code,
      mode: { ...mode, seed: this.deps.seed() },
      host,
      guest: null,
      createdAt: now,
      startedAt: now,
      delay: DEFAULT_DELAY,
      log: [],
      rematch: new Set(),
    });
    this.connRoom.set(conn, code);
    out.push({ to: conn, msg: { t: "created", code, token: host.token } });
    return out;
  }

  join(conn: string, code: string, deck: CardId[], opts: SeatOpts = {}): Outbound[] {
    const out = this.leave(conn);
    const room = this.rooms.get(code);
    if (!room) return [...out, { to: conn, msg: { t: "error", reason: "no-such-room" } }];
    if (room.guest) return [...out, { to: conn, msg: { t: "error", reason: "room-full" } }];
    room.guest = this.seat(conn, deck, opts);
    this.connRoom.set(conn, code);
    return [...out, ...this.start(room)];
  }

  /**
   * Quick match: a FIFO per mode (elixir rate plus mirror/crazy flags, so no
   * one gets a mode they did not ask for). The first two waiting connections
   * are paired into a fresh room; the earlier one hosts.
   */
  quick(conn: string, deck: CardId[], mode: MatchMode, opts: SeatOpts = {}): Outbound[] {
    const out = this.leave(conn);
    const key = `${mode.elixirRate}:${mode.mirror ? 1 : 0}:${mode.crazy ? 1 : 0}`;
    const i = this.queue.findIndex((e) => e.key === key);
    if (i < 0) {
      this.queue.push({ conn, key, deck, mode, opts, at: this.deps.now() });
      const position = this.queue.filter((e) => e.key === key).length;
      return [...out, { to: conn, msg: { t: "queued", position } }];
    }
    const first = this.queue.splice(i, 1)[0];
    const code = this.newCode(false);
    const host = this.seat(first.conn, first.deck, first.opts);
    const room: Room = {
      code,
      mode: { ...first.mode, seed: this.deps.seed() },
      host,
      guest: this.seat(conn, deck, opts),
      createdAt: this.deps.now(),
      startedAt: this.deps.now(),
      delay: DEFAULT_DELAY,
      log: [],
      rematch: new Set(),
    };
    this.rooms.set(code, room);
    this.connRoom.set(first.conn, code);
    this.connRoom.set(conn, code);
    return [...out, ...this.start(room)];
  }

  /** Leave the quick-match queue, or close a room nobody has joined yet. */
  cancel(conn: string): Outbound[] {
    this.queue = this.queue.filter((e) => e.conn !== conn);
    const at = this.locate(conn);
    if (at && !at.room.guest) {
      this.rooms.delete(at.room.code);
      this.connRoom.delete(conn);
    }
    return [];
  }

  /** Record an RTT sample (if the client measured one) and answer the ping. */
  ping(conn: string, at: number, rtt?: number): Outbound[] {
    if (rtt !== undefined) {
      const samples = this.rtts.get(conn) ?? [];
      samples.push(rtt);
      if (samples.length > RTT_SAMPLES) samples.shift();
      this.rtts.set(conn, samples);
    }
    return [{ to: conn, msg: { t: "pong", at } }];
  }

  /** Median of the connection's last few RTT samples, or null if none. */
  rttOf(conn: string): number | null {
    const samples = this.rtts.get(conn);
    if (!samples || samples.length === 0) return null;
    const s = [...samples].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * Forward a frame to the peer. The sender's role decides the side (a client
   * cannot speak for the other player), ticks must advance within
   * {@link TICK_WINDOW}, and commands for cards outside the sender's deck are
   * dropped. Accepted frames are logged for resumes.
   */
  relayFrame(conn: string, frame: InputFrame): Outbound[] {
    const at = this.locate(conn);
    if (!at || !at.room.guest) return [];
    const { room, role, seat } = at;
    if (frame.tick <= seat.lastTick || frame.tick > seat.lastTick + TICK_WINDOW) return [];
    const side = sideForRole(role);
    // Mirror matches play the host's deck on both sides.
    const deck = room.mode.mirror ? room.host.deck : seat.deck;
    const clean: InputFrame = {
      tick: frame.tick,
      side,
      commands: frame.commands.filter((c) => deck.includes(c.cardId)).map((c) => ({ ...c, side })),
    };
    if (frame.ability) clean.ability = true;
    if (frame.emotes && frame.emotes.length > 0) clean.emotes = [...frame.emotes];
    seat.lastTick = frame.tick;
    room.log.push(clean);
    const peer = at.peer?.conn;
    return peer ? [{ to: peer, msg: { t: "frame", frame: clean } }] : [];
  }

  relaySync(conn: string, tick: number, checksum: number): Outbound[] {
    const peer = this.peerOf(conn);
    return peer ? [{ to: peer, msg: { t: "sync", tick, checksum } }] : [];
  }

  /** Tell the peer this player paused or unpaused (the clients agree on stalls). */
  pause(conn: string, paused: boolean): Outbound[] {
    const peer = this.peerOf(conn);
    return peer ? [{ to: peer, msg: { t: "peer-paused", paused } }] : [];
  }

  /**
   * Ask for a rematch. Once both players have asked, the log is reset, a new
   * seed and fresh tokens are issued and both get a new `start`.
   */
  rematch(conn: string): Outbound[] {
    const at = this.locate(conn);
    const guest = at?.room.guest;
    if (!at || !guest) return [];
    const { room, role } = at;
    room.rematch.add(role);
    if (room.rematch.size < 2 || !room.host.conn || !guest.conn) {
      return [{ to: conn, msg: { t: "rematch-wait" } }];
    }
    room.mode = { ...room.mode, seed: this.deps.seed() };
    room.host.token = this.deps.token();
    guest.token = this.deps.token();
    return this.start(room);
  }

  /**
   * Leave on purpose (or a v1 client's socket closed): the room is freed at
   * once and the peer is told `peer-left`. Also leaves the quick-match queue.
   */
  leave(conn: string): Outbound[] {
    this.queue = this.queue.filter((e) => e.conn !== conn);
    const at = this.locate(conn);
    if (!at) return [];
    const peer = at.peer?.conn ?? null;
    this.close(at.room);
    return peer ? [{ to: peer, msg: { t: "peer-left" } }] : [];
  }

  /**
   * The connection's socket closed. A waiting room or queue entry is simply
   * dropped. In a match the seat is held for {@link GRACE_SEC} so the player
   * can resume, and the peer is told `peer-dropped`; v1 clients cannot resume,
   * so their matches end at once as before.
   */
  drop(conn: string): Outbound[] {
    this.rtts.delete(conn);
    const at = this.locate(conn);
    if (!at || !at.room.guest || at.seat.legacy || at.peer?.legacy) return this.leave(conn);
    this.queue = this.queue.filter((e) => e.conn !== conn);
    at.seat.conn = null;
    at.seat.droppedAt = this.deps.now();
    at.room.rematch.clear();
    this.connRoom.delete(conn);
    const peer = at.peer?.conn;
    return peer ? [{ to: peer, msg: { t: "peer-dropped", graceSec: GRACE_SEC } }] : [];
  }

  /**
   * Re-bind a dropped (or silently stale) seat to a new connection. The
   * client gets every logged frame after `haveTick` (both sides; its lockstep
   * ignores its own and any duplicates) plus its original start payload, and
   * the peer is told `peer-back`.
   */
  resume(conn: string, code: string, token: string, haveTick: number): Outbound[] {
    const room = this.rooms.get(code);
    const role: Role | null =
      room?.host.token === token ? "host" : room?.guest?.token === token ? "guest" : null;
    if (!room || !room.guest || role === null) {
      return [{ to: conn, msg: { t: "error", reason: "resume-failed" } }];
    }
    const out = this.connRoom.get(conn) === code ? [] : this.leave(conn);
    const seat = role === "host" ? room.host : room.guest;
    const peer = role === "host" ? room.guest : room.host;
    if (seat.conn && seat.conn !== conn) this.connRoom.delete(seat.conn);
    seat.conn = conn;
    seat.droppedAt = null;
    this.connRoom.set(conn, code);
    const frames = room.log.filter((f) => f.tick > haveTick);
    out.push({ to: conn, msg: { t: "resumed", frames, start: this.startMsg(room, role) } });
    if (peer.conn) out.push({ to: peer.conn, msg: { t: "peer-back" } });
    return out;
  }

  /**
   * Expire idle state: waiting rooms after 10 minutes, matches after 12,
   * queue entries after 2, and dropped seats once their grace runs out.
   */
  sweep(now: number): Outbound[] {
    const out: Outbound[] = [];
    const expired = (to: string | null): void => {
      if (to) out.push({ to, msg: { t: "error", reason: "expired" } });
    };
    for (const room of [...this.rooms.values()]) {
      if (!room.guest) {
        if (now - room.createdAt >= WAITING_TTL_MS) {
          expired(room.host.conn);
          this.close(room);
        }
        continue;
      }
      const graceOver = (s: Seat): boolean => s.droppedAt !== null && now - s.droppedAt >= GRACE_SEC * 1000;
      if (graceOver(room.host) || graceOver(room.guest)) {
        for (const s of [room.host, room.guest]) {
          if (s.conn) out.push({ to: s.conn, msg: { t: "peer-left" } });
        }
        this.close(room);
      } else if (now - room.startedAt >= MATCH_TTL_MS) {
        expired(room.host.conn);
        expired(room.guest.conn);
        this.close(room);
      }
    }
    const [stale, fresh] = partition(this.queue, (e) => now - e.at >= QUEUE_TTL_MS);
    this.queue = fresh;
    for (const e of stale) expired(e.conn);
    return out;
  }

  /** Live counts for the health endpoint. */
  stats(): { rooms: number; queue: number } {
    return { rooms: this.rooms.size, queue: this.queue.length };
  }

  private start(room: Room): Outbound[] {
    const guest = room.guest!;
    room.startedAt = this.deps.now();
    room.log = [];
    room.rematch.clear();
    room.host.lastTick = -1;
    guest.lastTick = -1;
    room.delay = inputDelay(
      room.host.conn ? this.rttOf(room.host.conn) : null,
      guest.conn ? this.rttOf(guest.conn) : null,
    );
    const out: Outbound[] = [];
    if (room.host.conn) out.push({ to: room.host.conn, msg: this.startMsg(room, "host") });
    if (guest.conn) out.push({ to: guest.conn, msg: this.startMsg(room, "guest") });
    return out;
  }

  private startMsg(room: Room, role: Role): StartMsg {
    const seat = role === "host" ? room.host : room.guest!;
    return {
      t: "start",
      role,
      hostDeck: room.host.deck,
      guestDeck: room.guest!.deck,
      mode: room.mode,
      hostLoadout: room.host.loadout,
      guestLoadout: room.guest!.loadout,
      delay: room.delay,
      token: seat.token,
    };
  }

  private seat(conn: string, deck: CardId[], opts: SeatOpts): Seat {
    return {
      conn,
      deck,
      loadout: opts.loadout ?? null,
      token: this.deps.token(),
      legacy: opts.v === undefined,
      droppedAt: null,
      lastTick: -1,
    };
  }

  /**
   * A free room code: up to {@link MAX_CODE_TRIES} words (LION42; bare LION
   * for v1 clients, whose code box holds 5 letters), then base32 codes, then
   * a serial. Every stage is bounded, so this always terminates.
   */
  private newCode(legacy: boolean): string {
    const free = (c: string): boolean => c.length >= 3 && !this.rooms.has(c);
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const c = legacy ? wordPart(this.genCode()) : this.genCode();
      if (free(c)) return c;
    }
    const len = legacy ? 5 : 6;
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const c = base32Code(this.deps.rng, len);
      if (free(c)) return c;
    }
    // At most rooms.size collisions are possible, so this loop is bounded.
    let c: string;
    do c = `R${(++this.serial).toString(36).toUpperCase().padStart(4, "0")}`;
    while (this.rooms.has(c));
    return c;
  }

  private close(room: Room): void {
    this.rooms.delete(room.code);
    for (const s of [room.host, room.guest]) {
      if (s?.conn && this.connRoom.get(s.conn) === room.code) this.connRoom.delete(s.conn);
    }
  }

  private locate(conn: string): { room: Room; role: Role; seat: Seat; peer: Seat | null } | null {
    const code = this.connRoom.get(conn);
    const room = code === undefined ? undefined : this.rooms.get(code);
    if (!room) return null;
    if (room.host.conn === conn) return { room, role: "host", seat: room.host, peer: room.guest };
    if (room.guest?.conn === conn) return { room, role: "guest", seat: room.guest, peer: room.host };
    return null;
  }

  private peerOf(conn: string): string | null {
    return this.locate(conn)?.peer?.conn ?? null;
  }
}

function base16(rng: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

function partition<T>(list: T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const x of list) (pred(x) ? yes : no).push(x);
  return [yes, no];
}
