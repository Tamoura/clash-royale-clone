/**
 * Which build is running, for the local problem log and the Problem report.
 *
 * A production build gets the same id the service worker's cache is named
 * after (vite.config.ts computes it once and both the sw stamp and the
 * __APP_BUILD__ define share it). The dev server and vitest say "dev".
 */

// Replaced at build time by vite.config.ts (define). Never declared at run
// time, so it is only ever read behind a typeof guard.
declare const __APP_BUILD__: string | undefined;

/** The id from the build, or "dev" when there is none (dev server, tests). */
export function resolveBuildId(defined: unknown, dev: boolean): string {
  if (dev) return "dev";
  return typeof defined === "string" && defined.trim() !== "" ? defined.trim() : "dev";
}

/** This page's build id. */
export const BUILD_ID: string = resolveBuildId(
  typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : undefined,
  import.meta.env.DEV,
);
