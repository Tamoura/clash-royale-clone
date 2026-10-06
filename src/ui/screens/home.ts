/**
 * Home: the edition gate on first visit, then the CR-style home shell
 * (resource bar, arena diorama window, tab panel, bottom tab bar) with the
 * daily quest and achievement boards.
 */
import type { AppCtx } from "../../app/ctx";
import { on } from "../../app/hooks";
import { renderHomeSlots, type HomeSlot } from "../../app/slots";
import { hasSavedChampion } from "../../game/customcard";
import { dateKey } from "../../game/daily";
import { saveMode as saveVariant, type GameMode as GameVariant } from "../../launcher/mode";
import {
  ACHIEVEMENTS,
  achievementProgress,
  claimAchievement,
  isEarned,
  saveAchievements,
} from "../../meta/achievements";
import { trophyProgress } from "../../meta/arenas";
import { claimQuest, isComplete, loadQuests, questDef, saveQuests } from "../../meta/quests";
import { isDailyDone } from "../../match/rewards";
import { EDITION_CHOSEN } from "../../render3d/theme";
import { icon } from "../icons";

type HomeTab = "shop" | "cards" | "battle" | "events" | "profile";
let homeTab: HomeTab = "battle";

// Cleanups returned by home-slot providers; run when the home is rebuilt or left.
let slotCleanups: (() => void)[] = [];
function cleanupSlots(): void {
  const done = slotCleanups;
  slotCleanups = [];
  for (const fn of done) fn();
}
on("screen", (s) => {
  if (s.id !== "home") cleanupSlots();
});
function fillSlot(slot: HomeSlot, host: HTMLElement): void {
  slotCleanups.push(renderHomeSlots(slot, host));
}

export function appendEditionToggle(ctx: AppCtx, parent: HTMLElement): void {
  const { variant } = ctx;
  const editionRow = document.createElement("div");
  editionRow.className = "edition-row";
  editionRow.setAttribute("role", "group");
  editionRow.setAttribute("aria-label", "Choose edition");
  const MODE_LABEL: Record<GameVariant, string> = {
    clash: "⚔️ Clash Royale",
    islamic: "🌙 Islamic",
  };
  for (const v of ["clash", "islamic"] as GameVariant[]) {
    const btn = document.createElement("button");
    btn.className = "edition-btn";
    btn.textContent = MODE_LABEL[v];
    const chosen = variant === v;
    btn.setAttribute("aria-pressed", String(chosen));
    btn.classList.toggle("chosen", chosen);
    btn.addEventListener("click", () => {
      if (v === variant) return;
      saveVariant(localStorage, v);
      location.reload();
    });
    editionRow.appendChild(btn);
  }
  parent.appendChild(editionRow);
  const editionNote = document.createElement("div");
  editionNote.className = "edition-note";
  editionNote.textContent = variant
    ? variant === "islamic"
      ? "Islamic Golden Age — Faris, camels, war elephants & crescents."
      : "The classic clone — Western knights, wizards, P.E.K.K.A."
    : "Pick Clash Royale or Islamic Golden Age to begin.";
  parent.appendChild(editionNote);
}

export function buildHome(ctx: AppCtx): void {
  const { pickerRoot } = ctx;
  cleanupSlots();
  pickerRoot.innerHTML = "";
  if (EDITION_CHOSEN && ctx.variant) {
    buildHomeShell(ctx);
    return;
  }

  // Edition gate: nothing else is reachable until an edition is picked.
  const crest = document.createElement("div");
  crest.className = "cr-crest";
  crest.setAttribute("aria-hidden", "true");
  crest.textContent = "⚔️";
  pickerRoot.appendChild(crest);

  const title = document.createElement("h2");
  title.textContent = "Choose your edition";
  pickerRoot.appendChild(title);

  appendEditionToggle(ctx, pickerRoot);

  const gate = document.createElement("div");
  gate.className = "edition-gate";
  gate.textContent = "Select an edition above to enter the arena.";
  pickerRoot.appendChild(gate);
}

/**
 * The CR-style home: resource bar, a window onto your current arena (the
 * live 3D scene behind a transparent cut-out, slowly orbiting), the
 * trophy-road banner, a tab panel, and a bottom tab bar.
 */
