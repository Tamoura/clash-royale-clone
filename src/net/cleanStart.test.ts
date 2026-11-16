/**
 * The page's side of the relay boundary (validate.ts, "Relay to page"):
 * what a start (or the start inside `resumed`) may carry before the battle
 * is built from it or a name reaches the screen. The ranges mirror what the
 * relay itself accepts and sends (parseClientMsg, rooms.ts).
 */
import { describe, expect, it } from "vitest";
import { TOWER_TROOP_IDS } from "../game/towers";
import { ABILITY_IDS } from "../game/abilities";
import { DEFAULT_DELAY, GRACE_SEC, inputDelay } from "./rooms";
import {
  CREST_COUNT,
  DEFAULT_GRACE_SEC,
  DEFAULT_INPUT_DELAY,
  MAX_GRACE_SEC,
  MAX_INPUT_DELAY,
  MIN_INPUT_DELAY,
  cleanErrorReason,
  cleanFrame,
  cleanGraceSec,
  cleanLoadout,
  cleanRoomCode,
  cleanStartMsg,
  cleanSync,
  cleanToken,
  parseClientMsg,
  playableCardIds,
} from "./validate";

const IDS = playableCardIds();
const HOST_DECK = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
const GUEST_DECK = ["wizard", "witch", "skeletons", "gargoyles", "valkyrie", "hog-rider", "cannon", "zap"];
const TOKEN = "0123456789abcdef".repeat(2);
const START = {
  t: "start",
  role: "guest",
  hostDeck: HOST_DECK,
  guestDeck: GUEST_DECK,
  mode: { elixirRate: 3, mirror: false, crazy: true, seed: 123456 },
  hostLoadout: { name: "Amal", crest: 3, tower: "cannoneer", ability: "salvo" },
  guestLoadout: { name: "Bilal", crest: 7, tower: "duchess", ability: null },
  delay: 5,
  token: TOKEN,
  code: "LION042",
};
const start = (over: Record<string, unknown>) => cleanStartMsg({ ...START, ...over }, IDS);

describe("cleanStartMsg: a good start", () => {
  it("passes through unchanged (as the page's StartPayload)", () => {
    const { t: _t, ...rest } = START;
    expect(cleanStartMsg(START, IDS)).toEqual(rest);
  });

  it("drops fields the page does not use", () => {
    const out = start({ junk: "<b>x</b>", mode: { ...START.mode, extra: 1 }, hostLoadout: { ...START.hostLoadout, html: "<i>" } });
    expect(out).not.toHaveProperty("junk");
    expect(out?.mode).toEqual(START.mode);
    expect(out?.hostLoadout).toEqual(START.hostLoadout);
  });

  it("gives an old relay's bare start the defaults", () => {
    const bare = { t: "start", role: "host", hostDeck: HOST_DECK, guestDeck: GUEST_DECK, mode: { elixirRate: 1, mirror: false } };
    expect(cleanStartMsg(bare, IDS)).toEqual({
      role: "host",
      hostDeck: HOST_DECK,
      guestDeck: GUEST_DECK,
      mode: { elixirRate: 1, mirror: false },
      hostLoadout: null,
      guestLoadout: null,
      delay: DEFAULT_INPUT_DELAY,
      token: "",
      code: null,
    });
  });

  it("returns fresh arrays (the relay's message is not shared with the battle)", () => {
    const out = cleanStartMsg(START, IDS)!;
    expect(out.hostDeck).not.toBe(START.hostDeck);
  });
});

