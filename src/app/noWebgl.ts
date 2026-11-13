/**
 * What a kid sees when the browser has 3D graphics switched off (no WebGL):
 * a friendly card in the edition's language with one line for the kid and a
 * small hint for a grown-up, instead of a technical note. main.ts shows it
 * when the 3D scene cannot start, then stops the boot. The card covers the
 * whole page and takes the boot splash down (body.booted), so nothing else
 * ever hides it.
 */
import { tr } from "../ui/i18n";

/** The card's words in the current edition. */
export function noWebglWords() {
  return {
    title: tr("Oops! The 3D is switched off", "عذرًا! الرسوم المجسَّمة مُطفأة"),
    kid: tr(
      "This game needs 3D graphics, and they are switched off in this browser.",
      "تحتاج هذه اللعبة إلى رسوم مجسَّمة، وهي مُطفأة في هذا المتصفح.",
    ),
    ask: tr("Ask a grown-up to help you turn them on.", "اطلب من شخص كبير أن يساعدك في تشغيلها."),
    grownUps: tr("For grown-ups", "للكبار"),
    hint: tr(
      "Turn on hardware acceleration (“Use graphics acceleration when available”) in the browser's settings, then restart the browser. Or open the game in another browser.",
      "فعِّلوا تسريع الرسومات (تسريع الأجهزة) من إعدادات المتصفح، ثم أعيدوا تشغيله. أو افتحوا اللعبة في متصفح آخر.",
    ),
    retry: tr("Try again", "حاول مجددًا"),
    dir: tr("ltr", "rtl"),
    lang: tr("en", "ar"),
  };
}

const STYLE = `
.nogl,
.nogl * {
  box-sizing: border-box;
}
.nogl {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  overflow-y: auto;
  background: radial-gradient(circle at 50% 38%, #1d2a47 0%, #0f1829 70%);
  color: #f3f5fa;
  font-family: "Lilita One", "Baloo Bhaijaan 2", "Trebuchet MS", system-ui, sans-serif;
  text-align: center;
}
.nogl__card {
  width: min(100%, 420px);
  padding: 28px 22px 22px;
  border-radius: 24px;
  background: linear-gradient(180deg, #24355a, #172440);
  box-shadow: inset 0 0 0 3px #f6c14e, 0 14px 40px rgba(0, 0, 0, 0.45);
}
.nogl__crest {
  position: relative;
  width: 64px;
  height: 74px;
  margin: 0 auto 14px;
  background: linear-gradient(180deg, #ffd23f, #d9912b);
  clip-path: polygon(50% 0, 100% 14%, 100% 58%, 50% 100%, 0 58%, 0 14%);
}
.nogl__crest::after {
  content: "";
  position: absolute;
  inset: 7px;
  background: linear-gradient(180deg, #2a72d4, #14203a);
  clip-path: polygon(50% 0, 100% 14%, 100% 58%, 50% 100%, 0 58%, 0 14%);
}
.nogl__title {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 400;
  line-height: 1.15;
  text-shadow: 0 3px 0 #1a1030;
}
.nogl__kid {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.35;
}
.nogl__ask {
  margin: 0 0 18px;
  color: #ffd98a;
  font-size: 18px;
  line-height: 1.35;
}
.nogl__grown {
  margin: 0 0 20px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(8, 14, 28, 0.55);
  color: #c9d4ea;
  font-family: system-ui, "Segoe UI", Roboto, "Baloo Bhaijaan 2", sans-serif;
  font-size: 14px;
  line-height: 1.45;
  text-align: start;
}
.nogl__grown b {
  display: block;
  margin-bottom: 4px;
  color: #f3f5fa;
}
.nogl__retry {
  min-width: 200px;
  min-height: 56px;
  padding: 12px 28px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd23f, #e8a72e);
  color: #1a1030;
  font: inherit;
  font-size: 22px;
  box-shadow: 0 5px 0 #a8661c, 0 10px 24px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
.nogl__retry:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 #a8661c, 0 6px 16px rgba(0, 0, 0, 0.35);
}
`;

/**
 * Show the card over the whole page. `reload` is what Try again does (after
 * a grown-up switched graphics back on).
 */
export function showNoWebgl(doc: Document = document, reload: () => void = () => location.reload()): HTMLElement {
  const words = noWebglWords();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const style = el("style", "");
  style.textContent = STYLE;
  const screen = el("div", "nogl");
  screen.setAttribute("role", "alert");
  screen.setAttribute("dir", words.dir);
  screen.setAttribute("lang", words.lang);
  const card = el("div", "nogl__card");
  const crest = el("div", "nogl__crest");
  crest.setAttribute("aria-hidden", "true");
  const grown = el("p", "nogl__grown");
  grown.append(el("b", "", words.grownUps), el("span", "", words.hint));
  const retry = el("button", "nogl__retry", words.retry);
  retry.type = "button";
  retry.addEventListener("click", () => reload());
  card.append(crest, el("h1", "nogl__title", words.title), el("p", "nogl__kid", words.kid), el("p", "nogl__ask", words.ask), grown, retry);
  screen.append(style, card);
  doc.body.appendChild(screen);
  // The splash goes (its watcher ignores the throw that stops the boot next).
  doc.body.classList.add("booted");
  return screen;
}
