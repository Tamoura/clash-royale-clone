/**
 * Where the online relay lives. Pure: the page location, build env and
 * storage are passed in, so main.ts (or a test) decides what to feed it.
 *
 * Priority:
 *   1. `?relay=ws(s)://…` in the page URL (remembered in storage;
 *      `?relay=clear` forgets it), else a previously remembered one
 *   2. the build's VITE_RELAY_URL: a ws(s):// URL, or "same-origin" / a
 *      path like "/ws" when the relay serves the page itself (one service,
 *      one address: `npm run build:all && npm start`, Render, Docker)
 *   3. a plain-http page (LAN dev or `npm run play`): ws://<host>:3110
 *   4. nothing: online play is unavailable
 * On an https page a ws: URL is upgraded to wss: (browsers block mixed content).
 */

export const RELAY_STORE_KEY = "cr-clone-relay";
export const LAN_RELAY_PORT = 3110;
/** VITE_RELAY_URL value meaning "the relay is this page's own server, at <base>ws". */
export const SAME_ORIGIN = "same-origin";

export interface PageLocation {
  search: string;
  protocol: string;
  hostname: string;
  /** hostname plus port when there is one (Location.host); hostname if absent. */
  host?: string;
}

export interface RelayEnv {
  VITE_RELAY_URL?: string;
  /** The build's base path (Vite's BASE_URL, e.g. "/" or "/clash-royale-clone/"). */
  BASE_URL?: string;
}

export interface RelayTarget {
  url: string | null;
  /** True for the implied LAN relay next to a plain-http page. */
  lan: boolean;
}

/** A trimmed ws:/wss: URL, or null for anything else (javascript:, http:, junk). */
function wsUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "ws:" && u.protocol !== "wss:") || !u.hostname) return null;
  } catch {
    return null;
  }
  return s;
}

function upgrade(url: string, protocol: string): string {
  return protocol === "https:" ? url.replace(/^ws:/i, "wss:") : url;
}

function read(store: Storage | undefined): string | null {
  try {
    return store?.getItem(RELAY_STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, value: string | null): void {
  try {
    if (value === null) store?.removeItem(RELAY_STORE_KEY);
    else store?.setItem(RELAY_STORE_KEY, value);
  } catch {
    // storage unavailable (private mode, blocked site data)
  }
}

/** A same-origin path: "/" then URL-safe path characters (no "//", no query). */
const PATH_RE = /^\/(?!\/)[A-Za-z0-9._~\-/]*$/;

/**
 * The build's relay (VITE_RELAY_URL) as a socket URL for this page, or null.
 * "same-origin" means <page host><base path>ws; a value starting with "/"
 * is a path on the page's host. Both use wss: on https pages and ws: on
 * http ones. An absolute ws(s):// URL is used as-is (upgraded on https).
 */
export function buildRelayUrl(loc: PageLocation, env: RelayEnv): string | null {
  const raw = env.VITE_RELAY_URL?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === SAME_ORIGIN || raw.startsWith("/")) {
    const host = loc.host || loc.hostname;
    if (!host || (loc.protocol !== "http:" && loc.protocol !== "https:")) return null;
    const base = env.BASE_URL?.startsWith("/") ? env.BASE_URL.replace(/\/*$/, "/") : "/";
    const path = raw.startsWith("/") ? raw : `${base}ws`;
    if (!PATH_RE.test(path)) return null;
    return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${host}${path}`;
  }
  const url = wsUrl(raw);
  return url ? upgrade(url, loc.protocol) : null;
}

export function resolveRelayUrl(loc: PageLocation, env: RelayEnv, store?: Storage): RelayTarget {
  const param = new URLSearchParams(loc.search).get("relay");
  if (param !== null) {
    if (param.trim().toLowerCase() === "clear") {
      write(store, null);
    } else {
      const url = wsUrl(param);
      if (url) {
        write(store, url);
        return { url: upgrade(url, loc.protocol), lan: false };
      }
    }
  }
  const remembered = param?.trim().toLowerCase() === "clear" ? null : wsUrl(read(store));
  if (remembered) return { url: upgrade(remembered, loc.protocol), lan: false };

  const fromEnv = buildRelayUrl(loc, env);
  if (fromEnv) return { url: fromEnv, lan: false };

  if (loc.protocol === "http:" && loc.hostname) {
    return { url: `ws://${loc.hostname}:${LAN_RELAY_PORT}`, lan: true };
  }
  return { url: null, lan: false };
}
