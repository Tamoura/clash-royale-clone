/**
 * Which build of the game the intro launches: the original in-browser
 * TypeScript + Three.js version ("native"), or the Unity WebGL build
 * ("unity"). Named "edition" to avoid colliding with the native game-mode
 * system (Classic / Triple Elixir / Mirror, etc.).
 */
export type Edition = "native" | "unity";

export const EDITION_KEY = "cr-clone-edition";
export const DEFAULT_EDITION: Edition = "native";

/** Minimal localStorage-compatible surface, injected so this stays testable. */
export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isEdition(value: unknown): value is Edition {
  return value === "native" || value === "unity";
}

export function loadEdition(storage: ModeStorage): Edition {
  const saved = storage.getItem(EDITION_KEY);
  return isEdition(saved) ? saved : DEFAULT_EDITION;
}

export function saveEdition(storage: ModeStorage, edition: Edition): void {
  storage.setItem(EDITION_KEY, edition);
}

export function otherEdition(edition: Edition): Edition {
  return edition === "native" ? "unity" : "native";
}

/**
 * Path to the Unity WebGL build's loader page. The build is dropped into
 * `public/unity/` so Vite serves it alongside the native app at `/unity/`.
 */
export const UNITY_BUILD_URL = "unity/index.html";

export function unityBuildUrl(base = "", deck?: readonly string[]): string {
  const query = deck && deck.length > 0 ? `?deck=${deck.join(",")}` : "";
  return `${base}${UNITY_BUILD_URL}${query}`;
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
