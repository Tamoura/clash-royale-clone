/**
 * Rematch offers reach the other player: the relay tells the other seat
 * (peer-rematch), the client surfaces it, the session exposes it, and the
 * result screen turns it into a banner with its own Rematch button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardId } from "../game/cards";
import { setCardOverrides } from "../game/cards";
import { offerContent, opponentLeftBanner, overlayCard, resultOffer, resultRematchOpen } from "../ui/onlineOverlay";
import { pair, runUntil, type Pair } from "./memRelay.testkit";
import { PROTOCOL_VERSION, type Loadout, type MatchMode, type ServerMsg } from "./protocol";
import { RoomClient, type NetSocket } from "./roomClient";
import { RoomHub, type Outbound } from "./rooms";
import { stateChecksum } from "./checksum";
import indexHtml from "../../index.html?raw";
import resultSource from "../render3d/result.ts?raw";

const DECK_A = ["knight", "archers"] as CardId[];
const DECK_B = ["giant", "zap"] as CardId[];
const MODE: MatchMode = { elixirRate: 1, mirror: false };
const LOADOUT: Loadout = { name: "Sara", crest: 2, tower: "princess", ability: null };
const OPTS = { loadout: LOADOUT, v: PROTOCOL_VERSION };

function hubWithMatch(): { hub: RoomHub; clock: { t: number } } {
  const clock = { t: 0 };
  let n = 0;
  const hub = new RoomHub(() => "LION42", {
    now: () => clock.t,
    rng: () => 0.5,
    token: () => (++n).toString(16).padStart(32, "0"),
    seed: () => 7 + n,
  });
  hub.create("host1", DECK_A, MODE, OPTS);
  hub.join("guest1", "LION42", DECK_B, OPTS);
  return { hub, clock };
}

const kinds = (out: Outbound[]): string[] => out.map((o) => `${o.to}:${o.msg.t}`);

describe("relay: requestRematch", () => {
  it("tells the other seat, and keeps rematch-wait for the asker", () => {
    const { hub } = hubWithMatch();
    expect(kinds(hub.requestRematch("host1"))).toEqual(["host1:rematch-wait", "guest1:peer-rematch"]);
    // Asking again just repeats both (the guest may have missed it).
    expect(kinds(hub.requestRematch("host1"))).toEqual(["host1:rematch-wait", "guest1:peer-rematch"]);
    // The guest accepts: both get a new start, nobody gets an offer.
    expect(kinds(hub.requestRematch("guest1"))).toEqual(["host1:start", "guest1:start"]);
  });

  it("works from either seat", () => {
    const { hub } = hubWithMatch();
    expect(kinds(hub.requestRematch("guest1"))).toEqual(["guest1:rematch-wait", "host1:peer-rematch"]);
    expect(kinds(hub.requestRematch("host1"))).toEqual(["host1:start", "guest1:start"]);
  });

  it("offers nothing to a dropped seat, and the plain rematch() stays asker-only", () => {
    const { hub } = hubWithMatch();
    hub.drop("guest1");
    expect(kinds(hub.requestRematch("host1"))).toEqual(["host1:rematch-wait"]);
    const fresh = hubWithMatch().hub;
    expect(kinds(fresh.rematch("host1"))).toEqual(["host1:rematch-wait"]);
  });

  it("ignores a connection with no room", () => {
    const { hub } = hubWithMatch();
    expect(hub.requestRematch("stranger")).toEqual([]);
  });
});

class FakeSocket implements NetSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
  emit(msg: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe("client: onPeerRematch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires on peer-rematch, separately from rematch-wait", () => {
    const sock = new FakeSocket();
    const client = new RoomClient(sock);
    const calls: string[] = [];
    client.onPeerRematch = () => calls.push("peer");
    client.onRematchWait = () => calls.push("wait");
    sock.onopen?.();
    sock.emit({ t: "peer-rematch" });
    sock.emit({ t: "rematch-wait" });
    expect(calls).toEqual(["peer", "wait"]);
  });
});

/** Finish the current match identically on both peers. */
function finish(p: Pair): void {
  runUntil(p, 5);
  for (const s of [p.host, p.guest]) s.battle!.result = { winner: "player", playerCrowns: 1, enemyCrowns: 0 };
  p.frame();
}

