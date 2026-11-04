/**
 * One kid-sized line per card, plus who it is good against and who to watch
 * out for. The battle's long-press bubble, the desktop hover tip and the
 * card info sheet all read from here.
 *
 * `en` names the Classic edition's cards; `ar` is written for the Golden Age
 * edition and uses its names (see cardNames.ts), so each text matches the
 * card art the player sees. `good` / `watch` are shown as mini portraits.
 *
 * Partial on purpose: new card ids can arrive before their line does, and
 * every reader treats a missing entry as "no blurb".
 */
import type { CardId } from "../game/cards";
import { tr } from "../ui/i18n";

export interface CardBlurb {
  en: string;
  ar: string;
  /** Cards this one is strong against. */
  good: CardId[];
  /** Cards that beat this one. */
  watch: CardId[];
}

export const CARD_BLURBS: Partial<Record<CardId, CardBlurb>> = {
  knight: {
    en: "A brave sword fighter with lots of HP. Put him in front of your shooters!",
    ar: "فارس شجاع يتحمل ضربات كثيرة. ضعه أمام رماتك ليحميهم!",
    good: ["archers", "skeletons"],
    watch: ["skeleton-army", "minions"],
  },
  archers: {
    en: "Two sharpshooters. Great vs Baby Dragon!",
    ar: "راميان ماهران. رائعان ضد فرخ الرخ!",
    good: ["baby-dragon", "minions"],
    watch: ["arrows", "valkyrie"],
  },
  firecracker: {
    en: "Her firework bursts into sparks that hit a whole group!",
    ar: "نفّاطة ترمي نارًا تتفرّق شررًا وتصيب مجموعة كاملة!",
    good: ["minions", "skeleton-army"],
    watch: ["knight", "arrows"],
  },
  "magic-archer": {
    en: "His magic arrow flies through everything in a line!",
    ar: "رامٍ بارع يخترق سهمه كل من يقف في صفّ واحد!",
    good: ["archers", "skeleton-army"],
    watch: ["knight", "fireball"],
  },
  giant: {
    en: "A huge tank that only hits towers. Put shooters behind him!",
    ar: "فيل حرب ضخم لا يهاجم إلا الأبراج. ضع الرماة خلفه!",
    good: ["fireball", "arrows"],
    watch: ["mini-pekka", "pekka"],
  },
  musketeer: {
    en: "Shoots from far away. Knocks flyers out of the sky!",
    ar: "إنكشاري يرمي من بعيد ويُسقط الطائرين من السماء!",
    good: ["balloon", "baby-dragon"],
    watch: ["fireball", "mini-pekka"],
  },
  "mini-pekka": {
    en: "Small but hits SUPER hard. Chops big tanks fast!",
    ar: "مبارز صغير لكن ضربته قوية جدًا. يهزم الضخام بسرعة!",
    good: ["giant", "hog-rider"],
    watch: ["skeletons", "minions"],
  },
  skeletons: {
    en: "Three tiny fighters for just 1 elixir. They distract big hitters!",
    ar: "ثلاثة من الميليشيا بإكسير واحد فقط. يشغلون الأقوياء عن أبراجك!",
    good: ["mini-pekka", "pekka"],
    watch: ["zap", "arrows"],
  },
  fireball: {
    en: "A fiery blast that knocks out groups and hurts towers too.",
    ar: "قذيفة نفط تحرق المجموعات وتصيب الأبراج أيضًا.",
    good: ["musketeer", "witch"],
    watch: ["giant", "pekka"],
  },
  arrows: {
    en: "A rain of arrows. Clears swarms, even flying ones!",
    ar: "وابل من السهام يمسح الحشود، حتى الطائرة منها!",
    good: ["minions", "skeleton-army"],
    watch: ["knight", "giant"],
  },
  zap: {
    en: "A quick zap that stuns everyone and wipes out tiny troops.",
    ar: "مسحوق الوميض يوقف الأعداء لحظة ويقضي على الصغار.",
    good: ["skeletons", "bats"],
    watch: ["giant", "knight"],
  },
  rage: {
    en: "Makes your troops in the circle faster and fiercer!",
    ar: "طبول الحرب تجعل جنودك في الدائرة أسرع وأشد!",
    good: [],
    watch: [],
  },
  freeze: {
    en: "Freezes every enemy in the circle for 4 seconds. Brrr!",
    ar: "الحسك يوقف كل الأعداء في الدائرة ٤ ثوانٍ!",
    good: ["hog-rider", "balloon"],
    watch: [],
  },
  wizard: {
    en: "Throws fireballs that hit whole groups, flyers too.",
    ar: "خيميائي يقذف كرات نار تصيب المجموعات والطائرين.",
    good: ["skeleton-army", "minions"],
    watch: ["fireball", "mini-pekka"],
  },
  witch: {
    en: "Keeps calling skeleton buddies to fight with her!",
    ar: "قارعة الطبول تنادي رجال الميليشيا ليقاتلوا معها!",
    good: ["mini-pekka", "prince"],
    watch: ["fireball", "valkyrie"],
  },
  "hog-rider": {
    en: "A speedy rider who races straight for the towers!",
    ar: "راكب جمل سريع ينطلق مباشرة نحو الأبراج!",
    good: ["archers", "princess"],
    watch: ["cannon", "mini-pekka"],
  },
  balloon: {
    en: "Floats to a tower and drops big bombs. Shoot it down early!",
    ar: "طائرة نارية تحلّق إلى البرج وتلقي قنابل كبيرة. أسقطها مبكرًا!",
    good: ["knight", "pekka"],
    watch: ["musketeer", "minions"],
  },
  "baby-dragon": {
    en: "A flying baby dragon that breathes fire on groups.",
    ar: "فرخ الرخ يطير ويضرب مجموعات الأعداء دفعة واحدة.",
    good: ["skeleton-army", "knight"],
    watch: ["archers", "musketeer"],
  },
  gargoyles: {
    en: "Three stone flyers that swoop down on troops.",
    ar: "ثلاثة صقور حرب تنقضّ على الأعداء من السماء.",
    good: ["knight", "giant"],
    watch: ["arrows", "wizard"],
  },
  bats: {
    en: "Five tiny, speedy bats. Ground troops can't reach them!",
    ar: "خمسة خفافيش صغيرة وسريعة لا تطالها جنود الأرض!",
    good: ["pekka", "mini-pekka"],
    watch: ["zap", "arrows"],
  },
  minions: {
    en: "Three flying fighters. Troops that only hit the ground can't touch them!",
    ar: "سرب من ثلاثة صقور. جنود الأرض لا يستطيعون ضربها!",
    good: ["knight", "giant"],
    watch: ["arrows", "archers"],
  },
  "skeleton-army": {
    en: "A whole army of skeletons! Swarm the big guys.",
    ar: "حشد كبير من الميليشيا! حاصروا الأقوياء.",
    good: ["pekka", "prince"],
    watch: ["valkyrie", "arrows"],
  },
  executioner: {
    en: "Throws a big axe that cuts through a whole line of enemies!",
    ar: "الجلّاد يرمي فأسًا كبيرة تخترق صفًّا كاملًا من الأعداء!",
    good: ["minions", "skeleton-army"],
    watch: ["mini-pekka", "pekka"],
  },
  "electro-wizard": {
    en: "Zaps two enemies at once and stuns them!",
    ar: "نفّاط البرق يصعق عدوّين معًا ويوقفهما لحظة!",
    good: ["prince", "hog-rider"],
    watch: ["fireball", "knight"],
  },
  "ice-wizard": {
    en: "His icy blasts slow enemies down.",
    ar: "زارع الحسك يُبطئ الأعداء بضرباته.",
    good: ["hog-rider", "prince"],
    watch: ["fireball", "mini-pekka"],
  },
  princess: {
    en: "Shoots flaming arrows from super far away!",
    ar: "خولة ترمي سهامًا مشتعلة من مسافة بعيدة جدًا!",
    good: ["minions", "skeleton-army"],
    watch: ["arrows", "zap"],
  },
  "mega-knight": {
    en: "Leaps in with a huge SMASH that squashes groups!",
    ar: "أمير المماليك يقفز بضربة هائلة تسحق المجموعات!",
    good: ["skeleton-army", "witch"],
    watch: ["minions", "pekka"],
  },
  "royal-giant": {
    en: "A giant with a cannon. Shoots towers from far away!",
    ar: "مدفعي ضخم يقصف الأبراج من بعيد!",
    good: ["cannon", "princess"],
    watch: ["mini-pekka", "pekka"],
  },
  valkyrie: {
    en: "Spins her axe and hits everyone around her!",
    ar: "سيّافة تدور بسيفها وتضرب كل من حولها!",
    good: ["skeleton-army", "witch"],
    watch: ["minions", "mini-pekka"],
  },
  prince: {
    en: "Charges in with his lance for DOUBLE damage!",
    ar: "رمّاح يندفع برمحه ليضرب ضربة مضاعفة!",
    good: ["knight", "giant"],
    watch: ["skeletons", "skeleton-army"],
  },
  pekka: {
    en: "A big armored warrior. Takes down tanks in a few hits!",
    ar: "مدرّع ضخم يهزم الأقوياء ببضع ضربات!",
    good: ["giant", "royal-giant"],
    watch: ["skeleton-army", "minions"],
  },
  cannon: {
    en: "A cheap cannon that pulls tanks away from your towers.",
    ar: "منجنيق رخيص يجذب الضخام بعيدًا عن أبراجك.",
    good: ["hog-rider", "giant"],
    watch: ["royal-giant", "fireball"],
  },
  tombstone: {
    en: "A spooky grave that keeps sending out skeletons!",
    ar: "رباط يخرج منه رجال الميليشيا مرة بعد مرة!",
    good: ["hog-rider", "prince"],
    watch: ["valkyrie", "arrows"],
  },
  "elixir-collector": {
    en: "Makes extra elixir for you over time. Keep it safe!",
    ar: "خان القوافل يجمع لك إكسيرًا إضافيًا مع الوقت. احمِه!",
    good: [],
    watch: ["fireball", "hog-rider"],
  },
  heal: {
    en: "Heals your troops in the circle so your push keeps going!",
    ar: "يشفي جنودك في الدائرة ليواصلوا الهجوم!",
    good: [],
    watch: [],
  },
  tornado: {
    en: "A whirlwind that pulls enemies together. Then splash them!",
    ar: "زوبعة تجمع الأعداء في مكان واحد. ثم اضربهم معًا!",
    good: ["skeleton-army", "hog-rider"],
    watch: [],
  },
  "skeleton-barrel": {
    en: "A barrel that bursts into skeletons right where you aim!",
    ar: "برميل ينفجر فيخرج منه رجال الميليشيا حيث تختار!",
    good: ["archers", "princess"],
    watch: ["zap", "arrows"],
  },
  mirror: {
    en: "Plays the last card you used again, for 1 more elixir!",
    ar: "المرآة تعيد آخر بطاقة لعبتها مقابل إكسير واحد إضافي!",
    good: [],
    watch: [],
  },
  // The Studio champion is the player's own design: one line fits them all.
  champion: {
    en: "Your very own hero, designed in the Champion Studio!",
    ar: "بطلك الخاص الذي صمّمته في ورشة البطل!",
    good: [],
    watch: [],
  },
};

/** The card's blurb entry, or null when it has none yet. */
export function cardBlurb(id: CardId): CardBlurb | null {
  return CARD_BLURBS[id] ?? null;
}

/** The card's one-liner in the current edition, or null when it has none. */
export function blurbText(id: CardId): string | null {
  const b = CARD_BLURBS[id];
  return b ? tr(b.en, b.ar) : null;
}
