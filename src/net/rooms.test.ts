import { describe, expect, it } from "vitest";
import {
  GRACE_SEC,
  LOG_TICKS,
  MATCH_TTL_MS,
  QUEUE_TTL_MS,
  RoomHub,
  WAITING_TTL_MS,
  inputDelay,
  type HubDeps,
  type Outbound,
} from "./rooms";
import { makeCodeGen } from "./codewords";
import type { CardId } from "../game/cards";
import type { InputFrame } from "./lockstep";
import type { Loadout, ServerMsg, StartMsg } from "./protocol";

const DECK_A = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"] as CardId[];
const DECK_B = ["wizard", "witch", "skeletons", "gargoyles", "valkyrie", "hog-rider", "cannon", "zap"] as CardId[];
const MODE = { elixirRate: 1, mirror: false };
const V2 = { v: 2 };
const LOADOUT: Loadout = { name: "Sara", crest: 2, tower: "duchess", ability: "rally" };

/** Deterministic code generator for tests: LION, BEAR, WOLF... */
function codes(...seq: string[]): () => string {
  let i = 0;
  return () => seq[i++];
}

/** Small seeded PRNG so "random" hubs are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hub with a controllable clock and counting tokens/seeds. */
function makeHub(genCode: () => string, extra: Partial<HubDeps> = {}) {
  const clock = { t: 1_000_000 };
  let tokens = 0;
  let seeds = 100;
  const hub = new RoomHub(genCode, {
    now: () => clock.t,
    rng: mulberry32(7),
    token: () => (++tokens).toString(16).padStart(32, "0"),
    seed: () => ++seeds,
    ...extra,
  });
  return { hub, clock };
}

function msgFor(out: Outbound[], to: string): ServerMsg | undefined {
  return out.find((o) => o.to === to)?.msg;
}

function startFor(out: Outbound[], to: string): StartMsg {
  const m = msgFor(out, to);
  if (m?.t !== "start") throw new Error(`no start for ${to}: ${JSON.stringify(out)}`);
  return m;
}

const frame = (tick: number, side: InputFrame["side"] = "player", commands: InputFrame["commands"] = []): InputFrame => ({
  tick,
  side,
  commands,
});

/** A started v2 match LION42 between host1 and guest1. */
function match(extra: Partial<HubDeps> = {}) {
  const ctx = makeHub(codes("LION42"), extra);
  ctx.hub.create("host1", DECK_A, MODE, { ...V2, loadout: LOADOUT });
  const out = ctx.hub.join("guest1", "LION42", DECK_B, V2);
  return { ...ctx, start: { host: startFor(out, "host1"), guest: startFor(out, "guest1") } };
}

