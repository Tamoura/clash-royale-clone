/**
 * Versioning for the offline service worker (public/sw.js). The worker names
 * its cache after a build id so every deploy starts a fresh cache; the Vite
 * plugin in vite.config.ts stamps the id into the built copy with these
 * helpers (kept free of Node APIs so they are testable and typecheck here).
 */

/** The placeholder public/sw.js carries until a build stamps it. */
export const BUILD_ID_PLACEHOLDER = "__BUILD_ID__";

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
