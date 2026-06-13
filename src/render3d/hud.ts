import type { BattleState } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { ELIXIR_MAX } from "../game/elixir";
import { BATTLE_DURATION, OVERTIME_DURATION, elixirMultiplier } from "../game/sim";
import { drawCardArt } from "../render/characters";
import { CARD_COLOR } from "../render/cardcolors";
import { cardStatLines } from "../render/cardinfo";
import { cardPortrait } from "./cardportraits";

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
  c.width = c.height = 80;
  const ctx = c.getContext("2d")!;
  // Signature backdrop so each card reads at a glance.
  const base = CARD_COLOR[id];
  const g = ctx.createRadialGradient(40, 30, 6, 40, 44, 52);
  g.addColorStop(0, "#ffffff33");
  g.addColorStop(0.25, base);
  g.addColorStop(1, "#0a0e16");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(1, 1, 78, 78, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Real rendered 3D portrait when the card has a character rig;
  // spells keep their painted icon art.
  const portrait = cardPortrait(id);
  if (portrait) ctx.drawImage(portrait, -6, -2, 92, 92);
  else drawCardArt(ctx, id, 40, 43, 42);
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
  private elixirBar!: HTMLElement;
  private x2Tag!: HTMLElement;
  private readonly nextArt: HTMLElement;
  private readonly cardBtns: HTMLButtonElement[] = [];
  private readonly cardVeils: HTMLElement[] = [];
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
    // CR-style name banners with level badges around the gold clock.
    const left = el("div", "crowns player", topbar);
    left.innerHTML =
      '<span class="level">9</span><span class="pname">You</span> 👑 <span>0</span>';
    this.playerCrowns = left.querySelector("span:last-child")!;
    this.clock = el("div", "clock", topbar);
    const right = el("div", "crowns enemy", topbar);
    right.innerHTML =
      '<span>0</span> 👑 <span class="pname">Rival Bot</span><span class="level">9</span>';
    this.enemyCrowns = right.querySelector("span:first-child")!;
    this.muteBtn = el("button", "mute", topbar);
    this.muteBtn.textContent = "🔊";
    this.muteBtn.addEventListener("click", () => {
      this.muteBtn.textContent = this.cb.onToggleSound() ? "🔇" : "🔊";
    });

    // CR layout: the elixir droplet counter leads the bar.
    const elixirRow = el("div", "elixir-row", bottom);
    this.elixirNum = el("div", "elixir-num", elixirRow);
    this.elixirBar = el("div", "elixir-bar", elixirRow);
    this.elixirFill = el("div", "elixir-fill", this.elixirBar);
    this.x2Tag = el("div", "x2-tag", this.elixirBar);
    this.x2Tag.textContent = "x2";

    const handRow = el("div", "hand-row", bottom);
    const nextWrap = el("div", "next-card", handRow);
    this.nextArt = el("div", "next-art", nextWrap);
    el("div", "next-label", nextWrap).textContent = "next";
    // Shared stats tooltip floating above the hovered card.
    const tip = el("div", "card-tip", bottom);
    const showTip = (btn: HTMLButtonElement): void => {
      const id = btn.dataset.card as CardId | undefined;
      if (!id) return;
      tip.innerHTML = "";
      const title = document.createElement("b");
      title.textContent = `${getCard(id).name} · ${getCard(id).cost} elixir`;
      tip.appendChild(title);
      for (const line of cardStatLines(id)) {
        const div = document.createElement("div");
        div.textContent = line;
        tip.appendChild(div);
      }
      const rect = btn.getBoundingClientRect();
      const parent = bottom.getBoundingClientRect();
      tip.style.left = `${rect.left + rect.width / 2 - parent.left}px`;
      tip.classList.add("show");
    };

    for (let i = 0; i < 4; i++) {
      const btn = el("button", "card", handRow);
      btn.addEventListener("mouseenter", () => showTip(btn));
      btn.addEventListener("mouseleave", () => tip.classList.remove("show"));
      // Select on pointerdown so a press can roll straight into a
      // drag onto the field (release deploys there).
      btn.addEventListener("pointerdown", (ev) => {
        const id = btn.dataset.card as CardId | undefined;
        if (!id) return;
        // Touch implicitly captures the pointer; release it so the
        // field receives the pointerup that completes a drag-deploy.
        if (btn.hasPointerCapture(ev.pointerId)) {
          btn.releasePointerCapture(ev.pointerId);
        }
        this.cb.onSelectCard(this.selected === id ? null : id);
      });
      // Radial elixir-charge veil: a dark conic overlay that retreats
      // clockwise as elixir approaches this card's cost.
      const veil = el("div", "elixir-veil", btn);
      this.cardVeils.push(veil);
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

  /** Trophy/level-up summary shown on the result overlay. */
  private reward: string | null = null;

  setReward(text: string | null): void {
    this.reward = text;
  }

  /** Shake the elixir row (can't afford) or the hand (bad spot). */
  flashError(kind: "elixir" | "spot"): void {
    const target =
      kind === "elixir"
        ? this.elixirBar.parentElement!
        : this.cardBtns[0].parentElement!;
    target.classList.remove("error-shake");
    void target.offsetWidth; // restart the animation
    target.classList.add("error-shake");
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

    // Elixir (the bar runs hot during double elixir).
    const amount = state.player.elixir.amount;
    this.elixirFill.style.width = `${(amount / ELIXIR_MAX) * 100}%`;
    this.elixirNum.textContent = String(Math.floor(amount));
    const mult = elixirMultiplier(state);
    this.elixirBar.classList.toggle("x2", mult >= 2 && !state.result);
    this.x2Tag.textContent = mult === 3 ? "x3" : "x2";

    // Hand (rebuild card art only when the hand changes).
    const handKey = state.player.hand.cards.join(",");
    if (handKey !== this.handKey) {
      this.handKey = handKey;
      state.player.hand.cards.forEach((id, i) => {
        const btn = this.cardBtns[i];
        const isNewDraw = btn.dataset.card !== undefined && btn.dataset.card !== id;
        btn.dataset.card = id;
        btn.dataset.rarity = getCard(id).rarity;
        if (isNewDraw) {
          btn.classList.remove("dealt");
          void btn.offsetWidth; // restart the pop animation
          btn.classList.add("dealt");
        }
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
        const key = document.createElement("div");
        key.className = "key-chip";
        key.textContent = String(i + 1); // keyboard shortcut hint
        btn.appendChild(key);
        const lvl = state.player.levels[id] ?? 1;
        if (lvl > 1) {
          const chip = document.createElement("div");
          chip.className = "lvl-chip";
          chip.textContent = `Lv.${lvl}`;
          btn.appendChild(chip);
        }
      });
    }
    state.player.hand.cards.forEach((id, i) => {
      const btn = this.cardBtns[i];
      btn.classList.toggle("selected", this.selected === id);
      const cost = getCard(id).cost;
      const affordable = cost <= amount;
      btn.classList.toggle("locked", !affordable);
      // Radial charge fill: full dark at 0, clears at cost.
      const progress = Math.max(0, Math.min(1, amount / cost));
      const veil = this.cardVeils[i];
      if (affordable) {
        veil.style.display = "none";
      } else {
        veil.style.display = "block";
        const deg = progress * 360;
        veil.style.background =
          `conic-gradient(rgba(8,12,22,0) ${deg}deg, rgba(8,12,22,0.62) ${deg}deg)`;
      }
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
        `<label>elixir spent</label><span>${e.elixirSpent}</span></div>` +
        (this.reward ? `<div class="reward-line">${this.reward}</div>` : "");
      this.overlay.classList.add("show");
    } else {
      this.overlay.classList.remove("show");
    }
  }
}
