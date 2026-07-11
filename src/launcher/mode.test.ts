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
  it("returns null when nothing is stored (no default bias)", () => {
    expect(loadMode(fakeStorage())).toBeNull();
    expect(DEFAULT_MODE).toBeNull();
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
    expect(themeToMode(null)).toBeNull();
    expect(themeToMode("unset")).toBeNull();
  });

  it("recognises only the two real modes", () => {
    expect(isGameMode("clash")).toBe(true);
    expect(isGameMode("islamic")).toBe(true);
    expect(isGameMode("unknown")).toBe(false);
    expect(isGameMode(null)).toBe(false);
  });

  it("toggles between the two modes", () => {
    expect(otherMode("clash")).toBe("islamic");
    expect(otherMode("islamic")).toBe("clash");
  });
});
