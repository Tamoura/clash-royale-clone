// End-to-end smoke test for a running relay (local, tunnel or Fly.io).
//
//   node tools/relay-smoke.mjs <ws(s)://host/ws> [--origin https://example.com]
//
// Checks /healthz, plays a short code match between two sockets (30 frames
// each, a deploy each and one King's ability), measures ping RTT, and pairs
// two more sockets through quick match. Exits 0 when everything works, or 1
// with a one-line reason (origin refused, update required, timeout, ...).
import { WebSocket } from "ws";

const PROTOCOL_VERSION = 2;
const TIMEOUT_MS = 20_000;
const FRAMES = 30;
const DECK_A = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
const DECK_B = ["wizard", "witch", "skeletons", "gargoyles", "valkyrie", "hog-rider", "cannon", "zap"];
const MODE = { elixirRate: 1, mirror: false };
const loadout = (name) => ({ name, crest: 0, tower: "princess", ability: "salvo" });

function usage() {
  console.error("usage: node tools/relay-smoke.mjs <ws(s)://host/ws> [--origin <page origin>]");
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--origin");
const originAt = args.indexOf("--origin");
const origin = originAt >= 0 ? args[originAt + 1] : undefined;
if (!url || !/^wss?:\/\//i.test(url) || (originAt >= 0 && !origin)) usage();

const sockets = [];
function fail(reason) {
  console.error(`FAIL: ${reason}`);
  for (const ws of sockets) ws.terminate();
  process.exit(1);
}
const timer = setTimeout(() => fail(`timeout after ${TIMEOUT_MS / 1000}s (is the relay up and reachable?)`), TIMEOUT_MS);

/** Open a socket that records every message and fails fast on refusals. */
function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
    sockets.push(ws);
    const inbox = [];
    const waiters = [];
    ws.on("unexpected-response", (_req, res) => {
      const hint =
        res.statusCode === 403
          ? " — origin refused; pass --origin <your page origin> or add it to ALLOWED_ORIGINS"
          : res.statusCode === 429
            ? " — too many connections from this IP (MAX_CONN_PER_IP)"
            : "";
      fail(`${name}: relay answered HTTP ${res.statusCode}${hint}`);
    });
    ws.on("error", (err) => fail(`${name}: ${err.message}`));
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === "error") {
        if (msg.reason === "update-required") fail(`${name}: relay says update-required (it is not on protocol v${PROTOCOL_VERSION})`);
        if (msg.reason !== "quick-disabled") fail(`${name}: relay error ${msg.reason}`);
      }
      inbox.push(msg);
      for (const w of [...waiters]) w();
    });
    const client = {
      name,
      inbox,
      send: (msg) => ws.send(JSON.stringify(msg)),
      /** Resolve with the first message (from now on, or already queued) matching pred. */
      next(pred) {
        return new Promise((res) => {
          const check = () => {
            const i = inbox.findIndex(pred);
            if (i < 0) return;
            waiters.splice(waiters.indexOf(check), 1);
            res(inbox.splice(i, 1)[0]);
          };
          waiters.push(check);
          check();
        });
      },
      close: () => ws.close(),
    };
    ws.on("open", () => resolve(client));
  });
}

