/**
 * The game's own name, Crown Rush, and the runtime touches to the static
 * boot markup in index.html.
 *
 * index.html (the tab title, the home-screen label, the boot splash) and
 * public/manifest.webmanifest can only hold one language, so they say
 * "Crown Rush". At boot the Golden Age edition renames the tab, the splash
 * and the one label index.html carries into Arabic. Internal ids are not
 * names and stay as they were (cr-clone-* storage keys, data-edition, the
 * repo, the Render service and its address), so no save is lost.
 * src/app/brand.test.ts keeps index.html, the manifest and this file in step.
 */
import { tr } from "../ui/i18n";

/** The name everywhere English is shown. */
export const GAME_NAME = "Crown Rush";
/** The name in the Golden Age edition: "the crown's charge". */
export const GAME_NAME_AR = "هجمة التاج";

/** The game's name in the current edition. */
export function gameName(): string {
  return tr(GAME_NAME, GAME_NAME_AR);
}

/**
 * Put the edition's language on the boot markup index.html could only write
 * in English: the tab title, the splash title, and the emote bar's label.
 * Safe to call before the page has finished loading.
 */
export function localizeStaticMarkup(doc: Document): void {
  doc.title = gameName();
  const boot = doc.querySelector("#boot .boot-title");
  if (boot) boot.textContent = gameName();
  doc.getElementById("emotes")?.setAttribute("aria-label", tr("Emotes", "التعابير"));
}
