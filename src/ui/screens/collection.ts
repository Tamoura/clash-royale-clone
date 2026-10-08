/**
 * Collection: every card in Found and Locked groups. Found cards show
 * their level and shard progress; locked ones are dimmed silhouettes with
 * the arena that unlocks them. Tapping any card opens its info sheet —
 * upgrades only happen from the sheet's labelled Upgrade button.
 *
 * The same grid fills the Cards tab on Home and the framed Collection
 * sub-screen.
 */
import type { AppCtx } from "../../app/ctx";
import { DECK, getCard, type CardId } from "../../game/cards";
import { cardDisplayName } from "../../render/cardNames";
import { cardPortrait } from "../../render3d/cardportraits";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { cardTileCanvas } from "./common";
import { arenaLabel, currentArenaIndex, mountSubscreen, section } from "./frame";
import { cardProgress, openCardInfo, unlockArena } from "./cardInfo";

export function openCollection(ctx: AppCtx): void {
  const draw = (): void => {
    mountSubscreen(ctx, {
      id: "collection",
      title: ctx.tr("Collection", "المجموعة"),
      build: (body) => buildCollectionGroups(ctx, body, draw),
    });
  };
  draw();
}

/** A dark silhouette of the card's character (spells: its dimmed art). */
function silhouette(id: CardId): HTMLCanvasElement {
  const portrait = cardPortrait(id);
  if (!portrait) {
    const c = cardTileCanvas(id);
    c.classList.add("v2-sil-art");
    return c;
  }
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  c.getContext("2d")?.drawImage(portrait, 0, 0, 160, 160);
  c.className = "v2-sil";
  return c;
}

type TileState = "locked" | "max" | "ready" | "progress";

function tileState(p: ReturnType<typeof cardProgress>): TileState {
  if (!p.owned) return "locked";
  if (p.need === null) return "max";
  return p.canUpgrade ? "ready" : "progress";
}

/** One card tile: art, elixir pip, level and shard progress (or a lock). */
export function cardTile(ctx: AppCtx, id: CardId, onTap: () => void): HTMLButtonElement {
  const { tr } = ctx;
  const card = getCard(id);
  const p = cardProgress(ctx, id);
  const state = tileState(p);
  const b = document.createElement("button");
  b.type = "button";
  b.className = `v2-tile rarity-${card.rarity}` + (p.owned ? "" : " is-locked");
  b.dataset.card = id;
  const art = document.createElement("div");
  art.className = "v2-tile-art";
  art.appendChild(p.owned ? cardTileCanvas(id) : silhouette(id));
  b.appendChild(art);
  const cost = document.createElement("span");
  cost.className = "v2-cost";
  cost.textContent = fmtNum(card.cost);
  b.appendChild(cost);
  const name = cardDisplayName(id);
  if (p.owned) {
    const lvl = document.createElement("span");
    lvl.className = "v2-tile-level";
    lvl.textContent = state === "max" ? tr("MAX", "الأقصى") : tr(`Lv ${fmtNum(p.level)}`, `م ${fmtNum(p.level)}`);
    b.appendChild(lvl);
    const bar = document.createElement("span");
    bar.className = "v2-tile-shards";
    const fill = document.createElement("i");
    fill.style.width = p.need ? `${Math.min(100, Math.round((p.shards / p.need) * 100))}%` : "100%";
    bar.appendChild(fill);
    b.appendChild(bar);
    if (state === "ready") {
      b.classList.add("is-ready");
      const up = document.createElement("span");
      up.className = "v2-tile-up";
      up.innerHTML = icon("upgrade");
      b.appendChild(up);
    }
    b.setAttribute(
      "aria-label",
      state === "max"
        ? tr(`${name}, max level`, `${name}، أعلى مستوى`)
        : tr(
            `${name}, level ${p.level}, ${p.shards} of ${p.need} shards${state === "ready" ? ", ready to upgrade" : ""}`,
            `${name}، المستوى ${p.level}، ${p.shards} من ${p.need} شظايا${state === "ready" ? "، جاهزة للترقية" : ""}`,
          ),
    );
  } else {
    const where = unlockArena(id);
    // Already findable at this arena: it can drop from chests now.
    const findable = where.index <= currentArenaIndex(ctx);
    const lock = document.createElement("span");
    lock.className = "v2-tile-lock" + (findable ? " is-findable" : "");
    lock.innerHTML = icon(findable ? "chest" : "lock");
    const t = document.createElement("span");
    t.textContent = findable ? tr("In chests", "صناديق") : arenaLabel(ctx, where.index);
    lock.appendChild(t);
    b.appendChild(lock);
    b.setAttribute("aria-label", tr(`${name}, not found yet. ${t.textContent}`, `${name}، لم تُعثر عليها بعد. ${t.textContent}`));
  }
  b.addEventListener("click", onTap);
  return b;
}

/** Found and Locked groups (Locked sorted by unlock arena). */
export function buildCollectionGroups(ctx: AppCtx, host: HTMLElement, redraw: () => void): void {
  const { tr, meta } = ctx;
  const owned = new Set(meta.profile.owned);
  const found = DECK.filter((id) => owned.has(id));
  // The champion is made in the Studio, never found: it is not "locked".
  const locked = DECK.filter((id) => !owned.has(id) && id !== "champion").sort((a, b) => unlockArena(a).index - unlockArena(b).index);
  const open = (id: CardId): void => openCardInfo(ctx, id, { onChange: redraw });

  const count = document.createElement("span");
  count.className = "v2-count";
  count.textContent = `${fmtNum(found.length)} / ${fmtNum(found.length + locked.length)}`;
  const f = section(tr("Found", "مكتشفة"), count);
  f.el.classList.add("v2-found");
  const fg = document.createElement("div");
  fg.className = "v2-grid";
  for (const id of found) fg.appendChild(cardTile(ctx, id, () => open(id)));
  f.el.appendChild(fg);
  host.appendChild(f.el);

  if (locked.length) {
    const l = section(tr("Locked", "مقفلة"));
    l.el.classList.add("v2-locked");
    const hint = document.createElement("p");
    hint.className = "v2-hint";
    hint.textContent = tr(
      "Climb the trophy road: each arena adds new cards to your chests.",
      "اصعد طريق الكؤوس: كل ساحة تضيف بطاقات جديدة إلى صناديقك.",
    );
    l.el.appendChild(hint);
    const lg = document.createElement("div");
    lg.className = "v2-grid";
    for (const id of locked) lg.appendChild(cardTile(ctx, id, () => open(id)));
    l.el.appendChild(lg);
    host.appendChild(l.el);
  }
}
