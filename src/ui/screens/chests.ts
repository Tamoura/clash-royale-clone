/**
 * Chest room: the free 4-hour chest and the four chest slots with live
 * timers and gem skips. Every opening (slot, free chest, or a bonus chest
 * from the Trophy Road, the Crown Pass or a Draft run) goes through
 * openChestFlow, which pays the chest and plays the card-by-card reveal.
 * The tiles are reused by the Home slots (Shop and Battle tabs).
 */
import "../styles/rewards.css";
import type { AppCtx } from "../../app/ctx";
import { recordChest as recordChestAch, saveAchievements } from "../../meta/achievements";
import {
  claimFreeChest,
  ensureFirstChestCard,
  freeChestReadyAt,
  isChestReady,
  type ChestRarity,
  type ChestRewards,
  type ChestSlot,
} from "../../meta/chests";
import { CHEST_SKIP_GEMS } from "../../meta/economy";
import { tryOpenChest } from "../../meta/progress";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { confirm, screenHeader, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { reducedMotion } from "../prefs";
import { chestArt, chestLabel, playChestReveal, rewardSound } from "./chestReveal";

// ---- Formatting -------------------------------------------------------------

/** Time left as "2h 05m" / "4m 09s" / "12s" (Arabic units in the Islamic edition). */
export function fmtRemain(ms: number, tr: AppCtx["tr"]): string {
  if (ms <= 0) return tr("Ready!", "جاهز!");
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  if (h > 0) return tr(`${h}h ${pad(m)}m`, `${fmtNum(h)} س ${fmtNum(m)} د`);
  if (m > 0) return tr(`${m}m ${pad(sec)}s`, `${fmtNum(m)} د ${fmtNum(sec)} ث`);
  return tr(`${sec}s`, `${fmtNum(sec)} ث`);
}

function currencyChips(ctx: AppCtx): HTMLElement {
  const chips = document.createElement("div");
  chips.className = "rw-chips";
  chips.innerHTML =
    `<span class="rw-pill">${icon("coin")}<b>${fmtNum(ctx.meta.profile.gold)}</b></span>` +
    `<span class="rw-pill">${icon("gem")}<b>${fmtNum(ctx.meta.profile.gems)}</b></span>`;
  return chips;
}

// ---- Opening ----------------------------------------------------------------

export type ChestSource =
  | { kind: "slot"; index: number; skipWithGems?: boolean }
  /** A chest paid out on the spot (free chest, road, pass, draft run). */
  | { kind: "bonus"; rarity: ChestRarity };

/**
 * Pay a chest into the profile (counting it for achievements, with the
 * first-ever chest's guaranteed new card) without any UI. Returns the
 * rewards, or the reason it could not open ('locked', 'gems', 'empty').
 */
export function payChest(
  ctx: AppCtx,
  source: ChestSource,
): { ok: true; rarity: ChestRarity; rewards: ChestRewards } | { ok: false; reason: string } {
  const { meta } = ctx;
  const base = { ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels };
  // A bonus chest opens through the same path as a slot: a virtual slot
  // after the real four, dropped again once it is paid.
  const bonus: ChestSlot | null = source.kind === "bonus" ? { rarity: source.rarity, readyAt: 0 } : null;
  const chests = bonus ? [...base.chests, bonus] : base.chests;
  const index = bonus ? chests.length - 1 : source.kind === "slot" ? source.index : -1;
  const slot = chests[index];
  if (!slot) return { ok: false, reason: "empty" };
  const res = tryOpenChest({ ...base, chests }, index, Date.now(), undefined, {
    skipWithGems: source.kind === "slot" && !!source.skipWithGems,
  });
  if (!res.ok || !res.rewards) return { ok: false, reason: res.reason ?? "empty" };
  const first = ensureFirstChestCard(res.profile, res.rewards, meta.achievements.counters.chests);
  const profile = bonus ? { ...first.profile, chests: base.chests.slice() } : first.profile;
  meta.profile = profile;
  meta.cardLevels = profile.levels;
  meta.playerDeck = profile.deck;
  ctx.persistProfile();
  meta.achievements = recordChestAch(meta.achievements);
  saveAchievements(meta.achievements);
  return { ok: true, rarity: slot.rarity, rewards: first.rewards };
}

/**
 * Open a chest and play its reveal. Resolves true once the player has
 * collected it; false (after a toast) when it could not open.
 */
export async function openChestFlow(ctx: AppCtx, source: ChestSource, title?: string): Promise<boolean> {
  const { tr } = ctx;
  const paid = payChest(ctx, source);
  if (!paid.ok) {
    toast(
      paid.reason === "gems"
        ? tr("Not enough gems", "لا تكفي الجواهر")
        : paid.reason === "locked"
          ? tr("Still locked", "ما زال مقفلًا")
          : tr("Nothing to open", "لا شيء لفتحه"),
      "danger",
    );
    return false;
  }
  await playChestReveal(ctx, { rarity: paid.rarity, rewards: paid.rewards, title });
  if (paid.rewards.newCard) {
    toast(`${tr("New:", "جديد:")} ${cardDisplayName(paid.rewards.newCard)}`, "success");
  }
  return true;
}

/** Add gold and gems to the profile and save. */
export function grantCurrency(ctx: AppCtx, gold = 0, gems = 0): void {
  const { meta } = ctx;
  meta.profile = {
    ...meta.profile,
    gold: meta.profile.gold + Math.max(0, Math.floor(gold)),
    gems: meta.profile.gems + Math.max(0, Math.floor(gems)),
  };
  ctx.persistProfile();
}

/** Ask before spending gems, then open a locked slot early. */
export async function skipChestFlow(ctx: AppCtx, index: number): Promise<boolean> {
  const { tr, meta } = ctx;
  if (meta.profile.gems < CHEST_SKIP_GEMS) {
    toast(tr("Not enough gems", "لا تكفي الجواهر"), "danger");
    return false;
  }
  const ok = await confirm({
    title: tr("Open now?", "افتحه الآن؟"),
    body: tr(
      `Skip the timer for ${CHEST_SKIP_GEMS} gems? You have ${meta.profile.gems}.`,
      `تخطَّ المؤقت مقابل ${fmtNum(CHEST_SKIP_GEMS)} جوهرة؟ لديك ${fmtNum(meta.profile.gems)}.`,
    ),
    okLabel: tr(`Open (${CHEST_SKIP_GEMS} gems)`, `افتح (${fmtNum(CHEST_SKIP_GEMS)} جوهرة)`),
    cancelLabel: tr("Wait", "انتظر"),
  });
  if (!ok) return false;
  return openChestFlow(ctx, { kind: "slot", index, skipWithGems: true });
}

/** Claim the free 4-hour chest and reveal it. */
export async function freeChestFlow(ctx: AppCtx): Promise<boolean> {
  const { tr } = ctx;
  const now = Date.now();
  if (now < freeChestReadyAt()) {
    toast(tr("Still locked", "ما زال مقفلًا"), "danger");
    return false;
  }
  claimFreeChest(now);
  return openChestFlow(ctx, { kind: "bonus", rarity: "free" }, tr("Free Chest", "الصندوق المجاني"));
}

// ---- Live timers --------------------------------------------------------------

/** Re-run fn every second while el is on screen. */
function everySecond(el: HTMLElement, fn: () => void): void {
  const id = window.setInterval(() => {
    if (!el.isConnected) {
      window.clearInterval(id);
      return;
    }
    fn();
  }, 1000);
}

// ---- Tiles (also used by the Home slots) ------------------------------------------

/**
 * The free-chest tile: claimable now, or counting down to the next one.
 * `compact` is the small Battle-tab version. `after` runs once a chest was
 * collected (to refresh the host screen).
 */
export function freeChestTile(ctx: AppCtx, after: () => void, compact = false): HTMLElement {
  const { tr } = ctx;
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "rw-free" + (compact ? " rw-free--compact" : "");
  tile.appendChild(chestArt("free", "rw-chest--mini"));
  const text = document.createElement("span");
  text.className = "rw-free__text";
  const name = document.createElement("b");
  name.textContent = tr("Free Chest", "صندوق مجاني");
  const status = document.createElement("span");
  status.className = "rw-free__status";
  text.append(name, status);
  tile.appendChild(text);
  const render = (): void => {
    const left = freeChestReadyAt() - Date.now();
    const ready = left <= 0;
    tile.classList.toggle("is-ready", ready);
    status.textContent = ready
      ? tr("Ready! Tap to open", "جاهز! اضغط للفتح")
      : `${tr("Next in", "التالي بعد")} ${fmtRemain(left, tr)}`;
    tile.setAttribute(
      "aria-label",
      ready ? tr("Open the free chest", "افتح الصندوق المجاني") : `${tr("Free Chest", "صندوق مجاني")}: ${status.textContent}`,
    );
  };
  render();
  everySecond(tile, render);
  tile.addEventListener("click", () => {
    if (freeChestReadyAt() > Date.now()) {
      rewardSound(ctx).sting?.();
      toast(`${tr("Free Chest", "صندوق مجاني")}: ${status.textContent}`);
      return;
    }
    tile.disabled = true;
    void freeChestFlow(ctx).then((done) => {
      tile.disabled = false;
      if (done) after();
    });
  });
  return tile;
}

/** One chest slot card: art, rarity, live timer and its Open / gem-skip button. */
function slotCard(ctx: AppCtx, index: number, after: () => void, compact: boolean): HTMLElement {
  const { tr } = ctx;
  const slot = ctx.meta.profile.chests[index] ?? null;
  const cell = document.createElement("div");
  cell.className = "rw-slot" + (compact ? " rw-slot--compact" : "");
  if (!slot) {
    cell.classList.add("is-empty");
    const hole = document.createElement("div");
    hole.className = "rw-slot__hole";
    hole.innerHTML = icon("chest");
    const label = document.createElement("span");
    label.className = "rw-slot__label";
    label.textContent = compact ? tr("Empty", "فارغ") : tr("Win a battle to fill", "انتصر لتملأها");
    cell.append(hole, label);
    return cell;
  }
  cell.classList.add(`rw-slot--${slot.rarity}`);
  const art = chestArt(slot.rarity, "rw-chest--slot");
  const name = document.createElement("span");
  name.className = "rw-slot__label";
  name.textContent = slot.rarity === "rare" ? tr("Rare", "نادر") : tr("Wooden", "خشبي");
  const timer = document.createElement("span");
  timer.className = "rw-slot__timer";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rw-slot__btn";
  cell.append(art, name, timer, btn);
  const render = (): void => {
    const now = Date.now();
    const ready = isChestReady(slot, now);
    cell.classList.toggle("is-ready", ready);
    timer.textContent = fmtRemain(slot.readyAt - now, tr);
    btn.innerHTML = ready
      ? `<span>${tr("Open", "افتح")}</span>`
      : compact
        ? `${icon("gem")}<span>${fmtNum(CHEST_SKIP_GEMS)}</span>`
        : `${icon("gem")}<span>${tr(`Open (${CHEST_SKIP_GEMS} gems)`, `افتح (${fmtNum(CHEST_SKIP_GEMS)} جوهرة)`)}</span>`;
    btn.classList.toggle("is-skip", !ready);
    btn.setAttribute(
      "aria-label",
      ready
        ? `${tr("Open", "افتح")} ${chestLabel(slot.rarity, tr)}`
        : `${chestLabel(slot.rarity, tr)}: ${timer.textContent}. ${tr(`Open now for ${CHEST_SKIP_GEMS} gems`, `افتحه الآن مقابل ${fmtNum(CHEST_SKIP_GEMS)} جوهرة`)}`,
    );
  };
  render();
  everySecond(cell, render);
  btn.addEventListener("click", () => {
    btn.disabled = true;
    const ready = isChestReady(slot, Date.now());
    const flow = ready ? openChestFlow(ctx, { kind: "slot", index }) : skipChestFlow(ctx, index);
    void flow.then((done) => {
      btn.disabled = false;
      if (done) after();
    });
  });
  return cell;
}

/** The four chest slots (2x2 in the room, a row of 4 when compact). */
export function chestSlotsGrid(ctx: AppCtx, after: () => void, compact = false): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "rw-slots" + (compact ? " rw-slots--compact" : "");
  for (let i = 0; i < 4; i++) grid.appendChild(slotCard(ctx, i, after, compact));
  return grid;
}

