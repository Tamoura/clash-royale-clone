/**
 * Every browser-storage key the game uses ('cr-clone-*'), in one list, with
 * where it belongs:
 *
 * - "progress": the kid's game. It goes into a save code (meta/saveCode.ts)
 *   and moves to another tablet: trophies, gold, gems, cards, levels,
 *   shards, chests, decks, Crown Pass, Trophy Road, quests, achievements,
 *   season, champion, tutorial, battle setup choices and the edition.
 * - "device": this tablet only. It never goes into a save and a load never
 *   changes it: settings (volumes, graphics, text size, team colours),
 *   graphics memory, the relay address, the replay tape, the problem log,
 *   one-time notices about this device, session flags and the pre-load
 *   backup itself.
 *
 * Two choices, written down so nobody has to guess:
 * - The edition ('cr-clone-arena-theme') travels with the save: a kid who
 *   moves to a new tablet keeps playing the edition they know. A save made
 *   before any edition was picked leaves this tablet's edition alone.
 * - Settings ('cr-clone-settings') stay on the device, because volumes,
 *   graphics and text size suit a tablet, not a kid. The kid's name and
 *   crest live in that blob too; the save code carries those two fields on
 *   their own (saveCode.ts, "who"), so the profile card still moves.
 *
 * src/meta/saveKeys.test.ts scans every non-test .ts file in src for
 * 'cr-clone-' string literals and template prefixes: a key that is not
 * listed here fails the build, and so does a listed key nothing uses any
 * more (except the round-2 names below, which other changes add).
 */

export type SaveKeyClass = "progress" | "device";

/**
 * What the stored text looks like, checked when a save is loaded:
 * "json" must parse as JSON, "number" is a plain finite number, "text" is any short
 * string (the app's own loaders check the meaning after the reload).
 */
export type SaveValueShape = "json" | "number" | "text";

export interface SaveKeyDef {
  key: string;
  cls: SaveKeyClass;
  shape: SaveValueShape;
  /** The key is a prefix: every key that starts with it is covered. */
  prefix?: boolean;
  /** Only these values load (the edition). */
  values?: readonly string[];
  /** A save without this key leaves this device's value alone (instead of removing it). */
  keepIfAbsent?: boolean;
  /** Lives in sessionStorage, not localStorage. */
  session?: boolean;
  /** Who owns it and why it is in its class. */
  note: string;
}

/**
 * Round-2 keys that other changes add in parallel (crash shield, graphics
 * memory, offline boot). Registered ahead so the scan passes the moment
 * they land; the stale-entry check skips them until then. Once a key is
 * used in src, saveKeys.test.ts fails until it is taken off this list, so
 * the exemption ends when the key lands (the merge that brings it in
 * removes it here).
 */
export const PENDING_ROUND2_KEYS: ReadonlySet<string> = new Set([
  "cr-clone-problem-log",
  "cr-clone-gfx-memory",
  "cr-clone-gfx-note-seen",
  "cr-clone-offline-ready-seen",
]);

const P = "progress" as const;
const D = "device" as const;

