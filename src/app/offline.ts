/**
 * The page's side of the offline worker (public/sw.js).
 *
 * - startOfflineSupport() registers the worker (production builds only; in
 *   dev it would cache Vite's module graph and fight hot reload), takes the
 *   one-shot ?cr-fresh mark back off the address, and says "Ready to play
 *   offline!" once per device when the worker reports the whole build
 *   cached (OFFLINE_READY_SEEN_KEY), on the first menu screen after that
 *   (never over a battle's cards: see calmGate).
 * - reloadToNewest() is the "update needed" reload: it asks the browser for
 *   the newest worker and gives it a moment to take over, then reloads with
 *   ?cr-fresh, which the worker answers with the network's newest page
 *   instead of the cached one (it still falls back to the cached game when
 *   there is no connection). A plain location.reload() could land on the
 *   stale cached page that caused the update notice in the first place.
 *
 * Nothing here talks to anything but this game's own origin.
 */
import { toast } from "../ui/components";
import { tr } from "../ui/i18n";
import { on } from "./hooks";

/** Set once the "Ready to play offline!" note was shown on this device. */
export const OFFLINE_READY_SEEN_KEY = "cr-clone-offline-ready-seen";
/** The one-shot address mark public/sw.js answers with the network's newest page. */
export const FRESH_PARAM = "cr-fresh";
/** What public/sw.js posts once its build is fully cached, and what asks it. */
export const READY_MESSAGE = "cr-offline-ready";
export const ASK_READY_MESSAGE = "cr-offline?";

/** `href` carrying the fresh mark (a new value each time, so it is never a cached address). */
export function freshUrl(href: string, now = Date.now()): string {
  const url = new URL(href);
  url.searchParams.set(FRESH_PARAM, now.toString(36));
  return url.href;
}

/** `href` without the fresh mark, or null when it carries none. */
export function withoutFresh(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(FRESH_PARAM)) return null;
  url.searchParams.delete(FRESH_PARAM);
  return url.href;
}

/** `p`, or undefined once `ms` pass first (a sleeping server never holds the kid up for long). */
function within<T>(p: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!p) return Promise.resolve(undefined);
  return Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

/** The parts of a ServiceWorker this file uses. */
interface WorkerLike {
  readonly state: string;
  addEventListener(type: "statechange", fn: () => void): void;
  removeEventListener(type: "statechange", fn: () => void): void;
}

/** The parts of a ServiceWorkerRegistration this file uses. */
interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
}

/** Resolves once `worker` has taken over (or given up). */
function settled(worker: WorkerLike): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (worker.state !== "activated" && worker.state !== "redundant") return;
      worker.removeEventListener("statechange", check);
      resolve();
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

export interface ReloadDeps {
  /** navigator.serviceWorker, or null where there is none. */
  getRegistration: (() => Promise<RegistrationLike | undefined>) | null;
  /** The page's address now. */
  href: string;
  /** Leave for `href` (location.replace: the stale page is not kept in history). */
  go(href: string): void;
  /** Called once if the new worker is still on its way after a moment (a "please wait" note). */
  onWait?(): void;
  updateMs?: number;
  activateMs?: number;
  waitNoteMs?: number;
}

let reloading = false;

/**
 * Reload onto the newest game: refresh the worker registration and give a
 * new worker up to a few seconds to take over, then reload with the fresh
 * mark. Never throws and never hangs: whatever happens, it reloads.
 */
export async function reloadToNewest(deps: ReloadDeps = browserReloadDeps()): Promise<void> {
  if (reloading) return;
  reloading = true;
  const note = deps.onWait ? setTimeout(() => deps.onWait?.(), deps.waitNoteMs ?? 700) : undefined;
  try {
    const reg = await within(deps.getRegistration?.(), 3000);
    if (reg) {
      await within(reg.update().catch(() => undefined), deps.updateMs ?? 6000);
      const next = reg.installing ?? reg.waiting;
      if (next) await within(settled(next), deps.activateMs ?? 10_000);
    }
  } catch {
    // the reload below still asks for the network's newest page
  } finally {
    if (note !== undefined) clearTimeout(note);
    reloading = false;
  }
  deps.go(freshUrl(deps.href));
}

function browserReloadDeps(): ReloadDeps {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  return {
    getRegistration: sw ? () => sw.getRegistration() : null,
    href: location.href,
    go: (href) => location.replace(href),
    onWait: () => toast(tr("Getting the newest game…", "نجلب أحدث نسخة من اللعبة…"), "accent", 10_000),
  };
}

/** True once the offline note was shown on this device (storage that fails counts as not yet). */
function seen(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(OFFLINE_READY_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(OFFLINE_READY_SEEN_KEY, "1");
  } catch {
    // storage blocked: the note may show again on another launch, which is harmless
  }
}