async function health() {
  const u = new URL(url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "/healthz";
  u.search = "";
  let body;
  try {
    const res = await fetch(u);
    if (!res.ok) fail(`GET ${u} answered HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    fail(`GET ${u} failed: ${err.message}`);
  }
  if (body.ok !== true) fail(`/healthz did not say ok: ${JSON.stringify(body)}`);
  if (body.v !== PROTOCOL_VERSION) fail(`update-required: relay is on protocol v${body.v}, this tool speaks v${PROTOCOL_VERSION}`);
  console.log(`ok   /healthz  v${body.v}  rooms=${body.rooms} conns=${body.conns} queue=${body.queue} uptime=${body.uptime}s`);
}

async function codeMatch() {
  const a = await connect("host");
  const b = await connect("guest");
  a.send({ t: "create", v: PROTOCOL_VERSION, deck: DECK_A, mode: MODE, loadout: loadout("Smoke A") });
  const created = await a.next((m) => m.t === "created");
  if (!/^[A-Z0-9-]{3,12}$/.test(created.code)) fail(`odd room code ${created.code}`);
  b.send({ t: "join", v: PROTOCOL_VERSION, code: created.code, deck: DECK_B, loadout: loadout("Smoke B") });
  const [sa, sb] = await Promise.all([a.next((m) => m.t === "start"), b.next((m) => m.t === "start")]);
  if (sa.role !== "host" || sb.role !== "guest") fail("roles were not host/guest");
  if (sa.mode.seed !== sb.mode.seed || sa.delay !== sb.delay) fail("peers got different seeds or delays");
  if (sa.token === sb.token) fail("both seats got the same resume token");
  console.log(`ok   code match  ${created.code}  delay=${sa.delay} ticks  seed=${sa.mode.seed}`);

  // Each side streams 30 frames: one deploy each, and the host fires its ability.
  for (let tick = 0; tick < FRAMES; tick++) {
    const hostFrame = { tick, side: "player", commands: [] };
    if (tick === 5) hostFrame.commands.push({ side: "player", cardId: "knight", x: 9, y: 24 });
    if (tick === 10) hostFrame.ability = true;
    // The guest lies about its side; the relay must rewrite it.
    const guestFrame = { tick, side: "player", commands: [] };
    if (tick === 6) guestFrame.commands.push({ side: "player", cardId: "wizard", x: 9, y: 8 });
    a.send({ t: "frame", frame: hostFrame });
    b.send({ t: "frame", frame: guestFrame });
  }
  const got = async (client, side) => {
    const frames = [];
    while (frames.length < FRAMES) frames.push((await client.next((m) => m.t === "frame")).frame);
    if (frames.some((f, i) => f.tick !== i || f.side !== side)) fail(`${client.name} got frames out of order or with the wrong side`);
    return frames;
  };
  const [atHost, atGuest] = await Promise.all([got(a, "enemy"), got(b, "player")]);
  if (atGuest[5].commands[0]?.cardId !== "knight") fail("the host's deploy did not arrive");
  if (atGuest[10].ability !== true) fail("the host's ability flag did not arrive");
  const wizard = atHost[6].commands[0];
  if (wizard?.cardId !== "wizard" || wizard.side !== "enemy") fail("the guest's deploy did not arrive rewritten to side enemy");
  console.log(`ok   frames  ${FRAMES} each way, deploys + ability relayed, guest side rewritten`);

  // Ping/pong round trips.
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    const at = performance.now();
    a.send({ t: "ping", at, ...(rtts.length ? { rtt: Math.round(rtts[rtts.length - 1]) } : {}) });
    await a.next((m) => m.t === "pong" && m.at === at);
    rtts.push(performance.now() - at);
  }
  const sorted = [...rtts].sort((x, y) => x - y);
  console.log(`ok   ping  median RTT ${sorted[2].toFixed(1)} ms (min ${sorted[0].toFixed(1)}, max ${sorted[4].toFixed(1)})`);

  a.send({ t: "leave" });
  await b.next((m) => m.t === "peer-left");
  a.close();
  b.close();
}

async function quickMatch() {
  const c = await connect("quick-1");
  const d = await connect("quick-2");
  // A mode nobody else is likely queued for, so the two smoke sockets pair up.
  const mode = { elixirRate: 7, mirror: true, crazy: true };
  c.send({ t: "quick", v: PROTOCOL_VERSION, deck: DECK_A, loadout: loadout("Smoke C"), mode });
  const queued = await c.next((m) => m.t === "queued" || m.t === "start" || m.t === "error");
  if (queued.t === "error") {
    console.log("skip quick match  (disabled on this relay: QUICK_MATCH=off)");
    c.close();
    d.close();
    return;
  }
  if (queued.t === "start") fail("quick match paired with a stranger; retry when the queue is quiet");
  d.send({ t: "quick", v: PROTOCOL_VERSION, deck: DECK_B, loadout: loadout("Smoke D"), mode });
  const [sc, sd] = await Promise.all([c.next((m) => m.t === "start"), d.next((m) => m.t === "start")]);
  if (sc.role !== "host" || sd.role !== "guest") fail("quick match roles were not host/guest");
  console.log(`ok   quick match  paired (queue position was ${queued.position})`);
  c.send({ t: "leave" });
  c.close();
  d.close();
}

await health();
await codeMatch();
await quickMatch();
clearTimeout(timer);
console.log("PASS: relay is healthy");
process.exit(0);
