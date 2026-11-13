/**
 * Settings > Backup & move: keep the kid's game safe, or move it to another
 * tablet (or to the game's other web address, which keeps its own storage).
 *
 * - Copy my save code: the code (meta/saveCode.ts) in a read-only box with
 *   a Copy button (and Save to a file).
 * - Save to a file: downloads crown-rush-save-<date>.txt holding the code.
 * - Load a save: paste a code or pick a file. A friendly line says what is
 *   wrong with a bad code; a good one opens the confirm screen.
 * - Undo the last load: while a pre-load backup exists.
 *
 * The confirm screen shows what the save holds next to what this tablet
 * has now (trophies, arena, cards, gold, gems; the name and the edition
 * when they differ), and "Keep my progress" is the big default, as in the
 * confirm({ emphasis: "cancel" }) pattern. Loading backs up this tablet's
 * progress, writes the save, then reloads so the game's own loaders and
 * migrations read it. Nothing is ever sent anywhere: the code leaves the
 * tablet only when someone copies it or saves the file.
 */
import { GAME_NAME, GAME_NAME_AR } from "../../app/brand";
import { ARENAS } from "../../meta/arenas";
import {
  CODE_MAX_CHARS,
  applySave,
  decodeSave,
  encodeSave,
  gatherSave,
  readBackup,
  saveFileName,
  summarize,
  undoLastLoad,
  type SaveData,
  type SaveError,
  type SaveStore,
  type SaveSummary,
} from "../../meta/saveCode";
import { button, confirmLook, toast } from "../components";
import { fmtNum, tr } from "../i18n";
import { icon, type IconName } from "../icons";
import { EDITION_COPY, holdSplashForReload } from "./editionGate";
import { openSheet } from "./frame";
import "../styles/save.css";

/** The confirm screen's buttons: "Keep my progress" is the big yellow default. */
export const SAVE_LOOK = confirmLook({ emphasis: "cancel" });

/** Set (this session) just before the reload, so Home can say it worked. */
export const SAVE_LOADED_KEY = "cr-clone-save-loaded";

export interface SaveSheetDeps {
  /** localStorage (null when blocked). */
  store?: SaveStore | null;
  /** Reload the page after a load or an undo. */
  reload?: () => void;
  /** navigator.clipboard (absent or refusing: the select-all fallback). */
  clipboard?: { writeText(text: string): Promise<void> } | null;
  now?: () => number;
}

function localStore(): SaveStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
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

function reloadPage(what: "load" | "undo"): void {
  try {
    sessionStorage.setItem(SAVE_LOADED_KEY, what);
  } catch {
    // no session storage: the toast after the reload is skipped
  }
  holdSplashForReload();
  location.reload();
}

interface Resolved {
  store: SaveStore | null;
  reload: (what: "load" | "undo") => void;
  clipboard: { writeText(text: string): Promise<void> } | null;
  now: () => number;
}

function resolve(deps: SaveSheetDeps): Resolved {
  return {
    store: deps.store === undefined ? localStore() : deps.store,
    reload: deps.reload ? () => deps.reload!() : reloadPage,
    clipboard: deps.clipboard === undefined ? clipboardOf() : deps.clipboard,
    now: deps.now ?? Date.now,
  };
}

// ---- Words ----------------------------------------------------------------------------

