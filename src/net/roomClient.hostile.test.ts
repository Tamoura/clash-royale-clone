/**
 * A relay that misbehaves (or one a stranger runs) must not put its own text
 * on a kid's screen, or build the battle from a deck or mode the real relay
 * would refuse. Everything it sends is checked in roomClient.ts with the
 * rules in validate.ts; a broken start ends the link through the relay's own
 * "bad-message" refusal, which the lobby already explains.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCardOverrides, type CardId } from "../game/cards";
import { TOWER_TROOP_IDS } from "../game/towers";
import { failText } from "../ui/screens/lobby";
import { overlayCard } from "../ui/onlineOverlay";
import { GUEST, GUEST_DECK, HOST, HOST_DECK, MODE } from "./memRelay.testkit";
import { RoomClient, type NetSocket } from "./roomClient";
import { OnlineSession, SIM_DT, type MatchInfo } from "./session";

/** A socket the test plays the relay through: raw text in, sent messages recorded. */
class RelaySocket implements NetSocket {
  sent: { t: string }[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as { t: string });
  }
  close(): void {
    this.closed++;
    this.onclose?.();
  }
  open(): void {
    this.onopen?.();
  }
  /** The relay sends `msg` (an object is sent as JSON, a string as-is). */
  say(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
}

const TOKEN = "ab".repeat(16);
const HOSTILE_NAME = '<img src=x onerror="alert(1)">Owned';
const START = {
  t: "start",
  role: "guest",
  hostDeck: HOST_DECK,
  guestDeck: GUEST_DECK,
  mode: { ...MODE, seed: 99 },
  hostLoadout: { name: HOSTILE_NAME, crest: "<svg onload=alert(1)>", tower: "<b>tower</b>", ability: "javascript:alert(1)" },
  guestLoadout: { ...GUEST },
  delay: 5,
  token: TOKEN,
  code: "LION042",
};

