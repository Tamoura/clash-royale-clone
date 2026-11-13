/**
 * The crash shield around the game loop: never a frozen battle.
 *
 * main.ts runs each animation frame through {@link CrashShield.runFrame},
 * which schedules the next frame in a `finally`, so whatever throws, from
 * any line of the frame (the sim, the bot, a hook, the renderer), the loop
 * goes on. Every caught error is recorded in the local problem log and
 * printed (identical messages are throttled: counted, not repeated).
 *
 * Some parts of a frame must run even when an earlier part threw (a battle
 * event's sounds and effects must never stop the match from settling):
 * main.ts runs them through {@link CrashShield.guard}, which handles a
 * throw the same way (recorded, printed, counted toward a storm) and lets
 * the rest of the frame go on.
 *
 * One stray error: the game carries on. A storm (STORM_ERRORS errors within
 * STORM_WINDOW_MS, or STORM_FRAMES failed frames in a row, which catches an
 * error on every frame of a slow device too) asks the app to hold the solo
 * sim and show the "Oops!" overlay, once: no re-entry until the kid picks
 * Keep playing or Back to menu. A storm soon after Keep playing (AGAIN_MS)
 * says so, and the overlay then puts Back to menu first.
 *
 * Loud in development: in the dev server and in vitest (rethrow) a caught
 * frame error is recorded, the overlay still opens on a storm, the next
 * frame is still scheduled, and then the error is thrown on, so it shows as
 * an uncaught error with its own stack (and fails a Playwright pageerror
 * check). An error a guard caught is thrown on the same way, at the end of
 * its frame, once the rest of the frame has run. A production build
 * swallows them after console.error.
 */
import { describeError } from "./problemLog";

/** Errors within STORM_WINDOW_MS that make a storm. */
export const STORM_ERRORS = 3;
export const STORM_WINDOW_MS = 2000;
/** Failed frames in a row that make a storm, however slow the frames are. */
export const STORM_FRAMES = 3;
/** A storm this soon after Keep playing is "it happened again". */
export const AGAIN_MS = 10_000;
/** An identical message is printed at most once per this long (the rest are counted). */
export const PRINT_GAP_MS = 5000;

export interface ShieldDeps {
  /** Milliseconds (performance.now in the page). */
  now(): number;
  /** Put it in the problem log. */
  record(where: string, err: unknown): void;
  /** console.error in the page. */
  print(text: string, err: unknown): void;
  /**
   * Too many errors: hold the battle and show the overlay. Return false when
   * there is nothing to hold (a menu screen), and the shield just keeps
   * counting. `again`: it already happened right after Keep playing.
   */
  onStorm(again: boolean): boolean;
  /** Throw a caught frame error on after recording it (dev server and vitest). */
  rethrow: boolean;
}

export class CrashShield {
  private recent: number[] = [];
  private failedInARow = 0;
  /** This frame already counted as failed (a throw, or a guard caught one). */
  private frameFailed = false;
  /** The first error a guard caught in this frame, to throw on at its end (rethrow only). */
  private late: { err: unknown } | null = null;
  private open = false;
  private resumedAt = Number.NEGATIVE_INFINITY;
  private readonly printed = new Map<string, { at: number; muted: number }>();

  constructor(private readonly deps: ShieldDeps) {}

  /** The overlay is up: the solo sim holds (main.ts registers this as a sim hold). */
  get holding(): boolean {
    return this.open;
  }

  /**
   * Run one frame's body. The next frame is scheduled whatever happens: on
   * a normal return, an early return inside the body, or a throw anywhere
   * in it (the body itself never schedules).
   */
  runFrame(body: () => void, scheduleNext: () => void): void {
    this.frameFailed = false;
    this.late = null;
    let stopped: { err: unknown } | null = null;
    try {
      body();
    } catch (err) {
      this.markFailed();
      if (this.caught("frame", err) && this.deps.rethrow) stopped = { err };
    } finally {
      if (!this.frameFailed) this.failedInARow = 0;
      scheduleNext();
    }
    // Loud (dev server, vitest): the error that stopped the frame, or else
    // the first one a guard caught, is thrown on now the next frame is due.
    const loud = stopped ?? this.late;
    this.late = null;
    if (loud) throw loud.err;
  }

