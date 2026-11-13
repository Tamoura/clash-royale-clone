/**
 * The one-time "Graphics set to Low" note (C44). The first time Auto
 * graphics lands on Low on a device (a step down, a remembered level or a
 * first guess), a short bilingual toast says why the game looks simpler.
 *
 * It never interrupts a fight: the governor only steps during battles, so
 * the note waits for the next calm screen after a battle (the result's way
 * back to Home, or any menu). A guess at boot waits for the end of the
 * first battle too, so it never piles onto the first-run screens.
 * Shown once per device (flag GFX_NOTE_KEY, '1'), and only if Auto is
 * still on Low when that calm screen comes: a grown-up may have picked a
 * level in Settings meanwhile, or the once-per-session try one level up
 * may have kept Medium. Then the note is dropped and the flag stays unset,
 * so the real drop to Low later still gets its note.
 */
import { on } from "../app/hooks";
import { toast } from "../ui/components";
import { tr } from "../ui/i18n";
import { GFX_NOTE_KEY, QUALITY_LEVELS, liveQuality, type StorageLike } from "./quality";

/** How long the note stays up: long enough for a young reader. */
export const GFX_NOTE_MS = 5000;

/** Auto is in charge and drawing at the bottom level (what the note says). */
export function autoOnLow(q: { index: number; mode: string } = liveQuality()): boolean {
  return q.mode === "auto" && q.index >= QUALITY_LEVELS.length - 1;
}

export interface LowNoteDeps {
  store: StorageLike | null;
  show: (text: string) => void;
  /** Whether Auto is on Low right now (re-checked just before showing); default autoOnLow. */
  isLow?: () => boolean;
}

/** The note's state machine (DOM-free, for tests); registerGfxNote wires it. */
export class LowNote {
  private pending = false;
  private sawBattle = false;
  /** Shown this session (when storage can't keep the flag). */
  private shown = false;

  constructor(private readonly deps: LowNoteDeps) {}

  private seen(): boolean {
    if (this.shown) return true;
    try {
      return this.deps.store?.getItem(GFX_NOTE_KEY) === "1";
    } catch {
      return false;
    }
  }

  /** Auto graphics is on Low now: say so at the next calm moment (once per device). */
  low(): void {
    if (!this.seen()) this.pending = true;
  }

  /** A screen took over; true when the note was shown. */
  screen(sceneMode: "battle" | "diorama" | "none"): boolean {
    if (sceneMode === "battle") {
      this.sawBattle = true;
      return false;
    }
    if (!this.pending || !this.sawBattle) return false;
    this.pending = false;
    // Still true? (A pin or a kept try up since then: say nothing, keep the flag unset.)
    if (this.seen() || !(this.deps.isLow ?? autoOnLow)()) return false;
    this.shown = true;
    try {
      this.deps.store?.setItem(GFX_NOTE_KEY, "1");
    } catch {
      // storage blocked: still once per session
    }
    this.deps.show(lowNoteText());
    return true;
  }
}

/** The note's words (short and warm; kids read them). */
export function lowNoteText(): string {
  return tr("Graphics set to Low so the game runs smoother.", "ضبطنا الرسوميات على منخفض لتعمل اللعبة بسلاسة.");
}

let note: LowNote | null = null;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Listen for calm screens (once per page). */
export function registerGfxNote(): void {
  if (note) return;
  note = new LowNote({ store: storage(), show: (text) => toast(text, "neutral", GFX_NOTE_MS) });
  const n = note;
  on("screen", (s) => void n.screen(s.sceneMode));
}

/** Auto graphics just landed on Low (see LowNote.low). */
export function noteLowGraphics(): void {
  note?.low();
}
