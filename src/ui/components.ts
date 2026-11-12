/**
 * Shared UI kit: typed DOM builders for buttons, segmented pickers, bottom
 * sheets, screen headers, toasts, confirm dialogs, progress bars and
 * badges. Styles live in styles/components.css (selectors .ui-*, tokens
 * only), so every screen built from these looks the same in both editions.
 *
 * Builders return plain elements; callers mount them. Labels go in as
 * text (never HTML); icons come from icons.ts. The pure helpers exported
 * here (btnClass, clampProgress, segmentedNext, trapOrder) hold the logic
 * and are unit-tested without a DOM.
 */
import "./styles/components.css";
import "./styles/rewards.css";
import { fmtNum } from "./i18n";
import { icon, type IconName } from "./icons";
import { reducedMotion } from "./prefs";

export type ButtonVariant = "cta" | "primary" | "secondary" | "ghost" | "icon";
export type ButtonSize = "md" | "lg";
export type Tone = "neutral" | "accent" | "success" | "danger";

// ---- Pure helpers ---------------------------------------------------------

/** Class list for a button of this variant and size. */
export function btnClass(variant: ButtonVariant, size: ButtonSize = "md"): string {
  return `ui-btn ui-btn--${variant} ui-btn--${size}`;
}

/** Fill fraction 0..1 for value/max; bad input reads as empty. */
export function clampProgress(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** The option after (dir 1) or before (dir -1) `value`, wrapping around. */
export function segmentedNext<T>(options: readonly { value: T }[], value: T, dir: 1 | -1): T {
  if (options.length === 0) return value;
  const i = options.findIndex((o) => o.value === value);
  if (i < 0) return options[dir === 1 ? 0 : options.length - 1].value;
  return options[(i + dir + options.length) % options.length].value;
}

/**
 * Focus trap order: the index to focus after Tab (or Shift+Tab) from
 * `current` among `count` focusable elements; -1 when there are none.
 * Focus outside the list (current -1) enters at the first or last element.
 */
export function trapOrder(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

// ---- DOM helpers ----------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isRtl(node: Element): boolean {
  return getComputedStyle(node).direction === "rtl";
}

/** Keep Tab inside `root` while it is open. */
function trapFocus(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
  const next = trapOrder(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  e.preventDefault();
  if (next >= 0) items[next].focus();
  else root.focus();
}

// ---- Builders -------------------------------------------------------------

export interface ButtonOpts {
  variant: ButtonVariant;
  label?: string;
  icon?: IconName;
  size?: ButtonSize;
  /** Required for icon-only buttons. */
  ariaLabel?: string;
  onClick: (e: MouseEvent) => void;
}

/** A tappable button (at least 44x44) that sinks slightly when pressed. */
export function button(o: ButtonOpts): HTMLButtonElement {
  const b = el("button", btnClass(o.variant, o.size));
  b.type = "button";
  if (o.icon) b.insertAdjacentHTML("beforeend", icon(o.icon, o.icon === "back" ? "icon-back" : ""));
  if (o.label) b.appendChild(el("span", "ui-btn__label", o.label));
  if (o.ariaLabel) b.setAttribute("aria-label", o.ariaLabel);
  b.addEventListener("click", o.onClick);
  return b;
}

export interface SegmentOption<T> {
  value: T;
  label: string;
  icon?: IconName;
  /** One line shown under the group while this option is selected. */
  blurb?: string;
}

export interface SegmentedOpts<T> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  ariaLabel?: string;
}

/** A one-of-N picker (radio group) with the selected option's blurb below. */
export function segmented<T>(o: SegmentedOpts<T>): HTMLDivElement & { setValue(v: T): void } {
  const root = el("div", "ui-seg");
  const group = el("div", "ui-seg__group");
  group.setAttribute("role", "radiogroup");
  if (o.ariaLabel) group.setAttribute("aria-label", o.ariaLabel);
  const blurb = el("p", "ui-seg__blurb");
  blurb.setAttribute("aria-live", "polite");
  let current = o.value;
  const buttons = o.options.map((opt) => {
    const b = el("button", "ui-seg__opt");
    b.type = "button";
    b.setAttribute("role", "radio");
    if (opt.icon) b.insertAdjacentHTML("beforeend", icon(opt.icon));
    b.appendChild(el("span", "", opt.label));
    b.addEventListener("click", () => select(opt.value, true));
    group.appendChild(b);
    return b;
  });
  function render(): void {
    o.options.forEach((opt, i) => {
      const on = opt.value === current;
      buttons[i].classList.toggle("is-selected", on);
      buttons[i].setAttribute("aria-checked", String(on));
      buttons[i].tabIndex = on ? 0 : -1; // roving tabindex
    });
    const sel = o.options.find((opt) => opt.value === current);
    blurb.textContent = sel?.blurb ?? "";
    blurb.hidden = !sel?.blurb;
  }
  function select(v: T, notify: boolean): void {
    if (v === current) return;
    current = v;
    render();
    if (notify) o.onChange(v);
  }
  group.addEventListener("keydown", (e) => {
    const fwd = isRtl(group) ? "ArrowLeft" : "ArrowRight";
    const back = isRtl(group) ? "ArrowRight" : "ArrowLeft";
    let dir: 1 | -1 | 0 = 0;
    if (e.key === fwd || e.key === "ArrowDown") dir = 1;
    else if (e.key === back || e.key === "ArrowUp") dir = -1;
    if (!dir) return;
    e.preventDefault();
    select(segmentedNext(o.options, current, dir), true);
    buttons[o.options.findIndex((opt) => opt.value === current)]?.focus();
  });
  root.append(group, blurb);
  render();
  // setValue: reflect an outside change (e.g. a pref) without firing onChange.
  return Object.assign(root, { setValue: (v: T) => select(v, false) });
}

export interface SheetOpts {
  title: string;
  content: HTMLElement;
  onClose?: () => void;
}

/** Pixels of downward drag that dismiss a sheet. */
const SWIPE_CLOSE_PX = 80;

/**
 * A bottom sheet over a scrim, mounted on document.body. Closes on Esc, a
 * scrim tap, a swipe down from the handle/header, or close(). Focus is
 * trapped inside and returned to the opener afterwards.
 */
export function sheet(o: SheetOpts): { el: HTMLElement; close: () => void } {
  const opener = document.activeElement as HTMLElement | null;
  const root = el("div", "ui-sheet");
  const scrim = el("div", "ui-sheet__scrim");
  const panel = el("div", "ui-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.tabIndex = -1;
  const grab = el("div", "ui-sheet__grab");
  grab.appendChild(el("div", "ui-sheet__handle"));
  const title = el("h2", "ui-sheet__title", o.title);
  title.id = `ui-sheet-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute("aria-labelledby", title.id);
  grab.appendChild(title);
  const body = el("div", "ui-sheet__body");
  body.appendChild(o.content);
  panel.append(grab, body);
  root.append(scrim, panel);

  let closed = false;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else trapFocus(panel, e);
  };
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    root.classList.remove("is-open");
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      root.remove();
      opener?.focus?.();
      o.onClose?.();
    };
    // Wait for the slide-out; fall back in case transitions are disabled.
    panel.addEventListener("transitionend", (e) => e.target === panel && done());
    setTimeout(done, 450);
  }
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);

  // Swipe down on the handle/header to dismiss.
  let startY = -1;
  grab.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    grab.setPointerCapture(e.pointerId);
    panel.classList.add("is-dragging");
  });
  grab.addEventListener("pointermove", (e) => {
    if (startY < 0) return;
    panel.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const endDrag = (e: PointerEvent): void => {
    if (startY < 0) return;
    const dy = e.clientY - startY;
    startY = -1;
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    if (dy > SWIPE_CLOSE_PX) close();
  };
  grab.addEventListener("pointerup", endDrag);
  grab.addEventListener("pointercancel", endDrag);

  document.body.appendChild(root);
  requestAnimationFrame(() => {
    root.classList.add("is-open");
    (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus({ preventScroll: true });
  });
  return { el: root, close };
}

export interface ScreenHeaderOpts {
  title: string;
  onBack?: () => void;
  /** Element shown at the inline end (e.g. a currency chip or icon button). */
  trailing?: HTMLElement;
  backLabel?: string;
}

/** A screen title bar: back button at the inline start, title, optional trailing slot. */
export function screenHeader(o: ScreenHeaderOpts): HTMLElement {
  const h = el("header", "ui-header");
  if (o.onBack) {
    h.appendChild(button({ variant: "icon", icon: "back", ariaLabel: o.backLabel ?? "Back", onClick: o.onBack }));
  } else {
    h.appendChild(el("span", "ui-header__spacer"));
  }
  h.appendChild(el("h1", "ui-header__title", o.title));
  h.appendChild(o.trailing ?? el("span", "ui-header__spacer"));
  return h;
}

const TOAST_MS = 2400;
let toastHost: HTMLElement | null = null;

/** A vertical band of the screen (page px), e.g. a bar's top and bottom. */
export interface Band {
  top: number;
  bottom: number;
}

/** Gap kept between a toast and the bar it sits on. */
const TOAST_GAP = 12;

/**
 * Where toasts sit: near the bottom of the screen (titles live at the top),
 * lifted above any bar docked in the bottom half (the tab bar, a sticky
 * footer). Returns the host's distance from the viewport's bottom edge.
 */
export function toastBottom(viewportH: number, bars: readonly Band[], safeBottom = 0): number {
  let lift = Math.max(0, safeBottom);
  for (const b of bars) {
    if (!(b.bottom > b.top) || b.top < viewportH * 0.5 || b.top >= viewportH) continue;
    lift = Math.max(lift, viewportH - b.top);
  }
  return Math.round(lift + TOAST_GAP);
}

/**
 * Where toasts sit while a sheet or dialog is open (its panel's top edge at
 * `overlayTop`): just above the panel, over the dimmed screen, because a
 * sheet's own buttons (Upgrade, Add to deck) sit at its bottom, right where
 * the tab bar was. A panel that leaves no room above it gets the stack
 * pinned to the top of the screen, over the panel's handle and title strip,
 * never over its actions. Returns the host's distance from the viewport's
 * bottom edge for a stack `stackH` px tall.
 */
export function toastBottomOver(viewportH: number, overlayTop: number, stackH: number): number {
  const above = viewportH - overlayTop + TOAST_GAP;
  const pinned = viewportH - TOAST_GAP - Math.max(0, stackH);
  return Math.round(Math.max(TOAST_GAP, Math.min(above, pinned)));
}

/** Bars docked low on the screen right now (the tab bar, a sticky footer). */
const LOW_BARS = ".v2-tabs, .v2-footer";
/** Open panels that own the screen: a dialog box first (it sits above sheets), then the top sheet. */
const OVERLAY_PANELS = [".ui-modal .ui-modal__box", ".ui-sheet.is-open .ui-sheet__panel"];
/** Full-screen layers that hide the bars under them (the chest reveal). */
const FULL_COVERS = ".rw-reveal:not(.is-leaving)";

/** The top edge of the open dialog or sheet panel, or null when none is open. */
function overlayTop(): number | null {
  for (const sel of OVERLAY_PANELS) {
    const all = document.querySelectorAll<HTMLElement>(sel);
    const panel = all[all.length - 1];
    if (!panel) continue;
    const r = panel.getBoundingClientRect();
    if (r.height > 0 && r.top < window.innerHeight) return Math.max(0, r.top);
  }
  return null;
}

function placeToasts(host: HTMLElement): void {
  const top = overlayTop();
  if (top !== null) {
    host.style.bottom = `${toastBottomOver(window.innerHeight, top, host.offsetHeight)}px`;
    return;
  }
  const bars: Band[] = [];
  // Under a full-screen layer the bars are hidden: nothing to lift above.
  if (!document.querySelector(FULL_COVERS)) {
    document.querySelectorAll<HTMLElement>(LOW_BARS).forEach((n) => {
      if (n.offsetParent === null && getComputedStyle(n).position !== "fixed") return;
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bars.push({ top: r.top, bottom: r.bottom });
    });
  }
  host.style.bottom = `calc(${toastBottom(window.innerHeight, bars)}px + env(safe-area-inset-bottom, 0px))`;
}

/**
 * A short message that fades out after 2.4s (or `ms`, for a longer line a
 * young reader needs time for). Toasts stack near the bottom, above the tab
 * bar, so they never cover a screen's title or the wallet; with a sheet or
 * dialog open they sit just above its panel instead, clear of its buttons.
 */
export function toast(text: string, tone: Tone = "neutral", ms = TOAST_MS): HTMLElement {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el("div", "ui-toast-host");
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const t = el("div", `ui-toast ui-toast--${tone}`, text);
  toastHost.appendChild(t);
  // Placed once the new toast is in the stack, so its height counts.
  placeToasts(toastHost);
  setTimeout(() => t.classList.add("is-leaving"), ms);
  setTimeout(() => t.remove(), ms + 400);
  return t;
}

// ---- Reward bursts: coins fly into the wallet, which counts up ----------------

export type WalletKind = "gold" | "gems";

export interface Point {
  x: number;
  y: number;
}

/** Coins (or gems) that fly for a reward: 4 for a little, up to 12 for a lot. */
export function burstCount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(4, Math.min(12, Math.round(3 + Math.log2(amount + 1) * 1.2)));
}

/**
 * A point on coin i's flight (of n) from `a` to `b` at t in 0..1: first a
 * little scatter outwards from the button, then a curved swoop into the
 * wallet. Pure, so the shape is unit-tested.
 */
export function flightPoint(a: Point, b: Point, t: number, i: number, n: number): Point {
  const k = Math.min(1, Math.max(0, t));
  const ang = ((i + 0.5) / Math.max(1, n)) * Math.PI * 2;
  const spread = 26 + (i % 3) * 10;
  // Scatter: a burst ring round the start that the swoop then pulls in.
  const scatter = Math.sin(Math.min(1, k * 2.2) * Math.PI) * (1 - k);
  const sx = Math.cos(ang) * spread * scatter;
  const sy = Math.sin(ang) * spread * scatter;
  // Swoop: ease-in toward the target along a bowed path.
  const e = k * k * (3 - 2 * k);
  const bow = Math.sin(k * Math.PI) * (40 + (i % 4) * 12) * (i % 2 ? 1 : -1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: a.x + dx * e + (-dy / len) * bow + sx,
    y: a.y + dy * e + (dx / len) * bow + sy,
  };
}

/** The wallet number after `landed` of `n` coins have arrived (exact at the end). */
export function walletValue(from: number, to: number, landed: number, n: number): number {
  if (n <= 0 || landed >= n) return to;
  const k = Math.max(0, landed) / n;
  return Math.round(from + (to - from) * k);
}

/** Wallet counters, most specific first: tagged wallets, the top bar chip, a chest-room pill. */
const WALLET_SELECTORS: Record<WalletKind, string[]> = {
  gold: ['[data-wallet="gold"]', ".v2-topbar .v2-chip--gold", ".rw-chips .rw-pill:nth-child(1)"],
  gems: ['[data-wallet="gems"]', ".v2-topbar .v2-chip--gems", ".rw-chips .rw-pill:nth-child(2)"],
};

function onScreen(n: Element): boolean {
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** The wallet counter for gold or gems on screen now (the last mounted one wins), or null. */
export function walletTarget(kind: WalletKind): HTMLElement | null {
  for (const sel of WALLET_SELECTORS[kind]) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
      (n) => !n.closest(".rw-reveal") && onScreen(n),
    );
    if (all.length) return all[all.length - 1];
  }
  return null;
}

/** A gold and gems wallet (header trailing) that reward bursts fly into. */
export function walletChips(gold: number, gems: number): HTMLElement {
  const chips = el("div", "rw-chips rw-wallet");
  const pill = (kind: WalletKind, n: number): HTMLElement => {
    const p = el("span", "rw-pill");
    p.dataset.wallet = kind;
    p.innerHTML = `${icon(kind === "gold" ? "coin" : "gem")}<b>${fmtNum(n)}</b>`;
    return p;
  };
  chips.append(pill("gold", gold), pill("gems", gems));
  return chips;
}

function setWallet(target: HTMLElement, value: number): void {
  const num = target.querySelector("b") ?? target;
  num.textContent = fmtNum(value);
}

function bump(target: HTMLElement): void {
  target.classList.remove("is-bumped");
  void target.offsetWidth;
  target.classList.add("is-bumped");
}

export interface BurstOpts {
  /** Where the coins start: the claim button (or its rect, taken before a re-render). */
  from: Element | DOMRect;
  kind: WalletKind;
  amount: number;
  /** The wallet's total after the reward (the counter ends exactly here). */
  total: number;
}

const rectOf = (from: Element | DOMRect): DOMRect => (from instanceof Element ? from.getBoundingClientRect() : from);
const centre = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Fly a burst of coins (or gems) from a claim button into the wallet
 * counter, which ticks up as they land and ends on `total`. The wallet is
 * looked up after the caller's re-render, so callers pay first, rebuild,
 * then call this. With reduced motion (or no wallet on screen) the counter
 * just shows the total. Resolves when the last coin lands.
 */
export function rewardBurst(o: BurstOpts): Promise<void> {
  const start = centre(rectOf(o.from));
  const amount = Math.max(0, Math.floor(o.amount));
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      let target = walletTarget(o.kind);
      const n = burstCount(amount);
      if (!target || n === 0) return resolve();
      if (reducedMotion() || typeof document.body.animate !== "function") {
        setWallet(target, o.total);
        return resolve();
      }
      const from = Math.max(0, o.total - amount);
      setWallet(target, from);
      const layer = el("div", "rw-burst");
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
      const end = centre(target.getBoundingClientRect());
      let landed = 0;
      const FLIGHT = 720;
      const STAGGER = 55;
      for (let i = 0; i < n; i++) {
        const coin = el("span", `rw-burst__coin rw-burst__coin--${o.kind}`);
        coin.innerHTML = icon(o.kind === "gold" ? "coin" : "gem");
        layer.appendChild(coin);
        const frames: Keyframe[] = [];
        for (let f = 0; f <= 10; f++) {
          const t = f / 10;
          const p = flightPoint(start, end, t, i, n);
          const scale = t < 0.2 ? 0.5 + t * 3.5 : 1.2 - (t - 0.2) * 0.55;
          frames.push({ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`, opacity: t > 0.96 ? 0 : 1 });
        }
        const anim = coin.animate(frames, { duration: FLIGHT, delay: i * STAGGER, easing: "linear", fill: "both" });
        anim.onfinish = () => {
          coin.remove();
          landed++;
          if (!target?.isConnected) target = walletTarget(o.kind);
          if (target) {
            setWallet(target, walletValue(from, o.total, landed, n));
            bump(target);
          }
          if (landed >= n) {
            layer.remove();
            resolve();
          }
        };
      }
    });
  });
}

