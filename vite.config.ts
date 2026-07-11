/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Base path: "/" for local dev; the GitHub Pages workflow sets VITE_BASE
  // to "/clash-royale-clone/" so asset URLs resolve under the project subpath.
  base: process.env.VITE_BASE || "/",
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
