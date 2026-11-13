/**
 * Keep-the-save-safe wiring (meta/keepSafe.ts), on the app's hooks:
 *
 * - After a win (any real match: not a replay, not Sandbox), ask the
 *   browser once to keep this site's storage, and on an iPhone or iPad in
 *   a browser tab queue the one-time 'Add to Home Screen' tip.
 * - The next time Home shows, the tip opens (a small sheet: the Home
 *   Screen game starts empty, so it offers to copy the save code first).
 *   In the Home Screen game itself, the first Home with no trophies yet
 *   (often the edition gate) opens the one-time 'Played in Safari
 *   before?' hint, with a button straight to Load a save. Both wait until
 *   no other sheet, dialog or chest reveal is up, and a Home left first
 *   tries again next time.
 * - After a save was loaded or undone (Settings > Backup & move reloads
 *   the page), Home says so.
 * - When another open tab of the game loads a save or undoes one, this tab
 *   reloads too, before it can write its old profile back over the new one.
 *
 * A side-effect module: main.ts imports it with the other feature wiring.
 */
import { on } from "../app/hooks";
import { clearMatchMarker } from "../match/leftMatch";
import {
  askToKeepSaveOnce,
  deviceInfo,
  markHomeTipSeen,
  markStandaloneHintSeen,
  shouldShowHomeTip,
  shouldShowStandaloneHint,
  type PersistApi,
} from "../meta/keepSafe";
import { defaultKV, type KV } from "../meta/kv";
import { SAVE_BACKUP_KEY, gatherSave, summarize, type SaveStore } from "../meta/saveCode";
import { EDITION_CHOSEN } from "../render3d/theme";
import { toast } from "./components";
import { tr } from "./i18n";
import { holdSplashForReload } from "./screens/editionGate";
import { openHomeScreenTip, openStandaloneHint } from "./screens/keepSafeSheet";
import { SAVE_LOADED_KEY } from "./screens/saveSheet";

/** After another tab's load starts, wait this long so all of its writes have arrived. */
export const OTHER_TAB_RELOAD_MS = 250;
/** While another sheet, dialog or the chest reveal is up, look again this often. */
export const CLEAR_POLL_MS = 700;
/** What owns the screen: a sheet, a dialog, the chest reveal. A keep-safe sheet waits for them. */
const BUSY = ".ui-sheet, .ui-modal, .rw-reveal";

let tipDue = false;
/** A keep-safe sheet is waiting to open (one at a time). */
let sheetPending = false;
/** The screen showing now ('home' covers the edition gate too). */
let screenNow = "";
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

/** Tests only: forget a queued tip and a waiting sheet. */
export function resetKeepSafeForTests(): void {
  tipDue = false;
  sheetPending = false;
  screenNow = "";
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

function localStore(): SaveStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** No progress on this device yet (no trophies), read without writing anything. */
function freshProfile(): boolean {
  const store = localStore();
  if (!store) return false;
  try {
    return summarize(gatherSave(store)).trophies === 0;
  } catch {
    return false;
  }
}

/**
 * Open a keep-safe sheet on Home once nothing else owns the screen. Gives
 * up when Home is left first (`leftHome`, so it can try again next time).
 */
function openWhenClear(open: () => void, leftHome: () => void): void {
  const look = (): void => {
    if (screenNow !== "home") {
      sheetPending = false;
      leftHome();
      return;
    }
    let busy = false;
    try {
      busy = document.querySelector(BUSY) !== null;
    } catch {
      busy = false;
    }
    if (busy) {
      window.setTimeout(look, CLEAR_POLL_MS);
      return;
    }
    sheetPending = false;
    open();
  };
  look();
}

on("screen", ({ id }) => {
  screenNow = id;
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
  if (sheetPending) return;
  if (tipDue) {
    sheetPending = true;
    soonAfterAFrame(
      () =>
        openWhenClear(
          () => {
            tipDue = false;
            markHomeTipSeen(defaultKV());
            openHomeScreenTip();
          },
          () => undefined, // still due: the next Home tries again
        ),
      900,
    );
    return;
  }
  const kv = defaultKV();
  if (shouldShowStandaloneHint(kv, deviceInfo(), freshProfile())) {
    sheetPending = true;
    soonAfterAFrame(
      () =>
        openWhenClear(
          () => {
            markStandaloneHintSeen(kv);
            openStandaloneHint({}, { both: !EDITION_CHOSEN });
          },
          () => undefined,
        ),
      900,
    );
  }
});
