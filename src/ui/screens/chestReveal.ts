/**
 * The chest-opening moment: a full-screen sequence over everything (at
 * --z-modal). The chest drops in and shakes, bursts open in light, the gold
 * and gems count up, then each card flips (on tap, or by itself after
 * 700ms) with a rarity flash. A new card gets a NEW CARD! ribbon and an
 * "Add to deck" button; shards show as +N with the progress bar toward the
 * card's next level. A tap moves on, a long press skips to the summary.
 * With reduced motion the same steps play as fades with instant flips.
 */
import "../styles/rewards.css";
import type { AppCtx } from "../../app/ctx";
import { getCard, type CardId, type Rarity } from "../../game/cards";
import type { ChestRarity, ChestRewards } from "../../meta/chests";
import { upgradeCost } from "../../meta/economy";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { makeCardCanvas } from "../cardFrame";
import { button, confirm } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { getPrefs, reducedMotion } from "../prefs";

// ---- Feedback contracts -------------------------------------------------------

/**
 * Stings the audio package adds to the sound engine. Every call goes
 * through optional chaining, so the reveal is silent (not broken) on an
 * engine without them.
 */
export interface RewardSound {
  chestShake?(): void;
  chestOpen?(): void;
  cardFlip?(rarity: Rarity): void;
  sting?(rarity?: string): void;
  newCard?(): void;
  claim?(): void;
}

export function rewardSound(ctx: AppCtx): RewardSound {
  return ctx.sound as unknown as RewardSound;
}

// The haptics module (ui/feel.ts) lands with the audio package; pick it up
// when it exists, and fall back to a guarded navigator.vibrate otherwise.
const feelModule = Object.values(
  import.meta.glob<{ buzz?: (kind: string) => void }>("../feel.ts", { eager: true }),
)[0];

const FALLBACK_BUZZ: Record<string, number | number[]> = { claim: [10, 30, 10], select: 6, deploy: 12 };

/** A short vibration, if the player allows haptics and the device has them. */
export function buzz(kind: "claim" | "select" | "deploy"): void {
  try {
    if (feelModule?.buzz) {
      feelModule.buzz(kind);
      return;
    }
    if (!getPrefs().haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate(FALLBACK_BUZZ[kind]);
  } catch {
    // vibration is a nicety; never let it break a reward
  }
}

// ---- Helpers --------------------------------------------------------------------

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2 };

export function rarityLabel(r: Rarity, tr: AppCtx["tr"]): string {
  return r === "epic" ? tr("Epic", "ملحمية") : r === "rare" ? tr("Rare", "نادرة") : tr("Common", "عادية");
}

export function chestLabel(r: ChestRarity, tr: AppCtx["tr"]): string {
  return r === "rare" ? tr("Rare Chest", "صندوق نادر") : tr("Wooden Chest", "صندوق خشبي");
}

