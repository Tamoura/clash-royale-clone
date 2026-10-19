// Serves the built game (dist/) from the relay process, so ONE Node service
// at ONE address is the whole multiplayer deploy: `npm start`, Render, the
// Docker image. The page then talks to the relay on its own origin, with no
// relay URL or origin list to configure.
//
// The rules (which paths are allowed, content types, caching) are pure and
// tested in src/net/staticRules.ts; this file is the file system and zlib
// glue. Safety: every request path is decoded once and refused if it holds
// "..", a dotfile, a backslash or a NUL (staticRelPath), and the file found
// is resolved through symlinks and must still sit inside the root.
import { createReadStream, existsSync, promises as fsp, realpathSync, type Stats } from "node:fs";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import {
  cacheControl,
  compressible,
  contentType,
  etagFor,
  etagMatches,
  fallbackLocation,
  hasExtension,
  pickEncoding,
  staticRelPath,
  type Encoding,
} from "../src/net/staticRules";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Bodies smaller than this go out as they are. */
const MIN_COMPRESS_BYTES = 1024;
/** Larger files are streamed from disk: no memory cache, no compression. */
const MAX_CACHED_FILE = 32 * 1024 * 1024;
/** Memory budget for cached files and their compressed copies. */
const MAX_CACHED_TOTAL = 128 * 1024 * 1024;

const BASE_HEADERS: OutgoingHttpHeaders = { "x-content-type-options": "nosniff" };

interface Entry {
  size: number;
  mtimeMs: number;
  raw: Promise<Buffer>;
  encoded: Map<Encoding, Promise<Buffer>>;
  /** Bytes this entry holds in memory (the file plus its compressed copies). */
  bytes: number;
}

interface Found {
  file: string;
  /** Root-relative path of the file actually served ("index.html" for "/"). */
  rel: string;
  stat: Stats;
}

export interface StaticSite {
  /** The real path of the folder being served. */
  root: string;
  /** Answer one GET or HEAD request (anything else gets 405). */
  serve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
}

/** Compress with brotli (quality 5: near gzip speed, ~7% smaller) or gzip. */
function compress(body: Buffer, enc: Encoding): Promise<Buffer> {
  if (enc === "br") {
    return brotliAsync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    });
  }
  return gzipAsync(body, { level: 6 });
}

/**
 * The site served from `dir`, or null when `dir` is missing or has no
 * index.html (the relay then serves only /healthz and the WebSocket).
 */
export function openStaticSite(dir: string, onError: (err: unknown) => void = () => {}): StaticSite | null {
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return null;
  }
  if (!existsSync(join(root, "index.html"))) return null;

  const cache = new Map<string, Entry>();
  let cachedBytes = 0;

  /** True when `real` (a resolved path) is inside the root and not hidden. */
  function inside(real: string): boolean {
    const rel = relative(root, real);
    if (rel === "") return true;
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
    return !rel.split(sep).some((s) => s.startsWith("."));
  }

  /** Resolve a checked relative path to a regular file (a directory means its index.html). */
  async function locate(rel: string): Promise<Found | null> {
    let candidate = rel.replace(/\/$/, "");
    for (let hop = 0; hop < 2; hop++) {
      let real: string;
      try {
        real = await fsp.realpath(join(root, candidate));
      } catch {
        return null;
      }
      if (!inside(real)) return null;
      const stat = await fsp.stat(real);
      if (stat.isFile()) return { file: real, rel: candidate, stat };
      if (!stat.isDirectory()) return null;
      candidate = candidate ? `${candidate}/index.html` : "index.html";
    }
    return null;
  }

  function entryFor(found: Found): Entry | null {
    const { file, stat } = found;
    const hit = cache.get(file);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit;
    if (hit) forget(file, hit); // changed on disk since it was cached
    if (stat.size > MAX_CACHED_FILE || cachedBytes + stat.size > MAX_CACHED_TOTAL) return null;
    const entry: Entry = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      raw: fsp.readFile(file),
      encoded: new Map(),
      bytes: stat.size,
    };
    entry.raw.catch(() => forget(file, entry));
    cache.set(file, entry);
    cachedBytes += entry.bytes;
    return entry;
  }

  function forget(file: string, entry: Entry): void {
    if (cache.get(file) !== entry) return;
    cache.delete(file);
    cachedBytes -= entry.bytes;
  }

  /** The compressed body, made once per file and encoding, or null to send it plain. */
  async function encodedBody(file: string, entry: Entry, enc: Encoding): Promise<Buffer | null> {
    let pending = entry.encoded.get(enc);
    if (!pending) {
      pending = entry.raw.then((raw) => compress(raw, enc));
      entry.encoded.set(enc, pending);
      pending.then(
        (body) => {
          if (cache.get(file) !== entry) return;
          entry.bytes += body.length;
          cachedBytes += body.length;
        },
        (err: unknown) => {
          onError(err);
          forget(file, entry); // try again on the next request
        },
      );
    }
    try {
      const body = await pending;
      return body.length < entry.size ? body : null;
    } catch {
      return null; // compression failed: send the file as it is
    }
  }

  async function serve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { ...BASE_HEADERS, allow: "GET, HEAD", "content-type": "text/plain" });
      res.end("method not allowed\n");
      return;
    }
    const rel = staticRelPath(url.pathname);
    const found = rel === null ? null : await locate(rel);
    if (!found) {
      if (rel !== null && rel !== "" && !hasExtension(rel)) {
        // An unknown page (old bookmark, the Pages sub-path): go to the game.
        res.writeHead(302, { ...BASE_HEADERS, location: fallbackLocation(url.search), "cache-control": "no-cache" });
        res.end();
        return;
      }
      res.writeHead(404, { ...BASE_HEADERS, "content-type": "text/plain", "cache-control": "no-cache" });
      res.end("not found\n");
      return;
    }

    const type = contentType(found.rel);
    const etag = etagFor(found.stat.size, found.stat.mtimeMs);
    const zip = compressible(type) && found.stat.size >= MIN_COMPRESS_BYTES;
    const headers: OutgoingHttpHeaders = {
      ...BASE_HEADERS,
      "content-type": type,
      "cache-control": cacheControl(found.rel),
      etag,
      ...(zip ? { vary: "accept-encoding" } : {}),
    };
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const entry = entryFor(found);
    if (!entry) {
      // Too big to keep in memory: stream it as it is.
      res.writeHead(200, { ...headers, "content-length": found.stat.size });
      if (method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(found.file);
      stream.on("error", (err) => {
        onError(err);
        res.destroy();
      });
      stream.pipe(res);
      return;
    }

    const enc = zip ? pickEncoding(req.headers["accept-encoding"]) : null;
    const packed = enc ? await encodedBody(found.file, entry, enc) : null;
    const body = packed ?? (await entry.raw);
    res.writeHead(200, {
      ...headers,
      ...(packed && enc ? { "content-encoding": enc } : {}),
      "content-length": body.length,
    });
    res.end(method === "HEAD" ? undefined : body);
  }

  return {
    root,
    serve: (req, res, url) =>
      serve(req, res, url).catch((err: unknown) => {
        onError(err);
        if (!res.headersSent) {
          res.writeHead(500, { ...BASE_HEADERS, "content-type": "text/plain" });
          res.end("server error\n");
        } else {
          res.destroy();
        }
      }),
  };
}
