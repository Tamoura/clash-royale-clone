/**
 * The game's own name, Banner Lanes, and the runtime touches to the static
 * boot markup in index.html.
 *
 * index.html (the tab title, the home-screen label, the boot splash) and
 * public/manifest.webmanifest can only hold one language, so they say
 * "Banner Lanes". At boot the Golden Age edition renames the tab, the splash
 * and the one label index.html carries into Arabic. Internal ids are not
 * names and stay as they were (cr-clone-* storage keys, data-edition, the
 * save-code head "CR" and its game tag "crown-rush", the repo, the Render
 * service and its address), so no save is lost.
 * src/app/brand.test.ts keeps index.html, the manifest and this file in step.
 */
import { tr } from "../ui/i18n";

/** The name everywhere English is shown. */
export const GAME_NAME = "Banner Lanes";
/** The name in the Golden Age edition: Darb ar-Rayat, "the path of banners". */
export const GAME_NAME_AR = "درب الرايات";

/**
 * The studio named in the credits. The Arabic is in Arabic words, since a
 * Latin name would break the right-to-left line. It is not spelled out
 * letter for letter: "بيبل" is how Arabic writes "Bible", so "ألعاب بيبل
 * كايت" could read as "Bible Kite Games". Only "Kite" is translated (a
 * paper kite, which every child knows), because "pebble" in Arabic (حصاة)
 * is already the Golden Age name of the Pebble Golem card.
 */
export const STUDIO_NAME = "Pebble Kite Games";
export const STUDIO_NAME_AR = "ألعاب الطائرة الورقية";

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
