/**
 * The two keep-safe sheets on an iPhone or iPad (meta/keepSafe.ts decides
 * when; ui/keepSafeWire.ts opens them on Home):
 *
 * - The Home Screen tip, in a Safari tab after the first win: add Crown
 *   Rush to the Home Screen so the progress stays safe. A Home Screen game
 *   keeps its own storage, apart from Safari's, so it starts empty: the tip
 *   says so, and its big button copies the save code first.
 * - The Home Screen game's hint, once, while it has no progress yet:
 *   "Played in Safari before?", with a button straight to Load a save.
 *   It can come up over the first-visit edition gate, before an edition is
 *   picked, so it then reads in both languages, as the gate does.
 *
 * Nothing is ever sent anywhere: the code only moves when the kid copies
 * it and pastes it.
 */
import { GAME_NAME, GAME_NAME_AR } from "../../app/brand";
import { button } from "../components";
import { tr } from "../i18n";
import { openSheet } from "./frame";
import { openCodeSheet, openLoadSheet, type SaveSheetDeps } from "./saveSheet";
import "../styles/save.css";

/** English, then Arabic. */
type Words = readonly [en: string, ar: string];

/** One language (the edition's), or both side by side before an edition is picked. */
function say(w: Words, both: boolean): string {
  return both ? `${w[0]} · ${w[1]}` : tr(w[0], w[1]);
}

/** English, then Arabic (right to left), as two lines (.v2-keep-both stacks them). */
function bothLines(w: Words): HTMLSpanElement[] {
  const en = document.createElement("span");
  en.lang = "en";
  en.textContent = w[0];
  const ar = document.createElement("span");
  ar.lang = "ar";
  ar.dir = "rtl";
  ar.className = "v2-keep-ar";
  ar.textContent = w[1];
  return [en, ar];
}

/** A paragraph in the edition's language, or English over Arabic (the gate's way). */
function para(className: string, w: Words, both: boolean): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  if (!both) {
    p.textContent = tr(w[0], w[1]);
    return p;
  }
  p.classList.add("v2-keep-both");
  p.append(...bothLines(w));
  return p;
}

/** Where the code goes when the Home Screen tip copies it (the code sheet's first line). */
export function homeScreenCodeIntro(): string {
  return tr(
    `Copy this code. Then open ${GAME_NAME} from your Home Screen and tap Load my save.`,
    `انسخ هذا الرمز. ثم افتح ${GAME_NAME_AR} من الشاشة الرئيسية واضغط «حمّل حفظي».`,
  );
}

/**
 * The Home Screen tip (a Safari tab, after the first win). "Copy my save
 * code" opens the code sheet, which says where to load it.
 */
export function openHomeScreenTip(deps: SaveSheetDeps = {}): { close: () => void } {
  const root = document.createElement("div");
  root.className = "v2-save v2-keep v2-keep-tip";
  const lead = document.createElement("p");
  lead.className = "v2-save-intro";
  lead.textContent = tr(
    `Add ${GAME_NAME} to your Home Screen so your progress stays safe.`,
    `أضف ${GAME_NAME_AR} إلى الشاشة الرئيسية ليبقى تقدّمك في أمان.`,
  );
  const move = document.createElement("p");
  move.className = "v2-save-intro";
  move.textContent = tr(
    "The Home Screen game starts empty. Copy your save code first, then load it there.",
    "اللعبة على الشاشة الرئيسية تبدأ فارغة. انسخ رمز الحفظ أولًا، ثم حمّله هناك.",
  );
  const how = document.createElement("p");
  how.className = "v2-save-fine";
  how.textContent = tr(
    "In Safari, tap Share, then Add to Home Screen.",
    "في سفاري، اضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية».",
  );
  const copy = button({
    variant: "primary",
    size: "lg",
    icon: "copy",
    label: tr("Copy my save code", "انسخ رمز الحفظ"),
    onClick: () => {
      s.close();
      void openCodeSheet(deps, { intro: homeScreenCodeIntro() });
    },
  });
  copy.classList.add("v2-keep-go");
  const later = button({ variant: "secondary", size: "lg", label: tr("Not now", "ليس الآن"), onClick: () => s.close() });
  later.classList.add("v2-keep-later");
  const actions = document.createElement("div");
  actions.className = "v2-save-actions";
  actions.append(copy, later);
  root.append(lead, move, how, actions);
  const s = openSheet({
    title: tr("Keep your progress safe", "حافظ على تقدّمك في أمان"),
    content: root,
    className: "v2-save-sheet",
  });
  return { close: s.close };
}

const HINT_TITLE: Words = ["Played in Safari before?", "هل لعبت في سفاري من قبل؟"];
const HINT_BODY: Words = [
  "This Home Screen game keeps its own save, so it starts empty. Bring your trophies and cards with your save code.",
  "اللعبة على الشاشة الرئيسية لها حفظ خاص بها، لذلك تبدأ فارغة. انقل كؤوسك وبطاقاتك برمز الحفظ.",
];
const HINT_HOW: Words = [
  "No code yet? In Safari, open Settings, then Backup & move, then Copy my save code.",
  "لا يوجد رمز بعد؟ في سفاري افتح الإعدادات، ثم النسخ الاحتياطي والنقل، ثم انسخ رمز الحفظ.",
];
const HINT_LOAD: Words = ["Load my save", "حمّل حفظي"];
const HINT_NEW: Words = ["I'm new here", "أنا جديد هنا"];

/**
 * The Home Screen game's one-time hint. `both`: no edition is picked yet
 * (the edition gate is up), so every line reads in both languages.
 */
export function openStandaloneHint(deps: SaveSheetDeps = {}, opts: { both?: boolean } = {}): { close: () => void } {
  const both = opts.both === true;
  const root = document.createElement("div");
  root.className = "v2-save v2-keep v2-keep-hint";
  const load = button({
    variant: "primary",
    size: "lg",
    icon: "check",
    label: say(HINT_LOAD, both),
    onClick: () => {
      s.close();
      openLoadSheet(deps);
    },
  });
  load.classList.add("v2-keep-go");
  const fresh = button({ variant: "secondary", size: "lg", label: say(HINT_NEW, both), onClick: () => s.close() });
  fresh.classList.add("v2-keep-later");
  const actions = document.createElement("div");
  actions.className = "v2-save-actions";
  actions.append(load, fresh);
  root.append(para("v2-save-intro", HINT_BODY, both), para("v2-save-fine", HINT_HOW, both), actions);
  const s = openSheet({ title: say(HINT_TITLE, both), content: root, className: "v2-save-sheet" });
  if (both) {
    // The title too: English over Arabic, each on its own line (the sheet sets it as one string).
    const title = s.el.querySelector(".ui-sheet__title");
    if (title) {
      title.textContent = "";
      title.classList.add("v2-keep-both");
      title.append(...bothLines(HINT_TITLE));
    }
  }
  return { close: s.close };
}