/** What to tell the kid when a code does not load (or storage is full). */
export function saveErrorText(reason: SaveError | "storage" | "no-backup" | "file"): string {
  switch (reason) {
    case "empty":
      return tr("Paste a save code first, or pick a save file.", "الصق رمز الحفظ أولًا، أو اختر ملف الحفظ.");
    case "too-big":
      return tr("That is much too long to be a save code.", "هذا أطول بكثير من رمز الحفظ.");
    case "not-a-code":
      return tr(
        `That isn't a ${GAME_NAME} save code. Check you copied all of it.`,
        `هذا ليس رمز حفظ من ${GAME_NAME_AR}. تأكد أنك نسخته كاملًا.`,
      );
    case "deck-code":
      return tr("That's a deck code, not a save code.", "هذا رمز مجموعة بطاقات، وليس رمز حفظ.");
    case "typo":
      return tr(
        "Part of this code is wrong or missing. Copy the whole code again and paste it.",
        "جزء من هذا الرمز خطأ أو ناقص. انسخ الرمز كاملًا مرة أخرى والصقه.",
      );
    case "newer":
      return tr(
        `This save is from a newer ${GAME_NAME}. Update the game, then try again.`,
        `هذا الحفظ من نسخة أحدث من ${GAME_NAME_AR}. حدّث اللعبة ثم حاول مرة أخرى.`,
      );
    case "wrong-game":
      return tr("This code is for a different game.", "هذا الرمز للعبة أخرى.");
    case "damaged":
      return tr(
        "This code is broken. Make a new one on the other tablet and try again.",
        "هذا الرمز تالف. اصنع رمزًا جديدًا في الجهاز الآخر وحاول مرة أخرى.",
      );
    case "unsupported":
      return tr(
        "This browser is too old to open this code. Update it, then try again.",
        "هذا المتصفح قديم ولا يفتح هذا الرمز. حدّثه ثم حاول مرة أخرى.",
      );
    case "empty-save":
      return tr("This save has no progress in it yet.", "لا يوجد تقدّم في هذا الحفظ بعد.");
    case "storage":
      return tr(
        "There is no room to save on this tablet. Nothing was changed.",
        "لا توجد مساحة للحفظ في هذا الجهاز. لم يتغيّر شيء.",
      );
    case "no-backup":
      return tr("There is nothing to undo.", "لا يوجد شيء للتراجع عنه.");
    case "file":
      return tr("That file could not be read. Try pasting the code.", "تعذّرت قراءة هذا الملف. جرّب لصق الرمز.");
  }
}

// ---- Settings group -------------------------------------------------------------------

function actionRow(ic: IconName, label: string, act: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "v2-set-action";
  b.dataset.act = act;
  b.innerHTML = icon(ic);
  const t = document.createElement("span");
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener("click", onClick);
  return b;
}

/**
 * The Settings group. `closeSettings` runs before a sheet opens, so only
 * one sheet is ever up.
 */
export function backupGroup(closeSettings?: () => void, deps: SaveSheetDeps = {}): HTMLElement {
  const r = resolve(deps);
  const g = document.createElement("section");
  g.className = "v2-set-group v2-save-group";
  const h = document.createElement("h3");
  h.className = "v2-set-title";
  h.textContent = tr("Backup & move", "النسخ الاحتياطي والنقل");
  const note = document.createElement("p");
  note.className = "v2-save-note";
  note.textContent = tr(
    "Keep your trophies and cards safe, or move them to another tablet.",
    "احفظ كؤوسك وبطاقاتك في أمان، أو انقلها إلى جهاز لوحي آخر.",
  );
  g.append(h, note);
  const then = (fn: () => void) => () => {
    closeSettings?.();
    fn();
  };
  g.append(
    actionRow("copy", tr("Copy my save code", "انسخ رمز الحفظ"), "save-copy", then(() => void openCodeSheet(deps))),
    actionRow("save", tr("Save to a file", "احفظ في ملف"), "save-file", () => void saveToFile(deps)),
    actionRow("share", tr("Load a save", "حمّل حفظًا"), "save-load", then(() => openLoadSheet(deps))),
  );
  if (r.store && readBackup(r.store)) {
    g.appendChild(actionRow("back", tr("Undo the last load", "تراجع عن آخر تحميل"), "save-undo", then(() => openUndo(deps))));
  }
  return g;
}

// ---- Copy and file --------------------------------------------------------------------

/** This tablet's save code, or null when storage is blocked. */
export async function currentCode(deps: SaveSheetDeps = {}): Promise<string | null> {
  const r = resolve(deps);
  if (!r.store) return null;
  return encodeSave(gatherSave(r.store, r.now()));
}