/** The parts of navigator.serviceWorker startOfflineSupport uses. */
export interface ContainerLike {
  register(url: string): Promise<unknown>;
  readonly ready: Promise<{ active: { postMessage(msg: unknown): void } | null }>;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
  removeEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
  startMessages?(): void;
}

export interface OfflineDeps {
  /** navigator.serviceWorker, or null where there is none (or in dev). */
  container: ContainerLike | null;
  /** The worker's address (`${BASE_URL}sw.js`). */
  workerUrl: string;
  /** Where the seen flag lives (localStorage). */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** The page's address now, and how to rewrite it without a reload. */
  href: string;
  replaceHref(href: string): void;
  /** Run `fn` once the page has finished loading (window "load"), or now if it has. */
  afterLoad(fn: () => void): void;
  /** Run `fn` once the game is on screen and the kid is on a menu, or now if so (calmGate). */
  whenCalm(fn: () => void): void;
  /** Show the note (a toast). */
  onReady(): void;
}

/** Register the worker, clean the address and show the offline note once per device. */
export function startOfflineSupport(deps: OfflineDeps): void {
  const clean = withoutFresh(deps.href);
  if (clean) deps.replaceHref(clean);
  const sw = deps.container;
  if (!sw) return;
  // After the page's own load: the precache then reads the files the boot
  // just fetched from the browser's HTTP cache instead of downloading twice.
  deps.afterLoad(() => void sw.register(deps.workerUrl).catch(() => undefined));
  if (seen(deps.storage)) return;
  let done = false;
  const onMessage = (e: { data: unknown }): void => {
    if (done || (e.data as { type?: unknown } | null)?.type !== READY_MESSAGE) return;
    done = true;
    sw.removeEventListener("message", onMessage);
    deps.whenCalm(() => {
      if (seen(deps.storage)) return;
      markSeen(deps.storage);
      deps.onReady();
    });
  };
  sw.addEventListener("message", onMessage);
  sw.startMessages?.();
  // A worker that finished caching on an earlier launch answers this.
  void sw.ready.then((reg) => reg.active?.postMessage({ type: ASK_READY_MESSAGE })).catch(() => undefined);
}

/** What calmGate watches: the boot (body.booted) and the screen hook. */
export interface CalmDeps {
  /** True once the game is on screen (body.booted). */
  booted(): boolean;
  /** Run `fn` once, when the game comes on screen (only asked while it is not). */
  onBooted(fn: () => void): void;
  /** Every screen change (the "screen" hook: sceneMode "battle", "diorama" or "none"). */
  onScreen(fn: (screen: { sceneMode: string }) => void): void;
}

/**
 * A gate for the one-time offline note: the returned `whenCalm(fn)` runs fn
 * once the game is on screen and the kid is on a menu (Home, a picker, the
 * lobby), never during a battle or the guided first battle, where a note
 * would sit over the card tray. It must be made before the boot shows its
 * first screen: until a screen is seen, nothing counts as calm.
 */
export function calmGate(deps: CalmDeps): (fn: () => void) => void {
  let mode: string | null = null;
  let watching = false;
  const queued: (() => void)[] = [];
  const flush = (): void => {
    if (mode === null || mode === "battle" || !deps.booted()) return;
    for (const fn of queued.splice(0)) fn();
  };
  deps.onScreen((screen) => {
    mode = screen.sceneMode;
    flush();
  });
  return (fn) => {
    queued.push(fn);
    if (!watching && !deps.booted()) {
      watching = true;
      deps.onBooted(flush);
    }
    flush();
  };
}

/** startOfflineSupport's browser wiring. Make it before the boot shows a screen (see calmGate). */
export function browserOfflineDeps(base: string, onReady: () => void): OfflineDeps {
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // storage blocked (a private window): the note may show again later
  }
  return {
    container: "serviceWorker" in navigator ? (navigator.serviceWorker as unknown as ContainerLike) : null,
    workerUrl: `${base}sw.js`,
    storage,
    href: location.href,
    replaceHref: (href) => history.replaceState(history.state, "", href),
    afterLoad: (fn) => (document.readyState === "complete" ? fn() : window.addEventListener("load", fn, { once: true })),
    whenCalm: calmGate({
      booted: () => document.body.classList.contains("booted"),
      onBooted: (fn) => {
        const body = document.body;
        const watch = new MutationObserver(() => {
          if (!body.classList.contains("booted")) return;
          watch.disconnect();
          fn();
        });
        watch.observe(body, { attributes: true, attributeFilter: ["class"] });
      },
      onScreen: (fn) => void on("screen", fn),
    }),
    onReady,
  };
}
