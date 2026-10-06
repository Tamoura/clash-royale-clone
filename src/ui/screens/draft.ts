/** Draft: keep one of three offered cards per round; the bot takes another. */
import type { AppCtx } from "../../app/ctx";
import { getCard } from "../../game/cards";
import {
  DRAFT_ROUNDS,
  createDraft,
  isDraftComplete,
  pickCard as pickDraftCard,
  type DraftState,
} from "../../game/draft";
import { cardDisplayName } from "../../render/cardNames";
import { cardTileCanvas } from "./common";

let draftState: DraftState | null = null;

export function openDraft(ctx: AppCtx): void {
  draftState = createDraft(Date.now() | 0);
  buildDraft(ctx);
  ctx.showPicker("draft");
}

function buildDraft(ctx: AppCtx): void {
  const { pickerRoot, tr } = ctx;
  const d = draftState;
  if (!d) return;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = tr(
    `Draft — pick ${d.picks.length + 1} of ${DRAFT_ROUNDS}`,
    `الاختيار — ${d.picks.length + 1} من ${DRAFT_ROUNDS}`,
  );
  pickerRoot.appendChild(title);

  const hint = document.createElement("div");
  hint.className = "collect-label";
  hint.textContent = tr("Keep one card — the bot grabs one of the others!", "احتفظ ببطاقة — والروبوت يأخذ إحدى البقية!");
  pickerRoot.appendChild(hint);

  const row = document.createElement("div");
  row.className = "picker-grid draft-row";
  for (const id of d.offers) {
    const card = getCard(id);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.rarity = card.rarity;
    btn.setAttribute(
      "aria-label",
      `Keep ${cardDisplayName(id)}, ${card.cost} elixir`,
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
    btn.addEventListener("click", () => {
      const next = pickDraftCard(d, id);
      if (!next) return;
      draftState = next;
      if (isDraftComplete(next)) {
        draftState = null;
        ctx.startDraft(next.picks, next.botPicks);
      } else {
        buildDraft(ctx);
      }
    });
    row.appendChild(btn);
  }
  pickerRoot.appendChild(row);

  if (d.picks.length > 0) {
    const mine = document.createElement("div");
    mine.className = "collect-label";
    mine.textContent = `${tr("Your deck so far", "مجموعتك حتى الآن")}: ${d.picks.map(cardDisplayName).join(" · ")}`;
    pickerRoot.appendChild(mine);
  }

  const back = document.createElement("button");
  back.className = "battle-btn friend";
  back.textContent = tr("← Home", "→ الرئيسية");
  back.addEventListener("click", () => ctx.openHome());
  pickerRoot.appendChild(back);
}
