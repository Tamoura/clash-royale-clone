/**
 * The chest-opening moment: a full-screen sequence over everything (at
 * --z-modal). The chest drops in and shakes, bursts open in light, the gold
 * and gems count up, then each card flips (on tap, or by itself after
 * 700ms) with a rarity flash. A new card gets a NEW CARD! ribbon; shards
 * show as +N with the progress bar toward the card's next level. A tap
 * moves on, a long press skips to the summary.
 *
 * Nothing in the sequence itself can change the deck: the taps that move
 * it on land in the middle of the screen, so "Add to deck" waits for the
 * summary, below Collect, and opens a strip of the kid's deck where they
 * tap which card goes out ("Keep my deck" is the default; see deckSwap.ts).
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
import { button, rewardBursts } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { getPrefs, reducedMotion } from "../prefs";
import { mountSparkles } from "../sparkles";
import { STRIP_ARM_MS, addWithoutSwap, pickSwapOut, swapIntoDeck } from "./deckSwap";

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

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/**
 * Collect ignores taps this long after the summary appears. It sits where
 * the "tap to continue" taps land, so without this a fast tap-through
 * collected at once and the kid never saw the summary or its new-card offer.
 */
export const COLLECT_ARM_MS = 1000;

export function rarityLabel(r: Rarity, tr: AppCtx["tr"]): string {
  switch (r) {
    case "legendary":
      return tr("Legendary", "أسطورية");
    case "epic":
      return tr("Epic", "ملحمية");
    case "rare":
      return tr("Rare", "نادرة");
    default:
      return tr("Common", "عادية");
  }
}

