import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, type MatchEndPayload } from "../app/hooks";
import type { BattleState } from "../game/battle";
import { LEFT_MATCH_KEY, readMarker } from "../match/leftMatch";
import { HOME_TIP_SEEN_KEY, PERSIST_ASKED_KEY, STANDALONE_HINT_SEEN_KEY } from "../meta/keepSafe";
import { memoryKV } from "../meta/kv";
import { SAVE_BACKUP_KEY } from "../meta/saveCode";
import { toast } from "./components";
import { installFakeDom, type FakeDocument, type FakeElement } from "./fakeDom.testkit";
import { tr } from "./i18n";
import {
  CLEAR_POLL_MS,
  OTHER_TAB_RELOAD_MS,
  onOtherTabStorage,
  resetKeepSafeForTests,
  resetOtherTabForTests,
} from "./keepSafeWire";
import { homeScreenCodeIntro, openStandaloneHint } from "./screens/keepSafeSheet";
import { SAVE_LOADED_KEY } from "./screens/saveSheet";

// Count toasts directly (the toast host outlives one test's fake document).
vi.mock("./components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./components")>()),
  toast: vi.fn(),
}));

const end = (o: Partial<MatchEndPayload>): MatchEndPayload => ({
  kind: "ladder",
  winner: "player",
  mySide: "player",
  myCrowns: 1,
  theirCrowns: 0,
  trophyDelta: 30,
  online: false,
  battle: {} as BattleState,
  replay: false,
  sandbox: false,
  ...o,
});

const FRAME = { dt: 0.016, presentDt: 0.016, alpha: 0, phase: "menu", battle: null };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";

