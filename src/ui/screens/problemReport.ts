/**
 * Settings > Help > Problem report: what went wrong lately on this device
 * (src/app/problemLog.ts), newest first, with Copy and Clear.
 *
 * Copy puts a plain-text report on the clipboard for a grown-up to paste
 * into a message: a header about this device (build, browser, screen size,
 * graphics, edition), then each problem. If the clipboard is not allowed,
 * the report appears in a box below, already selected, to copy by hand.
 * Nothing is ever sent anywhere: this sheet is the only way the log leaves
 * the device, and a grown-up does it.
 *
 * The chrome is in the edition's language; recorded technical lines (the
 * messages, stack lines, screen ids) stay exactly as they were recorded.
 */
import { GAME_NAME, GAME_NAME_AR } from "../../app/brand";
import { problemLog, problemReport, type Problem, type ProblemLog, type ReportHeader, type ReportWords } from "../../app/problemLog";
import { ARABIC } from "../../render3d/theme";
import { button, toast } from "../components";
import { fmtNum, tr } from "../i18n";
import { icon } from "../icons";
import { openSheet } from "./frame";
import "../styles/problems.css";

/** The test switch the small print tells grown-ups about (src/app/crashShield.ts). */
export const OOPS_PARAM = "?oops=1";

/** The report's title and header words in the edition's language (each problem's lines stay Latin). */
export function reportWords(): ReportWords {
  return {
    title: tr(`${GAME_NAME} problem report`, `تقرير مشكلات ${GAME_NAME_AR}`),
    build: tr("Build", "الإصدار"),
    browser: tr("Browser", "المتصفح"),
    screen: tr("Screen", "الشاشة"),
    graphics: tr("Graphics", "الرسومات"),
    edition: tr("Edition", "النسخة"),
    made: tr("Made", "وقت التقرير"),
    none: tr("No problems so far!", "لا مشكلات حتى الآن!"),
    count: (n) =>
      tr(
        `${n} ${n === 1 ? "problem" : "problems"}, newest first. Kept on this device only.`,
        `عدد المشكلات: ${fmtNum(n)}، الأحدث أولًا. محفوظة على هذا الجهاز فقط.`,
      ),
  };
}

/** The report's header for this device right now. */
export function deviceHeader(log: ProblemLog = problemLog, now = Date.now()): ReportHeader {
  const ctx = log.currentContext();
  let browser = "?";
  let screen = "?";
  try {
    browser = navigator.userAgent || "?";
  } catch {
    // no navigator (tests)
  }
  try {
    const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    screen = `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)} @${dpr}x`;
  } catch {
    // no window size
  }
  return { build: log.buildId, browser, screen, quality: ctx.quality, edition: ctx.edition, now };
}

/** The whole text Copy puts on the clipboard. */
export function reportText(log: ProblemLog = problemLog, now = Date.now()): string {
  return problemReport(log.list(), deviceHeader(log, now), reportWords());
}

