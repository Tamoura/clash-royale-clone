/**
 * The rename to Banner Lanes changed names on screen only. Every id a save,
 * a backup, a deck code, an online match or the service worker relies on
 * stayed as it was, so no save is lost. These tests pin that.
 */
import { describe, expect, it } from "vitest";
import { CARDS } from "../game/cards";
import { CHALLENGES, TRIAL_CHALLENGES } from "../game/challenges";
import { TOWER_TROOP_IDS, TOWER_TROOP_KEY } from "../game/towers";
import { SIM_VERSION } from "../game/version";
import { GAME_MODES, MODE_KEY } from "../match/modes";
import { cleanCode } from "../match/online";
import { PROTOCOL_VERSION } from "../net/protocol";
import { ARENA_THEME_KEY } from "../render3d/theme";
import { ARENAS } from "./arenas";
import { CODE_CARDS } from "./deckCode";
import { SAVE_BACKUP_KEY, SAVE_GAME, decodeSave, saveFileName } from "./saveCode";
import { SAVE_KEYS } from "./saveKeys";

/**
 * Codes made by the build before the rename (63fea18, "Crown Rush"), with
 * its own encoder: uncompressed and packed. They hold a deck of card ids
 * whose names changed on screen (Hog Rider, Mini P.E.K.K.A, Elixir
 * Collector, Skeleton Army, Minions).
 */
const OLD_PLAIN = "CR1PeyJnIjoiY3Jvd24tcnVzaCIsInYiOjEsInQiOjE3OTQ4MDAwMDAwMDAsImsiOnsiY3ItY2xvbmUtZ29sZCI6IjEyMzQiLCJjci1jbG9uZS10cm9waGllcyI6IjY0MCIsImNyLWNsb25lLWRlY2siOiJbXCJrbmlnaHRcIixcImhvZy1yaWRlclwiLFwibWluaS1wZWtrYVwiLFwiZWxpeGlyLWNvbGxlY3RvclwiLFwic2tlbGV0b24tYXJteVwiLFwibWluaW9uc1wiLFwiZmlyZWJhbGxcIixcImFycm93c1wiXSJ9fQR";
const OLD_PACKED = "CR1ZTYvbDoIwEET_ZZ7bBJR46a-ID1hWaFq6ZFtFQ_h3EzTqPM2Zy4wOBlZ4ilpuqYfCHaZUyDDl_lgdio8UPMwMK9oGjqQ7Di0Mys22gvrFWXjsHSUY7Kriv2nJehicavjouj7XUDV67rS4lmSlwUWnR_K-WZGCezjRlkMgm_m9SZ4CZY66keH5fXFMq786oUsTwgqNCE-pxhnL8gI3";
const OLD_DECK = ["knight", "hog-rider", "mini-pekka", "elixir-collector", "skeleton-army", "minions", "fireball", "arrows"];

