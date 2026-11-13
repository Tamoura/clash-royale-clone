import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKV } from "../../meta/kv";
import {
  SAVE_BACKUP_KEY,
  applySave,
  gatherSave,
  readBackupSlot,
  undoLastLoad,
  type SaveData,
  type SaveError,
  type SaveStore,
} from "../../meta/saveCode";
import { ARABIC } from "../../render3d/theme";
import { installFakeDom, pressKey, type FakeDocument, type FakeElement } from "../fakeDom.testkit";
import { fmtNum, tr } from "../i18n";
import { icon } from "../icons";
import { SAVE_LOOK, backupGroup, codeSheetIntro, openLoadConfirm, openUndo, saveErrorText } from "./saveSheet";

function store(seed: Record<string, string> = {}): SaveStore & { data: Record<string, string> } {
  const kv = memoryKV(seed);
  return {
    data: kv.data,
    getItem: kv.getItem,
    setItem: kv.setItem,
    removeItem: (k) => {
      delete kv.data[k];
    },
  };
}

const HERE = {
  "cr-clone-meta-v1": "1",
  "cr-clone-trophies": "120",
  "cr-clone-gold": "80",
  "cr-clone-settings": JSON.stringify({ v: 1, master: 0.4, quality: "low", playerName: "Mira", crest: 2 }),
  "cr-clone-relay": "ws://localhost:3000",
};
const SAVE: SaveData = {
  at: 1,
  keys: { "cr-clone-meta-v1": "1", "cr-clone-trophies": "1450", "cr-clone-gold": "5200", "cr-clone-gems": "30" },
  who: { name: "Zaid", crest: 5 },
};

describe("Backup & move words", () => {
  it("has a friendly line for every way a load can go wrong", () => {
    const reasons: (SaveError | "storage" | "no-backup" | "file")[] = [
      "empty",
      "too-big",
      "not-a-code",
      "deck-code",
      "typo",
      "newer",
      "wrong-game",
      "damaged",
      "empty-save",
      "storage",
      "no-backup",
      "file",
    ];
    const lines = reasons.map(saveErrorText);
    for (const l of lines) expect(l.length).toBeGreaterThan(10);
    expect(new Set(lines).size).toBe(reasons.length);
  });

  it("makes 'Keep my progress' the big default", () => {
    expect(SAVE_LOOK.cancel).toBe("cta");
    expect(SAVE_LOOK.focus).toBe("cancel");
  });
});

