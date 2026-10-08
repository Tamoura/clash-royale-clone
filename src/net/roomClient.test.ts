import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomClient, type NetSocket } from "./roomClient";
import type { CardId } from "../game/cards";
import type { Loadout, ServerMsg, StartMsg } from "./protocol";

class FakeSocket implements NetSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  closed = 0;
  close() {
    this.closed++;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  emit(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  last() {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
  /** Sent messages other than the automatic pings. */
  nonPing() {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => m.t !== "ping");
  }
}

const DECK = ["knight"] as CardId[];
const MODE = { elixirRate: 1, mirror: false };
const LOADOUT: Loadout = { name: "Omar", crest: 1, tower: "princess", ability: null };
const TOKEN = "ab".repeat(16);
const START: StartMsg = {
  t: "start",
  role: "guest",
  hostDeck: DECK,
  guestDeck: DECK,
  mode: MODE,
  hostLoadout: LOADOUT,
  guestLoadout: null,
  delay: 5,
  token: TOKEN,
  code: "LION42",
};
const PAYLOAD = {
  role: "guest",
  hostDeck: DECK,
  guestDeck: DECK,
  mode: MODE,
  hostLoadout: LOADOUT,
  guestLoadout: null,
  delay: 5,
  token: TOKEN,
  code: "LION42",
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RoomClient", () => {
  it("queues a create until the socket opens, then sends it", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    client.create(DECK, MODE);
    expect(sock.sent).toHaveLength(0); // not open yet
    sock.open();
    expect(sock.nonPing()).toEqual([{ t: "create", deck: DECK, mode: MODE }]);
  });

  it("surfaces the room code from a created message", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onCreated = vi.fn();
    client.onCreated = onCreated;
    sock.open();
    sock.emit({ t: "created", code: "LION", token: TOKEN });
    expect(onCreated).toHaveBeenCalledWith("LION", TOKEN);
  });

  it("delivers the start payload with role and both decks", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onStart = vi.fn();
    client.onStart = onStart;
    sock.open();
    sock.emit(START);
    expect(onStart).toHaveBeenCalledWith(PAYLOAD);
  });

  it("sends a join with an upper-cased code", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    sock.open();
    client.join("lion", DECK);
    expect(sock.last()).toEqual({ t: "join", code: "LION", deck: DECK });
  });

  it("ships frames and sync digests to the relay", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    sock.open();
    const frame = { tick: 3, side: "player" as const, commands: [] };
    client.sendFrame(frame);
    expect(sock.last()).toEqual({ t: "frame", frame });
    client.sendSync(30, 999);
    expect(sock.last()).toEqual({ t: "sync", tick: 30, checksum: 999 });
  });

  it("routes incoming frames, sync, peer-left and errors to handlers", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onFrame = vi.fn();
    const onSync = vi.fn();
    const onPeerLeft = vi.fn();
    const onError = vi.fn();
    client.onFrame = onFrame;
    client.onSync = onSync;
    client.onPeerLeft = onPeerLeft;
    client.onError = onError;
    sock.open();
    const frame = { tick: 1, side: "enemy" as const, commands: [] };
    sock.emit({ t: "frame", frame });
    sock.emit({ t: "sync", tick: 30, checksum: 7 });
    sock.emit({ t: "peer-left" });
    sock.emit({ t: "error", reason: "room-full" });
    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(onSync).toHaveBeenCalledWith(30, 7);
    expect(onPeerLeft).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("room-full");
  });

  it("fills defaults when a v1 relay sends a bare start", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onStart = vi.fn();
    client.onStart = onStart;
    sock.open();
    sock.emit({ t: "start", role: "host", hostDeck: DECK, guestDeck: DECK, mode: MODE } as unknown as ServerMsg);
    expect(onStart).toHaveBeenCalledWith({ ...PAYLOAD, role: "host", hostLoadout: null, delay: 4, token: "", code: null });
  });

  it("stays v1-shaped without a loadout and adds v with one", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    sock.open();
    client.join("lion", DECK);
    expect(sock.last()).not.toHaveProperty("v");
    client.create(DECK, MODE, LOADOUT);
    expect(sock.last()).toEqual({ t: "create", v: 2, deck: DECK, mode: MODE, loadout: LOADOUT });
    client.join("lion42", DECK, LOADOUT);
    expect(sock.last()).toEqual({ t: "join", v: 2, code: "LION42", deck: DECK, loadout: LOADOUT });
  });

  it("sends quick, cancel, rematch, resume and pause", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    sock.open();
    client.quick(DECK, LOADOUT, MODE);
    client.cancel();
    client.rematch();
    client.resume("lion42", TOKEN, 120);
    client.pause(true);
    expect(sock.nonPing()).toEqual([
      { t: "quick", v: 2, deck: DECK, loadout: LOADOUT, mode: MODE },
      { t: "cancel" },
      { t: "rematch" },
      { t: "resume", code: "LION42", token: TOKEN, haveTick: 120 },
      { t: "pause", paused: true },
    ]);
  });

  it("routes every new server message to its handler", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const calls: unknown[][] = [];
    const rec = (name: string) => (...args: unknown[]) => calls.push([name, ...args]);
    client.onQueued = rec("queued");
    client.onPeerDropped = rec("dropped");
    client.onPeerBack = rec("back");
    client.onPeerPaused = rec("paused");
    client.onResumed = rec("resumed");
    client.onRematchWait = rec("rematch-wait");
    sock.open();
    const frames = [{ tick: 9, side: "player" as const, commands: [] }];
    sock.emit({ t: "queued", position: 2 });
    sock.emit({ t: "peer-dropped", graceSec: 20 });
    sock.emit({ t: "peer-back" });
    sock.emit({ t: "peer-paused", paused: false });
    sock.emit({ t: "resumed", frames, start: START });
    sock.emit({ t: "rematch-wait" });
    expect(calls).toEqual([
      ["queued", 2],
      ["dropped", 20],
      ["back"],
      ["paused", false],
      ["resumed", frames, PAYLOAD],
      ["rematch-wait"],
    ]);
  });

  it("ignores malformed server data", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    client.onError = vi.fn();
    sock.open();
    expect(() => sock.onmessage?.({ data: "not json" })).not.toThrow();
    expect(client.onError).not.toHaveBeenCalled();
  });

  it("gives up after 8s if the socket never opens, reporting the close once", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onClose = vi.fn();
    client.onClose = onClose;
    vi.advanceTimersByTime(7999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sock.closed).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // A late open after the timeout does nothing.
    sock.open();
    client.create(DECK, MODE);
    expect(sock.sent).toEqual([]);
  });

  it("reports an error and the close that follows it only once", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onClose = vi.fn();
    client.onClose = onClose;
    sock.onerror?.();
    sock.onclose?.();
    vi.advanceTimersByTime(10_000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pings 5 times on connect, then every 5s, reporting the measured RTT", () => {
    let now = 1000;
    const sock = new FakeSocket();
    const client = new RoomClient(sock, { now: () => now });
    sock.open();
    vi.advanceTimersByTime(0);
    expect(sock.last()).toEqual({ t: "ping", at: 1000 });
    now = 1040;
    sock.emit({ t: "pong", at: 1000 });
    expect(client.rtt).toBe(40);
    vi.advanceTimersByTime(1000);
    const pings = () => sock.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "ping");
    expect(pings()).toHaveLength(5);
    expect(pings()[1]).toEqual({ t: "ping", at: 1040, rtt: 40 }); // carries the last sample
    vi.advanceTimersByTime(5000);
    expect(pings()).toHaveLength(6);
    vi.advanceTimersByTime(10_000);
    expect(pings()).toHaveLength(8);
    sock.close();
    vi.advanceTimersByTime(20_000);
    expect(pings()).toHaveLength(8); // timers stop with the socket
  });

  it("leave tells the relay before closing", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    sock.open();
    client.leave();
    expect(sock.nonPing()).toEqual([{ t: "leave" }]);
    expect(sock.closed).toBe(1);
  });
});
