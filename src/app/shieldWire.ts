/**
 * Wires the crash shield (crashShield.ts) into the page: the problem log's
 * context, the solo sim hold while the overlay is up, the "Oops!" overlay
 * itself (ui/oops.ts), the no-contest exits (match/noContest.ts) and the
 * grown-ups' ?oops=1 test switch. main.ts calls installCrashShield() once
 * and runs every animation frame through its runFrame().
 *
 * On a glitch storm:
 * - a solo battle (or any battle already decided) holds and asks: Keep
 *   playing, or Back to menu with nothing settled;
 * - an online match still being played stops as no contest on this device
 *   (the friend is told we paused, then we leave), and the kid reads "The
 *   match stopped because of a glitch. No trophies won or lost.";
 * - a menu screen (Home, Collection...) shows nothing: menus are plain page
 *   controls that keep working, so the shield only records and counts.
 */
import { CrashShield, OopsSwitch, oopsRequested } from "./crashShield";
import { registerSimHold } from "./hooks";
import { problemLog, type ProblemContext } from "./problemLog";
import { leaveAfterGlitch, stopOnlineAfterGlitch, type GlitchExitDeps, type GlitchSession } from "../match/noContest";
import { showOops } from "../ui/oops";

/** Dev server and vitest: a caught frame error is thrown on after it is handled. */
export const LOUD_ERRORS = import.meta.env.DEV || import.meta.env.MODE === "test";

export interface ShieldWireDeps extends Omit<GlitchExitDeps, "kv" | "report"> {
  /** Where the left-match marker lives (meta/kv.ts defaultKV()). */
  kv: GlitchExitDeps["kv"];
  /** A menu screen covers the battle (the deck picker root is shown). */
  onMenu(): boolean;
  /** The online session while a networked match is on screen, else null. */
  online(): GlitchSession | null;
  /** The battle on screen already has a result. */
  battleOver(): boolean;
  /** Leave the online room (match/online.ts leaveOnline). */
  leaveOnline(): void;
  /** What the app is doing, for the problem log. */
  context(): ProblemContext;
}

export interface ShieldWire {
  shield: CrashShield;
  /** The ?oops=1 switch (main.ts ticks it inside the frame). */
  oops: OopsSwitch;
}

/** Take ?oops=1 off the address bar, so a reload does not glitch again. */
function takeOopsParam(): boolean {
  if (!oopsRequested(location.search)) return false;
  try {
    const params = new URLSearchParams(location.search);
    params.delete("oops");
    const qs = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  } catch {
    // sandboxed frames: the switch still works for this page
  }
  return true;
}

export function installCrashShield(d: ShieldWireDeps): ShieldWire {
  problemLog.setContext(d.context);
  const report = (what: string, err: unknown): void => {
    console.error(`[shield] could not ${what}`, err);
    problemLog.record("frame", err);
  };
  const exitDeps: GlitchExitDeps = {
    kv: d.kv,
    abandonBattle: d.abandonBattle,
    releaseLiveMatch: d.releaseLiveMatch,
    dismissHud: d.dismissHud,
    openHome: d.openHome,
    report,
  };
  let shield: CrashShield;
  const backToMenu = (): void => {
    shield.reset();
    leaveAfterGlitch(exitDeps);
  };
  shield = new CrashShield({
    now: () => performance.now(),
    // Everything the shield catches is in the game loop (a frame, or a
    // guarded part of one such as a battle event's effects).
    record: (_where, err) => {
      problemLog.record("frame", err);
    },
    print: (text, err) => console.error(text, err),
    rethrow: LOUD_ERRORS,
    onStorm: (again) => {
      if (d.onMenu()) return false;
      // Whatever goes wrong next, the latest entries reach storage now.
      problemLog.flush();
      const session = d.online();
      if (session && !d.battleOver()) {
        stopOnlineAfterGlitch(session, d.leaveOnline, report);
        showOops("online", { onBackToMenu: backToMenu });
        return true;
      }
      showOops(again ? "again" : "glitch", {
        onKeepPlaying: () => shield.resume(),
        onBackToMenu: backToMenu,
      });
      return true;
    },
  });
  // The overlay holds the solo sim (an online match has left by then).
  registerSimHold(() => shield.holding);
  return { shield, oops: new OopsSwitch(takeOopsParam()) };
}
