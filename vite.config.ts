/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";

/**
 * Serve the Unity WebGL build (/unity/*) with no-store so a rebuilt edition is
 * always picked up — Unity's Build/*.wasm/.data filenames are stable, so the
 * browser would otherwise serve a stale cached build.
 */
function noCacheUnity(): Plugin {
  return {
    name: "no-cache-unity",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/unity/")) {
          res.setHeader("Cache-Control", "no-store, must-revalidate");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [noCacheUnity()],
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