describe("RoomHub pairing", () => {
  it("hands the creator a room code and a private token", () => {
    const { hub } = makeHub(codes("LION42"));
    const out = hub.create("host1", DECK_A, MODE, V2);
    expect(out).toEqual([{ to: "host1", msg: { t: "created", code: "LION42", token: "1".padStart(32, "0") } }]);
  });

  it("starts the match for both players when the guest joins, each with only their own token", () => {
    const { start } = match();
    const common = {
      t: "start",
      hostDeck: DECK_A,
      guestDeck: DECK_B,
      mode: { ...MODE, seed: 101 },
      hostLoadout: LOADOUT,
      guestLoadout: null,
      delay: 4,
    };
    expect(start.host).toEqual({ ...common, role: "host", token: "1".padStart(32, "0") });
    expect(start.guest).toEqual({ ...common, role: "guest", token: "2".padStart(32, "0") });
  });

  it("issues real 128-bit hex tokens and seeds by default", () => {
    const hub = new RoomHub(codes("LION42"), { rng: mulberry32(3), now: () => 0 });
    const created = hub.create("h", DECK_A, MODE, V2)[0].msg;
    expect(created.t === "created" && created.token).toMatch(/^[0-9a-f]{32}$/);
    const s = startFor(hub.join("g", "LION42", DECK_B, V2), "g");
    expect(s.mode.seed).toBeGreaterThanOrEqual(0);
    expect(s.mode.seed).toBeLessThan(2 ** 31);
    expect(Number.isInteger(s.mode.seed)).toBe(true);
  });

  it("rejects joining an unknown code", () => {
    const { hub } = makeHub(codes("LION42"));
    const out = hub.join("guest1", "NOPE", DECK_B);
    expect(out).toEqual([{ to: "guest1", msg: { t: "error", reason: "no-such-room" } }]);
  });

  it("rejects joining a room that is already full", () => {
    const { hub } = match();
    const out = hub.join("guest2", "LION42", DECK_B);
    expect(out).toEqual([{ to: "guest2", msg: { t: "error", reason: "room-full" } }]);
  });

  it("gives v1 clients bare word codes their 5-letter code box can hold", () => {
    const { hub } = makeHub(codes("LION42"));
    expect(hub.create("host1", DECK_A, MODE)).toMatchObject([{ msg: { t: "created", code: "LION" } }]);
  });

  it("create() first leaves the connection's previous room", () => {
    const { hub } = makeHub(codes("LION42", "BEAR17"));
    hub.create("host1", DECK_A, MODE, V2);
    hub.create("host1", DECK_A, MODE, V2);
    expect(hub.stats().rooms).toBe(1);
    expect(hub.join("guest1", "LION42", DECK_B, V2)).toMatchObject([{ msg: { reason: "no-such-room" } }]);
  });
});

