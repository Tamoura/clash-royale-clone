/**
 * Display names per game mode. The sim keeps its canonical English card names
 * (cards.ts); this layer swaps in Islamic-history names when the Arabic theme /
 * Islamic mode is active. Re-skin only — ids, stats, and balance are untouched.
 * See notes/features/islamic-rebrand.md for the historical basis of each name.
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
  skeletons: "ميليشيا",
  wizard: "خيميائي",
  witch: "قارعة الطبول",
  "hog-rider": "راكب الجمل",
  balloon: "طائرة نارية",
  "baby-dragon": "فرخ الرخ",
  gargoyles: "صقور الحرب",
  bats: "خفافيش",
  minions: "سرب الصقور",
  "skeleton-army": "حشد الميليشيا",
  executioner: "الجلّاد",
  "electro-wizard": "نفّاط البرق",
  "ice-wizard": "زارع الحسك",
  princess: "خولة",
  "mega-knight": "أمير المماليك",
  "royal-giant": "مدفعي",
  valkyrie: "سيّافة",
  prince: "رمّاح",
  pekka: "مدرّع",
  cannon: "منجنيق",
  tombstone: "رباط",
  "elixir-collector": "خان القوافل",
  fireball: "قذيفة نفط",
  arrows: "وابل السهام",
  zap: "مسحوق الوميض",
  rage: "طبول الحرب",
  freeze: "حسك",
  heal: "شفاء",
  tornado: "زوبعة",
  "skeleton-barrel": "برميل الميليشيا",
  champion: "بطل",
};

/** The card's name for the active mode (Islamic name in Arabic theme). */
export function cardDisplayName(id: CardId): string {
  // The Studio champion always shows the name the player gave it.
  if (id === "champion") return getCard(id).name;
  return ARABIC ? (ISLAMIC_NAME[id] ?? getCard(id).name) : getCard(id).name;
}
