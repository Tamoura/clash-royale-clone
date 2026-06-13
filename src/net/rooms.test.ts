import { describe, expect, it } from "vitest";
import { RoomHub } from "./rooms";
import type { CardId } from "../game/cards";

const DECK_A = ["knight", "archers"] as CardId[];
const DECK_B = ["giant", "wizard"] as CardId[];

/** Deterministic code generator for tests: LION, BEAR, WOLF... */
function codes(...seq: string[]): () => string {
  let i = 0;
  return () => seq[i++];
}

describe("RoomHub", () => {
  it("hands the creator a room code", () => {
    const hub = new RoomHub(codes("LION"));
    const out = hub.create("host1", DECK_A);
    expect(out).toEqual([{ to: "host1", msg: { t: "created", code: "LION" } }]);
  });

  it("starts the match for both players when the guest joins", () => {
    const hub = new RoomHub(codes("LION"));
    hub.create("host1", DECK_A);
    const out = hub.join("guest1", "LION", DECK_B);
    expect(out).toContainEqual({
      to: "host1",
      msg: { t: "start", role: "host", hostDeck: DECK_A, guestDeck: DECK_B },
    });
    expect(out).toContainEqual({
      to: "guest1",
      msg: { t: "start", role: "guest", hostDeck: DECK_A, guestDeck: DECK_B },
    });
  });

  it("rejects joining an unknown code", () => {
    const hub = new RoomHub(codes("LION"));
    const out = hub.join("guest1", "NOPE", DECK_B);
    expect(out).toEqual([{ to: "guest1", msg: { t: "error", reason: "no-such-room" } }]);
  });

  it("rejects joining a room that is already full", () => {
    const hub = new RoomHub(codes("LION"));
    hub.create("host1", DECK_A);
    hub.join("guest1", "LION", DECK_B);
    const out = hub.join("guest2", "LION", DECK_B);
    expect(out).toEqual([{ to: "guest2", msg: { t: "error", reason: "room-full" } }]);
  });

  it("relays a frame only to the peer, not back to the sender", () => {
    const hub = new RoomHub(codes("LION"));
    hub.create("host1", DECK_A);
    hub.join("guest1", "LION", DECK_B);
    const frame = { tick: 5, side: "player" as const, commands: [] };
    const out = hub.relayFrame("host1", frame);
    expect(out).toEqual([{ to: "guest1", msg: { t: "frame", frame } }]);
  });

  it("relays sync digests to the peer", () => {
    const hub = new RoomHub(codes("LION"));
    hub.create("host1", DECK_A);
    hub.join("guest1", "LION", DECK_B);
    const out = hub.relaySync("guest1", 30, 12345);
    expect(out).toEqual([{ to: "host1", msg: { t: "sync", tick: 30, checksum: 12345 } }]);
  });

  it("tells the peer when someone leaves and frees the room", () => {
    const hub = new RoomHub(codes("LION", "LION"));
    hub.create("host1", DECK_A);
    hub.join("guest1", "LION", DECK_B);
    const out = hub.leave("host1");
    expect(out).toEqual([{ to: "guest1", msg: { t: "peer-left" } }]);
    // Code is freed: a fresh create can reuse it, and the stale guest now has no peer.
    hub.create("host2", DECK_A);
    expect(hub.relayFrame("guest1", { tick: 0, side: "enemy", commands: [] })).toEqual([]);
  });

  it("retries code generation on collision", () => {
    const hub = new RoomHub(codes("LION", "LION", "BEAR"));
    hub.create("host1", DECK_A);
    const out = hub.create("host2", DECK_A); // first pick LION collides → BEAR
    expect(out).toEqual([{ to: "host2", msg: { t: "created", code: "BEAR" } }]);
  });
});
