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
import type { CardId } from "../game/cards";
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
import { cleanCode, handleJoinLink } from "../match/online";
import { applyMatchResult } from "../match/rewards";
import { getPhase } from "./banner";
import { button, confirm, sheet } from "./components";
import { tr } from "./i18n";
import { icon } from "./icons";
import { reducedMotion } from "./prefs";
import { cardDisplayName } from "../render/cardNames";
import { ARABIC } from "../render3d/theme";

export { tutorialDone } from "../game/tutorial";

const SVG_NS = "http://www.w3.org/2000/svg";

/** An original cartoon glove; the fingertip sits at HAND_TIP in its viewBox. */
export const HAND_SVG =
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
  /** The target card's name on a tinted chip above it. */
  chip: HTMLElement;
  coach: HTMLElement;
  coachText: HTMLElement;
  coachHint: HTMLElement;
  dots: HTMLElement;
  /** The bubble's top row: the step dots and the Skip link. */
  skipSlot: HTMLElement;
  actions: HTMLElement;
  /** Clicks on the overlay are ignored until this time (performance.now ms). */
  swallowUntil: number;
  /** The last pointerdown anywhere, and whether that pointer is still down. */
  pointerDownAt: number;
  pointerIsDown: boolean;
  /** A step advanced while the pointer was down: guard 350 ms past its release too. */
  swallowAfterUp: boolean;
  /** A step advanced under a finger and its new layout is not drawn yet. */
  guardArmed: boolean;
  viewKey: string;
  textKey: string;
  anims: Animation[];
  /** The coach's answer to a wrong press (see pressNudge). */
  nudge: NudgeState;
  /** Presses on the dimmed area during this battle (a dev/test aid). */
  nudges: number;
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
    // Rendered with a size (offsetParent is null for the wide layout's
    // position: fixed controls, which are on screen all the same).
    if (el && !el.hidden && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

// ---- Wrong presses -------------------------------------------------------------

/** How long the coach's nudge line stays up before the step's own line returns. */
export const NUDGE_MS = 2800;
/** A press this soon after the last nudge is part of the same burst: no second wiggle. */
export const NUDGE_BURST_MS = 300;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The card whose box holds (x, y), if any. */
export function cardAt(cards: readonly { id: string; rect: Box }[], x: number, y: number): string | null {
  for (const c of cards) {
    const r = c.rect;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c.id;
  }
  return null;
}

/**
 * What the coach says when the kid presses the dimmed screen during a
 * lesson: a card that is not the lesson's (`pressed`), or anywhere else
 * (null). The line names the card to use, in the edition's own card names
 * (`name`). Null when there is nothing to point at.
 */
export function nudgeCopy(
  step: Pick<TutorialStep, "anchor">,
  target: CardId | null,
  pressed: string | null,
  name: (id: CardId) => string,
): [string, string] | null {
  if (target) {
    const n = name(target);
    if (pressed === target) return null;
    return pressed
      ? [`Not that one. Use the glowing ${n} card!`, `ليست هذه. استخدم بطاقة ${n} المضيئة!`]
      : [`Drag the glowing ${n} card onto the glowing spot!`, `اسحب بطاقة ${n} المضيئة إلى البقعة المضيئة!`];
  }
  if (step.anchor === "ability") {
    return pressed
      ? ["Not a card this time. Tap your glowing King power!", "ليست بطاقة هذه المرة. اضغط قوة ملكك المضيئة!"]
      : ["Tap your glowing King power!", "اضغط قوة ملكك المضيئة!"];
  }
  return null;
}

/** The coach's nudge, apart from the DOM (each session holds one). */
export interface NudgeState {
  /** The line the coach says instead of the step's own, until `until` (performance.now ms). */
  text: [string, string] | null;
  until: number;
  /** The pointer whose press started the nudge, while it is still down. */
  pointer: number | null;
}

export function newNudge(): NudgeState {
  return { text: null, until: 0, pointer: null };
}

/**
 * Show `copy` from `now` for NUDGE_MS. True when this is a fresh nudge (the
 * target wiggles and the glove's drag replays), false inside a burst of
 * presses, which only keeps the line up.
 */
export function sayNudge(st: NudgeState, copy: [string, string], now: number): boolean {
  const fresh = now >= st.until - NUDGE_MS + NUDGE_BURST_MS;
  st.text = copy;
  st.until = now + NUDGE_MS;
  return fresh;
}

/** The nudge line to show now, or null for the step's own line. */
export function nudgeLine(st: NudgeState, holding: boolean, now: number): [string, string] | null {
  return holding && st.text !== null && now < st.until ? st.text : null;
}

/** A new step ends any nudge (its line belonged to the old one). */
export function clearNudge(st: NudgeState): void {
  st.text = null;
  st.until = 0;
  st.pointer = null;
}

/**
 * What a press on the overlay does. A callout's tap continues it. During a
 * lesson, a press on the dimmed area (a card that is not the lesson's, or
 * anywhere else) gets a nudge, never silence, and never plays anything.
 * Presses on the Skip link, before the battle or after its end do nothing.
 */
export function overlayPress(o: { live: boolean; onSkip: boolean; tapStep: boolean; onDim: boolean }): "none" | "continue" | "nudge" {
  if (!o.live || o.onSkip) return "none";
  if (o.tapStep) return "continue";
  return o.onDim ? "nudge" : "none";
}

/**
 * The kid pressed the dimmed screen during a lesson; `pressed` is the card
 * under the finger, or null. Starts the coach's nudge for the step the
 * machine is on. It never feeds the machine, so the step, and the clock
 * it holds, stay exactly as they were. Null when there is nothing to point
 * at; otherwise whether the nudge is fresh, and the lesson's card.
 */
export function pressNudge(
  st: NudgeState,
  machine: Pick<Tutorial, "current">,
  b: BattleState,
  pressed: string | null,
  now: number,
  name: (id: CardId) => string,
): { fresh: boolean; target: CardId | null } | null {
  const step = machine.current;
  if (!step) return null;
  const target = step.target?.(b)?.cardId ?? null;
  const copy = nudgeCopy(step, target, pressed, name);
  if (!copy) return null;
  return { fresh: sayNudge(st, copy, now), target };
}

/**
 * The finger that started a nudge lifted (a slow, wrong drag ends here):
 * say it again, so the drop gets an answer too. Null when there is nothing
 * to repeat (another finger, or the step moved on); otherwise whether the
 * repeat is fresh (a quick tap's release is part of its own burst).
 */
export function releaseNudge(st: NudgeState, pointer: number, now: number): boolean | null {
  if (st.pointer === null || st.pointer !== pointer) return null;
  st.pointer = null;
  return st.text ? sayNudge(st, st.text, now) : null;
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
  | "root"
  | "mask"
  | "maskPath"
  | "ringPath"
  | "trail"
  | "tileGlow"
  | "hand"
  | "ghost"
  | "chip"
  | "coach"
  | "coachText"
  | "coachHint"
  | "dots"
  | "skipSlot"
  | "actions"
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
  const chip = el("div", "tut-chip", root);
  chip.hidden = true;
  chip.setAttribute("aria-hidden", "true");
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
  // Top row: progress dots, and 'Skip tutorial' on the bubble's top edge,
  // as far from the HUD's KING / Next / emote row as the bubble allows.
  const head = el("div", "tut-coach-head", body);
  const dots = el("div", "tut-dots", head);
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < TUTORIAL_STEP_COUNT; i++) el("i", "", dots);
  const skipSlot = el("div", "tut-skip-slot", head);
  const coachText = el("p", "tut-coach-text", body);
  const coachHint = el("div", "tut-coach-hint", body);
  const actions = el("div", "tut-actions", body);
  document.body.appendChild(root);
  return { root, mask, maskPath, ringPath, trail, tileGlow, hand, ghost, chip, coach, coachText, coachHint, dots, skipSlot, actions };
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
  // 'Keep learning' is the big yellow button and Esc / a backdrop tap mean
  // keep learning too: skipping takes a deliberate tap on the plain one.
  const answer = confirm({
    title: tr("Skip the tutorial?", "تخطّي الشرح؟"),
    body: tr("You can replay it any time from Settings.", "يمكنك إعادته في أي وقت من الإعدادات."),
    okLabel: tr("Skip", "تخطَّ"),
    cancelLabel: tr("Keep learning", "أكمل التعلّم"),
    emphasis: "cancel",
  });
  // The dialog mounts on <body>: mirror it for Arabic.
  const modals = document.querySelectorAll<HTMLElement>("body > .ui-modal");
  if (ARABIC && modals.length) modals[modals.length - 1].dir = "rtl";
  const ok = await answer;
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
  // A friend's ?join= invite waited for the lesson: join now.
  if (inviteCode()) handleJoinLink(ctx);
}

