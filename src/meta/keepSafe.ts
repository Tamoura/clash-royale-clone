/**
 * Keep the save safe on this device:
 *
 * - After the kid's first win, ask the browser once to keep this site's
 *   storage (navigator.storage.persist()), so it is not cleared to make
 *   room. Chrome decides quietly; Firefox may ask the grown-up once; Safari
 *   mostly says no unless the game is on the Home Screen. Asked once only,
 *   so nobody is nagged.
 * - On an iPhone or iPad in a browser tab (not opened from the Home
 *   Screen), Safari can clear a site's storage after a week without a
 *   visit, so a one-time tip suggests adding Crown Rush to the Home Screen.
 *
 * Both flags are device keys (saveKeys.ts). Pure apart from the injected
 * store and environment; ui/keepSafeWire.ts calls it from the match hooks.
 */
import type { KV } from "./kv";

/** Set once persistence was asked for. */
export const PERSIST_ASKED_KEY = "cr-clone-persist-asked";
/** Set once the 'Add to Home Screen' tip was shown. */
export const HOME_TIP_SEEN_KEY = "cr-clone-home-tip-seen";

/** The parts of navigator.storage used here. */
export interface PersistApi {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

export type PersistOutcome = "already-asked" | "unsupported" | "already-kept" | "granted" | "denied";

function get(kv: KV | null, key: string): string | null {
  try {
    return kv?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(kv: KV | null, key: string, value: string): void {
  try {
    kv?.setItem(key, value);
  } catch {
    // storage blocked: we may ask again next time, which is harmless
  }
}

/**
 * Ask the browser to keep this site's storage, once per device. The flag is
 * set before asking, so a prompt that is never answered is not repeated.
 */
export async function askToKeepSaveOnce(kv: KV | null, api: PersistApi | null | undefined): Promise<PersistOutcome> {
  if (get(kv, PERSIST_ASKED_KEY) !== null) return "already-asked";
  set(kv, PERSIST_ASKED_KEY, "1");
  if (!api || typeof api.persist !== "function") return "unsupported";
  try {
    if (typeof api.persisted === "function" && (await api.persisted())) return "already-kept";
    return (await api.persist()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** What the tip needs to know about the browser. */
export interface DeviceInfo {
  userAgent: string;
  /** navigator.platform ("MacIntel" on an iPad asking for desktop sites). */
  platform: string;
  maxTouchPoints: number;
  /** Opened from the Home Screen (navigator.standalone or display-mode: standalone). */
  standalone: boolean;
}

/** An iPhone, iPod or iPad (including an iPad that reports itself as a Mac). */
export function isAppleTouchDevice(d: DeviceInfo): boolean {
  return /iPad|iPhone|iPod/.test(d.userAgent) || (d.platform === "MacIntel" && d.maxTouchPoints > 1);
}

/** Show the 'Add to Home Screen' tip: an Apple touch device, in a browser tab, not shown before. */
export function shouldShowHomeTip(kv: KV | null, d: DeviceInfo): boolean {
  return isAppleTouchDevice(d) && !d.standalone && get(kv, HOME_TIP_SEEN_KEY) === null;
}

export function markHomeTipSeen(kv: KV | null): void {
  set(kv, HOME_TIP_SEEN_KEY, "1");
}

/** This browser's DeviceInfo (safe anywhere). */
export function deviceInfo(): DeviceInfo {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    let standalone = nav.standalone === true;
    try {
      standalone ||= !!globalThis.matchMedia?.("(display-mode: standalone)").matches;
    } catch {
      // no media queries
    }
    return { userAgent: nav.userAgent ?? "", platform: nav.platform ?? "", maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
  } catch {
    return { userAgent: "", platform: "", maxTouchPoints: 0, standalone: false };
  }
}
