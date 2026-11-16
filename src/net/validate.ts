import { CARDS, isDeckable, type CardId } from "../game/cards";
import { ARENA_HEIGHT, ARENA_WIDTH, type Side } from "../game/arena";
import { TOWER_TROOP_IDS, type TowerTroopId } from "../game/towers";
import { ABILITY_IDS, type AbilityId } from "../game/abilities";
import type { DeployCommand, InputFrame } from "./lockstep";
import { PROTOCOL_VERSION, type ClientMsg, type ErrorReason, type Loadout, type MatchMode } from "./protocol";
import type { StartPayload } from "./roomClient";

/**
 * Untrusted-input gate for the relay. Everything a socket sends passes through
 * {@link parseClientMsg}, which either returns a fresh, well-formed message
 * (unknown fields stripped) or an error. Pure: no DOM, no Node APIs, so the
 * relay bundle stays small and the rules are unit-tested.
 *
 * The other direction uses the same rules: the page does not trust the relay
 * either ({@link cleanStartMsg} and the other clean* helpers at the end, used
 * by roomClient.ts), so a relay that misbehaves cannot put text on a kid's
 * screen or build the battle from a deck or mode the relay itself would refuse.
 */

/** Longest raw message we even try to parse (the socket caps at 4 KB too). */
export const MAX_MESSAGE_BYTES = 4096;
/** Elixir rates the online game modes use (classic/mirror/crazy 1x, triple, mega). */
export const ONLINE_ELIXIR_RATES: readonly number[] = [1, 3, 7];
/** Highest tick a frame or sync may name: ~9 hours at 30 Hz. */
export const MAX_TICK = 1_000_000;
export const MAX_COMMANDS_PER_FRAME = 3;
export const MAX_EMOTES_PER_FRAME = 2;
export const EMOTE_COUNT = 8;
export const CREST_COUNT = 12;
export const DECK_SIZE = 8;
/** Room codes: LION42 words, base32 fallbacks, with room for dashes. */
export const CODE_PATTERN = /^[A-Z0-9-]{3,12}$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const MAX_NAME_INPUT = 64;

export type ParseError = { error: "bad-message" | "update-required" };

/**
 * Cards a player may bring online: every deckable card, so neither the
 * per-device champion nor a token (a Pebble Golem only a Stone Golem fields).
 */
export function playableCardIds(): ReadonlySet<string> {
  return new Set((Object.keys(CARDS) as CardId[]).filter(isDeckable));
}

/**
 * The player-name rule (shared with the client's prefs): keep only letters,
 * digits, space, underscore and dash; trim; at most 12 characters.
 */
export function sanitizePlayerName(s: string): string {
  const kept = s.replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  return Array.from(kept).slice(0, 12).join("").trim();
}

type Obj = Record<string, unknown>;

class Bad extends Error {}

function fail(): never {
  throw new Bad();
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function int(v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) fail();
  return v;
}

function num(v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) fail();
  return v;
}

function bool(v: unknown): boolean {
  if (typeof v !== "boolean") fail();
  return v;
}

function side(v: unknown): Side {
  if (v !== "player" && v !== "enemy") fail();
  return v;
}

function code(v: unknown): string {
  if (typeof v !== "string") fail();
  const up = v.toUpperCase();
  if (!CODE_PATTERN.test(up)) fail();
  return up;
}

function deck(v: unknown, cardIds: ReadonlySet<string>): CardId[] {
  if (!Array.isArray(v) || v.length !== DECK_SIZE) fail();
  for (const id of v) {
    if (typeof id !== "string" || id === "champion" || !cardIds.has(id)) fail();
  }
  if (new Set(v).size !== DECK_SIZE) fail();
  return [...v] as CardId[];
}

function mode(v: unknown): MatchMode {
  if (!isObj(v)) fail();
  const elixirRate = num(v.elixirRate, 1, 7);
  if (!ONLINE_ELIXIR_RATES.includes(elixirRate)) fail();
  const out: MatchMode = { elixirRate, mirror: bool(v.mirror) };
  if (v.crazy !== undefined) out.crazy = bool(v.crazy);
  // Any client seed is dropped: the relay picks the match seed.
  return out;
}

function loadout(v: unknown): Loadout {
  if (!isObj(v)) fail();
  if (typeof v.name !== "string" || v.name.length > MAX_NAME_INPUT) fail();
  const tower = v.tower;
  if (typeof tower !== "string" || !(TOWER_TROOP_IDS as string[]).includes(tower)) fail();
  const ability = v.ability;
  if (ability !== null && (typeof ability !== "string" || !(ABILITY_IDS as string[]).includes(ability))) {
    fail();
  }
  return {
    name: sanitizePlayerName(v.name),
    crest: int(v.crest, 0, CREST_COUNT - 1),
    tower: tower as TowerTroopId,
    ability: ability as AbilityId | null,
  };
}

