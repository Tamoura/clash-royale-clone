/**
 * The "Oops! Something went wrong." overlay the crash shield opens on a
 * glitch storm (src/app/crashShield.ts), instead of a frozen battle.
 *
 * - "glitch": the solo battle is paused. Keep playing (first, focused) or
 *   Back to menu, which never costs trophies (match/noContest.ts).
 * - "again": it failed again right after Keep playing, so Back to menu
 *   comes first and is the big button.
 * - "online": the friend match already stopped (no contest on this device);
 *   only Back to menu.
 *
 * One at a time; it can't be dismissed by Esc or a tap outside (the battle
 * keys behind it are blocked too), only by its buttons. Menus read
 * right-to-left in the Golden Age edition, so the dialog does too.
 */
import { ARABIC } from "../render3d/theme";
import { button } from "./components";
import { tr } from "./i18n";
import { icon } from "./icons";
import "./styles/oops.css";

export type OopsKind = "glitch" | "again" | "online";

export interface OopsCopy {
  title: string;
  body: string;
  /** Null: no Keep playing (online). */
  keep: string | null;
  back: string;
  /** Which button comes first, is the big one and takes the focus. */
  first: "keep" | "back";
}

/** The words and button order for each kind (pure, tested). */
export function oopsCopy(kind: OopsKind): OopsCopy {
  const title = tr("Oops! Something went wrong.", "عذرًا! حدث خطأ ما.");
  const keep = tr("Keep playing", "تابع اللعب");
  const back = tr("Back to menu", "العودة إلى القائمة");
  switch (kind) {
    case "online":
      return {
        title,
        body: tr(
          "The match stopped because of a glitch. No trophies won or lost.",
          "توقفت المباراة بسبب خلل. لم تربح أو تخسر أي كؤوس.",
        ),
        keep: null,
        back,
        first: "back",
      };
    case "again":
      return {
        title,
        body: tr(
          "It happened again. The menu is the best place now. You lose no trophies.",
          "حدث الخطأ مرة أخرى. الأفضل أن تعود إلى القائمة الآن. لن تخسر أي كؤوس.",
        ),
        keep,
        back,
        first: "back",
      };
    default:
      return {
        title,
        body: tr(
          "Your battle is paused. Going back to the menu costs no trophies.",
          "معركتك متوقفة الآن. العودة إلى القائمة لا تكلّفك أي كؤوس.",
        ),
        keep,
        back,
        first: "keep",
      };
  }
}

export interface OopsActions {
  onKeepPlaying?(): void;
  onBackToMenu(): void;
}

let current: { close: () => void } | null = null;

/** The overlay is on screen. */
export function oopsOpen(): boolean {
  return current !== null;
}

/** Keys that still work under the overlay: moving between and pressing its buttons. */
const PASS_KEYS = new Set(["Tab", "Enter", " ", "Spacebar"]);

/** Show the overlay (replacing one already up). */
export function showOops(kind: OopsKind, actions: OopsActions): { close: () => void } {
  current?.close();
  const copy = oopsCopy(kind);
  const root = document.createElement("div");
  root.className = "ui-modal oops-modal";
  root.dataset.kind = kind;
  if (ARABIC) root.dir = "rtl";
  const box = document.createElement("div");
  box.className = "ui-modal__box oops-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const id = `oops-${Math.random().toString(36).slice(2, 8)}`;
  box.setAttribute("aria-labelledby", `${id}-t`);
  box.setAttribute("aria-describedby", `${id}-b`);
  const badge = document.createElement("div");
  badge.className = "oops-badge";
  badge.innerHTML = icon("wrench");
  const title = document.createElement("h2");
  title.className = "ui-modal__title oops-title";
  title.id = `${id}-t`;
  title.textContent = copy.title;
  const body = document.createElement("p");
  body.className = "ui-modal__body oops-body";
  body.id = `${id}-b`;
  body.textContent = copy.body;
  const row = document.createElement("div");
  row.className = "ui-modal__actions oops-actions";

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    if (current === handle) current = null;
  };
  const choose = (fn?: () => void): void => {
    close();
    fn?.();
  };
  const keepBtn =
    copy.keep === null
      ? null
      : button({
          variant: copy.first === "keep" ? "cta" : "secondary",
          size: "lg",
          icon: "play",
          label: copy.keep,
          onClick: () => choose(actions.onKeepPlaying),
        });
  const backBtn = button({
    variant: copy.first === "back" ? "cta" : "secondary",
    size: "lg",
    icon: "home",
    label: copy.back,
    onClick: () => choose(actions.onBackToMenu),
  });
  keepBtn?.classList.add("oops-keep");
  backBtn.classList.add("oops-back");
  const order = copy.first === "keep" ? [keepBtn, backBtn] : [backBtn, keepBtn];
  for (const b of order) if (b) row.appendChild(b);
  box.append(badge, title, body, row);
  root.appendChild(box);

  const buttons = order.filter((b): b is HTMLButtonElement => b !== null);
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Tab") {
      // Keep the focus on the overlay's buttons.
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (i + (e.shiftKey ? buttons.length - 1 : 1) + buttons.length) % buttons.length;
      buttons[i < 0 ? 0 : next]?.focus();
      return;
    }
    // Esc, the card keys and the KING key belong to the battle behind: not now.
    if (!PASS_KEYS.has(e.key)) e.preventDefault();
  }
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(root);
  buttons[0]?.focus({ preventScroll: true });
  const handle = { close };
  current = handle;
  return handle;
}
