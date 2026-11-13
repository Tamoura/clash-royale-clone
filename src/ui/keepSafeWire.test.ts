import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, type MatchEndPayload } from "../app/hooks";
import type { BattleState } from "../game/battle";
import { LEFT_MATCH_KEY, readMarker } from "../match/leftMatch";
import { HOME_TIP_SEEN_KEY, PERSIST_ASKED_KEY } from "../meta/keepSafe";
import { memoryKV } from "../meta/kv";
import { SAVE_BACKUP_KEY } from "../meta/saveCode";
import { toast } from "./components";
import { installFakeDom } from "./fakeDom.testkit";
import { tr } from "./i18n";
import { OTHER_TAB_RELOAD_MS, onOtherTabStorage, resetOtherTabForTests } from "./keepSafeWire";
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
  let local: ReturnType<typeof memoryKV>;
  let session: ReturnType<typeof memoryKV> & { removeItem(k: string): void };
  let persist: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    installFakeDom();
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
  });
  const toasts = () => vi.mocked(toast).mock.calls.map((c) => c[0]);

  it("a loss, a replay or Sandbox asks nothing", async () => {
    emit("matchEnd", end({ winner: "enemy" }));
    emit("matchEnd", end({ replay: true }));
    emit("matchEnd", end({ sandbox: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(persist).not.toHaveBeenCalled();
    expect(local.data[PERSIST_ASKED_KEY]).toBeUndefined();
  });

  it("the first win asks once, and the next Home shows the tip once", async () => {
    emit("matchEnd", end({}));
    await vi.advanceTimersByTimeAsync(10);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(local.data[PERSIST_ASKED_KEY]).toBe("1");
    emit("screen", { id: "home", sceneMode: "diorama" });
    expect(local.data[HOME_TIP_SEEN_KEY]).toBe("1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(toasts().length).toBe(0); // waits for a drawn frame (the boot splash lifts on the first)
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toasts().length).toBe(1);
    emit("matchEnd", end({}));
    emit("screen", { id: "home", sceneMode: "diorama" });
    emit("frame", FRAME);
    await vi.advanceTimersByTimeAsync(1000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(toasts().length).toBe(1);
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
