/**
 * The guided first battle, on screen: a coach bubble, a dim mask with a
 * cut-out around the thing to touch, and an animated hand that drags the
 * right card to the glowing tile. The lesson itself (steps, holds,
 * progress) is the pure machine in src/game/tutorial.ts; this module
 * starts the battle, feeds the machine and draws what it says.
 */
import "./styles/tutorial.css";
import type { AppCtx } from "../app/ctx";
import { on, registerSimHold } from "../app/hooks";
import type { BattleState } from "../game/battle";
import {
  TUTORIAL_STEP_COUNT,
  Tutorial,
  canPlay,
  markTutorialDone,
  markTutorialPaid,
  tutorialPaid,
  prepareTutorialBattle,
  tutorialChallenge,
  type TutorialStep,
  type TutorialTarget,
} from "../game/tutorial";
import { applyMatchResult } from "../match/rewards";
import { getPhase } from "./banner";
import { button, confirm } from "./components";
import { tr } from "./i18n";
import { icon } from "./icons";
import { reducedMotion } from "./prefs";
import { ARABIC } from "../render3d/theme";

export { tutorialDone } from "../game/tutorial";

const SVG_NS = "http://www.w3.org/2000/svg";

/** An original cartoon glove; the fingertip sits at HAND_TIP in its viewBox. */
const HAND_SVG =
  `<svg viewBox="0 0 64 72" aria-hidden="true" focusable="false">` +
  `<g stroke="#1a1030" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">` +
  `<path fill="#ffffff" d="M20 36V10a6 6 0 0 1 12 0v26z"/>` +
  `<path fill="#ffffff" d="M14 42c0-5 3-8 7-8h22c5 0 8 3 8 8v9c0 9-7 15-16 15h-6c-8 0-15-6-15-15z"/>` +
  `<path fill="#dfe7f2" stroke="none" d="M17 52c2 7 7 11 14 11h4c6 0 11-4 13-10-4 4-9 5-15 5s-12-2-16-6z"/>` +
  `<path fill="none" d="M33 34v8M41 34v8"/>` +
  `<path fill="#ffffff" d="M15 45c-5-1-8 1-8 5s3 6 8 6"/>` +
  `<rect class="tut-hand-cuff" x="17" y="63" width="30" height="8" rx="3"/>` +
  `</g></svg>`;
const HAND_VIEW = { w: 64, h: 72 };
const HAND_TIP = { x: 26, y: 5 };
const HAND_PX = 58;

interface View {
  key: string;
  holding: boolean;
  /** Mask cut-outs: card/anchor rectangles and the target tile. */
  rects: DOMRect[];
  tile: { x: number; y: number; r: number } | null;
  card: DOMRect | null;
  cardId: string | null;
  anchor: DOMRect | null;
}

interface Session {
  ctx: AppCtx;
  machine: Tutorial;
  battle: BattleState | null;
  /** The skip/retry dialog is open: keep the battle frozen. */
  modal: boolean;
  ended: "won" | "lost" | null;
  root: HTMLElement;
  mask: SVGSVGElement;
  maskPath: SVGPathElement;
  ringPath: SVGPathElement;
  trail: SVGPathElement;
  tileGlow: HTMLElement;
  hand: HTMLElement;
  ghost: HTMLElement;
  coach: HTMLElement;
  coachText: HTMLElement;
  coachHint: HTMLElement;
  dots: HTMLElement;
  actions: HTMLElement;
  viewKey: string;
  textKey: string;
  anims: Animation[];
  offs: (() => void)[];
}

let session: Session | null = null;

// ---- Geometry -----------------------------------------------------------------

/** A rounded-rectangle sub-path (for the mask's even-odd cut-outs). */
function roundRect(r: DOMRect, pad: number, rad: number): string {
  const x = r.left - pad;
  const y = r.top - pad;
  const w = r.width + pad * 2;
  const h = r.height + pad * 2;
  const k = Math.min(rad, w / 2, h / 2);
  return (
    `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}` +
    `A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}` +
    `V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`
  );
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
}

