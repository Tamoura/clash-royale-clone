import { describe, expect, it } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import { PROTOCOL_VERSION } from "./protocol";
import { parseClientMsg, playableCardIds, sanitizePlayerName } from "./validate";

const IDS = playableCardIds();
const DECK = [...DEFAULT_DECK];
const MODE = { elixirRate: 1, mirror: false };
const LOADOUT = { name: "Sara", crest: 3, tower: "cannoneer", ability: "salvo" };
const parse = (m: unknown): ReturnType<typeof parseClientMsg> =>
  parseClientMsg(typeof m === "string" ? m : JSON.stringify(m), IDS);
const frameMsg = (frame: object): ReturnType<typeof parseClientMsg> =>
  parse({ t: "frame", frame: { tick: 5, side: "player", commands: [], ...frame } });
const cmd = (x = 9, y = 20, cardId = "knight") => ({ side: "player", cardId, x, y });

describe("parseClientMsg fuzz cases", () => {
  const BAD: [string, unknown][] = [
    ["null", "null"],
    ["an array", "[]"],
    ["a join with no code or deck", '{"t":"join"}'],
    ["not JSON", "{t:create"],
    ["a number", "42"],
    ["an unknown type", { t: "explode" }],
    ["a non-string type", { t: 7 }],
    ["a 7-card deck", { t: "create", deck: DECK.slice(0, 7), mode: MODE }],
    ["a 9-card deck", { t: "create", deck: [...DECK, "zap"], mode: MODE }],
    ["a duplicate card", { t: "create", deck: [...DECK.slice(0, 7), DECK[0]], mode: MODE }],
    ["a champion deck", { t: "create", deck: [...DECK.slice(0, 7), "champion"], mode: MODE }],
    ["an unknown card", { t: "join", code: "LION42", deck: [...DECK.slice(0, 7), "dragon-king"] }],
    ["a mode with an unused elixir rate", { t: "create", deck: DECK, mode: { elixirRate: 1000, mirror: false } }],
    ["a mode with a string mirror", { t: "create", deck: DECK, mode: { elixirRate: 1, mirror: "yes" } }],
    ["a mode with a numeric crazy", { t: "create", deck: DECK, mode: { elixirRate: 3, mirror: false, crazy: 1 } }],
    ["a code with spaces", { t: "join", code: "LI ON", deck: DECK }],
    ["a too-long code", { t: "join", code: "ABCDEFGHIJKLM", deck: DECK }],
    ["a bad tower", { t: "create", deck: DECK, mode: MODE, loadout: { ...LOADOUT, tower: "wizard" } }],
    ["a bad ability", { t: "create", deck: DECK, mode: MODE, loadout: { ...LOADOUT, ability: "nuke" } }],
    ["a crest of 12", { t: "create", deck: DECK, mode: MODE, loadout: { ...LOADOUT, crest: 12 } }],
    ["a non-string name", { t: "create", deck: DECK, mode: MODE, loadout: { ...LOADOUT, name: 5 } }],
    ["a quick with no loadout", { t: "quick", deck: DECK, mode: MODE }],
    ["a frame without a frame", { t: "frame" }],
    ["a fractional tick", { t: "frame", frame: { tick: 1.5, side: "player", commands: [] } }],
    ["a tick past 1e6", { t: "frame", frame: { tick: 1_000_001, side: "player", commands: [] } }],
    ["a negative tick", { t: "frame", frame: { tick: -1, side: "player", commands: [] } }],
    ["a bad side", { t: "frame", frame: { tick: 1, side: "both", commands: [] } }],
    ["4 commands", { t: "frame", frame: { tick: 1, side: "player", commands: [cmd(), cmd(), cmd(), cmd()] } }],
    ["x off the arena", { t: "frame", frame: { tick: 1, side: "player", commands: [cmd(18.01)] } }],
    ["y below the arena", { t: "frame", frame: { tick: 1, side: "player", commands: [cmd(9, -0.5)] } }],
    ["a command with an unknown card", { t: "frame", frame: { tick: 1, side: "player", commands: [cmd(9, 20, "champion")] } }],
    ["3 emotes", { t: "frame", frame: { tick: 1, side: "player", commands: [], emotes: [1, 2, 3] } }],
    ["emote 8", { t: "frame", frame: { tick: 1, side: "player", commands: [], emotes: [8] } }],
    ["a string ability flag", { t: "frame", frame: { tick: 1, side: "player", commands: [], ability: "yes" } }],
    ["a float checksum", { t: "sync", tick: 30, checksum: 1.5 }],
    ["a resume with a short token", { t: "resume", code: "LION42", token: "abc", haveTick: 0 }],
    ["a pause with no flag", { t: "pause" }],
    ["a ping with no time", { t: "ping" }],
    ["a string version", { t: "create", v: "2", deck: DECK, mode: MODE }],
    ["a 200KB string", JSON.stringify({ t: "create", deck: DECK, mode: MODE, pad: "x".repeat(200_000) })],
  ];
  for (const [name, raw] of BAD) {
    it(`rejects ${name}`, () => {
      expect(parse(raw)).toEqual({ error: "bad-message" });
    });
  }

  it("rejects NaN and Infinity coordinates (as JSON cannot carry them, they arrive as null or strings)", () => {
    expect(frameMsg({ commands: [{ ...cmd(), y: NaN }] })).toEqual({ error: "bad-message" });
    expect(parse('{"t":"frame","frame":{"tick":1,"side":"player","commands":[{"side":"player","cardId":"knight","x":9,"y":"NaN"}]}}')).toEqual({
      error: "bad-message",
    });
    expect(frameMsg({ commands: [{ ...cmd(), x: Infinity }] })).toEqual({ error: "bad-message" });
  });
});

