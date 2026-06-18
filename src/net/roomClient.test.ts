import { describe, expect, it, vi } from "vitest";
import { RoomClient, type NetSocket } from "./roomClient";
import type { CardId } from "../game/cards";
import type { ServerMsg } from "./protocol";

class FakeSocket implements NetSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
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
}

const DECK = ["knight"] as CardId[];
const MODE = { elixirRate: 1, mirror: false };

describe("RoomClient", () => {
  it("queues a create until the socket opens, then sends it", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    client.create(DECK, MODE);
    expect(sock.sent).toHaveLength(0); // not open yet
    sock.open();
    expect(sock.last()).toEqual({ t: "create", deck: DECK, mode: MODE });
  });

  it("surfaces the room code from a created message", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onCreated = vi.fn();
    client.onCreated = onCreated;
    sock.open();
    sock.emit({ t: "created", code: "LION" });
    expect(onCreated).toHaveBeenCalledWith("LION");
  });

  it("delivers the start payload with role and both decks", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const onStart = vi.fn();
    client.onStart = onStart;
    sock.open();
    sock.emit({ t: "start", role: "guest", hostDeck: DECK, guestDeck: DECK, mode: MODE });
    expect(onStart).toHaveBeenCalledWith({
      role: "guest",
      hostDeck: DECK,
      guestDeck: DECK,
      mode: MODE,
    });
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
});
