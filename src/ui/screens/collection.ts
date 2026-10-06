/** Collection: every card, its level and shards; tap to upgrade or craft. */
import type { AppCtx } from "../../app/ctx";
import { DECK, getCard } from "../../game/cards";
import { arenaArForUnlock, arenaNameForUnlock } from "../../meta/arenas";
import { addShards, isUnlockedAt } from "../../meta/collection";
import { SHARD_GOLD_PRICE, spendGold, upgradeCost } from "../../meta/economy";
import { ownedSet, tryUpgradeCard } from "../../meta/progress";
import { cardDisplayName } from "../../render/cardNames";
import { cardTileCanvas } from "./common";

export function openCollection(ctx: AppCtx): void {
  buildCollection(ctx);
  ctx.showPicker("collection");
}

function buildCollection(ctx: AppCtx): void {
  const { pickerRoot, meta, tr } = ctx;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = tr("Collection", "المجموعة");
  pickerRoot.appendChild(title);

  const currency = document.createElement("div");
  currency.className = "home-currency";
  currency.innerHTML =
    `<span class="chip gold">🪙 ${meta.profile.gold}</span>` +
    `<span class="chip gems">💎 ${meta.profile.gems}</span>`;
  pickerRoot.appendChild(currency);

  const detail = document.createElement("div");
  detail.className = "collect-detail";
  detail.textContent = tr("Tap a card to upgrade", "اضغط على بطاقة لترقيتها");
  pickerRoot.appendChild(detail);

  const grid = document.createElement("div");
  grid.className = "picker-grid collection-grid";
  pickerRoot.appendChild(grid);

  const owned = ownedSet(meta.profile.owned);
  for (const id of DECK) {
    const card = getCard(id);
    const have = owned.has(id);
    const unlocked = isUnlockedAt(id, meta.profile.trophies);
    const btn = document.createElement("button");
    btn.className = "pick" + (have ? "" : " locked");
    btn.dataset.card = id;
    btn.dataset.rarity = card.rarity;
    const level = meta.cardLevels[id] ?? 1;
    const shards = meta.profile.shards[id] ?? 0;
    if (have) {
      btn.appendChild(cardTileCanvas(id));
      const name = document.createElement("div");
      name.textContent = `${cardDisplayName(id)} · ${tr("Lv.", "مستوى ")}${level}`;
      btn.appendChild(name);
      const cost = document.createElement("div");
      cost.className = "pcost";
      cost.textContent = String(card.cost);
      btn.appendChild(cost);
      const shardBar = document.createElement("div");
      shardBar.className = "shard-bar";
      const upc = upgradeCost(card.rarity, level);
      const need = upc?.shards ?? 0;
      shardBar.textContent = upc ? `${shards}/${need} shards` : "MAX";
      btn.appendChild(shardBar);
      btn.addEventListener("click", () => {
        const upc2 = upgradeCost(card.rarity, meta.cardLevels[id] ?? 1);
        if (!upc2) {
          detail.textContent = tr(`${cardDisplayName(id)} is max level.`, `${cardDisplayName(id)} في أعلى مستوى.`);
          return;
        }
        const result = tryUpgradeCard(
          { ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels },
          id,
        );
        if (!result.ok) {
          const shardsHave = meta.profile.shards[id] ?? 0;
          const missing = Math.max(0, upc2.shards - shardsHave);
          const craftPrice = missing * SHARD_GOLD_PRICE;
          detail.textContent =
            result.reason === "afford"
              ? `Need ${upc2.gold} gold + ${upc2.shards} shards`
              : "Can't upgrade";
          // Agency: short on shards but flush on gold? Craft them on the spot.
          if (
            result.reason === "afford" &&
            missing > 0 &&
            meta.profile.gold >= upc2.gold + craftPrice
          ) {
            const craft = document.createElement("button");
            craft.className = "quest-claim craft-btn";
            craft.textContent = tr(
              `⚒️ Craft ${missing} shard${missing > 1 ? "s" : ""} — 🪙 ${craftPrice}`,
              `⚒️ اصنع ${missing} شظية — 🪙 ${craftPrice}`,
            );
            craft.addEventListener("click", () => {
              const left = spendGold(meta.profile.gold, craftPrice);
              if (left === null) return;
              meta.profile = {
                ...meta.profile,
                gold: left,
                shards: addShards(meta.profile.shards, id, missing),
              };
              ctx.persistProfile();
              buildCollection(ctx);
            });
            detail.appendChild(document.createTextNode(" "));
            detail.appendChild(craft);
          }
          return;
        }
        meta.profile = result.profile;
        meta.cardLevels = meta.profile.levels;
        ctx.persistProfile();
        buildCollection(ctx);
      });
    } else {
      const sil = document.createElement("div");
      sil.className = "pick-silhouette";
      sil.textContent = "❔";
      btn.appendChild(sil);
      const name = document.createElement("div");
      name.textContent = unlocked
        ? cardDisplayName(id)
        : tr(`Unlock at ${arenaNameForUnlock(id)}`, `يُفتح في ${arenaArForUnlock(id)}`);
      btn.appendChild(name);
      btn.disabled = true;
    }
    grid.appendChild(btn);
  }

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = tr("← Home", "→ الرئيسية");
  back.addEventListener("click", () => ctx.openHome());
  pickerRoot.appendChild(back);
}
