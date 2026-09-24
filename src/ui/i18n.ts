/**
 * Edition-aware UI strings for modules outside main.ts: English in the
 * Clash edition, Arabic in the Islamic edition.
 */
import { ARABIC } from "../render3d/theme";

export const tr = (en: string, ar: string): string => (ARABIC ? ar : en);

