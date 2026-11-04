import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARDS, crazyCards, getCard, setCardOverrides, type CardId } from "../game/cards";
import { stateChecksum } from "./checksum";
import { GUEST, GUEST_DECK, HOST, HOST_DECK, MODE, MemRelay, pair, runUntil } from "./memRelay.testkit";
import { EMOTE_GAP_MS, OnlineSession, RESUME_BACKOFF_MS, RESUME_DEADLINE_MS, SIM_DT, STALL_LIMIT_MS, mulberry32 } from "./session";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setCardOverrides(null);
});

describe("OnlineSession start", () => {
  it("builds the same battle on both peers with each side's loadout", () => {
    const p = pair();
    expect(p.host.view().t).toBe("playing");
    expect(p.guest.view().t).toBe("playing");
    expect(p.host.side).toBe("player");
    expect(p.guest.side).toBe("enemy");
    expect(p.matches.host[0].opponent?.name).toBe("Bilal");
    expect(p.matches.guest[0].opponent?.name).toBe("Amal");
    const hb = p.host.battle!;
    expect(hb.player.ability).toBe("salvo");
    expect(hb.enemy.ability).toBe("restore");
    expect(stateChecksum(hb)).toBe(stateChecksum(p.guest.battle!));
    runUntil(p, 90);
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
  });

  it("scrambles Crazy cards identically from the relay seed", () => {
    const a = crazyCards(mulberry32(77));
    const b = crazyCards(mulberry32(77));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const p = pair({ elixirRate: 1, mirror: false, crazy: true });
    expect(p.matches.host[0].mode.crazy).toBe(true);
    // Both peers share this module's override; it must be the seeded scramble.
    const seeded = crazyCards(mulberry32(1234));
    expect(JSON.stringify(getCard("knight"))).toBe(JSON.stringify(seeded.knight));
  });

  it("keeps the stock scramble independent of the player's champion design", () => {
    const champ = CARDS.champion;
    const saved = structuredClone(champ);
    const a = crazyCards(mulberry32(5));
    Object.assign(champ, { kind: "spell", damage: 999, radius: 3 });
    const b = crazyCards(mulberry32(5));
    Object.assign(champ, saved);
    for (const id of Object.keys(a) as CardId[]) {
      if (id !== "champion") expect(JSON.stringify(b[id])).toBe(JSON.stringify(a[id]));
    }
  });
});

describe("pending spend", () => {
  it("never queues the same card twice or more elixir than is unreserved", () => {
    const p = pair();
    const b = p.host.battle!;
    const hand = b.player.hand.cards;
    expect(b.player.elixir.amount).toBe(5);
    const giant = hand.find((id) => id === "giant") ?? hand[0];
    expect(p.host.queueDeploy(giant, 9, 24)).toBe("ok");
    expect(p.host.queueDeploy(giant, 9, 24)).toBe("pending");
    expect(p.host.reserved()).toBe(getCard(giant).cost);
    const other = hand.find((id) => id !== giant && getCard(id).cost > 5 - getCard(giant).cost)!;
    expect(p.host.queueDeploy(other, 9, 24)).toBe("no-elixir");
    // Once the deploy executes, the reservation is spent and released.
    runUntil(p, 12);
    expect(p.host.reserved()).toBe(0);
    expect(b.player.hand.cards).not.toContain(giant);
    expect(stateChecksum(b)).toBe(stateChecksum(p.guest.battle!));
  });

  it("refuses a second ability while the first is in flight", () => {
    const p = pair();
    p.host.battle!.player.abilityCharge = 1;
    p.guest.battle!.player.abilityCharge = 1;
    expect(p.host.queueAbility()).toBe(true);
    expect(p.host.queueAbility()).toBe(false);
  });
});

describe("abilities online", () => {
  it("apply on the same tick on both peers", () => {
    const p = pair();
    runUntil(p, 10);
    // Charge both kings identically on both sims (no sim divergence).
    for (const s of [p.host, p.guest]) {
      s.battle!.player.abilityCharge = 1;
      s.battle!.enemy.abilityCharge = 1;
    }
    expect(p.host.queueAbility()).toBe(true);
    expect(p.guest.queueAbility()).toBe(true);
    const firedAt = { host: { player: -1, enemy: -1 }, guest: { player: -1, enemy: -1 } };
    for (let i = 0; i < 40; i++) {
      p.frame();
      for (const [who, s] of [["host", p.host], ["guest", p.guest]] as const) {
        for (const side of ["player", "enemy"] as const) {
          if (firedAt[who][side] < 0 && s.battle![side].abilityCharge < 1) firedAt[who][side] = s.tick;
        }
      }
    }
    expect(firedAt.host.player).toBeGreaterThan(10);
    expect(firedAt.host).toEqual(firedAt.guest);
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
  });
});