export const SAVE_KEYS: readonly SaveKeyDef[] = [
  // ---- Profile (meta/progress.ts)
  { key: "cr-clone-trophies", cls: P, shape: "number", note: "trophies (progress.ts)" },
  { key: "cr-clone-gold", cls: P, shape: "number", note: "gold (progress.ts)" },
  { key: "cr-clone-gems", cls: P, shape: "number", note: "gems (progress.ts)" },
  { key: "cr-clone-levels", cls: P, shape: "json", note: "card levels (progress.ts)" },
  { key: "cr-clone-owned", cls: P, shape: "json", note: "owned cards (progress.ts)" },
  { key: "cr-clone-shards", cls: P, shape: "json", note: "card shards (progress.ts)" },
  { key: "cr-clone-chests", cls: P, shape: "json", note: "chest slots (progress.ts)" },
  { key: "cr-clone-deck", cls: P, shape: "json", note: "the active deck (progress.ts)" },
  {
    key: "cr-clone-meta-v1",
    cls: P,
    shape: "text",
    note: "profile migration done (progress.ts); without it the next boot would reset gold and cards",
  },
  { key: "cr-clone-deck-slots", cls: P, shape: "json", note: "saved deck slots (decks.ts)" },
  // ---- Rewards and goals
  { key: "cr-clone-pass", cls: P, shape: "json", note: "Crown Pass (pass.ts)" },
  { key: "cr-clone-tower-flair", cls: P, shape: "json", note: "tower flair won on the pass (pass.ts)" },
  { key: "cr-clone-emotes-unlocked", cls: P, shape: "json", note: "emotes won on the pass (pass.ts)" },
  { key: "cr-clone-road", cls: P, shape: "json", note: "Trophy Road claims (road.ts)" },
  { key: "cr-clone-quests", cls: P, shape: "json", note: "daily quests (quests.ts)" },
  { key: "cr-clone-achievements", cls: P, shape: "json", note: "achievements and lifetime counters (achievements.ts)" },
  { key: "cr-clone-season", cls: P, shape: "json", note: "season and its best (achievements.ts)" },
  { key: "cr-clone-chests-earned", cls: P, shape: "number", note: "chests earned so far (chests.ts)" },
  { key: "cr-clone-free-chest-at", cls: P, shape: "number", note: "when the free chest is ready (chests.ts)" },
  { key: "cr-clone-legendary-pity", cls: P, shape: "number", note: "chests since the last legendary (chests.ts)" },
  { key: "cr-clone-reward-inbox", cls: P, shape: "json", note: "rewards waiting to be opened (rewardsWire.ts)" },
  { key: "cr-clone-draft-run", cls: P, shape: "json", note: "the draft run in progress (rewardsWire.ts)" },
  { key: "cr-clone-challenges-done", cls: P, shape: "json", note: "challenges already cleared (match/rewards.ts)" },
  { key: "cr-clone-daily-done", cls: P, shape: "text", note: "the day the daily was cleared (match/rewards.ts)" },
  { key: "cr-clone-streak", cls: P, shape: "json", note: "win/loss streak (match/rewards.ts)" },
  { key: "cr-clone-friendly-wins", cls: P, shape: "number", note: "friendly match wins (online.ts)" },
  { key: "cr-clone-losses", cls: P, shape: "number", note: "losses on the profile card (profile.ts)" },
  { key: "cr-clone-seen-unlocks", cls: P, shape: "json", note: "features already announced (unlocks.ts)" },
  // ---- Champion, tutorial and battle setup
  { key: "cr-clone-champion", cls: P, shape: "json", note: "the Studio champion (customcard.ts)" },
  { key: "cr-clone-tutorial", cls: P, shape: "text", note: "tutorial step (tutorial.ts)" },
  { key: "cr-clone-tutored", cls: P, shape: "text", note: "tutorial finished (tutorial.ts)" },
  { key: "cr-clone-tutorial-paid", cls: P, shape: "text", note: "tutorial win already paid (tutorial.ts)" },
  { key: "cr-clone-chest-tapped", cls: P, shape: "text", note: "the kid has opened a chest slot: no pointer hand (home.ts)" },
  { key: "cr-clone-newcards-seen", cls: P, shape: "text", note: "the new-cards sheet was seen (newCards.ts)" },
  { key: "cr-clone-difficulty", cls: P, shape: "text", note: "bot difficulty choice (difficulty.ts)" },
  { key: "cr-clone-auto-history", cls: P, shape: "json", note: "auto difficulty history (difficulty.ts)" },
  { key: "cr-clone-mode", cls: P, shape: "text", note: "chosen battle mode (modes.ts)" },
  { key: "cr-clone-ability", cls: P, shape: "text", note: "chosen king ability (abilities.ts)" },
  { key: "cr-clone-tower-troop", cls: P, shape: "text", note: "chosen tower troop (towers.ts)" },
  {
    key: "cr-clone-arena-theme",
    cls: P,
    shape: "text",
    values: ["normal", "arabic"],
    keepIfAbsent: true,
    note: "the edition (theme.ts, launcher/mode.ts): travels with the save",
  },
  // ---- This device only
  {
    key: "cr-clone-settings",
    cls: D,
    shape: "json",
    note: "settings (prefs.ts): volumes, graphics, text size; the name and crest travel separately",
  },
  { key: "cr-clone-relay", cls: D, shape: "text", note: "online relay address override (relayUrl.ts)" },
  { key: "cr-clone-replay", cls: D, shape: "json", note: "the last battle's replay tape (main.ts); large" },
  { key: "cr-clone-left-match", cls: D, shape: "json", note: "a ladder match left mid-battle on this device (leftMatch.ts)" },
  { key: "cr-clone-lobby-tab", cls: D, shape: "text", note: "an old lobby tab, cleared when the lobby opens (lobby.ts)" },
  { key: "cr-clone-coach-rotation", cls: D, shape: "number", note: "which coach tip shows next (coachTips.ts)" },
  { key: "cr-clone-splash-hold", cls: D, shape: "text", session: true, note: "keep the splash over a reload (editionGate.ts)" },
  { key: "cr-clone-pulse-chest", cls: D, shape: "text", session: true, note: "a chest was just earned this session (home.ts)" },
  { key: "cr-clone-save-backup", cls: D, shape: "json", note: "progress before the last save was loaded (saveCode.ts)" },
  { key: "cr-clone-persist-asked", cls: D, shape: "text", note: "storage persistence asked for once (keepSafe.ts)" },
  { key: "cr-clone-home-tip-seen", cls: D, shape: "text", note: "iPhone/iPad 'Add to Home Screen' tip shown (keepSafe.ts)" },
  {
    key: "cr-clone-save-loaded",
    cls: D,
    shape: "text",
    session: true,
    note: "a save was just loaded or undone: Home says so after the reload (saveSheet.ts)",
  },
  // ---- Round 2, added by other changes (see PENDING_ROUND2_KEYS)
  { key: "cr-clone-problem-log", cls: D, shape: "json", note: "the local problem log (crash shield)" },
  { key: "cr-clone-gfx-memory", cls: D, shape: "json", note: "graphics level this device settled on (auto graphics)" },
  { key: "cr-clone-gfx-note-seen", cls: D, shape: "text", note: "graphics note shown (auto graphics)" },
  { key: "cr-clone-offline-ready-seen", cls: D, shape: "text", note: "'ready to play offline' note shown (offline boot)" },
];

