/**
 * Which build of the game the intro launches: the original in-browser
 * TypeScript + Three.js version ("native"), or the Unity WebGL build
 * ("unity"). The choice is persisted and toggled from the deck-picker.
 */
export type GameMode = "native" | "unity";

export const MODE_KEY = "cr-clone-mode";
export const DEFAULT_MODE: GameMode = "native";

/** Minimal localStorage-compatible surface, injected so this stays testable. */
export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isGameMode(value: unknown): value is GameMode {
  return value === "native" || value === "unity";
}

export function loadMode(storage: ModeStorage): GameMode {
  const saved = storage.getItem(MODE_KEY);
  return isGameMode(saved) ? saved : DEFAULT_MODE;
}

export function saveMode(storage: ModeStorage, mode: GameMode): void {
  storage.setItem(MODE_KEY, mode);
}

export function otherMode(mode: GameMode): GameMode {
  return mode === "native" ? "unity" : "native";
}

/**
 * Path to the Unity WebGL build's loader page. The build is dropped into
 * `public/unity/` so Vite serves it alongside the native app at `/unity/`.
 */
export const UNITY_BUILD_URL = "unity/index.html";

export function unityBuildUrl(base = ""): string {
  return `${base}${UNITY_BUILD_URL}`;
}

/**
 * Probe whether the Unity build has actually been dropped in. Any non-OK
 * response or fetch error means "not built yet" rather than a thrown
 * rejection, so callers can show a friendly placeholder.
 */
export async function checkUnityBuild(
  fetchFn: (url: string) => Promise<{ ok: boolean }>,
  base = "",
): Promise<boolean> {
  try {
    const res = await fetchFn(unityBuildUrl(base));
    return res.ok;
  } catch {
    return false;
  }
}