describe("emotes", () => {
  it("land on both peers and are throttled", () => {
    const p = pair();
    const seen: string[] = [];
    p.host.onEmote = (side, e) => seen.push(`host:${side}:${e}`);
    p.guest.onEmote = (side, e) => seen.push(`guest:${side}:${e}`);
    expect(p.host.queueEmote(2)).toBe(true);
    expect(p.host.queueEmote(3)).toBe(false);
    runUntil(p, 20);
    expect(seen.sort()).toEqual(["guest:player:2", "host:player:2"]);
    p.relay.clock += EMOTE_GAP_MS;
    expect(p.host.queueEmote(3)).toBe(true);
  });
});

describe("stalls", () => {
  it("are not counted while a slow device keeps making progress", () => {
    const p = pair();
    // 4 fps: every frame runs several ticks and uses up all the peer's input.
    for (let i = 0; i < 4 * 40; i++) {
      p.relay.clock += 250;
      p.host.step(0.25);
      p.guest.step(0.25);
      p.relay.pump();
    }
    expect(p.host.view().t).not.toBe("ended");
    expect(p.guest.view().t).not.toBe("ended");
    // Slow, but moving: lockstep runs at most `delay` ticks per peer frame.
    expect(p.host.tick).toBeGreaterThan(500);
  });

  it("end as opponent-left (a win) after 25 s without the peer", () => {
    const p = pair();
    runUntil(p, 30);
    const frames = Math.ceil(STALL_LIMIT_MS / 1000 / SIM_DT);
    let lastView = "";
    for (let i = 0; i < frames - 15; i++) p.frame({ guest: false });
    lastView = p.host.view().t;
    expect(lastView).toBe("stalled");
    for (let i = 0; i < 30; i++) p.frame({ guest: false });
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.host.canRematch()).toBe(false);
  });
});

describe("command cap", () => {
  it("never puts more than 3 deploys in one frame, even through a stall", () => {
    const p = pair(MODE, ["skeletons", "bats", "knight", "archers", "arrows", "zap", "cannon", "mini-pekka"]);
    runUntil(p, 10);
    // Stall the host (the guest stops answering), then tap 4 cheap cards on
    // 4 render frames before the next outgoing frame is produced.
    expect(p.host.tick).toBe(p.guest.tick);
    for (const s of [p.host, p.guest]) {
      // Same state on both sims at the same tick, so they stay in step.
      (s.battle!.player.elixir as { amount: number }).amount = 10;
    }
    for (let i = 0; i < 12; i++) p.frame({ guest: false }); // the host runs dry
    expect(p.host.view().t).toBe("stalled");
    const hand = [...p.host.battle!.player.hand.cards];
    const taps = hand.map((id, i) => {
      p.frame({ guest: false });
      return p.host.queueDeploy(id as CardId, 5 + i, 22);
    });
    expect(taps.filter((v) => v === "ok").length).toBeLessThanOrEqual(3);
    expect(taps).toContain("busy");
    for (let i = 0; i < 40; i++) p.frame();
    expect(p.host.queueDeploy(hand[3], 8, 22)).toBe("ok");
    for (let i = 0; i < 40; i++) p.frame();
    expect(p.relay.rejected).toEqual([]);
    while (p.host.tick !== p.guest.tick) p.frame(p.host.tick < p.guest.tick ? { guest: false } : { host: false });
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
  });
});

describe("dead sockets", () => {
  it("drops a silent socket and resumes on a fresh one", () => {
    const p = pair();
    runUntil(p, 20);
    const before = p.relay.connects.length;
    p.relay.muted.add("c2"); // the guest hears nothing; no close is ever reported
    const seen = new Set<string>();
    const tickAtMute = p.guest.tick;
    for (let i = 0; i < Math.ceil(15000 / (SIM_DT * 1000)); i++) {
      p.frame();
      seen.add(p.guest.view().t);
    }
    // Nothing was dropped before the silence limit, and then it resumed.
    expect(p.relay.connects.length).toBe(before + 1);
    expect(seen.has("reconnecting")).toBe(true);
    expect(p.guest.view().t).not.toBe("ended");
    expect(p.host.view().t).not.toBe("ended");
    expect(p.guest.tick).toBeGreaterThan(tickAtMute);
    expect(p.relay.rejected).toEqual([]);
  });
});

