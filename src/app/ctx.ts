/**
 * AppCtx: what main.ts hands every screen and match module. Screens call
 * ctx.* (start a match, open another screen) instead of importing each
 * other, so each screen module stays independently owned.
 */
import type { SoundEngine } from "../audio/sound";
import type { BattleState, CardLevels } from "../game/battle";
import type { AbilityId } from "../game/abilities";
import type { CardId } from "../game/cards";
import type { Challenge } from "../game/challenges";
import type { TowerTroopId } from "../game/towers";
import type { GameMode as GameVariant } from "../launcher/mode";
import type { AchievementState, SeasonState } from "../meta/achievements";
import type { PlayerProfile } from "../meta/progress";
import type { QuestState } from "../meta/quests";
import type { Hud } from "../render3d/hud";
import type { Battle3D } from "../render3d/scene3d";
import type { GameMode } from "../match/modes";

/** The player's saved progress and loadout; screens mutate it in place. */
export interface MetaState {
  profile: PlayerProfile;
  playerDeck: CardId[];
  cardLevels: CardLevels;
  quests: QuestState;
  achievements: AchievementState;
  season: SeasonState;
  /** Bot difficulty key (see match/difficulty.ts). */
  difficulty: string;
  gameMode: GameMode;
  towerTroop: TowerTroopId;
  abilityChoice: AbilityId;
}

export interface DeckPickerOpts {
  mode: "battle" | "deck";
}

export interface LobbyOpts {
  /** Reserved for quick match (relay support lands separately). */
  quick?: boolean;
  /** Prefill the join code. */
  code?: string;
}

export interface AppCtx {
  // ---- Match start paths
  startLadder(): void;
  startDaily(): void;
  startDraft(mine: CardId[], bot: CardId[]): void;
  startChallenge(ch: Challenge): void;
  startReplay(): void;

  // ---- Screens
  openHome(): void;
  openDeckPicker(opts?: DeckPickerOpts): void;
  openCollection(): void;
  openChests(): void;
  openChallenges(): void;
  openDraft(): void;
  openStudio(): void;
  openLobby(opts?: LobbyOpts): void;

  // ---- Services
  scene: Battle3D;
  sound: SoundEngine;
  hud: Hud;
  tr: (en: string, ar: string) => string;

  // ---- Shared shell state
  meta: MetaState;
  /** Save meta.profile (with the current deck + levels) and refresh flair. */
  persistProfile(): void;
  /** The chosen edition; null until the player picks one. */
  variant: GameVariant | null;
  /** The full-screen picker element every menu screen renders into. */
  pickerRoot: HTMLElement;
  stage: HTMLElement;
  /** Show the picker (already built) as screen `id`; emits the screen hook. */
  showPicker(id: string): void;
  /** Hide the picker and restore the in-battle HUD. */
  closeDeckPicker(): void;
  /** The trophy-road arena the next battle is staged in. */
  battleArenaId(): string;
  /** A random bot deck from the cards unlocked at the player's arena. */
  botDeck(): CardId[];
  /** A saved ladder recording exists (the Events tab's "Last Battle"). */
  hasReplay(): boolean;

  // ---- Match wiring for start paths that live outside main.ts
  setBattle(battle: BattleState): void;
  selectCard(id: CardId | null): void;
  hideSandboxReset(): void;
}