/** "13 Nov, 10:20" in the edition's language and digits. */
function when(ms: number): string {
  try {
    return new Date(ms).toLocaleString(ARABIC ? "ar-EG" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function problemItem(p: Problem): HTMLElement {
  const li = document.createElement("li");
  li.className = "v2-problem";
  const head = document.createElement("div");
  head.className = "v2-problem-head";
  const time = document.createElement("span");
  time.className = "v2-problem-when";
  time.textContent = when(p.last);
  head.appendChild(time);
  if (p.n > 1) {
    const count = document.createElement("span");
    count.className = "v2-problem-count";
    count.textContent = `×${fmtNum(p.n)}`;
    count.setAttribute("aria-label", tr(`${p.n} times`, `عدد المرات: ${fmtNum(p.n)}`));
    head.appendChild(count);
  }
  // Recorded technical lines read left to right, as recorded.
  const msg = document.createElement("p");
  msg.className = "v2-problem-msg";
  msg.dir = "ltr";
  msg.textContent = p.msg;
  const where = document.createElement("p");
  where.className = "v2-problem-where";
  where.dir = "ltr";
  // The screen, and which part of the game caught it (the copied report has the rest).
  where.textContent = p.where ? `${p.screen} · ${p.where}` : p.screen;
  li.append(head, msg, where);
  return li;
}

export interface ProblemReportDeps {
  log?: ProblemLog;
  /** navigator.clipboard (absent or refusing: the select-all fallback). */
  clipboard?: { writeText(text: string): Promise<void> } | null;
}

/** The sheet's content: the list, Copy and Clear, and the small print. Returns the element and its teardown. */
export function buildProblemReport(deps: ProblemReportDeps = {}): { el: HTMLElement; dispose: () => void } {
  const log = deps.log ?? problemLog;
  const root = document.createElement("div");
  root.className = "v2-problems";

  const list = document.createElement("ol");
  list.className = "v2-problem-list";
  const empty = document.createElement("p");
  empty.className = "v2-problem-empty";
  const fallback = document.createElement("textarea");
  fallback.className = "v2-problem-text";
  fallback.readOnly = true;
  fallback.dir = "ltr";
  fallback.hidden = true;
  fallback.setAttribute("aria-label", tr("Problem report text", "نص تقرير المشكلات"));

  const copy = button({
    variant: "primary",
    size: "lg",
    icon: "copy",
    label: tr("Copy", "انسخ"),
    onClick: () => void doCopy(),
  });
  copy.classList.add("v2-problem-copy");
  const clear = button({
    variant: "secondary",
    size: "lg",
    icon: "trash",
    label: tr("Clear", "امسح"),
    onClick: () => {
      log.clear();
      fallback.hidden = true;
      toast(tr("Cleared.", "تم المسح."), "success");
    },
  });
  clear.classList.add("v2-problem-clear");
  empty.innerHTML = icon("check");
  const emptyText = document.createElement("span");
  emptyText.textContent = tr("No problems so far!", "لا مشكلات حتى الآن!");
  empty.appendChild(emptyText);
  const actions = document.createElement("div");
  actions.className = "v2-problem-actions";
  actions.append(copy, clear);

  const render = (): void => {
    const items = log.list();
    list.replaceChildren(...items.map(problemItem));
    list.hidden = items.length === 0;
    empty.hidden = items.length > 0;
    clear.disabled = items.length === 0;
  };

  async function doCopy(): Promise<void> {
    const text = reportText(log);
    const clip = deps.clipboard === undefined ? clipboardOf() : deps.clipboard;
    try {
      if (clip) {
        await clip.writeText(text);
        fallback.hidden = true;
        toast(tr("Copied! Paste it into a message.", "تم النسخ! الصقه في رسالة."), "success");
        return;
      }
    } catch {
      // not allowed here: select it for a copy by hand
    }
    fallback.value = text;
    fallback.hidden = false;
    selectAll(fallback);
    let copied = false;
    try {
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      copied = false;
    }
    toast(
      copied
        ? tr("Copied! Paste it into a message.", "تم النسخ! الصقه في رسالة.")
        : tr("The report is selected below. Copy it from there.", "التقرير محدد في الأسفل. انسخه من هناك."),
      copied ? "success" : "neutral",
    );
  }

  const intro = document.createElement("p");
  intro.className = "v2-problem-intro";
  intro.textContent = tr(
    "Things that went wrong lately, newest first.",
    "أخطاء حدثت مؤخرًا، الأحدث أولًا.",
  );

  const fine = document.createElement("div");
  fine.className = "v2-problem-fine";
  const privacy = document.createElement("p");
  privacy.textContent = tr(
    "Problems are kept on this device only. Nothing is ever sent anywhere.",
    "تُحفظ المشكلات على هذا الجهاز فقط. لا يُرسل أي شيء إلى أي مكان.",
  );
  const test = document.createElement("p");
  const code = document.createElement("code");
  code.dir = "ltr";
  code.textContent = OOPS_PARAM;
  test.append(
    `${tr("Grown-ups: add", "للكبار: أضيفوا")} `,
    code,
    ` ${tr("to the address to see the glitch screen in the next battle.", "إلى العنوان لرؤية شاشة الخلل في المعركة القادمة.")}`,
  );
  fine.append(privacy, test);

  root.append(intro, list, empty, actions, fallback, fine);
  render();
  const off = log.onChange(render);
  return { el: root, dispose: off };
}

/**
 * Select the whole box for a copy by hand. Each step on its own: iOS Safari
 * does not reliably select a text field on select(), and a selection range
 * does (the fallback is reached on an http LAN address, which is not a
 * secure context, so it has no navigator.clipboard).
 */
function selectAll(box: HTMLTextAreaElement): void {
  try {
    box.focus();
  } catch {
    // not focusable here
  }
  try {
    box.select();
  } catch {
    // the range below still selects
  }
  try {
    box.setSelectionRange(0, box.value.length);
  } catch {
    // nothing more to try: the toast says to copy it by hand
  }
}

function clipboardOf(): { writeText(text: string): Promise<void> } | null {
  try {
    const c = navigator.clipboard;
    return c && typeof c.writeText === "function" ? c : null;
  } catch {
    return null;
  }
}

/** Open the Problem report sheet. */
export function openProblemReport(deps: ProblemReportDeps = {}): { close: () => void } {
  const { el, dispose } = buildProblemReport(deps);
  const s = openSheet({
    title: tr("Problem report", "تقرير المشكلات"),
    content: el,
    className: "v2-problem-sheet",
    onClose: dispose,
  });
  return { close: s.close };
}

/** The Settings > Help row. `closeSettings` runs first, so the report is the only sheet up. */
export function problemReportRow(closeSettings?: () => void): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "v2-set-action";
  row.dataset.act = "problem-report";
  row.innerHTML = icon("wrench");
  const label = document.createElement("span");
  label.textContent = tr("Problem report", "تقرير المشكلات");
  row.appendChild(label);
  row.addEventListener("click", () => {
    closeSettings?.();
    openProblemReport();
  });
  return row;
}
