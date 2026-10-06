/**
 * UI slots: named places on shared screens that feature modules fill
 * without editing the screen's own code. The screen renders whatever is
 * registered; nothing registered means the screen looks exactly as before.
 */
import type { MatchEndPayload } from "./hooks";

export type HomeSlot = "battle-top" | "battle-bottom" | "shop" | "events" | "profile";

/** Appends its content to host; may return a cleanup run when the home is rebuilt or left. */
export type HomeSlotRender = (host: HTMLElement) => void | (() => void);

const homeSlots = new Map<HomeSlot, HomeSlotRender[]>();

export function registerHomeSlot(slot: HomeSlot, render: HomeSlotRender): () => void {
  const list = homeSlots.get(slot) ?? [];
  homeSlots.set(slot, list);
  list.push(render);
  return () => {
    const i = list.indexOf(render);
    if (i >= 0) list.splice(i, 1);
  };
}

/**
 * Render every provider for slot into host, in registration order. Returns
 * one cleanup that runs all the providers' cleanups.
 */
export function renderHomeSlots(slot: HomeSlot, host: HTMLElement): () => void {
  const cleanups: (() => void)[] = [];
  for (const render of (homeSlots.get(slot) ?? []).slice()) {
    try {
      const done = render(host);
      if (typeof done === "function") cleanups.push(done);
    } catch (err) {
      console.error(`[slots] home slot ${slot} failed`, err);
    }
  }
  return () => {
    for (const fn of cleanups) fn();
  };
}

export type ResultExtra = (summary: MatchEndPayload) => HTMLElement | null;

const resultProviders: ResultExtra[] = [];

/** Add a line/badge to the match result screen (null = nothing this time). */
export function registerResultExtra(provider: ResultExtra): () => void {
  resultProviders.push(provider);
  return () => {
    const i = resultProviders.indexOf(provider);
    if (i >= 0) resultProviders.splice(i, 1);
  };
}

/** The extra result-screen elements for this match, in registration order. */
export function resultExtras(summary: MatchEndPayload): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const provider of resultProviders.slice()) {
    try {
      const el = provider(summary);
      if (el) out.push(el);
    } catch (err) {
      console.error("[slots] result extra failed", err);
    }
  }
  return out;
}