/** Download crown-rush-save-<date>.txt holding `shown` (the code on screen) or a fresh code. */
export async function saveToFile(deps: SaveSheetDeps = {}, shown?: string): Promise<void> {
  const code = shown || (await currentCode(deps));
  if (!code) {
    toast(saveErrorText("storage"), "danger");
    return;
  }
  const name = saveFileName(new Date(resolve(deps).now()));
  try {
    const url = URL.createObjectURL(new Blob([`${code}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast(tr(`Saved as ${name}`, `حُفظ باسم ${name}`), "success");
  } catch {
    toast(tr("This browser could not save a file. Copy the code instead.", "تعذّر حفظ الملف في هذا المتصفح. انسخ الرمز بدلًا من ذلك."), "danger");
  }
}

/** The 'Your save code' sheet. */
export async function openCodeSheet(deps: SaveSheetDeps = {}): Promise<{ close: () => void }> {
  const r = resolve(deps);
  const root = document.createElement("div");
  root.className = "v2-save";
  const intro = document.createElement("p");
  intro.className = "v2-save-intro";
  intro.textContent = tr(
    "Copy this code. On the other tablet, open Settings, then Backup & move, then Load a save.",
    "انسخ هذا الرمز. في الجهاز الآخر افتح الإعدادات، ثم النسخ الاحتياطي والنقل، ثم حمّل حفظًا.",
  );
  const box = document.createElement("textarea");
  box.className = "v2-save-code";
  box.readOnly = true;
  box.dir = "ltr";
  box.rows = 5;
  box.spellcheck = false;
  box.setAttribute("aria-label", tr("Save code", "رمز الحفظ"));
  box.value = "…";

  const copy = button({ variant: "primary", size: "lg", icon: "copy", label: tr("Copy", "انسخ"), onClick: () => void doCopy() });
  copy.classList.add("v2-save-copy");
  const file = button({
    variant: "secondary",
    size: "lg",
    icon: "save",
    label: tr("Save to a file", "احفظ في ملف"),
    // The same code as in the box, so the file and the copied code match.
    onClick: () => void saveToFile(deps, box.value.startsWith("CR") ? box.value : undefined),
  });
  file.classList.add("v2-save-tofile");
  const actions = document.createElement("div");
  actions.className = "v2-save-actions";
  actions.append(copy, file);
  const fine = document.createElement("p");
  fine.className = "v2-save-fine";
  fine.textContent = tr(
    "Nothing is sent anywhere. The code stays on this tablet until you copy it.",
    "لا يُرسل أي شيء إلى أي مكان. يبقى الرمز في هذا الجهاز حتى تنسخه.",
  );
  root.append(intro, box, actions, fine);

  const s = openSheet({ title: tr("Your save code", "رمز الحفظ الخاص بك"), content: root, className: "v2-save-sheet" });
  const code = await currentCode(deps);
  box.value = code ?? "";
  copy.disabled = !code;
  if (!code) toast(saveErrorText("storage"), "danger");

  async function doCopy(): Promise<void> {
    if (!box.value || box.value === "…") return;
    try {
      if (r.clipboard) {
        await r.clipboard.writeText(box.value);
        toast(tr("Copied! Keep it somewhere safe.", "تم النسخ! احتفظ به في مكان آمن."), "success");
        return;
      }
    } catch {
      // not allowed here: select it for a copy by hand
    }
    let copied = false;
    try {
      box.focus();
      box.select();
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      copied = false;
    }
    toast(
      copied
        ? tr("Copied! Keep it somewhere safe.", "تم النسخ! احتفظ به في مكان آمن.")
        : tr("The code is selected. Copy it from the box.", "الرمز محدد. انسخه من المربع."),
      copied ? "success" : "neutral",
    );
  }
  return { close: s.close };
}

// ---- Load -------------------------------------------------------------------------------

/** The 'Load a save' sheet: paste a code or pick a file. */
export function openLoadSheet(deps: SaveSheetDeps = {}): { close: () => void } {
  const root = document.createElement("div");
  root.className = "v2-save";
  const intro = document.createElement("p");
  intro.className = "v2-save-intro";
  intro.textContent = tr("Paste a save code, or pick a save file.", "الصق رمز الحفظ، أو اختر ملف الحفظ.");
  const box = document.createElement("textarea");
  box.className = "v2-save-code v2-save-paste";
  box.dir = "ltr";
  box.rows = 5;
  box.spellcheck = false;
  box.autocomplete = "off";
  box.placeholder = tr("Paste the code here", "الصق الرمز هنا");
  box.setAttribute("aria-label", tr("Save code", "رمز الحفظ"));
  const error = document.createElement("p");
  error.className = "v2-save-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".txt,text/plain";
  picker.hidden = true;
  picker.className = "v2-save-picker";

  let busy = false;
  const load = button({
    variant: "primary",
    size: "lg",
    icon: "check",
    label: tr("Load this code", "حمّل هذا الرمز"),
    onClick: () => void tryCode(box.value),
  });
  load.classList.add("v2-save-load");
  const pick = button({
    variant: "secondary",
    size: "lg",
    icon: "save",
    label: tr("Pick a file", "اختر ملفًا"),
    onClick: () => picker.click(),
  });
  pick.classList.add("v2-save-pick");
  const actions = document.createElement("div");
  actions.className = "v2-save-actions";
  actions.append(load, pick);
  root.append(intro, box, error, actions, picker);

  const s = openSheet({ title: tr("Load a save", "حمّل حفظًا"), content: root, className: "v2-save-sheet" });

  const showError = (text: string): void => {
    error.textContent = text;
    error.hidden = false;
  };
  box.addEventListener("input", () => {
    error.hidden = true;
  });

  picker.addEventListener("change", async () => {
    const f = picker.files?.[0];
    picker.value = "";
    if (!f) return;
    if (f.size > CODE_MAX_CHARS * 2) {
      showError(saveErrorText("too-big"));
      return;
    }
    let text: string;
    try {
      text = await f.text();
    } catch {
      showError(saveErrorText("file"));
      return;
    }
    box.value = text.trim();
    await tryCode(text);
  });

  async function tryCode(text: string): Promise<void> {
    if (busy) return;
    busy = true;
    load.disabled = true;
    try {
      const res = await decodeSave(text);
      if (!res.ok) {
        showError(saveErrorText(res.reason));
        return;
      }
      s.close();
      openLoadConfirm(res.data, deps);
    } finally {
      busy = false;
      load.disabled = false;
    }
  }
  return { close: s.close };
}

// ---- Confirm screens ------------------------------------------------------------------------

function arenaName(i: number): string {
  const a = ARENAS[Math.max(0, Math.min(ARENAS.length - 1, i))];
  return tr(a.name, a.ar);
}

function editionName(e: SaveSummary["edition"]): string {
  if (!e) return "—";
  const c = EDITION_COPY[e === "arabic" ? "islamic" : "clash"];
  return tr(c.en, c.ar);
}

/** The side-by-side table: what loads (left, highlighted) and what is here now. */
export function compareTable(load: SaveSummary, here: SaveSummary, loadHead: string, hereHead: string): HTMLTableElement {
  const t = document.createElement("table");
  t.className = "v2-save-compare";
  const head = document.createElement("tr");
  for (const [text, cls] of [
    ["", "v2-save-k"],
    [loadHead, "v2-save-load-col"],
    [hereHead, "v2-save-here-col"],
  ] as const) {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = cls;
    th.textContent = text;
    head.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(head);
  const body = document.createElement("tbody");
  const row = (ic: IconName | null, label: string, a: string, b: string, key: string): void => {
    const tr_ = document.createElement("tr");
    tr_.dataset.row = key;
    const th = document.createElement("th");
    th.scope = "row";
    th.className = "v2-save-k";
    th.innerHTML = ic ? icon(ic) : "";
    const l = document.createElement("span");
    l.textContent = label;
    th.appendChild(l);
    const ca = document.createElement("td");
    ca.className = "v2-save-load-col";
    ca.textContent = a;
    const cb = document.createElement("td");
    cb.className = "v2-save-here-col";
    cb.textContent = b;
    tr_.append(th, ca, cb);
    body.appendChild(tr_);
  };
  if (load.name || here.name) row("profile", tr("Name", "الاسم"), load.name || "—", here.name || "—", "name");
  row("trophy", tr("Trophies", "الكؤوس"), fmtNum(load.trophies), fmtNum(here.trophies), "trophies");
  row("flag", tr("Arena", "الساحة"), arenaName(load.arena), arenaName(here.arena), "arena");
  row("cards", tr("Cards", "البطاقات"), fmtNum(load.cards), fmtNum(here.cards), "cards");
  row("coin", tr("Gold", "الذهب"), fmtNum(load.gold), fmtNum(here.gold), "gold");
  row("gem", tr("Gems", "الجواهر"), fmtNum(load.gems), fmtNum(here.gems), "gems");
  if (load.edition && load.edition !== here.edition) {
    row(null, tr("Edition", "النسخة"), editionName(load.edition), editionName(here.edition), "edition");
  }
  t.append(thead, body);
  return t;
}

interface ConfirmScreen {
  title: string;
  body: string;
  load: SaveSummary;
  here: SaveSummary;
  loadHead: string;
  hereHead: string;
  /** An extra line when the kid would go backwards. */
  warn?: string;
  okLabel: string;
}

/** A sheet with the table and two buttons; resolves true only on the load button. */
export function confirmSheet(c: ConfirmScreen): Promise<boolean> {
  return new Promise((resolveAnswer) => {
    let answered = false;
    const answer = (ok: boolean): void => {
      if (answered) return;
      answered = true;
      resolveAnswer(ok);
      s.close();
    };
    const root = document.createElement("div");
    root.className = "v2-save v2-save-confirm";
    const p = document.createElement("p");
    p.className = "v2-save-intro";
    p.textContent = c.body;
    root.append(p, compareTable(c.load, c.here, c.loadHead, c.hereHead));
    if (c.warn) {
      const w = document.createElement("p");
      w.className = "v2-save-warn";
      w.textContent = c.warn;
      root.appendChild(w);
    }
    const keep = button({ variant: SAVE_LOOK.cancel, size: "lg", label: tr("Keep my progress", "أبقِ تقدّمي"), onClick: () => answer(false) });
    keep.classList.add("v2-save-keep");
    const ok = button({ variant: SAVE_LOOK.ok, size: "lg", label: c.okLabel, onClick: () => answer(true) });
    ok.classList.add("v2-save-ok");
    const actions = document.createElement("div");
    actions.className = "v2-save-actions v2-save-actions--confirm";
    actions.append(keep, ok);
    root.appendChild(actions);
    const s = openSheet({
      title: c.title,
      content: root,
      className: "v2-save-sheet",
      onClose: () => {
        if (!answered) {
          answered = true;
          resolveAnswer(false); // Esc, a scrim tap or a swipe keeps everything as it is
        }
      },
    });
    // The safe answer takes the first focus (after openSheet's own panel focus).
    window.setTimeout(() => {
      if (!answered && s.el.isConnected) keep.focus({ preventScroll: true });
    }, 80);
  });
}

function hereNow(store: SaveStore | null): SaveSummary {
  return summarize(store ? gatherSave(store) : { keys: {} });
}

/** Ask, then load `data` onto this tablet and reload. */
export async function openLoadConfirm(data: SaveData, deps: SaveSheetDeps = {}): Promise<boolean> {
  const r = resolve(deps);
  const load = summarize(data);
  const here = hereNow(r.store);
  const yes = await confirmSheet({
    title: tr("Load this save?", "تحميل هذا الحفظ؟"),
    body: tr(
      "This save will take the place of the progress on this tablet. We keep a copy, so you can undo it.",
      "سيحلّ هذا الحفظ محلّ التقدّم في هذا الجهاز. سنحتفظ بنسخة، فيمكنك التراجع.",
    ),
    load,
    here,
    loadHead: tr("This save", "هذا الحفظ"),
    hereHead: tr("This tablet now", "هذا الجهاز الآن"),
    warn:
      load.trophies < here.trophies
        ? tr("This save has fewer trophies than this tablet.", "في هذا الحفظ كؤوس أقل مما في هذا الجهاز.")
        : undefined,
    okLabel: tr("Load the save", "حمّل الحفظ"),
  });
  if (!yes) {
    toast(tr("Nothing changed.", "لم يتغيّر شيء."), "neutral");
    return false;
  }
  if (!r.store) {
    toast(saveErrorText("storage"), "danger");
    return false;
  }
  const res = applySave(r.store, data, r.now());
  if (!res.ok) {
    toast(saveErrorText(res.reason), "danger");
    return false;
  }
  r.reload("load");
  return true;
}

/** Ask, then put back the progress from before the last load, and reload. */
export async function openUndo(deps: SaveSheetDeps = {}): Promise<boolean> {
  const r = resolve(deps);
  const backup = r.store ? readBackup(r.store) : null;
  if (!r.store || !backup) {
    toast(saveErrorText("no-backup"), "neutral");
    return false;
  }
  const yes = await confirmSheet({
    title: tr("Undo the last load?", "التراجع عن آخر تحميل؟"),
    body: tr(
      "This puts back the progress this tablet had before the last load.",
      "سيعيد هذا التقدّم الذي كان في هذا الجهاز قبل آخر تحميل.",
    ),
    load: summarize(backup),
    here: hereNow(r.store),
    loadHead: tr("Before the load", "قبل التحميل"),
    hereHead: tr("This tablet now", "هذا الجهاز الآن"),
    okLabel: tr("Undo the load", "تراجع عن التحميل"),
  });
  if (!yes) {
    toast(tr("Nothing changed.", "لم يتغيّر شيء."), "neutral");
    return false;
  }
  const res = undoLastLoad(r.store);
  if (!res.ok) {
    toast(saveErrorText(res.reason), "danger");
    return false;
  }
  r.reload("undo");
  return true;
}
