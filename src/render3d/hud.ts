import "../ui/styles/hud.css";
import { fmtNum, tr } from "../ui/i18n";
import type { BattleState } from "../game/battle";
import { ABILITIES, type AbilityId } from "../game/abilities";
import { icon, type CrestIndex, type IconName } from "../ui/icons";
import type { Side } from "../game/arena";
import { getCard, type CardId } from "../game/cards";
import { cardStatLines } from "../render/cardinfo";
import { cardDisplayName } from "../render/cardNames";
import { CARD_COLOR } from "../render/cardcolors";
import { drawCardArt } from "../render/characters";
import { cardPortrait } from "./cardportraits";
import { on, pendingSpend, setPresentTimeScale, type MatchEndPayload } from "../app/hooks";
import { resultExtras } from "../app/slots";
import { battleMenuPausing, closeBattleMenu, openBattleMenu } from "../ui/battleMenu";
import { getPrefs, onPrefs, reducedMotion } from "../ui/prefs";
import {
  TowerDamageTracker,
  buildResultStats,
  hudModel,
  lossTip,
  mergeTimeline,
  type HudModel,
  type TimelineEntry,
} from "./hudModel";
import { ResultScreen } from "./result";

const ABILITY_ICON: Record<AbilityId, IconName> = { rally: "sword", restore: "heart", salvo: "bomb" };

/** How a banner names the opponent. Every field is optional. */
export interface OpponentLabel {
  name?: string;
  /** Profile crest index (online opponents). */
  crest?: number;
  trophies?: number;
  /** Short badge text shown when there is no crest (the arena number). */
  badge?: string;
}

export interface HudCallbacks {
  onSelectCard(id: CardId | null): void;
  /** Release of a card-drag over the field — deploy at these page coords. */
  onDeployAt(clientX: number, clientY: number): void;
  /** "Play again" / "Rematch" on the result screen. */
  onRestart(): void;
  /** @deprecated Sound lives in the battle menu now (prefs.muted); see onMuted. */
  onToggleSound?(): boolean;
  /** Fired once when elixir hits the leak threshold (10). */
  onElixirLeak?(): void;
  /** The King's Ability button was pressed. */
  onAbility?(): void;
  /** "OK" on the result screen (and Leave from a free-exit menu). */
  onHome?(): void;
  /** "Open chest" on the result screen. */
  onOpenChest?(): void;
  /** A chest can be opened right now (shows "Open chest"). */
  chestReady?(): boolean;
  /** The match is online: no pause, and "Play again" reads "Rematch". */
  isOnline?(): boolean;
  /** The opponent's banner; null falls back to setOpponentName() or "Bot". */
  opponentLabel?(): OpponentLabel | null;
  /** The player confirmed Forfeit in the battle menu. */
  onForfeit?(): void;
  /** Trophies shown on the player's banner (null hides them). */
  playerTrophies?(): number | null;
  /** Gold and trophies now; the result screen counts up the difference. */
  wallet?(): { gold: number; trophies: number };
  /** Trophies a forfeit costs now (0 = a loss with none); null = free exit. */
  leaveCost?(): number | null;
  /** The sound setting changed in the battle menu (already saved to prefs). */
  onMuted?(muted: boolean): void;
}

/** Presentation speed between the last blow and the result screen. */
const SLOW_MO = 0.35;
const REVEAL_MS = 1600;
const REVEAL_MS_CALM = 400;

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

/**
 * A full-bleed 3:4 card portrait: the card's colour as a lit backdrop, the
 * pre-rendered 3D character cropped to fill it (spells keep painted art).
 */
