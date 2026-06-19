/**
 * Display names per game mode. The sim keeps its canonical English card names
 * (cards.ts); this layer swaps in Islamic-history names when the Arabic theme /
 * Islamic mode is active. Re-skin only — ids, stats, and balance are untouched.
 * See notes/features/islamic-rebrand.md for the historical basis of each name.
 */
import { getCard, type CardId } from "../game/cards";
import { ARABIC } from "../render3d/theme";

const ISLAMIC_NAME: Record<CardId, string> = {
  knight: "Faris",
  archers: "Rumat",
  firecracker: "Naffat",
  "magic-archer": "Master Bowman",
  giant: "War Elephant",
  musketeer: "Janissary",
  "mini-pekka": "Duelist",
  skeletons: "Militia",
  wizard: "Alchemist",
  witch: "War Drummer",
  "hog-rider": "Camel Raider",
  balloon: "Fire-Kite",
  "baby-dragon": "Roc Hatchling",
  gargoyles: "War Falcons",
  bats: "Bats",
  minions: "Falcon Flock",
  "skeleton-army": "Militia Horde",
  executioner: "Axeman",
  "electro-wizard": "Flash Naffat",
  "ice-wizard": "Caltrop Sapper",
  princess: "Khawla",
  "mega-knight": "Mamluk Amir",
  "royal-giant": "Bombardier",
  valkyrie: "Swordswoman",
  prince: "Lancer",
  pekka: "Cataphract",
  cannon: "Mangonel",
  tombstone: "Ribat",
  "elixir-collector": "Caravanserai",
  fireball: "Naphtha Bomb",
  arrows: "Arrow Volley",
  zap: "Flash Powder",
  rage: "War Drums",
  freeze: "Caltrops",
};

/** The card's name for the active mode (Islamic name in Arabic theme). */
export function cardDisplayName(id: CardId): string {
  return ARABIC ? (ISLAMIC_NAME[id] ?? getCard(id).name) : getCard(id).name;
}
