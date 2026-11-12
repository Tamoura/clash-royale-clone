/**
 * The relay process itself, end to end over real sockets: friends-only by
 * default (Quick match refused), and the wrong-code limit wired to "join".
 * server/relay.ts is bundled the way `npm run build:relay` bundles it, then
 * run as a child process on a free port. Each socket says which address it
 * comes from through a test header (TRUST_PROXY names it), so one test can
 * play several homes without waiting out the pairing limit.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type ServerMsg } from "../src/net/protocol";
import { HOST_DECK, GUEST_DECK, MODE, HOST, GUEST } from "../src/net/memRelay.testkit";

let dir: string;
let relay: ChildProcess;
let port: number;
const sockets: WebSocket[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "relay-test-"));
  const outfile = join(dir, "relay.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./relay.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    // ws is bundled too (the bundle lives outside the repo); its optional
    // native helpers are not installed, and ws copes without them.
    external: ["bufferutil", "utf-8-validate"],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: "silent",
  });
  port = await freePort();
  relay = spawn(process.execPath, [outfile, "--relay-only"], {
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      TRUST_PROXY: "x-test-client",
      ALLOWED_ORIGINS: "*",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`relay did not start: ${out}`)), 15_000);
    const onData = (b: Buffer): void => {
      out += b.toString();
      if (out.includes('"event":"listening"')) {
        clearTimeout(timer);
        resolve();
      }
    };
    relay.stdout!.on("data", onData);
    relay.stderr!.on("data", onData);
    relay.on("exit", (code) => reject(new Error(`relay exited (${code}): ${out}`)));
  });
}, 30_000);

afterAll(() => {
  for (const s of sockets) s.terminate();
  relay?.kill("SIGKILL");
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A client from `address`, with a queue of what the relay sent it. */
async function client(address: string): Promise<{ send: (m: object) => void; next: () => Promise<ServerMsg> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { "x-test-client": address } });
  sockets.push(ws);
  const inbox: ServerMsg[] = [];
  const waiting: ((m: ServerMsg) => void)[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as ServerMsg;
    if (msg.t === "pong") return;
    const w = waiting.shift();
    if (w) w(msg);
    else inbox.push(msg);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return {
    send: (m) => ws.send(JSON.stringify(m)),
    next: () =>
      new Promise<ServerMsg>((resolve, reject) => {
        const m = inbox.shift();
        if (m) return resolve(m);
        const timer = setTimeout(() => reject(new Error("no reply from the relay")), 5_000);
        waiting.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      }),
  };
}

const create = { t: "create", v: PROTOCOL_VERSION, deck: HOST_DECK, mode: MODE, loadout: HOST };
const joinMsg = (code: string) => ({ t: "join", v: PROTOCOL_VERSION, code, deck: GUEST_DECK, loadout: GUEST });

/** Host a room from `address`; returns its code. */
async function hostRoom(address: string): Promise<{ code: string; next: () => Promise<ServerMsg> }> {
  const host = await client(address);
  host.send(create);
  const created = await host.next();
  if (created.t !== "created") throw new Error(`expected created, got ${JSON.stringify(created)}`);
  return { code: created.code, next: host.next };
}

/** One join attempt from `address` (a fresh socket, as the game does). */
async function tryJoin(address: string, code: string): Promise<ServerMsg> {
  const guest = await client(address);
  guest.send(joinMsg(code));
  return guest.next();
}

describe("relay: friends only", () => {
  it("refuses Quick match unless QUICK_MATCH=on", async () => {
    const c = await client("192.0.2.1");
    c.send({ t: "quick", v: PROTOCOL_VERSION, deck: HOST_DECK, loadout: HOST, mode: MODE });
    expect(await c.next()).toEqual({ t: "error", reason: "quick-disabled" });
  });

  it("hands out word + 3 digit codes", async () => {
    const { code } = await hostRoom("192.0.2.2");
    expect(code).toMatch(/^[A-Z]{3,4}\d{3}$/);
  });
});

describe("relay: wrong room codes", () => {
  it("a few typos, then the right code, still starts the match", async () => {
    const room = await hostRoom("192.0.2.10");
    for (let i = 0; i < 9; i++) {
      // A different address in the same home network each time (one IPv6 /64),
      // so the per-IP pairing limit (5 per 10 s) stays out of the way.
      expect(await tryJoin(`2001:db8:a:1::${i + 1}`, "ZZZ999")).toEqual({ t: "error", reason: "no-such-room" });
    }
    expect((await tryJoin("2001:db8:a:1::99", room.code)).t).toBe("start");
    expect((await room.next()).t).toBe("start");
  });

  it("after 10 wrong codes, the 11th try is 'rate-limited', even with the right code", async () => {
    const room = await hostRoom("192.0.2.20");
    for (let i = 0; i < 10; i++) {
      expect(await tryJoin(`2001:db8:b:1::${i + 1}`, `LION${String(i).padStart(3, "0")}X`)).toEqual({
        t: "error",
        reason: "no-such-room",
      });
    }
    expect(await tryJoin("2001:db8:b:1::f1", "WOLF123X")).toEqual({ t: "error", reason: "rate-limited" });
    expect(await tryJoin("2001:db8:b:1:ffff::1", room.code)).toEqual({ t: "error", reason: "rate-limited" });
    // Another home is not affected, and its friend's room still works.
    expect((await tryJoin("2001:db8:c:1::1", room.code)).t).toBe("start");
  });
});
