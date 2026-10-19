// The one-service build (Render, `npm start`, the Dockerfile): the game in
// dist/, served from "/" and talking to the relay on its own address
// (VITE_RELAY_URL=same-origin), plus the relay bundle in dist-server/ that
// serves both.
//
//   npm run build:all && npm start
//
// The GitHub Pages copy keeps using plain `npm run build` (its own base
// path and relay URL come from .github/workflows/deploy.yml).
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  VITE_BASE: "/",
  VITE_RELAY_URL: process.env.VITE_RELAY_URL || "same-origin",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const script of ["build", "build:relay"]) {
  const res = spawnSync(npm, ["run", script], { stdio: "inherit", env, shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`[build:all] npm run ${script} failed; see the output above.`);
    process.exit(res.status ?? 1);
  }
}
console.log("[build:all] done: start it with `npm start` (serves the game and the relay on $PORT, default 3110)");
