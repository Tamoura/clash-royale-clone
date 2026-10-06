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
import { fmtNum } from "../i18n";
import { cardTileCanvas } from "./common";
import { mountSubscreen, section } from "./frame";

let draftState: DraftState | null = null;

export function openDraft(ctx: AppCtx): void {
  draftState = createDraft(Date.now() | 0);
  buildDraft(ctx);
}

function buildDraft(ctx: AppCtx): void {
  const { tr } = ctx;
  const d = draftState;
  if (!d) return;
  const round = d.picks.length + 1;
  mountSubscreen(ctx, {
    id: "draft",
    title: tr("Draft", "الانتقاء"),
    build: (body) => {
      const steps = document.createElement("div");
      steps.className = "v2-draft-steps";
      steps.setAttribute("role", "progressbar");
      steps.setAttribute("aria-valuemin", "0");
      steps.setAttribute("aria-valuemax", String(DRAFT_ROUNDS));
      steps.setAttribute("aria-valuenow", String(d.picks.length));
      for (let i = 0; i < DRAFT_ROUNDS; i++) {
        const dot = document.createElement("i");
        if (i < d.picks.length) dot.className = "is-done";
        else if (i === d.picks.length) dot.className = "is-now";
        steps.appendChild(dot);
      }
      body.appendChild(steps);

      const s = section(
        tr(`Pick ${fmtNum(round)} of ${fmtNum(DRAFT_ROUNDS)}`, `الاختيار ${fmtNum(round)} من ${fmtNum(DRAFT_ROUNDS)}`),
      );
      const hint = document.createElement("p");
      hint.className = "v2-hint";
      hint.textContent = tr("Keep one card. The bot grabs one of the others!", "احتفظ ببطاقة، والروبوت يأخذ إحدى البقية!");
      s.el.appendChild(hint);
      const row = document.createElement("div");
      row.className = "v2-grid v2-draft-offers";
      for (const id of d.offers) {
        const card = getCard(id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `v2-tile v2-tile--big rarity-${card.rarity}`;
        btn.setAttribute("aria-label", tr(`Keep ${cardDisplayName(id)}, ${card.cost} elixir`, `احتفظ بـ ${cardDisplayName(id)}، ${card.cost} إكسير`));
        const art = document.createElement("div");
        art.className = "v2-tile-art";
        art.appendChild(cardTileCanvas(id));
        btn.appendChild(art);
        const cost = document.createElement("span");
        cost.className = "v2-cost";
        cost.textContent = fmtNum(card.cost);
        btn.appendChild(cost);
        const name = document.createElement("span");
        name.className = "v2-tile-name";
        name.textContent = cardDisplayName(id);
        btn.appendChild(name);
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
      s.el.appendChild(row);
      body.appendChild(s.el);

      if (d.picks.length > 0) {
        const mine = section(tr("Your deck so far", "مجموعتك حتى الآن"));
        const g = document.createElement("div");
        g.className = "v2-grid v2-grid--deck";
        for (const id of d.picks) {
          const t = document.createElement("div");
          t.className = `v2-tile v2-tile--static rarity-${getCard(id).rarity}`;
          t.setAttribute("role", "img");
          t.setAttribute("aria-label", cardDisplayName(id));
          const art = document.createElement("div");
          art.className = "v2-tile-art";
          art.appendChild(cardTileCanvas(id));
          t.appendChild(art);
          g.appendChild(t);
        }
        mine.el.appendChild(g);
        body.appendChild(mine.el);
      }
    },
  });
}
