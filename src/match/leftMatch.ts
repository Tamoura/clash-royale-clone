/**
 * Leaving a ladder match early: reloading or closing the page mid-battle
 * used to dodge the loss that Forfeit charges. A solo ladder match drops a
 * marker when it starts and removes it when it ends; a marker still there
 * on the next boot means the player left, and that match settles as a loss.
 *
 * Pure apart from the injected store (meta/kv.ts) and, for the "is that
 * match still running in another tab?" check, an injected lock manager and
 * channel, so it is unit-tested with fakes. main.ts does the settling and
 * shows the notice.
 */
import type { KV } from "../meta/kv";

export const LEFT_MATCH_KEY = "cr-clone-left-match";
/** A marker older than this is stale (a lost tab, an old device): dropped, not settled. */
export const LEFT_MATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface LeftMatchMarker {
  /** When the match started (ms since the epoch). */
  at: number;
  /** Trophies when it started. */
  trophies: number;
}

/** What kind of match is starting; only a real solo ladder match is marked. */
export interface MatchStartInfo {
  /** The match kind ("ladder", "draft", "challenge", "daily"). */
  kind: string;
  online: boolean;
  replay: boolean;
  sandbox: boolean;
  /** The guided first battle. */
  tutorial: boolean;
}

/** True for the matches that move trophies: solo ladder, not practice or a replay. */
export function marksLeftMatch(m: MatchStartInfo): boolean {
  return m.kind === "ladder" && !m.online && !m.replay && !m.sandbox && !m.tutorial;
}

function remove(kv: KV, key: string): void {
  const r = (kv as Partial<Storage>).removeItem;
  try {
    if (typeof r === "function") r.call(kv, key);
    else kv.setItem(key, "");
  } catch {
    // storage blocked: the marker simply stays (and expires)
  }
}

/** A ladder match is starting: remember it until it ends. */
export function markMatchStart(kv: KV | null, now: number, trophies: number): void {
  if (!kv) return;
  try {
    kv.setItem(LEFT_MATCH_KEY, JSON.stringify({ at: now, trophies } satisfies LeftMatchMarker));
  } catch {
    // storage full or blocked: leaving early just goes unnoticed
  }
}

/** The match ended on screen (win, loss, draw or forfeit): nothing to settle. */
export function clearMatchMarker(kv: KV | null): void {
  if (kv) remove(kv, LEFT_MATCH_KEY);
}