describe("cleanStartMsg: loadouts are cleaned, never trusted", () => {
  it("strips markup and odd characters from names", () => {
    const out = start({
      hostLoadout: { ...START.hostLoadout, name: '<img src=x onerror="alert(1)">' },
      guestLoadout: { ...START.guestLoadout, name: "Bi‮lal\n<b>" },
    });
    expect(out?.hostLoadout?.name).toBe("img srcx one");
    expect(out?.guestLoadout?.name).toBe("Bilalb");
    for (const name of [out?.hostLoadout?.name, out?.guestLoadout?.name]) expect(name).toMatch(/^[\p{L}\p{N} _-]*$/u);
  });

  it("caps a long name at 12 characters, however long it came", () => {
    expect(start({ hostLoadout: { ...START.hostLoadout, name: "A".repeat(100_000) } })?.hostLoadout?.name).toBe("A".repeat(12));
    expect(start({ hostLoadout: { ...START.hostLoadout, name: "عمر".repeat(10) } })?.hostLoadout?.name).toHaveLength(12);
  });

  it("turns a name that is not text into no name", () => {
    for (const name of [null, 42, { toString: "x" }, ["Amal"], undefined]) {
      expect(start({ hostLoadout: { ...START.hostLoadout, name } })?.hostLoadout?.name).toBe("");
    }
  });

  it("puts a crest out of range (or not a whole number) back to the first", () => {
    for (const crest of [-1, CREST_COUNT, 99, 1.5, NaN, "3", null, "<svg>"]) {
      expect(start({ hostLoadout: { ...START.hostLoadout, crest } })?.hostLoadout?.crest, String(crest)).toBe(0);
    }
    expect(start({ hostLoadout: { ...START.hostLoadout, crest: CREST_COUNT - 1 } })?.hostLoadout?.crest).toBe(CREST_COUNT - 1);
  });

  it("swaps an unknown tower troop for the default and an unknown ability for none", () => {
    const out = start({ hostLoadout: { ...START.hostLoadout, tower: "dragon", ability: "nuke" } });
    expect(out?.hostLoadout).toEqual({ name: "Amal", crest: 3, tower: TOWER_TROOP_IDS[0], ability: null });
    expect(start({ hostLoadout: { ...START.hostLoadout, tower: ["princess"], ability: { id: "salvo" } } })?.hostLoadout).toMatchObject({
      tower: TOWER_TROOP_IDS[0],
      ability: null,
    });
    for (const ability of ABILITY_IDS) expect(start({ guestLoadout: { ...START.guestLoadout, ability } })?.guestLoadout?.ability).toBe(ability);
  });

  it("keeps a missing loadout missing; anything but an object is no loadout", () => {
    expect(start({ hostLoadout: null, guestLoadout: null })).toMatchObject({ hostLoadout: null, guestLoadout: null });
    for (const v of ["Amal", 7, true, [START.hostLoadout]]) expect(start({ hostLoadout: v })?.hostLoadout).toBeNull();
    expect(cleanLoadout({})).toEqual({ name: "", crest: 0, tower: TOWER_TROOP_IDS[0], ability: null });
  });
});

describe("cleanStartMsg: what the battle is built from must be exactly right", () => {
  const BROKEN: [string, Record<string, unknown>][] = [
    ["no role", { role: undefined }],
    ["an unknown role", { role: "spectator" }],
    ["a 7-card deck", { hostDeck: HOST_DECK.slice(0, 7) }],
    ["a 9-card deck", { guestDeck: [...GUEST_DECK, "knight"] }],
    ["a duplicate card", { hostDeck: [...HOST_DECK.slice(0, 7), "knight"] }],
    ["the per-device champion", { hostDeck: [...HOST_DECK.slice(0, 7), "champion"] }],
    ["an unknown card", { guestDeck: [...GUEST_DECK.slice(0, 7), "<script>"] }],
    ["a deck that is not a list", { hostDeck: "knight,archers" }],
    ["a card that is not text", { hostDeck: [...HOST_DECK.slice(0, 7), 7] }],
    ["no mode", { mode: undefined }],
    ["an elixir rate the relay refuses", { mode: { elixirRate: 1000, mirror: false } }],
    ["mirror that is not true/false", { mode: { elixirRate: 1, mirror: "yes" } }],
    ["crazy that is not true/false", { mode: { elixirRate: 1, mirror: false, crazy: 1 } }],
    ["a seed out of range", { mode: { elixirRate: 1, mirror: false, seed: 2 ** 31 } }],
    ["a negative seed", { mode: { elixirRate: 1, mirror: false, seed: -1 } }],
    ["a fractional seed", { mode: { elixirRate: 1, mirror: false, seed: 1.5 } }],
    ["a delay below the relay's range", { delay: MIN_INPUT_DELAY - 1 }],
    ["a delay above the relay's range", { delay: MAX_INPUT_DELAY + 1 }],
    ["a delay that is not a number", { delay: "4" }],
    ["a null delay", { delay: null }],
  ];
  for (const [label, over] of BROKEN) {
    it(`is broken with ${label}`, () => {
      expect(start(over)).toBeNull();
    });
  }

  it("is broken when it is not an object at all", () => {
    for (const v of [null, undefined, "start", 42, [START]]) expect(cleanStartMsg(v, IDS)).toBeNull();
  });

  it("only turns resuming off for a bad token or room code", () => {
    expect(start({ token: "<b>" })?.token).toBe("");
    expect(start({ token: 42 })?.token).toBe("");
    expect(start({ code: "<img>" })?.code).toBeNull();
    expect(start({ code: 7 })?.code).toBeNull();
    expect(start({ code: "lion042" })?.code).toBe("LION042");
  });
});