  /**
   * Run one part of a frame that must not stop the rest of it (main.ts: a
   * battle event's sounds, effects and hooks, and the settle that follows
   * them). A throw is handled like a frame error (recorded, printed,
   * counted toward a storm; the frame counts as failed) and the frame goes
   * on. Errors stay loud in development: runFrame throws the first one on
   * at the end of the frame. Use it inside a runFrame body. Never throws.
   */
  guard(where: string, work: () => void): void {
    try {
      work();
    } catch (err) {
      this.markFailed();
      if (this.caught(where, err) && this.deps.rethrow) this.late ??= { err };
    }
  }

  /** This frame failed: it counts once toward STORM_FRAMES, however many errors it had. */
  private markFailed(): void {
    if (this.frameFailed) return;
    this.frameFailed = true;
    this.failedInARow++;
  }

  /**
   * Handle an error caught somewhere in the loop: record it, print it
   * (throttled), and open the overlay on a storm. Never throws. Returns
   * false when an identical message was printed moments ago (throttled).
   */
  caught(where: string, err: unknown): boolean {
    let loud = true;
    try {
      const now = this.deps.now();
      try {
        this.deps.record(where, err);
      } catch {
        // the log never stops the shield
      }
      const muted = this.throttle(describeError(err).msg, now);
      loud = muted !== null;
      if (loud && !this.deps.rethrow) {
        const more = muted ? ` (and ${muted} more like it)` : "";
        this.deps.print(`[shield] ${where} failed; the game goes on${more}`, err);
      }
      this.recent.push(now);
      while (this.recent.length > 0 && now - this.recent[0] > STORM_WINDOW_MS) this.recent.shift();
      if (!this.open && (this.recent.length >= STORM_ERRORS || this.failedInARow >= STORM_FRAMES)) {
        let opened = false;
        try {
          opened = this.deps.onStorm(now - this.resumedAt < AGAIN_MS);
        } catch (e) {
          this.deps.print("[shield] the glitch screen failed to open", e);
        }
        if (opened) {
          this.open = true;
        } else {
          // Nothing to hold (a menu): start counting afresh.
          this.recent = [];
          this.failedInARow = 0;
        }
      }
    } catch {
      // the shield itself must never throw
    }
    return loud;
  }

  /** Keep playing: the overlay closed and the battle goes on. */
  resume(): void {
    this.open = false;
    this.recent = [];
    this.failedInARow = 0;
    this.resumedAt = this.deps.now();
  }

  /** Back to menu: a fresh start. */
  reset(): void {
    this.open = false;
    this.recent = [];
    this.failedInARow = 0;
    this.resumedAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Print this message now? Returns null when an identical one was printed
   * less than PRINT_GAP_MS ago (and counts it), else how many were muted
   * since the last print.
   */
  private throttle(msg: string, now: number): number | null {
    const seen = this.printed.get(msg);
    if (seen && now - seen.at < PRINT_GAP_MS) {
      seen.muted++;
      return null;
    }
    if (this.printed.size > 50) this.printed.clear(); // many different messages: start over
    this.printed.set(msg, { at: now, muted: 0 });
    return seen?.muted ?? 0;
  }
}

// ---- The grown-ups' test switch ----------------------------------------------

export const OOPS_MESSAGE = "Test glitch from ?oops=1 (a grown-up's test switch)";
/** Glitches the switch throws (enough for a storm). */
export const OOPS_THROWS = STORM_FRAMES;
/** Seconds of play before it throws. */
export const OOPS_AFTER_SEC = 3;

/** ?oops=1 in the address. */
export function oopsRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get("oops") === "1";
  } catch {
    return false;
  }
}

/**
 * ?oops=1: the next battle throws inside the game loop OOPS_THROWS frames
 * in a row, OOPS_AFTER_SEC seconds into play, so a grown-up can see the
 * shield work. Harmless: it throws before the frame's sim step, in this tab
 * only, once (main.ts takes the parameter off the address bar).
 */
export class OopsSwitch {
  private left: number;
  private played = 0;

  constructor(armed: boolean, throws = OOPS_THROWS, private readonly afterSec = OOPS_AFTER_SEC) {
    this.left = armed ? throws : 0;
  }

  get armed(): boolean {
    return this.left > 0;
  }

  /** Call once per battle frame; throws the test glitch when it is due. */
  tick(playing: boolean, dt: number): void {
    if (this.left <= 0 || !playing) return;
    this.played += Math.max(0, dt);
    if (this.played < this.afterSec) return;
    this.left--;
    throw new Error(OOPS_MESSAGE);
  }
}