/** Index of the deck card a new card replaces: the most expensive (the last one on ties). */
export function swapOutIndex(deck: readonly CardId[]): number {
  let best = -1;
  let cost = -1;
  deck.forEach((id, i) => {
    const c = getCard(id).cost;
    if (c >= cost) {
      cost = c;
      best = i;
    }
  });
  return best;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** CSS-painted chest (shared with the chest room tiles). */
export function chestArt(rarity: ChestRarity, extra = ""): HTMLElement {
  const chest = el("div", `rw-chest rw-chest--${rarity} ${extra}`.trim());
  chest.setAttribute("aria-hidden", "true");
  chest.innerHTML =
    '<div class="rw-chest__shadow"></div><div class="rw-chest__base"></div>' +
    '<div class="rw-chest__lid"><i></i></div><div class="rw-chest__lock"></div>';
  return chest;
}

/** Count a number up in el's text over ms (instantly when calm). */
function countUp(target: HTMLElement, to: number, ms: number, calm: boolean, prefix = "+"): void {
  if (calm || ms <= 0) {
    target.textContent = `${prefix}${fmtNum(to)}`;
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    target.textContent = `${prefix}${fmtNum(Math.round(to * eased))}`;
    if (k < 1 && target.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

interface LootCard {
  id: CardId;
  isNew: boolean;
  shards: number;
}

/** Cards in reveal order: commons first, the new card last (the big moment). */
export function revealOrder(rewards: ChestRewards): LootCard[] {
  const items: LootCard[] = (Object.entries(rewards.shards) as [CardId, number][])
    .filter(([id, n]) => n > 0 && id !== rewards.newCard)
    .map(([id, n]) => ({ id, isNew: false, shards: n }));
  items.sort((a, b) => RARITY_RANK[getCard(a.id).rarity] - RARITY_RANK[getCard(b.id).rarity]);
  if (rewards.newCard) items.push({ id: rewards.newCard, isNew: true, shards: rewards.shards[rewards.newCard] ?? 0 });
  return items;
}

// ---- The sequence -----------------------------------------------------------------

export interface RevealOpts {
  rarity: ChestRarity;
  rewards: ChestRewards;
  /** Heading override (defaults to the chest's name). */
  title?: string;
}

const LONG_PRESS_MS = 550;
const AUTO_FLIP_MS = 700;

/** Play the reveal; resolves when the player closes the summary. */
export function playChestReveal(ctx: AppCtx, o: RevealOpts): Promise<void> {
  const { tr, meta } = ctx;
  const snd = rewardSound(ctx);
  const calm = reducedMotion();
  const items = revealOrder(o.rewards);

  const root = el("div", "rw-reveal");
  root.dataset.rarity = o.rarity;
  root.dataset.stage = "chest";
  if (calm) root.classList.add("is-calm");
  if (ARABIC) root.dir = "rtl";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", o.title ?? chestLabel(o.rarity, tr));

  const rays = el("div", "rw-reveal__rays");
  const flash = el("div", "rw-reveal__flash");
  const head = el("div", "rw-reveal__head");
  const title = el("h2", "rw-reveal__title", o.title ?? chestLabel(o.rarity, tr));
  const left = el("div", "rw-reveal__left");
  head.append(title, left);
  const stage = el("div", "rw-reveal__stage");
  const chest = chestArt(o.rarity, "rw-chest--hero");
  const burst = el("div", "rw-reveal__burst");
  stage.append(burst, chest);
  const loot = el("div", "rw-loot");
  const goldRow = el("div", "rw-loot__row rw-loot__row--gold");
  goldRow.innerHTML = icon("coin");
  const goldNum = el("span", "rw-loot__num", "+0");
  goldRow.appendChild(goldNum);
  loot.appendChild(goldRow);
  let gemsNum: HTMLElement | null = null;
  if (o.rewards.gems > 0) {
    const gemsRow = el("div", "rw-loot__row rw-loot__row--gems");
    gemsRow.innerHTML = icon("gem");
    gemsNum = el("span", "rw-loot__num", "+0");
    gemsRow.appendChild(gemsNum);
    loot.appendChild(gemsRow);
  }
  const cardHost = el("div", "rw-reveal__card");
  const summary = el("div", "rw-summary");
  const hint = el("div", "rw-reveal__hint", tr("Tap to continue · hold to skip", "اضغط للمتابعة · اضغط مطولًا للتخطي"));
  root.append(rays, flash, head, stage, loot, cardHost, summary, hint);
  document.body.appendChild(root);

  // ---- Step control: a tap advances, a long press skips to the summary.
  let skipped = false;
  let advance: (() => void) | null = null;
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (skipped) return resolve();
      const t = Number.isFinite(ms) ? window.setTimeout(done, ms) : 0;
      function done(): void {
        window.clearTimeout(t);
        if (advance === done) advance = null;
        resolve();
      }
      advance = done;
    });
  const skip = (): void => {
    if (skipped) return;
    skipped = true;
    advance?.();
  };
  let pressTimer = 0;
  let pressed = false;
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("button")) return;
    pressed = true;
    window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      pressed = false;
      skip();
    }, LONG_PRESS_MS);
  });
  const release = (e: PointerEvent): void => {
    window.clearTimeout(pressTimer);
    if (!pressed) return;
    pressed = false;
    if ((e.target as Element).closest("button")) return;
    advance?.();
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", () => {
    pressed = false;
    window.clearTimeout(pressTimer);
  });
  const onKey = (e: KeyboardEvent): void => {
    if (document.querySelector(".ui-modal")) return; // the Add-to-deck question owns the keys
    if (e.key === "Escape") skip();
    else if ((e.key === "Enter" || e.key === " ") && !(e.target as Element)?.closest?.("button")) advance?.();
  };
  document.addEventListener("keydown", onKey, true);

  const setLeft = (n: number): void => {
    left.textContent = n > 0 ? tr(`${n} left`, `باقي ${fmtNum(n)}`) : "";
  };

  const showCard = (item: LootCard, remaining: number): { flip: () => void; el: HTMLElement } => {
    const card = getCard(item.id);
    cardHost.innerHTML = "";
    const wrap = el("div", `rw-card rw-card--${card.rarity}${item.isNew ? " is-new" : ""}`);
    const inner = el("div", "rw-card__inner");
    const back = el("div", "rw-card__back");
    back.innerHTML = icon("crown");
    const front = el("div", "rw-card__front");
    front.appendChild(makeCardCanvas(item.id, { style: "tile", size: 200 }));
    front.appendChild(el("div", "rw-card__name", cardDisplayName(item.id)));
    front.appendChild(el("div", "rw-card__rarity", rarityLabel(card.rarity, tr)));
    inner.append(back, front);
    wrap.appendChild(inner);
    const info = el("div", "rw-card__info");
    cardHost.append(wrap, info);
    setLeft(remaining);

    const flip = (): void => {
      if (wrap.classList.contains("is-flipped")) return;
      wrap.classList.add("is-flipped");
      flash.dataset.rarity = card.rarity;
      flash.classList.remove("is-on");
      void flash.offsetWidth;
      flash.classList.add("is-on");
      snd.cardFlip?.(card.rarity);
      buzz("select");
      if (item.isNew) {
        snd.newCard?.();
        snd.sting?.(card.rarity);
        info.appendChild(el("div", "rw-card__ribbon", tr("NEW CARD!", "بطاقة جديدة!")));
        info.appendChild(addToDeckButton(item.id));
      } else {
        const level = meta.profile.levels[item.id] ?? 1;
        const have = meta.profile.shards[item.id] ?? 0;
        const cost = upgradeCost(card.rarity, level);
        const plus = el("div", "rw-card__plus", `+${fmtNum(item.shards)}`);
        info.appendChild(plus);
        const bar = el("div", "rw-shardbar");
        const fill = el("div", "rw-shardbar__fill");
        const label = el("span", "rw-shardbar__label");
        bar.append(fill, label);
        if (cost) {
          const before = Math.max(0, have - item.shards);
          const pct = (n: number): string => `${Math.min(100, (n / cost.shards) * 100)}%`;
          fill.style.width = pct(before);
          label.textContent = `${fmtNum(have)} / ${fmtNum(cost.shards)}`;
          requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = pct(have))));
          if (have >= cost.shards) {
            bar.classList.add("is-full");
            info.appendChild(bar);
            info.appendChild(el("div", "rw-card__ready", tr("Upgrade ready!", "جاهزة للترقية!")));
            return;
          }
        } else {
          fill.style.width = "100%";
          label.textContent = tr("Max level", "أعلى مستوى");
        }
        info.appendChild(bar);
      }
    };
    return { flip, el: wrap };
  };

  /** "Add to deck": swap the new card in for the deck's most expensive card. */
  const addToDeckButton = (id: CardId): HTMLElement => {
    if (meta.playerDeck.includes(id)) return el("div", "rw-card__indeck", tr("In your deck", "في مجموعتك"));
    const btn = button({
      variant: "primary",
      icon: "cards",
      label: tr("Add to deck", "أضف إلى المجموعة"),
      onClick: () => {
        const i = swapOutIndex(meta.playerDeck);
        if (i < 0) return;
        const out = meta.playerDeck[i];
        void confirm({
          title: tr("Add to deck?", "إضافة إلى المجموعة؟"),
          body: tr(
            `${cardDisplayName(id)} takes the place of ${cardDisplayName(out)} (${getCard(out).cost} elixir), your most expensive card.`,
            `تحلّ ${cardDisplayName(id)} محلّ ${cardDisplayName(out)} (${fmtNum(getCard(out).cost)} إكسير)، أغلى بطاقة في مجموعتك.`,
          ),
          okLabel: tr("Swap in", "استبدال"),
          cancelLabel: tr("Keep my deck", "أبقِ مجموعتي"),
        }).then((ok) => {
          if (!ok || meta.playerDeck.includes(id)) return;
          const deck = meta.playerDeck.slice();
          deck[i] = id;
          meta.playerDeck = deck;
          ctx.persistProfile();
          snd.claim?.();
          btn.replaceWith(el("div", "rw-card__indeck", tr("Added to your deck", "أضيفت إلى مجموعتك")));
        });
      },
    });
    btn.classList.add("rw-card__add");
    return btn;
  };

  const showSummary = (): Promise<void> => {
    root.dataset.stage = "summary";
    setLeft(0);
    cardHost.innerHTML = "";
    summary.innerHTML = "";
    summary.appendChild(el("div", "rw-summary__title", tr("You got", "حصلت على")));
    const cur = el("div", "rw-summary__currency");
    cur.innerHTML =
      `<span class="rw-pill">${icon("coin")}<b>+${fmtNum(o.rewards.gold)}</b></span>` +
      (o.rewards.gems > 0 ? `<span class="rw-pill">${icon("gem")}<b>+${fmtNum(o.rewards.gems)}</b></span>` : "");
    summary.appendChild(cur);
    const grid = el("div", "rw-summary__grid");
    for (const item of items) {
      const cell = el("div", `rw-summary__cell rw-summary__cell--${getCard(item.id).rarity}`);
      cell.appendChild(makeCardCanvas(item.id, { style: "tile", size: 96 }));
      cell.appendChild(
        el("span", "rw-summary__tag", item.isNew ? tr("New", "جديدة") : `+${fmtNum(item.shards)}`),
      );
      if (item.isNew) cell.classList.add("is-new");
      cell.setAttribute("aria-label", `${cardDisplayName(item.id)} ${item.isNew ? tr("new card", "بطاقة جديدة") : `+${item.shards}`}`);
      grid.appendChild(cell);
    }
    if (items.length > 0) summary.appendChild(grid);
    const newId = items.find((i) => i.isNew)?.id;
    if (newId) summary.appendChild(addToDeckButton(newId));
    return new Promise((resolve) => {
      const ok = button({ variant: "cta", size: "lg", label: tr("Collect", "استلام"), onClick: () => resolve() });
      ok.classList.add("rw-summary__ok");
      summary.appendChild(ok);
      hint.textContent = "";
      ok.focus({ preventScroll: true });
    });
  };

  const run = async (): Promise<void> => {
    // 1) The chest lands and shakes.
    if (!calm) {
      for (let i = 0; i < 3 && !skipped; i++) {
        await wait(i === 0 ? 420 : 340);
        if (skipped) break;
        chest.classList.remove("is-shaking");
        void chest.offsetWidth;
        chest.classList.add("is-shaking");
        snd.chestShake?.();
        if (i === 0) buzz("claim");
      }
      await wait(320);
    } else {
      buzz("claim");
      await wait(400);
    }
    // 2) It bursts open in light.
    root.dataset.stage = "open";
    chest.classList.remove("is-shaking");
    chest.classList.add("is-open");
    snd.chestOpen?.();
    await wait(calm ? 250 : 520);
    // 3) Gold and gems count up.
    root.dataset.stage = "loot";
    countUp(goldNum, o.rewards.gold, 600, calm || skipped);
    if (gemsNum) countUp(gemsNum, o.rewards.gems, 600, calm || skipped);
    await wait(950);
    // 4) Card by card.
    for (let n = 0; n < items.length && !skipped; n++) {
      root.dataset.stage = "card";
      const item = items[n];
      const view = showCard(item, items.length - n - 1);
      view.el.addEventListener("click", () => view.flip());
      await wait(AUTO_FLIP_MS);
      view.flip();
      if (skipped) break;
      // A new card waits for the player; shards move on by themselves.
      await wait(item.isNew ? Infinity : 1500);
    }
    await showSummary();
  };

  return run().finally(() => {
    document.removeEventListener("keydown", onKey, true);
    root.classList.add("is-leaving");
    window.setTimeout(() => root.remove(), calm ? 0 : 220);
  });
}