const cardButton = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#hud button.card[data-card="${id}"]`);

/** The HUD element a callout points at (data-tut hooks set by the HUD first). */
function anchorElement(anchor: TutorialStep["anchor"]): HTMLElement | null {
  const sel =
    anchor === "elixir"
      ? ['#hud [data-tut="elixir"]', "#hud .elixir-row", "#hud .elixir-bar"]
      : ['#hud [data-tut="ability"]', "#hud .hud-ability"];
  for (const s of sel) {
    const el = document.querySelector<HTMLElement>(s);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

/** The tile's screen position and a radius of about one tile. */
function tileOnScreen(ctx: AppCtx, t: TutorialTarget): { x: number; y: number; r: number } {
  const p = ctx.scene.arenaToClient(t.x, t.y);
  const q = ctx.scene.arenaToClient(t.x + 1.25, t.y);
  return { x: p.x, y: p.y, r: Math.max(26, Math.hypot(q.x - p.x, q.y - p.y)) };
}

/**
 * Should the sim and the pointer mask hold right now? The machine decides,
 * but only while the thing the player must touch can be found on screen.
 * If the HUD changes and the card or anchor is missing, fail open: no hold
 * and no mask, so the lesson can never soft-lock the player.
 */
function effectiveHold(s: Session, b: BattleState): boolean {
  if (!s.machine.holds(b)) return false;
  const step = s.machine.current;
  if (!step) return false;
  const target = step.target?.(b) ?? null;
  if (target) return canPlay(b, target.cardId) && cardButton(target.cardId) !== null;
  const tap = step.tapToContinue || (step.id === "king" && b.player.ability === null);
  if (step.anchor && !tap) return anchorElement(step.anchor) !== null;
  return true;
}

// ---- Building the overlay ------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent?.appendChild(n);
  return n;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  n.setAttribute("class", cls);
  parent.appendChild(n);
  return n;
}

function buildOverlay(): Pick<
  Session,
  "root" | "mask" | "maskPath" | "ringPath" | "trail" | "tileGlow" | "hand" | "ghost" | "coach" | "coachText" | "coachHint" | "dots" | "actions"
> {
  const root = el("div", "tut");
  root.hidden = true;
  const mask = svgEl("svg", "tut-mask", root);
  const maskPath = svgEl("path", "tut-mask-fill", mask);
  maskPath.setAttribute("fill-rule", "evenodd");
  const ringPath = svgEl("path", "tut-ring", mask);
  const trail = svgEl("path", "tut-trail", mask);
  const tileGlow = el("div", "tut-tile", root);
  const ghost = el("div", "tut-ghost", root);
  const hand = el("div", "tut-hand", root);
  hand.innerHTML = HAND_SVG;
  hand.style.width = `${HAND_PX}px`;

  const coach = el("div", "tut-coach", root);
  // The game canvas stays LTR, but the bubble reads in the edition's direction.
  coach.dir = ARABIC ? "rtl" : "ltr";
  coach.setAttribute("role", "status");
  coach.setAttribute("aria-live", "polite");
  const avatar = el("div", "tut-coach-avatar", coach);
  avatar.innerHTML = icon("crown");
  const body = el("div", "tut-coach-body", coach);
  const dots = el("div", "tut-dots", body);
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < TUTORIAL_STEP_COUNT; i++) el("i", "", dots);
  const coachText = el("p", "tut-coach-text", body);
  const coachHint = el("div", "tut-coach-hint", body);
  const actions = el("div", "tut-actions", body);
  document.body.appendChild(root);
  return { root, mask, maskPath, ringPath, trail, tileGlow, hand, ghost, coach, coachText, coachHint, dots, actions };
}

function skipLink(s: Session): HTMLButtonElement {
  const b = el("button", "tut-skip");
  b.type = "button";
  b.textContent = tr("Skip tutorial", "تخطَّ الشرح");
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void askSkip(s);
  });
  return b;
}

