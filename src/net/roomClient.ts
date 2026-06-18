import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import type { ClientMsg, MatchMode, Role, ServerMsg } from "./protocol";

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
}

/**
 * Browser-side wrapper over the relay connection. Buffers sends until the
 * socket is open and fans incoming server messages out to typed handlers.
 */
export class RoomClient {
  onCreated: ((code: string) => void) | null = null;
  onStart: ((p: StartPayload) => void) | null = null;
  onFrame: ((frame: InputFrame) => void) | null = null;
  onSync: ((tick: number, checksum: number) => void) | null = null;
  onPeerLeft: (() => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  onClose: (() => void) | null = null;

  private open = false;
  private readonly backlog: ClientMsg[] = [];

  constructor(private readonly socket: NetSocket) {
    socket.onopen = () => {
      this.open = true;
      for (const msg of this.backlog) this.socket.send(JSON.stringify(msg));
      this.backlog.length = 0;
    };
    socket.onmessage = (ev) => this.handle(JSON.parse(ev.data) as ServerMsg);
    socket.onclose = () => this.onClose?.();
  }

  create(deck: CardId[], mode: MatchMode): void {
    this.send({ t: "create", deck, mode });
  }

  join(code: string, deck: CardId[]): void {
    this.send({ t: "join", code: code.toUpperCase(), deck });
  }

  sendFrame(frame: InputFrame): void {
    this.send({ t: "frame", frame });
  }

  sendSync(tick: number, checksum: number): void {
    this.send({ t: "sync", tick, checksum });
  }

  leave(): void {
    this.socket.close();
  }

  private send(msg: ClientMsg): void {
    if (this.open) this.socket.send(JSON.stringify(msg));
    else this.backlog.push(msg);
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "created":
        this.onCreated?.(msg.code);
        break;
      case "start":
        this.onStart?.({
          role: msg.role,
          hostDeck: msg.hostDeck,
          guestDeck: msg.guestDeck,
          mode: msg.mode,
        });
        break;
      case "frame":
        this.onFrame?.(msg.frame);
        break;
      case "sync":
        this.onSync?.(msg.tick, msg.checksum);
        break;
      case "peer-left":
        this.onPeerLeft?.();
        break;
      case "error":
        this.onError?.(msg.reason);
        break;
    }
  }
}
