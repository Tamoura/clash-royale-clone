/**
 * Page-wide error traps: window 'error' and 'unhandledrejection' feed the
 * same local problem log as the crash shield (nothing leaves the device).
 *
 * main.ts imports this module first, so the listeners are on before any
 * other module of the game runs (an error while the rest loads is caught
 * too). They only record: the browser still prints the error as usual, and
 * nothing is prevented, so bugs stay loud. An error the crash shield has
 * already recorded and thrown on (dev server) is not counted twice.
 */
import { problemLog, type ProblemLog } from "./problemLog";

/** The parts of window the traps use. */
export interface TrapTarget {
  addEventListener(type: string, fn: (ev: Event) => void): void;
  removeEventListener(type: string, fn: (ev: Event) => void): void;
}

/** What an ErrorEvent carries (no DOM types needed). */
interface ErrorEventLike {
  error?: unknown;
  message?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
}

/** The thing to record for an 'error' event: its error, or what the event says. */
export function errorFromEvent(ev: ErrorEventLike): unknown {
  if (ev.error !== undefined && ev.error !== null) return ev.error;
  const message = typeof ev.message === "string" && ev.message ? ev.message : "Script error";
  const where =
    typeof ev.filename === "string" && ev.filename ? `at ${ev.filename}:${Number(ev.lineno) || 0}:${Number(ev.colno) || 0}` : "";
  return { name: "Error", message, stack: where };
}

/** Listen on `target`; returns the uninstall. */
export function installErrorTraps(target: TrapTarget, log: ProblemLog = problemLog): () => void {
  const onError = (ev: Event): void => {
    const e = ev as unknown as ErrorEventLike;
    if (log.wasRecorded(e.error)) return;
    log.record("error", errorFromEvent(e));
  };
  const onRejection = (ev: Event): void => {
    const reason = (ev as unknown as { reason?: unknown }).reason;
    if (log.wasRecorded(reason)) return;
    log.record("promise", reason ?? "Unhandled promise rejection (no reason given)");
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  installErrorTraps(window);
}
