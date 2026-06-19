import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  isGameMode,
  loadMode,
  modeToTheme,
  otherMode,
  saveMode,
  themeToMode,
  type ModeStorage,
} from "./mode";
import { ARENA_THEME_KEY } from "../render3d/theme";

/** A tiny in-memory localStorage stand-in for the node test env. */
function fakeStorage(seed: Record<string, string> = {}): ModeStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("game mode", () => {
  it("defaults to the Islamic version when nothing is stored", () => {
    expect(loadMode(fakeStorage())).toBe(DEFAULT_MODE);
    expect(DEFAULT_MODE).toBe("islamic");
  });

  it("round-trips a saved mode through the shared theme key", () => {
    const storage = fakeStorage();
    saveMode(storage, "clash");
    expect(storage.getItem(ARENA_THEME_KEY)).toBe("normal");
    expect(loadMode(storage)).toBe("clash");

    saveMode(storage, "islamic");
    expect(storage.getItem(ARENA_THEME_KEY)).toBe("arabic");
    expect(loadMode(storage)).toBe("islamic");
  });

  it("maps modes to arena themes both ways", () => {
    expect(modeToTheme("clash")).toBe("normal");
    expect(modeToTheme("islamic")).toBe("arabic");
    expect(themeToMode("normal")).toBe("clash");
    expect(themeToMode("arabic")).toBe("islamic");
    expect(themeToMode(null)).toBe("islamic"); // default
  });

  it("recognises only the two real modes", () => {
    expect(isGameMode("clash")).toBe(true);
    expect(isGameMode("islamic")).toBe(true);
    expect(isGameMode("unity")).toBe(false);
    expect(isGameMode(null)).toBe(false);
  });

  it("toggles between the two modes", () => {
    expect(otherMode("clash")).toBe("islamic");
    expect(otherMode("islamic")).toBe("clash");
  });
});