describe("parseClientMsg versioning", () => {
  it("asks an explicit v1 client to update", () => {
    expect(parse({ t: "create", v: 1, deck: DECK, mode: MODE })).toEqual({ error: "update-required" });
    expect(parse({ t: "frame", v: 3, frame: { tick: 1, side: "player", commands: [] } })).toEqual({
      error: "update-required",
    });
  });

  it("treats a missing v as current (LAN clients from before v2)", () => {
    expect(parse({ t: "create", deck: DECK, mode: MODE })).toEqual({ t: "create", deck: DECK, mode: MODE });
    expect(parse({ t: "join", code: "lion", deck: DECK })).toEqual({ t: "join", code: "LION", deck: DECK });
  });

  it("keeps v when it is current", () => {
    expect(parse({ t: "create", v: PROTOCOL_VERSION, deck: DECK, mode: MODE })).toMatchObject({ v: PROTOCOL_VERSION });
  });
});

describe("parseClientMsg accepts and normalises good messages", () => {
  it("a v2 create with a loadout, dropping unknown fields and client seeds", () => {
    const out = parse({
      t: "create",
      v: 2,
      deck: DECK,
      mode: { elixirRate: 7, mirror: false, crazy: true, seed: 99, junk: 1 },
      loadout: { ...LOADOUT, name: "  <b>Sara</b>!! " },
      extra: "ignored",
    });
    expect(out).toEqual({
      t: "create",
      v: 2,
      deck: DECK,
      mode: { elixirRate: 7, mirror: false, crazy: true },
      loadout: { name: "bSarab", crest: 3, tower: "cannoneer", ability: "salvo" },
    });
  });

  it("a quick match and a null ability", () => {
    expect(parse({ t: "quick", v: 2, deck: DECK, mode: MODE, loadout: { ...LOADOUT, ability: null } })).toEqual({
      t: "quick",
      v: 2,
      deck: DECK,
      mode: MODE,
      loadout: { ...LOADOUT, ability: null },
    });
  });

  it("frames with commands at the arena edges, an ability flag and emotes", () => {
    const frame = { tick: 1_000_000, side: "enemy", commands: [cmd(0, 0), cmd(18, 32)], ability: true, emotes: [0, 7] };
    expect(frameMsg(frame)).toEqual({ t: "frame", frame });
    // false and empty extras are dropped rather than rejected.
    expect(frameMsg({ ability: false, emotes: [] })).toEqual({
      t: "frame",
      frame: { tick: 5, side: "player", commands: [] },
    });
  });

  it("the small control messages", () => {
    expect(parse({ t: "sync", tick: 30, checksum: 0xffffffff })).toEqual({ t: "sync", tick: 30, checksum: 0xffffffff });
    expect(parse({ t: "ping", at: 123.5, rtt: 42 })).toEqual({ t: "ping", at: 123.5, rtt: 42 });
    expect(parse({ t: "pause", paused: true })).toEqual({ t: "pause", paused: true });
    expect(parse({ t: "cancel", junk: 1 })).toEqual({ t: "cancel" });
    expect(parse({ t: "rematch" })).toEqual({ t: "rematch" });
    expect(parse({ t: "leave" })).toEqual({ t: "leave" });
    const token = "0123456789abcdef0123456789abcdef";
    expect(parse({ t: "resume", code: "lion42", token, haveTick: -1 })).toEqual({
      t: "resume",
      code: "LION42",
      token,
      haveTick: -1,
    });
  });
});

describe("sanitizePlayerName", () => {
  it("keeps letters (any script), digits, space, _ and -; trims; max 12", () => {
    expect(sanitizePlayerName("  Omar_99 ")).toBe("Omar_99");
    expect(sanitizePlayerName("سارة")).toBe("سارة");
    expect(sanitizePlayerName("<script>x</script>")).toBe("scriptxscrip");
    expect(sanitizePlayerName("a".repeat(40))).toBe("a".repeat(12));
    expect(sanitizePlayerName("!!!")).toBe("");
  });
});
