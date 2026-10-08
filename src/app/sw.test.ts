import { describe, expect, it } from "vitest";
import sw from "../../public/sw.js?raw";
import viteConfig from "../../vite.config.ts?raw";
import { BUILD_ID_PLACEHOLDER, composeBuildId, stampBuildId } from "./swStamp";

describe("service worker versioning", () => {
  it("names its cache after a build id the build stamps in", () => {
    expect(sw).toContain(`const BUILD_ID = "${BUILD_ID_PLACEHOLDER}"`);
    expect(sw).toMatch(/const CACHE = `cr-clone-\$\{BUILD_ID\}`/);
    // vite.config.ts wires the stamp into the built copy of sw.js.
    expect(viteConfig).toContain("stampBuildId");
    expect(viteConfig).toContain('"sw.js"');
  });

  it("two builds stamp different ids and no placeholder survives", () => {
    const a = stampBuildId(sw, composeBuildId("abc1234", 1_000, 123_456_789n));
    const b = stampBuildId(sw, composeBuildId("abc1234", 1_000, 123_456_790n)); // same sha, same millisecond
    const c = stampBuildId(sw, composeBuildId("abc1234", 1_001, 123_456_789n));
    for (const src of [a, b, c]) expect(src).not.toContain(BUILD_ID_PLACEHOLDER);
    const id = (src: string): string => /const BUILD_ID = "([^"]+)"/.exec(src)![1];
    expect(new Set([id(a), id(b), id(c)]).size).toBe(3);
    expect(id(a)).toMatch(/^abc1234-[0-9a-z]+$/);
    expect(composeBuildId("", 5, 5n)).toMatch(/^nogit-/);
  });

  it("deletes every older cache when it activates", () => {
    const activate = sw.slice(sw.indexOf('addEventListener("activate"'), sw.indexOf('addEventListener("fetch"'));
    expect(activate.replace(/\s+/g, "")).toContain("caches.keys()");
    expect(activate).toContain("k !== CACHE");
    expect(activate).toContain("caches.delete(k)");
    expect(activate).toContain("clients.claim()");
  });

  it("serves /assets/* cache-first with no background refetch, and pages network-first", () => {
    expect(sw).toContain('new URL("assets/", self.registration.scope)');
    const from = sw.indexOf("url.pathname.startsWith(ASSETS)");
    const to = sw.indexOf("event.respondWith(\n    caches.match(req).then((hit) => {\n      const refresh");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const assets = sw.slice(from, to);
    // A hit returns at once; only a miss reaches the network, and nothing refreshes a hit.
    expect(assets).toContain("hit ??");
    expect(assets).not.toContain("refresh");
    const nav = sw.slice(sw.indexOf('req.mode === "navigate"'), from);
    expect(nav.indexOf("fetch(req)")).toBeLessThan(nav.indexOf("caches.match"));
  });
});
