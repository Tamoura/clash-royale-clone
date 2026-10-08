/**
 * Home: the edition gate on first visit, then the home shell — resource
 * bar, a window onto the live arena (full diorama on the Battle tab, a
 * 72px strip elsewhere), the tab panel and the bottom tab bar.
 *
 * Tabs:
 * - Battle: one tap on Battle starts a bot match with the saved deck and
 *   setup; the chip row under it opens Battle Setup. Chests and daily
 *   quests sit between the 'battle-top' and 'battle-bottom' slots.
 * - Cards: the deck, the Champion Studio entry, then the collection.
 * - Shop: shard crafting, the chest room and the 'shop' slot.
 * - Events: Challenges, Daily, Draft and the last-battle replay.
 * - Profile: identity, record, achievements and Settings.
 */
import type { AppCtx } from "../../app/ctx";
import { on } from "../../app/hooks";
import { renderHomeSlots, type HomeSlot } from "../../app/slots";
import { getCard, type CardId } from "../../game/cards";
import { hasSavedChampion } from "../../game/customcard";
import { dateKey } from "../../game/daily";
import { trophyProgress } from "../../meta/arenas";
import { addShards } from "../../meta/collection";
import { SHARD_GOLD_PRICE, spendGold, upgradeCost } from "../../meta/economy";
import { isOwnedDeck, ownedSet } from "../../meta/progress";
import { claimQuest, isComplete, loadQuests, questDef, saveQuests } from "../../meta/quests";
import { type Feature } from "../../meta/unlocks";
import { isDailyDone } from "../../match/rewards";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC, EDITION_CHOSEN } from "../../render3d/theme";
import { button, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon, type IconName } from "../icons";
import { reducedMotion } from "../prefs";
import { enforceUnlocks, setupChipRow } from "./battleSetup";
import { CONFIRM_GOLD, cardProgress, openCardInfo } from "./cardInfo";
import { buildCollectionGroups, cardTile } from "./collection";
import { cardTileCanvas } from "./common";
import { buildEditionGate } from "./editionGate";
import {
  applyDir,
  applyMotion,
  ask,
  buildTabBar,
  buildTopBar,
  claimButton,
  getHomeTab,
  goalRow,
  isFeatureNew,
  isUnlocked,
  lockBadge,
  markFeaturesSeen,
  newBadge,
  refreshTopBars,
  section,
  setHomeTab,
  sfx,
  tabIndex,
  toastNewUnlocks,
  type ClaimState,
  type HomeTab,
} from "./frame";
import { buildProfileTab } from "./profile";

// Cleanups returned by home-slot providers (and tab timers); run when the
// tab is redrawn, the home is rebuilt, or another screen opens.
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

export function buildHome(ctx: AppCtx): void {
  const { pickerRoot } = ctx;
  cleanupSlots();
  pickerRoot.innerHTML = "";
  if (EDITION_CHOSEN && ctx.variant) {
    buildHomeShell(ctx);
    return;
  }
  // Edition gate: nothing else is reachable until an edition is picked.
  buildEditionGate(ctx);
}

/** Window height on the Battle tab, as a fraction of the viewport. */
const WINDOW_VH = 0.38;