describe("session: the other player's rematch offer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setCardOverrides(null);
  });

  it("reaches the other screen at once, and accepting it starts the rematch on both", () => {
    const p = pair();
    finish(p);
    expect(p.guest.peerWantsRematch).toBe(false);
    expect(p.host.rematch()).toBe(true);
    p.relay.pump();
    expect(p.host.view().t).toBe("rematchWait");
    expect(p.host.peerWantsRematch).toBe(false);
    expect(p.guest.peerWantsRematch).toBe(true);
    expect(p.guest.view()).toEqual({ t: "ended", reason: "finished" });
    expect(resultOffer({ view: p.guest.view(), peerWantsRematch: p.guest.peerWantsRematch, opponentExit: p.guest.opponentExit })).toBe("rematch");
    expect(p.guest.rematch()).toBe(true);
    p.relay.pump();
    expect(p.matches.host).toHaveLength(2);
    expect(p.matches.guest).toHaveLength(2);
    expect(p.guest.peerWantsRematch).toBe(false);
    expect(p.host.view().t).toBe("playing");
    runUntil(p, 30);
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
  });

  it("is withdrawn when the asker leaves; the result says they left", () => {
    const p = pair();
    finish(p);
    p.host.rematch();
    p.relay.pump();
    expect(p.guest.peerWantsRematch).toBe(true);
    p.host.leave();
    p.relay.pump();
    expect(p.guest.peerWantsRematch).toBe(false);
    expect(p.guest.canRematch()).toBe(false);
    expect(resultOffer({ view: p.guest.view(), peerWantsRematch: false, opponentExit: p.guest.opponentExit })).toBe("left");
  });
});

describe("result line", () => {
  const ended = (reason: "finished" | "opponent-left" | "forfeit" | "desync") => ({ t: "ended", reason }) as const;

  it("picks the offer, the gave-up and the left lines", () => {
    expect(resultOffer({ view: { t: "playing" }, peerWantsRematch: true, opponentExit: null })).toBe("none");
    expect(resultOffer({ view: ended("finished"), peerWantsRematch: false, opponentExit: null })).toBe("none");
    expect(resultOffer({ view: ended("finished"), peerWantsRematch: true, opponentExit: null })).toBe("rematch");
    expect(resultOffer({ view: ended("finished"), peerWantsRematch: false, opponentExit: "left" })).toBe("left");
    expect(resultOffer({ view: ended("opponent-left"), peerWantsRematch: false, opponentExit: "gave-up" })).toBe("gave-up");
    expect(resultOffer({ view: ended("opponent-left"), peerWantsRematch: false, opponentExit: "left" })).toBe("left");
    // The forfeiter's own result offers a new game; no-contest endings say nothing here.
    expect(resultOffer({ view: ended("forfeit"), peerWantsRematch: false, opponentExit: null })).toBe("forfeit");
    expect(resultOffer({ view: ended("desync"), peerWantsRematch: false, opponentExit: null })).toBe("none");
    // A finished match whose room is gone (no rematch possible, nobody left it).
    expect(resultOffer({ view: ended("finished"), peerWantsRematch: false, opponentExit: null, canRematch: false })).toBe("closed");
    expect(resultOffer({ view: ended("finished"), peerWantsRematch: false, opponentExit: null, canRematch: true })).toBe("none");
    expect(resultOffer({ view: ended("forfeit"), peerWantsRematch: false, opponentExit: null, canRematch: false })).toBe("forfeit");
  });

  it("names a friend or a quick-match opponent, with the right button", () => {
    // Node tests run the Golden Age edition (theme.ts), so tr() gives the Arabic.
    expect(offerContent("rematch", false)).toMatchObject({
      text: "صديقك يريد مباراة ثأرية! اضغط «مباراة ثأرية»",
      button: "مباراة ثأرية",
      action: "rematch",
    });
    expect(offerContent("rematch", true)?.text).toBe("خصمك يريد مباراة ثأرية! اضغط «مباراة ثأرية»");
    expect(offerContent("left", false)).toMatchObject({ text: "غادر صديقك المباراة", button: "ابحث عن مباراة جديدة", action: "lobby" });
    expect(offerContent("left", true)?.text).toBe("غادر خصمك المباراة");
    expect(offerContent("gave-up", false)).toMatchObject({ text: "استسلم خصمك", action: "lobby" });
    expect(offerContent("forfeit", false)).toMatchObject({ text: "استسلمت في هذه المباراة", icon: "flag", action: "lobby" });
    expect(offerContent("closed", false)).toMatchObject({ text: "أُغلقت غرفة اللعب هذه", button: "ابحث عن مباراة جديدة", action: "lobby" });
    expect(offerContent("none", false)).toBeNull();
  });
});