describe("Backup & move on the page", () => {
  let doc: FakeDocument;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    doc = installFakeDom();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const settle = () => vi.advanceTimersByTimeAsync(600);
  const sheet = () => doc.querySelector(".v2-save-confirm") as FakeElement | null;

  it("offers copy, file and load, and Undo only while a backup exists", () => {
    const s = store(HERE);
    const acts = (g: { querySelectorAll(s: string): { dataset: Record<string, string> }[] }) =>
      g.querySelectorAll(".v2-set-action").map((b) => b.dataset.act);
    const g = backupGroup(undefined, { store: s }) as unknown as FakeElement;
    expect(acts(g)).toEqual(["save-copy", "save-file", "save-load"]);
    expect(g.querySelector(".v2-set-title")!.textContent).toBe(tr("Backup & move", "النسخ الاحتياطي والنقل"));
    applySave(s, SAVE);
    const g2 = backupGroup(undefined, { store: s }) as unknown as FakeElement;
    expect(acts(g2)).toEqual(["save-copy", "save-file", "save-load", "save-undo"]);
    const undoRow = g2.querySelector('[data-act="save-undo"]')!;
    expect(undoRow.textContent).toContain(tr("Undo the last load", "تراجع عن آخر تحميل"));
    // 'Load a save' has its own down-into-a-tray glyph, not the share icon.
    const loadGlyph = g2.querySelector('[data-act="save-load"]')!.innerHTML;
    expect(loadGlyph).toContain("ui-icon");
    expect(loadGlyph).not.toContain(icon("share"));
  });

  it("shows the save next to this tablet, with Keep my progress first and focused", async () => {
    const s = store(HERE);
    const reload = vi.fn();
    void openLoadConfirm(SAVE, { store: s, reload });
    await settle();
    const c = sheet()!;
    expect(c).not.toBeNull();
    const cells = (row: string) => c.querySelectorAll(`tr[data-row="${row}"] td`).map((td) => td.textContent);
    expect(cells("trophies")).toEqual([fmtNum(1450), fmtNum(120)]);
    expect(cells("gold")).toEqual([fmtNum(5200), fmtNum(80)]);
    expect(cells("gems")).toEqual([fmtNum(30), fmtNum(0)]);
    expect(cells("name")).toEqual(["Zaid", "Mira"]);
    const buttons = c.querySelectorAll(".v2-save-actions button");
    expect(buttons[0].classList.contains("v2-save-keep")).toBe(true);
    expect(buttons[0].classList.contains("ui-btn--cta")).toBe(true);
    expect(doc.activeElement).toBe(buttons[0]);
    expect((c.closest(".ui-sheet") as FakeElement).dir).toBe(ARABIC ? "rtl" : "");
    expect(reload).not.toHaveBeenCalled();
  });

  it("Keep my progress (or Esc) changes nothing", async () => {
    for (const how of ["keep", "esc"] as const) {
      const s = store(HERE);
      const before = { ...s.data };
      const reload = vi.fn();
      const answer = openLoadConfirm(SAVE, { store: s, reload });
      await settle();
      if (how === "keep") sheet()!.querySelector(".v2-save-keep")!.click();
      else pressKey(doc, "Escape");
      await settle();
      expect(await answer).toBe(false);
      expect(s.data).toEqual(before);
      expect(reload).not.toHaveBeenCalled();
      await settle();
    }
  });

  it("Load the save backs up, writes the save, leaves device keys and reloads", async () => {
    const s = store(HERE);
    const reload = vi.fn();
    const answer = openLoadConfirm(SAVE, { store: s, reload, now: () => 99 });
    await settle();
    sheet()!.querySelector(".v2-save-ok")!.click();
    expect(await answer).toBe(true);
    expect(reload).toHaveBeenCalledWith("load");
    expect(s.data["cr-clone-trophies"]).toBe("1450");
    expect(s.data["cr-clone-relay"]).toBe(HERE["cr-clone-relay"]);
    expect(JSON.parse(s.data["cr-clone-settings"])).toMatchObject({ master: 0.4, quality: "low", playerName: "Zaid", crest: 5 });
    expect(JSON.parse(s.data[SAVE_BACKUP_KEY]).k["cr-clone-trophies"]).toBe("120");
  });

  it("warns when the save has fewer trophies than this tablet", async () => {
    const s = store({ ...HERE, "cr-clone-trophies": "2000" });
    void openLoadConfirm(SAVE, { store: s, reload: vi.fn() });
    await settle();
    expect(sheet()!.querySelector(".v2-save-warn")).not.toBeNull();
    // Above the table, so it is seen before the table scrolls under the buttons.
    const order = sheet()!.children.map((e) => e.className.split(" ")[0]);
    expect(order.indexOf("v2-save-warn")).toBeLessThan(order.indexOf("v2-save-compare"));
  });

  it("says so when a load would replace a kept copy with more trophies (Redo or Undo)", async () => {
    const warns = () => sheet()!.querySelectorAll(".v2-save-warn").map((w) => w.textContent);
    const other: SaveData = { at: 2, keys: { "cr-clone-meta-v1": "1", "cr-clone-trophies": "300" } };

    // Load, then undo: the 1,450-trophy progress waits in the slot for Redo.
    const s = store(HERE);
    applySave(s, SAVE);
    undoLastLoad(s);
    void openLoadConfirm(other, { store: s, reload: vi.fn() });
    await settle();
    expect(warns()).toEqual([
      tr(`Your Redo copy (${fmtNum(1450)} trophies) will be replaced.`, `ستُستبدل نسخة الإعادة (الكؤوس: ${fmtNum(1450)}).`),
    ]);
    pressKey(doc, "Escape");
    await settle();

    // A bigger tablet loaded a smaller save: its own 2,000 trophies wait for Undo.
    const t = store({ ...HERE, "cr-clone-trophies": "2000" });
    applySave(t, SAVE);
    void openLoadConfirm(other, { store: t, reload: vi.fn() });
    await settle();
    expect(warns()).toEqual([
      tr("This save has fewer trophies than this tablet.", "في هذا الحفظ كؤوس أقل مما في هذا الجهاز."),
      tr(`Your Undo copy (${fmtNum(2000)} trophies) will be replaced.`, `ستُستبدل نسخة التراجع (الكؤوس: ${fmtNum(2000)}).`),
    ]);
    pressKey(doc, "Escape");
    await settle();

    // A kept copy with fewer trophies than this tablet: nothing to say.
    const u = store(HERE);
    applySave(u, SAVE);
    void openLoadConfirm({ ...SAVE, at: 3 }, { store: u, reload: vi.fn() });
    await settle();
    expect(warns()).toEqual([]);
  });

  it("the code sheet tells a new tablet to skip the tutorial first", () => {
    expect(codeSheetIntro()).toContain(tr("Skip tutorial", "تخطَّ الشرح"));
  });

  it("Undo asks the same way, warns about fewer trophies, then puts this tablet back", async () => {
    const s = store(HERE);
    const original = gatherSave(s).keys;
    applySave(s, SAVE);
    const loaded = gatherSave(s).keys;
    const reload = vi.fn();
    const answer = openUndo({ store: s, reload });
    await settle();
    const c = sheet()!;
    expect(c.querySelectorAll('tr[data-row="trophies"] td').map((td) => td.textContent)).toEqual([fmtNum(120), fmtNum(1450)]);
    expect(c.querySelector(".v2-save-warn")!.textContent).toBe(
      tr("You will have fewer trophies than now.", "سيصبح عندك كؤوس أقل من الآن."),
    );
    expect(c.querySelector(".v2-save-intro")!.textContent).toContain(
      tr("kept as a backup, so you can switch back", "كنسخة احتياطية، فيمكنك الرجوع إليه"),
    );
    expect(c.querySelectorAll(".v2-save-actions button")[0].classList.contains("v2-save-keep")).toBe(true);
    c.querySelector(".v2-save-ok")!.click();
    expect(await answer).toBe(true);
    expect(gatherSave(s).keys).toEqual(original);
    // The loaded progress waits in the slot: the undo can be undone.
    expect(readBackupSlot(s)).toMatchObject({ kind: "undo", data: { keys: loaded } });
    expect(reload).toHaveBeenCalledWith("undo");
  });

  it("after an undo, the row offers Redo, which brings the loaded progress back", async () => {
    const s = store(HERE);
    applySave(s, SAVE);
    const loaded = gatherSave(s).keys;
    const undo = openUndo({ store: s, reload: vi.fn() });
    await settle();
    sheet()!.querySelector(".v2-save-ok")!.click();
    expect(await undo).toBe(true);
    await settle();

    const g = backupGroup(undefined, { store: s }) as unknown as FakeElement;
    expect(g.querySelector('[data-act="save-undo"]')!.textContent).toContain(tr("Redo the last load", "أعِد آخر تحميل"));
    const reload = vi.fn();
    const redo = openUndo({ store: s, reload });
    await settle();
    const c = sheet()!;
    expect(c.querySelector(".v2-save-warn")).toBeNull(); // more trophies: no warning
    expect(c.querySelector("thead .v2-save-load-col")!.textContent).toBe(tr("Before the undo", "قبل التراجع"));
    c.querySelector(".v2-save-ok")!.click();
    expect(await redo).toBe(true);
    expect(gatherSave(s).keys).toEqual(loaded);
    expect(readBackupSlot(s)?.kind).toBe("load");
    expect(reload).toHaveBeenCalledWith("redo");
  });

  it("the undo screen keeps Keep my progress focused while Settings closes underneath", async () => {
    const s = store(HERE);
    applySave(s, SAVE);
    const gear = doc.createElement("button");
    doc.body.appendChild(gear);
    void openUndo({ store: s, reload: vi.fn() });
    await vi.advanceTimersByTimeAsync(450);
    gear.focus(); // the closing Settings sheet hands the focus back to its opener
    await vi.advanceTimersByTimeAsync(200);
    expect(doc.activeElement).toBe(sheet()!.querySelector(".v2-save-keep"));
  });

  it("Keep my progress on the undo screen changes nothing", async () => {
    const s = store(HERE);
    applySave(s, SAVE);
    const before = { ...s.data };
    const reload = vi.fn();
    const answer = openUndo({ store: s, reload });
    await settle();
    sheet()!.querySelector(".v2-save-keep")!.click();
    expect(await answer).toBe(false);
    expect(s.data).toEqual(before);
    expect(s.data[SAVE_BACKUP_KEY]).toBe(before[SAVE_BACKUP_KEY]);
    expect(reload).not.toHaveBeenCalled();
  });
});