// ---- Invite links -----------------------------------------------------------------

/** The friend's room code in this page's ?join=, if any (and well-formed). */
function inviteCode(): string | null {
  try {
    const raw = new URLSearchParams(location.search).get("join");
    return raw === null ? null : cleanCode(raw);
  } catch {
    return null;
  }
}

/** The invite sheet was answered on this page (Learn first keeps ?join for later). */
let inviteAnswered = false;

/**
 * A first-time player opened a friend's invite: offer to join right away
 * (the lesson waits for the next visit) or learn first and join after.
 * Dismissing the sheet means Learn first.
 */
function offerInvite(ctx: AppCtx, code: string): void {
  inviteAnswered = true;
  // Home behind the sheet: the arena holds still while the kid decides.
  ctx.openHome();
  const content = document.createElement("div");
  content.className = "tut-invite";
  const art = document.createElement("div");
  art.className = "tut-invite-art";
  art.innerHTML = icon("users");
  const text = document.createElement("p");
  text.className = "tut-invite-text";
  text.textContent = tr(
    `Your friend made game ${code} and is waiting for you. Join now, or learn the basics first and join right after.`,
    `صديقك أنشأ اللعبة ${code} وينتظرك. انضم الآن، أو تعلّم الأساسيات أولًا ثم انضم مباشرة.`,
  );
  const actions = document.createElement("div");
  actions.className = "tut-invite-actions";
  let picked: "join" | "learn" | null = null;
  const pick = (choice: "join" | "learn"): void => {
    if (picked) return;
    picked = choice;
    sheetRef.close();
  };
  const join = button({ variant: "cta", size: "lg", icon: "play", label: tr("Join now", "انضم الآن"), onClick: () => pick("join") });
  join.classList.add("tut-invite-join");
  const learn = button({ variant: "secondary", size: "lg", icon: "book", label: tr("Learn first", "تعلّم أولًا"), onClick: () => pick("learn") });
  learn.classList.add("tut-invite-learn");
  actions.append(join, learn);
  content.append(art, text, actions);
  // A plain kit sheet styled like the menus' sheets (frame.ts openSheet,
  // which this module cannot import without a cycle through frame.ts).
  const sheetRef = sheet({
    title: tr("Your friend is waiting!", "صديقك بانتظارك!"),
    content,
    onClose: () => {
      if (picked === "join") {
        // The lesson is not marked done: it runs on the next visit.
        stopTutorial();
        ctx.openHome();
        handleJoinLink(ctx);
      } else {
        runTutorial(ctx);
      }
    },
  });
  sheetRef.el.classList.add("v2-sheet", "tut-invite-sheet");
  sheetRef.el.classList.toggle("v2-calm", reducedMotion());
  if (ARABIC) sheetRef.el.dir = "rtl";
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

  // The target card's name on a tinted chip just above it.
  s.chip.hidden = !(v.holding && v.card && v.cardId);
  if (v.holding && v.card && v.cardId) {
    s.chip.textContent = cardDisplayName(v.cardId as CardId);
    s.chip.style.left = `${v.card.left + v.card.width / 2}px`;
    s.chip.style.top = `${v.card.top - 10}px`;
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
  const line = nudgeLine(s.nudge, holding, performance.now());
  const nudging = line !== null;
  const [en, ar] = line ?? coachCopy(step, b, holding);
  const tap = step.tapToContinue || (step.id === "king" && b.player.ability === null);
  const index = typeof s.machine.step === "number" ? s.machine.step : TUTORIAL_STEP_COUNT;
  // Free-play steps dock the bubble low so the enemy towers stay in view.
  const placement = holding || tap ? "top" : "bottom";
  const key = `${en}|${tap}|${index}|${placement}`;
  if (key === s.textKey) return;
  s.textKey = key;
  s.coachText.textContent = tr(en, ar);
  s.coach.classList.toggle("nudge", nudging);
  s.coachHint.textContent = tap ? tr("Tap anywhere to continue", "اضغط في أي مكان للمتابعة") : "";
  s.coachHint.hidden = !tap;
  s.coach.dataset.place = placement;
  s.dots.querySelectorAll("i").forEach((d, i) => {
    d.className = i < index ? "done" : i === index ? "now" : "";
  });
  s.skipSlot.replaceChildren(skipLink(s));
  s.actions.replaceChildren();
  s.coach.classList.remove("pop");
  void s.coach.offsetWidth;
  s.coach.classList.add("pop");
  s.root.dataset.tap = tap ? "1" : "";
}

/**
 * The HUD controls a docked bubble must stay above: the tray (#hud) with
 * the KING button, the emote bubble and the Next preview inside it (the
 * tall layout), or wherever a layout puts them (the wide one keeps KING
 * and the bubble in the left panel, beside the docked bubble's columns).
 */
const HUD_CONTROLS = ["#hud", "#hud .hud-ability", "#hud .hud-next", "#emotes .emote-toggle", "#emotes"];

/**
 * The lowest y the bubble may reach: the top of the highest HUD control
 * that shares columns with the bubble. Controls off to the side (the wide
 * layout's side panels) do not count; with none in the way it is the
 * screen's bottom edge.
 */
export function controlsTop(
  controls: readonly { top: number; left: number; right: number; width: number; height: number }[],
  span: { left: number; right: number },
  viewportHeight: number,
): number {
  let top = viewportHeight;
  for (const r of controls) {
    if (r.width <= 0 || r.height <= 0) continue; // hidden
    if (r.right <= span.left || r.left >= span.right) continue; // beside the bubble
    top = Math.min(top, r.top);
  }
  return Math.max(0, top);
}

/**
 * Keep the bubble clear of the top bar and the tray (the elixir rail, Next,
 * the emote bubble, the hand and KING). In the wide layout both sit in side
 * panels, so the bubble docks at the screen's own top or bottom, over the
 * board.
 */
function placeCoach(s: Session): void {
  const wide = document.documentElement.dataset.layout === "wide";
  const top = wide ? 0 : (document.getElementById("topbar")?.getBoundingClientRect().bottom ?? 0);
  const span = s.coach.getBoundingClientRect();
  const rects: DOMRect[] = [];
  for (const sel of HUD_CONTROLS) {
    const n = document.querySelector<HTMLElement>(sel);
    if (n && !n.hidden) rects.push(n.getBoundingClientRect());
  }
  const floor = controlsTop(rects, span, window.innerHeight);
  s.root.style.setProperty("--tut-top", `${Math.max(0, top)}px`);
  s.root.style.setProperty("--tut-bottom", `${Math.max(0, window.innerHeight - floor)}px`);
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

/**
 * The kid pressed the dimmed screen during a lesson (most often a card that
 * is not the lesson's): swap the coach line for a moment to name the card
 * to use, wiggle the glowing target and play the glove's drag again from
 * the start. The clock stays held; nothing is deployed.
 */
function nudge(s: Session, b: BattleState, ev: PointerEvent): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("#hud button.card[data-card]")).map((n) => ({
    id: n.dataset.card ?? "",
    rect: n.getBoundingClientRect(),
  }));
  const pressed = cardAt(cards, ev.clientX, ev.clientY);
  const r = pressNudge(s.nudge, s.machine, b, pressed, performance.now(), cardDisplayName);
  if (!r) return;
  s.nudge.pointer = ev.pointerId;
  s.nudges++;
  s.root.dataset.nudges = String(s.nudges);
  showNudge(s, b, r.fresh, r.target);
}