async function askSkip(s: Session): Promise<void> {
  if (s.modal) return;
  s.modal = true;
  const ok = await confirm({
    title: tr("Skip the tutorial?", "تخطّي الشرح؟"),
    body: tr("You can replay it any time from Settings.", "يمكنك إعادته في أي وقت من الإعدادات."),
    okLabel: tr("Skip", "تخطَّ"),
    cancelLabel: tr("Keep learning", "أكمل التعلّم"),
  });
  s.modal = false;
  if (ok && session === s) finish(s);
}

/** Done (won or skipped): never again, straight to Home. */
function finish(s: Session): void {
  s.machine.skip();
  markTutorialDone();
  const ctx = s.ctx;
  const won = s.ended === "won";
  stopTutorial();
  // The HUD only clears its result panel on its next battle frame; Home
  // shows before that, so clear it here the way the HUD does.
  const result = document.getElementById("overlay");
  if (result) {
    result.classList.remove("show");
    result.replaceChildren();
    delete result.dataset.kind;
  }
  if (won) {
    try {
      // Ask Home to draw the eye to the chest just earned.
      sessionStorage.setItem("cr-clone-pulse-chest", "1");
    } catch {
      // storage blocked: no pulse
    }
  }
  ctx.openHome();
}

// ---- Per-frame drawing ---------------------------------------------------------

function computeView(s: Session, b: BattleState, step: TutorialStep): View {
  const holding = effectiveHold(s, b);
  const target = step.target?.(b) ?? null;
  const rects: DOMRect[] = [];
  let tile: View["tile"] = null;
  let card: DOMRect | null = null;
  let anchor: DOMRect | null = null;
  if (target) {
    tile = tileOnScreen(s.ctx, target);
    const btn = canPlay(b, target.cardId) ? cardButton(target.cardId) : null;
    if (btn) {
      card = btn.getBoundingClientRect();
      rects.push(card);
    }
  } else if (step.anchor) {
    const a = anchorElement(step.anchor);
    if (a) {
      anchor = a.getBoundingClientRect();
      rects.push(anchor);
    }
  }
  // Coarse rounding: HUD cards pulse and pop, which must not restart the hand loop.
  const r = (n: number): number => Math.round(n / 4) * 4;
  const key = [
    holding ? 1 : 0,
    tile ? `${r(tile.x)},${r(tile.y)},${r(tile.r)}` : "-",
    card ? `${r(card.left)},${r(card.top)},${r(card.width)}` : "-",
    anchor ? `${r(anchor.left)},${r(anchor.top)},${r(anchor.width)},${r(anchor.height)}` : "-",
    window.innerWidth,
    window.innerHeight,
    target?.cardId ?? "",
  ].join("|");
  return { key, holding, rects, tile, card, cardId: target?.cardId ?? null, anchor };
}

function stopAnims(s: Session): void {
  for (const a of s.anims) a.cancel();
  s.anims = [];
}

/**
 * Put the hand's fingertip on (x, y). `down` turns it to point down from
 * above (for targets low on the screen); scaling happens around the tip.
 */
function handAt(x: number, y: number, scale = 1, down = false): string {
  const k = HAND_PX / HAND_VIEW.w;
  return (
    `translate(${x}px, ${y}px) rotate(${down ? 180 : 0}deg) scale(${scale}) ` +
    `translate(${-HAND_TIP.x * k}px, ${-HAND_TIP.y * k}px)`
  );
}