describe("RoomHub codes", () => {
  it("2,100 creates never loop (more rooms than WORD+2 digit codes exist)", () => {
    const rng = mulberry32(42);
    const { hub } = makeHub(makeCodeGen(rng), { rng });
    const seen = new Set<string>();
    for (let i = 0; i < 2100; i++) {
      const [o] = hub.create(`c${i}`, DECK_A, MODE, V2);
      if (o.msg.t !== "created") throw new Error("expected created");
      seen.add(o.msg.code);
      expect(o.msg.code).toMatch(/^[A-Z0-9-]{3,12}$/);
    }
    expect(seen.size).toBe(2100);
    expect(hub.stats().rooms).toBe(2100);
  });

  it("25 creates from one socket do not hang and leave a single room", () => {
    const { hub } = makeHub(() => "LION42");
    for (let i = 0; i < 25; i++) {
      expect(hub.create("spammer", DECK_A, MODE, V2)).toMatchObject([{ msg: { t: "created", code: "LION42" } }]);
    }
    expect(hub.stats().rooms).toBe(1);
  });

  it("retries code generation on collision", () => {
    const { hub } = makeHub(codes("LION42", "LION42", "BEAR17"));
    hub.create("host1", DECK_A, MODE, V2);
    const out = hub.create("host2", DECK_A, MODE, V2); // first pick LION42 collides → BEAR17
    expect(out).toMatchObject([{ to: "host2", msg: { t: "created", code: "BEAR17" } }]);
  });

  it("falls back to a base32 code after 10 collisions", () => {
    let calls = 0;
    const { hub } = makeHub(() => {
      calls++;
      return "LION42";
    });
    hub.create("host1", DECK_A, MODE, V2);
    expect(calls).toBe(1);
    const [o] = hub.create("host2", DECK_A, MODE, V2);
    expect(calls).toBe(11); // the first try + 10 retries, never more
    expect(o.msg.t === "created" && o.msg.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    // v1 fallbacks still fit the old 5-character code box.
    expect(hub.create("host3", DECK_A, MODE)).toMatchObject([{ msg: { code: "LION" } }]);
    const [legacy] = hub.create("host4", DECK_A, MODE);
    expect(legacy.msg.t === "created" && legacy.msg.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it("still terminates when even the fallback collides", () => {
    const { hub } = makeHub(() => "LION42", { rng: () => 0 });
    const got = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const [o] = hub.create(`c${i}`, DECK_A, MODE, V2);
      if (o.msg.t === "created") got.add(o.msg.code);
    }
    expect(got.size).toBe(5); // LION42, 000000, then serial codes
  });
});

describe("RoomHub frames", () => {
  it("relays a frame only to the peer, not back to the sender", () => {
    const { hub } = match();
    const f = frame(0, "player", [{ side: "player", cardId: "knight", x: 9, y: 20 }]);
    expect(hub.relayFrame("host1", f)).toEqual([{ to: "guest1", msg: { t: "frame", frame: f } }]);
  });

  it("rewrites a guest frame claiming side 'player' to 'enemy', commands too", () => {
    const { hub } = match();
    const out = hub.relayFrame("guest1", frame(0, "player", [{ side: "player", cardId: "wizard", x: 9, y: 10 }]));
    expect(out).toEqual([
      {
        to: "host1",
        msg: { t: "frame", frame: frame(0, "enemy", [{ side: "enemy", cardId: "wizard", x: 9, y: 10 }]) },
      },
    ]);
  });

  it("drops ticks outside [lastTick+1, lastTick+16] per side", () => {
    const { hub } = match();
    expect(hub.relayFrame("host1", frame(16))).toEqual([]); // first frame must be ≤ 15
    expect(hub.relayFrame("host1", frame(0))).toHaveLength(1);
    expect(hub.relayFrame("host1", frame(0))).toEqual([]); // duplicate
    expect(hub.relayFrame("host1", frame(17))).toEqual([]); // too far ahead
    expect(hub.relayFrame("host1", frame(16))).toHaveLength(1);
    expect(hub.relayFrame("host1", frame(3))).toEqual([]); // stale
    // The guest's window is independent of the host's.
    expect(hub.relayFrame("guest1", frame(0, "enemy"))).toHaveLength(1);
  });

  it("drops commands for cards outside the sender's deck and keeps flags", () => {
    const { hub } = match();
    const out = hub.relayFrame("host1", {
      tick: 0,
      side: "player",
      commands: [
        { side: "player", cardId: "pekka", x: 9, y: 20 },
        { side: "player", cardId: "giant", x: 9, y: 20 },
      ],
      ability: true,
      emotes: [2],
    });
    expect(msgFor(out, "guest1")).toEqual({
      t: "frame",
      frame: { tick: 0, side: "player", commands: [{ side: "player", cardId: "giant", x: 9, y: 20 }], ability: true, emotes: [2] },
    });
  });

  it("checks mirror-match guests against the host's deck", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, { elixirRate: 1, mirror: true }, V2);
    hub.join("guest1", "LION42", DECK_B, V2);
    const out = hub.relayFrame("guest1", frame(0, "enemy", [
      { side: "enemy", cardId: "wizard", x: 9, y: 10 },
      { side: "enemy", cardId: "knight", x: 9, y: 10 },
    ]));
    expect(msgFor(out, "host1")).toMatchObject({ frame: { commands: [{ cardId: "knight" }] } });
  });

  it("ignores frames before the match starts", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, MODE, V2);
    expect(hub.relayFrame("host1", frame(0))).toEqual([]);
    expect(hub.relayFrame("stranger", frame(0))).toEqual([]);
  });

  it("relays sync digests and pauses to the peer", () => {
    const { hub } = match();
    expect(hub.relaySync("guest1", 30, 12345)).toEqual([{ to: "host1", msg: { t: "sync", tick: 30, checksum: 12345 } }]);
    expect(hub.pause("host1", true)).toEqual([{ to: "guest1", msg: { t: "peer-paused", paused: true } }]);
  });
});

