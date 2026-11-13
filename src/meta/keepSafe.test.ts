import { describe, expect, it } from "vitest";
import { memoryKV } from "./kv";
import {
  HOME_TIP_SEEN_KEY,
  PERSIST_ASKED_KEY,
  askToKeepSaveOnce,
  isAppleTouchDevice,
  markHomeTipSeen,
  shouldShowHomeTip,
  type DeviceInfo,
  type PersistApi,
} from "./keepSafe";

function api(persisted: boolean, grant: boolean): PersistApi & { calls: number } {
  const a = {
    calls: 0,
    persisted: async () => persisted,
    persist: async () => {
      a.calls++;
      return grant;
    },
  };
  return a;
}

describe("askToKeepSaveOnce", () => {
  it("asks once, then never again", async () => {
    const kv = memoryKV();
    const a = api(false, true);
    expect(await askToKeepSaveOnce(kv, a)).toBe("granted");
    expect(kv.data[PERSIST_ASKED_KEY]).toBe("1");
    expect(await askToKeepSaveOnce(kv, a)).toBe("already-asked");
    expect(a.calls).toBe(1);
  });

  it("does not ask when the storage is already kept", async () => {
    const a = api(true, true);
    expect(await askToKeepSaveOnce(memoryKV(), a)).toBe("already-kept");
    expect(a.calls).toBe(0);
  });

  it("copes with a refusal, a throw and no API at all", async () => {
    expect(await askToKeepSaveOnce(memoryKV(), api(false, false))).toBe("denied");
    const throws: PersistApi = { persist: async () => Promise.reject(new Error("nope")) };
    expect(await askToKeepSaveOnce(memoryKV(), throws)).toBe("denied");
    expect(await askToKeepSaveOnce(memoryKV(), undefined)).toBe("unsupported");
    expect(await askToKeepSaveOnce(null, api(false, true))).toBe("granted"); // blocked storage: still asks
  });
});

const iphone: DeviceInfo = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
  standalone: false,
};

describe("the Home Screen tip", () => {
  it("shows once on an iPhone or iPad browser tab", () => {
    const kv = memoryKV();
    expect(shouldShowHomeTip(kv, iphone)).toBe(true);
    markHomeTipSeen(kv);
    expect(kv.data[HOME_TIP_SEEN_KEY]).toBe("1");
    expect(shouldShowHomeTip(kv, iphone)).toBe(false);
  });

  it("knows an iPad asking for desktop sites", () => {
    const ipad: DeviceInfo = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5, standalone: false };
    expect(isAppleTouchDevice(ipad)).toBe(true);
    expect(isAppleTouchDevice({ ...ipad, maxTouchPoints: 0 })).toBe(false); // a real Mac
  });

  it("stays quiet when opened from the Home Screen, and on other devices", () => {
    expect(shouldShowHomeTip(memoryKV(), { ...iphone, standalone: true })).toBe(false);
    const android: DeviceInfo = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile", platform: "Linux armv8l", maxTouchPoints: 5, standalone: false };
    expect(shouldShowHomeTip(memoryKV(), android)).toBe(false);
  });
});