describe("the page's ranges match the relay's", () => {
  it("delay: rooms.ts never sends one outside MIN..MAX_INPUT_DELAY", () => {
    expect(DEFAULT_DELAY).toBe(DEFAULT_INPUT_DELAY);
    for (const [a, b] of [
      [0, 0],
      [1, 1],
      [50, 80],
      [400, 300],
      [5000, 9000],
    ]) {
      const d = inputDelay(a, b);
      expect(d).toBeGreaterThanOrEqual(MIN_INPUT_DELAY);
      expect(d).toBeLessThanOrEqual(MAX_INPUT_DELAY);
    }
    expect(inputDelay(0, 0)).toBe(MIN_INPUT_DELAY);
    expect(inputDelay(60_000, 60_000)).toBe(MAX_INPUT_DELAY);
  });

  it("grace: the relay's GRACE_SEC is the page's default", () => {
    expect(GRACE_SEC).toBe(DEFAULT_GRACE_SEC);
    expect(cleanGraceSec(GRACE_SEC)).toBe(GRACE_SEC);
    expect(cleanGraceSec("20")).toBe(DEFAULT_GRACE_SEC);
    expect(cleanGraceSec(NaN)).toBe(DEFAULT_GRACE_SEC);
    expect(cleanGraceSec(1e300)).toBe(MAX_GRACE_SEC);
    expect(cleanGraceSec(-5)).toBe(0);
    expect(cleanGraceSec(12.4)).toBe(12);
  });

  it("frames: what the relay accepted from one page, the other page accepts", () => {
    const frame = { tick: 40, side: "player", commands: [{ side: "player", cardId: "knight", x: 9, y: 20 }], ability: true, emotes: [0, 7] };
    const parsed = parseClientMsg(JSON.stringify({ t: "frame", frame }), IDS);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed || parsed.t !== "frame") return;
    expect(cleanFrame(parsed.frame, IDS)).toEqual(parsed.frame);
  });

  it("frames: bad emote ids, cards and shapes are refused", () => {
    const ok = { tick: 3, side: "enemy", commands: [] };
    expect(cleanFrame(ok, IDS)).toEqual(ok);
    for (const bad of [
      { ...ok, emotes: [8] },
      { ...ok, emotes: [-1] },
      { ...ok, emotes: ["length"] },
      { ...ok, emotes: [1.5] },
      { ...ok, emotes: "01" },
      { ...ok, side: "both" },
      { ...ok, tick: "3" },
      { ...ok, commands: [{ side: "enemy", cardId: "__proto__", x: 1, y: 1 }] },
      { ...ok, commands: "none" },
      null,
      "frame",
    ]) {
      expect(cleanFrame(bad, IDS), JSON.stringify(bad)).toBeNull();
    }
  });

  it("codes, tokens, syncs and refusals", () => {
    expect(cleanRoomCode("LION042")).toBe("LION042");
    expect(cleanRoomCode("lion-42")).toBe("LION-42");
    for (const bad of ["<b>LION</b>", "AB", "X".repeat(13), 42, null, "LION 42"]) expect(cleanRoomCode(bad)).toBeNull();
    expect(cleanToken(TOKEN)).toBe(TOKEN);
    expect(cleanToken(TOKEN.toUpperCase())).toBe("");
    expect(cleanSync(30, 0xffffffff)).toEqual({ tick: 30, checksum: 0xffffffff });
    expect(cleanSync("30", 1)).toBeNull();
    expect(cleanSync(30, -1)).toBeNull();
    expect(cleanErrorReason("room-full")).toBe("room-full");
    for (const bad of ["<b>hi</b>", "constructor", "", 42, null]) expect(cleanErrorReason(bad)).toBe("bad-message");
  });
});
