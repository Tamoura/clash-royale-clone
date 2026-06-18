import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  MODE_KEY,
  checkUnityBuild,
  isGameMode,
  loadMode,
  otherMode,
  saveMode,
  unityBuildUrl,
  type ModeStorage,
} from "./mode";

/** A tiny in-memory localStorage stand-in for the node test env. */
function fakeStorage(seed: Record<string, string> = {}): ModeStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("game mode", () => {
  it("defaults to the native version when nothing is stored", () => {
    expect(loadMode(fakeStorage())).toBe(DEFAULT_MODE);
    expect(DEFAULT_MODE).toBe("native");
  });

  it("round-trips a saved mode through storage", () => {
    const storage = fakeStorage();
    saveMode(storage, "unity");
    expect(storage.getItem(MODE_KEY)).toBe("unity");
    expect(loadMode(storage)).toBe("unity");
  });

  it("ignores a corrupt stored value and falls back to the default", () => {
    expect(loadMode(fakeStorage({ [MODE_KEY]: "nintendo" }))).toBe(DEFAULT_MODE);
  });

  it("recognises only the two real modes", () => {
    expect(isGameMode("native")).toBe(true);
    expect(isGameMode("unity")).toBe(true);
    expect(isGameMode("xbox")).toBe(false);
    expect(isGameMode(null)).toBe(false);
  });

  it("toggles between the two modes", () => {
    expect(otherMode("native")).toBe("unity");
    expect(otherMode("unity")).toBe("native");
  });
});

describe("unity build url", () => {
  it("points at the served WebGL build loader", () => {
    expect(unityBuildUrl()).toBe("unity/index.html");
    expect(unityBuildUrl("/")).toBe("/unity/index.html");
  });

  it("passes the chosen deck as a query param when given", () => {
    expect(unityBuildUrl("", ["knight", "mini-pekka"])).toBe(
      "unity/index.html?deck=knight,mini-pekka",
    );
    expect(unityBuildUrl("", [])).toBe("unity/index.html");
  });

  it("reports the build present only on a successful fetch", async () => {
    const ok = await checkUnityBuild(async () => ({ ok: true }) as Response);
    expect(ok).toBe(true);

    const missing = await checkUnityBuild(async () => ({ ok: false }) as Response);
    expect(missing).toBe(false);

    // A network/file error means "no build" rather than a thrown rejection.
    const errored = await checkUnityBuild(async () => {
      throw new Error("not found");
    });
    expect(errored).toBe(false);
  });
});
