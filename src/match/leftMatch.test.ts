import { describe, expect, it } from "vitest";
import { memoryKV, type KV } from "../meta/kv";
import {
  LEFT_MATCH_KEY,
  LEFT_MATCH_MAX_AGE_MS,
  LIVE_MATCH_LOCK,
  clearMatchMarker,
  liveMatchGuard,
  markMatchStart,
  marksLeftMatch,
  readMarker,
  takeLeftMatch,
  takeLeftMatchUnlessLive,
  type ChannelLike,
  type LockManagerLike,
  type MatchStartInfo,
} from "./leftMatch";

const LADDER: MatchStartInfo = { kind: "ladder", online: false, replay: false, sandbox: false, tutorial: false };
const T0 = 1_700_000_000_000;

describe("leftMatch", () => {
  it("marks only solo ladder matches", () => {
    expect(marksLeftMatch(LADDER)).toBe(true);
    expect(marksLeftMatch({ ...LADDER, online: true })).toBe(false);
    expect(marksLeftMatch({ ...LADDER, replay: true })).toBe(false);
    expect(marksLeftMatch({ ...LADDER, sandbox: true })).toBe(false);
    expect(marksLeftMatch({ ...LADDER, tutorial: true })).toBe(false);
    for (const kind of ["draft", "challenge", "daily"]) expect(marksLeftMatch({ ...LADDER, kind })).toBe(false);
  });

  it("a match that ended leaves nothing to settle", () => {
    const kv = memoryKV();
    markMatchStart(kv, T0, 150);
    expect(readMarker(kv)).toEqual({ at: T0, trophies: 150 });
    clearMatchMarker(kv);
    expect(takeLeftMatch(kv, T0 + 5000)).toBeNull();
  });

  it("a match left mid-battle settles once on the next boot", () => {
    const kv = memoryKV();
    markMatchStart(kv, T0, 150);
    expect(takeLeftMatch(kv, T0 + 60_000)).toEqual({ at: T0, trophies: 150 });
    // Taken: a second boot does not charge it again.
    expect(takeLeftMatch(kv, T0 + 61_000)).toBeNull();
  });

  it("drops markers a day old or from the future, without settling", () => {
    const old = memoryKV();
    markMatchStart(old, T0, 80);
    expect(takeLeftMatch(old, T0 + LEFT_MATCH_MAX_AGE_MS)).toBeNull();
    expect(readMarker(old)).toBeNull();
    const ahead = memoryKV();
    markMatchStart(ahead, T0, 80);
    expect(takeLeftMatch(ahead, T0 - 1000)).toBeNull();
    // Just under a day still counts.
    const edge = memoryKV();
    markMatchStart(edge, T0, 80);
    expect(takeLeftMatch(edge, T0 + LEFT_MATCH_MAX_AGE_MS - 1)).not.toBeNull();
  });

  it("ignores corrupt markers and a missing or throwing store", () => {
    expect(takeLeftMatch(memoryKV({ [LEFT_MATCH_KEY]: "{oops" }), T0)).toBeNull();
    expect(takeLeftMatch(memoryKV({ [LEFT_MATCH_KEY]: JSON.stringify({ trophies: 5 }) }), T0)).toBeNull();
    expect(readMarker(memoryKV({ [LEFT_MATCH_KEY]: JSON.stringify({ at: T0 }) }))).toEqual({ at: T0, trophies: 0 });
    expect(takeLeftMatch(null, T0)).toBeNull();
    markMatchStart(null, T0, 1);
    clearMatchMarker(null);
    const broken: KV = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => markMatchStart(broken, T0, 1)).not.toThrow();
    expect(takeLeftMatch(broken, T0)).toBeNull();
  });

  it("uses removeItem when the store has one", () => {
    const data = new Map<string, string>();
    const store: KV & { removeItem(k: string): void } = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    markMatchStart(store, T0, 10);
    clearMatchMarker(store);
    expect(data.has(LEFT_MATCH_KEY)).toBe(false);
  });
});

/** One browser's lock manager (shared mode only): every tab's guard gets the same one. */
function fakeLocks(): LockManagerLike & { names(): string[] } {
  const held: { name: string }[] = [];
  return {
    names: () => held.map((l) => l.name),
    async request(name, _options, callback) {
      await Promise.resolve(); // granted asynchronously, as in a browser
      const lock = { name };
      held.push(lock);
      try {
        await callback();
      } finally {
        held.splice(held.indexOf(lock), 1);
      }
    },
    query: async () => ({ held: held.map((l) => ({ name: l.name })), pending: [] }),
  };
}

