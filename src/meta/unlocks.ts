/**
 * Feature unlocks along the trophy road. New players start with the plain
 * ladder; extra modes and loadout choices open up arena by arena, so the
 * menus grow with the player instead of all landing on day one.
 *
 * Arena numbers are trophy-road indices (0 = Training Camp). A feature
 * stays unlocked once the player has reached its arena, even if trophies
 * later drop (losses, the season soft reset).
 *
 * "Seen" state ('cr-clone-seen-unlocks') drives the one-time toast and the
 * NEW badge. A save that predates this file is seeded with everything it
 * already has, so long-time players are not flooded with toasts for
 * features they have always had.
 */
import { arenaIndexAt } from "./arenas";

export type Feature =
  | "sandbox"
  | "challenges"
  | "towerTroops"
  | "abilities"
  | "triple"
  | "mirror"
  | "mega"
  | "crazy"
  | "draft";

/** The arena index at which each feature opens. */
export const FEATURE_ARENA: Readonly<Record<Feature, number>> = Object.freeze({
  sandbox: 1,
  challenges: 1,
  towerTroops: 2,
  abilities: 3,
  triple: 4,
  mirror: 4,
  mega: 5,
  crazy: 5,
  draft: 5,
});

export const FEATURES = Object.keys(FEATURE_ARENA) as Feature[];

/** English / Arabic display names (toasts and lock captions). */
export const FEATURE_LABEL: Readonly<Record<Feature, readonly [string, string]>> = Object.freeze({
  sandbox: ["Sandbox", "ساحة التجربة"],
  challenges: ["Challenges", "التحديات"],
  towerTroops: ["Tower troops", "حماة الأبراج"],
  abilities: ["King's abilities", "قدرات الملك"],
  triple: ["Triple Elixir", "الإكسير الثلاثي"],
  mirror: ["Mirror Match", "مباراة المرآة"],
  mega: ["Mega Elixir", "الإكسير الهائل"],
  crazy: ["Crazy mode", "نمط الجنون"],
  draft: ["Draft", "الانتقاء"],
});

/** The arena index a feature needs. */
export function featureArena(f: Feature): number {
  return FEATURE_ARENA[f];
}

/** True once the player has reached the feature's arena. */
export function featureUnlocked(f: Feature, arenaIndex: number): boolean {
  return arenaIndex >= FEATURE_ARENA[f];
}

/** Every feature open at this arena, in declaration order. */
export function unlockedFeatures(arenaIndex: number): Feature[] {
  return FEATURES.filter((f) => featureUnlocked(f, arenaIndex));
}

/** The feature gating an in-match game mode (null = always open). */
export function modeFeature(modeId: string): Feature | null {
  switch (modeId) {
    case "sandbox":
    case "triple":
    case "mirror":
    case "mega":
    case "crazy":
      return modeId;
    default:
      return null;
  }
}

/**
 * The highest arena the player has stood in: the current trophies or the
 * best ever recorded, whichever is higher.
 */
export function reachedArenaIndex(trophies: number, bestTrophies = 0): number {
  return arenaIndexAt(Math.max(trophies, bestTrophies));
}

// ---- Seen / NEW state --------------------------------------------------------

export const SEEN_UNLOCKS_KEY = "cr-clone-seen-unlocks";

export interface SeenUnlocks {
  /** Features whose "unlocked!" toast has been shown. */
  toasted: Feature[];
  /** Features the player has looked at (NEW badge cleared). */
  seen: Feature[];
}

const isFeature = (v: unknown): v is Feature =>
  typeof v === "string" && (FEATURES as string[]).includes(v);

/**
 * Parse the stored state. Nothing stored yet means this save predates
 * unlocks: everything already open counts as toasted and seen.
 */
export function parseSeen(raw: string | null, arenaIndex: number): SeenUnlocks {
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<SeenUnlocks> | null;
      if (v && typeof v === "object") {
        return {
          toasted: Array.isArray(v.toasted) ? v.toasted.filter(isFeature) : [],
          seen: Array.isArray(v.seen) ? v.seen.filter(isFeature) : [],
        };
      }
    } catch {
      // corrupt: fall through to the seed
    }
  }
  const have = unlockedFeatures(arenaIndex);
  return { toasted: [...have], seen: [...have] };
}

/** Unlocked features still owed their one-time toast. */
export function pendingToasts(state: SeenUnlocks, arenaIndex: number): Feature[] {
  return unlockedFeatures(arenaIndex).filter((f) => !state.toasted.includes(f));
}

/** Unlocked but not yet looked at: show a NEW badge. */
export function isNew(f: Feature, state: SeenUnlocks, arenaIndex: number): boolean {
  return featureUnlocked(f, arenaIndex) && !state.seen.includes(f);
}

const union = (a: readonly Feature[], b: readonly Feature[]): Feature[] => [...new Set([...a, ...b])];

export function markToasted(state: SeenUnlocks, fs: readonly Feature[]): SeenUnlocks {
  return { ...state, toasted: union(state.toasted, fs) };
}

/** Clear the NEW badge; only features that are actually unlocked are recorded. */
export function markSeen(state: SeenUnlocks, fs: readonly Feature[], arenaIndex: number): SeenUnlocks {
  return { ...state, seen: union(state.seen, fs.filter((f) => featureUnlocked(f, arenaIndex))) };
}

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSeen(storage: SeenStorage | null, arenaIndex: number): SeenUnlocks {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SEEN_UNLOCKS_KEY) ?? null;
  } catch {
    raw = null;
  }
  const state = parseSeen(raw, arenaIndex);
  // Persist the seed straight away so it is computed only once.
  if (raw === null) saveSeen(storage, state);
  return state;
}

export function saveSeen(storage: SeenStorage | null, state: SeenUnlocks): void {
  try {
    storage?.setItem(SEEN_UNLOCKS_KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked: the badge just shows again next time
  }
}