/** The home shell; the active tab persists while the app runs. */
export function buildHomeShell(ctx: AppCtx): void {
  const { pickerRoot, scene, stage } = ctx;
  applyDir(pickerRoot);
  enforceUnlocks(ctx);

  const shell = document.createElement("div");
  shell.className = "home-shell v2-home";
  applyDir(shell);
  applyMotion(shell);
  pickerRoot.appendChild(shell);

  // Stage the diorama: your arena, swaying behind the window.
  scene.setArenaLook(ctx.battleArenaId());
  scene.setShowcase(true, 0.5);

  const goTab = (t: HomeTab): void => {
    if (t === getHomeTab()) {
      panel.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
      return;
    }
    sfx(ctx, "uiTap");
    const from = tabIndex(getHomeTab());
    setHomeTab(t);
    drawTab(from);
  };

  shell.appendChild(buildTopBar(ctx, goTab));
  const win = document.createElement("div");
  win.className = "home-window v2-window";
  shell.appendChild(win);
  const panel = document.createElement("div");
  panel.className = "home-panel v2-panel";
  shell.appendChild(panel);
  const tabs = buildTabBar(ctx, getHomeTab(), goTab);
  shell.appendChild(tabs);

  /** Redraw the current tab; `from` (a tab index) slides it in. */
  function drawTab(from: number | null = null): void {
    cleanupSlots();
    const tab = getHomeTab();
    tabs.querySelectorAll<HTMLElement>(".home-tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    shell.dataset.tab = tab;
    drawWindow(ctx, win, tab === "battle");
    const keep = from === null ? panel.scrollTop : 0;
    panel.innerHTML = "";
    const redraw = (): void => drawTab(null);
    if (tab === "battle") battleTab(ctx, panel, redraw);
    else if (tab === "cards") cardsTab(ctx, panel, redraw);
    else if (tab === "shop") shopTab(ctx, panel, redraw);
    else if (tab === "events") eventsTab(ctx, panel);
    else buildProfileTab(ctx, panel, (host) => fillSlot("profile", host), redraw);
    panel.scrollTop = keep;
    const to = tabIndex(tab);
    if (from !== null && from !== to && !reducedMotion()) {
      // Slide in from the side of the tab we came from (mirrored in RTL).
      const dir = Math.sign(to - from) * (ARABIC ? -1 : 1);
      panel.animate(
        [
          { transform: `translateX(${dir * 32}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }
  drawTab(null);

  // Fit the diorama to the Battle-tab window once the shell is laid out;
  // the strip on other tabs keeps the same framing (no camera jump).
  requestAnimationFrame(() => {
    const h = stage.clientHeight || 1;
    const top = win.getBoundingClientRect().top;
    const banner = win.querySelector<HTMLElement>(".v2-arena")?.offsetHeight ?? 96;
    const bottom = top + window.innerHeight * WINDOW_VH - banner - 8;
    if (bottom > 0) scene.setShowcase(true, Math.min(0.9, Math.max(0.3, bottom / h)));
  });

  toastNewUnlocks(ctx);
}

// ---- Arena window -----------------------------------------------------------------

function drawWindow(ctx: AppCtx, win: HTMLElement, full: boolean): void {
  const { tr, meta } = ctx;
  win.classList.toggle("is-strip", !full);
  win.innerHTML = "";
  const prog = trophyProgress(meta.profile.trophies);
  const banner = document.createElement("div");
  banner.className = "home-arena-banner v2-arena";
  const name = document.createElement("div");
  name.className = "home-arena-name";
  name.textContent = tr(prog.current.name, prog.current.ar);
  banner.appendChild(name);
  const road = document.createElement("div");
  road.className = "home-road v2-road";
  road.setAttribute("role", "progressbar");
  road.setAttribute("aria-valuemin", "0");
  road.setAttribute("aria-valuemax", "100");
  road.setAttribute("aria-valuenow", String(Math.round(prog.ratio * 100)));
  road.innerHTML =
    `<div class="home-road-fill" style="inline-size:${Math.round(prog.ratio * 100)}%"></div>` +
    `<span>${icon("trophy")} ${fmtNum(meta.profile.trophies)}${prog.next ? ` / ${fmtNum(prog.next.trophies)}` : ""}</span>`;
  banner.appendChild(road);
  if (full && prog.next) {
    const next = document.createElement("div");
    next.className = "home-arena-next";
    next.textContent = `${tr("Next", "التالي")}: ${tr(prog.next.name, prog.next.ar)}`;
    banner.appendChild(next);
  }
  win.appendChild(banner);
}

// ---- Battle tab ---------------------------------------------------------------------

/** One tap: the saved deck and setup straight into a bot match. */
function startBattle(ctx: AppCtx): void {
  const { meta } = ctx;
  if (!isOwnedDeck(meta.playerDeck, ownedSet(meta.profile.owned))) {
    // The saved deck is not playable (e.g. a card was deleted): fix it first.
    ctx.openDeckPicker({ mode: "battle" });
    return;
  }
  enforceUnlocks(ctx);
  sfx(ctx, "uiTap");
  ctx.closeDeckPicker();
  ctx.startLadder();
}

function battleTab(ctx: AppCtx, panel: HTMLElement, redraw: () => void): void {
  const { tr } = ctx;
  const go = document.createElement("button");
  go.type = "button";
  go.className = "battle-btn home-battle";
  go.setAttribute("aria-label", "Start a battle against the bot");
  go.innerHTML = `${icon("sword")}<span>${tr("Battle", "قتال")}</span>`;
  go.addEventListener("click", () => startBattle(ctx));
  panel.appendChild(go);
  panel.appendChild(setupChipRow(ctx, redraw));

  fillSlot("battle-top", panel);
  panel.appendChild(chestRow(ctx));
  panel.appendChild(questBoard(ctx, redraw));
  fillSlot("battle-bottom", panel);
}

/** Chest slots under the Battle button (tap to open the chest room). */
function chestRow(ctx: AppCtx): HTMLElement {
  const { tr } = ctx;
  const row = document.createElement("div");
  row.className = "home-chests v2-chests";
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const slot = ctx.meta.profile.chests[i] ?? null;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "home-chest" + (slot ? ` ${slot.rarity}` : " empty");
    if (!slot) {
      cell.innerHTML = `<span class="home-chest-label">${tr("Empty", "فارغ")}</span>`;
      cell.setAttribute("aria-label", tr("Empty chest slot", "خانة صندوق فارغة"));
    } else {
      const left = slot.readyAt - now;
      const label =
        left <= 0
          ? tr("Open!", "افتح!")
          : left < 3_600_000
            ? tr(`${fmtNum(Math.ceil(left / 60000))}m`, `${fmtNum(Math.ceil(left / 60000))} د`)
            : tr(`${fmtNum(Math.ceil(left / 3_600_000))}h`, `${fmtNum(Math.ceil(left / 3_600_000))} س`);
      cell.innerHTML = `${icon("chest")}<span class="home-chest-label">${label}</span>`;
      cell.setAttribute("aria-label", left <= 0 ? tr("Chest ready to open", "صندوق جاهز للفتح") : tr(`Chest: ${label}`, `صندوق: ${label}`));
      if (left <= 0) cell.classList.add("ready");
    }
    cell.addEventListener("click", () => {
      sfx(ctx, "uiTap");
      ctx.openChests();
    });
    row.appendChild(cell);
  }
  return row;
}

/** Daily quest board: three goals, gold on claim, fresh every day. */
function questBoard(ctx: AppCtx, redraw: () => void): HTMLElement {
  const { meta, tr } = ctx;
  const today = dateKey(new Date());
  if (meta.quests.date !== today) {
    meta.quests = loadQuests(today);
    saveQuests(meta.quests);
  }
  const quests = meta.quests;
  const s = section(tr("Daily quests", "مهام اليوم"));
  s.el.classList.add("v2-board", "quest-board");
  for (const id of quests.active) {
    const def = questDef(id);
    if (!def) continue;
    const state: ClaimState = quests.claimed.includes(id) ? "claimed" : isComplete(quests, id) ? "claimable" : "locked";
    const btn = claimButton(ctx, state, def.reward, () => {
      const res = claimQuest(meta.quests, id);
      if (!res) return;
      meta.quests = res.state;
      saveQuests(meta.quests);
      meta.profile = { ...meta.profile, gold: meta.profile.gold + res.reward };
      ctx.persistProfile();
      refreshTopBars(ctx);
      toast(tr(`+${fmtNum(res.reward)} gold`, `+${fmtNum(res.reward)} ذهب`), "success");
      redraw();
    });
    s.el.appendChild(goalRow(tr(def.en, def.ar), quests.progress[id] ?? 0, def.target, btn));
  }
  return s.el;
}

// ---- Cards tab ------------------------------------------------------------------------

function cardsTab(ctx: AppCtx, panel: HTMLElement, redraw: () => void): void {
  const { tr, meta } = ctx;
  const deck = meta.playerDeck;
  const costs = deck.map((id) => getCard(id).cost);
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

  const tools = document.createElement("div");
  tools.className = "v2-deck-tools";
  const avgChip = document.createElement("span");
  avgChip.className = "v2-avg";
  avgChip.innerHTML = icon("elixir");
  const avgText = document.createElement("span");
  avgText.textContent = tr(`Average ${fmtNum(Number(avg.toFixed(1)))}`, `المعدل ${fmtNum(Number(avg.toFixed(1)))}`);
  avgChip.appendChild(avgText);
  tools.appendChild(avgChip);
  tools.appendChild(
    button({ variant: "primary", icon: "pencil", label: tr("Edit", "تعديل"), onClick: () => ctx.openDeckPicker({ mode: "deck" }) }),
  );
  const d = section(tr("Battle deck", "المجموعة القتالية"), tools);
  d.el.classList.add("v2-deck");
  const grid = document.createElement("div");
  grid.className = "v2-grid v2-grid--deck";
  for (let i = 0; i < 8; i++) {
    const id = deck[i];
    if (id) grid.appendChild(cardTile(ctx, id, () => openCardInfo(ctx, id, { onChange: redraw })));
    else {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "v2-tile is-empty";
      empty.setAttribute("aria-label", tr("Empty deck slot", "خانة فارغة في المجموعة"));
      empty.addEventListener("click", () => ctx.openDeckPicker({ mode: "deck" }));
      grid.appendChild(empty);
    }
  }
  d.el.appendChild(grid);
  panel.appendChild(d.el);

  // Champion Studio entry
  const studio = document.createElement("button");
  studio.type = "button";
  studio.className = "v2-feature-card v2-feature-card--studio";
  studio.innerHTML = `<span class="v2-feature-icon">${icon("hammer")}</span><span class="v2-feature-text"><b></b><small></small></span>${icon("back", "v2-chev")}`;
  studio.querySelector("b")!.textContent = tr("Champion Studio", "ورشة البطل");
  studio.querySelector("small")!.textContent = hasSavedChampion()
    ? tr("Edit your own champion card", "عدّل بطاقة بطلك")
    : tr("Design your own champion card", "صمّم بطاقة بطلك الخاصة");
  studio.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    ctx.openStudio();
  });
  panel.appendChild(studio);

  buildCollectionGroups(ctx, panel, redraw);
}

// ---- Shop tab -------------------------------------------------------------------------

interface CraftOffer {
  id: CardId;
  missing: number;
  price: number;
}

/** Owned cards short of shards for their next level, deck cards first. */
function craftOffers(ctx: AppCtx): CraftOffer[] {
  const { meta } = ctx;
  const out: CraftOffer[] = [];
  for (const id of meta.profile.owned) {
    const lvl = meta.cardLevels[id] ?? 1;
    const cost = upgradeCost(getCard(id).rarity, lvl);
    if (!cost) continue;
    const missing = cost.shards - (meta.profile.shards[id] ?? 0);
    if (missing > 0) out.push({ id, missing, price: missing * SHARD_GOLD_PRICE });
  }
  const inDeck = (id: CardId): number => (meta.playerDeck.includes(id) ? 0 : 1);
  return out.sort((a, b) => inDeck(a.id) - inDeck(b.id) || a.price - b.price).slice(0, 6);
}

function shopTab(ctx: AppCtx, panel: HTMLElement, redraw: () => void): void {
  const { tr, meta } = ctx;
  const s = section(tr("Shard workshop", "ورشة الشظايا"));
  s.el.classList.add("v2-shop");
  const hint = document.createElement("p");
  hint.className = "v2-hint";
  hint.textContent = tr(
    `Short on shards? Craft them for ${SHARD_GOLD_PRICE} gold each.`,
    `تنقصك شظايا؟ اصنعها مقابل ${fmtNum(SHARD_GOLD_PRICE)} ذهب لكل واحدة.`,
  );
  s.el.appendChild(hint);
  const offers = craftOffers(ctx);
  if (offers.length === 0) {
    const none = document.createElement("p");
    none.className = "v2-empty";
    none.textContent = tr("Every card has the shards it needs.", "كل بطاقاتك لديها ما تحتاجه من شظايا.");
    s.el.appendChild(none);
  }
  for (const o of offers) {
    const row = document.createElement("div");
    row.className = "v2-offer";
    const art = document.createElement("button");
    art.type = "button";
    art.className = `v2-tile v2-tile--mini rarity-${getCard(o.id).rarity}`;
    art.appendChild(cardTileCanvas(o.id));
    art.setAttribute("aria-label", tr(`${cardDisplayName(o.id)} card info`, `معلومات ${cardDisplayName(o.id)}`));
    art.addEventListener("click", () => openCardInfo(ctx, o.id, { onChange: redraw }));
    row.appendChild(art);
    const text = document.createElement("div");
    text.className = "v2-offer-text";
    const b = document.createElement("b");
    b.textContent = cardDisplayName(o.id);
    const small = document.createElement("small");
    const p = cardProgress(ctx, o.id);
    small.textContent = tr(
      `+${fmtNum(o.missing)} shards to reach level ${fmtNum(p.level + 1)}`,
      `+${fmtNum(o.missing)} شظايا للوصول إلى المستوى ${fmtNum(p.level + 1)}`,
    );
    text.append(b, small);
    row.appendChild(text);
    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "v2-buy";
    buy.innerHTML = `${icon("coin")}<span>${fmtNum(o.price)}</span>`;
    buy.setAttribute("aria-label", tr(`Craft ${o.missing} shards for ${o.price} gold`, `اصنع ${o.missing} شظايا مقابل ${o.price} ذهب`));
    buy.disabled = meta.profile.gold < o.price;
    buy.addEventListener("click", async () => {
      if (o.price >= CONFIRM_GOLD) {
        const ok = await ask({
          title: tr("Craft shards?", "صنع الشظايا؟"),
          body: tr(`Spend ${fmtNum(o.price)} gold on ${fmtNum(o.missing)} shards.`, `أنفق ${fmtNum(o.price)} ذهب على ${fmtNum(o.missing)} شظايا.`),
          okLabel: tr("Craft", "اصنع"),
          cancelLabel: tr("Not now", "ليس الآن"),
        });
        if (!ok) return;
      }
      const left = spendGold(meta.profile.gold, o.price);
      if (left === null) return;
      meta.profile = { ...meta.profile, gold: left, shards: addShards(meta.profile.shards, o.id, o.missing) };
      ctx.persistProfile();
      refreshTopBars(ctx);
      sfx(ctx, "claim");
      toast(tr(`${cardDisplayName(o.id)} can be upgraded`, `يمكن ترقية ${cardDisplayName(o.id)}`), "success");
      redraw();
    });
    row.appendChild(buy);
    s.el.appendChild(row);
  }
  panel.appendChild(s.el);

  const chests = document.createElement("button");
  chests.type = "button";
  chests.className = "v2-feature-card v2-feature-card--chests";
  chests.innerHTML = `<span class="v2-feature-icon">${icon("chest")}</span><span class="v2-feature-text"><b></b><small></small></span>${icon("back", "v2-chev")}`;
  chests.querySelector("b")!.textContent = tr("Chest room", "غرفة الصناديق");
  chests.querySelector("small")!.textContent = tr("Win ladder battles to earn chests", "انتصر في معارك السلّم لتربح الصناديق");
  chests.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    ctx.openChests();
  });
  panel.appendChild(chests);

  const slot = document.createElement("div");
  slot.className = "v2-slot";
  panel.appendChild(slot);
  fillSlot("shop", slot);
}

// ---- Events tab ------------------------------------------------------------------------

/**
 * Milliseconds until the daily battle's date key changes. Searches the key
 * function itself, so it follows whatever day boundary daily.ts uses.
 */
export function msUntilDailyReset(now: number, key: (d: Date) => string = dateKey): number {
  const today = key(new Date(now));
  let lo = now;
  let hi = now + 36 * 3_600_000;
  if (key(new Date(hi)) === today) return hi - now;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (key(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return hi - now;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => fmtNum(n).padStart(2, fmtNum(0));
  return `${fmtNum(h)}:${pad(m)}:${pad(s % 60)}`;
}

interface TileOpts {
  key: string;
  icon: IconName;
  title: string;
  sub: string;
  feature?: Feature;
  disabled?: boolean;
  onTap: () => void;
}

function eventTile(ctx: AppCtx, o: TileOpts): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `v2-event v2-event--${o.key}`;
  b.innerHTML = `<span class="v2-event-art">${icon(o.icon)}</span><span class="v2-event-text"><b></b><small></small></span>`;
  b.querySelector("b")!.textContent = o.title;
  const sub = b.querySelector("small")!;
  sub.textContent = o.sub;
  const locked = o.feature && !isUnlocked(ctx, o.feature) ? o.feature : null;
  if (locked) {
    b.classList.add("is-locked");
    b.disabled = true;
    b.appendChild(lockBadge(ctx, locked));
  } else if (o.disabled) {
    b.disabled = true;
    b.classList.add("is-disabled");
  } else if (o.feature && isFeatureNew(ctx, o.feature)) {
    b.appendChild(newBadge(ctx));
  }
  b.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    if (o.feature) markFeaturesSeen(ctx, [o.feature]);
    o.onTap();
  });
  return b;
}

function eventsTab(ctx: AppCtx, panel: HTMLElement): void {
  const { tr } = ctx;
  const grid = document.createElement("div");
  grid.className = "v2-events";
  grid.appendChild(
    eventTile(ctx, {
      key: "challenges",
      icon: "puzzle",
      title: tr("Challenges", "التحديات"),
      sub: tr("Puzzles with first-clear gold", "ألغاز بذهب لأول إنجاز"),
      feature: "challenges",
      onTap: () => ctx.openChallenges(),
    }),
  );
  const done = isDailyDone();
  const daily = eventTile(ctx, {
    key: "daily",
    icon: "calendar",
    title: tr("Daily battle", "المعركة اليومية"),
    sub: "",
    onTap: () => {
      ctx.closeDeckPicker();
      ctx.startDaily();
    },
  });
  const dailySub = daily.querySelector("small")!;
  const tick = (): void => {
    const left = clock(msUntilDailyReset(Date.now()));
    dailySub.textContent = done
      ? tr(`Done today. New in ${left}`, `أُنجزت اليوم. الجديدة بعد ${left}`)
      : tr(`+${fmtNum(100)} gold. Ends in ${left}`, `+${fmtNum(100)} ذهب. تنتهي بعد ${left}`);
  };
  tick();
  if (done) {
    daily.classList.add("is-done");
    daily.insertAdjacentHTML("beforeend", `<span class="v2-event-done">${icon("check")}</span>`);
  }
  const timer = window.setInterval(tick, 1000);
  slotCleanups.push(() => window.clearInterval(timer));
  grid.appendChild(daily);
  grid.appendChild(
    eventTile(ctx, {
      key: "draft",
      icon: "dice",
      title: tr("Draft", "الانتقاء"),
      sub: tr("Pick a deck card by card", "اختر مجموعتك بطاقة بطاقة"),
      feature: "draft",
      onTap: () => ctx.openDraft(),
    }),
  );
  const hasReplay = ctx.hasReplay();
  grid.appendChild(
    eventTile(ctx, {
      key: "replay",
      icon: "tv",
      title: tr("Last battle", "آخر معركة"),
      sub: hasReplay ? tr("Watch your last ladder match", "شاهد آخر مباراة سلّم") : tr("Play a ladder battle to record one", "العب معركة سلّم لتسجيلها"),
      disabled: !hasReplay,
      onTap: () => {
        ctx.closeDeckPicker();
        ctx.startReplay();
      },
    }),
  );
  panel.appendChild(grid);
  const slot = document.createElement("div");
  slot.className = "v2-slot";
  panel.appendChild(slot);
  fillSlot("events", slot);
}