describe("keep-the-save-safe wiring", () => {
  let doc: FakeDocument;
  let local: ReturnType<typeof memoryKV>;
  let session: ReturnType<typeof memoryKV> & { removeItem(k: string): void };
  let persist: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    doc = installFakeDom();
    resetKeepSafeForTests();
    vi.mocked(toast).mockClear();
    local = memoryKV();
    const s = memoryKV();
    session = { ...s, removeItem: (k: string) => void delete s.data[k] };
    persist = vi.fn(async () => true);
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("navigator", { userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, storage: { persisted: async () => false, persist } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetKeepSafeForTests();
  });
  const toasts = () => vi.mocked(toast).mock.calls.map((c) => c[0]);
  const tip = () => doc.querySelector(".v2-keep-tip") as FakeElement | null;
  const hint = () => doc.querySelector(".v2-keep-hint") as FakeElement | null;
  const home = () => emit("screen", { id: "home", sceneMode: "diorama" });
  /** Home, a drawn frame, then time for the sheet to open. */
  const reachHome = async () => {
    home();
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
  };
  const inHomeScreenApp = () =>
    vi.stubGlobal("navigator", { userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, standalone: true, storage: { persist } });

  it("a loss, a replay or Sandbox asks nothing", async () => {
    emit("matchEnd", end({ winner: "enemy" }));
    emit("matchEnd", end({ replay: true }));
    emit("matchEnd", end({ sandbox: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(persist).not.toHaveBeenCalled();
    expect(local.data[PERSIST_ASKED_KEY]).toBeUndefined();
  });

  it("the first win asks once, and the next Home opens the tip sheet once", async () => {
    emit("matchEnd", end({}));
    await vi.advanceTimersByTimeAsync(10);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(local.data[PERSIST_ASKED_KEY]).toBe("1");
    home();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tip()).toBeNull(); // waits for a drawn frame (the boot splash lifts on the first)
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tip()).not.toBeNull();
    expect(local.data[HOME_TIP_SEEN_KEY]).toBe("1");
    // It says the Home Screen game starts empty, and offers the save code first.
    expect(tip()!.querySelectorAll("p").map((p) => p.textContent)).toContain(
      tr(
        "The Home Screen game starts empty. Copy your save code first, then load it there.",
        "اللعبة على الشاشة الرئيسية تبدأ فارغة. انسخ رمز الحفظ أولًا، ثم حمّله هناك.",
      ),
    );
    expect(tip()!.querySelector(".v2-keep-go")!.textContent).toContain(tr("Copy my save code", "انسخ رمز الحفظ"));
    tip()!.querySelector(".v2-keep-later")!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(tip()).toBeNull();
    // A second win asks nothing and shows nothing.
    emit("matchEnd", end({}));
    await reachHome();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(tip()).toBeNull();
    expect(toasts().length).toBe(0);
  });

  it("the tip's Copy my save code opens the code, saying where it goes", async () => {
    local.setItem("cr-clone-trophies", "640");
    emit("matchEnd", end({}));
    await reachHome();
    tip()!.querySelector(".v2-keep-go")!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(tip()).toBeNull();
    const sheet = doc.querySelector(".v2-save-sheet") as FakeElement;
    expect(sheet.querySelector(".v2-save-intro")!.textContent).toBe(homeScreenCodeIntro());
    expect((sheet.querySelector(".v2-save-code") as unknown as { value: string }).value).toMatch(/^CR1[ZP]/);
  });

  it("the tip waits while another sheet or the chest reveal is up", async () => {
    const other = doc.createElement("div");
    other.className = "ui-sheet";
    doc.body.appendChild(other);
    emit("matchEnd", end({}));
    await reachHome();
    await vi.advanceTimersByTimeAsync(CLEAR_POLL_MS * 3);
    expect(tip()).toBeNull();
    expect(local.data[HOME_TIP_SEEN_KEY]).toBeUndefined();
    other.className = "rw-reveal";
    await vi.advanceTimersByTimeAsync(CLEAR_POLL_MS * 3);
    expect(tip()).toBeNull();
    other.remove();
    await vi.advanceTimersByTimeAsync(CLEAR_POLL_MS);
    expect(tip()).not.toBeNull();
  });

  it("a Home left before the tip opened tries again next time", async () => {
    emit("matchEnd", end({}));
    home();
    emit("screen", { id: "battle", sceneMode: "battle" });
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tip()).toBeNull();
    expect(local.data[HOME_TIP_SEEN_KEY]).toBeUndefined();
    await reachHome();
    expect(tip()).not.toBeNull();
  });

  it("the Home Screen game, with no progress yet, opens the 'Played in Safari before?' hint once", async () => {
    inHomeScreenApp();
    await reachHome();
    expect(hint()).not.toBeNull();
    expect(local.data[STANDALONE_HINT_SEEN_KEY]).toBe("1");
    // Its big button goes straight to Load a save.
    hint()!.querySelector(".v2-keep-go")!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(hint()).toBeNull();
    expect(doc.querySelector(".v2-save-paste")).not.toBeNull();
    // Once only.
    await reachHome();
    expect(hint()).toBeNull();
  });

  it("no hint with progress, in a Safari tab, and no tip in the Home Screen game", async () => {
    inHomeScreenApp();
    local.setItem("cr-clone-trophies", "300");
    emit("matchEnd", end({}));
    await reachHome();
    expect(hint()).toBeNull();
    expect(tip()).toBeNull();
    expect(local.data[STANDALONE_HINT_SEEN_KEY]).toBeUndefined();
    vi.stubGlobal("navigator", { userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, storage: { persist } });
    local.setItem("cr-clone-trophies", "0");
    await reachHome();
    expect(hint()).toBeNull();
  });

  it("before an edition is picked, the hint reads in both languages", () => {
    const h = openStandaloneHint({}, { both: true });
    const sheet = doc.querySelector(".v2-keep-hint") as FakeElement;
    const intro = sheet.querySelector(".v2-save-intro")!;
    expect(intro.classList.contains("v2-keep-both")).toBe(true);
    const parts = intro.querySelectorAll("span");
    expect(parts.map((p) => p.textContent)).toEqual([
      "This Home Screen game keeps its own save, so it starts empty. Bring your trophies and cards with your save code.",
      "اللعبة على الشاشة الرئيسية لها حفظ خاص بها، لذلك تبدأ فارغة. انقل كؤوسك وبطاقاتك برمز الحفظ.",
    ]);
    expect(parts[1].dir).toBe("rtl");
    // The title reads in both languages too, each on its own line.
    const title = (sheet.closest(".ui-sheet") as FakeElement).querySelector(".ui-sheet__title")!;
    expect(title.querySelectorAll("span").map((p) => p.textContent)).toEqual(["Played in Safari before?", "هل لعبت في سفاري من قبل؟"]);
    expect(sheet.querySelector(".v2-keep-go")!.textContent).toContain("Load my save · حمّل حفظي");
    h.close();
  });

  it("after a load, Home says so once", async () => {
    session.setItem(SAVE_LOADED_KEY, "load");
    emit("screen", { id: "home", sceneMode: "diorama" });
    expect(session.data[SAVE_LOADED_KEY]).toBeUndefined();
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toasts().length).toBe(1);
    emit("screen", { id: "home", sceneMode: "diorama" });
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toasts().length).toBe(1);
  });

  it("after an undo or a redo, Home says which", async () => {
    for (const [what, line] of [
      ["undo", tr("Everything is back to how it was before the load.", "عاد كل شيء كما كان قبل التحميل.")],
      ["redo", tr("Everything is back to how it was before the undo.", "عاد كل شيء كما كان قبل التراجع.")],
    ] as const) {
      vi.mocked(toast).mockClear();
      session.setItem(SAVE_LOADED_KEY, what);
      emit("screen", { id: "home", sceneMode: "diorama" });
      emit("frame", FRAME);
      await vi.advanceTimersByTimeAsync(1000);
      expect(toasts()).toEqual([line]);
    }
  });
});

