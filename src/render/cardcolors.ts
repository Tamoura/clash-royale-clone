import type { CardId } from "../game/cards";

/**
 * Signature background color per card, so every card in the hand
 * reads at a glance. Loosely matched to each character's palette.
 */
export const CARD_COLOR: Record<CardId, string> = {
  knight: "#5b6c80",
  archers: "#2e7d32",
  giant: "#b07238",
  musketeer: "#36459c",
  "mini-pekka": "#27364e",
  skeletons: "#8d8676",
  wizard: "#7c3aed",
  witch: "#4a1d6e",
  "hog-rider": "#7a4a23",
  balloon: "#a32424",
  "baby-dragon": "#3f9344",
  gargoyles: "#5a5f73",
  valkyrie: "#8c2e2e",
  prince: "#bd9136",
  pekka: "#1d2440",
  cannon: "#56432e",
  tombstone: "#506057",
  "elixir-collector": "#8d2bab",
  fireball: "#d96716",
  arrows: "#9c7d52",
  zap: "#c9a40e",
  rage: "#c2257f",
  freeze: "#2398c9",
};