export function buildHomeShell(ctx: AppCtx): void {
  const { pickerRoot, scene, stage, tr } = ctx;
  const { profile } = ctx.meta;
  const shell = document.createElement("div");
  shell.className = "home-shell";
  pickerRoot.appendChild(shell);

  // Stage the diorama: your arena, swaying behind the window.
  scene.setArenaLook(ctx.battleArenaId());
  scene.setShowcase(true, 0.5);

  // ---- Resource bar -----------------------------------------------------
  const top = document.createElement("div");
  top.className = "home-top";
  top.innerHTML =
    `<span class="home-chip trophies">${icon("trophy")}<b>${profile.trophies}</b></span>` +
    `<span class="home-chip gold">${icon("coin")}<b>${profile.gold}</b></span>` +
    `<span class="home-chip gems">${icon("gem")}<b>${profile.gems}</b></span>`;
  shell.appendChild(top);

  // ---- Arena window + trophy road banner --------------------------------
  const win = document.createElement("div");
  win.className = "home-window";
  const prog = trophyProgress(profile.trophies);
  const banner = document.createElement("div");
  banner.className = "home-arena-banner";
  banner.innerHTML =
    `<div class="home-arena-name">${tr(prog.current.name, prog.current.ar)}</div>` +
    `<div class="home-road"><div class="home-road-fill" style="width:${Math.round(prog.ratio * 100)}%"></div>` +
    `<span>${icon("trophy")} ${profile.trophies}${prog.next ? ` / ${prog.next.trophies}` : ""}</span></div>` +
    (prog.next ? `<div class="home-arena-next">${tr("Next", "التالي")}: ${tr(prog.next.name, prog.next.ar)}</div>` : "");
  win.appendChild(banner);
  shell.appendChild(win);
  // Fit the diorama to the window once the home screen is laid out.
  requestAnimationFrame(() => {
    const bottom = banner.getBoundingClientRect().top;
    const h = stage.clientHeight || 1;
    if (bottom > 0) scene.setShowcase(true, Math.min(0.9, Math.max(0.3, bottom / h)));
  });

  // ---- Tab panel ---------------------------------------------------------
  const panel = document.createElement("div");
  panel.className = "home-panel";
  shell.appendChild(panel);
  const mk = (parent: HTMLElement, iconName: Parameters<typeof icon>[0], label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.innerHTML = `${icon(iconName)}<span>${label}</span>`;
    btn.addEventListener("click", fn);
    parent.appendChild(btn);
    return btn;
  };
  const grid = (): HTMLElement => {
    const g = document.createElement("div");
    g.className = "home-grid";
    panel.appendChild(g);
    return g;
  };

  const questHost = document.createElement("div");
  questHost.className = "home-boards";
  const achHost = document.createElement("div");
  achHost.className = "home-boards";

  if (homeTab === "battle") {
    mk(panel, "sword", tr("Battle", "قتال"), "battle-btn home-battle", () => ctx.openDeckPicker({ mode: "battle" }));
    fillSlot("battle-top", panel);
    panel.appendChild(chestRow(ctx));
    panel.appendChild(questHost);
    fillSlot("battle-bottom", panel);
  } else if (homeTab === "cards") {
    const g = grid();
    mk(g, "cards", tr("Deck", "المجموعة"), "battle-btn friend", () => ctx.openDeckPicker({ mode: "deck" }));
    mk(g, "book", tr("Collection", "المقتنيات"), "battle-btn friend", () => ctx.openCollection());
    mk(
      g,
      "hammer",
      hasSavedChampion() ? tr("Edit Champion", "تعديل البطل") : tr("Create Champion", "إنشاء البطل"),
      "battle-btn friend",
      () => ctx.openStudio(),
    );
  } else if (homeTab === "shop") {
    panel.appendChild(chestRow(ctx));
    const g = grid();
    mk(g, "chest", tr("Chest room", "غرفة الصناديق"), "battle-btn friend", () => ctx.openChests());
    const note = document.createElement("div");
    note.className = "collect-label";
    note.textContent = tr(
      "Win ladder battles to earn chests. Craft missing shards with gold in Collection.",
      "افز بمعارك السلم لتربح صناديق. اصنع الشظايا الناقصة بالذهب في المقتنيات.",
    );
    panel.appendChild(note);
    fillSlot("shop", panel);
  } else if (homeTab === "events") {
    const g = grid();
    mk(g, "puzzle", tr("Challenges", "تحديات"), "battle-btn friend", () => ctx.openChallenges());
    mk(
      g,
      "calendar",
      isDailyDone() ? tr("Daily ✓ done", "اليومية ✓") : tr("Daily Battle", "المعركة اليومية"),
      "battle-btn friend",
      () => ctx.startDaily(),
    );
    mk(g, "dice", tr("Draft", "انتقاء"), "battle-btn friend", () => ctx.openDraft());
    if (ctx.hasReplay()) {
      mk(g, "tv", tr("Last Battle", "آخر معركة"), "battle-btn friend", () => {
        ctx.closeDeckPicker();
        ctx.startReplay();
      });
    }
    fillSlot("events", panel);
  } else {
    appendEditionToggle(ctx, panel);
    panel.appendChild(achHost);
    fillSlot("profile", panel);
  }

  // ---- Bottom tab bar -----------------------------------------------------
  const tabs = document.createElement("nav");
  tabs.className = "home-tabs";
  const TABS: Array<[HomeTab, Parameters<typeof icon>[0], string, string]> = [
    ["shop", "shop", "Shop", "المتجر"],
    ["cards", "cards", "Cards", "البطاقات"],
    ["battle", "sword", "Battle", "قتال"],
    ["events", "events", "Events", "فعاليات"],
    ["profile", "profile", "Profile", "الملف"],
  ];
  for (const [id, ic, en, ar] of TABS) {
    const b = document.createElement("button");
    b.className = "home-tab" + (id === homeTab ? " active" : "");
    b.innerHTML = `${icon(ic)}<span>${tr(en, ar)}</span>`;
    b.setAttribute("aria-current", id === homeTab ? "page" : "false");
    b.addEventListener("click", () => {
      homeTab = id;
      buildHome(ctx);
    });
    tabs.appendChild(b);
  }
  shell.appendChild(tabs);

  buildHomeBoards(ctx, { questHost, achHost });
}