describe("another tab loads a save", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    installFakeDom();
    resetOtherTabForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetOtherTabForTests();
  });
  const marker = () => memoryKV({ [LEFT_MATCH_KEY]: JSON.stringify({ at: Date.now(), trophies: 300 }) });

  it("reloads this tab once, a moment later, only for a change to the backup slot", async () => {
    const kv = marker();
    const reload = vi.fn();
    const deps = { kv, reload, inMatch: false };
    expect(onOtherTabStorage({ key: "cr-clone-settings", oldValue: "a", newValue: "b" }, deps)).toBe(false);
    expect(onOtherTabStorage({ key: SAVE_BACKUP_KEY, oldValue: "x", newValue: "x" }, deps)).toBe(false);
    expect(onOtherTabStorage({ key: null, oldValue: null, newValue: null }, deps)).toBe(false);
    expect(onOtherTabStorage({ key: SAVE_BACKUP_KEY, oldValue: null, newValue: '{"b":"load"}' }, deps)).toBe(true);
    expect(onOtherTabStorage({ key: SAVE_BACKUP_KEY, oldValue: '{"b":"load"}', newValue: '{"b":"undo"}' }, deps)).toBe(false);
    await vi.advanceTimersByTimeAsync(OTHER_TAB_RELOAD_MS - 10);
    expect(reload).not.toHaveBeenCalled(); // the rest of the other tab's writes land first
    await vi.advanceTimersByTimeAsync(20);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readMarker(kv)).not.toBeNull(); // no match here: the marker is not this tab's
  });

  it("a match being played here was the old profile's: the reload does not count it as a loss", async () => {
    const kv = marker();
    const reload = vi.fn();
    expect(onOtherTabStorage({ key: SAVE_BACKUP_KEY, oldValue: "a", newValue: "b" }, { kv, reload, inMatch: true })).toBe(true);
    expect(readMarker(kv)).toBeNull();
    await vi.advanceTimersByTimeAsync(OTHER_TAB_RELOAD_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
