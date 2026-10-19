/**
 * Rules for serving the built game from the relay (server/static.ts does the
 * file I/O). Pure string logic, so it is unit-tested and type-checked with
 * the rest of src/.
 */

/** Longest request path considered at all. */
const MAX_PATH = 1024;

/**
 * The file a request path asks for, relative to the static root and using
 * "/" separators: "" for the root, "assets/index-abc.js", ... Returns null
 * (refuse: 404) for anything that could leave the root or reveal hidden
 * files: undecodable escapes, NUL bytes, backslashes, "." and ".." segments
 * (also when %-encoded, e.g. ..%2f), and dotfiles or dot-directories.
 *
 * `pathname` is the URL path without the query string. A trailing "/" is
 * kept so the caller knows a directory was asked for.
 */
export function staticRelPath(pathname: string): string | null {
  if (!pathname.startsWith("/") || pathname.length > MAX_PATH) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  if (segments.some((s) => s.startsWith("."))) return null;
  const rel = segments.join("/");
  return decoded.endsWith("/") && rel ? `${rel}/` : rel;
}

/** The final path segment has a file extension (".js", ".glb"...). */
export function hasExtension(rel: string): boolean {
  const last = rel.split("/").pop() ?? "";
  return /\.[a-z0-9]+$/i.test(last);
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Content-Type for a file name; unknown extensions are plain bytes. */
export function contentType(rel: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(rel)?.[1]?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

/**
 * Worth compressing on the fly: text, JSON, SVG, wasm and glTF models
 * (a .glb here shrinks to about 30%). Images, fonts and audio are already
 * compressed.
 */
export function compressible(type: string): boolean {
  const t = type.split(";")[0].trim().toLowerCase();
  return (
    t.startsWith("text/") ||
    t === "application/json" ||
    t === "application/manifest+json" ||
    t === "application/xml" ||
    t === "application/wasm" ||
    t === "image/svg+xml" ||
    t === "model/gltf-binary" ||
    t === "model/gltf+json"
  );
}

/** Vite's content-hashed build output: assets/<name>-<hash>.<ext>. */
const HASHED_ASSET = /^assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

/**
 * Cache-Control for a file:
 * - hashed assets/ files never change under the same name: cache for a year;
 * - the page, the service worker and the manifest must pick up a new deploy
 *   at once: always revalidate (the ETag makes that a tiny 304);
 * - everything else (icons, models): an hour, then revalidate.
 */
export function cacheControl(rel: string): string {
  if (HASHED_ASSET.test(rel)) return "public, max-age=31536000, immutable";
  const name = rel.split("/").pop() ?? "";
  if (rel === "" || /\.html?$/i.test(name) || name === "sw.js" || name === "manifest.webmanifest") {
    return "no-cache";
  }
  return "public, max-age=3600";
}

export type Encoding = "br" | "gzip";

/** The best encoding the client accepts (Accept-Encoding), brotli first. */
export function pickEncoding(acceptEncoding: string | readonly string[] | undefined): Encoding | null {
  const header = typeof acceptEncoding === "string" ? acceptEncoding : (acceptEncoding ?? []).join(",");
  const q = new Map<string, number>();
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const accepts = (enc: string) => (q.get(enc) ?? q.get("*") ?? 0) > 0;
  if (accepts("br")) return "br";
  if (accepts("gzip")) return "gzip";
  return null;
}

/** A weak validator from the file's size and modification time. */
export function etagFor(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/** If-None-Match names this ETag (weak comparison) or is "*". */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((t) => t.trim() === "*" || bare(t) === bare(etag));
}

/**
 * Where to send a GET for a missing, extension-less path (an old bookmark,
 * a typo, the GitHub Pages sub-path): the game at "/", keeping the query
 * (?join=CODE). Always a same-site path, never another host.
 */
export function fallbackLocation(search: string): string {
  const s = search.startsWith("?") ? search : "";
  return `/${s}`;
}