describe("resume", () => {
  it("retries with the backoff schedule, then gives up", async () => {
    const p = pair();
    runUntil(p, 20);
    const sock = [...p.relay.sockets.values()].find((s) => s.id === "c2")!; // the guest's
    p.relay.refuse = true;
    const t0 = Date.now();
    p.relay.connects = [];
    sock.kill();
    expect(p.guest.view()).toEqual({ t: "reconnecting", attempt: 1 });
    let elapsed = 0;
    for (const [i, delay] of RESUME_BACKOFF_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(p.relay.connects.length).toBe(i);
      await vi.advanceTimersByTimeAsync(1);
      elapsed += delay;
      expect(p.relay.connects.length).toBe(i + 1);
      expect(p.relay.connects[i] - t0).toBe(elapsed);
    }
    expect(RESUME_BACKOFF_MS).toEqual([500, 1000, 2000, 3000, 4000]);
    expect(elapsed).toBeLessThan(RESUME_DEADLINE_MS);
    expect(p.guest.view()).toEqual({ t: "ended", reason: "connection-lost" });
  });

  it("shows the peer reconnecting, then fast-forwards to identical checksums", async () => {
    const p = pair();
    const plays: [number, "host" | "guest", CardId, number, number][] = [
      [5, "host", "knight", 6, 24],
      [12, "guest", "skeletons", 9, 9],
      [40, "host", "archers", 12, 25],
      [70, "guest", "valkyrie", 6, 8],
    ];
    const play = (frameNo: number): void => {
      for (const [at, who, card, x, y] of plays) {
        if (at !== frameNo) continue;
        const s = who === "host" ? p.host : p.guest;
        const hand = (who === "host" ? s.battle!.player : s.battle!.enemy).hand.cards;
        s.queueDeploy(hand.includes(card) ? card : hand[0], x, y);
      }
    };
    for (let i = 0; i < 50; i++) {
      play(i);
      p.frame();
    }
    const guestSock = [...p.relay.sockets.values()].find((s) => s.id === "c2")!;
    guestSock.kill();
    p.relay.pump();
    expect(p.host.view().t).toBe("peerDropped");
    expect(p.guest.view().t).toBe("reconnecting");
    // Both keep rendering while the link is down; neither can advance far.
    for (let i = 50; i < 60; i++) {
      play(i);
      p.frame();
    }
    const stuckAt = p.host.tick;
    await vi.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[0]);
    p.relay.pump();
    p.frame();
    // Back in the match: at most a sub-tick wait on the peer, which the UI
    // only shows after 400 ms.
    for (const s of [p.host, p.guest]) {
      const v = s.view();
      expect(["playing", "stalled"]).toContain(v.t);
      if (v.t === "stalled") expect(v.ms).toBeLessThan(400);
    }
    for (let i = 60; i < 200; i++) {
      play(i);
      p.frame();
    }
    expect(p.host.tick).toBeGreaterThan(stuckAt + 100);
    // Line both sims up on the same tick and compare.
    while (p.host.tick !== p.guest.tick) {
      if (p.host.tick < p.guest.tick) p.frame({ guest: false });
      else p.frame({ host: false });
    }
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
    expect(p.host.view().t).not.toBe("ended");
    expect(p.guest.view().t).not.toBe("ended");
  });
});