function command(v: unknown, cardIds: ReadonlySet<string>): DeployCommand {
  if (!isObj(v)) fail();
  if (typeof v.cardId !== "string" || !cardIds.has(v.cardId)) fail();
  return {
    side: side(v.side),
    cardId: v.cardId as CardId,
    x: num(v.x, 0, ARENA_WIDTH),
    y: num(v.y, 0, ARENA_HEIGHT),
  };
}

function frame(v: unknown, cardIds: ReadonlySet<string>): InputFrame {
  if (!isObj(v)) fail();
  if (!Array.isArray(v.commands) || v.commands.length > MAX_COMMANDS_PER_FRAME) fail();
  const out: InputFrame = {
    tick: int(v.tick, 0, MAX_TICK),
    side: side(v.side),
    commands: v.commands.map((c) => command(c, cardIds)),
  };
  if (v.ability !== undefined && v.ability !== false) {
    if (v.ability !== true) fail();
    out.ability = true;
  }
  if (v.emotes !== undefined) {
    if (!Array.isArray(v.emotes) || v.emotes.length > MAX_EMOTES_PER_FRAME) fail();
    const emotes = v.emotes.map((e) => int(e, 0, EMOTE_COUNT - 1));
    if (emotes.length > 0) out.emotes = emotes;
  }
  return out;
}

/** Copy `v` across when the client sent one (it is already checked). */
function withV<T extends object>(msg: T, v: number | undefined): T & { v?: number } {
  return v === undefined ? msg : { ...msg, v };
}

/** Messages that open a match: every current client stamps them with `v`. */
const HANDSHAKES = new Set(["create", "join", "quick"]);

/**
 * Parse and validate one raw client message. `cardIds` is the set of card ids
 * a deck may contain (see {@link playableCardIds}). A handshake (create, join,
 * quick) must carry the current `v`: a missing one is a v1 client, older than
 * versioning, and like any other version it gets `update-required` (pairing
 * it with a v3 page would desync). In-match messages carry no `v`; the
 * handshake already vouched for the connection.
 */
export function parseClientMsg(raw: string, cardIds: ReadonlySet<string>): ClientMsg | ParseError {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return { error: "bad-message" };
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return { error: "bad-message" };
  }
  if (!isObj(m) || typeof m.t !== "string") return { error: "bad-message" };
  if (m.v !== undefined) {
    if (typeof m.v !== "number") return { error: "bad-message" };
    if (m.v !== PROTOCOL_VERSION) return { error: "update-required" };
  } else if (HANDSHAKES.has(m.t)) {
    return { error: "update-required" };
  }
  const v = m.v as number | undefined;
  try {
    switch (m.t) {
      case "create": {
        const msg: ClientMsg = withV({ t: "create" as const, deck: deck(m.deck, cardIds), mode: mode(m.mode) }, v);
        if (m.loadout !== undefined) msg.loadout = loadout(m.loadout);
        return msg;
      }
      case "join": {
        const msg: ClientMsg = withV({ t: "join" as const, code: code(m.code), deck: deck(m.deck, cardIds) }, v);
        if (m.loadout !== undefined) msg.loadout = loadout(m.loadout);
        return msg;
      }
      case "quick":
        return withV(
          { t: "quick" as const, deck: deck(m.deck, cardIds), loadout: loadout(m.loadout), mode: mode(m.mode) },
          v,
        );
      case "frame":
        return withV({ t: "frame" as const, frame: frame(m.frame, cardIds) }, v);
      case "sync":
        return withV({ t: "sync" as const, tick: int(m.tick, 0, MAX_TICK), checksum: int(m.checksum, 0, 0xffffffff) }, v);
      case "ping": {
        const msg: ClientMsg = { t: "ping", at: num(m.at, -Number.MAX_VALUE, Number.MAX_VALUE) };
        if (m.rtt !== undefined) msg.rtt = num(m.rtt, 0, 60_000);
        return msg;
      }
      case "resume": {
        if (typeof m.token !== "string" || !TOKEN_PATTERN.test(m.token)) fail();
        return { t: "resume", code: code(m.code), token: m.token, haveTick: int(m.haveTick, -1, MAX_TICK) };
      }
      case "pause":
        return { t: "pause", paused: bool(m.paused) };
      case "cancel":
      case "rematch":
      case "leave":
        return { t: m.t };
      default:
        return { error: "bad-message" };
    }
  } catch (e) {
    if (e instanceof Bad) return { error: "bad-message" };
    throw e;
  }
}

/** Narrowing helper for callers of {@link parseClientMsg}. */
export function isParseError(r: ClientMsg | ParseError): r is ParseError {
  return "error" in r;
}

// ---- Relay to page ------------------------------------------------------------
//
// What the page accepts from the relay mirrors what the relay accepts from a
// page (above) and what rooms.ts sends. Anything the battle is built from
// (role, decks, mode, delay) must be exactly right, or the whole message is
// broken; anything only shown (a name, a crest) is cleaned to something safe.

