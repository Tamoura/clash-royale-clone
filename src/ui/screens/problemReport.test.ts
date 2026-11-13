import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemLog, type ProblemStore } from "../../app/problemLog";
import { installFakeDom, type FakeElement } from "../fakeDom.testkit";
import { buildProblemReport, deviceHeader, OOPS_PARAM, problemReportRow, reportText } from "./problemReport";

// The sheet itself mounts through frame.ts (Home's chrome and its styles).
vi.mock("./frame", () => ({ openSheet: () => ({ el: document.createElement("div"), close: () => undefined }) }));
// Toasts are module-level (one host per page); this test reads what they said.
const said: string[] = [];
vi.mock("../components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components")>()),
  toast: (text: string) => {
    said.push(text);
    return document.createElement("div");
  },
}));

function memLog(): ProblemLog {
  const data: Record<string, string> = {};
  const store: ProblemStore = {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
  let t = Date.UTC(2026, 10, 13, 10, 0, 0);
  const log = new ProblemLog({ store: () => store, now: () => (t += 1000), build: "abc1234-xyz", later: () => undefined });
  log.setContext(() => ({ screen: "battle/playing", quality: "auto L2", edition: "golden-age", online: false }));
  return log;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// vitest has no localStorage, so this is the Golden Age (Arabic) chrome.
describe("the Problem report sheet", () => {
  beforeEach(() => {
    installFakeDom();
    said.length = 0;
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("navigator", { userAgent: "TestBrowser/1.0" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const toasts = (): string[] => said;

  it("says there are no problems, with Clear off", () => {
    const { el } = buildProblemReport({ log: memLog(), clipboard: null });
    const empty = el.querySelector(".v2-problem-empty") as unknown as FakeElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("لا مشكلات حتى الآن!");
    expect((el.querySelector(".v2-problem-clear") as unknown as FakeElement).disabled).toBe(true);
    expect(el.textContent).toContain(OOPS_PARAM);
  });

  it("lists problems newest first, with repeat counts, and follows the log while open", () => {
    const log = memLog();
    const { el, dispose } = buildProblemReport({ log, clipboard: null });
    log.record("frame", new Error("first"));
    log.record("frame", new TypeError("second"));
    log.record("frame", new TypeError("second"));
    const rows = el.querySelectorAll(".v2-problem") as unknown as FakeElement[];
    expect(rows.map((r) => r.querySelector(".v2-problem-msg")!.textContent)).toEqual(["TypeError: second", "Error: first"]);
    expect(rows[0].querySelector(".v2-problem-count")!.textContent).toBe("×٢"); // Arabic-Indic digits
    expect(rows[0].querySelector(".v2-problem-msg")!.dir).toBe("ltr"); // recorded lines stay as recorded
    expect(rows[0].querySelector(".v2-problem-where")!.textContent).toBe("battle/playing");
    log.record("frame", new Error("tower fx"), "battle event 'death'");
    const top = (el.querySelectorAll(".v2-problem") as unknown as FakeElement[])[0];
    expect(top.querySelector(".v2-problem-where")!.textContent).toBe("battle/playing · battle event 'death'");
    dispose();
    log.record("frame", new Error("after close"));
    expect(el.querySelectorAll(".v2-problem")).toHaveLength(3);
  });

  it("Copy puts the whole plain-text report on the clipboard", async () => {
    const log = memLog();
    log.record("frame", new Error("boom"));
    const written: string[] = [];
    const { el } = buildProblemReport({ log, clipboard: { writeText: async (t) => void written.push(t) } });
    (el.querySelector(".v2-problem-copy") as unknown as FakeElement).click();
    await flush();
    expect(written).toHaveLength(1);
    const text = written[0];
    expect(text.split("\n").slice(1, 6)).toEqual([
      "الإصدار: abc1234-xyz",
      "المتصفح: TestBrowser/1.0",
      "الشاشة: 390x844 @2x",
      "الرسومات: auto L2",
      "النسخة: golden-age",
    ]);
    expect(text).toContain("Error: boom");
    expect(toasts().join(" ")).toContain("تم النسخ!");
  });

  it("falls back to a selected box when the clipboard refuses", async () => {
    const log = memLog();
    log.record("frame", new Error("boom"));
    const { el } = buildProblemReport({
      log,
      clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
    });
    const box = el.querySelector(".v2-problem-text") as unknown as FakeElement & { value: string };
    expect(box.hidden).toBe(true);
    (el.querySelector(".v2-problem-copy") as unknown as FakeElement).click();
    await flush();
    expect(box.hidden).toBe(false);
    expect(box.value).toContain("Error: boom");
    expect(toasts().join(" ")).toContain("التقرير محدد في الأسفل");
  });

  it("the fallback selects the whole box with a selection range too (iOS Safari), even when select() fails", async () => {
    const log = memLog();
    log.record("frame", new Error("boom"));
    const { el } = buildProblemReport({ log, clipboard: null });
    const box = el.querySelector(".v2-problem-text") as unknown as FakeElement & {
      value: string;
      select(): void;
      setSelectionRange(a: number, b: number): void;
    };
    const ranges: [number, number][] = [];
    box.select = () => {
      throw new Error("select is not supported here");
    };
    box.setSelectionRange = (a, b) => void ranges.push([a, b]);
    const copied: string[] = [];
    // installFakeDom() gives every test a fresh document.
    (document as unknown as { execCommand(cmd: string): boolean }).execCommand = (cmd) => (copied.push(cmd), true);
    (el.querySelector(".v2-problem-copy") as unknown as FakeElement).click();
    await flush();
    expect(ranges).toEqual([[0, box.value.length]]);
    expect(box.value.length).toBeGreaterThan(0);
    expect(copied).toEqual(["copy"]);
    expect(toasts().join(" ")).toContain("تم النسخ!");
  });

  it("Clear empties the log and the list", () => {
    const log = memLog();
    log.record("frame", new Error("boom"));
    const { el } = buildProblemReport({ log, clipboard: null });
    (el.querySelector(".v2-problem-clear") as unknown as FakeElement).click();
    expect(log.list()).toEqual([]);
    expect(el.querySelectorAll(".v2-problem")).toHaveLength(0);
    expect((el.querySelector(".v2-problem-empty") as unknown as FakeElement).hidden).toBe(false);
  });

  it("the report header describes this device", () => {
    const log = memLog();
    expect(deviceHeader(log, 5)).toEqual({
      build: "abc1234-xyz",
      browser: "TestBrowser/1.0",
      screen: "390x844 @2x",
      quality: "auto L2",
      edition: "golden-age",
      now: 5,
    });
    expect(reportText(log, 0).split("\n").at(-1)).toBe("لا مشكلات حتى الآن!");
  });

  it("in the Golden Age, only the title and header are Arabic: every problem line stays plain Latin", () => {
    const log = memLog();
    log.record("frame", new Error("boom"));
    log.record("frame", new Error("boom"));
    log.record("promise", new Error("later"));
    const lines = reportText(log, Date.UTC(2026, 10, 13, 11, 0, 0)).split("\n");
    const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
    expect(lines[0]).toMatch(ARABIC_SCRIPT); // the title
    expect(lines[1]).toBe("الإصدار: abc1234-xyz"); // a header label, then its value
    const first = lines.findIndex((l) => l.startsWith("#1 "));
    expect(first).toBeGreaterThan(0);
    const entries = lines.slice(first);
    for (const line of entries) expect(line).not.toMatch(ARABIC_SCRIPT);
    expect(entries.some((l) => /· seen 2 times, last 2026-11-13 \d\d:\d\d:\d\d UTC · frame$/.test(l))).toBe(true);
    expect(entries.filter((l) => l.startsWith("Where: battle/playing · auto L2 · golden-age"))).toHaveLength(2);
  });

  it("the Settings row closes Settings first", () => {
    let closed = 0;
    const row = problemReportRow(() => closed++) as unknown as FakeElement;
    expect(row.textContent).toBe("تقرير المشكلات");
    row.click();
    expect(closed).toBe(1);
  });
});
