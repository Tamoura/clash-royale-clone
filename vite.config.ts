/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
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
