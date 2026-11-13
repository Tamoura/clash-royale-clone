import "../ui/styles/hud.css";
import { fmtNum, tr } from "../ui/i18n";
import type { BattleState } from "../game/battle";
import { ABILITIES, type AbilityId } from "../game/abilities";
import { icon, type CrestIndex, type IconName } from "../ui/icons";
import type { Side } from "../game/arena";
import { getCard, type CardId } from "../game/cards";
import { cardStatLines } from "../render/cardinfo";
import { cardDisplayName } from "../render/cardNames";
import { blurbText, cardBlurb } from "../render/cardBlurbs";
import { CARD_COLOR } from "../render/cardcolors";
import { drawCardArt } from "../render/characters";
import { cardPortrait } from "./cardportraits";
import { on, pendingSpend, setPresentTimeScale, type MatchEndPayload } from "../app/hooks";
import { resultExtras } from "../app/slots";
import { battleMenuOpen, battleMenuPausing, closeBattleMenu, openBattleMenu } from "../ui/battleMenu";
import { getPrefs, onPrefs, reducedMotion } from "../ui/prefs";
import { CARD_ASPECT } from "../ui/layout";
import {
  DROP_HINT_GUTTER,
  MATCH_CLOCK,
  PIP_SIZE,
  balancedLines,
  lanePillY,
  pipPlacement,
  type PlaceVerdict,
  type ScreenRect,
  TowerDamageTracker,
  abilitySecondsLeft,
  buildResultStats,
  chargingText,
  dropHintCenterX,
  goalText,
  hudModel,
  lossTip,
  mergeTimeline,
  resultReason,
  type ClockMode,
  type HudModel,
  type TimelineEntry,
} from "./hudModel";
import { ResultScreen } from "./result";
import { teamCss } from "./teamColors";

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
/** A press on a hand card held this long (and this still) opens its info bubble. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 8;
/** How long the refused-drop label and the KING "Charging" bubble stay up. */
const DROP_HINT_MS = 1200;
const CHARGING_MS = 1500;
/** A lane label narrower than this (px) stacks its padlock over the words. */
const LANE_PILL_NARROW = 150;
/** How long the challenge goal card stays up after the match starts. */
const GOAL_CARD_MS = 5200;
/** Replay speeds offered by the pill under the clock. */
export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
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
 * Backing width (CSS px) of the hand's card art. CSS sizes the canvas to its
 * card (up to 112px wide in the desktop side panel), so this only sets how
 * sharp the art stays at that size.
 */
const HAND_ART_W = 112;
/** The hand's cards are small, so their art zooms in on the character (1 = the whole figure). */
const HAND_ART_ZOOM = 1.16;

/**
 * A full-bleed card portrait, `aspect` tall for its width (3:4 in the info
 * bubble, 4:5 in the hand): the card's colour as a lit backdrop, the
 * pre-rendered 3D character cropped to fill it (spells keep painted art).
 * `zoom` over 1 crops in on the character's head and body.
 */
