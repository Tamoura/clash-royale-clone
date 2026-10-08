/**
 * The in-battle menu: a bottom sheet with Resume, Sound and Forfeit.
 *
 * In a solo match an open menu pauses the game (a sim hold, plus a frozen
 * presentation via battleMenuOpen()); an online match never pauses, so the
 * sheet says so instead. Forfeit asks first and spells out what it costs.
 * Sandbox practice and replays have nothing at stake, so they get a plain
 * Leave instead.
 */
import { registerSimHold } from "../app/hooks";
import { button, confirm, sheet } from "./components";
import { fmtNum, tr } from "./i18n";
import { icon } from "./icons";
import { getPrefs, setPrefs } from "./prefs";

export interface BattleMenuDeps {
  isOnline(): boolean;
  /**
   * What leaving now costs: the trophies at stake (0 = counts as a loss but
   * no trophies move), or null when nothing is at stake (sandbox, replay),
   * which offers a plain Leave.
   */
  leaveCost(): number | null;
  /** The player confirmed the forfeit. */
  onForfeit(): void;
  /** Free exit (nothing at stake). */
  onLeave(): void;
  /** Apply the sound setting right away (the pref is already saved). */
  onMuted?(muted: boolean): void;
}

let openMenu: { close: () => void } | null = null;
let online = false;

// Solo matches hold the sim while the sheet is up; online never pauses.
registerSimHold(() => openMenu !== null && !online);

/** True while the menu is open in a match that pauses for it. */
export function battleMenuPausing(): boolean {
  return openMenu !== null && !online;
}

export function closeBattleMenu(): void {
  openMenu?.close();
}

/** The confirm-dialog text for a forfeit that costs `n` trophies (0 = none). */
export function forfeitQuestion(n: number): string {
  return n > 0
    ? tr(`Leave battle? Counts as a loss (−${n} trophies)`, `مغادرة المعركة؟ تُحسب خسارة (−${fmtNum(n)} كأسًا)`)
    : tr("Leave battle? Counts as a loss.", "مغادرة المعركة؟ تُحسب خسارة.");
}

export function openBattleMenu(deps: BattleMenuDeps): void {
  if (openMenu) return;
  online = deps.isOnline();
  const content = document.createElement("div");
  content.className = "battle-menu-v2";

  const status = document.createElement("p");
  status.className = "bm-status";
  status.textContent = online
    ? tr("Online matches keep running while this is open.", "المباريات عبر الإنترنت تستمر أثناء فتح القائمة.")
    : tr("Paused", "متوقف مؤقتًا");
  content.appendChild(status);

  const resume = button({
    variant: "primary",
    size: "lg",
    icon: "play",
    label: tr("Resume", "استئناف"),
    onClick: () => handle.close(),
  });
  resume.classList.add("bm-resume");

  const sound = button({ variant: "secondary", size: "lg", icon: "sound", label: "", onClick: () => toggleSound() });
  sound.classList.add("bm-sound");
  sound.setAttribute("role", "switch");
  const renderSound = (): void => {
    const muted = getPrefs().muted;
    sound.setAttribute("aria-checked", String(!muted));
    sound.querySelector(".ui-icon")?.remove();
    sound.insertAdjacentHTML("afterbegin", icon(muted ? "mute" : "sound"));
    const label = sound.querySelector(".ui-btn__label") ?? sound.appendChild(document.createElement("span"));
    label.className = "ui-btn__label";
    label.textContent = muted ? tr("Sound: Off", "الصوت: مغلق") : tr("Sound: On", "الصوت: يعمل");
  };
  const toggleSound = (): void => {
    const muted = !getPrefs().muted;
    setPrefs({ muted });
    deps.onMuted?.(muted);
    renderSound();
  };
  renderSound();

  const cost = deps.leaveCost();
  const leave =
    cost === null
      ? button({
          variant: "secondary",
          size: "lg",
          icon: "home",
          label: tr("Leave", "مغادرة"),
          onClick: () => {
            handle.close();
            deps.onLeave();
          },
        })
      : button({
          variant: "secondary",
          size: "lg",
          icon: "flag",
          label: tr("Forfeit", "استسلام"),
          onClick: async () => {
            const ok = await confirm({
              title: tr("Forfeit", "استسلام"),
              body: forfeitQuestion(cost),
              okLabel: tr("Forfeit", "استسلام"),
              cancelLabel: tr("Keep playing", "واصل اللعب"),
              danger: true,
            });
            if (!ok) return;
            handle.close();
            deps.onForfeit();
          },
        });
  leave.classList.add(cost === null ? "bm-leave" : "bm-forfeit");

  content.append(resume, sound, leave);
  const handle = sheet({
    title: tr("Battle menu", "قائمة المعركة"),
    content,
    onClose: () => {
      openMenu = null;
    },
  });
  // Resume the instant the player asks, not after the slide-out.
  const close = handle.close;
  handle.close = () => {
    openMenu = null;
    close();
  };
  openMenu = handle;
}
