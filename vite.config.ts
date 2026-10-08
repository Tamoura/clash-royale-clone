/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { composeBuildId, stampBuildId } from "./src/app/swStamp";

/** A new id for every build (see src/app/swStamp.ts): short git sha plus the build time. */
function buildId(): string {
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // not a git checkout (a tarball build): the timestamp alone still differs
  }
  return composeBuildId(sha, Date.now(), process.hrtime.bigint());
}

/** Replace __BUILD_ID__ in the built service worker (dist/sw.js is copied verbatim from public/). */
function swBuildId(): Plugin {
  const id = buildId();
  return {
    name: "sw-build-id",
    apply: "build",
    writeBundle(options) {
      const file = join(options.dir ?? "dist", "sw.js");
      try {
        writeFileSync(file, stampBuildId(readFileSync(file, "utf8"), id));
      } catch {
        // no sw.js in this build: nothing to stamp
      }
    },
  };
}

export default defineConfig({
  // Base path: "/" for local dev; the GitHub Pages workflow sets VITE_BASE
  // to "/clash-royale-clone/" so asset URLs resolve under the project subpath.
  base: process.env.VITE_BASE || "/",
  plugins: [swBuildId()],
  build: {
    rollupOptions: {
      // three.js is most of the bundle and changes far less often than the
      // game code: its own hashed chunk stays cached across deploys.
      output: { manualChunks: { three: ["three"] } },
    },
  },
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
    include: ["src/**/*.test.ts"],
  },
});
