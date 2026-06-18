import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITION,
  EDITION_KEY,
  checkUnityBuild,
  isEdition,
  loadEdition,
  otherEdition,
  saveEdition,
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

describe("edition", () => {
  it("defaults to the native version when nothing is stored", () => {
    expect(loadEdition(fakeStorage())).toBe(DEFAULT_EDITION);
    expect(DEFAULT_EDITION).toBe("native");
  });

  it("round-trips a saved edition through storage", () => {
    const storage = fakeStorage();
    saveEdition(storage, "unity");
    expect(storage.getItem(EDITION_KEY)).toBe("unity");
    expect(loadEdition(storage)).toBe("unity");
  });

  it("ignores a corrupt stored value and falls back to the default", () => {
    expect(loadEdition(fakeStorage({ [EDITION_KEY]: "nintendo" }))).toBe(DEFAULT_EDITION);
  });

  it("recognises only the two real editions", () => {
    expect(isEdition("native")).toBe(true);
    expect(isEdition("unity")).toBe(true);
    expect(isEdition("xbox")).toBe(false);
    expect(isEdition(null)).toBe(false);
  });

  it("toggles between the two editions", () => {
    expect(otherEdition("native")).toBe("unity");
    expect(otherEdition("unity")).toBe("native");
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

    const errored = await checkUnityBuild(async () => {
      throw new Error("not found");
    });
    expect(errored).toBe(false);
  });
});
