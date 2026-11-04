/**
 * Leaving a ladder match early: reloading or closing the page mid-battle
 * used to dodge the loss that Forfeit charges. A solo ladder match drops a
 * marker when it starts and removes it when it ends; a marker still there
 * on the next boot means the player left, and that match settles as a loss.
 *
 * Pure apart from the injected store (meta/kv.ts), so it is unit-tested
 * with a memory store. main.ts does the settling and shows the notice.
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