export interface ConfirmOpts {
  title: string;
  body: string;
  okLabel: string;
  cancelLabel: string;
  /** Style OK as destructive (forfeit, reset...). */
  danger?: boolean;
  /**
   * Which answer is the big yellow (CTA) button and takes the first focus.
   * "cancel" nudges toward staying put (e.g. "Keep learning" over "Skip").
   * Default: OK, or Cancel-focused with no CTA for a danger question.
   */
  emphasis?: "ok" | "cancel";
}

/** How the two confirm buttons look, and which one starts focused. */
export interface ConfirmLook {
  ok: ButtonVariant;
  cancel: ButtonVariant;
  /** OK carries the destructive red. */
  okDanger: boolean;
  focus: "ok" | "cancel";
}

/** The confirm dialog's button styling for these options (pure). */
export function confirmLook(o: Pick<ConfirmOpts, "danger" | "emphasis">): ConfirmLook {
  const okDanger = !!o.danger;
  if (o.emphasis === "cancel") {
    return { ok: okDanger ? "primary" : "secondary", cancel: "cta", okDanger, focus: "cancel" };
  }
  if (o.emphasis === "ok") {
    return { ok: okDanger ? "primary" : "cta", cancel: "secondary", okDanger, focus: "ok" };
  }
  return okDanger
    ? { ok: "primary", cancel: "secondary", okDanger, focus: "cancel" }
    : { ok: "cta", cancel: "secondary", okDanger, focus: "ok" };
}