/** One origin's BroadcastChannel bus: a message reaches every other channel, never its sender. */
function fakeBus(): () => ChannelLike {
  const all: { ch: ChannelLike; fns: Set<(ev: { data: unknown }) => void> }[] = [];
  return () => {
    const fns = new Set<(ev: { data: unknown }) => void>();
    const ch: ChannelLike = {
      postMessage(data) {
        for (const other of all) {
          if (other.ch === ch) continue;
          for (const fn of [...other.fns]) setTimeout(() => fn({ data }), 1);
        }
      },
      addEventListener: (_t, fn) => void fns.add(fn),
      removeEventListener: (_t, fn) => void fns.delete(fn),
    };
    all.push({ ch, fns });
    return ch;
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("leftMatch: a match still running in another tab", () => {
  it("is not settled while it is live, and settles once it is not", async () => {
    const kv = memoryKV();
    markMatchStart(kv, T0, 150);
    expect(await takeLeftMatchUnlessLive(kv, T0 + 5000, async () => true)).toBeNull();
    // Left alone: the playing tab's own finish clears it.
    expect(readMarker(kv)).toEqual({ at: T0, trophies: 150 });
    expect(await takeLeftMatchUnlessLive(kv, T0 + 6000, async () => false)).toEqual({ at: T0, trophies: 150 });
    expect(readMarker(kv)).toBeNull();
  });

  it("settles when the probe fails, and never takes a marker replaced while asking", async () => {
    const kv = memoryKV();
    markMatchStart(kv, T0, 150);
    const boom = async (): Promise<boolean> => {
      throw new Error("no answer");
    };
    expect(await takeLeftMatchUnlessLive(kv, T0 + 1000, boom)).toEqual({ at: T0, trophies: 150 });

    markMatchStart(kv, T0, 150);
    const startedMeanwhile = async (): Promise<boolean> => {
      markMatchStart(kv, T0 + 900, 150); // a new ladder match began while boot was asking
      return false;
    };
    expect(await takeLeftMatchUnlessLive(kv, T0 + 1000, startedMeanwhile)).toBeNull();
    expect(readMarker(kv)).toEqual({ at: T0 + 900, trophies: 150 });

    const finishedMeanwhile = async (): Promise<boolean> => {
      clearMatchMarker(kv); // the other tab finished while boot was asking
      return false;
    };
    expect(await takeLeftMatchUnlessLive(kv, T0 + 1000, finishedMeanwhile)).toBeNull();
  });

  it("does not ask when there is no marker, and drops a corrupt one", async () => {
    let asked = 0;
    const probe = async (): Promise<boolean> => {
      asked++;
      return false;
    };
    expect(await takeLeftMatchUnlessLive(memoryKV(), T0, probe)).toBeNull();
    const junk = memoryKV({ [LEFT_MATCH_KEY]: "{oops" });
    expect(await takeLeftMatchUnlessLive(junk, T0, probe)).toBeNull();
    expect(junk.getItem(LEFT_MATCH_KEY) || null).toBeNull();
    expect(asked).toBe(0);
  });

  it("Web Locks: a tab mid-match holds the lock; a finished or closed tab does not", async () => {
    const locks = fakeLocks();
    const tabA = liveMatchGuard({ locks });
    const tabB = liveMatchGuard({ locks });
    expect(await tabB.live()).toBe(false);
    tabA.hold();
    tabA.hold(); // a restart while playing keeps one hold
    await settle();
    expect(locks.names()).toEqual([LIVE_MATCH_LOCK]);
    expect(await tabB.live()).toBe(true);
    tabA.release();
    await settle();
    expect(locks.names()).toEqual([]);
    expect(await tabB.live()).toBe(false);
    // Released before the grant arrives: the lock is let go at once.
    tabA.hold();
    tabA.release();
    await settle();
    await settle();
    expect(locks.names()).toEqual([]);
  });

  it("two boots: the second tab leaves the first tab's live match alone", async () => {
    const locks = fakeLocks();
    const kv = memoryKV();
    const tabA = liveMatchGuard({ locks });
    markMatchStart(kv, T0, 150);
    tabA.hold();
    await settle();
    const tabB = liveMatchGuard({ locks });
    expect(await takeLeftMatchUnlessLive(kv, T0 + 3000, tabB.live)).toBeNull();
    expect(readMarker(kv)).not.toBeNull();
    // Tab A is closed mid-match (the browser drops its lock): the next boot settles it.
    tabA.release();
    await settle();
    const tabC = liveMatchGuard({ locks });
    expect(await takeLeftMatchUnlessLive(kv, T0 + 9000, tabC.live)).toEqual({ at: T0, trophies: 150 });
  });

  it("a lock that is gone a beat later (this page's own, just reloaded) is not a live match", async () => {
    let calls = 0;
    const lingering: LockManagerLike = {
      request: async () => {},
      query: async () => ({ held: calls++ === 0 ? [{ name: LIVE_MATCH_LOCK }] : [] }),
    };
    expect(await liveMatchGuard({ locks: lingering, probeMs: 20 }).live()).toBe(false);
    expect(calls).toBe(2);
  });

  it("without Web Locks, a tab mid-match answers the boot ping", async () => {
    const channel = fakeBus();
    const tabA = liveMatchGuard({ channel: channel(), probeMs: 40 });
    const tabB = liveMatchGuard({ channel: channel(), probeMs: 40 });
    expect(await tabB.live()).toBe(false);
    tabA.hold();
    expect(await tabB.live()).toBe(true);
    tabA.release();
    expect(await tabB.live()).toBe(false);
  });

  it("falls back to the ping when the lock manager does not answer", async () => {
    const stuck: LockManagerLike = {
      request: () => new Promise(() => {}),
      query: () => new Promise(() => {}),
    };
    const channel = fakeBus();
    const tabA = liveMatchGuard({ locks: stuck, channel: channel(), probeMs: 30 });
    const tabB = liveMatchGuard({ locks: stuck, channel: channel(), probeMs: 30 });
    tabA.hold();
    expect(await tabB.live()).toBe(true);
    expect(await liveMatchGuard({ locks: stuck, probeMs: 10 }).live()).toBe(false);
  });
});