function drawView(s: Session, v: View): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  s.mask.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.mask.classList.toggle("on", v.holding);
  let holes = "";
  let rings = "";
  for (const rc of v.rects) {
    holes += roundRect(rc, 6, 14);
    rings += roundRect(rc, 6, 14);
  }
  if (v.tile) {
    holes += circle(v.tile.x, v.tile.y, v.tile.r * 1.15);
  }
  s.maskPath.setAttribute("d", `M0 0H${w}V${h}H0Z${holes}`);
  s.ringPath.setAttribute("d", rings);

  // The glowing tile.
  s.tileGlow.hidden = !v.tile;
  if (v.tile) {
    const d = v.tile.r * 2;
    s.tileGlow.style.width = `${d}px`;
    s.tileGlow.style.height = `${d}px`;
    s.tileGlow.style.transform = `translate(${v.tile.x - v.tile.r}px, ${v.tile.y - v.tile.r}px)`;
  }

  // A dotted trail from the card to the tile.
  if (v.card && v.tile) {
    const ax = v.card.left + v.card.width / 2;
    const ay = v.card.top + v.card.height * 0.35;
    const mx = (ax + v.tile.x) / 2 + (v.tile.x < ax ? 30 : -30);
    const my = Math.min(ay, v.tile.y) - 20;
    s.trail.setAttribute("d", `M${ax} ${ay}Q${mx} ${my} ${v.tile.x} ${v.tile.y}`);
  } else {
    s.trail.setAttribute("d", "");
  }

  stopAnims(s);
  s.ghost.hidden = true;
  s.hand.hidden = !(v.card || v.anchor);
  const still = reducedMotion();
  if (v.card && v.tile) {
    const from = { x: v.card.left + v.card.width / 2, y: v.card.top + v.card.height * 0.45 };
    const to = { x: v.tile.x, y: v.tile.y };
    const art = v.cardId ? cardButton(v.cardId)?.querySelector("canvas") : null;
    if (still) {
      s.hand.style.transform = handAt(to.x, to.y);
      s.hand.style.opacity = "1";
      return;
    }
    const keyframes: Keyframe[] = [
      { transform: handAt(from.x, from.y, 1), opacity: 0, offset: 0 },
      { transform: handAt(from.x, from.y, 1), opacity: 1, offset: 0.1 },
      { transform: handAt(from.x, from.y, 0.86), opacity: 1, offset: 0.22 },
      { transform: handAt(to.x, to.y, 0.86), opacity: 1, offset: 0.68 },
      { transform: handAt(to.x, to.y, 1), opacity: 1, offset: 0.8 },
      { transform: handAt(to.x, to.y, 1), opacity: 0, offset: 1 },
    ];
    s.anims.push(s.hand.animate(keyframes, { duration: 2200, iterations: Infinity, easing: "ease-in-out" }));
    if (art instanceof HTMLCanvasElement) {
      // A small copy of the card rides along under the finger.
      s.ghost.hidden = false;
      s.ghost.style.backgroundImage = `url(${art.toDataURL()})`;
      const gw = Math.min(46, v.card.width * 0.6);
      s.ghost.style.width = `${gw}px`;
      s.ghost.style.height = `${gw * 1.25}px`;
      const at = (x: number, y: number): string => `translate(${x - gw / 2}px, ${y - gw * 0.9}px)`;
      s.anims.push(
        s.ghost.animate(
          [
            { transform: at(from.x, from.y), opacity: 0, offset: 0 },
            { transform: at(from.x, from.y), opacity: 0, offset: 0.2 },
            { transform: at(from.x, from.y), opacity: 0.9, offset: 0.26 },
            { transform: at(to.x, to.y), opacity: 0.9, offset: 0.68 },
            { transform: at(to.x, to.y), opacity: 0, offset: 0.78 },
            { transform: at(to.x, to.y), opacity: 0, offset: 1 },
          ],
          { duration: 2200, iterations: Infinity, easing: "ease-in-out" },
        ),
      );
    }
  } else if (v.anchor) {
    // Point down at the HUD element from just above it, with a gentle tap.
    const x = v.anchor.left + v.anchor.width / 2;
    const y = v.anchor.top + Math.min(v.anchor.height * 0.3, 14);
    if (still) {
      s.hand.style.transform = handAt(x, y, 1, true);
      s.hand.style.opacity = "1";
      return;
    }
    s.anims.push(
      s.hand.animate(
        [
          { transform: handAt(x, y - 18, 1, true), opacity: 1 },
          { transform: handAt(x, y, 0.9, true), opacity: 1, offset: 0.5 },
          { transform: handAt(x, y - 18, 1, true), opacity: 1 },
        ],
        { duration: 1100, iterations: Infinity, easing: "ease-in-out" },
      ),
    );
  }
}

