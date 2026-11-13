import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, type MatchEndPayload } from "../app/hooks";
import type { BattleState } from "../game/battle";
import { HOME_TIP_SEEN_KEY, PERSIST_ASKED_KEY } from "../meta/keepSafe";
import { memoryKV } from "../meta/kv";
import { toast } from "./components";
import { installFakeDom } from "./fakeDom.testkit";
import "./keepSafeWire";
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
});
