/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { composeBuildId, precacheList, stampBuildId, stampPrecache, unlisted } from "./src/app/swStamp";

/**
 * A new id for every build (see src/app/swStamp.ts): short git sha plus the
 * build time. Called once, for BUILD_ID below.
 */
function buildId(): string {
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // not a git checkout (a tarball build): the timestamp alone still differs
  }
  return composeBuildId(sha, Date.now(), process.hrtime.bigint());
}

/** Every file under `dir` (sub-folders too), relative to it, with forward slashes. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).split("\\").join("/"));
    }
  };
  walk(dir);
  return out;
}

/**
 * This build's id, worked out once so everything stamped with it agrees:
 * the service worker's cache name (swStamp below) and the app's
 * __APP_BUILD__ (src/app/buildInfo.ts, the problem log and Problem report).
 */
const BUILD_ID = buildId();

/**
 * Stamp the built service worker (dist/sw.js is copied verbatim from
 * public/): its cache name gets this build's id, and its precache list gets
 * every file the build emitted under assets/ (see src/app/swStamp.ts). The
 * build fails if a file on disk in dist/assets is missing from the list, so
 * an installed game always has every file it needs to open offline.
 */
function swStamp(): Plugin {
  let assetsDir = "assets";
  return {
    name: "sw-stamp",
    apply: "build",
    configResolved(config) {
      assetsDir = config.build.assetsDir;
    },
    writeBundle(options, bundle) {
      const outDir = options.dir ?? "dist";
      const file = join(outDir, "sw.js");
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        return; // no sw.js in this build: nothing to stamp
      }
      const list = precacheList(Object.keys(bundle), assetsDir);
      let onDisk: string[] = [];
      try {
        onDisk = filesUnder(join(outDir, assetsDir));
      } catch {
        // no assets folder: nothing on disk to check against
      }
      const missing = unlisted(list, onDisk, assetsDir);
      if (missing.length) throw new Error(`sw-stamp: files in ${assetsDir}/ missing from the precache list: ${missing.join(", ")}`);
      writeFileSync(file, stampPrecache(stampBuildId(source, BUILD_ID), list));
    },
  };
}

export default defineConfig({
  // Base path: "/" for local dev; the GitHub Pages workflow sets VITE_BASE
  // to "/clash-royale-clone/" so asset URLs resolve under the project subpath.
  base: process.env.VITE_BASE || "/",
  plugins: [swStamp()],
  build: {
    rollupOptions: {
      // three.js is most of the bundle and changes far less often than the
      // game code: its own hashed chunk stays cached across deploys.
      output: { manualChunks: { three: ["three"] } },
    },
  },
  // The build id in the app (problem log, Problem report): the same BUILD_ID
  // the service worker is stamped with. Dev and vitest read "dev"
  // (src/app/buildInfo.ts).
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  // Listen on every interface (IPv4 + IPv6) so localhost always works
  // regardless of how the browser resolves it, and other devices on
  // the LAN (tablets/phones) can join via this machine's IP.
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  test: {
    globals: true,
    environment: "node",
    // server/ holds the relay's Node-only glue (static file serving).
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    // The rig bake/budget suites build every troop in both editions and
    // run near vitest's 5 s default under load; each new troop adds more.
    testTimeout: 20_000,
  },
});
