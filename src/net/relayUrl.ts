/**
 * Where the online relay lives. Pure: the page location, build env and
 * storage are passed in, so main.ts (or a test) decides what to feed it.
 *
 * Priority:
 *   1. `?relay=ws(s)://…` in the page URL (remembered in storage;
 *      `?relay=clear` forgets it), else a previously remembered one
 *   2. the build's VITE_RELAY_URL
 *   3. a plain-http page (LAN dev or `npm run play`): ws://<host>:3110
 *   4. nothing: online play is unavailable
 * On an https page a ws: URL is upgraded to wss: (browsers block mixed content).
 */

export const RELAY_STORE_KEY = "cr-clone-relay";
export const LAN_RELAY_PORT = 3110;

export interface PageLocation {
  search: string;
  protocol: string;
  hostname: string;
}

export interface RelayEnv {
  VITE_RELAY_URL?: string;
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

  const fromEnv = wsUrl(env.VITE_RELAY_URL);
  if (fromEnv) return { url: upgrade(fromEnv, loc.protocol), lan: false };

  if (loc.protocol === "http:" && loc.hostname) {
    return { url: `ws://${loc.hostname}:${LAN_RELAY_PORT}`, lan: true };
  }
  return { url: null, lan: false };
}