describe("symmetric stalls", () => {
  it("do not make both players the winner", () => {
    const p = pair();
    runUntil(p, 30);
    // Neither side hears the other (frames never arrive) for 25 s.
    const hold = p.relay.hub;
    expect(hold).toBeDefined();
    const frames = Math.ceil((STALL_LIMIT_MS + 4000) / 1000 / SIM_DT) + 30;
    for (let i = 0; i < frames; i++) {
      p.relay.clock += SIM_DT * 1000;
      vi.advanceTimersByTime(SIM_DT * 1000);
      p.host.step(SIM_DT);
      p.guest.step(SIM_DT);
      // Drop their frames in transit; keep everything else flowing.
      p.relay.inbox = p.relay.inbox.filter((m) => m.data === null || !m.data.includes('"t":"frame"'));
      p.relay.pump();
    }
    const results = [p.host, p.guest].map((s) => s.battle!.result?.winner ?? null);
    expect(results.filter((w) => w !== null).length).toBeLessThanOrEqual(1);
    const reasons = [p.host, p.guest].map((s) => s.view());
    expect(reasons.every((v) => v.t === "ended")).toBe(true);
  });

  it("a page that was hidden when the peer gave up is not the winner", () => {
    const p = pair();
    runUntil(p, 30);
    p.guest.setPaused(true);
    for (let i = 0; i < Math.ceil((STALL_LIMIT_MS + 4000) / 1000 / SIM_DT) + 30; i++) {
      p.relay.clock += SIM_DT * 1000;
      vi.advanceTimersByTime(SIM_DT * 1000);
      p.host.step(SIM_DT); // the hidden guest does not step
      p.relay.pump();
    }
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.guest.view()).toEqual({ t: "ended", reason: "no-contest" });
    expect(p.guest.battle!.result).toBeNull();
  });
});

describe("match end", () => {
  it("rematches only after both ask, with a fresh battle", () => {
    const p = pair();
    runUntil(p, 5);
    for (const s of [p.host, p.guest]) {
      const b = s.battle!;
      b.result = { winner: "player", playerCrowns: 3, enemyCrowns: 0 };
    }
    p.frame();
    expect(p.host.view()).toEqual({ t: "ended", reason: "finished" });
    expect(p.host.rematch()).toBe(true);
    p.relay.pump();
    expect(p.host.view().t).toBe("rematchWait");
    expect(p.guest.rematch()).toBe(true);
    p.relay.pump();
    expect(p.matches.host).toHaveLength(2);
    expect(p.matches.guest[1].round).toBe(2);
    expect(p.host.battle!.result).toBeNull();
    runUntil(p, 30);
    expect(stateChecksum(p.host.battle!)).toBe(stateChecksum(p.guest.battle!));
  });

  it("calls a checksum mismatch no contest on both sides", () => {
    const p = pair();
    runUntil(p, 10);
    p.guest.battle!.enemy.crowns = 1; // corrupt one sim
    runUntil(p, 45);
    expect(p.host.view()).toEqual({ t: "ended", reason: "desync" });
    expect(p.guest.view()).toEqual({ t: "ended", reason: "desync" });
    expect(p.host.battle!.result).toBeNull();
  });

  it("leaving tells the peer, who wins", () => {
    const p = pair();
    runUntil(p, 10);
    p.guest.leave();
    p.relay.pump();
    expect(p.guest.view()).toEqual({ t: "ended", reason: "left" });
    expect(p.host.view()).toEqual({ t: "ended", reason: "opponent-left" });
    expect(p.host.battle!.result?.winner).toBe("player");
    expect(p.relay.sockets.size).toBe(0);
  });

  it("forfeiting records a loss for the forfeiter", () => {
    const p = pair();
    runUntil(p, 10);
    p.host.forfeit();
    p.relay.pump();
    expect(p.host.battle!.result?.winner).toBe("enemy");
    expect(p.host.view()).toEqual({ t: "ended", reason: "forfeit" });
    expect(p.guest.battle!.result?.winner).toBe("enemy");
  });
});

describe("quick match", () => {
  it("pairs two players and hands both the room code for resuming", () => {
    const relay = new MemRelay();
    const a = new OnlineSession({ url: "mem", loadout: HOST, connect: relay.connect, now: () => relay.clock });
    const b = new OnlineSession({ url: "mem", loadout: GUEST, connect: relay.connect, now: () => relay.clock });
    a.quick(HOST_DECK, MODE);
    relay.pump();
    expect(a.view()).toEqual({ t: "queued", position: 1 });
    b.quick(GUEST_DECK, MODE);
    relay.pump();
    expect(a.view().t).toBe("playing");
    expect(b.view().t).toBe("playing");
    expect((a as unknown as { code: string }).code).toMatch(/^ROOM/);
    expect((b as unknown as { code: string }).code).toBe((a as unknown as { code: string }).code);
  });

  it("reports an unreachable relay", async () => {
    const relay = new MemRelay();
    relay.refuse = true;
    const a = new OnlineSession({ url: "mem", loadout: HOST, connect: relay.connect });
    a.quick(HOST_DECK, MODE);
    expect(a.view().t).toBe("connecting");
    await vi.advanceTimersByTimeAsync(0);
    expect(a.view()).toEqual({ t: "failed", reason: "unreachable" });
  });
});