/** Chest slots under the Battle button (tap to open the chest room). */
function chestRow(ctx: AppCtx): HTMLElement {
  const { tr } = ctx;
  const row = document.createElement("div");
  row.className = "home-chests";
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const slot = ctx.meta.profile.chests[i] ?? null;
    const cell = document.createElement("button");
    cell.className = "home-chest" + (slot ? ` ${slot.rarity}` : " empty");
    if (!slot) {
      cell.innerHTML = `<span class="home-chest-label">${tr("Empty", "فارغ")}</span>`;
    } else {
      const left = slot.readyAt - now;
      const label =
        left <= 0
          ? tr("Open!", "افتح!")
          : left < 3_600_000
            ? `${Math.ceil(left / 60000)}m`
            : `${Math.ceil(left / 3_600_000)}h`;
      cell.innerHTML = `${icon("chest")}<span class="home-chest-label">${label}</span>`;
      if (left <= 0) cell.classList.add("ready");
    }
    cell.addEventListener("click", () => ctx.openChests());
    row.appendChild(cell);
  }
  return row;
}

/** Daily quests and achievements, rendered into the tab that shows them. */
export function buildHomeBoards(ctx: AppCtx, hosts: { questHost: HTMLElement; achHost: HTMLElement }): void {
  const { questHost, achHost } = hosts;
  const { meta, tr } = ctx;

  // Daily quest board: three goals, gold on claim, fresh every day.
  const today = dateKey(new Date());
  if (meta.quests.date !== today) {
    meta.quests = loadQuests(today);
    saveQuests(meta.quests);
  }
  const quests = meta.quests;
  const board = document.createElement("div");
  board.className = "quest-board";
  const qTitle = document.createElement("div");
  qTitle.className = "quest-title";
  qTitle.innerHTML = `${icon("book")} ${tr("Daily Quests", "مهام اليوم")}`;
  board.appendChild(qTitle);
  for (const id of quests.active) {
    const def = questDef(id);
    if (!def) continue;
    const row = document.createElement("div");
    row.className = "quest-row";
    const label = document.createElement("div");
    label.className = "quest-label";
    label.textContent = tr(def.en, def.ar);
    row.appendChild(label);
    const done = isComplete(quests, id);
    const claimed = quests.claimed.includes(id);
    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("div");
    fill.className = "quest-fill";
    fill.style.width = `${Math.round(Math.min(1, (quests.progress[id] ?? 0) / def.target) * 100)}%`;
    bar.appendChild(fill);
    const count = document.createElement("span");
    count.className = "quest-count";
    count.textContent = `${Math.min(def.target, Math.round(quests.progress[id] ?? 0))}/${def.target}`;
    bar.appendChild(count);
    row.appendChild(bar);
    const btn = document.createElement("button");
    btn.className = "quest-claim";
    if (claimed) {
      btn.textContent = "✓";
      btn.disabled = true;
    } else if (done) {
      btn.innerHTML = `${icon("coin")} ${def.reward}`;
      btn.addEventListener("click", () => {
        const res = claimQuest(meta.quests, id);
        if (!res) return;
        meta.quests = res.state;
        saveQuests(meta.quests);
        meta.profile = { ...meta.profile, gold: meta.profile.gold + res.reward };
        ctx.persistProfile();
        buildHome(ctx); // refresh board + currency
      });
    } else {
      btn.innerHTML = `${icon("coin")} ${def.reward}`;
      btn.disabled = true;
    }
    row.appendChild(btn);
    board.appendChild(row);
  }
  questHost.appendChild(board);

  // Achievements board: lifetime goals under the daily quests, with the
  // current season's badge in the title row.
  const achievements = meta.achievements;
  const aBoard = document.createElement("div");
  aBoard.className = "quest-board ach-board";
  const aTitle = document.createElement("div");
  aTitle.className = "quest-title";
  aTitle.innerHTML = `${icon("star")} ${tr("Achievements", "الإنجازات")}`;
  const seasonChip = document.createElement("span");
  seasonChip.className = "season-chip";
  seasonChip.textContent = tr(
    `Season ${meta.season.key} · best 🏆 ${Math.max(meta.season.best, meta.profile.trophies)}`,
    `موسم ${meta.season.key} · أفضل 🏆 ${Math.max(meta.season.best, meta.profile.trophies)}`,
  );
  aTitle.appendChild(seasonChip);
  aBoard.appendChild(aTitle);
  // Unclaimed-first, then in-progress by closeness, claimed last.
  const sorted = [...ACHIEVEMENTS].sort((a, b) => {
    const rank = (d: (typeof ACHIEVEMENTS)[number]): number =>
      achievements.claimed.includes(d.id) ? 2 : isEarned(achievements, d) ? 0 : 1;
    return rank(a) - rank(b) ||
      achievementProgress(achievements, b) / b.target -
      achievementProgress(achievements, a) / a.target;
  });
  for (const def of sorted) {
    const row = document.createElement("div");
    row.className = "quest-row";
    const label = document.createElement("div");
    label.className = "quest-label";
    label.textContent = tr(def.en, def.ar);
    row.appendChild(label);
    const progress = achievementProgress(achievements, def);
    const earned = isEarned(achievements, def);
    const claimed = achievements.claimed.includes(def.id);
    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("div");
    fill.className = "quest-fill";
    fill.style.width = `${Math.round((progress / def.target) * 100)}%`;
    bar.appendChild(fill);
    const count = document.createElement("span");
    count.className = "quest-count";
    count.textContent = `${Math.round(progress)}/${def.target}`;
    bar.appendChild(count);
    row.appendChild(bar);
    const btn = document.createElement("button");
    btn.className = "quest-claim";
    if (claimed) {
      btn.textContent = "✓";
      btn.disabled = true;
    } else if (earned) {
      btn.innerHTML = `${icon("coin")} ${def.reward}`;
      btn.addEventListener("click", () => {
        const res = claimAchievement(meta.achievements, def.id);
        if (!res) return;
        meta.achievements = res.state;
        saveAchievements(meta.achievements);
        meta.profile = { ...meta.profile, gold: meta.profile.gold + res.reward };
        ctx.persistProfile();
        buildHome(ctx); // refresh board + currency
      });
    } else {
      btn.innerHTML = `${icon("coin")} ${def.reward}`;
      btn.disabled = true;
    }
    row.appendChild(btn);
    aBoard.appendChild(row);
  }
  achHost.appendChild(aBoard);
}
