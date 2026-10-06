/** In-match rulesets (Classic, Triple, Mega, Mirror, Crazy, Sandbox). */
import { SANDBOX_ELIXIR_RATE } from "../game/sim";

export interface GameMode {
  id: string;
  name: string;
  nameAr: string;
  blurb: string;
  blurbAr: string;
  /** Flat elixir rate (1 normal, 3 triple, 7 mega). */
  elixirRate: number;
  /** Both players battle with the same random deck. */
  mirror: boolean;
}

export const GAME_MODES: GameMode[] = [
  { id: "classic", name: "Classic", nameAr: "كلاسيكي", blurb: "Your deck, normal elixir", blurbAr: "مجموعتك، وإكسير عادي", elixirRate: 1, mirror: false },
  { id: "triple", name: "Triple Elixir ⚡3", nameAr: "إكسير ثلاثي ⚡3", blurb: "3× elixir the whole match", blurbAr: "إكسير مضاعف ٣ مرات طوال المباراة", elixirRate: 3, mirror: false },
  { id: "mega", name: "Mega Elixir ⚡7", nameAr: "إكسير هائل ⚡7", blurb: "7× elixir — total chaos", blurbAr: "إكسير مضاعف ٧ مرات — فوضى كاملة", elixirRate: 7, mirror: false },
  { id: "mirror", name: "Mirror Match", nameAr: "مباراة المرآة", blurb: "Both get the same random deck", blurbAr: "كلاكما بنفس المجموعة العشوائية", elixirRate: 1, mirror: true },
  { id: "crazy", name: "Crazy 🎲", nameAr: "جنون 🎲", blurb: "Every card scrambled — counts, spawns & stats go wild", blurbAr: "كل البطاقات مخلوطة — الأعداد والقدرات تجنّ", elixirRate: 1, mirror: false },
  { id: "sandbox", name: "Sandbox 🛠️", nameAr: "ساحة التجربة 🛠️", blurb: "Practice: infinite elixir, sleeping bot, reset anytime — no rewards", blurbAr: "تدريب: إكسير لا ينفد، روبوت نائم، إعادة في أي وقت — بلا جوائز", elixirRate: SANDBOX_ELIXIR_RATE, mirror: false },
];

export const MODE_KEY = "cr-clone-mode";

export function loadMode(): GameMode {
  const id = localStorage.getItem(MODE_KEY);
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
}