/** A modal yes/no question. Resolves true on OK; false on Cancel, Esc or a scrim tap. */
export function confirm(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const opener = document.activeElement as HTMLElement | null;
    const root = el("div", "ui-modal");
    const box = el("div", "ui-modal__box");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const title = el("h2", "ui-modal__title", o.title);
    title.id = `ui-modal-${Math.random().toString(36).slice(2, 8)}`;
    box.setAttribute("aria-labelledby", title.id);
    const actions = el("div", "ui-modal__actions");
    const finish = (ok: boolean): void => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      opener?.focus?.();
      resolve(ok);
    };
    const look = confirmLook(o);
    if (o.emphasis) box.dataset.emphasis = o.emphasis;
    const cancel = button({ variant: look.cancel, label: o.cancelLabel, onClick: () => finish(false) });
    cancel.classList.add("ui-modal__cancel");
    const ok = button({ variant: look.ok, label: o.okLabel, onClick: () => finish(true) });
    ok.classList.add("ui-modal__ok");
    if (look.okDanger) ok.classList.add("ui-btn--danger");
    actions.append(cancel, ok);
    box.append(title, el("p", "ui-modal__body", o.body), actions);
    root.appendChild(box);
    root.addEventListener("click", (e) => {
      if (e.target === root) finish(false);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      } else trapFocus(box, e);
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    // Destructive questions (and Cancel-emphasis ones) start on Cancel; others on OK.
    (look.focus === "cancel" ? cancel : ok).focus();
  });
}

