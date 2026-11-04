/**
 * Test kit for the online stack: the real relay hub (rooms.ts) behind an
 * in-memory socket pair, so OnlineSession tests run whole matches with no
 * network. Shared by session*.test.ts and rematch.test.ts; never shipped.
 */
import { vi } from "vitest";
import type { CardId } from "../game/cards";
import type { ClientMsg, Loadout, MatchMode } from "./protocol";
import type { NetSocket } from "./roomClient";
import { RoomHub, type Outbound } from "./rooms";
import { parseClientMsg, playableCardIds } from "./validate";
import { OnlineSession, SIM_DT, mulberry32, type MatchInfo } from "./session";

export const HOST_DECK: CardId[] = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
export const GUEST_DECK: CardId[] = ["wizard", "witch", "skeletons", "gargoyles", "valkyrie", "hog-rider", "cannon", "zap"];
export const MODE: MatchMode = { elixirRate: 1, mirror: false };
export const HOST: Loadout = { name: "Amal", crest: 3, tower: "princess", ability: "salvo" };
export const GUEST: Loadout = { name: "Bilal", crest: 7, tower: "cannoneer", ability: "restore" };

/** A socket wired to the in-memory relay. */
export class MemSocket implements NetSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly relay: MemRelay,
    readonly id: string,
  ) {}
  send(data: string): void {
    if (!this.closed) this.relay.inbox.push({ from: this.id, data });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Like a real socket: anything already sent arrives before the close.
    this.relay.inbox.push({ from: this.id, data: null });
    this.onclose?.();
  }
  /** The network died under this socket (no leave was sent). */
  kill(): void {
    this.close();
  }
}

/**
 * The relay without the network: RoomHub plus a message pump. Messages are
 * queued and delivered by pump(), so re-entrant sends stay ordered.
 */
export class MemRelay {
  readonly hub: RoomHub;
  readonly sockets = new Map<string, MemSocket>();
  inbox: { from: string; data: string | null }[] = [];
  private outbox: Outbound[] = [];
  private toOpen: MemSocket[] = [];
  private serial = 0;
  clock = 0;
  /** While true, new connections fail at once (relay unreachable). */
  refuse = false;
  connects: number[] = [];
  /** Raw client messages the production relay's parser would reject. */
  rejected: string[] = [];
  /** Sockets that receive nothing any more (a silently dead link). */
  muted = new Set<string>();

  constructor() {
    let n = 0;
    this.hub = new RoomHub(() => `ROOM${++n}`, {
      now: () => this.clock,
      rng: mulberry32(9),
      token: () => (++n).toString(16).padStart(32, "0"),
      seed: () => 1234,
    });
  }

  connect = (): NetSocket => {
    const s = new MemSocket(this, `c${++this.serial}`);
    this.connects.push(Date.now());
    if (this.refuse) {
      queueMicrotask(() => {
        s.closed = true;
        s.onclose?.();
      });
      return s;
    }
    this.sockets.set(s.id, s);
    this.toOpen.push(s);
    return s;
  };

  /** Run the relay's expiry sweep at the current clock (grace, TTLs). */
  sweep(): void {
    this.outbox.push(...this.hub.sweep(this.clock));
  }

  dropped(id: string): void {
    if (!this.sockets.delete(id)) return;
    this.outbox.push(...this.hub.drop(id));
  }

  pump(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      const open = this.toOpen.shift();
      if (open) {
        open.onopen?.();
        continue;
      }
      const msg = this.inbox.shift();
      if (msg) {
        if (msg.data === null) this.dropped(msg.from);
        else if (this.sockets.has(msg.from)) {
          const parsed = parseClientMsg(msg.data, playableCardIds());
          if ("error" in parsed) this.rejected.push(`${parsed.error}: ${msg.data.slice(0, 120)}`);
          else this.outbox.push(...this.handle(msg.from, JSON.parse(msg.data) as ClientMsg));
        }
        continue;
      }
      const out = this.outbox.shift();
      if (out) {
        if (!this.muted.has(out.to)) this.sockets.get(out.to)?.onmessage?.({ data: JSON.stringify(out.msg) });
        continue;
      }
      return;
    }
    throw new Error("relay pump did not settle");
  }

  private handle(id: string, m: ClientMsg): Outbound[] {
    const h = this.hub;
    switch (m.t) {
      case "create":
        return h.create(id, m.deck, m.mode, { loadout: m.loadout, v: m.v });
      case "join":
        return h.join(id, m.code, m.deck, { loadout: m.loadout, v: m.v });
      case "quick":
        return h.quick(id, m.deck, m.mode, { loadout: m.loadout, v: m.v });
      case "cancel":
        return h.cancel(id);
      case "frame":
        return h.relayFrame(id, m.frame);
      case "sync":
        return h.relaySync(id, m.tick, m.checksum);
      case "ping":
        return h.ping(id, m.at, m.rtt);
      case "rematch":
        return h.requestRematch(id);
      case "leave": {
        const out = h.leave(id);
        this.sockets.delete(id);
        return out;
      }
      case "resume":
        return h.resume(id, m.code, m.token, m.haveTick);
      case "pause":
        return h.pause(id, m.paused);
    }
  }
}

export interface Pair {
  relay: MemRelay;
  host: OnlineSession;
  guest: OnlineSession;
  matches: { host: MatchInfo[]; guest: MatchInfo[] };
  /** Step both peers (unless paused) and deliver all traffic. */
  frame(opts?: { host?: boolean; guest?: boolean }): void;
}

export function pair(mode: MatchMode = MODE, hostDeck: CardId[] = HOST_DECK): Pair {
  const relay = new MemRelay();
  const host = new OnlineSession({ url: "mem", loadout: HOST, connect: relay.connect, now: () => relay.clock });
  const guest = new OnlineSession({ url: "mem", loadout: GUEST, connect: relay.connect, now: () => relay.clock });
  const matches = { host: [] as MatchInfo[], guest: [] as MatchInfo[] };
  host.onMatch = (m) => matches.host.push(m);
  guest.onMatch = (m) => matches.guest.push(m);
  host.create(hostDeck, mode);
  relay.pump();
  const waiting = host.view();
  if (waiting.t !== "waiting") throw new Error(`host not waiting: ${waiting.t}`);
  guest.join(waiting.code, GUEST_DECK);
  relay.pump();
  return {
    relay,
    host,
    guest,
    matches,
    frame(opts = {}) {
      relay.clock += SIM_DT * 1000;
      vi.advanceTimersByTime(SIM_DT * 1000); // pings tick like a real page
      if (opts.host !== false) host.step(SIM_DT);
      if (opts.guest !== false) guest.step(SIM_DT);
      relay.pump();
    },
  };
}

/** Run frames until both sims have passed `tick` (with a safety cap). */
export function runUntil(p: Pair, tick: number): void {
  for (let i = 0; i < tick * 3 && (p.host.tick < tick || p.guest.tick < tick); i++) p.frame();
}