describe("result: the result screen's own Rematch button", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setCardOverrides(null);
  });
  const open = (s: Pair["host"]): boolean => resultRematchOpen({ view: s.view(), canRematch: s.canRematch() });

  it("stays while a rematch can happen, and while ours waits", () => {
    const p = pair();
    finish(p);
    expect(open(p.host)).toBe(true);
    expect(open(p.guest)).toBe(true);
    p.host.rematch();
    p.relay.pump();
    expect(p.host.view().t).toBe("rematchWait");
    expect(open(p.host)).toBe(true);
    expect(open(p.guest)).toBe(true);
  });

  it("steps aside once the other player has left after the match", () => {
    const p = pair();
    finish(p);
    p.host.leave();
    p.relay.pump();
    expect(open(p.guest)).toBe(false);
    // ...and the line above carries the way to a new game.
    expect(offerContent(resultOffer({ view: p.guest.view(), peerWantsRematch: false, opponentExit: p.guest.opponentExit }), false)?.action).toBe("lobby");
  });

  it("steps aside when our own room link closes after the match, and the line offers a new game", () => {
    const p = pair();
    finish(p);
    expect(open(p.host)).toBe(true);
    // The host's socket dies while the result is up (relay restart, room expiry).
    [...p.relay.sockets.values()].find((s) => s.id === "c1")!.kill();
    p.relay.pump();
    expect(open(p.host)).toBe(false);
    expect(p.host.opponentExit).toBeNull();
    const line = resultOffer({
      view: p.host.view(),
      peerWantsRematch: p.host.peerWantsRematch,
      opponentExit: p.host.opponentExit,
      canRematch: p.host.canRematch(),
    });
    expect(line).toBe("closed");
    expect(offerContent(line, p.host.quickMatch)).toMatchObject({ action: "lobby", button: "ابحث عن مباراة جديدة" });
  });

  it("steps aside on both screens after a forfeit, each with Find a new game", () => {
    const p = pair();
    runUntil(p, 20);
    p.guest.forfeit();
    p.relay.pump();
    for (const s of [p.host, p.guest]) {
      expect(open(s)).toBe(false);
      const line = resultOffer({ view: s.view(), peerWantsRematch: s.peerWantsRematch, opponentExit: s.opponentExit });
      expect(offerContent(line, s.quickMatch)).toMatchObject({ action: "lobby", button: "ابحث عن مباراة جديدة" });
    }
    expect(resultOffer({ view: p.host.view(), peerWantsRematch: false, opponentExit: p.host.opponentExit })).toBe("gave-up");
    expect(resultOffer({ view: p.guest.view(), peerWantsRematch: false, opponentExit: null })).toBe("forfeit");
  });

  it("is hidden by online.css using result.ts's own class names", () => {
    // online.css (#overlay .res-panel:has(.oo-offer[data-rematch="no"])
    // .res-again / .res-pair) reaches into the result panel, which is
    // render3d/result.ts, another package's file: fail loudly here if those
    // names ever change. (CSS reads as "" under vitest, so the rule itself
    // is checked in the browser.)
    const [result, html] = [resultSource, indexHtml];
    expect(result).toContain('el("div", "res-panel")');
    expect(result).toContain('el("div", "res-pair")');
    expect(result).toContain('again.classList.add("res-again")');
    expect(result).toMatch(/pair\.append\(again, ok\)/);
    expect(html).toContain('<div id="overlay">');
  });
});

describe("friend or opponent: the overlay's words", () => {
  it("names a friend in friend games and an opponent in quick match", () => {
    const wait = { t: "rematchWait" } as const;
    expect(overlayCard(wait, "ended", false)?.body).toBe("يجب أن يضغط صديقك «مباراة ثأرية» أيضًا.");
    expect(overlayCard(wait, "ended", true)?.body).toBe("يجب أن يضغط خصمك «مباراة ثأرية» أيضًا.");
    const left = { t: "ended", reason: "opponent-left" } as const;
    expect(overlayCard(left, "rematchWait", false)?.title).toBe("غادر صديقك");
    expect(overlayCard(left, "rematchWait", true)?.title).toBe("غادر خصمك");
    expect(opponentLeftBanner("left", false)).toBe("غادر صديقك — لقد فزت!");
    expect(opponentLeftBanner(null, false)).toBe("غادر صديقك — لقد فزت!");
    expect(opponentLeftBanner("left", true)).toBe("غادر خصمك — لقد فزت!");
    // Forfeit reads "opponent" in both (the spec's "Your opponent gave up", like the result line).
    expect(opponentLeftBanner("gave-up", false)).toBe("استسلم خصمك — لقد فزت!");
    expect(opponentLeftBanner("gave-up", true)).toBe("استسلم خصمك — لقد فزت!");
  });

  it("calls the Rematch button by its own name", () => {
    // The waiting card tells the other player to tap the button the result shows.
    const button = offerContent("rematch", false)!.button;
    expect(overlayCard({ t: "rematchWait" }, "ended", false)?.body).toContain(`«${button}»`);
    expect(overlayCard({ t: "rematchWait" }, "ended", true)?.body).toContain(`«${button}»`);
    expect(offerContent("rematch", false)!.text).toContain(`«${button}»`);
  });
});