describe("RoomHub leaving", () => {
  it("tells the peer when someone leaves and frees the room", () => {
    const { hub } = makeHub(codes("LION42", "LION42"));
    hub.create("host1", DECK_A, MODE, V2);
    hub.join("guest1", "LION42", DECK_B, V2);
    const out = hub.leave("host1");
    expect(out).toEqual([{ to: "guest1", msg: { t: "peer-left" } }]);
    // Code is freed: a fresh create can reuse it, and the stale guest now has no peer.
    hub.create("host2", DECK_A, MODE, V2);
    expect(hub.relayFrame("guest1", frame(0, "enemy"))).toEqual([]);
  });

  it("ends a v1 match at once when a socket closes (no resume for old clients)", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, MODE);
    hub.join("guest1", "LION", DECK_B);
    expect(hub.drop("guest1")).toEqual([{ to: "host1", msg: { t: "peer-left" } }]);
    expect(hub.stats().rooms).toBe(0);
  });

  it("closing a waiting room's socket frees it", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, MODE, V2);
    expect(hub.drop("host1")).toEqual([]);
    expect(hub.stats().rooms).toBe(0);
  });
});

describe("RoomHub quick match", () => {
  it("pairs the first two players per mode, FIFO, and cancel removes an entry", () => {
    const { hub } = makeHub(codes("LION42", "BEAR17"));
    const triple = { elixirRate: 3, mirror: false };
    expect(hub.quick("a", DECK_A, MODE, { ...V2, loadout: LOADOUT })).toEqual([{ to: "a", msg: { t: "queued", position: 1 } }]);
    expect(hub.quick("b", DECK_B, triple, V2)).toEqual([{ to: "b", msg: { t: "queued", position: 1 } }]);
    expect(hub.quick("x", DECK_B, MODE, V2)).toHaveLength(2); // pairs with a
    expect(hub.stats()).toEqual({ rooms: 1, queue: 1 });

    expect(hub.cancel("b")).toEqual([]);
    expect(hub.stats().queue).toBe(0);
    expect(hub.quick("c", DECK_A, triple, V2)).toEqual([{ to: "c", msg: { t: "queued", position: 1 } }]);
    const out = hub.quick("d", DECK_B, triple, V2);
    const host = startFor(out, "c");
    const guest = startFor(out, "d");
    expect(host.role).toBe("host");
    expect(guest.role).toBe("guest");
    expect(host.mode).toEqual({ ...triple, seed: expect.any(Number) });
    expect(host.hostDeck).toEqual(DECK_A);
    expect(host.token).not.toBe(guest.token);
  });

  it("the first pair carries the earlier player's loadout as host", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.quick("a", DECK_A, MODE, { ...V2, loadout: LOADOUT });
    const s = startFor(hub.quick("b", DECK_B, MODE, V2), "b");
    expect(s.hostLoadout).toEqual(LOADOUT);
    expect(s.guestLoadout).toBeNull();
  });

  it("a second quick from the same socket does not pair it with itself", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.quick("a", DECK_A, MODE, V2);
    expect(hub.quick("a", DECK_A, MODE, V2)).toEqual([{ to: "a", msg: { t: "queued", position: 1 } }]);
    expect(hub.stats().queue).toBe(1);
  });

  it("cancel also closes a room nobody joined yet", () => {
    const { hub } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, MODE, V2);
    hub.cancel("host1");
    expect(hub.stats().rooms).toBe(0);
  });
});

describe("RoomHub rematch", () => {
  it("waits for both players, then restarts with a new seed, new tokens and a fresh log", () => {
    const { hub, start } = match();
    for (let t = 0; t < 10; t++) {
      hub.relayFrame("host1", frame(t));
      hub.relayFrame("guest1", frame(t, "enemy"));
    }
    expect(hub.rematch("host1")).toEqual([{ to: "host1", msg: { t: "rematch-wait" } }]);
    expect(hub.rematch("host1")).toEqual([{ to: "host1", msg: { t: "rematch-wait" } }]);
    const out = hub.rematch("guest1");
    const host = startFor(out, "host1");
    const guest = startFor(out, "guest1");
    expect(host.mode.seed).not.toBe(start.host.mode.seed);
    expect(host.token).not.toBe(start.host.token);
    expect(guest.token).not.toBe(start.guest.token);
    // Tick windows restart at 0 and the old log is gone.
    expect(hub.relayFrame("host1", frame(0))).toHaveLength(1);
    const resumed = hub.resume("host9", "LION42", host.token, -1);
    expect(msgFor(resumed, "host9")).toMatchObject({ t: "resumed", frames: [frame(0)] });
  });
});