/** The stored marker, or null when there is none or it is unreadable. */
export function readMarker(kv: KV | null): LeftMatchMarker | null {
  if (!kv) return null;
  try {
    const raw = kv.getItem(LEFT_MATCH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LeftMatchMarker> | null;
    if (!v || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const trophies = typeof v.trophies === "number" && Number.isFinite(v.trophies) ? v.trophies : 0;
    return { at: v.at, trophies };
  } catch {
    return null;
  }
}

/**
 * At boot: the match the player left, if one is waiting to be settled. The
 * marker is removed either way, so a loss is never charged twice. Markers
 * from the future (a changed clock) or older than a day are dropped.
 */
export function takeLeftMatch(kv: KV | null, now: number): LeftMatchMarker | null {
  const m = readMarker(kv);
  clearMatchMarker(kv);
  if (!m) return null;
  const age = now - m.at;
  return age >= 0 && age < LEFT_MATCH_MAX_AGE_MS ? m : null;
}

// ---- Another tab may still be playing it ----------------------------------
// The marker lives in storage every tab shares, so a second tab that boots
// mid-match would read the first tab's live match as "left". Each tab holds
// a shared Web Lock while one of its ladder matches runs (a reload or a
// closed tab drops it), and boot settles only when nobody holds it. Pages
// without Web Locks (plain-http LAN addresses) ask over a BroadcastChannel.

/** Held (shared) by every tab while one of its ladder matches runs. */
export const LIVE_MATCH_LOCK = "cr-ladder-match";
/** The fallback channel: "ping" from a booting tab, "live" from a tab mid-match. */
export const LIVE_MATCH_CHANNEL = "cr-ladder-match";
/** How long boot waits for the lock manager, or for a tab to answer the ping. */
export const LIVE_PROBE_MS = 300;

/** Is a ladder match being played in another tab right now? */
export type LiveProbe = () => Promise<boolean>;

/**
 * At boot: like takeLeftMatch, but a marker whose match is still running in
 * another tab is left alone (that tab's own finish clears it). The marker is
 * read before asking and taken only if it is still the same one afterwards,
 * so a match that started meanwhile is never charged.
 */
export async function takeLeftMatchUnlessLive(
  kv: KV | null,
  now: number,
  live: LiveProbe,
): Promise<LeftMatchMarker | null> {
  const seen = readMarker(kv);
  if (!seen) return takeLeftMatch(kv, now); // nothing to settle (a corrupt marker is dropped)
  let running: boolean;
  try {
    running = await live();
  } catch {
    running = false;
  }
  if (running) return null;
  const still = readMarker(kv);
  if (!still || still.at !== seen.at) return null;
  return takeLeftMatch(kv, now);
}

/** The parts of navigator.locks the guard uses. */
export interface LockManagerLike {
  request(name: string, options: { mode: "shared" }, callback: () => Promise<void> | void): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>;
}

/** The parts of a BroadcastChannel the guard uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
}

export interface LiveMatchGuard {
  /** A ladder match started in this tab. */
  hold(): void;
  /** It ended on screen. */
  release(): void;
  /** Is one running in another tab? */
  live: LiveProbe;
}

/** The promise's value, or null when it fails or takes longer than ms. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/** Holds and asks about the live-match lock; every dependency is injected (tests use fakes). */
export function liveMatchGuard(
  deps: { locks?: LockManagerLike | null; channel?: ChannelLike | null; probeMs?: number } = {},
): LiveMatchGuard {
  const { locks = null, channel = null, probeMs = LIVE_PROBE_MS } = deps;
  let holding = false;
  let ticket = 0; // a release before the lock is granted cancels that grant
  let unlock: (() => void) | null = null;
  channel?.addEventListener("message", (ev) => {
    if (ev.data === "ping" && holding) channel.postMessage("live");
  });

  /** True or false from the lock manager; null when there is none or it does not answer. */
  const askLocks = async (): Promise<boolean | null> => {
    if (!locks) return null;
    let snap: Awaited<ReturnType<LockManagerLike["query"]>> | null;
    try {
      snap = await within(locks.query(), probeMs);
    } catch {
      snap = null;
    }
    if (!snap) return null;
    return [...(snap.held ?? []), ...(snap.pending ?? [])].some((l) => l.name === LIVE_MATCH_LOCK);
  };

  /** Ping the other tabs; one mid-match answers "live" within probeMs. */
  const askTabs = (ch: ChannelLike): Promise<boolean> =>
    new Promise((resolve) => {
      const onMsg = (ev: { data: unknown }): void => {
        if (ev.data === "live") done(true);
      };
      const t = setTimeout(() => done(false), probeMs);
      function done(v: boolean): void {
        clearTimeout(t);
        ch.removeEventListener("message", onMsg);
        resolve(v);
      }
      ch.addEventListener("message", onMsg);
      try {
        ch.postMessage("ping");
      } catch {
        done(false);
      }
    });

  return {
    hold() {
      if (holding) return;
      holding = true;
      if (!locks) return;
      const mine = ++ticket;
      const granted = (): Promise<void> | void => {
        if (mine !== ticket) return; // released before the grant: let it go at once
        return new Promise<void>((r) => {
          unlock = r;
        });
      };
      try {
        locks.request(LIVE_MATCH_LOCK, { mode: "shared" }, granted).catch(() => {});
      } catch {
        // no lock: the channel answer still covers this tab
      }
    },
    release() {
      holding = false;
      ticket++;
      const u = unlock;
      unlock = null;
      u?.();
    },
    async live() {
      let byLock = await askLocks();
      if (byLock) {
        // Ask once more after a beat: a page that just reloaded may still see
        // its own old lock for a moment while the browser lets it go.
        await new Promise((r) => setTimeout(r, probeMs / 2));
        byLock = await askLocks();
      }
      if (byLock !== null) return byLock;
      return channel ? askTabs(channel) : false;
    },
  };
}

/** The page's guard: navigator.locks where there is one, a BroadcastChannel ping otherwise. */
export function browserLiveMatchGuard(): LiveMatchGuard {
  let locks: LockManagerLike | null = null;
  let channel: ChannelLike | null = null;
  try {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManagerLike });
    locks = nav?.locks ?? null;
  } catch {
    locks = null;
  }
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(LIVE_MATCH_CHANNEL) : null;
  } catch {
    channel = null;
  }
  return liveMatchGuard({ locks, channel });
}
