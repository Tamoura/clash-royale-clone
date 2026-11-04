/**
 * The client never writes to a socket that is not open (a browser logs
 * "WebSocket is already in CLOSING or CLOSED state" for every such send),
 * and its pings and timers stop the moment it leaves, not when the close
 * finally lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardId } from "../game/cards";
import type { Loadout } from "./protocol";
import { RoomClient, type NetSocket } from "./roomClient";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * A socket that behaves like the browser's: readyState moves through the
 * four states, close() only starts closing (onclose fires later, on
 * land()), and a send while not OPEN is recorded as the console error.
 */
class BrowserLikeSocket implements NetSocket {
  readyState = CONNECTING;
  sent: string[] = [];
  errors: string[] = [];
  closes = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    if (this.readyState !== OPEN) {
      this.errors.push(`WebSocket is already in CLOSING or CLOSED state: ${data}`);
      return;
    }
    this.sent.push(data);
  }
  close(): void {
    this.closes++;
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSING;
  }
  open(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }
  /** The close handshake finishes (the browser fires close a moment later). */
  land(): void {
    this.readyState = CLOSED;
    this.onclose?.();
  }
  types(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { t: string }).t);
  }
}

const DECK = ["knight"] as CardId[];
const MODE = { elixirRate: 1, mirror: false };
const LOADOUT: Loadout = { name: "Omar", crest: 1, tower: "princess", ability: null };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RoomClient on a browser-like socket", () => {
  it("sends nothing unless the socket is OPEN", () => {
    const sock = new BrowserLikeSocket();
    const client = new RoomClient(sock);
    client.create(DECK, MODE, LOADOUT); // CONNECTING: queued, not sent
    expect(sock.sent).toEqual([]);
    sock.open();
    expect(sock.types()).toContain("create");
    // The socket starts closing on its own (network, server): writes stop.
    sock.readyState = CLOSING;
    client.sendFrame({ tick: 1, side: "player", commands: [] });
    client.sendSync(30, 123);
    client.rematch();
    client.pause(true);
    client.ping();
    vi.advanceTimersByTime(20_000); // automatic pings too
    expect(sock.errors).toEqual([]);
    expect(sock.types()).not.toContain("frame");
  });

  it("stops pinging the moment it leaves, before the close lands", () => {
    const sock = new BrowserLikeSocket();
    const client = new RoomClient(sock);
    const onClose = vi.fn();
    client.onClose = onClose;
    sock.open();
    client.pingFast();
    vi.advanceTimersByTime(3000);
    const before = sock.sent.length;
    client.leave();
    expect(sock.types().at(-1)).toBe("leave");
    expect(sock.closes).toBe(1);
    // The browser takes its time to finish closing; nothing more goes out.
    vi.advanceTimersByTime(30_000);
    client.sendFrame({ tick: 2, side: "player", commands: [] });
    expect(sock.sent.length).toBe(before + 1);
    expect(sock.errors).toEqual([]);
    // The close is still reported, once, when it lands.
    expect(onClose).not.toHaveBeenCalled();
    sock.land();
    expect(onClose).toHaveBeenCalledTimes(1);
    client.leave();
    expect(sock.closes).toBe(1);
  });

  it("leaving a socket that is already closing sends no leave", () => {
    const sock = new BrowserLikeSocket();
    const client = new RoomClient(sock);
    sock.open();
    sock.readyState = CLOSING;
    client.leave();
    expect(sock.types()).not.toContain("leave");
    expect(sock.errors).toEqual([]);
  });

  it("leaving before the socket opens sends nothing, even if it opens later", () => {
    const sock = new BrowserLikeSocket();
    const client = new RoomClient(sock);
    client.join("LION42", DECK, LOADOUT);
    client.leave();
    sock.open();
    vi.advanceTimersByTime(10_000);
    expect(sock.sent).toEqual([]);
    expect(sock.errors).toEqual([]);
  });

  it("heartbeats and the connect timer stop after a close", () => {
    const sock = new BrowserLikeSocket();
    const client = new RoomClient(sock);
    sock.open();
    vi.advanceTimersByTime(1000);
    const pings = sock.sent.length;
    expect(pings).toBeGreaterThan(0);
    sock.land();
    vi.advanceTimersByTime(60_000);
    expect(sock.sent.length).toBe(pings);
    expect(sock.errors).toEqual([]);
    expect(sock.closes).toBe(0); // the connect timeout never fires after the open
    expect(client.rtt).toBeNull();
  });
});
