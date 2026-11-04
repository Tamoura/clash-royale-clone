/**
 * Online endings tell the truth: a forfeit is the forfeiter's loss (and the
 * match stays on screen for the app to settle as an online loss), the
 * other side wins and is told the opponent gave up, and an opponent who
 * closed the page or dropped is told apart from one who gave up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCardOverrides } from "../game/cards";
import { GRACE_SEC } from "./rooms";
import { GUEST, GUEST_DECK, HOST, HOST_DECK, MODE, MemRelay, MemSocket, pair, runUntil } from "./memRelay.testkit";
import { OnlineSession, SIM_DT } from "./session";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setCardOverrides(null);
});

/** Frames each socket sends from now on, by socket id. */
function watchFrames(): Map<string, number> {
  const sent = new Map<string, number>();
  const send = MemSocket.prototype.send;
  vi.spyOn(MemSocket.prototype, "send").mockImplementation(function (this: MemSocket, data: string) {
    if (data.includes('"t":"frame"')) sent.set(this.id, (sent.get(this.id) ?? 0) + 1);
    send.call(this, data);
  });
  return sent;
}

describe("forfeit online", () => {
  it("guest forfeit: the guest keeps its seat on screen and loses; the host wins, told they gave up", () => {
    const p = pair();
    runUntil(p, 20);
    p.guest.forfeit();
    p.relay.pump();
    // The match is still on screen for the app to settle: same seat, an online loss.
    expect(p.guest.inMatch).toBe(true);
    expect(p.guest.side).toBe("enemy");
    expect(p.guest.battle!.result?.winner).toBe("player");
    expect(p.guest.view()).toEqual({ t: "ended", reason: "forfeit" });
    expect(p.guest.battle!.events.some((e) => e.type === "finish" && e.winner === "player")).toBe(true);
    // The host wins at once and knows why.
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.host.opponentExit).toBe("gave-up");
    // Nobody can rematch a forfeited match; the room is closed on the relay.
    expect(p.guest.canRematch()).toBe(false);
    expect(p.host.canRematch()).toBe(false);
    expect(p.relay.hub.stats().rooms).toBe(0);
  });

  it("host forfeit: the enemy side wins on both screens", () => {
    const p = pair();
    runUntil(p, 20);
    p.host.forfeit();
    p.relay.pump();
    expect(p.host.inMatch).toBe(true);
    expect(p.host.side).toBe("player");
    expect(p.host.battle!.result?.winner).toBe("enemy");
    expect(p.guest.battle!.result?.winner).toBe("enemy");
    expect(p.guest.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.guest.opponentExit).toBe("gave-up");
  });

  it("the match leaves the screen only with leave()", () => {
    const p = pair();
    runUntil(p, 10);
    p.guest.forfeit();
    p.relay.pump();
    expect(p.guest.inMatch).toBe(true);
    p.guest.leave();
    expect(p.guest.inMatch).toBe(false);
    expect(p.guest.view()).toEqual({ t: "ended", reason: "forfeit" });
    p.guest.leave(); // twice is fine
    p.guest.forfeit(); // and so is a late forfeit
    expect(p.guest.view()).toEqual({ t: "ended", reason: "forfeit" });
  });

  it("nothing is sent after a forfeit and the sim stops", async () => {
    const p = pair();
    runUntil(p, 20);
    const sent = watchFrames();
    p.guest.forfeit();
    const tick = p.guest.tick;
    for (let i = 0; i < 60; i++) {
      p.frame();
      expect(p.guest.step(SIM_DT)).toBe(1);
    }
    await vi.advanceTimersByTimeAsync(30_000); // pings, resume timers…
    expect(sent.get("c2") ?? 0).toBe(0);
    expect(p.guest.tick).toBe(tick);
    const hand = p.guest.battle!.enemy.hand.cards;
    expect(p.guest.queueDeploy(hand[0], 9, 8)).toBe("not-playing");
    expect(p.guest.queueEmote(1)).toBe(false);
    expect(p.guest.queueAbility()).toBe(false);
    expect(p.relay.rejected).toEqual([]);
  });

  it("a forfeit before any match just leaves", () => {
    const relay = new MemRelay();
    const s = new OnlineSession({ url: "mem", loadout: HOST, connect: relay.connect, now: () => relay.clock });
    s.create(HOST_DECK, MODE);
    relay.pump();
    s.forfeit();
    relay.pump();
    expect(s.inMatch).toBe(false);
    expect(s.view()).toEqual({ t: "ended", reason: "left" });
    expect(relay.hub.stats().rooms).toBe(0);
  });
});

describe("how the opponent left", () => {
  it("a page that closes (paused, then left) reads as 'left', not 'gave up'", () => {
    const p = pair();
    runUntil(p, 20);
    p.guest.setPaused(true); // visibilitychange / pagehide
    p.guest.leave();
    p.relay.pump();
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.host.opponentExit).toBe("left");
  });

  it("a friend who drops past the grace leaves you the win, as 'left'", () => {
    const p = pair();
    runUntil(p, 20);
    p.relay.refuse = true; // the guest's page is gone for good
    [...p.relay.sockets.values()].find((s) => s.id === "c2")!.kill();
    p.relay.pump();
    expect(p.host.view().t).toBe("peerDropped");
    for (let i = 0; i < Math.ceil(GRACE_SEC / SIM_DT) + 30; i++) p.frame({ guest: false });
    p.relay.sweep();
    p.relay.pump();
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.host.opponentExit).toBe("left");
    expect(p.host.inMatch).toBe(true);
  });

  it("a friend who leaves after the match ends is 'left' too, and no rematch is offered", () => {
    const p = pair();
    runUntil(p, 5);
    for (const s of [p.host, p.guest]) s.battle!.result = { winner: "player", playerCrowns: 1, enemyCrowns: 0 };
    p.frame();
    expect(p.host.opponentExit).toBeNull();
    p.guest.leave();
    p.relay.pump();
    expect(p.host.view()).toEqual({ t: "ended", reason: "finished" });
    expect(p.host.opponentExit).toBe("left");
    expect(p.host.canRematch()).toBe(false);
  });
});

describe("quick match or friend", () => {
  it("knows which it was, for the opponent's name", () => {
    const relay = new MemRelay();
    const a = new OnlineSession({ url: "mem", loadout: HOST, connect: relay.connect, now: () => relay.clock });
    const b = new OnlineSession({ url: "mem", loadout: GUEST, connect: relay.connect, now: () => relay.clock });
    a.quick(HOST_DECK, MODE);
    b.quick(GUEST_DECK, MODE);
    relay.pump();
    expect(a.quickMatch).toBe(true);
    expect(b.quickMatch).toBe(true);
    const p = pair();
    expect(p.host.quickMatch).toBe(false);
    expect(p.guest.quickMatch).toBe(false);
  });
});
