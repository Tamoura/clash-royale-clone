/**
 * Keep-the-save-safe wiring (meta/keepSafe.ts), on the app's hooks:
 *
 * - After a win (any real match: not a replay, not Sandbox), ask the
 *   browser once to keep this site's storage, and on an iPhone or iPad in
 *   a browser tab queue the one-time 'Add to Home Screen' tip.
 * - The next time Home shows, the tip appears; and after a save was loaded
 *   or undone (Settings > Backup & move reloads the page), Home says so.
 * - When another open tab of the game loads a save or undoes one, this tab
 *   reloads too, before it can write its old profile back over the new one.
 *
 * A side-effect module: main.ts imports it with the other feature wiring.
 */
import { on } from "../app/hooks";
import { GAME_NAME, GAME_NAME_AR } from "../app/brand";
import { clearMatchMarker } from "../match/leftMatch";
import { askToKeepSaveOnce, deviceInfo, markHomeTipSeen, shouldShowHomeTip, type PersistApi } from "../meta/keepSafe";
import { defaultKV, type KV } from "../meta/kv";
import { SAVE_BACKUP_KEY } from "../meta/saveCode";
import { toast } from "./components";
import { tr } from "./i18n";
import { holdSplashForReload } from "./screens/editionGate";
import { SAVE_LOADED_KEY } from "./screens/saveSheet";

/** How long the Home Screen tip stays up (it is long for a toast, and shown once). */
const TIP_MS = 8000;
/** After another tab's load starts, wait this long so all of its writes have arrived. */
export const OTHER_TAB_RELOAD_MS = 250;

let tipDue = false;
/** A match is being played in this tab (set on matchStart, cleared on matchEnd). */
let inMatch = false;

export interface OtherTabDeps {
  kv: KV | null;
  reload: () => void;
  inMatch: boolean;
}

let otherTabReloading = false;

/**
 * Another tab changed the backup slot ('cr-clone-save-backup' is written
 * first by every load and every undo): this tab's profile in memory is now
 * stale, and it would write it back over the new one when it next settles a
 * match. So reload, a moment later (the rest of that tab's writes land
 * first). A match being played here belonged to the old profile: its
 * left-match marker is dropped, so the reload does not count it as a loss
 * for the new one. Returns true when a reload was scheduled.
 */
export function onOtherTabStorage(
  e: { key: string | null; oldValue: string | null; newValue: string | null },
  deps: OtherTabDeps,
): boolean {
  if (e.key !== SAVE_BACKUP_KEY || e.oldValue === e.newValue || otherTabReloading) return false;
  otherTabReloading = true;
  if (deps.inMatch) clearMatchMarker(deps.kv);
  window.setTimeout(deps.reload, OTHER_TAB_RELOAD_MS);
  return true;
}

/** Tests only: forget a scheduled reload. */
export function resetOtherTabForTests(): void {
  otherTabReloading = false;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (e) =>
    onOtherTabStorage(e, {
      kv: defaultKV(),
      inMatch,
      reload: () => {
        holdSplashForReload();
        location.reload();
      },
    }),
  );
}

on("matchStart", () => {
  inMatch = true;
});

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
  inMatch = false;
  if (m.replay || m.sandbox || m.winner !== m.mySide) return;
  const kv = defaultKV();
  void askToKeepSaveOnce(kv, persistApi());
  if (shouldShowHomeTip(kv, deviceInfo())) tipDue = true;
});

/**
 * Run `fn` a moment after the next drawn frame: after a reload Home is built
 * under the boot splash, which lifts on the first frame, so a toast shown at
 * once could fade out unseen.
 */
function soonAfterAFrame(fn: () => void, ms: number): void {
  const off = on("frame", () => {
    off();
    window.setTimeout(fn, ms);
  });
}

on("screen", ({ id }) => {
  if (id !== "home") return;
  const loaded = takeSessionFlag(SAVE_LOADED_KEY);
  if (loaded) {
    soonAfterAFrame(
      () =>
        toast(
          loaded === "undo"
            ? tr("Everything is back to how it was before the load.", "عاد كل شيء كما كان قبل التحميل.")
            : loaded === "redo"
              ? tr("Everything is back to how it was before the undo.", "عاد كل شيء كما كان قبل التراجع.")
              : tr("Save loaded! Welcome back.", "تم تحميل الحفظ! أهلًا بعودتك."),
          "success",
          4000,
        ),
      600,
    );
  }
  if (tipDue) {
    tipDue = false;
    markHomeTipSeen(defaultKV());
    soonAfterAFrame(
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
