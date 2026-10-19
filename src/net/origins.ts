/**
 * Which web pages may open a relay socket. Pure: server/relay.ts feeds it
 * the environment and each handshake's headers.
 *
 * A browser always sends the page's origin with a WebSocket handshake and
 * scripts cannot change it, so this check decides which *sites* can use the
 * relay. (Non-browser clients can send any Origin; the rate limits and
 * per-IP caps are what stop those.)
 *
 * A socket is allowed when any of these holds:
 *   - ALLOWED_ORIGINS is "*" (the dev default);
 *   - its Origin is listed in ALLOWED_ORIGINS, or is one of the server's own
 *     public URLs (RENDER_EXTERNAL_URL on Render);
 *   - its Origin names the same host the socket connected to (the Host
 *     header, or X-Forwarded-Host set by a proxy). That is the page the
 *     server itself served (`npm start`, Render, the Docker image), so a
 *     one-service deploy needs no origin setup. Other sites cannot pass it:
 *     a browser on evil.example sends Origin https://evil.example.
 */

export interface OriginPolicy {
  /** "*" was listed: every origin passes. */
  any: boolean;
  /** Exact origins allowed, as `scheme://host[:port]` with no trailing slash. */
  allowed: string[];
}

/** The production default when ALLOWED_ORIGINS is unset (the local dev page). */
export const PRODUCTION_DEFAULT_ORIGINS = "http://localhost:3101";

/** `scheme://host[:port]` of an http(s) URL, lower-cased; null for anything else. */
export function originOf(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * The policy from ALLOWED_ORIGINS (comma list; unset means "*" in dev and
 * PRODUCTION_DEFAULT_ORIGINS in production) plus the server's own public
 * URLs (e.g. RENDER_EXTERNAL_URL), which are always allowed.
 */
export function originPolicy(
  raw: string | undefined,
  production: boolean,
  selfUrls: readonly (string | undefined)[] = [],
): OriginPolicy {
  const listed = (raw ?? (production ? PRODUCTION_DEFAULT_ORIGINS : "*"))
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const allowed = new Set<string>();
  for (const o of listed) {
    if (o === "*") continue;
    allowed.add(o);
    const norm = originOf(o);
    if (norm) allowed.add(norm);
  }
  for (const u of selfUrls) {
    const norm = originOf(u);
    if (norm) allowed.add(norm);
  }
  return { any: listed.includes("*"), allowed: [...allowed] };
}

/** A Host-header value: a host name or [IPv6], optionally with a port. */
const HOST_RE = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** `host` as the URL `scheme//host` would normalise it (default port dropped), or null. */
function normHost(host: string, protocol: string): string | null {
  const h = host.trim();
  if (!HOST_RE.test(h)) return null;
  try {
    return new URL(`${protocol}//${h}`).host;
  } catch {
    return null;
  }
}

/**
 * True when a socket from page `origin` may connect. `hosts` are the
 * handshake's Host header and any X-Forwarded-Host values (a header given
 * more than once, or as a comma list, is fine).
 */
export function originAllowed(
  origin: string | undefined,
  hosts: readonly (string | readonly string[] | undefined)[],
  policy: OriginPolicy,
): boolean {
  if (policy.any) return true;
  const o = (origin ?? "").trim().replace(/\/+$/, "");
  if (!o) return false;
  if (policy.allowed.includes(o)) return true;
  const norm = originOf(o);
  if (!norm) return false;
  if (policy.allowed.includes(norm)) return true;
  const url = new URL(norm);
  for (const entry of hosts) {
    const values = entry === undefined ? [] : typeof entry === "string" ? [entry] : entry;
    for (const value of values) {
      for (const h of value.split(",")) {
        if (normHost(h, url.protocol) === url.host) return true;
      }
    }
  }
  return false;
}