/** Every string anywhere in `v`. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setCardOverrides(null);
});

describe("RoomClient facing a hostile relay", () => {
  function connected() {
    const sock = new RelaySocket();
    const client = new RoomClient(sock);
    const events: unknown[][] = [];
    client.onStart = (p) => events.push(["start", p]);
    client.onError = (r) => events.push(["error", r]);
    client.onClose = () => events.push(["close"]);
    client.onCreated = (c, t) => events.push(["created", c, t]);
    client.onFrame = (f) => events.push(["frame", f]);
    client.onPeerDropped = (g) => events.push(["dropped", g]);
    client.onPeerPaused = (p) => events.push(["paused", p]);
    client.onResumed = (f, s) => events.push(["resumed", f, s]);
    sock.open();
    return { sock, client, events };
  }

  it("cleans a start's loadouts: no markup, a real crest, tower and ability", () => {
    const { sock, events } = connected();
    sock.say(START);
    expect(events).toHaveLength(1);
    const [kind, p] = events[0] as ["start", { hostLoadout: unknown; guestLoadout: unknown }];
    expect(kind).toBe("start");
    expect(p.hostLoadout).toEqual({ name: "img srcx one", crest: 0, tower: TOWER_TROOP_IDS[0], ability: null });
    expect(p.guestLoadout).toEqual(GUEST);
    for (const s of strings(p)) expect(s).not.toMatch(/[<>"'=()]/);
  });

  it("ends the link with bad-message when a start's deck, role, mode or delay is broken", () => {
    const broken = [
      { ...START, hostDeck: ["knight"] },
      { ...START, guestDeck: [...GUEST_DECK.slice(0, 7), "<script>"] },
      { ...START, role: "admin" },
      { ...START, mode: { elixirRate: 99, mirror: false } },
      { ...START, delay: 0 },
      { ...START, delay: 1e9 },
    ];
    for (const msg of broken) {
      const { sock, events } = connected();
      sock.say(msg);
      expect(events).toEqual([["error", "bad-message"], ["close"]]);
      expect(sock.closed).toBeGreaterThan(0);
    }
  });

  it("ends the link when a resumed replays a broken start, and drops bad frames from a good one", () => {
    const bad = connected();
    bad.sock.say({ t: "resumed", frames: [], start: { ...START, hostDeck: "x" } });
    expect(bad.events).toEqual([["error", "bad-message"], ["close"]]);
    const noFrames = connected();
    noFrames.sock.say({ t: "resumed", frames: "lots", start: START });
    expect(noFrames.events).toEqual([["error", "bad-message"], ["close"]]);

    const good = connected();
    const ok = { tick: 9, side: "player", commands: [] };
    good.sock.say({ t: "resumed", frames: [ok, { ...ok, emotes: ["length"] }, null, { ...ok, tick: 10 }], start: START });
    const [kind, frames, start] = good.events[0] as ["resumed", unknown[], { hostLoadout: { name: string } }];
    expect(kind).toBe("resumed");
    expect(frames).toEqual([ok, { ...ok, tick: 10 }]);
    expect(start.hostLoadout.name).toBe("img srcx one");
  });

  it("refuses a room code that is not one (it would be shown in big letters)", () => {
    const { sock, events } = connected();
    sock.say({ t: "created", code: "<b>FREE GEMS</b>", token: TOKEN });
    expect(events).toEqual([["error", "bad-message"], ["close"]]);
    const ok = connected();
    ok.sock.say({ t: "created", code: "lion042", token: "not-a-token" });
    expect(ok.events).toEqual([["created", "LION042", ""]]);
  });

  it("turns an unknown refusal into bad-message, never its own words", () => {
    const { sock, events } = connected();
    sock.say({ t: "error", reason: "<h1>Send your password</h1>" });
    expect(events).toEqual([["error", "bad-message"]]);
  });

  it("drops frames with emote ids outside the glyph table, and bad numbers", () => {
    const { sock, client, events } = connected();
    const ok = { tick: 1, side: "enemy", commands: [] };
    sock.say({ t: "frame", frame: { ...ok, emotes: [99] } });
    sock.say({ t: "frame", frame: { ...ok, emotes: ["constructor"] } });
    sock.say({ t: "frame", frame: "<b>" });
    sock.say({ t: "frame", frame: { ...ok, emotes: [3] } });
    expect(events).toEqual([["frame", { ...ok, emotes: [3] }]]);
    // A grace that is not a number, a pause that is not true/false, a pong with no time.
    sock.say({ t: "peer-dropped", graceSec: "<b>forever</b>" });
    sock.say({ t: "peer-paused", paused: "<b>" });
    sock.say({ t: "pong", at: "<b>" });
    sock.say({ t: "pong", at: -1e300 });
    expect(events.slice(1)).toEqual([
      ["dropped", 20],
      ["paused", false],
    ]);
    expect(client.rtt).toBeNull();
  });

  it("shrugs off JSON that is not a message", () => {
    const { sock, events } = connected();
    for (const raw of ["null", "[]", "42", '"start"', '{"t":7}', "{}", '{"t":"start"}']) {
      expect(() => sock.say(raw)).not.toThrow();
    }
    // Only the last one names a known type, and a start with nothing in it is broken.
    expect(events).toEqual([["error", "bad-message"], ["close"]]);
  });
});

describe("OnlineSession facing a hostile relay", () => {
  function session() {
    const sockets: RelaySocket[] = [];
    const s = new OnlineSession({
      url: "wss://relay.invalid/ws",
      loadout: HOST,
      connect: () => {
        const sock = new RelaySocket();
        sockets.push(sock);
        return sock;
      },
      now: () => 0,
    });
    const matches: MatchInfo[] = [];
    s.onMatch = (m) => matches.push(m);
    return { s, sockets, matches };
  }

  it("shows the opponent's cleaned name, never the relay's raw text", () => {
    const { s, sockets, matches } = session();
    s.join("LION042", GUEST_DECK as CardId[]);
    sockets[0].open();
    sockets[0].say(START);
    expect(matches).toHaveLength(1);
    expect(s.opponent?.name).toBe("img srcx one");
    expect(matches[0].opponent).toEqual({ name: "img srcx one", crest: 0, tower: TOWER_TROOP_IDS[0], ability: null });
    for (const text of strings(matches[0].opponent)) expect(text).not.toContain("<");
    s.step(SIM_DT);
    s.leave();
  });

  it("a broken start fails the lobby with the existing friendly words", () => {
    const { s, sockets, matches } = session();
    s.create(HOST_DECK as CardId[], MODE);
    sockets[0].open();
    sockets[0].say({ t: "created", code: "LION042", token: TOKEN });
    sockets[0].say({ ...START, role: "host", hostDeck: ["<script>alert(1)</script>"] });
    expect(matches).toHaveLength(0);
    expect(s.view()).toEqual({ t: "failed", reason: "bad-message" });
    expect(failText("bad-message", "create")).toBe(failText("bad-message", "join"));
    expect(failText("bad-message", "create")).toMatch(/\S/);
    expect(sockets).toHaveLength(1); // no retry loop
  });

  it("an unknown refusal shows the friendly bad-message line, not the relay's words", () => {
    const { s, sockets } = session();
    s.join("LION042", GUEST_DECK as CardId[]);
    sockets[0].open();
    sockets[0].say({ t: "error", reason: "Type your parent's card number" });
    const v = s.view();
    expect(v).toEqual({ t: "failed", reason: "bad-message" });
    if (v.t === "failed") expect(failText(v.reason, "join")).not.toContain("card number");
  });

  it("a rematch start that is broken ends the match the usual way", () => {
    const { s, sockets, matches } = session();
    s.join("LION042", GUEST_DECK as CardId[]);
    sockets[0].open();
    sockets[0].say(START);
    expect(matches).toHaveLength(1);
    // The match ends; both ask for a rematch; the relay sends a broken start.
    s.battle!.result = { winner: "player", playerCrowns: 1, enemyCrowns: 0 };
    s.step(SIM_DT);
    expect(s.rematch()).toBe(true);
    sockets[0].say({ t: "rematch-wait" });
    sockets[0].say({ ...START, mode: { elixirRate: 1, mirror: false, seed: "<b>" } });
    expect(matches).toHaveLength(1);
    expect(s.view()).toEqual({ t: "ended", reason: "connection-lost" });
    const card = overlayCard(s.view(), "rematchWait", false);
    for (const text of strings(card)) expect(text).not.toContain("<");
  });

  it("a peer-dropped grace that is not a number still shows a countdown in seconds", () => {
    const { s, sockets } = session();
    s.join("LION042", GUEST_DECK as CardId[]);
    sockets[0].open();
    sockets[0].say(START);
    sockets[0].say({ t: "peer-dropped", graceSec: "<b>soon</b>" });
    expect(s.view()).toEqual({ t: "peerDropped", graceLeft: 20 });
    s.leave();
  });
});
