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
import { icon, type IconName } from "./icons";

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

/** A short message that fades out after 2.4s. */
export function toast(text: string, tone: Tone = "neutral"): HTMLElement {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el("div", "ui-toast-host");
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const t = el("div", `ui-toast ui-toast--${tone}`, text);
  toastHost.appendChild(t);
  setTimeout(() => t.classList.add("is-leaving"), TOAST_MS);
  setTimeout(() => t.remove(), TOAST_MS + 400);
  return t;
}

export interface ConfirmOpts {
  title: string;
  body: string;
  okLabel: string;
  cancelLabel: string;
  /** Style OK as destructive (forfeit, reset...). */
  danger?: boolean;
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
    const cancel = button({ variant: "secondary", label: o.cancelLabel, onClick: () => finish(false) });
    const ok = button({ variant: o.danger ? "primary" : "cta", label: o.okLabel, onClick: () => finish(true) });
    if (o.danger) ok.classList.add("ui-btn--danger");
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
    // Destructive questions start on Cancel; others on OK.
    (o.danger ? cancel : ok).focus();
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