export interface ProgressOpts {
  value: number;
  max: number;
  /** Text inside the bar, e.g. "3 / 10". */
  label?: string;
}

/** A horizontal fill bar (role=progressbar). */
export function progressBar(o: ProgressOpts): HTMLElement {
  const bar = el("div", "ui-progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(o.max));
  bar.setAttribute("aria-valuenow", String(o.value));
  const fill = el("div", "ui-progress__fill");
  fill.style.width = `${clampProgress(o.value, o.max) * 100}%`;
  bar.appendChild(fill);
  if (o.label) bar.appendChild(el("span", "ui-progress__label", o.label));
  return bar;
}

/** A small pill label. */
export function badge(text: string, tone: Tone = "neutral"): HTMLElement {
  return el("span", `ui-badge ui-badge--${tone}`, text);
}

/** Gold and gems bursts from one claim, side by side; resolves when both have landed. */
export function rewardBursts(
  from: Element | DOMRect,
  gold: number,
  gems: number,
  totals: { gold: number; gems: number },
): Promise<void> {
  const r = rectOf(from);
  const jobs: Promise<void>[] = [];
  if (gold > 0) jobs.push(rewardBurst({ from: r, kind: "gold", amount: gold, total: totals.gold }));
  if (gems > 0) jobs.push(rewardBurst({ from: r, kind: "gems", amount: gems, total: totals.gems }));
  return Promise.all(jobs).then(() => undefined);
}