/** Draw the nudge line now; a fresh nudge also wiggles the target and replays the glove. */
function showNudge(s: Session, b: BattleState, fresh: boolean, target: CardId | null): void {
  const step = s.machine.current;
  if (!step) return;
  // Say it now, not on the next frame (a slow tablet may be a while).
  drawCoach(s, b, step, effectiveHold(s, b));
  if (!fresh) return;
  // Replay the glove's drag (and the card riding under it) from the start.
  for (const a of s.anims) {
    a.currentTime = 0;
    a.play();
  }
  if (reducedMotion()) return;
  const glow = target ? cardButton(target) : step.anchor ? anchorElement(step.anchor) : null;
  glow?.animate(
    [
      { rotate: "0deg", scale: "1" },
      { rotate: "-10deg", scale: "1.12", offset: 0.18 },
      { rotate: "9deg", scale: "1.12", offset: 0.38 },
      { rotate: "-7deg", scale: "1.08", offset: 0.58 },
      { rotate: "4deg", scale: "1.04", offset: 0.78 },
      { rotate: "0deg", scale: "1" },
    ],
    { duration: 650, easing: "ease-in-out" },
  );
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
  s.chip.hidden = true;
  s.coach.classList.remove("nudge");
  s.coach.dataset.place = "center";
  s.dots.querySelectorAll("i").forEach((d) => (d.className = won ? "done" : ""));
  s.coachText.textContent = won
    ? tr(
        "Victory! You can deploy, defend, cast spells and win. Your first chest is waiting at Home.",
        "انتصار! تعرف الآن النشر والدفاع والتعاويذ والفوز. صندوقك الأول بانتظارك في الرئيسية.",
      )
    : tr("So close! Let's try that once more.", "اقتربت كثيرًا! لنحاول مرة أخرى.");
  s.coachHint.hidden = true;
  s.skipSlot.replaceChildren();
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

/** Advance the machine with one input; note an advance made under a finger. */
function feed(s: Session, input: Parameters<Tutorial["feed"]>[0], b: BattleState): void {
  if (!s.machine.feed(input, b)) return;
  s.viewKey = "";
  clearNudge(s.nudge);
  const now = performance.now();
  // The finger that caused this (a tap on KING, a callout tap) is still on
  // the glass or just lifted: the click it fires next must not land on
  // whatever the new step put under it.
  if (s.pointerIsDown || now - s.pointerDownAt < 600) {
    s.swallowUntil = now + SWALLOW_MS;
    s.swallowAfterUp = s.pointerIsDown;
    // On a slow frame the new step can take a while to appear: the guard
    // runs again from the moment it is drawn (see the frame listener).
    s.guardArmed = true;
  }
}

/** How long the overlay ignores taps and clicks after a step changes under a finger. */
const SWALLOW_MS = 350;

/**
 * Start (or resume at the saved step) the guided battle. Already done:
 * straight Home. A friend's ?join= invite asks first (Join now or Learn
 * first); learning first still joins the friend when the lesson ends.
 */
export function startTutorial(ctx: AppCtx): void {
  stopTutorial();
  if (new Tutorial().done) {
    ctx.openHome();
    if (inviteCode()) handleJoinLink(ctx);
    return;
  }
  const code = inviteCode();
  if (code && !inviteAnswered && ctx.variant) {
    offerInvite(ctx, code);
    return;
  }
  runTutorial(ctx);
}

function runTutorial(ctx: AppCtx): void {
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
    swallowUntil: 0,
    pointerDownAt: -Infinity,
    pointerIsDown: false,
    swallowAfterUp: false,
    guardArmed: false,
    viewKey: "",
    textKey: "",
    anims: [],
    nudge: newNudge(),
    nudges: 0,
    offs: [],
  };
  session = s;

  // Right after a step changed under a finger, the overlay ignores taps
  // and clicks for a moment (so a tap on KING never lands on 'Skip').
  const swallow = (ev: Event): void => {
    if (performance.now() < s.swallowUntil) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  };
  s.root.addEventListener("click", swallow, true);

  // Taps on the dimmed area: continue a callout. During a lesson, a press
  // there (a card that is not the lesson's, or anywhere else) never plays
  // anything, so the coach points at the right card instead.
  s.root.addEventListener("pointerdown", (ev) => {
    const b = s.battle;
    const act = overlayPress({
      live: !s.ended && b !== null,
      onSkip: (ev.target as Element).closest(".tut-skip") !== null,
      tapStep: s.root.dataset.tap === "1",
      onDim: ev.target === s.maskPath && s.mask.classList.contains("on"),
    });
    if (!b || act === "none") return;
    if (act === "nudge") {
      nudge(s, b, ev);
      return;
    }
    ev.preventDefault();
    if (performance.now() < s.swallowUntil) return; // a double tap is one tap
    feed(s, { type: "tap" }, b);
  });

  // Where the finger is, for feed()'s guard (capture: before the HUD acts).
  const onDown = (): void => {
    s.pointerIsDown = true;
    s.pointerDownAt = performance.now();
  };
  const onUp = (ev: PointerEvent): void => {
    s.pointerIsDown = false;
    if (s.swallowAfterUp) {
      s.swallowAfterUp = false;
      s.swallowUntil = Math.max(s.swallowUntil, performance.now() + SWALLOW_MS);
    }
    // A wrong press let go (a slow drag ends here): the drop gets the nudge too.
    const b = s.battle;
    const fresh = releaseNudge(s.nudge, ev.pointerId, performance.now());
    if (fresh === null || !b || s.ended || !effectiveHold(s, b)) return;
    showNudge(s, b, fresh, s.machine.current?.target?.(b)?.cardId ?? null);
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);

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
      feed(s, ev, s.battle);
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
      if (!s.ended) feed(s, { type: "frame" }, battle);
      render(s, battle);
      if (s.guardArmed) {
        s.guardArmed = false;
        s.swallowUntil = Math.max(s.swallowUntil, performance.now() + SWALLOW_MS);
      }
    }),
    () => window.removeEventListener("resize", onResize),
    () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    },
  );
  const onResize = (): void => {
    s.viewKey = "";
  };
  window.addEventListener("resize", onResize);

  ctx.startChallenge(ch);
}
