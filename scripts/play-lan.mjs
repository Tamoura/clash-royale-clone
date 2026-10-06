// One command to host a LAN match: starts the Vite dev server (exposed to the
// local network) and the relay, then prints the link to give your kids.
//
//   npm run play
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";

const VITE_PORT = 3101;
const RELAY_PORT = 3110;

function lanIp() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "localhost";
}

const RELAY_BUNDLE = "dist-server/relay.mjs";
/** Sources the relay bundle is built from; newer files trigger a rebuild. */
const RELAY_SOURCES = ["server", "src/net", "src/game"];

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** Build the relay bundle when it is missing or older than its sources. */
function ensureRelayBundle() {
  const stale =
    !existsSync(RELAY_BUNDLE) ||
    RELAY_SOURCES.some((dir) => existsSync(dir) && newestMtime(dir) > statSync(RELAY_BUNDLE).mtimeMs);
  if (!stale) return;
  console.log("[play] building the relay…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npm, ["run", "--silent", "build:relay"], { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error("[play] relay build failed; see the output above.");
    process.exit(1);
  }
}

ensureRelayBundle();
const ip = lanIp();
const bin = process.platform === "win32" ? "vite.cmd" : "vite";

const vite = spawn(`node_modules/.bin/${bin}`, ["--host", "--port", String(VITE_PORT), "--strictPort"], {
  stdio: "inherit",
});
const relay = spawn(process.execPath, [RELAY_BUNDLE], {
  stdio: "inherit",
  // PORT wins over RELAY_PORT in the relay, so pin both for the LAN setup.
  env: { ...process.env, PORT: String(RELAY_PORT), RELAY_PORT: String(RELAY_PORT) },
});

console.log("\n" + "=".repeat(46));
console.log("  Clash Royale — LAN 1v1 is ready!");
console.log("  On each kid's device (same WiFi), open:");
console.log(`\n      http://${ip}:${VITE_PORT}\n`);
console.log("  One taps 'Play a Friend' → Create, reads the code");
console.log("  aloud; the other taps Join and types it in.");
console.log("=".repeat(46) + "\n");

function shutdown() {
  vite.kill();
  relay.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