describe("RoomHub drop and resume", () => {
  it("holds a dropped seat; a resume within the grace replays the log after haveTick", () => {
    const { hub, clock, start } = match();
    for (let t = 0; t < 8; t++) {
      hub.relayFrame("host1", frame(t));
      hub.relayFrame("guest1", frame(t, "enemy"));
    }
    expect(hub.drop("guest1")).toEqual([{ to: "host1", msg: { t: "peer-dropped", graceSec: GRACE_SEC } }]);
    // The host keeps sending while the guest is away; frames are logged, not delivered.
    expect(hub.relayFrame("host1", frame(8))).toEqual([]);
    clock.t += (GRACE_SEC - 1) * 1000;
    expect(hub.sweep(clock.t)).toEqual([]);

    const out = hub.resume("guest2", "LION42", start.guest.token, 5);
    const resumed = msgFor(out, "guest2");
    if (resumed?.t !== "resumed") throw new Error("expected resumed");
    expect(resumed.frames.map((f) => `${f.side}${f.tick}`)).toEqual([
      "player6", "enemy6", "player7", "enemy7", "player8",
    ]);
    expect(resumed.start).toEqual(start.guest);
    expect(msgFor(out, "host1")).toEqual({ t: "peer-back" });
    // The new socket now owns the guest seat, and its tick window carries on.
    expect(hub.relayFrame("guest2", frame(8, "enemy"))).toHaveLength(1);
    expect(hub.relayFrame("guest2", frame(3, "enemy"))).toEqual([]);
  });

  it("calls the match off with peer-left once the grace runs out", () => {
    const { hub, clock } = match();
    hub.drop("host1");
    clock.t += GRACE_SEC * 1000;
    expect(hub.sweep(clock.t)).toEqual([{ to: "guest1", msg: { t: "peer-left" } }]);
    expect(hub.stats().rooms).toBe(0);
  });

  it("refuses a resume with a wrong token, code, or after expiry", () => {
    const { hub, clock, start } = match();
    hub.drop("guest1");
    const fail = [{ to: "g2", msg: { t: "error", reason: "resume-failed" } }];
    expect(hub.resume("g2", "LION42", "f".repeat(32), 0)).toEqual(fail);
    expect(hub.resume("g2", "BEAR17", start.guest.token, 0)).toEqual(fail);
    clock.t += GRACE_SEC * 1000;
    hub.sweep(clock.t);
    expect(hub.resume("g2", "LION42", start.guest.token, 0)).toEqual(fail);
  });

  it("lets a resume take over a seat whose old socket has not been noticed dead yet", () => {
    const { hub, start } = match();
    const out = hub.resume("host2", "LION42", start.host.token, -1);
    expect(msgFor(out, "host2")?.t).toBe("resumed");
    expect(hub.relayFrame("host1", frame(0))).toEqual([]); // the stale socket is unbound
    expect(hub.relayFrame("host2", frame(0))).toHaveLength(1);
  });

  it("keeps only the recent frames a resume can need, however long a match runs", () => {
    const { hub, start } = match();
    const cmd = [{ cardId: "knight" as CardId, side: "player" as const, x: 9, y: 9 }];
    // A client flooding frames for 12 minutes' worth of ticks, peer silent.
    const total = 12 * 60 * 30;
    let longest = 0;
    for (let t = 0; t < total; t++) {
      hub.relayFrame("host1", frame(t, "player", cmd));
      longest = Math.max(longest, logSize(hub));
    }
    expect(longest).toBeLessThanOrEqual(3 * LOG_TICKS);
    hub.drop("guest1");
    // A resume from a tick the log no longer covers would miss frames.
    expect(msgFor(hub.resume("g2", "LION42", start.guest.token, -1), "g2")).toEqual({
      t: "error",
      reason: "resume-failed",
    });
    const out = hub.resume("g2", "LION42", start.guest.token, total - 10);
    const resumed = msgFor(out, "g2");
    if (resumed?.t !== "resumed") throw new Error("expected resumed");
    expect(resumed.frames.map((f) => f.tick)).toEqual([...Array(9)].map((_, i) => total - 9 + i));
  });
});

