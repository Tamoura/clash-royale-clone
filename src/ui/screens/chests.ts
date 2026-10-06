/** Chest room: four chest slots with timers, gem skips and the loot reveal. */
import type { AppCtx } from "../../app/ctx";
import type { CardId } from "../../game/cards";
import { isChestReady } from "../../meta/chests";
import { CHEST_SKIP_GEMS } from "../../meta/economy";
import { recordChest as recordChestAch, saveAchievements } from "../../meta/achievements";
import { tryOpenChest } from "../../meta/progress";
import { cardDisplayName } from "../../render/cardNames";

function formatRemain(ms: number): string {
  if (ms <= 0) return "Ready!";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function openChests(ctx: AppCtx): void {
  buildChests(ctx);
  ctx.showPicker("chests");
}

function buildChests(ctx: AppCtx): void {
  const { pickerRoot, meta, tr } = ctx;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = tr("Chests", "الصناديق");
  pickerRoot.appendChild(title);

  const currency = document.createElement("div");
  currency.className = "home-currency";
  currency.innerHTML =
    `<span class="chip gold">🪙 ${meta.profile.gold}</span>` +
    `<span class="chip gems">💎 ${meta.profile.gems}</span>`;
  pickerRoot.appendChild(currency);

  const note = document.createElement("div");
  note.className = "collect-label";
  note.textContent = tr(
    `Win battles to fill slots · Skip timer for ${CHEST_SKIP_GEMS} 💎`,
    `انتصر لتملأ الخانات · تخطَّ المؤقت بـ ${CHEST_SKIP_GEMS} 💎`,
  );
  pickerRoot.appendChild(note);

  const reveal = document.createElement("div");
  reveal.className = "chest-reveal";
  pickerRoot.appendChild(reveal);

  const row = document.createElement("div");
  row.className = "chest-slots";
  pickerRoot.appendChild(row);

  const now = Date.now();
  meta.profile.chests.forEach((slot, i) => {
    const cell = document.createElement("div");
    cell.className = "chest-slot" + (slot ? "" : " empty");
    if (!slot) {
      cell.textContent = tr("Empty", "فارغ");
      row.appendChild(cell);
      return;
    }
    const ready = isChestReady(slot, now);
    if (ready) cell.classList.add("ready");
    // CSS-art chest: banded wooden trunk with a gold lock; wobbles when ready.
    const art = document.createElement("div");
    art.className = "chest-art" + (slot.rarity === "rare" ? " rare" : "");
    art.innerHTML =
      '<div class="chest-base"></div><div class="chest-lid"></div>' +
      '<div class="chest-band"></div><div class="chest-lock"></div>';
    cell.appendChild(art);
    const label = document.createElement("div");
    label.className = "chest-rarity";
    label.textContent = slot.rarity === "rare" ? tr("Rare", "نادر") : tr("Free", "مجاني");
    cell.appendChild(label);
    const timer = document.createElement("div");
    timer.className = "chest-timer";
    timer.textContent = ready ? "Ready!" : formatRemain(slot.readyAt - now);
    cell.appendChild(timer);
    const openBtn = document.createElement("button");
    openBtn.className = "chest-open-btn";
    openBtn.textContent = ready ? "Open" : `Open (${CHEST_SKIP_GEMS}💎)`;
    openBtn.addEventListener("click", () => {
      const result = tryOpenChest(
        { ...meta.profile, deck: meta.playerDeck, levels: meta.cardLevels },
        i,
        Date.now(),
        undefined,
        { skipWithGems: !ready },
      );
      if (!result.ok || !result.rewards) {
        reveal.textContent =
          result.reason === "gems"
            ? "Not enough gems"
            : result.reason === "locked"
              ? "Still locked"
              : "Can't open";
        return;
      }
      meta.profile = result.profile;
      ctx.persistProfile();
      const r = result.rewards;
      const bits: string[] = [`+${r.gold} 🪙`];
      if (r.gems) bits.push(`+${r.gems} 💎`);
      if (r.newCard) bits.push(`New: ${cardDisplayName(r.newCard)}!`);
      const shardBits = Object.entries(r.shards)
        .map(([id, n]) => `${cardDisplayName(id as CardId)} +${n}`)
        .join(", ");
      if (shardBits) bits.push(shardBits);
      // Lid-pop first, then the loot reveal bursts out of the open chest.
      cell.classList.add("opening");
      meta.achievements = recordChestAch(meta.achievements);
      saveAchievements(meta.achievements);
      openBtn.disabled = true;
      window.setTimeout(() => {
        reveal.textContent = bits.join(" · ");
        reveal.classList.remove("burst");
        void reveal.offsetWidth;
        reveal.classList.add("burst");
      }, 350);
      // Rebuild after a beat so the player can read the reveal.
      window.setTimeout(() => buildChests(ctx), 1600);
    });
    cell.appendChild(openBtn);
    row.appendChild(cell);
  });

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = tr("← Home", "→ الرئيسية");
  back.addEventListener("click", () => ctx.openHome());
  pickerRoot.appendChild(back);
}
