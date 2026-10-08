/**
 * Card info sheet: portrait, name, rarity, level, shards, stats now and at
 * the next level, where the card is found, and explicit actions — Upgrade
 * (with a confirm for big spends), craft missing shards, and Use/Swap into
 * the deck. Tapping a card anywhere only opens this sheet; nothing is ever
 * spent without pressing a labelled button.
 */
import type { AppCtx } from "../../app/ctx";
import { getCard, type CardId, type Rarity } from "../../game/cards";
import { ARENAS, unlockTrophiesFor } from "../../meta/arenas";
import { addShards } from "../../meta/collection";
import { SHARD_GOLD_PRICE, spendGold, upgradeCost } from "../../meta/economy";
import { ownedSet, tryUpgradeCard } from "../../meta/progress";
import { cardStatLines, cardStatsAtLevel, type CardLevelStats } from "../../render/cardinfo";
import { cardDisplayName } from "../../render/cardNames";
import { badge, button, progressBar, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { cardTileCanvas } from "./common";
import { arenaLabel, ask, openSheet, refreshTopBars, sfx } from "./frame";

/** Upgrades at or above this many gold ask before spending. */
export const CONFIRM_GOLD = 1000;

const RARITY: Record<Rarity, [string, string]> = {
  common: ["Common", "شائعة"],
  rare: ["Rare", "نادرة"],
  epic: ["Epic", "ملحمية"],
};

export function rarityLabel(ctx: AppCtx, r: Rarity): string {
  return ctx.tr(...RARITY[r]);
}

/** Level and upgrade state for a card in the player's save. */
export function cardProgress(ctx: AppCtx, id: CardId): {
  owned: boolean;
  level: number;
  shards: number;
  need: number | null;
  gold: number | null;
  canUpgrade: boolean;
} {
  const { meta } = ctx;
  const owned = ownedSet(meta.profile.owned).has(id);
  const level = meta.cardLevels[id] ?? 1;
  const shards = meta.profile.shards[id] ?? 0;
  const cost = upgradeCost(getCard(id).rarity, level);
  return {
    owned,
    level,
    shards,
    need: cost?.shards ?? null,
    gold: cost?.gold ?? null,
    canUpgrade: owned && !!cost && shards >= cost.shards && meta.profile.gold >= cost.gold,
  };
}

/** The arena (index and def) where a card becomes findable. */
export function unlockArena(id: CardId): { index: number; name: string; ar: string } {
  const need = unlockTrophiesFor(id);
  const index = Math.max(0, ARENAS.findIndex((a) => a.trophies === need));
  return { index, name: ARENAS[index].name, ar: ARENAS[index].ar };
}

type StatRow = [label: string, now: string, next: string | null, better: boolean];

function statRows(ctx: AppCtx, a: CardLevelStats, b: CardLevelStats | null): StatRow[] {
  const { tr } = ctx;
  const n = (v: number | null): string => (v === null ? "–" : fmtNum(Math.round(v)));
  const sec = (v: number | null): string => (v === null ? "–" : tr(`${fmtNum(v)}s`, `${fmtNum(v)} ث`));
  const rows: StatRow[] = [];
  const num = (label: string, x: number | null, y: number | null | undefined): void => {
    if (x === null) return;
    const delta = y != null ? Math.round(y) - Math.round(x) : 0;
    rows.push([label, n(x), y != null && delta > 0 ? `+${fmtNum(delta)}` : null, delta > 0]);
  };
  num(tr("Hitpoints", "نقاط الصحة"), a.hp, b?.hp);
  num(a.kind === "spell" ? tr("Damage", "الضرر") : tr("Damage per hit", "الضرر لكل ضربة"), a.damage, b?.damage);
  num(tr("Damage per second", "الضرر في الثانية"), a.dps, b?.dps);
  if (a.hitSpeed !== null) rows.push([tr("Hit speed", "سرعة الضرب"), sec(a.hitSpeed), null, false]);
  if (a.range !== null) {
    const r =
      a.kind === "spell"
        ? tr(`${fmtNum(a.range)} tiles`, `${fmtNum(a.range)} مربعات`)
        : a.range <= 1
          ? tr("Melee", "قريب")
          : tr(`${fmtNum(a.range)} tiles`, `${fmtNum(a.range)} مربعات`);
    rows.push([a.kind === "spell" ? tr("Radius", "نصف القطر") : tr("Range", "المدى"), r, null, false]);
  }
  if (a.speed) {
    const sp: Record<string, [string, string]> = { slow: ["Slow", "بطيء"], medium: ["Medium", "متوسط"], fast: ["Fast", "سريع"] };
    rows.push([tr("Speed", "السرعة"), tr(...sp[a.speed]), null, false]);
  }
  const tg: Record<CardLevelStats["targets"], [string, string]> = {
    ground: ["Ground", "الأرض"],
    "air-ground": ["Air and ground", "الجو والأرض"],
    buildings: ["Buildings", "المباني"],
    area: ["Everything in the area", "كل ما في المنطقة"],
  };
  if (a.kind !== "spell" && a.damage === null) {
    // Collectors and other non-attackers: no target line.
  } else {
    rows.push([tr("Targets", "الأهداف"), tr(...tg[a.targets]), null, false]);
  }
  if (a.count > 1) rows.push([tr("Count", "العدد"), `×${fmtNum(a.count)}`, null, false]);
  return rows;
}

export interface CardInfoOpts {
  /** Runs after anything changed (level, gold, deck). */
  onChange?: () => void;
}

/** Open the card info sheet for `id`. */
export function openCardInfo(ctx: AppCtx, id: CardId, opts: CardInfoOpts = {}): void {
  const { tr } = ctx;
  const content = document.createElement("div");
  content.className = "v2-cardinfo";
  let swapping = false;

  const changed = (): void => {
    refreshTopBars(ctx);
    opts.onChange?.();
    render();
  };

  async function upgrade(): Promise<void> {
    const p = cardProgress(ctx, id);
    if (!p.owned || p.gold === null) return;
    if (p.gold >= CONFIRM_GOLD) {
      const ok = await ask({
        title: tr("Upgrade this card?", "ترقية هذه البطاقة؟"),
        body: tr(
          `Spend ${fmtNum(p.gold)} gold and ${fmtNum(p.need ?? 0)} shards to raise ${cardDisplayName(id)} to level ${fmtNum(p.level + 1)}.`,
          `أنفق ${fmtNum(p.gold)} ذهب و${fmtNum(p.need ?? 0)} شظايا لرفع ${cardDisplayName(id)} إلى المستوى ${fmtNum(p.level + 1)}.`,
        ),
        okLabel: tr("Upgrade", "ترقية"),
        cancelLabel: tr("Not now", "ليس الآن"),
      });
      if (!ok) return;
    }
    const { meta } = ctx;
    const res = tryUpgradeCard({ ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels }, id);
    if (!res.ok) {
      toast(tr("Not enough gold or shards yet", "لا يكفي الذهب أو الشظايا بعد"), "danger");
      return;
    }
    meta.profile = res.profile;
    meta.cardLevels = meta.profile.levels;
    ctx.persistProfile();
    sfx(ctx, "claim");
    toast(tr(`${cardDisplayName(id)} is now level ${fmtNum(p.level + 1)}!`, `${cardDisplayName(id)} الآن في المستوى ${fmtNum(p.level + 1)}!`), "success");
    changed();
  }

  async function craft(missing: number): Promise<void> {
    const price = missing * SHARD_GOLD_PRICE;
    if (price >= CONFIRM_GOLD) {
      const ok = await ask({
        title: tr("Craft shards?", "صنع الشظايا؟"),
        body: tr(`Spend ${fmtNum(price)} gold on ${fmtNum(missing)} shards.`, `أنفق ${fmtNum(price)} ذهب على ${fmtNum(missing)} شظايا.`),
        okLabel: tr("Craft", "اصنع"),
        cancelLabel: tr("Not now", "ليس الآن"),
      });
      if (!ok) return;
    }
    const { meta } = ctx;
    const left = spendGold(meta.profile.gold, price);
    if (left === null) return;
    meta.profile = { ...meta.profile, gold: left, shards: addShards(meta.profile.shards, id, missing) };
    ctx.persistProfile();
    sfx(ctx, "claim");
    changed();
  }

  function useCard(swapOut: CardId | null): void {
    const { meta } = ctx;
    const deck = meta.playerDeck.slice();
    if (deck.includes(id)) return;
    if (swapOut === null) {
      if (deck.length >= 8) return;
      deck.push(id);
    } else {
      const i = deck.indexOf(swapOut);
      if (i < 0) return;
      deck[i] = id;
    }
    meta.playerDeck = deck;
    meta.profile = { ...meta.profile, deck };
    ctx.persistProfile();
    swapping = false;
    toast(tr(`${cardDisplayName(id)} joined your deck`, `انضمت ${cardDisplayName(id)} إلى مجموعتك`), "success");
    changed();
  }

  function render(): void {
    content.innerHTML = "";
    const card = getCard(id);
    const p = cardProgress(ctx, id);
    const where = unlockArena(id);

    // ---- Head: portrait, name, rarity, level, shards
    const head = document.createElement("div");
    head.className = "v2-ci-head";
    const art = document.createElement("div");
    art.className = `v2-ci-art rarity-${card.rarity}` + (p.owned ? "" : " is-locked");
    art.appendChild(cardTileCanvas(id));
    const cost = document.createElement("span");
    cost.className = "v2-cost";
    cost.textContent = fmtNum(card.cost);
    cost.setAttribute("aria-label", tr(`${card.cost} elixir`, `${card.cost} إكسير`));
    art.appendChild(cost);
    head.appendChild(art);

    const meta = document.createElement("div");
    meta.className = "v2-ci-meta";
    const tags = document.createElement("div");
    tags.className = "v2-ci-tags";
    const rb = badge(rarityLabel(ctx, card.rarity));
    rb.classList.add(`v2-rarity`, `v2-rarity--${card.rarity}`);
    tags.appendChild(rb);
    const kind = card.kind === "spell" ? tr("Spell", "تعويذة") : card.kind === "building" ? tr("Building", "مبنى") : tr("Troop", "وحدة");
    tags.appendChild(badge(kind));
    meta.appendChild(tags);
    const lvl = document.createElement("div");
    lvl.className = "v2-ci-level";
    lvl.textContent = p.owned ? tr(`Level ${fmtNum(p.level)}`, `المستوى ${fmtNum(p.level)}`) : tr("Not found yet", "لم تُعثر عليها بعد");
    meta.appendChild(lvl);
    if (p.owned) {
      meta.appendChild(
        p.need === null
          ? progressBar({ value: 1, max: 1, label: tr("Max level", "أعلى مستوى") })
          : progressBar({
              value: p.shards,
              max: p.need,
              label: tr(`${fmtNum(p.shards)} / ${fmtNum(p.need)} shards`, `${fmtNum(p.shards)} / ${fmtNum(p.need)} شظايا`),
            }),
      );
    }
    head.appendChild(meta);
    content.appendChild(head);

    // ---- Stats now vs next level
    const now = cardStatsAtLevel(id, p.level);
    const next = p.owned && p.need !== null ? cardStatsAtLevel(id, p.level + 1) : null;
    const table = document.createElement("table");
    table.className = "v2-ci-stats";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th></th><th></th><th></th></tr>";
    const ths = thead.querySelectorAll("th");
    ths[1].textContent = tr(`Level ${fmtNum(p.level)}`, `المستوى ${fmtNum(p.level)}`);
    ths[2].textContent = next ? tr(`Level ${fmtNum(p.level + 1)}`, `المستوى ${fmtNum(p.level + 1)}`) : "";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const [label, a, b, better] of statRows(ctx, now, next)) {
      const tr_ = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.scope = "row";
      c0.textContent = label;
      const c1 = document.createElement("td");
      c1.textContent = a;
      const c2 = document.createElement("td");
      c2.textContent = b ?? "";
      if (better) c2.className = "is-up";
      tr_.append(c0, c1, c2);
      tbody.appendChild(tr_);
    }
    table.appendChild(tbody);
    content.appendChild(table);

    // Traits (flies, splash, summons...) from the battle tooltip lines.
    // Drop the parts the stats table already shows (speed, range).
    const traits = cardStatLines(id)
      .slice(2)
      .map((line) =>
        line
          .split(" · ")
          .filter((bit) => !/speed|range|سرعة|مدى/i.test(bit))
          .join(" · "),
      )
      .filter(Boolean);
    if (traits.length) {
      const t = document.createElement("p");
      t.className = "v2-ci-traits";
      t.textContent = traits.join(" · ");
      content.appendChild(t);
    }

    const found = document.createElement("p");
    found.className = "v2-ci-found";
    found.innerHTML = icon("trophy");
    const fs = document.createElement("span");
    fs.textContent =
      id === "champion"
        ? tr("Made in the Champion Studio", "صُنعت في ورشة البطل")
        : tr(`Found from ${arenaLabel(ctx, where.index)}: ${where.name}`, `تظهر من ${arenaLabel(ctx, where.index)}: ${where.ar}`);
    found.appendChild(fs);
    content.appendChild(found);

    // ---- Actions
    const actions = document.createElement("div");
    actions.className = "v2-ci-actions";
    if (p.owned && p.gold !== null && p.need !== null) {
      const up = button({
        variant: "cta",
        size: "lg",
        icon: "upgrade",
        label: tr(`Upgrade (${fmtNum(p.gold)} gold)`, `ترقية (${fmtNum(p.gold)} ذهب)`),
        onClick: () => void upgrade(),
      });
      up.classList.add("v2-ci-upgrade");
      up.disabled = !p.canUpgrade;
      actions.appendChild(up);
      const missing = Math.max(0, p.need - p.shards);
      if (missing > 0) {
        const price = missing * SHARD_GOLD_PRICE;
        const hint = document.createElement("p");
        hint.className = "v2-ci-hint";
        hint.textContent = tr(
          `${fmtNum(missing)} more shards needed. Win chests, or craft them with gold.`,
          `تحتاج ${fmtNum(missing)} شظايا أخرى. اربح الصناديق أو اصنعها بالذهب.`,
        );
        actions.appendChild(hint);
        const c = button({
          variant: "secondary",
          icon: "hammer",
          label: tr(`Craft ${fmtNum(missing)} shards (${fmtNum(price)} gold)`, `اصنع ${fmtNum(missing)} شظايا (${fmtNum(price)} ذهب)`),
          onClick: () => void craft(missing),
        });
        c.disabled = ctx.meta.profile.gold < price;
        actions.appendChild(c);
      } else if (!p.canUpgrade) {
        const hint = document.createElement("p");
        hint.className = "v2-ci-hint";
        hint.textContent = tr(
          `You need ${fmtNum(p.gold - ctx.meta.profile.gold)} more gold.`,
          `تحتاج ${fmtNum(p.gold - ctx.meta.profile.gold)} ذهب إضافي.`,
        );
        actions.appendChild(hint);
      }
    }
    if (p.owned) {
      const deck = ctx.meta.playerDeck;
      if (deck.includes(id)) {
        const inDeck = document.createElement("p");
        inDeck.className = "v2-ci-indeck";
        inDeck.innerHTML = icon("check");
        const s = document.createElement("span");
        s.textContent = tr("In your battle deck", "ضمن مجموعتك القتالية");
        inDeck.appendChild(s);
        actions.appendChild(inDeck);
      } else if (deck.length < 8) {
        actions.appendChild(button({ variant: "primary", icon: "cards", label: tr("Add to deck", "أضف إلى المجموعة"), onClick: () => useCard(null) }));
      } else if (!swapping) {
        actions.appendChild(
          button({
            variant: "primary",
            icon: "cards",
            label: tr("Use in deck", "استخدمها في المجموعة"),
            onClick: () => {
              swapping = true;
              render();
            },
          }),
        );
      } else {
        const pickHead = document.createElement("p");
        pickHead.className = "v2-ci-hint";
        pickHead.textContent = tr("Tap the card to swap out:", "اضغط البطاقة التي ستخرج:");
        actions.appendChild(pickHead);
        const grid = document.createElement("div");
        grid.className = "v2-ci-swap";
        for (const other of deck) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `v2-tile v2-tile--mini rarity-${getCard(other).rarity}`;
          b.setAttribute("aria-label", tr(`Swap out ${cardDisplayName(other)}`, `أخرج ${cardDisplayName(other)}`));
          b.appendChild(cardTileCanvas(other));
          b.addEventListener("click", () => useCard(other));
          grid.appendChild(b);
        }
        actions.appendChild(grid);
        actions.appendChild(button({ variant: "ghost", label: tr("Cancel", "إلغاء"), onClick: () => ((swapping = false), render()) }));
      }
    }
    if (id === "champion") {
      actions.appendChild(
        button({
          variant: "secondary",
          icon: "hammer",
          label: tr("Edit in the Studio", "عدّل في الورشة"),
          onClick: () => {
            sheetRef.close();
            ctx.openStudio();
          },
        }),
      );
    }
    if (actions.childElementCount) content.appendChild(actions);
  }

  render();
  const sheetRef = openSheet({ title: cardDisplayName(id), content, className: "v2-cardinfo-sheet" });
}
