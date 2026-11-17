/**
 * Display names per edition. The sim keeps its canonical English card names
 * (cards.ts, locked); this layer is the only place a card's name is chosen
 * for the screen. The Classic edition swaps in its own names for the cards
 * whose sim names are another game's coined words (CLASSIC_NAME); the Golden
 * Age edition shows Islamic-history names (ISLAMIC_NAME). Re-skin only: ids,
 * stats and balance are untouched, so saves, deck codes and online play keep
 * working. See notes/features/islamic-rebrand.md for the historical basis of
 * each Golden Age name.
 */
import { getCard, type CardId } from "../game/cards";
import { ARABIC } from "../render3d/theme";

/**
 * Arabic-script display names (Islamic-history flavored — same figures as
 * the old transliterations: Faris, Janissary, War Elephant…).
 */
const ISLAMIC_NAME: Record<CardId, string> = {
  knight: "فارس",
  archers: "رماة",
  firecracker: "نفّاطة",
  "magic-archer": "رامٍ بارع",
  giant: "فيل الحرب",
  musketeer: "إنكشاري",
  "mini-pekka": "مبارز",
  skeletons: "المشاة",
  wizard: "خيميائي",
  witch: "قارعة الطبول",
  "hog-rider": "راكب الجمل",
  balloon: "طائرة نارية",
  "baby-dragon": "فرخ الرخ",
  gargoyles: "صقور الحرب",
  bats: "خفافيش",
  minions: "سرب الصقور",
  "skeleton-army": "حشد المشاة",
  executioner: "حامل الفأس",
  "electro-wizard": "نفّاط البرق",
  "ice-wizard": "زارع الحسك",
  princess: "صاحبة القوس",
  "mega-knight": "أمير المماليك",
  "royal-giant": "عملاق المدفع",
  valkyrie: "سيّافة",
  prince: "رمّاح",
  pekka: "مدرّع",
  cannon: "منجنيق",
  tombstone: "المعسكر",
  "elixir-collector": "خان القوافل",
  fireball: "قذيفة نفط",
  arrows: "وابل السهام",
  zap: "مسحوق الوميض",
  rage: "حماسة",
  freeze: "حسك",
  heal: "شفاء",
  tornado: "زوبعة",
  "skeleton-barrel": "برميل المشاة",
  mirror: "مرآة",
  champion: "بطل",
  "stone-golem": "حارس الحجر",
  "pebble-golem": "حصاة",
  digger: "حفّار الرمال",
  comet: "شهاب",
};

/**
 * Classic-edition names for the cards whose sim names are another game's
 * coined words. Every other card shows its sim name (plain words: Knight,
 * Archers, Giant, Fireball...).
 */
export const CLASSIC_NAME: Partial<Record<CardId, string>> = {
  pekka: "Steel Guard",
  "mini-pekka": "Little Steel Guard",
  "hog-rider": "Boar Rider",
  "mega-knight": "Thunder Knight",
  "electro-wizard": "Lightning Wizard",
  "royal-giant": "Cannon Giant",
  "skeleton-barrel": "Bone Barrel",
  "skeleton-army": "Bone Swarm",
  minions: "Imps",
  "magic-archer": "Arrow Mage",
  "elixir-collector": "Spark Well",
  // A plain word, but grim for ages 6-12; the Golden Age name means the same.
  executioner: "Axe Bearer",
};

/** The card's name in an edition (`arabic`: the Golden Age edition). */
export function cardNameIn(id: CardId, arabic: boolean): string {
  // The Studio champion always shows the name the player gave it.
  if (id === "champion") return getCard(id).name;
  if (arabic) return ISLAMIC_NAME[id] ?? CLASSIC_NAME[id] ?? getCard(id).name;
  return CLASSIC_NAME[id] ?? getCard(id).name;
}

/** The card's name in the edition being played. */
export function cardDisplayName(id: CardId): string {
  return cardNameIn(id, ARABIC);
}