const EXACT = new Map<string, SaveKeyDef>();
const PREFIXES: SaveKeyDef[] = [];
for (const d of SAVE_KEYS) {
  if (d.prefix) PREFIXES.push(d);
  else EXACT.set(d.key, d);
}
// Longest prefix first, so the most specific entry wins.
PREFIXES.sort((a, b) => b.key.length - a.key.length);

/** The entry that covers this key (exact first, then the longest prefix), or undefined. */
export function saveKeyDef(key: string): SaveKeyDef | undefined {
  return EXACT.get(key) ?? PREFIXES.find((d) => key.startsWith(d.key));
}

/** True when this key goes into a save code. */
export function isProgressKey(key: string): boolean {
  return saveKeyDef(key)?.cls === "progress";
}

/** The exact (non-prefix) progress keys, in registry order. */
export const PROGRESS_KEYS: readonly string[] = SAVE_KEYS.filter((d) => d.cls === "progress" && !d.prefix).map(
  (d) => d.key,
);

/** Progress prefixes (none today); keys under them are found by listing the store. */
export const PROGRESS_PREFIXES: readonly string[] = SAVE_KEYS.filter((d) => d.cls === "progress" && d.prefix).map(
  (d) => d.key,
);

/** True when a stored value has the shape its key expects. Unknown keys never pass. */
export function valueFits(key: string, value: string): boolean {
  const d = saveKeyDef(key);
  if (!d) return false;
  if (d.values && !d.values.includes(value)) return false;
  if (d.shape === "number") return /^-?\d{1,16}(\.\d{1,8})?$/.test(value);
  if (d.shape === "json") {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}
