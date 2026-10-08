/**
 * Profile tab: the player card (editable name, crest picker, trophies,
 * best season, wins and losses), lifetime achievements, the 'profile'
 * slot and a Settings button. Name and crest live in prefs, so the top
 * bar, result screen and online lobbies all read the same identity.
 */
import type { AppCtx } from "../../app/ctx";
import { on } from "../../app/hooks";
import { DECK } from "../../game/cards";
import { ACHIEVEMENTS, achievementProgress, claimAchievement, isEarned, saveAchievements } from "../../meta/achievements";
import { button } from "../components";
import { fmtNum } from "../i18n";
import { icon, type CrestIndex, type IconName } from "../icons";
import { CREST_COUNT, PLAYER_NAME_MAX, getPrefs, sanitizePlayerName, setPrefs } from "../prefs";
import { claimButton, crestIcon, goalRow, refreshTopBars, section, type ClaimState } from "./frame";
import { openSettings } from "./settings";
import { startTutorial } from "../tutorialOverlay";

// ---- Losses: wins already live in the achievement counters ------------------

const LOSSES_KEY = "cr-clone-losses";

export function loadLosses(): number {
  try {
    const n = Number(localStorage.getItem(LOSSES_KEY) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

// Counted like the achievement 'wins' counter: real solo matches only.
on("matchEnd", (m) => {
  if (m.online || m.replay || m.sandbox || m.winner === "draw" || m.winner === m.mySide) return;
  try {
    localStorage.setItem(LOSSES_KEY, String(loadLosses() + 1));
  } catch {
    // storage blocked: the record just stays where it was
  }
});

// ---- Player card ---------------------------------------------------------------

function stat(ic: IconName, value: string, label: string): HTMLElement {
  const s = document.createElement("div");
  s.className = "v2-stat";
  s.innerHTML = `${icon(ic)}<b></b><span></span>`;
  s.querySelector("b")!.textContent = value;
  s.querySelector("span")!.textContent = label;
  return s;
}

function playerCard(ctx: AppCtx): HTMLElement {
  const { tr, meta } = ctx;
  const card = document.createElement("section");
  card.className = "v2-player";

  const top = document.createElement("div");
  top.className = "v2-player-top";
  const crest = document.createElement("div");
  crest.className = "v2-player-crest";
  crest.innerHTML = crestIcon();
  top.appendChild(crest);

  const id = document.createElement("div");
  id.className = "v2-player-id";
  const nameLabel = document.createElement("label");
  nameLabel.className = "v2-name-field";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = PLAYER_NAME_MAX * 2; // sanitised to 12 code points on save
  input.value = getPrefs().playerName;
  input.placeholder = tr("Your name", "اسمك");
  input.setAttribute("autocomplete", "nickname");
  input.enterKeyHint = "done";
  input.setAttribute("aria-label", tr("Player name", "اسم اللاعب"));
  const save = (): void => {
    const clean = sanitizePlayerName(input.value);
    input.value = clean;
    if (clean !== getPrefs().playerName) {
      setPrefs({ playerName: clean });
      refreshTopBars(ctx);
    }
  };
  input.addEventListener("change", save);
  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  nameLabel.appendChild(input);
  nameLabel.insertAdjacentHTML("beforeend", icon("pencil", "v2-name-pencil"));
  id.appendChild(nameLabel);
  const season = document.createElement("div");
  season.className = "v2-player-season";
  season.textContent = tr(`Season ${meta.season.key}`, `موسم ${meta.season.key}`);
  id.appendChild(season);
  top.appendChild(id);
  card.appendChild(top);

  const best = Math.max(meta.season.best, meta.profile.trophies, ...meta.season.history.map((h) => h.best));
  const stats = document.createElement("div");
  stats.className = "v2-stats";
  stats.append(
    stat("trophy", fmtNum(meta.profile.trophies), tr("Trophies", "الكؤوس")),
    stat("star", fmtNum(best), tr("Best season", "أفضل موسم")),
    stat("crown-filled", fmtNum(meta.achievements.counters.wins), tr("Wins", "انتصارات")),
    stat("skull", fmtNum(loadLosses()), tr("Losses", "هزائم")),
    stat("cards", `${fmtNum(meta.profile.owned.length)}/${fmtNum(DECK.length)}`, tr("Cards found", "بطاقات مكتشفة")),
    stat("chest", fmtNum(meta.achievements.counters.chests), tr("Chests opened", "صناديق مفتوحة")),
  );
  card.appendChild(stats);

  // Crest picker
  const pickHead = document.createElement("div");
  pickHead.className = "v2-crest-head";
  pickHead.textContent = tr("Crest", "الشعار");
  card.appendChild(pickHead);
  const picker = document.createElement("div");
  picker.className = "v2-crests";
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", tr("Crest", "الشعار"));
  const paint = (): void => {
    const cur = getPrefs().crest;
    picker.querySelectorAll<HTMLButtonElement>("button").forEach((b, i) => {
      b.setAttribute("aria-checked", String(i === cur));
      b.tabIndex = i === cur ? 0 : -1;
    });
    crest.innerHTML = crestIcon();
  };
  for (let i = 0; i < CREST_COUNT; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "v2-crest-opt";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", tr(`Crest ${i + 1}`, `الشعار ${fmtNum(i + 1)}`));
    b.innerHTML = icon(`crest-${i as CrestIndex}`);
    b.addEventListener("click", () => {
      setPrefs({ crest: i });
      paint();
      refreshTopBars(ctx);
    });
    picker.appendChild(b);
  }
  paint();
  card.appendChild(picker);
  return card;
}

// ---- Achievements --------------------------------------------------------------------

function achievementsBoard(ctx: AppCtx, rerender: () => void): HTMLElement {
  const { meta, tr } = ctx;
  const a = meta.achievements;
  const done = a.claimed.length;
  const count = document.createElement("span");
  count.className = "v2-count";
  count.textContent = `${fmtNum(done)} / ${fmtNum(ACHIEVEMENTS.length)}`;
  const s = section(tr("Achievements", "الإنجازات"), count);
  s.el.classList.add("v2-board");
  // Claimable first, then closest to done, claimed last.
  const rank = (d: (typeof ACHIEVEMENTS)[number]): number => (a.claimed.includes(d.id) ? 2 : isEarned(a, d) ? 0 : 1);
  const sorted = [...ACHIEVEMENTS].sort(
    (x, y) => rank(x) - rank(y) || achievementProgress(a, y) / y.target - achievementProgress(a, x) / x.target,
  );
  for (const def of sorted) {
    const state: ClaimState = a.claimed.includes(def.id) ? "claimed" : isEarned(a, def) ? "claimable" : "locked";
    const btn = claimButton(ctx, state, def.reward, () => {
      const res = claimAchievement(meta.achievements, def.id);
      if (!res) return;
      meta.achievements = res.state;
      saveAchievements(meta.achievements);
      meta.profile = { ...meta.profile, gold: meta.profile.gold + res.reward };
      ctx.persistProfile();
      refreshTopBars(ctx);
      rerender();
    });
    s.el.appendChild(goalRow(tr(def.en, def.ar), achievementProgress(a, def), def.target, btn));
  }
  return s.el;
}

/** Fill the Profile tab. `fillSlot` renders the 'profile' home slot. */
export function buildProfileTab(
  ctx: AppCtx,
  host: HTMLElement,
  fillSlot: (host: HTMLElement) => void,
  rerender: () => void,
): void {
  host.appendChild(playerCard(ctx));
  host.appendChild(achievementsBoard(ctx, rerender));
  const slot = document.createElement("div");
  slot.className = "v2-slot";
  host.appendChild(slot);
  fillSlot(slot);
  const settings = button({
    variant: "secondary",
    size: "lg",
    icon: "settings",
    label: ctx.tr("Settings", "الإعدادات"),
    onClick: () => openSettings({ onClose: () => refreshTopBars(ctx), onReplayTutorial: () => startTutorial(ctx) }),
  });
  settings.classList.add("v2-wide");
  host.appendChild(settings);
}
