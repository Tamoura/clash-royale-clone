/**
 * Match settlement: ladder trophies/gold/chests, first-clear gold for
 * challenges and the daily, quests and achievements, and win/loss streaks.
 */
import type { Side } from "../game/arena";
import type { BattleState } from "../game/battle";
import type { Challenge } from "../game/challenges";
import { dateKey } from "../game/daily";
import { recordMatch as recordAchMatch, saveAchievements, saveSeason } from "../meta/achievements";
import { ARENAS, arenaIndexAt } from "../meta/arenas";
import { applyMatchResult as applyMetaMatchResult } from "../meta/progress";
import { loadQuests, recordMatch as recordQuestMatch, saveQuests } from "../meta/quests";
import { cardDisplayName } from "../render/cardNames";
import type { AppCtx } from "../app/ctx";
import type { BattleKind } from "../app/hooks";
import { showBanner } from "../ui/banner";
import { cardTileCanvas } from "../ui/screens/common";

// ---- Challenge / daily completion ------------------------------------------

const CHALLENGES_DONE_KEY = "cr-clone-challenges-done";
const DAILY_DONE_KEY = "cr-clone-daily-done";

export function challengesDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHALLENGES_DONE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function markChallengeDone(id: string): void {
  const done = challengesDone();
  done.add(id);
  localStorage.setItem(CHALLENGES_DONE_KEY, JSON.stringify([...done]));
}

export function isDailyDone(): boolean {
  return localStorage.getItem(DAILY_DONE_KEY) === dateKey(new Date());
}

// ---- Win/loss streaks: open rubber-banding ------------------------------
// 3 straight losses quietly ease the next bot; 3 straight wins summon a
// crowned "Champion Bot" that thinks faster but pays bonus gold.
const STREAK_KEY = "cr-clone-streak";
let streak = { wins: 0, losses: 0 };
try {
  const raw = localStorage.getItem(STREAK_KEY);
  if (raw) streak = { wins: 0, losses: 0, ...JSON.parse(raw) };
} catch {
  // fresh streak
}
function saveStreak(): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  } catch {
    // storage unavailable
  }
}
export const CHAMPION_BONUS_GOLD = 40;

export const currentStreak = (): { wins: number; losses: number } => streak;

// ---- Rewards ---------------------------------------------------------------

/** First-time gold for beating a challenge / the daily (never trophies). */
export function applySpecialReward(ctx: AppCtx, battleKind: BattleKind, activeChallenge: Challenge | null): void {
  const { meta, hud, tr } = ctx;
  if (battleKind === "challenge" && activeChallenge) {
    if (challengesDone().has(activeChallenge.id)) return;
    markChallengeDone(activeChallenge.id);
    meta.profile = { ...meta.profile, gold: meta.profile.gold + activeChallenge.goldReward };
    ctx.persistProfile();
    hud.setReward(tr(`First clear! +${activeChallenge.goldReward} 🪙`, `أول إنجاز! +${activeChallenge.goldReward} 🪙`));
  } else if (battleKind === "daily") {
    if (isDailyDone()) return;
    localStorage.setItem(DAILY_DONE_KEY, dateKey(new Date()));
    meta.profile = { ...meta.profile, gold: meta.profile.gold + 100 };
    ctx.persistProfile();
    hud.setReward(tr("Daily complete! +100 🪙", "أنجزت التحدي اليومي! +100 🪙"));
  }
}

/** Ladder result: trophies, gold, chest, season best. Returns the trophy delta. */
export function applyMatchResult(ctx: AppCtx, winner: "player" | "enemy" | "draw"): number {
  const { meta, hud, tr } = ctx;
  const arenaBefore = arenaIndexAt(meta.profile.trophies);
  const { profile: next, summary } = applyMetaMatchResult(
    { ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels },
    winner,
  );
  const arenaAfter = arenaIndexAt(next.trophies);
  if (arenaAfter > arenaBefore) {
    window.setTimeout(() => showArenaUp(ctx, ARENAS[arenaAfter]), 900);
  }
  meta.profile = next;
  meta.cardLevels = meta.profile.levels;
  meta.playerDeck = meta.profile.deck;
  ctx.persistProfile();
  hud.setRewardChest(summary.chestGranted ? summary.chestRarity : null);
  meta.season = { ...meta.season, best: Math.max(meta.season.best, meta.profile.trophies) };
  saveSeason(meta.season);
  meta.achievements = {
    ...meta.achievements,
    counters: {
      ...meta.achievements.counters,
      bestTrophies: Math.max(meta.achievements.counters.bestTrophies, meta.profile.trophies),
    },
  };
  saveAchievements(meta.achievements);
  // The chest shows as its own badge on the result screen.
  const d = summary.trophiesDelta;
  hud.setReward(
    [
      d === 0 ? tr("🏆 unchanged", "🏆 بلا تغيير") : `${d > 0 ? "+" : ""}${d} 🏆`,
      `+${summary.goldDelta} 🪙`,
    ].join(" · "),
  );
  return d;
}