describe("the rename keeps every save", () => {
  it("loads codes made before the rename (plain and packed)", async () => {
    for (const code of [OLD_PLAIN, OLD_PACKED]) {
      const r = await decodeSave(code);
      expect(r.ok, code.slice(0, 12)).toBe(true);
      if (!r.ok) continue;
      expect(r.data.keys["cr-clone-gold"]).toBe("1234");
      expect(r.data.keys["cr-clone-trophies"]).toBe("640");
      expect(JSON.parse(r.data.keys["cr-clone-deck"])).toEqual(OLD_DECK);
    }
  });

  it("loads an old save file (crown-rush-save-<date>.txt, headed with the old name) by its text", async () => {
    const file = `Crown Rush save\r\nSaved 3 November 2026\r\n${OLD_PACKED}\r\n`;
    const r = await decodeSave(file);
    expect(r.ok).toBe(true);
  });

  it("keeps the code's head and game tag: they are ids, not the game's name", () => {
    expect(SAVE_GAME).toBe("crown-rush");
    expect(OLD_PLAIN.startsWith("CR1")).toBe(true);
    expect(JSON.parse(atob(OLD_PLAIN.slice(4, -1).replace(/-/g, "+").replace(/_/g, "/"))).g).toBe(SAVE_GAME);
    // Only the download's name changed.
    expect(saveFileName(new Date(2026, 10, 3))).toBe("banner-lanes-save-2026-11-03.txt");
  });

  it("keeps every storage key the build before the rename used", () => {
    const before = [
      "cr-clone-trophies", "cr-clone-gold", "cr-clone-gems", "cr-clone-levels", "cr-clone-owned",
      "cr-clone-shards", "cr-clone-chests", "cr-clone-deck", "cr-clone-meta-v1", "cr-clone-deck-slots",
      "cr-clone-pass", "cr-clone-tower-flair", "cr-clone-emotes-unlocked", "cr-clone-road", "cr-clone-quests",
      "cr-clone-achievements", "cr-clone-season", "cr-clone-chests-earned", "cr-clone-free-chest-at",
      "cr-clone-legendary-pity", "cr-clone-reward-inbox", "cr-clone-draft-run", "cr-clone-challenges-done",
      "cr-clone-daily-done", "cr-clone-streak", "cr-clone-friendly-wins", "cr-clone-losses",
      "cr-clone-seen-unlocks", "cr-clone-champion", "cr-clone-tutorial", "cr-clone-tutored",
      "cr-clone-tutorial-paid", "cr-clone-chest-tapped", "cr-clone-newcards-seen", "cr-clone-difficulty",
      "cr-clone-auto-history", "cr-clone-mode", "cr-clone-ability", "cr-clone-tower-troop", "cr-clone-arena-theme",
      "cr-clone-settings", "cr-clone-relay", "cr-clone-replay", "cr-clone-left-match", "cr-clone-lobby-tab",
      "cr-clone-coach-rotation", "cr-clone-splash-hold", "cr-clone-pulse-chest", "cr-clone-save-backup",
      "cr-clone-persist-asked", "cr-clone-home-tip-seen", "cr-clone-standalone-hint-seen", "cr-clone-save-loaded",
      "cr-clone-problem-log", "cr-clone-gfx-memory", "cr-clone-gfx-note-seen", "cr-clone-offline-ready-seen",
    ];
    const now = new Set(SAVE_KEYS.map((d) => d.key));
    for (const k of before) expect(now.has(k), k).toBe(true);
    expect(SAVE_BACKUP_KEY).toBe("cr-clone-save-backup");
    expect(ARENA_THEME_KEY).toBe("cr-clone-arena-theme");
    expect(MODE_KEY).toBe("cr-clone-mode");
    expect(TOWER_TROOP_KEY).toBe("cr-clone-tower-troop");
  });

  it("keeps the ids stored in those keys: cards, arenas, challenges, modes, tower troops", () => {
    for (const id of ["pekka", "mini-pekka", "hog-rider", "mega-knight", "electro-wizard", "royal-giant", "skeleton-barrel", "skeleton-army", "minions", "magic-archer", "elixir-collector", "executioner", "princess", "tombstone", "rage"]) {
      expect(Object.keys(CARDS), id).toContain(id);
    }
    expect(ARENAS.map((a) => a.id)).toEqual([
      "training-camp", "goblin-stadium", "bone-pit", "barbarian-bowl", "pekka-playhouse", "spell-valley",
      "builders-workshop", "royal-arena", "frozen-peak", "jungle-arena", "legendary-peak",
    ]);
    const challengeIds = [...CHALLENGES, ...TRIAL_CHALLENGES].map((c) => c.id);
    for (const id of ["little-ones", "the-horde", "hog-rush", "sky-pirates", "mega-drop", "bridge-spam", "witch-party", "skeleton-storm"]) {
      expect(challengeIds, id).toContain(id);
    }
    expect(GAME_MODES.map((m) => m.id)).toEqual(["classic", "triple", "mega", "mirror", "crazy", "sandbox"]);
    expect(TOWER_TROOP_IDS).toEqual(["princess", "cannoneer", "duchess"]);
  });

  it("keeps deck codes (the card order is append-only, by id)", () => {
    expect(CODE_CARDS.slice(0, 30)).toEqual([
      "knight", "archers", "firecracker", "magic-archer", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "valkyrie",
      "skeletons", "wizard", "witch", "hog-rider", "balloon", "prince", "pekka", "cannon", "tombstone", "elixir-collector",
      "gargoyles", "bats", "minions", "skeleton-army", "executioner", "electro-wizard", "ice-wizard", "princess", "mega-knight", "royal-giant",
    ]);
  });

  it("keeps online play and invites: same versions, same room codes", () => {
    expect(SIM_VERSION).toBe(3);
    expect(PROTOCOL_VERSION).toBe(3);
    expect(cleanCode("LION042")).toBe("LION042");
  });
});
