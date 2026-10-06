import { CARDS, type CardId } from "../game/cards";
import { ARENA_HEIGHT, ARENA_WIDTH, type Side } from "../game/arena";
import { TOWER_TROOP_IDS, type TowerTroopId } from "../game/towers";
import { ABILITY_IDS, type AbilityId } from "../game/abilities";
import type { DeployCommand, InputFrame } from "./lockstep";
import { PROTOCOL_VERSION, type ClientMsg, type Loadout, type MatchMode } from "./protocol";

/**
 * Untrusted-input gate for the relay. Everything a socket sends passes through
 * {@link parseClientMsg}, which either returns a fresh, well-formed message
 * (unknown fields stripped) or an error. Pure: no DOM, no Node APIs, so the
 * relay bundle stays small and the rules are unit-tested.
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

/** Cards a player may bring online: every card except the per-device champion. */
export function playableCardIds(): ReadonlySet<string> {
  return new Set(Object.keys(CARDS).filter((id) => id !== "champion"));
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

/**
 * Parse and validate one raw client message. `cardIds` is the set of card ids
 * a deck may contain (see {@link playableCardIds}). A missing `v` means the
 * current protocol (v1 LAN clients never sent one); any other explicit
 * version gets `update-required`.
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
