/**
 * Shared Arabic / Islamic art direction palette — Moorish & Persian tilework
 * jewel tones plus gold for trims and crescent finials. One source of truth so
 * the arena, towers, characters, and UI all read as one world.
 */
export const THEME = {
  turquoise: 0x1aa3a0,
  teal: 0x0e7c84,
  deepBlue: 0x163a8a,
  gold: 0xcaa23f,
  goldLight: 0xe8c45f,
  terracotta: 0xb85c38,
  cream: 0xece0c0,
  sand: 0xcdb079,
  stone: 0xc9b894,
  emerald: 0x1f7a52,
  sky: 0xa9d6e0,
} as const;

/** Hex int → CSS "#rrggbb" string (for canvas drawing). */
export function hexStr(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

/**
 * Apply edition-aware CSS custom-property overrides on the document root.
 * Must be called once before any UI is rendered so CSS selectors like
 * :root[data-edition="arabic"] take effect. Pass "unset" for a neutral lobby.
 */
export function applyEditionTokens(theme: StoredEdition): void {
  try {
    document.documentElement.dataset.edition =
      theme === "arabic" ? "arabic" : theme === "normal" ? "clash" : "unset";
  } catch {
    // node / test environment — silently skip
  }
}

/**
 * Primary accent colour for the current edition as a CSS hex string.
 * Use this when JavaScript code (canvas, Three.js) needs to match the
 * UI palette without hard-coding both editions in multiple places.
 */
export function accentCss(): string {
  return ARABIC ? hexStr(THEME.turquoise) : "#F6C14E"; // teal : crown gold
}

/**
 * Which arena look is active. Read once at load (persisted); the toggle in
 * main.ts re-saves it and reloads. Lives here (not in scene3d) so both the
 * renderer and the character rigs can read it without a circular import.
 * Guarded so node tests (no localStorage) fall back safely.
 */
export type ArenaTheme = "normal" | "arabic";
/** Persisted choice — "unset" until the player picks an edition in the lobby. */
export type StoredEdition = ArenaTheme | "unset";
export const ARENA_THEME_KEY = "cr-clone-arena-theme";

function readStoredEdition(): StoredEdition {
  try {
    const v = localStorage.getItem(ARENA_THEME_KEY);
    if (v === "normal" || v === "arabic") return v;
    // First visit / cleared storage: no edition bias.
    return "unset";
  } catch {
    // Node/test: no localStorage — default arabic so Islamic character
    // tests (which rely on ARABIC=true) keep working without a mock.
    return "arabic";
  }
}

export const STORED_EDITION: StoredEdition = readStoredEdition();
/** True once the player has picked Clash or Islamic. */
export const EDITION_CHOSEN = STORED_EDITION !== "unset";
/**
 * Resolved arena theme for 3D bootstrap. When unset, use Clash art so the
 * scene can construct; battle stays gated until the player picks an edition.
 */
export const ARENA_THEME: ArenaTheme = STORED_EDITION === "arabic" ? "arabic" : "normal";
export const ARABIC = ARENA_THEME === "arabic";
