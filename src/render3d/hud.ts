import type { BattleState } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { ELIXIR_MAX } from "../game/elixir";
import { BATTLE_DURATION, OVERTIME_DURATION } from "../game/sim";
import { drawCardArt } from "../render/characters";

export interface HudCallbacks {
  onSelectCard(id: CardId | null): void;
  onRestart(): void;
  /** Returns the new muted state. */
  onToggleSound(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function cardCanvas(id: CardId): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  drawCardArt(ctx, id, 32, 34, 34);
  return c;
}

/** DOM HUD layered over the 3D stage: clock, crowns, cards, elixir. */
export class Hud {
  private readonly clock: HTMLElement;
  private readonly playerCrowns: HTMLElement;
  private readonly enemyCrowns: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly elixirFill: HTMLElement;
  private readonly elixirNum: HTMLElement;
  private readonly nextArt: HTMLElement;
  private readonly cardBtns: HTMLButtonElement[] = [];
  private readonly overlay: HTMLElement;
  private readonly overlayTitle: HTMLElement;
  private readonly overlayScore: HTMLElement;
  private readonly overlayStats: HTMLElement;
  private handKey = "";
  private nextKey = "";
  private selected: CardId | null = null;

  constructor(
    topbar: HTMLElement,
    bottom: HTMLElement,
    overlay: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    const left = el("div", "crowns player", topbar);
    left.innerHTML = "👑 <span>0</span>";
    this.playerCrowns = left.querySelector("span")!;
    this.clock = el("div", "clock", topbar);
    const right = el("div", "crowns enemy", topbar);
    right.innerHTML = "<span>0</span> 👑";
    this.enemyCrowns = right.querySelector("span")!;
    this.muteBtn = el("button", "mute", topbar);
    this.muteBtn.textContent = "🔊";
    this.muteBtn.addEventListener("click", () => {
      this.muteBtn.textContent = this.cb.onToggleSound() ? "🔇" : "🔊";
    });

    const elixirRow = el("div", "elixir-row", bottom);
    const bar = el("div", "elixir-bar", elixirRow);
    this.elixirFill = el("div", "elixir-fill", bar);
    this.elixirNum = el("div", "elixir-num", elixirRow);

    const handRow = el("div", "hand-row", bottom);
    const nextWrap = el("div", "next-card", handRow);
    this.nextArt = el("div", "next-art", nextWrap);
    el("div", "next-label", nextWrap).textContent = "next";
    for (let i = 0; i < 4; i++) {
      const btn = el("button", "card", handRow);
      btn.addEventListener("click", () => {
        const id = btn.dataset.card as CardId | undefined;
        if (!id) return;
        this.cb.onSelectCard(this.selected === id ? null : id);
      });
      this.cardBtns.push(btn);
    }

    this.overlay = overlay;
    this.overlayTitle = el("div", "overlay-title", overlay);
    this.overlayScore = el("div", "overlay-score", overlay);
    this.overlayStats = el("div", "overlay-stats", overlay);
    const again = el("button", "again", overlay);
    again.textContent = "Play again";
    again.addEventListener("click", () => this.cb.onRestart());
  }

  setSelected(id: CardId | null): void {
    this.selected = id;
  }

  update(state: BattleState): void {
    // Clock.
    const total = state.overtime
      ? BATTLE_DURATION + OVERTIME_DURATION
      : BATTLE_DURATION;
    const left = Math.max(0, Math.ceil(total - state.time));
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    this.clock.textContent = state.overtime ? `OVERTIME ${text}` : text;
    this.clock.classList.toggle("overtime", state.overtime);

    this.playerCrowns.textContent = String(state.player.crowns);
    this.enemyCrowns.textContent = String(state.enemy.crowns);

    // Elixir.
    const amount = state.player.elixir.amount;
    this.elixirFill.style.width = `${(amount / ELIXIR_MAX) * 100}%`;
    this.elixirNum.textContent = String(Math.floor(amount));

    // Hand (rebuild card art only when the hand changes).
    const handKey = state.player.hand.cards.join(",");
    if (handKey !== this.handKey) {
      this.handKey = handKey;
      state.player.hand.cards.forEach((id, i) => {
        const btn = this.cardBtns[i];
        btn.dataset.card = id;
        btn.innerHTML = "";
        btn.appendChild(cardCanvas(id));
        const name = document.createElement("div");
        name.className = "card-name";
        name.textContent = getCard(id).name;
        btn.appendChild(name);
        const cost = document.createElement("div");
        cost.className = "card-cost";
        cost.textContent = String(getCard(id).cost);
        btn.appendChild(cost);
      });
    }
    state.player.hand.cards.forEach((id, i) => {
      const btn = this.cardBtns[i];
      btn.classList.toggle("selected", this.selected === id);
      btn.classList.toggle("locked", getCard(id).cost > amount);
    });
    const nextId = state.player.hand.queue[0];
    if (nextId !== this.nextKey) {
      this.nextKey = nextId;
      this.nextArt.innerHTML = "";
      this.nextArt.appendChild(cardCanvas(nextId));
    }

    // Result overlay.
    if (state.result) {
      const { winner, playerCrowns, enemyCrowns } = state.result;
      this.overlayTitle.textContent =
        winner === "player" ? "VICTORY! 🎉" : winner === "enemy" ? "DEFEAT" : "DRAW";
      this.overlayTitle.dataset.kind = winner;
      this.overlayScore.textContent = `👑 ${playerCrowns} — ${enemyCrowns} 👑`;
      const p = state.player.stats;
      const e = state.enemy.stats;
      this.overlayStats.innerHTML =
        `<div class="stat-row"><span>${Math.round(p.damageDealt)}</span>` +
        `<label>damage</label><span>${Math.round(e.damageDealt)}</span></div>` +
        `<div class="stat-row"><span>${p.elixirSpent}</span>` +
        `<label>elixir spent</label><span>${e.elixirSpent}</span></div>`;
      this.overlay.classList.add("show");
    } else {
      this.overlay.classList.remove("show");
    }
  }
}
