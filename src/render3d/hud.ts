import type { BattleState } from "../game/battle";
import type { Side } from "../game/arena";
import { getCard, type CardId } from "../game/cards";
import { ELIXIR_MAX } from "../game/elixir";
import {
  BATTLE_DURATION,
  OVERTIME_DURATION,
  SANDBOX_ELIXIR_RATE,
  effectiveElixirMultiplier,
} from "../game/sim";
import { cardStatLines } from "../render/cardinfo";
import { cardDisplayName } from "../render/cardNames";
import { makeCardCanvas } from "../ui/cardFrame";

export interface HudCallbacks {
  onSelectCard(id: CardId | null): void;
  /** Release of a card-drag over the field — deploy at these page coords. */
  onDeployAt(clientX: number, clientY: number): void;
  onRestart(): void;
  /** Returns the new muted state. */
  onToggleSound(): boolean;
  /** Fired once when elixir hits the leak threshold (10). */
  onElixirLeak?(): void;
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

/** Card canvas helper — delegates to shared cardFrame for consistent framing. */
function cardCanvas(id: CardId): HTMLCanvasElement {
  return makeCardCanvas(id, { style: "hud" });
}

/** DOM HUD layered over the 3D stage: clock, crowns, cards, elixir. */
export class Hud {
  private readonly clock: HTMLElement;
  private readonly playerCrowns: HTMLElement;
  private readonly enemyCrowns: HTMLElement;
  private readonly opponentName: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly elixirFill: HTMLElement;
  private readonly elixirNum: HTMLElement;
  private elixirBar!: HTMLElement;
  private x2Tag!: HTMLElement;
  private readonly nextArt: HTMLElement;
  private readonly cardBtns: HTMLButtonElement[] = [];
  private readonly cardVeils: HTMLElement[] = [];
  private readonly cardNeeds: HTMLElement[] = [];
  private readonly cardReady: boolean[] = [];
  private readonly overlay: HTMLElement;
  private readonly overlayTitle: HTMLElement;
  private readonly overlayScore: HTMLElement;
  private readonly overlayStats: HTMLElement;
  private handKey = "";
  private nextKey = "";
  private selected: CardId | null = null;
  private prevPlayerCrowns = 0;
  private prevEnemyCrowns = 0;
  private leaking = false;
  private overlayShown = false;
  private readonly playerCrownsWrap: HTMLElement;
  private readonly enemyCrownsWrap: HTMLElement;