export function chestLabel(r: ChestRarity, tr: AppCtx["tr"]): string {
  return r === "rare" ? tr("Rare Chest", "صندوق نادر") : tr("Wooden Chest", "صندوق خشبي");
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

/**
 * Cards in reveal order, building to the big moment: shards from common up,
 * then a new card, and anything legendary last of all (its shards, then a
 * new legendary), so the legendary build-up is always the finale.
 */
export function revealOrder(rewards: ChestRewards): LootCard[] {
  const items: LootCard[] = (Object.entries(rewards.shards) as [CardId, number][])
    .filter(([id, n]) => n > 0 && id !== rewards.newCard)
    .map(([id, n]) => ({ id, isNew: false, shards: n }));
  if (rewards.newCard) items.push({ id: rewards.newCard, isNew: true, shards: rewards.shards[rewards.newCard] ?? 0 });
  const rank = (item: LootCard): number => {
    const r = RARITY_RANK[getCard(item.id).rarity];
    return (r === RARITY_RANK.legendary ? 100 : 0) + (item.isNew ? 10 : 0) + r;
  };
  // A stable sort: equal ranks keep the chest's own order.
  return items.sort((a, b) => rank(a) - rank(b));
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
/** A legendary card waits face down this long while the light builds (a tap flips it sooner). */
export const LEGENDARY_BUILD_MS = 1900;

/** How long a card waits face down before it flips by itself. */
export function flipDelay(rarity: Rarity, calm: boolean): number {
  if (rarity !== "legendary") return AUTO_FLIP_MS;
  return calm ? AUTO_FLIP_MS + 300 : LEGENDARY_BUILD_MS;
}

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
    if (document.querySelector(".ui-modal")) return; // the deck strip owns the keys
    if (e.key === "Escape") skip();
    else if ((e.key === "Enter" || e.key === " ") && !(e.target as Element)?.closest?.("button")) advance?.();
  };
  document.addEventListener("keydown", onKey, true);

  const setLeft = (n: number): void => {
    left.textContent = n > 0 ? tr(`${n} left`, `باقي ${fmtNum(n)}`) : "";
  };

  // The legendary moment: the room turns gold, rays speed up and sparkles
  // rise round the face-down card; the flip bursts them out.
  let buildSparks: HTMLElement | null = null;
  const legendaryStage = (stage: "build" | "reveal" | null): void => {
    if (stage) root.dataset.legendary = stage;
    else delete root.dataset.legendary;
    buildSparks?.remove();
    buildSparks = null;
    if (calm || !stage) return;
    if (stage === "build") buildSparks = mountSparkles(root, { count: 22, seed: 11, mode: "rise", className: "rw-sparks--build" });
    else mountSparkles(root, { count: 26, seed: 29, mode: "burst", className: "rw-sparks--reveal", lifeMs: 1400 });
  };

  const showCard = (item: LootCard, remaining: number): { flip: () => void; el: HTMLElement } => {
    const card = getCard(item.id);
    cardHost.innerHTML = "";
    const legendary = card.rarity === "legendary";
    legendaryStage(legendary ? "build" : null);
    const wrap = el("div", `rw-card rw-card--${card.rarity}${item.isNew ? " is-new" : ""}${legendary ? " is-building" : ""}`);
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
      wrap.classList.remove("is-building");
      wrap.classList.add("is-flipped");
      flash.dataset.rarity = card.rarity;
      flash.classList.remove("is-on");
      void flash.offsetWidth;
      flash.classList.add("is-on");
      snd.cardFlip?.(card.rarity);
      if (legendary) {
        legendaryStage("reveal");
        // The legendary sting rings for shards too, not only a new card.
        if (!item.isNew) snd.sting?.("legendary");
        buzz("claim");
        // One ribbon, so a new legendary takes no more room than any new card.
        const words: [string, string] = item.isNew ? ["NEW LEGENDARY!", "أسطورية جديدة!"] : ["LEGENDARY!", "أسطورية!"];
        info.appendChild(el("div", "rw-card__ribbon rw-card__ribbon--legendary", tr(...words)));
      } else {
        buzz("select");
      }
      if (item.isNew) {
        snd.newCard?.();
        snd.sting?.(card.rarity);
        if (!legendary) info.appendChild(el("div", "rw-card__ribbon", tr("NEW CARD!", "بطاقة جديدة!")));
        // No button here: this is where "tap to continue" taps land.
        if (!meta.playerDeck.includes(item.id)) {
          info.appendChild(
            el("div", "rw-card__later", tr("You can add it to your deck at the end.", "يمكنك إضافتها إلى مجموعتك في النهاية.")),
          );
        }
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

  /**
   * The summary's new-card offer. "Add to deck" opens the deck strip; the
   * deck only changes when the kid taps the card that goes out. The button
   * ignores taps for a moment after the summary appears, so the last tap of
   * a tap-through never opens it.
   */
  const addToDeckOffer = (id: CardId): HTMLElement => {
    const box = el("div", "rw-summary__offer");
    if (meta.playerDeck.includes(id)) {
      box.appendChild(el("div", "rw-card__indeck", tr("In your deck", "في مجموعتك")));
      return box;
    }
    const shownAt = performance.now();
    let busy = false;
    const done = (text: string): void => {
      snd.claim?.();
      box.replaceChildren(el("div", "rw-card__indeck", text));
    };
    const btn = button({
      variant: "secondary",
      icon: "cards",
      label: tr("Add to deck", "أضف إلى المجموعة"),
      onClick: () => {
        if (busy || performance.now() - shownAt < STRIP_ARM_MS) return;
        if (meta.playerDeck.includes(id)) return;
        const roomy = addWithoutSwap(meta.playerDeck, id);
        if (roomy) {
          meta.playerDeck = roomy;
          ctx.persistProfile();
          done(tr("Added to your deck", "أضيفت إلى مجموعتك"));
          return;
        }
        busy = true;
        void pickSwapOut(id, meta.playerDeck).then((i) => {
          busy = false;
          if (i === null) return; // kept their deck: nothing changed
          const out = meta.playerDeck[i];
          const next = swapIntoDeck(meta.playerDeck, i, id);
          if (!next) return;
          meta.playerDeck = next;
          ctx.persistProfile();
          done(
            tr(
              `Added to your deck! ${cardDisplayName(out)} is still in your cards.`,
              `أضيفت إلى مجموعتك! وما زالت بطاقة ${cardDisplayName(out)} معك.`,
            ),
          );
        });
      },
    });
    btn.classList.add("rw-card__add");
    box.append(
      el("p", "rw-summary__offer-text", tr(`${cardDisplayName(id)} is new! Want it in your deck?`, `بطاقة ${cardDisplayName(id)} جديدة! أتريدها في مجموعتك؟`)),
      btn,
    );
    return box;
  };

  /** Where the chest's gold flies from when Collect is pressed (the summary's pills). */
  let collectFrom: DOMRect | null = null;

  const showSummary = (): Promise<void> => {
    legendaryStage(null);
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
    const shownAt = performance.now();
    return new Promise((resolve) => {
      const ok = button({
        variant: "cta",
        size: "lg",
        label: tr("Collect", "استلام"),
        onClick: () => {
          if (performance.now() - shownAt < COLLECT_ARM_MS) return; // the tap-through's last taps
          collectFrom = cur.getBoundingClientRect();
          resolve();
        },
      });
      ok.classList.add("rw-summary__ok", "is-arming");
      window.setTimeout(() => ok.classList.remove("is-arming"), COLLECT_ARM_MS);
      summary.appendChild(ok);
      // The new card's offer goes below Collect, off the centre of the screen.
      if (newId) summary.appendChild(addToDeckOffer(newId));
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
      await wait(flipDelay(getCard(item.id).rarity, calm));
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
    // The gold (and gems) fly into the wallet of the screen underneath.
    if (collectFrom) {
      const { gold, gems } = meta.profile;
      void rewardBursts(collectFrom, o.rewards.gold, o.rewards.gems, { gold, gems });
    }
  });
}
