// One command to host a LAN match: starts the Vite dev server (exposed to the
// local network) and the relay, then prints the link to give your kids.
//
//   npm run play
import { spawn } from "node:child_process";
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

const ip = lanIp();
const bin = process.platform === "win32" ? "vite.cmd" : "vite";

const vite = spawn(`node_modules/.bin/${bin}`, ["--host", "--port", String(VITE_PORT), "--strictPort"], {
  stdio: "inherit",
});
const relay = spawn(process.execPath, ["server/relay.ts"], {
  stdio: "inherit",
  env: { ...process.env, RELAY_PORT: String(RELAY_PORT) },
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