function handCardCanvas(id: CardId, w = 72): HTMLCanvasElement {
  const h = Math.round((w * 4) / 3);
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.className = "card-art";
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  const base = CARD_COLOR[id];
  const g = ctx.createRadialGradient(w * 0.5, h * 0.3, w * 0.05, w * 0.5, h * 0.55, h * 0.75);
  g.addColorStop(0, "#ffffff40");
  g.addColorStop(0.3, base);
  g.addColorStop(1, "#0a0e16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const portrait = cardPortrait(id);
  if (portrait) {
    // Fill the frame: the square render scaled to the card's height and
    // centred, so the sides crop and the whole figure stays in view.
    const s = h * 0.96;
    ctx.drawImage(portrait, (w - s) / 2, (h - s) * 0.4, s, s);
  } else {
    drawCardArt(ctx, id, w / 2, h * 0.46, w * 0.6);
  }
  // Floor shade so the cost droplet always reads.
  const shade = ctx.createLinearGradient(0, h * 0.62, 0, h);
  shade.addColorStop(0, "rgba(6,10,22,0)");
  shade.addColorStop(1, "rgba(6,10,22,0.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

interface CardSlot {
  btn: HTMLButtonElement;
  cost: HTMLElement;
  veil: HTMLElement;
  need: HTMLElement;
}

/** DOM HUD layered over the 3D stage: clock, crowns, cards, elixir. */
export class Hud {
  private readonly clock: HTMLElement;
  private readonly playerCrowns: HTMLElement;
  private readonly enemyCrowns: HTMLElement;
  private readonly playerCrownsWrap: HTMLElement;
  private readonly enemyCrownsWrap: HTMLElement;
  private readonly playerBadge: HTMLElement;
  private readonly playerName: HTMLElement;
  private readonly playerTrophies: HTMLElement;
  private readonly enemyBadge: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly enemyTrophies: HTMLElement;
  private readonly menuToggle: HTMLButtonElement;
  private readonly elixirRow: HTMLElement;
  private readonly elixirBar: HTMLElement;
  private readonly elixirNum: HTMLElement;
  private readonly multTag: HTMLElement;
  private readonly handRow: HTMLElement;
  private readonly slots: CardSlot[] = [];
  private readonly nextWrap: HTMLElement;
  private readonly nextArt: HTMLElement;
  private readonly abilityBtn: HTMLButtonElement;
  private readonly abilityIcon: HTMLElement;
  private readonly result: ResultScreen;

  private prev: HudModel | null = null;
  private selected: CardId | null = null;
  private battle: BattleState | null = null;
  private mySide: Side = "player";
  private opponentName: string | null = null;

  // Match bookkeeping for the result screen.
  private readonly tracker = new TowerDamageTracker();
  private timeline: TimelineEntry[] = [];
  private lastEnd: MatchEndPayload | null = null;
  private walletAtStart: { gold: number; trophies: number } | null = null;
  private resultEntered = false;
  private revealAt = 0;
  private revealTimer = 0;

  constructor(
    topbar: HTMLElement,
    bottom: HTMLElement,
    overlay: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    topbar.classList.add("v2");
    bottom.classList.add("v2");
    bottom.parentElement?.classList.add("hud-v2");

    // ---- Top bar: two name banners, the clock, the menu.
    const banner = (side: "player" | "enemy"): {
      wrap: HTMLElement;
      badge: HTMLElement;
      name: HTMLElement;
      trophies: HTMLElement;
      count: HTMLElement;
    } => {
      const wrap = el("div", `crowns ${side}`, topbar);
      const badge = el("span", "hud-badge", wrap);
      badge.setAttribute("aria-hidden", "true");
      const text = el("span", "hud-who", wrap);
      const name = el("span", "pname", text);
      const trophies = el("span", "ptrophies", text);
      const crown = el("span", "hud-crown", wrap);
      crown.innerHTML = icon("crown");
      crown.setAttribute("aria-hidden", "true");
      const count = el("span", "crown-count", wrap);
      count.textContent = fmtNum(0);
      return { wrap, badge, name, trophies, count };
    };
    const foe = banner("enemy");
    const me = banner("player");
    this.enemyCrownsWrap = foe.wrap;
    this.enemyBadge = foe.badge;
    this.enemyName = foe.name;
    this.enemyTrophies = foe.trophies;
    this.enemyCrowns = foe.count;
    this.playerCrownsWrap = me.wrap;
    this.playerBadge = me.badge;
    this.playerName = me.name;
    this.playerTrophies = me.trophies;
    this.playerCrowns = me.count;

    this.clock = el("div", "clock", topbar);
    this.clock.setAttribute("role", "timer");
    this.clock.setAttribute("aria-label", tr("Time remaining", "الوقت المتبقي"));

    const menuWrap = el("div", "battle-menu", topbar);
    this.menuToggle = el("button", "menu-toggle", menuWrap);
    this.menuToggle.type = "button";
    this.menuToggle.setAttribute("aria-label", tr("Battle menu", "قائمة المعركة"));
    this.menuToggle.setAttribute("aria-haspopup", "dialog");
    this.menuToggle.innerHTML = "<span></span><span></span><span></span>";
    this.menuToggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.openMenu();
    });

    // ---- Bottom: floating Next + King, the hand, the elixir bar.
    this.nextWrap = el("div", "hud-next", bottom);
    this.nextWrap.setAttribute("role", "img");
    el("div", "hud-next-label", this.nextWrap).textContent = tr("Next", "التالية");
    this.nextArt = el("div", "hud-next-art", this.nextWrap);

    this.abilityBtn = el("button", "hud-ability", bottom);
    this.abilityBtn.type = "button";
    this.abilityBtn.dataset.tut = "ability";
    this.abilityBtn.hidden = true;
    this.abilityBtn.innerHTML =
      '<svg class="hud-ring" viewBox="0 0 56 56" aria-hidden="true">' +
      '<circle class="hud-ring-track" cx="28" cy="28" r="25"/>' +
      '<circle class="hud-ring-fill" cx="28" cy="28" r="25" pathLength="100"/></svg>';
    this.abilityIcon = el("span", "hud-ability-icon", this.abilityBtn);
    el("span", "hud-ability-label", this.abilityBtn).textContent = tr("KING", "الملك");
    this.abilityBtn.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      this.cb.onAbility?.();
    });

    this.handRow = el("div", "hand-row", bottom);
    this.handRow.setAttribute("role", "group");
    this.handRow.setAttribute("aria-label", tr("Card hand", "البطاقات في يدك"));

    // Shared stats tooltip floating above the hovered card (desktop only).
    const tip = el("div", "card-tip", bottom);
    const showTip = (btn: HTMLButtonElement): void => {
      const id = btn.dataset.card as CardId | undefined;
      if (!id) return;
      tip.innerHTML = "";
      const title = document.createElement("b");
      title.textContent = `${cardDisplayName(id)} · ${tr(`${getCard(id).cost} elixir`, `${fmtNum(getCard(id).cost)} إكسير`)}`;
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
    const canHover =
      typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches;

    for (let i = 0; i < 4; i++) {
      const btn = el("button", "card", this.handRow);
      btn.type = "button";
      btn.setAttribute("aria-label", tr(`Card slot ${i + 1}`, `خانة البطاقة ${fmtNum(i + 1)}`));
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
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (Math.sqrt(dx * dx + dy * dy) > 16) this.cb.onDeployAt(ev.clientX, ev.clientY);
      };
      btn.addEventListener("pointerup", endDrag);
      btn.addEventListener("pointercancel", () => btn.classList.remove("dragging"));
      const cost = document.createElement("div");
      cost.className = "card-cost";
      // Charge veil: a static gradient driven by --charge (0..100).
      const veil = document.createElement("div");
      veil.className = "elixir-veil";
      // "+N": how much more elixir is needed (hidden once playable).
      const need = document.createElement("div");
      need.className = "card-need";
      this.slots.push({ btn, cost, veil, need });
    }

    // The elixir bar runs full width under the hand, droplet first.
    this.elixirRow = el("div", "elixir-row", bottom);
    this.elixirRow.dataset.tut = "elixir";
    this.elixirRow.setAttribute("role", "group");
    this.elixirRow.setAttribute("aria-label", tr("Elixir", "الإكسير"));
    this.elixirNum = el("div", "elixir-num", this.elixirRow);
    this.elixirNum.setAttribute("aria-hidden", "true");
    this.elixirBar = el("div", "elixir-bar", this.elixirRow);
    this.elixirBar.setAttribute("role", "progressbar");
    this.elixirBar.setAttribute("aria-label", tr("Elixir", "الإكسير"));
    this.elixirBar.setAttribute("aria-valuemin", "0");
    this.elixirBar.setAttribute("aria-valuemax", "10");
    el("div", "elixir-fill", this.elixirBar);
    this.multTag = el("div", "x2-tag", this.elixirBar);
    this.multTag.setAttribute("aria-hidden", "true");

    this.result = new ResultScreen(overlay);

    // ---- Hooks: match lifecycle, tower damage, slow-mo and pause.
    on("matchStart", (p) => this.beginBattle(p.battle, p.mySide, true));
    on("battleEvent", ({ ev, mySide }) => {
      const b = this.battle;
      if (!b) return;
      this.tracker.noteEvent(ev, b.time);
      if (ev.type === "death" && (ev.kind === "princess-tower" || ev.kind === "king-tower")) {
        this.timeline.push({ t: b.time, mine: ev.side === mySide, tower: ev.kind === "king-tower" ? "king" : "princess" });
      }
    });
    on("matchEnd", (p) => {
      this.lastEnd = p;
    });
    onPrefs(() => this.refreshLabels());
    setPresentTimeScale(() => {
      if (battleMenuPausing()) return 0;
      return this.revealAt > 0 && performance.now() < this.revealAt ? SLOW_MO : 1;
    });
    this.refreshLabels();
  }

  setSelected(id: CardId | null): void {
    this.selected = id;
    for (const s of this.slots) {
      s.btn.classList.toggle("selected", id !== null && s.btn.dataset.card === id);
      if (!id) s.btn.classList.remove("dragging");
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

  /** Reward summary text (settlement); only its words are shown, numbers count up. */
  private reward: string | null = null;
  /** Chest won this match (shown on the result screen), or null. */
  private rewardChest: "free" | "rare" | null = null;

  setReward(text: string | null): void {
    this.reward = text;
    if (text === null) this.rewardChest = null;
  }

  setRewardChest(rarity: "free" | "rare" | null): void {
    this.rewardChest = rarity;
  }

  /** Shake the elixir row (can't afford) or the hand (bad spot). */
  flashError(kind: "elixir" | "spot"): void {
    const target = kind === "elixir" ? this.elixirRow : this.handRow;
    target.classList.remove("error-shake");
    void target.offsetWidth; // restart the animation
    target.classList.add("error-shake");
  }

  /** Relabel the opponent banner (e.g. "Friend" for an online match). */
  setOpponentName(name: string): void {
    this.opponentName = name;
    this.refreshLabels();
  }

  /** @deprecated The HUD builds its own tower timeline from the battle events. */
  setTimeline(_lines: string[]): void {}

  /**
   * Let a feature module supply or replace callbacks after construction
   * (online play sets isOnline, opponentLabel and onForfeit this way).
   */
  setCallbacks(patch: Partial<HudCallbacks>): void {
    Object.assign(this.cb, patch);
    this.refreshLabels();
  }

  /** Close the battle menu and the result screen (leaving the battle). */
  dismiss(): void {
    closeBattleMenu();
    this.result.hide();
  }

  private openMenu(): void {
    const b = this.battle;
    if (!b || b.result) return;
    openBattleMenu({
      isOnline: () => this.cb.isOnline?.() ?? false,
      leaveCost: () => (this.cb.leaveCost ? this.cb.leaveCost() : 0),
      onForfeit: () => this.cb.onForfeit?.(),
      onLeave: () => {
        this.dismiss();
        (this.cb.onHome ?? this.cb.onRestart)();
      },
      onMuted: (m) => this.cb.onMuted?.(m),
    });
  }

  private refreshLabels(): void {
    const prefs = getPrefs();
    this.playerBadge.innerHTML = icon(`crest-${prefs.crest as CrestIndex}`);
    this.playerName.textContent = prefs.playerName || tr("You", "أنت");
    this.setTrophies(this.playerTrophies, this.cb.playerTrophies?.() ?? null);
    const label = this.cb.opponentLabel?.() ?? null;
    const foeName = label?.name || this.opponentName || tr("Bot", "الروبوت");
    this.enemyName.textContent = foeName;
    const crest = label?.crest;
    if (crest !== undefined && Number.isInteger(crest) && crest >= 0 && crest < 12) {
      this.enemyBadge.innerHTML = icon(`crest-${crest as CrestIndex}`);
      this.enemyBadge.classList.remove("text");
      this.enemyBadge.hidden = false;
    } else {
      // No crest: the arena number in a ring, or nothing at all.
      this.enemyBadge.textContent = label?.badge ?? "";
      this.enemyBadge.classList.add("text");
      this.enemyBadge.hidden = !label?.badge;
    }
    this.setTrophies(this.enemyTrophies, label?.trophies ?? null);
    this.playerCrownsWrap.setAttribute("aria-label", tr(`${this.playerName.textContent}: crowns`, `${this.playerName.textContent}: التيجان`));
    this.enemyCrownsWrap.setAttribute("aria-label", tr(`${foeName}: crowns`, `${foeName}: التيجان`));
  }

  private setTrophies(node: HTMLElement, n: number | null): void {
    node.hidden = n === null;
    if (n !== null) node.innerHTML = `${icon("trophy")}${fmtNum(n)}`;
  }

  /** A new match: forget the last one's HUD state and result. */
  private beginBattle(state: BattleState, mySide: Side, announced: boolean): void {
    if (state === this.battle && mySide === this.mySide) {
      // matchStart for a battle update() already adopted: just relabel.
      if (announced) {
        this.walletAtStart = this.cb.wallet?.() ?? null;
        this.refreshLabels();
      }
      return;
    }
    this.battle = state;
    this.mySide = mySide;
    this.prev = null; // write every field on the next update
    this.tracker.reset();
    this.timeline = [];
    this.lastEnd = null;
    this.resultEntered = false;
    this.revealAt = 0;
    window.clearTimeout(this.revealTimer);
    this.result.hide();
    closeBattleMenu();
    this.walletAtStart = this.cb.wallet?.() ?? null;
    this.refreshLabels();
  }

  update(state: BattleState, mySide: Side = "player"): void {
    if (state !== this.battle || mySide !== this.mySide) this.beginBattle(state, mySide, false);
    this.tracker.observe(state);
    const m = hudModel(state, mySide, pendingSpend());
    const p = this.prev;
    this.prev = m;

    // Clock.
    if (m.clockText !== p?.clockText) this.clock.textContent = m.clockText;
    if (m.overtime !== p?.overtime) this.clock.classList.toggle("overtime", m.overtime);

    // Crown counters — pop when a tower falls.
    if (m.crowns.me !== p?.crowns.me) {
      this.playerCrowns.textContent = fmtNum(m.crowns.me);
      if (p && m.crowns.me > p.crowns.me) this.popCrowns("player");
    }
    if (m.crowns.them !== p?.crowns.them) {
      this.enemyCrowns.textContent = fmtNum(m.crowns.them);
      if (p && m.crowns.them > p.crowns.them) this.popCrowns("enemy");
    }

    // Elixir.
    if (m.elixirPct !== p?.elixirPct) this.elixirBar.style.setProperty("--elixir", String(m.elixirPct));
    if (m.elixirInt !== p?.elixirInt) {
      this.elixirNum.textContent = fmtNum(m.elixirInt);
      this.elixirBar.setAttribute("aria-valuenow", String(m.elixirInt));
    }
    if (m.mult !== p?.mult) {
      this.multTag.textContent = m.mult;
      this.elixirBar.classList.toggle("x2", m.mult !== "");
    }
    if (m.leak !== p?.leak) {
      // One class on the row drives both the bar and the droplet pulse.
      this.elixirRow.classList.toggle("leak", m.leak);
      if (m.leak && p) this.cb.onElixirLeak?.();
    }

    // King's Ability.
    if (m.ability.id !== p?.ability.id) {
      const id = m.ability.id;
      this.abilityBtn.hidden = id === null;
      if (id) {
        const def = ABILITIES[id];
        const name = tr(def.name, def.ar);
        this.abilityBtn.title = `${name}: ${tr(def.blurb, def.blurbAr)}`;
        this.abilityBtn.setAttribute("aria-label", tr(`King's Ability: ${name}`, `قدرة الملك: ${name}`));
        this.abilityIcon.innerHTML = icon(ABILITY_ICON[id]);
      }
    }
    if (m.ability.pct !== p?.ability.pct) this.abilityBtn.style.setProperty("--charge", String(m.ability.pct));
    if (m.ability.ready !== p?.ability.ready) {
      this.abilityBtn.classList.toggle("ready", m.ability.ready);
      if (m.ability.ready && p && !reducedMotion()) this.restartAnim(this.abilityBtn, "ready-pop");
    }

    // Hand: rebuild a slot's art only when its card changes.
    m.hand.forEach((slot, i) => {
      const s = this.slots[i];
      if (!s) return;
      const before = p?.hand[i];
      if (slot.id !== before?.id) this.dealCard(i, slot.id, state, mySide, !!before);
      if (slot.cost !== before?.cost || slot.id !== before?.id) {
        s.cost.textContent = slot.cost === null ? "?" : fmtNum(slot.cost);
      }
      if (slot.affordable !== before?.affordable) {
        s.btn.classList.toggle("locked", !slot.affordable);
        if (slot.affordable && before && before.id === slot.id && !reducedMotion()) {
          this.restartAnim(s.btn, "ready-pop");
        }
      }
      // Charge and "+N" share one style write (CSS draws the number), so an
      // elixir tick costs each card at most one mutation.
      if (slot.chargePct !== before?.chargePct || slot.need !== before?.need) {
        s.btn.style.cssText = `--charge:${slot.chargePct};--need:${slot.need}`;
      }
      // A Mirror with nothing to copy shows a dash — it is simply dead.
      if ((slot.cost === null) !== (before?.cost === null)) s.btn.classList.toggle("dead", slot.cost === null);
    });
    if (m.next !== p?.next) {
      this.nextArt.replaceChildren();
      if (m.next) {
        this.nextArt.appendChild(handCardCanvas(m.next, 34));
        this.nextWrap.setAttribute("aria-label", tr(`Next: ${cardDisplayName(m.next)}`, `التالية: ${cardDisplayName(m.next)}`));
        if (p && !reducedMotion()) this.restartAnim(this.nextArt, "slide-in");
      }
    }

    // Match end: slow-mo, then the result screen.
    if (m.result && !this.resultEntered) {
      this.resultEntered = true;
      const delay = reducedMotion() ? REVEAL_MS_CALM : REVEAL_MS;
      this.revealAt = performance.now() + delay;
      const stats = buildResultStats(state, mySide, this.tracker.bySide);
      const lines = mergeTimeline(this.timeline);
      const tip = m.result.outcome === "loss" ? lossTip(stats, mySide) : null;
      window.clearTimeout(this.revealTimer);
      this.revealTimer = window.setTimeout(() => this.reveal(state, m, stats, lines, tip), delay);
    }
  }

  private reveal(
    state: BattleState,
    m: HudModel,
    stats: ReturnType<typeof buildResultStats>,
    timeline: ReturnType<typeof mergeTimeline>,
    tip: string | null,
  ): void {
    if (state !== this.battle || !m.result) return;
    this.revealAt = 0;
    closeBattleMenu();
    const end = this.lastEnd && this.lastEnd.battle === state ? this.lastEnd : null;
    const ladder = !!end && end.kind === "ladder" && !end.online && !end.sandbox && !end.replay;
    const now = this.cb.wallet?.() ?? null;
    const goldDelta = now && this.walletAtStart ? now.gold - this.walletAtStart.gold : null;
    const online = this.cb.isOnline?.() ?? end?.online ?? false;
    const chest = this.rewardChest;
    this.result.show(
      {
        outcome: m.result.outcome,
        myCrowns: m.result.myCrowns,
        theirCrowns: m.result.theirCrowns,
        myName: this.playerName.textContent ?? tr("You", "أنت"),
        theirName: this.enemyName.textContent ?? tr("Bot", "الروبوت"),
        trophyDelta: ladder && end ? end.trophyDelta : null,
        goldDelta: goldDelta && goldDelta > 0 ? goldDelta : null,
        chest,
        note: ladder ? null : rewardWords(this.reward),
        extras: end ? resultExtras(end) : [],
        stats,
        timeline,
        tip,
        mySide: this.mySide,
        online,
        chestReady: this.cb.chestReady?.() ?? false,
      },
      {
        onOk: () => {
          if (chest) {
            try {
              sessionStorage.setItem("cr-clone-pulse-chest", "1");
            } catch {
              // storage blocked: the chest simply does not pulse
            }
          }
          this.dismiss();
          (this.cb.onHome ?? this.cb.onRestart)();
        },
        onAgain: () => this.cb.onRestart(),
        onOpenChest: this.cb.onOpenChest
          ? () => {
              this.dismiss();
              this.cb.onOpenChest?.();
            }
          : undefined,
      },
    );
  }

  /** Put a card into hand slot i (art, cost, chips), animating a fresh draw. */
  private dealCard(i: number, id: CardId, state: BattleState, mySide: Side, animate: boolean): void {
    const s = this.slots[i];
    const btn = s.btn;
    const card = getCard(id);
    btn.dataset.card = id;
    btn.dataset.rarity = card.rarity;
    btn.setAttribute("aria-label", tr(`${cardDisplayName(id)}, ${card.cost} elixir`, `${cardDisplayName(id)}، ${fmtNum(card.cost)} إكسير`));
    btn.classList.toggle("selected", this.selected === id);
    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = cardDisplayName(id);
    const key = document.createElement("div");
    key.className = "key-chip";
    key.textContent = String(i + 1); // keyboard shortcut hint
    const parts: HTMLElement[] = [handCardCanvas(id), name, s.veil, s.need, s.cost, key];
    const me = mySide === "player" ? state.player : state.enemy;
    const lvl = me.levels[id] ?? 1;
    if (lvl > 1) {
      const chip = document.createElement("div");
      chip.className = "lvl-chip";
      // Arabic "مستوى" is too wide for the corner; the number alone reads.
      chip.textContent = tr(`Lv.${lvl}`, fmtNum(lvl));
      chip.title = tr(`Level ${lvl}`, `مستوى ${fmtNum(lvl)}`);
      parts.push(chip);
    }
    btn.replaceChildren(...parts);
    if (animate && !reducedMotion()) this.restartAnim(btn, "dealt");
  }

  private restartAnim(node: HTMLElement, cls: string): void {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }
}

/** The words of a settlement line: "First clear! +50 <coin>" reads "First clear!". */
export function rewardWords(text: string | null): string | null {
  if (!text) return null;
  const words = text
    .replace(/[+\-−]?\d+\s*\p{Extended_Pictographic}️?/gu, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/(^[\s·]+|[\s·]+$)/g, "")
    .trim();
  return words || null;
}
