/**
 * The app's typed hook bus plus a few single-owner providers. main.ts emits
 * the hooks and consults the providers; feature modules subscribe/set them,
 * so new features plug in without editing each other's code (or main.ts).
 */
import type { Side } from "../game/arena";
import type { BattleEvent, BattleState } from "../game/battle";

/**
 * "ladder" is the normal bot match that moves trophies/chests; the special
 * kinds replay themselves on "Play again" and never touch the ladder.
 */
export type BattleKind = "ladder" | "draft" | "challenge" | "daily";

export interface MatchStartPayload {
  kind: BattleKind;
  battle: BattleState;
  mySide: Side;
  online: boolean;
  /** Watching the saved recording, not playing. */
  replay: boolean;
}

export interface MatchEndPayload {
  kind: BattleKind;
  winner: Side | "draw";
  mySide: Side;
  myCrowns: number;
  theirCrowns: number;
  /** Trophies moved by this match (0 for anything but a real ladder win/loss). */
  trophyDelta: number;
  online: boolean;
  battle: BattleState;
  /** A replay ended: nothing was played, so reward listeners should skip it. */
  replay: boolean;
  /** Sandbox practice (kind "ladder", but never rewarded). */
  sandbox: boolean;
}

export type Hooks = {
  /** Every animation frame. alpha is the sim interpolation factor (0..1). */
  frame: { dt: number; presentDt: number; alpha: number; phase: string; battle: BattleState | null };
  matchStart: MatchStartPayload;
  /** Each drained battle event, after audio and the scene have seen it. */
  battleEvent: { ev: BattleEvent; mySide: Side };
  /** Once per match, after the built-in settlement (trophies, quests…). */
  matchEnd: MatchEndPayload;
  input: { kind: "select" | "deploy" | "invalid" | "ability" | "emote"; cardId?: string };
  /** A screen took over: 'none' = opaque picker, 'diorama' = home, 'battle'. */
  screen: { id: string; sceneMode: "battle" | "diorama" | "none" };
};

type Listener<K extends keyof Hooks> = (payload: Hooks[K]) => void;
const listeners: { [K in keyof Hooks]?: Listener<K>[] } = {};

/** Subscribe to a hook; returns the unsubscribe function. */
export function on<K extends keyof Hooks>(k: K, fn: Listener<K>): () => void {
  const list = (listeners[k] ??= []) as Listener<K>[];
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

/**
 * Call every listener in subscription order. A throwing listener is
 * reported and skipped — one broken feature must not stop the game loop.
 */
export function emit<K extends keyof Hooks>(k: K, payload: Hooks[K]): void {
  const list = listeners[k] as Listener<K>[] | undefined;
  if (!list || list.length === 0) return;
  for (const fn of list.slice()) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[hooks] ${k} listener failed`, err);
    }
  }
}

// ---- Providers ------------------------------------------------------------
// Each provider has one owner (set once) and a default that keeps today's
// behaviour; sim holds are the exception: any number of holders, OR-ed.

const simHolds: (() => boolean)[] = [];

/** Freeze the solo sim while fn() is true (online lockstep never consults it). */
export function registerSimHold(fn: () => boolean): () => void {
  simHolds.push(fn);
  return () => {
    const i = simHolds.indexOf(fn);
    if (i >= 0) simHolds.splice(i, 1);
  };
}

export function simHeld(): boolean {
  for (const fn of simHolds) if (fn()) return true;
  return false;
}

function once<T>(name: string, fallback: T): { get: () => T; set: (v: T) => void } {
  let value = fallback;
  let owned = false;
  return {
    get: () => value,
    set: (v) => {
      if (owned) throw new Error(`[hooks] ${name} provider is already set`);
      owned = true;
      value = v;
    },
  };
}

const timeScale = once<() => number>("presentTimeScale", () => 1);
const renderGate = once<(now: number) => boolean>("renderGate", () => true);
const spend = once<() => number>("pendingSpend", () => 0);

/** Presentation speed (slow-mo, pause); multiplies the dt the scene sees. */
export const presentTimeScale = (): number => timeScale.get()();
export const setPresentTimeScale = (fn: () => number): void => timeScale.set(fn);

/** False skips scene.render this frame (e.g. an opaque screen covers it). */
export const shouldRender = (now: number): boolean => renderGate.get()(now);
export const setRenderGate = (fn: (now: number) => boolean): void => renderGate.set(fn);

/** Elixir already promised to queued (not yet executed) online plays. */
export const pendingSpend = (): number => spend.get()();
export const setPendingSpend = (fn: () => number): void => spend.set(fn);
