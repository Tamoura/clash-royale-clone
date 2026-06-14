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
