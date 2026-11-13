/**
 * Versioning and precaching for the offline service worker (public/sw.js).
 * The worker names its cache after a build id so every deploy starts a fresh
 * cache, and it installs every file the build emitted under assets/ so an
 * installed game opens with no connection. The Vite plugin in vite.config.ts
 * stamps both into the built copy with these helpers (kept free of Node APIs
 * so they are testable and typecheck here).
 */

/** The placeholder public/sw.js carries until a build stamps it. */
export const BUILD_ID_PLACEHOLDER = "__BUILD_ID__";

/**
 * The precache list's placeholder in public/sw.js: an empty array literal
 * behind a marker comment, so the unstamped source still runs (tests, dev).
 */
export const PRECACHE_PLACEHOLDER = "/* __PRECACHE__ */ []";

/**
 * A build id: the short git sha (or "nogit" outside a checkout), the build
 * time and a few high-resolution digits, so two builds of one commit, even
 * within one millisecond, still differ.
 */
export function composeBuildId(sha: string, nowMs: number, hires: bigint): string {
  return `${sha || "nogit"}-${nowMs.toString(36)}${hires.toString(36).slice(-4)}`;
}

/** Replace every placeholder in the service worker source with the build id. */
export function stampBuildId(source: string, id: string): string {
  return source.split(BUILD_ID_PLACEHOLDER).join(id);
}

/** "assets", whatever slashes the config wrote around it. */
const folder = (assetsDir: string): string => assetsDir.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "");

/**
 * The files to precache: every emitted file under the build's assets folder
 * (the JS chunks, the CSS, the fonts the CSS points at, anything else Vite
 * hashed), as paths relative to the worker's scope ("assets/index-Ab12.js"),
 * so one list works under "/" (Render) and under "/clash-royale-clone/"
 * (GitHub Pages). Source maps are left out (the game never loads them).
 * Sorted, so a build's stamped worker does not depend on emit order.
 *
 * `fileNames` are the keys of Rollup's output bundle, relative to the
 * output folder.
 */
export function precacheList(fileNames: Iterable<string>, assetsDir = "assets"): string[] {
  const dir = `${folder(assetsDir)}/`;
  const out = new Set<string>();
  for (const raw of fileNames) {
    const name = raw.replace(/\\/g, "/").replace(/^\.?\/+/, "");
    if (!name.startsWith(dir) || name.length === dir.length || name.endsWith(".map")) continue;
    out.add(name);
  }
  return [...out].sort();
}

/** Put the precache list into the service worker source, in place of its empty placeholder. */
export function stampPrecache(source: string, list: readonly string[]): string {
  if (!source.includes(PRECACHE_PLACEHOLDER)) {
    throw new Error(`the service worker has no ${PRECACHE_PLACEHOLDER} placeholder to stamp`);
  }
  return source.split(PRECACHE_PLACEHOLDER).join(JSON.stringify(list));
}

/**
 * Files on disk in the assets folder that the list leaves out (the build
 * fails on any, so an installed game never opens to a file it did not keep).
 * `onDisk` are the names inside the assets folder ("index-Ab12.js").
 */
export function unlisted(list: readonly string[], onDisk: Iterable<string>, assetsDir = "assets"): string[] {
  const dir = folder(assetsDir);
  const listed = new Set(list);
  const out: string[] = [];
  for (const file of onDisk) {
    if (file.endsWith(".map")) continue;
    const path = `${dir}/${file}`;
    if (!listed.has(path)) out.push(path);
  }
  return out.sort();
}
