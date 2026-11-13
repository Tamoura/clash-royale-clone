/**
 * Keep-the-save-safe wiring (meta/keepSafe.ts), on the app's hooks:
 *
 * - After a win (any real match: not a replay, not Sandbox), ask the
 *   browser once to keep this site's storage, and on an iPhone or iPad in
 *   a browser tab queue the one-time 'Add to Home Screen' tip.
 * - The next time Home shows, the tip appears; and after a save was loaded
 *   or undone (Settings > Backup & move reloads the page), Home says so.
 *
 * A side-effect module: main.ts imports it with the other feature wiring.
 */
import { on } from "../app/hooks";
import { GAME_NAME, GAME_NAME_AR } from "../app/brand";
import { askToKeepSaveOnce, deviceInfo, markHomeTipSeen, shouldShowHomeTip, type PersistApi } from "../meta/keepSafe";
import { defaultKV } from "../meta/kv";
import { toast } from "./components";
import { tr } from "./i18n";
import { SAVE_LOADED_KEY } from "./screens/saveSheet";

/** How long the Home Screen tip stays up (it is long for a toast, and shown once). */
const TIP_MS = 8000;

let tipDue = false;

function persistApi(): PersistApi | undefined {
  try {
    return navigator.storage;
  } catch {
    return undefined;
  }
}

/** Read and clear a session flag. */
function takeSessionFlag(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    if (v !== null) sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

on("matchEnd", (m) => {
  if (m.replay || m.sandbox || m.winner !== m.mySide) return;
  const kv = defaultKV();
  void askToKeepSaveOnce(kv, persistApi());
  if (shouldShowHomeTip(kv, deviceInfo())) tipDue = true;
});

on("screen", ({ id }) => {
  if (id !== "home") return;
  const loaded = takeSessionFlag(SAVE_LOADED_KEY);
  if (loaded) {
    toast(
      loaded === "undo"
        ? tr("Everything is back to how it was before the load.", "عاد كل شيء كما كان قبل التحميل.")
        : tr("Save loaded! Welcome back.", "تم تحميل الحفظ! أهلًا بعودتك."),
      "success",
      4000,
    );
  }
  if (tipDue) {
    tipDue = false;
    markHomeTipSeen(defaultKV());
    window.setTimeout(
      () =>
        toast(
          tr(
            `Add ${GAME_NAME} to your Home Screen so your progress stays safe.`,
            `أضف ${GAME_NAME_AR} إلى الشاشة الرئيسية ليبقى تقدّمك في أمان.`,
          ),
          "accent",
          TIP_MS,
        ),
      900,
    );
  }
});
