// Online relay for 1v1 matches, on the LAN (`npm run play`) or the public
// internet behind TLS (see docs/deploy-multiplayer.md). Pure pairing/relay
// logic lives in the tested src/net/rooms.ts and src/net/validate.ts; this
// file is only the socket glue and the hardening around it: origin checks,
// rate limits, a per-IP connection cap, heartbeats, expiry sweeps, a health
// endpoint and graceful shutdown.
//
// Dev:   npm run relay                 (runs this file through vite-node)
// Prod:  npm run build:relay && npm run relay:prod   (bundled dist-server/relay.mjs)
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { RoomHub, type Outbound } from "../src/net/rooms";
import { makeCodeGen } from "../src/net/codewords";
import { PROTOCOL_VERSION, type ErrorReason, type ServerMsg } from "../src/net/protocol";
import { MAX_MESSAGE_BYTES, isParseError, parseClientMsg, playableCardIds } from "../src/net/validate";

const env = process.env;
const PORT = Number(env.PORT ?? env.RELAY_PORT ?? 3110);
const PRODUCTION = env.NODE_ENV === "production";
/** Comma list of page origins allowed to connect; "*" allows any. */
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS ?? (PRODUCTION ? "http://localhost:3101" : "*"))
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ANY_ORIGIN = ALLOWED_ORIGINS.includes("*");
const MAX_CONN_PER_IP = Number(env.MAX_CONN_PER_IP ?? 8);
/** Behind a proxy (Fly, Render, Caddy) the client IP is the first X-Forwarded-For entry. */
const TRUST_PROXY = env.TRUST_PROXY === "1";
const QUICK_MATCH = env.QUICK_MATCH !== "off";
/** "debug" adds client IPs and per-message detail; never on by default. */
const LOG_LEVEL = env.LOG_LEVEL === "debug" ? "debug" : "info";

const MSG_RATE = 60; // messages per second, sustained
const MSG_BURST = 90;
const PAIR_LIMIT = 5; // create/join/quick per IP...
const PAIR_WINDOW_MS = 10_000; // ...per 10 seconds
const MAX_INVALID = 5;
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 30_000;
const MAX_BUFFERED = 1 << 20; // a client this far behind is cut off
const WS_PATHS = new Set(["/", "/ws"]);

type Level = "debug" | "info" | "warn" | "error";

/** One-line JSON logs. IPs only ever appear at debug level. */
function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (level === "debug" && LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

const CARD_IDS = playableCardIds();
const cryptoRandom = (): number => randomInt(2 ** 47) / 2 ** 47;
const hub = new RoomHub(makeCodeGen(cryptoRandom), {
  now: Date.now,
  rng: cryptoRandom,
  token: () => randomBytes(16).toString("hex"),
  seed: () => randomInt(2 ** 31),
});
const startedAt = Date.now();

interface Conn {
  id: string;
  ws: WebSocket;
  ip: string;
  alive: boolean;
  tokens: number;
  refilledAt: number;
  invalid: number;
  limitedAt: number;
}

const conns = new Map<string, Conn>();
const connsPerIp = new Map<string, number>();
const pairAttempts = new Map<string, number[]>();
let nextId = 1;

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function send(conn: Conn, msg: ServerMsg): void {
  const { ws } = conn;
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED) {
    log("warn", "slow-client", { conn: conn.id });
    ws.terminate();
    return;
  }
  ws.send(JSON.stringify(msg));
}

function deliver(actions: Outbound[]): void {
  for (const { to, msg } of actions) {
    const conn = conns.get(to);
    if (conn) send(conn, msg);
    if (msg.t === "start" && msg.role === "host") {
      log("info", "match-start", { conn: to, delay: msg.delay, mode: msg.mode.elixirRate });
    }
  }
}

function sendError(conn: Conn, reason: ErrorReason): void {
  send(conn, { t: "error", reason });
}

/** Token bucket: MSG_RATE per second, bursts up to MSG_BURST. */
function takeToken(conn: Conn, now: number): boolean {
  conn.tokens = Math.min(MSG_BURST, conn.tokens + ((now - conn.refilledAt) / 1000) * MSG_RATE);
  conn.refilledAt = now;
  if (conn.tokens < 1) return false;
  conn.tokens -= 1;
  return true;
}

