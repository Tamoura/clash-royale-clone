import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import type { MatchMode, ServerMsg } from "./protocol";

/** One message the relay should deliver to a single connection. */
export interface Outbound {
  to: string;
  msg: ServerMsg;
}

interface Room {
  code: string;
  host: { conn: string; deck: CardId[] };
  guest: { conn: string; deck: CardId[] } | null;
  mode: MatchMode;
}

/**
 * Pure room manager for the LAN relay. It owns no sockets — connections are
 * opaque string IDs and every method returns the messages to deliver, so the
 * whole pairing/relay state machine is unit-testable without a network.
 */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly connRoom = new Map<string, string>();
  private readonly genCode: () => string;

  constructor(genCode: () => string) {
    this.genCode = genCode;
  }

  create(conn: string, deck: CardId[], mode: MatchMode): Outbound[] {
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode();
    this.rooms.set(code, { code, host: { conn, deck }, guest: null, mode });
    this.connRoom.set(conn, code);
    return [{ to: conn, msg: { t: "created", code } }];
  }

  join(conn: string, code: string, deck: CardId[]): Outbound[] {
    const room = this.rooms.get(code);
    if (!room) return [{ to: conn, msg: { t: "error", reason: "no-such-room" } }];
    if (room.guest) return [{ to: conn, msg: { t: "error", reason: "room-full" } }];
    room.guest = { conn, deck };
    this.connRoom.set(conn, code);
    const decks = { hostDeck: room.host.deck, guestDeck: deck, mode: room.mode };
    return [
      { to: room.host.conn, msg: { t: "start", role: "host", ...decks } },
      { to: conn, msg: { t: "start", role: "guest", ...decks } },
    ];
  }

  relayFrame(conn: string, frame: InputFrame): Outbound[] {
    const peer = this.peerOf(conn);
    return peer ? [{ to: peer, msg: { t: "frame", frame } }] : [];
  }

  relaySync(conn: string, tick: number, checksum: number): Outbound[] {
    const peer = this.peerOf(conn);
    return peer ? [{ to: peer, msg: { t: "sync", tick, checksum } }] : [];
  }

  leave(conn: string): Outbound[] {
    const code = this.connRoom.get(conn);
    if (code === undefined) return [];
    const peer = this.peerOf(conn);
    this.rooms.delete(code);
    this.connRoom.delete(conn);
    if (peer) this.connRoom.delete(peer);
    return peer ? [{ to: peer, msg: { t: "peer-left" } }] : [];
  }

  private peerOf(conn: string): string | null {
    const code = this.connRoom.get(conn);
    if (code === undefined) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    if (room.host.conn === conn) return room.guest?.conn ?? null;
    if (room.guest?.conn === conn) return room.host.conn;
    return null;
  }
}
