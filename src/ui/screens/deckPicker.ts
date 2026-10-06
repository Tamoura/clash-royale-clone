/**
 * Deck picker: build the 8-card deck. In battle mode it also picks the bot
 * difficulty, game mode, tower troop and King's ability.
 */
import type { AppCtx, DeckPickerOpts } from "../../app/ctx";
import { ABILITIES, ABILITY_IDS, saveAbility } from "../../game/abilities";
import { DECK, getCard, type CardId } from "../../game/cards";
import { TOWER_TROOPS, TOWER_TROOP_IDS, saveTowerTroop } from "../../game/towers";
import { canPutInDeck } from "../../meta/collection";
import { isOwnedDeck, ownedSet } from "../../meta/progress";
import { DIFFICULTIES, DIFF_AR, DIFF_KEY } from "../../match/difficulty";
import { GAME_MODES, MODE_KEY } from "../../match/modes";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { cardTileCanvas } from "./common";

export function openDeckPicker(ctx: AppCtx, opts: DeckPickerOpts = { mode: "deck" }): void {
  buildDeckPicker(ctx, opts);
  ctx.showPicker("deckPicker");
}

function buildDeckPicker(ctx: AppCtx, opts: DeckPickerOpts): void {
  const { pickerRoot, meta, tr } = ctx;
  pickerRoot.innerHTML = "";

  const crest = document.createElement("div");
  crest.className = "cr-crest";
  crest.setAttribute("aria-hidden", "true");
  crest.textContent = ARABIC ? "🌙" : "👑";
  pickerRoot.appendChild(crest);

  const title = document.createElement("h2");
  title.textContent =
    opts.mode === "battle"
      ? ARABIC
        ? "ابنِ سطحك الحربي"
        : "Battle deck"
      : ARABIC
        ? "عدّل سطحك"
        : "Edit deck";
  pickerRoot.appendChild(title);

  const owned = ownedSet(meta.profile.owned);
  const deck: CardId[] = meta.playerDeck.filter((id) => owned.has(id)).slice(0, 8);

  const deckRow = document.createElement("div");
  deckRow.className = "deck-slots";
  pickerRoot.appendChild(deckRow);

  const count = document.createElement("div");
  count.className = "deck-count";
  pickerRoot.appendChild(count);

  const collectLabel = document.createElement("div");
  collectLabel.className = "collect-label";
  collectLabel.textContent = tr("Owned cards — tap to add", "بطاقاتك — اضغط للإضافة");
  pickerRoot.appendChild(collectLabel);

  const grid = document.createElement("div");
  grid.className = "picker-grid";
  pickerRoot.appendChild(grid);

  if (opts.mode === "battle") {
    const diffRow = document.createElement("div");
    diffRow.className = "diff-row";
    for (const level of Object.keys(DIFFICULTIES)) {
      const btn = document.createElement("button");
      btn.className = "diff-btn";
      btn.textContent = tr(level[0].toUpperCase() + level.slice(1), DIFF_AR[level] ?? level);
      btn.classList.toggle("chosen", level === meta.difficulty);
      btn.addEventListener("click", () => {
        meta.difficulty = level;
        localStorage.setItem(DIFF_KEY, level);
        diffRow
          .querySelectorAll("button")
          .forEach((b) => b.classList.toggle("chosen", b === btn));
      });
      diffRow.appendChild(btn);
    }
    pickerRoot.appendChild(diffRow);

    const modeLabel = document.createElement("div");
    modeLabel.className = "collect-label";
    modeLabel.textContent = tr("Game mode", "نمط اللعب");
    pickerRoot.appendChild(modeLabel);

    const modeRow = document.createElement("div");
    modeRow.className = "mode-row";
    const modeBlurb = document.createElement("div");
    modeBlurb.className = "mode-blurb";
    for (const m of GAME_MODES) {
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.textContent = tr(m.name, m.nameAr);
      btn.classList.toggle("chosen", m.id === meta.gameMode.id);
      btn.addEventListener("click", () => {
        meta.gameMode = m;
        localStorage.setItem(MODE_KEY, m.id);
        modeRow.querySelectorAll("button").forEach((b) => b.classList.toggle("chosen", b === btn));
        modeBlurb.textContent = tr(m.blurb, m.blurbAr);
      });
      modeRow.appendChild(btn);
    }
    modeBlurb.textContent = tr(meta.gameMode.blurb, meta.gameMode.blurbAr);
    pickerRoot.appendChild(modeRow);

    // Tower Troop: who defends your princess towers.
    const ttLabel = document.createElement("div");
    ttLabel.className = "collect-label";
    ttLabel.textContent = tr("Tower troop", "حامي الأبراج");
    pickerRoot.appendChild(ttLabel);
    const ttRow = document.createElement("div");
    ttRow.className = "mode-row";
    const ttBlurb = document.createElement("div");
    ttBlurb.className = "mode-blurb";
    for (const id of TOWER_TROOP_IDS) {
      const def = TOWER_TROOPS[id];
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.textContent = tr(def.name, def.ar);
      btn.classList.toggle("chosen", id === meta.towerTroop);
      btn.addEventListener("click", () => {
        meta.towerTroop = id;
        saveTowerTroop(id);
        ttRow.querySelectorAll("button").forEach((b) => b.classList.toggle("chosen", b === btn));
        ttBlurb.textContent = tr(def.blurb, def.blurbAr);
      });
      ttRow.appendChild(btn);
    }
    ttBlurb.textContent = tr(TOWER_TROOPS[meta.towerTroop].blurb, TOWER_TROOPS[meta.towerTroop].blurbAr);
    pickerRoot.appendChild(ttRow);
    pickerRoot.appendChild(ttBlurb);

    // King's Ability: the charged power for this match.
    const abLabel = document.createElement("div");
    abLabel.className = "collect-label";
    abLabel.textContent = tr("King's ability", "قدرة الملك");
    pickerRoot.appendChild(abLabel);
    const abRow = document.createElement("div");
    abRow.className = "mode-row";
    const abBlurb = document.createElement("div");
    abBlurb.className = "mode-blurb";
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.textContent = `${def.icon} ${tr(def.name, def.ar)}`;
      btn.classList.toggle("chosen", id === meta.abilityChoice);
      btn.addEventListener("click", () => {
        meta.abilityChoice = id;
        saveAbility(id);
        abRow.querySelectorAll("button").forEach((b) => b.classList.toggle("chosen", b === btn));
        abBlurb.textContent = tr(def.blurb, def.blurbAr);
      });
      abRow.appendChild(btn);
    }
    abBlurb.textContent = tr(ABILITIES[meta.abilityChoice].blurb, ABILITIES[meta.abilityChoice].blurbAr);
    pickerRoot.appendChild(abRow);
    pickerRoot.appendChild(abBlurb);
    pickerRoot.appendChild(modeBlurb);
  }

  const startBtn = document.createElement("button");
  startBtn.className = "battle-btn";
  startBtn.textContent =
    opts.mode === "battle"
      ? tr("⚔️ Battle the Bot", "⚔️ قتال الروبوت")
      : tr("💾 Save deck", "💾 حفظ المجموعة");
  startBtn.setAttribute(
    "aria-label",
    opts.mode === "battle" ? "Start a battle against the bot" : "Save deck",
  );
  pickerRoot.appendChild(startBtn);

  let friendBtn: HTMLButtonElement | null = null;
  if (opts.mode === "battle") {
    friendBtn = document.createElement("button");
    friendBtn.className = "battle-btn friend";
    friendBtn.textContent = tr("🤝 Play a Friend", "🤝 اللعب مع صديق");
    friendBtn.setAttribute("aria-label", "Start an online match with a friend");
    pickerRoot.appendChild(friendBtn);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = tr("← Home", "← الرئيسية");
  backBtn.addEventListener("click", () => ctx.openHome());
  pickerRoot.appendChild(backBtn);

  const remove = (id: CardId): void => {
    const i = deck.indexOf(id);
    if (i >= 0) deck.splice(i, 1);
    sync();
  };
  const add = (id: CardId): void => {
    if (!canPutInDeck(id, owned)) return;
    if (!deck.includes(id) && deck.length < 8) deck.push(id);
    else if (deck.includes(id)) remove(id);
    sync();
  };

  function sync(): void {
    deckRow.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const id = deck[i];
      const slot = document.createElement("button");
      slot.className = id ? "deck-slot filled" : "deck-slot empty";
      if (id) {
        slot.appendChild(cardTileCanvas(id));
        const cost = document.createElement("div");
        cost.className = "pcost";
        cost.textContent = String(getCard(id).cost);
        slot.appendChild(cost);
        slot.title = `Remove ${cardDisplayName(id)}`;
        slot.addEventListener("click", () => remove(id));
      }
      deckRow.appendChild(slot);
    }
    const costs = deck.map((id) => getCard(id).cost);
    const avg = costs.length
      ? (costs.reduce((s, c) => s + c, 0) / costs.length).toFixed(1)
      : "0.0";
    count.textContent = tr(
      `${deck.length} / 8 cards · average ${avg} elixir`,
      `${deck.length} / 8 بطاقات · متوسط الإكسير ${avg}`,
    );
    const legal = isOwnedDeck(deck, owned);
    startBtn.disabled = !legal;
    if (friendBtn) {
      // The Studio champion exists only in this player's save — the other
      // client can't reproduce it, so online play would desync. Bot-only.
      const hasChampion = deck.includes("champion");
      friendBtn.disabled = !legal || hasChampion;
      friendBtn.title = hasChampion
        ? tr(
            "Your Champion is bot-battles only — remove it to play a friend.",
            "بطلك لمعارك الروبوت فقط — أزله للعب مع صديق.",
          )
        : "";
    }
    grid.querySelectorAll<HTMLButtonElement>("button.pick").forEach((btn) => {
      btn.classList.toggle("chosen", deck.includes(btn.dataset.card as CardId));
    });
  }

  for (const id of DECK) {
    if (!owned.has(id)) continue;
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.card = id;
    btn.dataset.rarity = card.rarity;
    btn.setAttribute(
      "aria-label",
      `${cardDisplayName(id)}, ${card.rarity}, ${card.cost} elixir`,
    );
    btn.appendChild(cardTileCanvas(id));
    const name = document.createElement("div");
    name.textContent = cardDisplayName(id);
    btn.appendChild(name);
    const cost = document.createElement("div");
    cost.className = "pcost";
    cost.setAttribute("aria-hidden", "true");
    cost.textContent = String(card.cost);
    btn.appendChild(cost);
    btn.addEventListener("click", () => add(id));
    grid.appendChild(btn);
  }
  sync();

  function commitDeck(): boolean {
    if (!isOwnedDeck(deck, owned)) return false;
    meta.playerDeck = deck.slice();
    meta.profile = { ...meta.profile, deck: meta.playerDeck };
    ctx.persistProfile();
    return true;
  }

  startBtn.addEventListener("click", () => {
    if (!commitDeck()) return;
    if (opts.mode === "battle") {
      ctx.closeDeckPicker();
      ctx.startLadder();
    } else {
      ctx.openHome();
    }
  });

  friendBtn?.addEventListener("click", () => {
    if (!commitDeck()) return;
    ctx.openLobby();
  });
}