// ---- The chest room -------------------------------------------------------------

export function openChests(ctx: AppCtx): void {
  buildChests(ctx);
  ctx.showPicker("chests");
}

function buildChests(ctx: AppCtx): void {
  const { pickerRoot, tr } = ctx;
  pickerRoot.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "rw-screen" + (reducedMotion() ? " is-calm" : "");
  if (ARABIC) screen.dir = "rtl";
  pickerRoot.appendChild(screen);

  screen.appendChild(
    screenHeader({
      title: tr("Chests", "الصناديق"),
      onBack: () => ctx.openHome(),
      backLabel: tr("Back", "رجوع"),
      trailing: currencyChips(ctx),
    }),
  );
  const refresh = (): void => {
    if (pickerRoot.contains(screen)) buildChests(ctx);
  };
  screen.appendChild(freeChestTile(ctx, refresh));

  const head = document.createElement("h3");
  head.className = "rw-section";
  head.textContent = tr("Chest slots", "خانات الصناديق");
  screen.appendChild(head);
  screen.appendChild(chestSlotsGrid(ctx, refresh));

  const note = document.createElement("p");
  note.className = "rw-note";
  note.textContent = tr(
    `Win battles to fill your slots. Can't wait? Open a chest early for ${CHEST_SKIP_GEMS} gems.`,
    `انتصر في المعارك لتملأ خاناتك. لا تستطيع الانتظار؟ افتح صندوقًا مبكرًا مقابل ${fmtNum(CHEST_SKIP_GEMS)} جوهرة.`,
  );
  screen.appendChild(note);
}