/** Coach copy for the current state of the step. */
function coachCopy(step: TutorialStep, b: BattleState, holding: boolean): [string, string] {
  if (step.id === "king" && b.player.ability === null) {
    return [
      "Their King woke up! Knock down the King tower to win the battle.",
      "استيقظ ملكهم! أسقط برج الملك لتفوز بالمعركة.",
    ];
  }
  const target = step.target?.(b);
  if (step.target && !target && step.idleText) return step.idleText;
  if (target && !holding && !canPlay(b, target.cardId) && step.hold) {
    return [
      `${step.text[0]} (Wait for the elixir.)`,
      `${step.text[1]} (انتظر الإكسير.)`,
    ];
  }
  return step.text;
}

function drawCoach(s: Session, b: BattleState, step: TutorialStep, holding: boolean): void {
  const [en, ar] = coachCopy(step, b, holding);
  const tap = step.tapToContinue || (step.id === "king" && b.player.ability === null);
  const index = typeof s.machine.step === "number" ? s.machine.step : TUTORIAL_STEP_COUNT;
  // Free-play steps dock the bubble low so the enemy towers stay in view.
  const placement = holding || tap ? "top" : "bottom";
  const key = `${en}|${tap}|${index}|${placement}`;
  if (key === s.textKey) return;
  s.textKey = key;
  s.coachText.textContent = tr(en, ar);
  s.coachHint.textContent = tap ? tr("Tap anywhere to continue", "اضغط في أي مكان للمتابعة") : "";
  s.coachHint.hidden = !tap;
  s.coach.dataset.place = placement;
  s.dots.querySelectorAll("i").forEach((d, i) => {
    d.className = i < index ? "done" : i === index ? "now" : "";
  });
  s.actions.replaceChildren(skipLink(s));
  s.coach.classList.remove("pop");
  void s.coach.offsetWidth;
  s.coach.classList.add("pop");
  s.root.dataset.tap = tap ? "1" : "";
}

/** Keep the bubble clear of the top bar and the HUD tray. */
function placeCoach(s: Session): void {
  const top = document.getElementById("topbar")?.getBoundingClientRect().bottom ?? 0;
  const hud = document.getElementById("hud")?.getBoundingClientRect().top ?? window.innerHeight;
  s.root.style.setProperty("--tut-top", `${Math.max(0, top)}px`);
  s.root.style.setProperty("--tut-bottom", `${Math.max(0, window.innerHeight - hud)}px`);
}

function render(s: Session, b: BattleState): void {
  const showing =
    !s.ended && !s.ctx.pickerRoot.classList.contains("show") && getPhase() === "playing" && !b.result;
  if (!showing) {
    if (!s.ended) {
      s.root.hidden = true;
      stopAnims(s);
      s.viewKey = "";
    }
    return;
  }
  s.root.hidden = false;
  s.root.classList.toggle("still", reducedMotion());
  const step = s.machine.current;
  if (!step) return;
  const view = computeView(s, b, step);
  placeCoach(s);
  if (view.key !== s.viewKey) {
    s.viewKey = view.key;
    drawView(s, view);
  }
  drawCoach(s, b, step, view.holding);
}

// ---- End of the battle ---------------------------------------------------------