  constructor(
    topbar: HTMLElement,
    bottom: HTMLElement,
    overlay: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    // CR-style name banners with level badges around the gold clock.
    const left = el("div", "crowns player", topbar);
    left.setAttribute("aria-label", "Your crowns");
    left.innerHTML =
      '<span class="level" aria-hidden="true">9</span><span class="pname">You</span> 👑 <span class="crown-count">0</span>';
    this.playerCrownsWrap = left;
    this.playerCrowns = left.querySelector(".crown-count")!;
    this.clock = el("div", "clock", topbar);
    this.clock.setAttribute("role", "timer");
    this.clock.setAttribute("aria-label", "Time remaining");
    const right = el("div", "crowns enemy", topbar);
    right.setAttribute("aria-label", "Opponent crowns");
    right.innerHTML =
      '<span class="crown-count">0</span> 👑 <span class="pname">Bot</span><span class="level" aria-hidden="true">9</span>';
    this.enemyCrownsWrap = right;
    this.enemyCrowns = right.querySelector(".crown-count")!;
    this.opponentName = right.querySelector(".pname")!;
    this.muteBtn = el("button", "mute", topbar);
    this.muteBtn.textContent = "🔊";
    this.muteBtn.setAttribute("aria-label", "Toggle sound");
    this.muteBtn.setAttribute("title", "Toggle sound");
    this.muteBtn.addEventListener("click", () => {
      const muted = this.cb.onToggleSound();
      this.muteBtn.textContent = muted ? "🔇" : "🔊";
      this.muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    });

    // CR layout: the elixir droplet counter leads the bar.
    const elixirRow = el("div", "elixir-row", bottom);
    elixirRow.setAttribute("role", "group");
    elixirRow.setAttribute("aria-label", "Elixir");
    this.elixirNum = el("div", "elixir-num", elixirRow);
    this.elixirNum.setAttribute("aria-label", "Elixir amount");
    this.elixirBar = el("div", "elixir-bar", elixirRow);
    this.elixirBar.setAttribute("role", "progressbar");
    this.elixirBar.setAttribute("aria-label", "Elixir bar");
    this.elixirBar.setAttribute("aria-valuemin", "0");
    this.elixirBar.setAttribute("aria-valuemax", "10");
    this.elixirFill = el("div", "elixir-fill", this.elixirBar);
    this.x2Tag = el("div", "x2-tag", this.elixirBar);
    this.x2Tag.textContent = "x2";
    this.x2Tag.setAttribute("aria-hidden", "true");
    const maxTag = el("div", "elixir-max", this.elixirBar);
    maxTag.textContent = `Max: ${ELIXIR_MAX}`;
    maxTag.setAttribute("aria-hidden", "true");

    const handRow = el("div", "hand-row", bottom);
    handRow.setAttribute("role", "group");
    handRow.setAttribute("aria-label", "Card hand");
    const nextWrap = el("div", "next-card", handRow);
    nextWrap.setAttribute("aria-label", "Next card");
    this.nextArt = el("div", "next-art", nextWrap);
    el("div", "next-label", nextWrap).textContent = "Next:";
    // Shared stats tooltip floating above the hovered card.
    const tip = el("div", "card-tip", bottom);
    const showTip = (btn: HTMLButtonElement): void => {
      const id = btn.dataset.card as CardId | undefined;
      if (!id) return;
      tip.innerHTML = "";
      const title = document.createElement("b");
      title.textContent = `${cardDisplayName(id)} · ${getCard(id).cost} elixir`;
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

    // Stat tooltips are hover-only — they're useless and intrusive on touch,
    // so only wire them up on devices with a real hovering pointer (desktop).
    const canHover =
      typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches;

    for (let i = 0; i < 4; i++) {
      const btn = el("button", "card", handRow);
      btn.setAttribute("aria-label", `Card slot ${i + 1}`);
      if (canHover) {
        btn.addEventListener("mouseenter", () => showTip(btn));
        btn.addEventListener("mouseleave", () => tip.classList.remove("show"));
      }
      // Select on pointerdown so the same press rolls straight into a drag
      // onto the field. Keep the (implicit) pointer capture on the card so
      // every pointermove/up of the gesture is delivered — they bubble to the
      // window handlers that move the ghost and deploy on release.
      let downX = 0;
      let downY = 0;
      btn.addEventListener("pointerdown", (ev) => {
        const id = btn.dataset.card as CardId | undefined;
        if (!id) return;
        ev.preventDefault();
        downX = ev.clientX;
        downY = ev.clientY;
        const selecting = this.selected !== id;
        this.cb.onSelectCard(selecting ? id : null);
        if (selecting) btn.classList.add("dragging");
      });
      const endDrag = (ev: PointerEvent): void => {
        btn.classList.remove("dragging");
        const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
        if (moved > 16) this.cb.onDeployAt(ev.clientX, ev.clientY);
      };
      btn.addEventListener("pointerup", endDrag);
      btn.addEventListener("pointercancel", () => btn.classList.remove("dragging"));
      // Bottom-up elixir-charge fill that rises as the card nears playable.
      const veil = el("div", "elixir-veil", btn);
      // "+N" badge: how much more elixir is needed (hidden once playable).
      const need = el("div", "card-need", btn);
      this.cardVeils.push(veil);
      this.cardNeeds.push(need);
      this.cardBtns.push(btn);
    }
    // CR layout (reference screenshot): the elixir bar runs UNDER the hand.
    bottom.appendChild(elixirRow);

    this.overlay = overlay;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Match result");
    this.overlayTitle = el("div", "overlay-title", overlay);
    this.overlayScore = el("div", "overlay-score", overlay);
    this.overlayStats = el("div", "overlay-stats", overlay);
    const again = el("button", "again", overlay);
    again.textContent = "Play again";
    again.setAttribute("aria-label", "Play again");
    again.addEventListener("click", () => this.cb.onRestart());
  }

  setSelected(id: CardId | null): void {
    this.selected = id;
    if (!id) {
      for (const btn of this.cardBtns) btn.classList.remove("dragging");
    }
  }

  /** Pop the crown counter for a side (tower just fell). */
  popCrowns(side: "player" | "enemy"): void {
    const wrap = side === "player" ? this.playerCrownsWrap : this.enemyCrownsWrap;
    const count = side === "player" ? this.playerCrowns : this.enemyCrowns;
    wrap.classList.remove("crown-pop");
    count.classList.remove("crown-pop");
    void wrap.offsetWidth;
    wrap.classList.add("crown-pop");
    count.classList.add("crown-pop");
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

  /** Relabel the opponent banner (e.g. "Friend" for an online match). */
  setOpponentName(name: string): void {
    this.opponentName.textContent = name;
  }

  update(state: BattleState, mySide: Side = "player"): void {
    // From the local player's perspective: "me" sits at the bottom.
    const me = mySide === "player" ? state.player : state.enemy;
    const foe = mySide === "player" ? state.enemy : state.player;

    // Clock.
    const total = state.overtime
      ? BATTLE_DURATION + OVERTIME_DURATION
      : BATTLE_DURATION;
    const left = Math.max(0, Math.ceil(total - state.time));
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    this.clock.textContent = state.overtime ? `OVERTIME ${text}` : text;
    this.clock.classList.toggle("overtime", state.overtime);

    // Crown counters — pop when a tower falls (CR scoreboard feel).
    if (me.crowns > this.prevPlayerCrowns) this.popCrowns("player");
    if (foe.crowns > this.prevEnemyCrowns) this.popCrowns("enemy");
    this.prevPlayerCrowns = me.crowns;
    this.prevEnemyCrowns = foe.crowns;
    this.playerCrowns.textContent = String(me.crowns);
    this.enemyCrowns.textContent = String(foe.crowns);

    // Elixir (the bar runs hot during double elixir).
    const amount = me.elixir.amount;
    const amountInt = Math.floor(amount);
    this.elixirFill.style.width = `${(amount / ELIXIR_MAX) * 100}%`;
    this.elixirNum.textContent = String(amountInt);
    this.elixirBar.setAttribute("aria-valuenow", String(amountInt));
    const mult = effectiveElixirMultiplier(state);
    this.elixirBar.classList.toggle("x2", mult >= 2 && !state.result);
    // Sandbox's huge flat rate reads as "infinite", not a real multiplier.
    this.x2Tag.textContent = mult >= SANDBOX_ELIXIR_RATE ? "∞" : `x${mult}`;

    // Elixir leak warning at max — pulse the bar until the player spends.
    const atMax = amount >= ELIXIR_MAX && !state.result;
    this.elixirBar.classList.toggle("leak", atMax);
    this.elixirNum.classList.toggle("leak", atMax);
    if (atMax && !this.leaking) {
      this.leaking = true;
      this.cb.onElixirLeak?.();
    } else if (!atMax) {
      this.leaking = false;
    }

    // Hand (rebuild card art only when the hand changes).
    const handKey = me.hand.cards.join(",");
    if (handKey !== this.handKey) {
      this.handKey = handKey;
      me.hand.cards.forEach((id, i) => {
        const btn = this.cardBtns[i];
        const isNewDraw = btn.dataset.card !== undefined && btn.dataset.card !== id;
        btn.dataset.card = id;
        btn.dataset.rarity = getCard(id).rarity;
        btn.setAttribute("aria-label", `${cardDisplayName(id)}, ${getCard(id).cost} elixir`);
        if (isNewDraw) {
          btn.classList.remove("dealt");
          void btn.offsetWidth; // restart the pop animation
          btn.classList.add("dealt");
        }
        btn.innerHTML = "";
        btn.appendChild(cardCanvas(id));
        const name = document.createElement("div");
        name.className = "card-name";
        name.textContent = cardDisplayName(id);
        btn.appendChild(name);
        const cost = document.createElement("div");
        cost.className = "card-cost";
        cost.textContent = String(getCard(id).cost);
        btn.appendChild(cost);
        const key = document.createElement("div");
        key.className = "key-chip";
        key.textContent = String(i + 1); // keyboard shortcut hint
        btn.appendChild(key);
        const lvl = me.levels[id] ?? 1;
        if (lvl > 1) {
          const chip = document.createElement("div");
          chip.className = "lvl-chip";
          chip.textContent = `Lv.${lvl}`;
          btn.appendChild(chip);
        }
        // Re-attach the persistent charge overlay + "+N" badge, which the
        // innerHTML reset above detaches.
        btn.appendChild(this.cardVeils[i]);
        btn.appendChild(this.cardNeeds[i]);
      });
    }
    me.hand.cards.forEach((id, i) => {
      const btn = this.cardBtns[i];
      btn.classList.toggle("selected", this.selected === id);
      const cost = getCard(id).cost;
      const affordable = cost <= amount;
      btn.classList.toggle("locked", !affordable);
      // Bottom-up charge fill: dark covers the still-uncharged top,
      // clearing downward as elixir rises toward the card's cost.
      const progress = Math.max(0, Math.min(1, amount / cost));
      const veil = this.cardVeils[i];
      const need = this.cardNeeds[i];
      if (affordable) {
        veil.style.display = "none";
        need.style.display = "none";
        // Pop once at the moment it becomes playable.
        if (this.cardReady[i] === false) {
          btn.classList.remove("ready-pop");
          void btn.offsetWidth;
          btn.classList.add("ready-pop");
        }
        this.cardReady[i] = true;
      } else {
        veil.style.display = "block";
        // Bright elixir-pink fill rises from the bottom to the charge level,
        // with a glowing edge; dark covers the part still to charge.
        const pct = progress * 100;
        const edge = Math.max(0, pct - 5);
        veil.style.background =
          `linear-gradient(to top,` +
          ` rgba(242,58,168,0.40) 0%,` +
          ` rgba(242,58,168,0.40) ${edge.toFixed(1)}%,` +
          ` rgba(255,190,235,0.95) ${pct.toFixed(1)}%,` +
          ` rgba(8,12,22,0.74) ${pct.toFixed(1)}%,` +
          ` rgba(8,12,22,0.74) 100%)`;
        need.style.display = "block";
        need.textContent = `+${Math.ceil(cost - amount)}`;
        this.cardReady[i] = false;
      }
    });
    const nextId = me.hand.queue[0];
    if (nextId !== this.nextKey) {
      this.nextKey = nextId;
      this.nextArt.innerHTML = "";
      this.nextArt.appendChild(cardCanvas(nextId));
      this.nextArt.classList.remove("slide-in");
      void this.nextArt.offsetWidth;
      this.nextArt.classList.add("slide-in");
    }

    // Result overlay.
    if (state.result) {
      const { winner, playerCrowns, enemyCrowns } = state.result;
      const iWon = winner === mySide;
      this.overlayTitle.textContent =
        winner === "draw" ? "DRAW" : iWon ? "VICTORY! 🎉" : "DEFEAT";
      this.overlayTitle.dataset.kind = winner === "draw" ? "draw" : iWon ? "player" : "enemy";
      this.overlay.dataset.kind = this.overlayTitle.dataset.kind;
      const myCrowns = mySide === "player" ? playerCrowns : enemyCrowns;
      const foeCrowns = mySide === "player" ? enemyCrowns : playerCrowns;
      // Staggered crown tally on first show.
      if (!this.overlayShown) {
        this.overlayShown = true;
        if (iWon) this.dropConfetti();
        this.overlayScore.textContent = "👑 0 — 0 👑";
        let step = 0;
        const targetMy = myCrowns;
        const targetFoe = foeCrowns;
        const tick = (): void => {
          step++;
          const a = Math.min(targetMy, step);
          const b = Math.min(targetFoe, step);
          this.overlayScore.textContent = `👑 ${a} — ${b} 👑`;
          if (a < targetMy || b < targetFoe) window.setTimeout(tick, 180);
        };
        window.setTimeout(tick, 220);
      } else {
        this.overlayScore.textContent = `👑 ${myCrowns} — ${foeCrowns} 👑`;
      }
      const p = me.stats;
      const e = foe.stats;
      this.overlayStats.innerHTML =
        `<div class="stat-row"><span>${Math.round(p.damageDealt)}</span>` +
        `<label>damage</label><span>${Math.round(e.damageDealt)}</span></div>` +
        `<div class="stat-row"><span>${p.elixirSpent}</span>` +
        `<label>elixir spent</label><span>${e.elixirSpent}</span></div>` +
        `<div class="stat-row"><span>${Math.round(p.elixirLeaked)}</span>` +
        `<label>elixir leaked</label><span>${Math.round(e.elixirLeaked)}</span></div>` +
        (p.elixirCollected > 0 || e.elixirCollected > 0
          ? `<div class="stat-row"><span>${Math.round(p.elixirCollected)}</span>` +
            `<label>elixir collected</label><span>${Math.round(e.elixirCollected)}</span></div>`
          : "") +
        (this.reward ? `<div class="reward-line">${this.reward}</div>` : "");
      this.overlay.classList.add("show");
    } else {
      this.overlayShown = false;
      this.overlay.classList.remove("show");
      delete this.overlay.dataset.kind;
      this.overlay.querySelector(".confetti-box")?.remove();
    }
  }

  /** Rain celebratory confetti over the victory overlay. */
  private dropConfetti(): void {
    this.overlay.querySelector(".confetti-box")?.remove();
    const box = document.createElement("div");
    box.className = "confetti-box";
    box.setAttribute("aria-hidden", "true");
    const colors = ["#f6c14e", "#3b82f6", "#ef4444", "#66bb6a", "#e879d0", "#fff"];
    for (let i = 0; i < 42; i++) {
      const p = document.createElement("span");
      p.className = "confetti";
      p.style.left = `${(i * 137.5) % 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${(i % 7) * 0.35}s`;
      p.style.animationDuration = `${2.4 + ((i * 13) % 10) * 0.18}s`;
      p.style.width = `${7 + (i % 3) * 3}px`;
      p.style.height = `${10 + ((i * 5) % 3) * 4}px`;
      box.appendChild(p);
    }
    this.overlay.appendChild(box);
  }
}
