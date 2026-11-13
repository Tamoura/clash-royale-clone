/**
 * Leaving a battle after a glitch: no contest. The crash shield's "Back to
 * menu" (and the online glitch stop) must never cost the kid anything.
 *
 * Today every other way out of a ladder match settles it: a Forfeit settles
 * as a loss through finishMatch/settleMatch (trophies, the loss streak, the
 * auto-difficulty loss count), and a reload or a closed tab leaves the
 * left-match marker (match/leftMatch.ts), which the next boot settles as a
 * loss. This path does neither: it removes the marker, lets go of the
 * live-match lock, emits no matchEnd and settles nothing, so trophies, the
 * streak, quests, achievements, the auto-difficulty record and the chest
 * slots stay exactly as they were. Each step is guarded (we are here because
 * something already went wrong).
 */
import type { KV } from "../meta/kv";
import { clearMatchMarker } from "./leftMatch";

export interface GlitchExitDeps {
  /** Where the left-match marker lives (meta/kv.ts defaultKV()). */
  kv: KV | null;
  /** Let go of the live-match lock (match/leftMatch.ts LiveMatchGuard.release). */
  releaseLiveMatch(): void;
  /** Close the battle menu and the result screen (hud.dismiss). */
  dismissHud(): void;
  /** Go Home (main.ts openHome, which also leaves any online room). */
  openHome(): void;
  /** Where to report a step that failed (console.error in the page). */
  report?(what: string, err: unknown): void;
}

function attempt(what: string, fn: () => void, report?: (what: string, err: unknown) => void): void {
  try {
    fn();
  } catch (err) {
    try {
      report?.(what, err);
    } catch {
      // nothing more to do
    }
  }
}

/** Back to menu after a glitch: Home, with nothing settled and nothing left to settle. */
export function leaveAfterGlitch(d: GlitchExitDeps): void {
  attempt("clear the match marker", () => clearMatchMarker(d.kv), d.report);
  attempt("release the live match", () => d.releaseLiveMatch(), d.report);
  attempt("close the battle screens", () => d.dismissHud(), d.report);
  attempt("open Home", () => d.openHome(), d.report);
}

/** The parts of an OnlineSession the glitch stop uses. */
export interface GlitchSession {
  setPaused(paused: boolean): void;
}

/**
 * An online match glitched: leave it as no contest on this device (an
 * online friendly never moves trophies anyway, and leaving settles
 * nothing). Say "paused" first, as a closing page does (match/online.ts
 * pagehide), so the friend's screen reads "left" rather than "gave up"
 * (net/session.ts peerLeft). No protocol change: pause and leave are
 * messages every client already sends.
 */
export function stopOnlineAfterGlitch(
  session: GlitchSession | null,
  leave: () => void,
  report?: (what: string, err: unknown) => void,
): void {
  attempt("tell the friend we paused", () => session?.setPaused(true), report);
  attempt("leave the room", leave, report);
}