function showEnding(s: Session, won: boolean): void {
  s.ended = won ? "won" : "lost";
  stopAnims(s);
  s.root.hidden = false;
  s.root.dataset.tap = "";
  s.root.classList.add("ending");
  s.mask.classList.add("on");
  s.maskPath.setAttribute("d", `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`);
  s.mask.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
  s.ringPath.setAttribute("d", "");
  s.trail.setAttribute("d", "");
  s.tileGlow.hidden = true;
  s.hand.hidden = true;
  s.ghost.hidden = true;
  s.coach.dataset.place = "center";
  s.dots.querySelectorAll("i").forEach((d) => (d.className = won ? "done" : ""));
  s.coachText.textContent = won
    ? tr(
        "Victory! You can deploy, defend, cast spells and win. Your first chest is waiting at Home.",
        "انتصار! تعرف الآن النشر والدفاع والتعاويذ والفوز. صندوقك الأول بانتظارك في الرئيسية.",
      )
    : tr("So close! Let's try that once more.", "اقتربت كثيرًا! لنحاول مرة أخرى.");
  s.coachHint.hidden = true;
  const actions: HTMLElement[] = [];
  if (won) {
    actions.push(button({ variant: "cta", size: "lg", label: tr("Continue", "متابعة"), onClick: () => finish(s) }));
  } else {
    const ctx = s.ctx;
    actions.push(
      button({ variant: "cta", size: "lg", label: tr("Try again", "حاول مجددًا"), onClick: () => startTutorial(ctx) }),
      skipLink(s),
    );
  }
  s.actions.replaceChildren(...actions);
  s.coach.classList.remove("pop");
  void s.coach.offsetWidth;
  s.coach.classList.add("pop");
  actions[0].focus();
}

// ---- Lifecycle -----------------------------------------------------------------

/** Tear the overlay down (the battle, if any, carries on untutored). */
export function stopTutorial(): void {
  const s = session;
  if (!s) return;
  session = null;
  stopAnims(s);
  for (const off of s.offs) off();
  s.root.remove();
}

/**
 * Start (or resume at the saved step) the guided battle. Already done:
 * straight Home.
 */
export function startTutorial(ctx: AppCtx): void {
  stopTutorial();
  const machine = new Tutorial();
  if (machine.done) {
    ctx.openHome();
    return;
  }
  const from = machine.step as number;
  const ch = tutorialChallenge(from);
  const s: Session = {
    ctx,
    machine,
    battle: null,
    modal: false,
    ended: null,
    ...buildOverlay(),
    viewKey: "",
    textKey: "",
    anims: [],
    offs: [],
  };
  session = s;

  // Taps on the dimmed area: continue a callout; anything else is ignored.
  s.root.addEventListener("pointerdown", (ev) => {
    if (s.ended || s.root.dataset.tap !== "1" || !s.battle) return;
    if ((ev.target as Element).closest(".tut-skip")) return;
    ev.preventDefault();
    if (s.machine.feed({ type: "tap" }, s.battle)) s.viewKey = "";
  });

  s.offs.push(
    registerSimHold(
      () =>
        session === s &&
        s.battle !== null &&
        !s.ended &&
        getPhase() === "playing" &&
        (s.modal || effectiveHold(s, s.battle)),
    ),
    on("matchStart", (m) => {
      if (s.battle === null) {
        s.battle = m.battle;
        prepareTutorialBattle(m.battle, ch);
        s.machine.enter(m.battle);
      } else if (m.battle !== s.battle) {
        stopTutorial(); // another match took over
      }
    }),
    on("screen", (m) => {
      if (m.id !== "battle" && session === s) stopTutorial();
    }),
    on("battleEvent", ({ ev }) => {
      if (!s.battle || s.ended) return;
      if (s.machine.feed(ev, s.battle)) s.viewKey = "";
    }),
    on("matchEnd", (m) => {
      if (m.battle !== s.battle || s.ended) return;
      const won = m.winner === "player";
      // The first win pays out like a ladder win: trophies, gold, a chest.
      // A replay from Settings teaches again but pays only once.
      if (won && !tutorialPaid()) {
        applyMatchResult(ctx, "player");
        markTutorialPaid();
      }
      window.setTimeout(() => {
        if (session === s) showEnding(s, won);
      }, reducedMotion() ? 300 : 1400);
      s.ended = won ? "won" : "lost";
      s.root.hidden = true;
      stopAnims(s);
    }),
    on("frame", ({ battle }) => {
      if (!battle || battle !== s.battle) return;
      if (!s.ended && s.machine.feed({ type: "frame" }, battle)) s.viewKey = "";
      render(s, battle);
    }),
    () => window.removeEventListener("resize", onResize),
  );
  const onResize = (): void => {
    s.viewKey = "";
  };
  window.addEventListener("resize", onResize);

  ctx.startChallenge(ch);
}
