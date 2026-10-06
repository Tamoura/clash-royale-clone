import type { CardId } from "../game/cards";
import type { Side } from "../game/arena";
import type { TowerTroopId } from "../game/towers";
import type { AbilityId } from "../game/abilities";
import type { InputFrame } from "./lockstep";

/**
 * Wire protocol version. v2 is additive over v1: every v1 message is still
 * valid, and a message without `v` is treated as current so older LAN
 * clients keep working. A client that sends an explicit, different `v` is
 * told `update-required`. Ship relay changes before client changes.
 */
export const PROTOCOL_VERSION = 2;

/** Host drives the canonical `player` side; guest drives `enemy`. */
export type Role = "host" | "guest";

/** Game-mode settings the host chooses; both peers build the same match. */
export interface MatchMode {
  /** Flat elixir rate (1 normal, 3 triple, 7 mega). */
  elixirRate: number;
  /** Both players battle with the host's (random) deck. */
  mirror: boolean;
  /** Crazy mode: cards are scrambled from `seed`, identically on both peers. */
  crazy?: boolean;
  /** Match seed. The relay always fills it (any client value is replaced). */
  seed?: number;
}

/** Who a player is and how their side is set up for the match. */
export interface Loadout {
  /** Display name, already sanitised (letters, digits, space, _ and -; max 12). */
  name: string;
  /** Crest index, 0..11. */
  crest: number;
  tower: TowerTroopId;
  ability: AbilityId | null;
}

/** Why the relay refused or ended something. */
export type ErrorReason =
  | "bad-message"
  | "update-required"
  | "no-such-room"
  | "room-full"
  | "expired"
  | "rate-limited"
  | "server-restart"
  | "resume-failed"
  | "quick-disabled";

/** Messages a client sends to the relay. */
export type ClientMsg =
  | { t: "create"; v?: number; deck: CardId[]; mode: MatchMode; loadout?: Loadout }
  | { t: "join"; v?: number; code: string; deck: CardId[]; loadout?: Loadout }
  | { t: "quick"; v?: number; deck: CardId[]; loadout: Loadout; mode: MatchMode }
  | { t: "cancel" }
  | { t: "frame"; v?: number; frame: InputFrame }
  | { t: "sync"; v?: number; tick: number; checksum: number }
  | { t: "ping"; at: number; rtt?: number }
  | { t: "rematch" }
  | { t: "leave" }
  | { t: "resume"; code: string; token: string; haveTick: number }
  | { t: "pause"; paused: boolean };

/** The match-start payload; also replayed inside `resumed`. */
export interface StartMsg {
  t: "start";
  role: Role;
  hostDeck: CardId[];
  guestDeck: CardId[];
  mode: MatchMode;
  /** Each side's loadout, or null when that client did not send one (v1). */
  hostLoadout: Loadout | null;
  guestLoadout: Loadout | null;
  /** Input delay in ticks, identical for both peers. */
  delay: number;
  /** Secret resume token for this seat; only ever sent to its owner. */
  token: string;
  /**
   * The room code, needed to resume. Quick-match players never saw a
   * `created`, so it comes with the start. Optional: older relays omit it.
   */
  code?: string;
}

/** Messages the relay sends to a client. */
export type ServerMsg =
  | { t: "created"; code: string; token: string }
  | StartMsg
  | { t: "queued"; position: number }
  | { t: "frame"; frame: InputFrame }
  | { t: "sync"; tick: number; checksum: number }
  | { t: "pong"; at: number }
  | { t: "peer-dropped"; graceSec: number }
  | { t: "peer-back" }
  | { t: "peer-left" }
  | { t: "peer-paused"; paused: boolean }
  | { t: "resumed"; frames: InputFrame[]; start: StartMsg }
  | { t: "rematch-wait" }
  | { t: "error"; reason: ErrorReason };

/** Both peers build the same canonical battle: host = player, guest = enemy. */
export function sideForRole(role: Role): Side {
  return role === "host" ? "player" : "enemy";
}