/** Frames held in the hub's only room (reaches past the private field for the memory bound). */
function logSize(hub: RoomHub): number {
  const rooms = (hub as unknown as { rooms: Map<string, { log: unknown[] }> }).rooms;
  return [...rooms.values()][0].log.length;
}

describe("RoomHub sweep", () => {
  it("expires waiting rooms after 10 minutes", () => {
    const { hub, clock } = makeHub(codes("LION42"));
    hub.create("host1", DECK_A, MODE, V2);
    expect(hub.sweep(clock.t + WAITING_TTL_MS - 1)).toEqual([]);
    expect(hub.sweep(clock.t + WAITING_TTL_MS)).toEqual([{ to: "host1", msg: { t: "error", reason: "expired" } }]);
    expect(hub.stats().rooms).toBe(0);
  });

  it("expires matches after 12 minutes", () => {
    const { hub, clock } = match();
    expect(hub.sweep(clock.t + MATCH_TTL_MS - 1)).toEqual([]);
    expect(hub.sweep(clock.t + MATCH_TTL_MS)).toEqual([
      { to: "host1", msg: { t: "error", reason: "expired" } },
      { to: "guest1", msg: { t: "error", reason: "expired" } },
    ]);
    expect(hub.stats().rooms).toBe(0);
  });

  it("expires quick-match queue entries after 2 minutes", () => {
    const { hub, clock } = makeHub(codes("LION42"));
    hub.quick("a", DECK_A, MODE, V2);
    expect(hub.sweep(clock.t + QUEUE_TTL_MS - 1)).toEqual([]);
    expect(hub.sweep(clock.t + QUEUE_TTL_MS)).toEqual([{ to: "a", msg: { t: "error", reason: "expired" } }]);
    expect(hub.stats().queue).toBe(0);
  });
});

describe("adaptive input delay", () => {
  it("is 3 ticks for 40ms RTTs, more for 200ms, clamped at 10, and 4 when unknown", () => {
    expect(inputDelay(40, 40)).toBe(3);
    expect(inputDelay(200, 200)).toBe(8);
    expect(inputDelay(200, 200)).toBeGreaterThan(inputDelay(40, 40));
    expect(inputDelay(2000, 900)).toBe(10);
    expect(inputDelay(0, 0)).toBe(3);
    expect(inputDelay(null, 40)).toBe(4);
  });

  it("uses the median of each player's last 5 pings", () => {
    const { hub } = makeHub(codes("LION42"));
    expect(hub.ping("h", 123)).toEqual([{ to: "h", msg: { t: "pong", at: 123 } }]);
    for (const rtt of [900, 200, 210, 190, 205, 195]) hub.ping("h", 0, rtt); // 900 falls out
    for (const rtt of [180, 5000, 200]) hub.ping("g", 0, rtt); // a spike barely moves the median
    expect(hub.rttOf("h")).toBe(200);
    expect(hub.rttOf("g")).toBe(200);
    hub.create("h", DECK_A, MODE, V2);
    expect(startFor(hub.join("g", "LION42", DECK_B, V2), "g").delay).toBe(8);
  });
});