/** The relay's input delay range: rooms.ts inputDelay clamps to it. */
export const MIN_INPUT_DELAY = 3;
export const MAX_INPUT_DELAY = 10;
/** The delay when the relay names none (an old relay): rooms.ts DEFAULT_DELAY. */
export const DEFAULT_INPUT_DELAY = 4;
/** Match seeds are integers in [0, 2^31) (server/relay.ts: randomInt(2 ** 31)). */
export const MAX_SEED = 2 ** 31 - 1;
/** A dropped peer's resume grace in seconds (rooms.ts GRACE_SEC), and the most we believe. */
export const DEFAULT_GRACE_SEC = 20;
export const MAX_GRACE_SEC = 60;
/** The relay's own cap on a reported round trip (ping `rtt`, above). */
export const MAX_RTT_MS = 60_000;

const ERROR_REASONS: ReadonlySet<string> = new Set<ErrorReason>([
  "bad-message",
  "update-required",
  "no-such-room",
  "room-full",
  "expired",
  "rate-limited",
  "server-restart",
  "resume-failed",
  "quick-disabled",
]);

/** Run a validator; null instead of the internal failure. */
function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

/**
 * A loadout as the relay passed it on, safe to show: the name through
 * {@link sanitizePlayerName} ("" when it is not text), a crest index in
 * 0..CREST_COUNT-1 (else 0), a known tower troop (else the first, the
 * default) and a known ability (else none). Anything that is not an object
 * (null, or an old relay leaving it out) is no loadout at all.
 */
export function cleanLoadout(v: unknown): Loadout | null {
  if (!isObj(v)) return null;
  const crest = v.crest;
  const tower = v.tower;
  const ability = v.ability;
  return {
    name: typeof v.name === "string" ? sanitizePlayerName(v.name.slice(0, MAX_NAME_INPUT)) : "",
    crest: typeof crest === "number" && Number.isInteger(crest) && crest >= 0 && crest < CREST_COUNT ? crest : 0,
    tower: typeof tower === "string" && (TOWER_TROOP_IDS as string[]).includes(tower) ? (tower as TowerTroopId) : TOWER_TROOP_IDS[0],
    ability: typeof ability === "string" && (ABILITY_IDS as string[]).includes(ability) ? (ability as AbilityId) : null,
  };
}

/** A room code from the relay, upper-cased, or null when it is not one. */
export function cleanRoomCode(v: unknown): string | null {
  return attempt(() => code(v));
}

/** A resume token from the relay, or "" when it is not one (the seat then cannot resume). */
export function cleanToken(v: unknown): string {
  return typeof v === "string" && TOKEN_PATTERN.test(v) ? v : "";
}

/** The relay's mode: a mode the relay accepts, plus the seed it dealt. */
function startMode(v: unknown): MatchMode {
  const out = mode(v);
  const seed = (v as Obj).seed;
  if (seed !== undefined) out.seed = int(seed, 0, MAX_SEED);
  return out;
}

/**
 * A `start` message (also the one replayed inside `resumed`), checked and
 * cleaned, or null when it is broken: a role other than host or guest, a
 * deck that is not DECK_SIZE different playable cards, a mode the relay
 * would refuse, or a delay outside the relay's range. Loadouts are cleaned
 * with {@link cleanLoadout}; a bad token or room code only turns resuming
 * off. Old relays that leave out delay, token or code get the defaults.
 */
export function cleanStartMsg(v: unknown, cardIds: ReadonlySet<string> = playableCardIds()): StartPayload | null {
  if (!isObj(v)) return null;
  return attempt(() => {
    if (v.role !== "host" && v.role !== "guest") fail();
    return {
      role: v.role,
      hostDeck: deck(v.hostDeck, cardIds),
      guestDeck: deck(v.guestDeck, cardIds),
      mode: startMode(v.mode),
      hostLoadout: cleanLoadout(v.hostLoadout),
      guestLoadout: cleanLoadout(v.guestLoadout),
      delay: v.delay === undefined ? DEFAULT_INPUT_DELAY : int(v.delay, MIN_INPUT_DELAY, MAX_INPUT_DELAY),
      token: cleanToken(v.token),
      code: v.code === undefined || v.code === null ? null : cleanRoomCode(v.code),
    };
  });
}

/** A frame the relay forwarded, by the rules the relay checked it with, or null. */
export function cleanFrame(v: unknown, cardIds: ReadonlySet<string> = playableCardIds()): InputFrame | null {
  return attempt(() => frame(v, cardIds));
}

/** A sync digest from the relay, or null. */
export function cleanSync(tick: unknown, checksum: unknown): { tick: number; checksum: number } | null {
  return attempt(() => ({ tick: int(tick, 0, MAX_TICK), checksum: int(checksum, 0, 0xffffffff) }));
}

/** A peer's resume grace (whole seconds, 0..MAX_GRACE_SEC); the relay's default when it is not a number. */
export function cleanGraceSec(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_GRACE_SEC;
  return Math.min(MAX_GRACE_SEC, Math.max(0, Math.round(v)));
}

/** A relay refusal the page knows; anything else reads as "bad-message". */
export function cleanErrorReason(v: unknown): ErrorReason {
  return typeof v === "string" && ERROR_REASONS.has(v) ? (v as ErrorReason) : "bad-message";
}
