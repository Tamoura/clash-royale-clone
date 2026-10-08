/**
 * Deck editor: tap owned cards to build the 8-card deck. In battle mode a
 * sticky footer starts the bot match and the setup chip row opens Battle
 * Setup; in deck mode the footer saves. A legal deck is also saved when
 * leaving by Back or a tab, so edits are never lost.
 */
import type { AppCtx, DeckPickerOpts } from "../../app/ctx";
import { DECK, getCard, type CardId } from "../../game/cards";
import { canPutInDeck } from "../../meta/collection";
import { isOwnedDeck, ownedSet } from "../../meta/progress";
import { cardDisplayName } from "../../render/cardNames";
import { button } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { setupChipRow } from "./battleSetup";
import { cardTileCanvas } from "./common";
import { mountSubscreen, section, sfx } from "./frame";

export function openDeckPicker(ctx: AppCtx, opts: DeckPickerOpts = { mode: "deck" }): void {
  buildDeckPicker(ctx, opts);
}

function buildDeckPicker(ctx: AppCtx, opts: DeckPickerOpts): void {
  const { meta, tr } = ctx;
  const battle = opts.mode === "battle";
  const owned = ownedSet(meta.profile.owned);
  const deck: CardId[] = meta.playerDeck.filter((id) => owned.has(id)).slice(0, 8);

  const deckGrid = document.createElement("div");
  deckGrid.className = "v2-grid v2-grid--deck v2-deck-slots";
  const summary = document.createElement("p");
  summary.className = "v2-deck-summary";
  const grid = document.createElement("div");
  grid.className = "v2-grid v2-pick-grid";

  function commitDeck(): boolean {
    if (!isOwnedDeck(deck, owned)) return false;
    meta.playerDeck = deck.slice();
    meta.profile = { ...meta.profile, deck: meta.playerDeck };
    ctx.persistProfile();
    return true;
  }

  const footer = document.createElement("div");
  const main = battle
    ? button({
        variant: "cta",
        size: "lg",
        icon: "sword",
        label: tr("Battle", "قتال"),
        ariaLabel: "Start a battle against the bot",
        onClick: () => {
          if (!commitDeck()) return;
          sfx(ctx, "uiTap");
          ctx.closeDeckPicker();
          ctx.startLadder();
        },
      })
    : button({
        variant: "cta",
        size: "lg",
        icon: "save",
        label: tr("Save deck", "حفظ المجموعة"),
        ariaLabel: "Save deck",
        onClick: () => {
          if (!commitDeck()) return;
          sfx(ctx, "uiTap");
          ctx.openHome();
        },
      });
  footer.appendChild(main);

  const remove = (id: CardId): void => {
    const i = deck.indexOf(id);
    if (i >= 0) deck.splice(i, 1);
    sync();
  };
  const toggle = (id: CardId): void => {
    if (!canPutInDeck(id, owned)) return;
    if (deck.includes(id)) remove(id);
    else if (deck.length < 8) {
      deck.push(id);
      sync();
    }
  };

  function sync(): void {
    deckGrid.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const id = deck[i];
      const slot = document.createElement("button");
      slot.type = "button";
      if (id) {
        slot.className = `v2-tile rarity-${getCard(id).rarity}`;
        const art = document.createElement("div");
        art.className = "v2-tile-art";
        art.appendChild(cardTileCanvas(id));
        slot.appendChild(art);
        const cost = document.createElement("span");
        cost.className = "v2-cost";
        cost.textContent = fmtNum(getCard(id).cost);
        slot.appendChild(cost);
        slot.setAttribute("aria-label", tr(`Remove ${cardDisplayName(id)}`, `أزل ${cardDisplayName(id)}`));
        slot.addEventListener("click", () => remove(id));
      } else {
        slot.className = "v2-tile is-empty";
        slot.disabled = true;
        slot.setAttribute("aria-label", tr("Empty slot", "خانة فارغة"));
      }
      deckGrid.appendChild(slot);
    }
    const costs = deck.map((id) => getCard(id).cost);
    const avg = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0;
    summary.innerHTML = icon("elixir");
    const t = document.createElement("span");
    t.textContent = tr(
      `${fmtNum(deck.length)} / ${fmtNum(8)} cards · average ${fmtNum(Number(avg.toFixed(1)))} elixir`,
      `${fmtNum(deck.length)} / ${fmtNum(8)} بطاقات · متوسط الإكسير ${fmtNum(Number(avg.toFixed(1)))}`,
    );
    summary.appendChild(t);
    summary.classList.toggle("is-short", deck.length < 8);
    main.disabled = !isOwnedDeck(deck, owned);
    grid.querySelectorAll<HTMLButtonElement>("button[data-card]").forEach((b) => {
      const on = deck.includes(b.dataset.card as CardId);
      b.classList.toggle("is-chosen", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  for (const id of DECK) {
    if (!owned.has(id)) continue;
    const card = getCard(id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = `v2-tile rarity-${card.rarity}`;
    b.dataset.card = id;
    b.setAttribute("aria-label", tr(`${cardDisplayName(id)}, ${card.cost} elixir`, `${cardDisplayName(id)}، ${card.cost} إكسير`));
    const art = document.createElement("div");
    art.className = "v2-tile-art";
    art.appendChild(cardTileCanvas(id));
    b.appendChild(art);
    const cost = document.createElement("span");
    cost.className = "v2-cost";
    cost.textContent = fmtNum(card.cost);
    b.appendChild(cost);
    const name = document.createElement("span");
    name.className = "v2-tile-name";
    name.textContent = cardDisplayName(id);
    b.appendChild(name);
    const tick = document.createElement("span");
    tick.className = "v2-tile-tick";
    tick.innerHTML = icon("check");
    b.appendChild(tick);
    b.addEventListener("click", () => toggle(id));
    grid.appendChild(b);
  }

  mountSubscreen(ctx, {
    id: "deckPicker",
    title: battle ? tr("Battle deck", "مجموعة المعركة") : tr("Edit deck", "تعديل المجموعة"),
    footer,
    onLeave: () => void commitDeck(),
    build: (body) => {
      const d = section(tr("Your deck", "مجموعتك"));
      d.el.appendChild(deckGrid);
      d.el.appendChild(summary);
      body.appendChild(d.el);
      if (battle) {
        const holder = document.createElement("div");
        holder.className = "v2-setup-holder";
        const draw = (): void => {
          holder.innerHTML = "";
          holder.appendChild(setupChipRow(ctx, draw));
        };
        draw();
        body.appendChild(holder);
      }
      const toCollection = button({
        variant: "secondary",
        icon: "book",
        label: tr("Collection", "المجموعة"),
        onClick: () => {
          commitDeck();
          ctx.openCollection();
        },
      });
      toCollection.classList.add("v2-head-btn");
      const c = section(tr("Your cards", "بطاقاتك"), toCollection);
      const hint = document.createElement("p");
      hint.className = "v2-hint";
      hint.textContent = tr("Tap a card to add or remove it.", "اضغط بطاقة لإضافتها أو إزالتها.");
      c.el.appendChild(hint);
      c.el.appendChild(grid);
      body.appendChild(c.el);
    },
  });
  sync();
}