/** At most PAIR_LIMIT create/join/quick per IP in any PAIR_WINDOW_MS. */
function allowPairing(ip: string, now: number): boolean {
  const recent = (pairAttempts.get(ip) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
  if (recent.length >= PAIR_LIMIT) {
    pairAttempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  pairAttempts.set(ip, recent);
  return true;
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

function handle(conn: Conn, data: RawData, isBinary: boolean): void {
  const now = Date.now();
  if (!takeToken(conn, now)) {
    if (now - conn.limitedAt > 1000) {
      conn.limitedAt = now;
      sendError(conn, "rate-limited");
      log("info", "rate-limited", { conn: conn.id });
    }
    return;
  }
  const parsed = isBinary ? ({ error: "bad-message" } as const) : parseClientMsg(rawText(data), CARD_IDS);
  if (isParseError(parsed)) {
    conn.invalid++;
    sendError(conn, parsed.error);
    log("debug", "invalid", { conn: conn.id, reason: parsed.error, count: conn.invalid });
    if (conn.invalid >= MAX_INVALID) {
      log("info", "closed-invalid", { conn: conn.id });
      conn.ws.close(1008, "too many invalid messages");
    }
    return;
  }
  const msg = parsed;
  const id = conn.id;
  if ((msg.t === "create" || msg.t === "join" || msg.t === "quick") && !allowPairing(conn.ip, now)) {
    sendError(conn, "rate-limited");
    log("info", "pairing-limited", { conn: id });
    return;
  }
  switch (msg.t) {
    case "create":
      log("info", "create", { conn: id, v: msg.v ?? 1 });
      deliver(hub.create(id, msg.deck, msg.mode, { loadout: msg.loadout, v: msg.v }));
      break;
    case "join":
      log("info", "join", { conn: id, v: msg.v ?? 1 });
      deliver(hub.join(id, msg.code, msg.deck, { loadout: msg.loadout, v: msg.v }));
      break;
    case "quick":
      if (!QUICK_MATCH) {
        sendError(conn, "quick-disabled");
        break;
      }
      log("info", "quick", { conn: id });
      deliver(hub.quick(id, msg.deck, msg.mode, { loadout: msg.loadout, v: msg.v }));
      break;
    case "cancel":
      deliver(hub.cancel(id));
      break;
    case "frame":
      deliver(hub.relayFrame(id, msg.frame));
      break;
    case "sync":
      deliver(hub.relaySync(id, msg.tick, msg.checksum));
      break;
    case "ping":
      deliver(hub.ping(id, msg.at, msg.rtt));
      break;
    case "rematch":
      deliver(hub.rematch(id));
      break;
    case "leave":
      log("info", "leave", { conn: id });
      deliver(hub.leave(id));
      break;
    case "resume":
      log("info", "resume", { conn: id });
      deliver(hub.resume(id, msg.code, msg.token, msg.haveTick));
      break;
    case "pause":
      deliver(hub.pause(id, msg.paused));
      break;
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://relay").pathname;
  if (req.method === "GET" && path === "/healthz") {
    const { rooms, queue } = hub.stats();
    const body = {
      ok: true,
      v: PROTOCOL_VERSION,
      rooms,
      conns: conns.size,
      queue,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    };
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: (info, done) => {
    const path = new URL(info.req.url ?? "/", "http://relay").pathname;
    if (!WS_PATHS.has(path)) return done(false, 404, "Not Found");
    const origin = (info.origin ?? "").replace(/\/+$/, "");
    if (!ANY_ORIGIN && !ALLOWED_ORIGINS.includes(origin)) {
      log("info", "refused", { reason: "origin", origin: origin || null });
      return done(false, 403, "Origin not allowed");
    }
    const ip = clientIp(info.req);
    if ((connsPerIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) {
      log("info", "refused", { reason: "conn-cap" });
      log("debug", "refused-ip", { ip });
      return done(false, 429, "Too Many Connections");
    }
    done(true);
  },
});

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  const conn: Conn = {
    id: `c${nextId++}`,
    ws,
    ip,
    alive: true,
    tokens: MSG_BURST,
    refilledAt: Date.now(),
    invalid: 0,
    limitedAt: 0,
  };
  conns.set(conn.id, conn);
  connsPerIp.set(ip, (connsPerIp.get(ip) ?? 0) + 1);
  log("info", "connect", { conn: conn.id, conns: conns.size });
  log("debug", "connect-ip", { conn: conn.id, ip });

  ws.on("pong", () => {
    conn.alive = true;
  });
  ws.on("message", (data, isBinary) => {
    try {
      handle(conn, data, isBinary);
    } catch (err) {
      log("error", "handler", { conn: conn.id, err: String(err) });
    }
  });
  ws.on("error", (err) => {
    log("debug", "socket-error", { conn: conn.id, err: String(err) });
  });
  ws.on("close", () => {
    try {
      deliver(hub.drop(conn.id));
    } catch (err) {
      log("error", "drop", { conn: conn.id, err: String(err) });
    }
    conns.delete(conn.id);
    const left = (connsPerIp.get(ip) ?? 1) - 1;
    if (left > 0) connsPerIp.set(ip, left);
    else connsPerIp.delete(ip);
    log("info", "disconnect", { conn: conn.id, conns: conns.size });
  });
});

// Heartbeat: a socket that missed the previous ping is dead (phone slept,
// network vanished); terminating it lets the hub start the resume grace.
const heartbeat = setInterval(() => {
  for (const conn of conns.values()) {
    if (!conn.alive) {
      conn.ws.terminate();
      continue;
    }
    conn.alive = false;
    conn.ws.ping();
  }
}, HEARTBEAT_MS);

const sweeper = setInterval(() => {
  try {
    deliver(hub.sweep(Date.now()));
    const now = Date.now();
    for (const [ip, times] of pairAttempts) {
      if (times.every((t) => now - t >= PAIR_WINDOW_MS)) pairAttempts.delete(ip);
    }
  } catch (err) {
    log("error", "sweep", { err: String(err) });
  }
}, SWEEP_MS);

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log("info", "shutdown", { signal, conns: conns.size });
  clearInterval(heartbeat);
  clearInterval(sweeper);
  for (const conn of conns.values()) {
    sendError(conn, "server-restart");
    conn.ws.close(1012, "server restart");
  }
  wss.close();
  server.close();
  // Give the close frames a moment to flush, then go.
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// The WebSocketServer re-emits the HTTP server's errors (e.g. port in use).
wss.on("error", (err) => {
  log("error", "server", { err: String(err) });
  process.exit(1);
});

server.listen(PORT, () => {
  log("info", "listening", {
    port: PORT,
    v: PROTOCOL_VERSION,
    origins: ALLOWED_ORIGINS,
    quickMatch: QUICK_MATCH,
    trustProxy: TRUST_PROXY,
  });
});