function handCardCanvas(id: CardId, w = 72, aspect = 4 / 3, zoom = 1): HTMLCanvasElement {
  const h = Math.round(w * aspect);
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
    // centred, so the sides crop and the whole figure stays in view; a zoom
    // crops the feet before the head.
    const s = h * 0.96 * zoom;
    ctx.drawImage(portrait, (w - s) / 2, (h - s) * 0.4, s, s);
  } else {
    drawCardArt(ctx, id, w / 2, h * 0.46, w * 0.6 * zoom);
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
  private readonly abilityBubble: HTMLElement;
  private readonly result: ResultScreen;
  private readonly clockTime: HTMLElement;
  private readonly clockHint: HTMLElement;
  private readonly cardBubble: HTMLElement;
  private readonly goalCard: HTMLElement;
  private readonly replayPill: HTMLElement;
  /** The clock mode for one battle (a challenge's survive goal); any other battle reads the match clock. */
  private clockGoal: { battle: BattleState; mode: ClockMode } | null = null;
  private onReplaySpeed: ((speed: ReplaySpeed) => void) | null = null;
  /** The replay battle the speed pill belongs to; any other battle hides it. */
  private replayBattle: BattleState | null = null;
  private pillPlacedAt = 0;
  private chargingTimer = 0;
  /** The placement verdict pip and the "lane opened" label (one element each, made on first use). */
  private pipEl: HTMLDivElement | null = null;
  private pillEl: HTMLDivElement | null = null;
  private pillId = -1;
  /** The pocket width the label was last fitted to (px), and its size then: read once per fit, not per frame. */
  private pillFitW = -1;
  private pillW = 0;
  private pillH = 0;
  private goalTimer = 0;
  private reason: string | null = null;

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
    this.clock.dataset.label = tr("Time left", "الوقت المتبقي");
    this.clockTime = el("span", "clock-time", this.clock);
    // Overtime: how a tie is broken, in a small line under the clock.
    this.clockHint = el("span", "clock-hint", this.clock);
    this.clockHint.hidden = true;

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

    // ---- Bottom tray: the elixir rail, then Next (over the chat bubble), the
    // hand and KING in one row (the wide layout re-places them, see hud.css).
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
    // Keyboard hint (shown only with a mouse; see hud.css).
    const qKey = el("span", "key-chip hud-key", this.abilityBtn);
    qKey.textContent = "Q";
    qKey.setAttribute("aria-hidden", "true");
    // "Charging… 20s" when KING is tapped before it is ready.
    this.abilityBubble = el("span", "hud-ability-bubble", this.abilityBtn);
    this.abilityBubble.setAttribute("role", "status");
    this.abilityBubble.hidden = true;
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
      if (!id || this.cardBubble.classList.contains("show")) return;
      tip.innerHTML = "";
      const title = document.createElement("b");
      title.textContent = `${cardDisplayName(id)} · ${tr(`${getCard(id).cost} elixir`, `${fmtNum(getCard(id).cost)} إكسير`)}`;
      tip.appendChild(title);
      const blurb = blurbText(id);
      if (blurb) {
        const line = document.createElement("p");
        line.className = "card-tip-blurb";
        line.textContent = blurb;
        tip.appendChild(line);
      }
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

    // Long-press a hand card: a big info bubble above the hand (touch has no hover).
    this.cardBubble = el("div", "card-bubble", bottom);
    this.cardBubble.setAttribute("role", "tooltip");
    this.cardBubble.hidden = true;

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
      // Held still for LONG_PRESS_MS instead, the press shows the card's
      // info bubble; that press then never selects or deploys anything.
      let downX = 0;
      let downY = 0;
      let pressId = -1;
      let pressTimer = 0;
      let longPressed = false;
      // A press on the card that is already armed: only a tap (released
      // within 16 px) puts it down. A drag from it keeps it armed and
      // deploys on release, so a retry after "Your side only!" works.
      let tapDeselect = false;
      const cancelPress = (): void => {
        window.clearTimeout(pressTimer);
        pressTimer = 0;
      };
      btn.addEventListener("pointerdown", (ev) => {
        const id = btn.dataset.card as CardId | undefined;
        if (!id) return;
        ev.preventDefault();
        downX = ev.clientX;
        downY = ev.clientY;
        pressId = ev.pointerId;
        longPressed = false;
        cancelPress();
        if (ev.button === 0) {
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            longPressed = true;
            tapDeselect = false;
            btn.classList.remove("dragging");
            tip.classList.remove("show");
            this.cb.onSelectCard(null); // info, not a pick: nothing stays armed
            this.showCardBubble(id);
          }, LONG_PRESS_MS);
        }
        const selecting = this.selected !== id;
        tapDeselect = !selecting;
        if (selecting) this.cb.onSelectCard(id);
        btn.classList.add("dragging");
      });
      // Movement cancels the long-press (window-level: a mouse press is not captured).
      window.addEventListener("pointermove", (ev) => {
        if (!pressTimer || ev.pointerId !== pressId) return;
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (dx * dx + dy * dy >= LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) cancelPress();
      });
      const endDrag = (ev: PointerEvent): void => {
        cancelPress();
        btn.classList.remove("dragging");
        if (longPressed) {
          longPressed = false;
          this.hideCardBubble();
          return;
        }
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        const deselect = tapDeselect;
        tapDeselect = false;
        if (Math.sqrt(dx * dx + dy * dy) > 16) this.cb.onDeployAt(ev.clientX, ev.clientY);
        else if (deselect) this.cb.onSelectCard(null);
      };
      btn.addEventListener("pointerup", endDrag);
      btn.addEventListener("pointercancel", () => {
        cancelPress();
        longPressed = false;
        tapDeselect = false;
        this.hideCardBubble();
        btn.classList.remove("dragging");
      });
      // A mouse released off the card still ends its info press.
      window.addEventListener("pointerup", (ev) => {
        if (!longPressed || ev.pointerId !== pressId) return;
        longPressed = false;
        this.hideCardBubble();
      });
      // A long touch must not open the browser's own menu or text callout.
      btn.addEventListener("contextmenu", (ev) => ev.preventDefault());
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

    // The chat bubble (built by main.ts in the stage) lives in the tray too,
    // under Next, so it never covers a tile of the board.
    const emotes = document.getElementById("emotes");
    if (emotes) bottom.appendChild(emotes);

    // The elixir rail runs along the tray's top edge, droplet first.
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

    // Challenge goal: a card under the top bar for the first seconds.
    this.goalCard = el("div", "hud-goal", bottom.parentElement ?? bottom);
    this.goalCard.setAttribute("role", "status");
    this.goalCard.hidden = true;

    // Replay speed: one big 1x / 2x / 4x pill, placed under the clock.
    this.replayPill = document.createElement("div");
    this.replayPill.className = "replay-pill";
    this.replayPill.setAttribute("role", "group");
    this.replayPill.setAttribute("aria-label", tr("Replay speed", "سرعة الإعادة"));
    this.replayPill.hidden = true;
    const pillIcon = el("span", "replay-pill-icon", this.replayPill);
    pillIcon.innerHTML = icon("fast");
    pillIcon.setAttribute("aria-hidden", "true");
    for (const speed of REPLAY_SPEEDS) {
      const b = el("button", "replay-speed", this.replayPill);
      b.type = "button";
      b.dataset.speed = String(speed);
      b.textContent = tr(`${speed}x`, `${fmtNum(speed)}x`);
      b.setAttribute("aria-label", tr(`Speed ${speed}x`, `السرعة ${fmtNum(speed)}x`));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.setReplaySpeed(speed);
        this.onReplaySpeed?.(speed);
        b.blur();
      });
    }
    document.body.appendChild(this.replayPill);
    window.addEventListener("resize", () => this.placeReplayPill(true));

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

  /**
   * Shake the elixir row (can't afford) or the KING ring (not charged yet;
   * it also pops a "Charging… Ns" bubble). The KING never shakes the elixir
   * bar: its charge is not elixir. A bad spot shakes nothing in the hand:
   * its answer is on the field (the placement map, the words at the finger).
   */
  flashError(kind: "elixir" | "ability"): void {
    const target = kind === "elixir" ? this.elixirRow : this.abilityBtn;
    if (kind === "ability" && this.abilityBtn.hidden) return;
    target.classList.remove("error-shake");
    void target.offsetWidth; // restart the animation
    target.classList.add("error-shake");
    if (kind === "ability") this.showCharging();
  }

  /** The "Charging… Ns" bubble over KING, with N from the local side's meter. */
  private showCharging(): void {
    const b = this.battle;
    const secs = b ? abilitySecondsLeft(b, this.mySide) : null;
    if (secs === null || secs <= 0) return;
    this.abilityBubble.innerHTML = icon("hourglass");
    this.abilityBubble.appendChild(document.createTextNode(chargingText(secs)));
    this.abilityBubble.hidden = false;
    this.restartAnim(this.abilityBubble, "pop");
    window.clearTimeout(this.chargingTimer);
    this.chargingTimer = window.setTimeout(() => {
      this.abilityBubble.hidden = true;
    }, CHARGING_MS);
  }

  /**
   * A refused drop, said at the finger: a floating label at page point
   * (x, y) for 1.2 s ("Your side only!").
   */
  dropHint(text: string, clientX: number, clientY: number): void {
    document.querySelectorAll(".drop-hint").forEach((n) => n.remove());
    const label = document.createElement("div");
    label.className = "drop-hint";
    label.dir = "auto";
    label.setAttribute("role", "status");
    label.textContent = text;
    const vw = window.innerWidth;
    // At most 300px wide (and never wider than the screen less its gutters).
    label.style.setProperty("--half", `${Math.min(150, vw / 2 - DROP_HINT_GUTTER)}px`);
    label.style.left = "0px";
    label.style.top = `${Math.max(56, clientY - 56)}px`;
    document.body.appendChild(label);
    // Centred on the finger whenever its real width fits there.
    label.style.left = `${dropHintCenterX(clientX, label.offsetWidth, vw)}px`;
    window.setTimeout(() => label.remove(), DROP_HINT_MS);
  }

  /**
   * The verdict pip over the pointer while a card is held: a tick (yes), a
   * no-entry sign (no) or an hourglass (wait: the spot is fine, the elixir is
   * not). Shapes and sizes differ, so colour is never the only cue. One
   * element, reused; null hides it.
   */
  placePip(v: PlaceVerdict | null, x: number, y: number, pointerType: string, field: ScreenRect): void {
    if (!v) {
      if (this.pipEl) this.pipEl.hidden = true;
      return;
    }
    if (!this.pipEl) {
      const pip = document.createElement("div");
      pip.className = "place-pip";
      pip.setAttribute("aria-hidden", "true");
      document.body.appendChild(pip);
      this.pipEl = pip;
    }
    const pip = this.pipEl;
    if (pip.dataset.kind !== v) {
      pip.dataset.kind = v;
      pip.innerHTML = icon(`place-${v}`);
      pip.style.setProperty("--pip-yes", teamCss("player", "dark")); // the colour-blind palette's blue too
    }
    const at = pipPlacement(x, y, pointerType, field, PIP_SIZE[v]);
    const left = `${Math.round(at.x)}px`;
    const top = `${Math.round(at.y)}px`;
    if (pip.style.left !== left) pip.style.left = left;
    if (pip.style.top !== top) pip.style.top = top;
    if (pip.hidden) pip.hidden = false;
  }

  /**
   * "Drop troops here now!" with an open padlock, over a pocket that just
   * opened. Rebuilt only when `id` (the reveal) changes, so its pop plays
   * once; fades out from `age` 3.75 s; null removes it. With `room` (the
   * pocket band it may use, screen y) and `avoid` (the held card's preview
   * on screen), it steps to the band's top or bottom instead of hiding the
   * ghost, the hover disc or a spell's aim ring (hudModel lanePillY).
   */
  lanePill(
    box: { x: number; y: number; maxW: number } | null,
    text: string,
    still: boolean,
    id: number,
    age: number,
    room: { top: number; bottom: number } | null = null,
    avoid: ScreenRect | null = null,
  ): void {
    if (!box) {
      this.pillEl?.remove();
      this.pillEl = null;
      this.pillId = -1;
      return;
    }
    if (!this.pillEl || this.pillId !== id) {
      this.pillEl?.remove();
      const pill = document.createElement("div");
      pill.className = "lane-pill" + (still ? " still" : "");
      pill.setAttribute("role", "status");
      pill.dir = "auto";
      pill.innerHTML = icon("unlock");
      // Bare text nodes and a <br>, not spans: under Golden Age every span is
      // its own bidi isolate (unicode-bidi: plaintext), which would hide the
      // Arabic from dir="auto" and leave the padlock at the END of the line.
      // The <br> (the most even word gap) only shows when the words need two
      // lines (.two), so the pill shrink-wraps them.
      const [first, second] = balancedLines(text);
      pill.appendChild(document.createTextNode(second ? `${first} ` : first));
      if (second) pill.append(document.createElement("br"), document.createTextNode(second));
      pill.style.setProperty("--pill-bg", teamCss("player", "dark"));
      document.body.appendChild(pill);
      this.pillEl = pill;
      this.pillId = id;
      this.pillFitW = -1;
    }
    const pill = this.pillEl;
    const maxW = Math.floor(box.maxW);
    if (maxW !== this.pillFitW) this.fitLanePill(pill, maxW);
    const left = `${Math.round(box.x)}px`;
    const top = `${Math.round(lanePillY(box, this.pillW, this.pillH, room, avoid))}px`;
    if (pill.style.left !== left) pill.style.left = left;
    if (pill.style.top !== top) pill.style.top = top;
    const out = age >= 3.75;
    if (pill.classList.contains("out") !== out) pill.classList.toggle("out", out);
  }

  /**
   * Fit the lane label to a pocket `maxW` px wide (a new label, or a new
   * layout): one line when the words fit, else two even lines that the pill
   * shrink-wraps; in a narrow pocket (landscape phones) the padlock goes on
   * top and the words get a smaller size. Its size is read here, once per
   * fit, never per frame.
   */
  private fitLanePill(pill: HTMLDivElement, maxW: number): void {
    this.pillFitW = maxW;
    pill.style.maxWidth = `${maxW}px`;
    pill.classList.toggle("narrow", maxW < LANE_PILL_NARROW);
    pill.classList.remove("two");
    if (pill.offsetWidth >= maxW) pill.classList.add("two"); // one line hit the pocket's width: it wraps
    this.pillW = pill.offsetWidth;
    this.pillH = pill.offsetHeight;
  }

  /** Long-press info: art, name, cost, the kid one-liner, good-vs and watch-out portraits. */
  private showCardBubble(id: CardId): void {
    const box = this.cardBubble;
    box.replaceChildren();
    const card = getCard(id);
    const head = document.createElement("div");
    head.className = "cb-head";
    const art = handCardCanvas(id, 64);
    art.classList.add("cb-art");
    const text = document.createElement("div");
    text.className = "cb-text";
    const name = document.createElement("b");
    name.className = "cb-name";
    name.textContent = cardDisplayName(id);
    const cost = document.createElement("span");
    cost.className = "cb-cost";
    cost.innerHTML = icon("elixir");
    cost.appendChild(document.createTextNode(tr(`${card.cost} elixir`, `${fmtNum(card.cost)} إكسير`)));
    text.append(name, cost);
    const blurb = blurbText(id);
    if (blurb) {
      const p = document.createElement("p");
      p.className = "cb-blurb";
      p.dir = "auto";
      p.textContent = blurb;
      text.appendChild(p);
    }
    head.append(art, text);
    box.appendChild(head);
    const info = cardBlurb(id);
    const row = (label: string, ids: CardId[], cls: string): void => {
      if (!ids.length) return;
      const r = document.createElement("div");
      r.className = `cb-row ${cls}`;
      const l = document.createElement("span");
      l.className = "cb-label";
      l.textContent = label;
      r.appendChild(l);
      for (const ref of ids) {
        const cell = document.createElement("span");
        cell.className = "cb-mini";
        cell.title = cardDisplayName(ref);
        cell.setAttribute("aria-label", cardDisplayName(ref));
        cell.appendChild(handCardCanvas(ref, 30));
        const n = document.createElement("small");
        n.textContent = cardDisplayName(ref);
        cell.appendChild(n);
        r.appendChild(cell);
      }
      box.appendChild(r);
    };
    if (info) {
      row(tr("Good vs", "قوية ضد"), info.good, "good");
      row(tr("Watch out", "احذر من"), info.watch, "watch");
    }
    box.dataset.card = id;
    box.hidden = false;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
  }

  private hideCardBubble(): void {
    this.cardBubble.classList.remove("show");
    this.cardBubble.hidden = true;
  }

  /**
   * The clock mode for `battle`: a challenge's survive goal counts down and
   * gets a goal card at the start. Any other battle shows the match clock.
   */
  setClockGoal(battle: BattleState, mode: ClockMode): void {
    this.clockGoal = mode.kind === "match" ? null : { battle, mode };
    this.prev = null; // redraw the clock
    window.clearTimeout(this.goalTimer);
    this.goalCard.hidden = true;
    if (mode.kind === "survive") {
      this.goalCard.innerHTML = icon("shield");
      const t = document.createElement("span");
      t.dir = "auto";
      t.textContent = goalText(mode.seconds);
      this.goalCard.appendChild(t);
      this.goalCard.hidden = false;
      this.restartAnim(this.goalCard, "pop");
      this.goalTimer = window.setTimeout(() => {
        this.goalCard.hidden = true;
      }, GOAL_CARD_MS);
    }
  }

  private clockMode(state: BattleState): ClockMode {
    return this.clockGoal && this.clockGoal.battle === state ? this.clockGoal.mode : MATCH_CLOCK;
  }

  /** Esc: open the battle menu, or close it when it is open. */
  toggleMenu(): void {
    if (battleMenuOpen()) closeBattleMenu();
    else this.openMenu();
  }

  /**
   * The replay's speed pill under the clock, for `battle`: on with a
   * callback for the chosen speed, off (null) for any other match.
   */
  setReplayControl(onSpeed: ((speed: ReplaySpeed) => void) | null, battle: BattleState | null = null): void {
    this.onReplaySpeed = onSpeed;
    this.replayBattle = onSpeed ? battle : null;
    this.replayPill.hidden = onSpeed === null;
    this.setReplaySpeed(1);
    this.placeReplayPill(true);
  }

  private setReplaySpeed(speed: ReplaySpeed): void {
    this.replayPill.querySelectorAll<HTMLButtonElement>(".replay-speed").forEach((b) => {
      const on = Number(b.dataset.speed) === speed;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  /** Centre the replay pill under the clock (the layout moves the clock between modes). */
  private placeReplayPill(force = false): void {
    if (this.replayPill.hidden) return;
    const now = performance.now();
    if (!force && now - this.pillPlacedAt < 400) return;
    this.pillPlacedAt = now;
    const c = this.clock.getBoundingClientRect();
    if (c.width === 0) return;
    const w = this.replayPill.offsetWidth || 150;
    const h = this.replayPill.offsetHeight || 48;
    const left = Math.max(8, Math.min(window.innerWidth - 8 - w, c.left + c.width / 2 - w / 2));
    // Under the clock, then below anything of the top bar it would cover
    // (the menu button, the overtime tie hint; in the wide side panel, the
    // two scoreboards).
    let top = c.bottom + 8;
    const parts: HTMLElement[] = [];
    this.clock.parentElement
      ?.querySelectorAll<HTMLElement>(".crowns, .menu-toggle, .clock-hint")
      .forEach((n) => parts.push(n));
    for (let moved = true, guard = 0; moved && guard < 4; guard++) {
      moved = false;
      for (const part of parts) {
        const r = part.getBoundingClientRect();
        if (r.width === 0) continue;
        if (left < r.right && left + w > r.left && top < r.bottom && top + h > r.top) {
          top = r.bottom + 8;
          moved = true;
        }
      }
    }
    this.replayPill.style.left = `${Math.round(left)}px`;
    this.replayPill.style.top = `${Math.round(top)}px`;
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
    this.reason = null;
    this.revealAt = 0;
    window.clearTimeout(this.revealTimer);
    this.result.hide();
    closeBattleMenu();
    this.hideCardBubble();
    this.abilityBubble.hidden = true;
    if (this.clockGoal && this.clockGoal.battle !== state) {
      this.clockGoal = null;
      this.goalCard.hidden = true;
    }
    if (this.replayBattle !== state) this.setReplayControl(null);
    this.walletAtStart = this.cb.wallet?.() ?? null;
    this.refreshLabels();
  }

  update(state: BattleState, mySide: Side = "player"): void {
    if (state !== this.battle || mySide !== this.mySide) this.beginBattle(state, mySide, false);
    this.tracker.observe(state);
    const m = hudModel(state, mySide, pendingSpend(), this.clockMode(state));
    const p = this.prev;
    this.prev = m;

    // Clock.
    if (m.clockText !== p?.clockText) this.clockTime.textContent = m.clockText;
    if (m.overtime !== p?.overtime) this.clock.classList.toggle("overtime", m.overtime);
    if (m.survive !== p?.survive) {
      this.clock.classList.toggle("survive", m.survive);
      this.clock.dataset.label = m.survive ? tr("Challenge", "التحدي") : tr("Time left", "الوقت المتبقي");
    }
    if (m.hint !== p?.hint) {
      this.clockHint.textContent = m.hint ?? "";
      this.clockHint.hidden = m.hint === null;
    }
    this.placeReplayPill();

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
        this.nextArt.appendChild(handCardCanvas(m.next, 48, CARD_ASPECT, HAND_ART_ZOOM));
        this.nextWrap.setAttribute("aria-label", tr(`Next: ${cardDisplayName(m.next)}`, `التالية: ${cardDisplayName(m.next)}`));
        if (p && !reducedMotion()) this.restartAnim(this.nextArt, "slide-in");
      }
    }

    // Match end: slow-mo, then the result screen.
    if (m.result && !this.resultEntered) {
      this.resultEntered = true;
      // Read the why at the finish itself (tower HP for a tiebreak).
      this.reason = resultReason(state, mySide, this.clockMode(state));
      this.goalCard.hidden = true;
      this.replayPill.hidden = true;
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
        reason: this.reason,
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
    // No caption on the art: the button's label, the hover tip and the
    // long-press bubble name the card.
    const key = document.createElement("div");
    key.className = "key-chip";
    key.textContent = String(i + 1); // keyboard shortcut hint
    const parts: HTMLElement[] = [handCardCanvas(id, HAND_ART_W, CARD_ASPECT, HAND_ART_ZOOM), s.veil, s.need, s.cost, key];
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
