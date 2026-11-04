import { describe, expect, it } from "vitest";
import { memoryKV, type KV } from "../meta/kv";
import {
  LEFT_MATCH_KEY,
  LEFT_MATCH_MAX_AGE_MS,
  clearMatchMarker,
  markMatchStart,
  marksLeftMatch,
  readMarker,
  takeLeftMatch,
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