/** Full-screen "NEW ARENA" celebration with the newly findable cards. */
function showArenaUp(ctx: AppCtx, arena: (typeof ARENAS)[number]): void {
  const { tr } = ctx;
  document.getElementById("arena-up")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "arena-up";
  const inner = document.createElement("div");
  inner.className = "arena-up-card";
  const crown = document.createElement("div");
  crown.className = "arena-up-crown";
  crown.textContent = "🏟️";
  inner.appendChild(crown);
  const title = document.createElement("h2");
  title.textContent = tr("NEW ARENA!", "ساحة جديدة!");
  inner.appendChild(title);
  const name = document.createElement("div");
  name.className = "arena-up-name";
  name.textContent = tr(arena.name, arena.ar);
  inner.appendChild(name);
  if (arena.unlocks.length > 0) {
    const label = document.createElement("div");
    label.className = "arena-up-label";
    label.textContent = tr("New cards now drop from chests:", ":بطاقات جديدة في الصناديق");
    inner.appendChild(label);
    const row = document.createElement("div");
    row.className = "arena-up-cards";
    for (const id of arena.unlocks.slice(0, 4)) {
      const cell = document.createElement("div");
      cell.className = "arena-up-cardcell";
      cell.appendChild(cardTileCanvas(id));
      const n = document.createElement("span");
      n.textContent = cardDisplayName(id);
      cell.appendChild(n);
      row.appendChild(cell);
    }
    inner.appendChild(row);
  }
  const hint = document.createElement("div");
  hint.className = "arena-up-hint";
  hint.textContent = tr("Tap to continue", "اضغط للمتابعة");
  inner.appendChild(hint);
  wrap.appendChild(inner);
  wrap.addEventListener("pointerdown", () => wrap.remove());
  document.body.appendChild(wrap);
  ctx.sound.sting();
}

// ---- Settlement ------------------------------------------------------------

export interface SettleInput {
  winner: Side | "draw";
  kind: BattleKind;
  online: boolean;
  sandbox: boolean;
  replaying: boolean;
  championBotMatch: boolean;
  activeChallenge: Challenge | null;
  battle: BattleState;
  mySide: Side;
  /** Cards the local player put down this match (quest progress). */
  cardsPlayed: number;
}

export interface Settlement {
  /** The match was folded into quests/achievements (reset the play counter). */
  recorded: boolean;
  /** A real ladder match: trophies moved. */
  ladder: boolean;
  trophyDelta: number;
}

/** Everything a finished match pays out; runs once per "finish" event. */
export function settleMatch(ctx: AppCtx, m: SettleInput): Settlement {
  const { meta } = ctx;
  const solo = !m.online;
  const mine = m.mySide === "player" ? m.battle.player : m.battle.enemy;
  let recorded = false;
  if (solo && !m.sandbox && !m.replaying) {
    // Fold the match into today's quests (any real solo battle counts).
    const today = dateKey(new Date());
    if (meta.quests.date !== today) meta.quests = loadQuests(today);
    meta.quests = recordQuestMatch(meta.quests, {
      won: m.winner === "player",
      cardsPlayed: m.cardsPlayed,
      damage: m.battle.player.stats.damageDealt,
    });
    saveQuests(meta.quests);
    meta.achievements = recordAchMatch(meta.achievements, {
      won: m.winner === m.mySide,
      crowns: mine.crowns,
      cardsPlayed: m.cardsPlayed,
      damage: mine.stats.damageDealt,
      durationSec: m.battle.time,
      deckHadChampion: meta.playerDeck.includes("champion"),
      trophiesAfter: meta.profile.trophies,
    });
    saveAchievements(meta.achievements);
    recorded = true;
  }
  // Only ladder matches move trophies/levels/chests — online friendlies,
  // sandbox, and the special modes can't farm the ladder.
  const ladder = solo && m.kind === "ladder" && !m.sandbox && !m.replaying;
  let trophyDelta = 0;
  if (ladder) {
    trophyDelta = applyMatchResult(ctx, m.winner);
    if (m.winner === "player") {
      streak = { wins: streak.wins + 1, losses: 0 };
      if (m.championBotMatch) {
        meta.profile = { ...meta.profile, gold: meta.profile.gold + CHAMPION_BONUS_GOLD };
        ctx.persistProfile();
        showBanner(ctx.tr(`Champion beaten! +${CHAMPION_BONUS_GOLD} 🪙`, `هزمت البطل! +${CHAMPION_BONUS_GOLD} 🪙`));
        streak = { wins: 0, losses: 0 }; // the gauntlet resets after the boss
      }
    } else if (m.winner === "enemy") {
      streak = { wins: 0, losses: streak.losses + 1 };
    }
    saveStreak();
  } else if (solo && m.winner === "player" && !m.replaying) {
    applySpecialReward(ctx, m.kind, m.activeChallenge);
  }
  return { recorded, ladder, trophyDelta };
}
