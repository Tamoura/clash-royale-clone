import type { CardId } from "../game/cards";
import type { Side } from "../game/arena";
import type { InputFrame } from "./lockstep";

/** Host drives the canonical `player` side; guest drives `enemy`. */
export type Role = "host" | "guest";

/** Game-mode settings the host chooses; both peers build the same match. */
export interface MatchMode {
  /** Flat elixir rate (1 normal, 3 triple, 7 mega). */
  elixirRate: number;
  /** Both players battle with the host's (random) deck. */
  mirror: boolean;
}

/** Messages a client sends to the relay. */
export type ClientMsg =
  | { t: "create"; deck: CardId[]; mode: MatchMode }
  | { t: "join"; code: string; deck: CardId[] }
  | { t: "frame"; frame: InputFrame }
  | { t: "sync"; tick: number; checksum: number };

/** Messages the relay sends to a client. */
export type ServerMsg =
  | { t: "created"; code: string }
  | { t: "start"; role: Role; hostDeck: CardId[]; guestDeck: CardId[]; mode: MatchMode }
  | { t: "frame"; frame: InputFrame }
  | { t: "sync"; tick: number; checksum: number }
  | { t: "peer-left" }
  | { t: "error"; reason: string };

/** Both peers build the same canonical battle: host = player, guest = enemy. */
export function sideForRole(role: Role): Side {
  return role === "host" ? "player" : "enemy";
}
