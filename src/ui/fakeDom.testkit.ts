/**
 * A tiny DOM for unit tests of UI flows. Vitest runs these tests in node
 * with no DOM library, so this gives the screens that build plain elements
 * just enough: create and nest elements, classes, attributes, data-*,
 * text, simple selectors (tag, #id, .class, [attr], [attr="v"], :not(),
 * descendant and comma lists), events that capture and bubble, and focus.
 * There is no layout (every rect is zero) and no HTML parsing (innerHTML
 * is kept as a string). Only tests import it.
 */
import { vi } from "vitest";

type Handler = (e: FakeEvent) => void;
interface Listener {
  fn: Handler;
  capture: boolean;
}

export class FakeEvent {
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  stopped = false;
  [extra: string]: unknown;
  constructor(
    readonly type: string,
    init: Record<string, unknown> = {},
  ) {
    Object.assign(this, init);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

function isCapture(opts: unknown): boolean {
  return opts === true || (typeof opts === "object" && opts !== null && !!(opts as { capture?: boolean }).capture);
}

class FakeNode {
  parentNode: FakeElement | null = null;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: Handler, opts?: unknown): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture: isCapture(opts) });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Handler, opts?: unknown): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.findIndex((l) => l.fn === fn && l.capture === isCapture(opts));
    if (i >= 0) list.splice(i, 1);
  }

  /** Run this node's listeners for one phase of `e`. */
  fire(e: FakeEvent, phase: "capture" | "target" | "bubble"): void {
    e.currentTarget = this;
    for (const l of [...(this.listeners.get(e.type) ?? [])]) {
      if (phase === "capture" && !l.capture) continue;
      if (phase === "bubble" && l.capture) continue;
      l.fn(e);
    }
  }

  /** The path from the document down to this node. */
  path(): FakeNode[] {
    const out: FakeNode[] = [];
    for (let n: FakeNode | null = this; n; n = n.parentNode ?? (n instanceof FakeElement ? n.doc.rootFor(n) : null)) {
      out.unshift(n);
    }
    return out;
  }

  dispatchEvent(e: FakeEvent): boolean {
    e.target = this;
    const path = this.path();
    for (const n of path.slice(0, -1)) {
      n.fire(e, "capture");
      if (e.stopped) return !e.defaultPrevented;
    }
    this.fire(e, "target");
    for (const n of path.slice(0, -1).reverse()) {
      if (e.stopped) break;
      n.fire(e, "bubble");
    }
    return !e.defaultPrevented;
  }
}

class FakeClassList {
  constructor(private readonly el: FakeElement) {}
  private get names(): string[] {
    return this.el.className.split(/\s+/).filter(Boolean);
  }
  add(...names: string[]): void {
    const now = this.names;
    for (const n of names) if (!now.includes(n)) now.push(n);
    this.el.className = now.join(" ");
  }
  remove(...names: string[]): void {
    this.el.className = this.names.filter((n) => !names.includes(n)).join(" ");
  }
  contains(name: string): boolean {
    return this.names.includes(name);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };

/** "data-card" -> "card" (the dataset key). */
const dataKey = (attr: string): string => attr.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class FakeElement extends FakeNode {
  readonly tagName: string;
  className = "";
  id = "";
  dir = "";
  type = "";
  disabled = false;
  hidden = false;
  tabIndex = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  offsetParent: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void };
  readonly children: FakeElement[] = [];
  private attrs = new Map<string, string>();
  private ownText = "";
  private html = "";

  constructor(
    tag: string,
    readonly doc: FakeDocument,
  ) {
    super();
    this.tagName = tag.toUpperCase();
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (k: string, v: string) => void (style[k] = v),
      removeProperty: (k: string) => void delete style[k],
    });
  }

  get classList(): FakeClassList {
    return new FakeClassList(this);
  }

  get parentElement(): FakeElement | null {
    return this.parentNode;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string | null) {
    this.clear();
    this.ownText = v ?? "";
  }

  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.clear();
    this.html = v;
  }

  insertAdjacentHTML(_where: string, html: string): void {
    this.html += html;
  }

  private clear(): void {
    for (const c of [...this.children]) c.remove();
    this.ownText = "";
    this.html = "";
  }

  setAttribute(k: string, v: unknown): void {
    if (k === "id") this.id = String(v);
    else if (k === "class") this.className = String(v);
    else if (k.startsWith("data-")) this.dataset[dataKey(k)] = String(v);
    else this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    if (k === "id") return this.id || null;
    if (k === "class") return this.className || null;
    if (k === "disabled") return this.disabled ? "" : null;
    if (k === "hidden") return this.hidden ? "" : null;
    if (k.startsWith("data-")) return this.dataset[dataKey(k)] ?? null;
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.getAttribute(k) !== null;
  }
  removeAttribute(k: string): void {
    if (k.startsWith("data-")) delete this.dataset[dataKey(k)];
    else this.attrs.delete(k);
  }

  appendChild<T extends FakeElement>(c: T): T {
    c.remove();
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...nodes: (FakeElement | string)[]): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        const t = new FakeElement("#text", this.doc);
        t.textContent = n;
        this.appendChild(t);
      } else {
        this.appendChild(n);
      }
    }
  }
  prepend(...nodes: FakeElement[]): void {
    for (const n of [...nodes].reverse()) {
      n.remove();
      n.parentNode = this;
      this.children.unshift(n);
    }
  }
  replaceChildren(...nodes: (FakeElement | string)[]): void {
    this.clear();
    this.append(...nodes);
  }
  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentNode = null;
    if (this.doc.activeElement && (this.doc.activeElement === this || this.contains(this.doc.activeElement))) {
      this.doc.activeElement = this.doc.body;
    }
  }
  contains(other: FakeElement | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  /** In a document (its own root's: a module may keep a node from an earlier test's document). */
  get isConnected(): boolean {
    let root: FakeElement = this;
    while (root.parentNode) root = root.parentNode;
    return root === root.doc.documentElement;
  }

  focus(): void {
    this.doc.activeElement = this;
  }
  blur(): void {
    if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
  }
  /** A click, as a tap or Enter on it would fire (none on a disabled button). */
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent("click"));
  }

  getBoundingClientRect(): typeof ZERO_RECT {
    return { ...ZERO_RECT };
  }
  getClientRects(): (typeof ZERO_RECT)[] {
    return [];
  }
  getContext(): null {
    return null;
  }
  animate(): { finished: Promise<void>; cancel(): void; play(): void; currentTime: number } {
    return { finished: Promise.resolve(), cancel() {}, play() {}, currentTime: 0 };
  }

  matches(selector: string): boolean {
    return selector.split(",").some((s) => matchesChain(this, s.trim().split(/\s+/)));
  }
  closest(selector: string): FakeElement | null {
    for (let n: FakeElement | null = this; n; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeElement): void => {
      for (const c of n.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** One compound selector (no combinators): tag, #id, .class, [attr], [attr="v"], :not(...). */
function matchesCompound(el: FakeElement, sel: string): boolean {
  if (el.tagName === "#TEXT") return false;
  const nots: string[] = [];
  let rest = sel.replace(/:not\(([^)]*)\)/g, (_, inner: string) => {
    nots.push(inner);
    return "";
  });
  const attrs: string[] = [];
  rest = rest.replace(/\[([^\]]*)\]/g, (_, a: string) => {
    attrs.push(a);
    return "";
  });
  const tag = /^[a-zA-Z][\w-]*|^\*/.exec(rest)?.[0] ?? "";
  rest = rest.slice(tag.length);
  if (tag && tag !== "*" && el.tagName !== tag.toUpperCase()) return false;
  for (const part of rest.match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === "#" ? el.id !== part.slice(1) : !el.classList.contains(part.slice(1))) return false;
  }
  for (const a of attrs) {
    const m = /^([\w-]+)(?:="?([^"]*)"?)?$/.exec(a.trim());
    if (!m) return false;
    const v = el.getAttribute(m[1]);
    if (v === null || (m[2] !== undefined && v !== m[2])) return false;
  }
  return nots.every((n) => !matchesCompound(el, n.trim()));
}

/** A descendant chain ("a b c"): the last part matches el, the others its ancestors in order. */
function matchesChain(el: FakeElement, parts: string[]): boolean {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; n && i >= 0; n = n.parentNode) if (matchesCompound(n, parts[i])) i--;
  return i < 0;
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null;

  constructor() {
    super();
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  /** The document is the parent of <html> (for event paths). */
  rootFor(n: FakeElement): FakeNode | null {
    return n === this.documentElement ? this : null;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  querySelector(sel: string): FakeElement | null {
    return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel);
  }
  querySelectorAll(sel: string): FakeElement[] {
    return this.documentElement.querySelectorAll(sel);
  }
  getElementById(id: string): FakeElement | null {
    return this.querySelector(`#${id}`);
  }
}

/**
 * Install a fresh fake document (and the few window globals screens use)
 * for one test. Undo with vi.unstubAllGlobals(). Timers stay whatever the
 * test made them: requestAnimationFrame runs through setTimeout, so fake
 * timers drive it too.
 */
export function installFakeDom(): FakeDocument {
  const doc = new FakeDocument();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => globalThis.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => globalThis.clearTimeout(id));
  vi.stubGlobal("getComputedStyle", () => ({ direction: "ltr", position: "static", getPropertyValue: () => "" }));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  return doc;
}

/** A key press as the document sees it (capture listeners first). */
export function pressKey(doc: FakeDocument, key: string): FakeEvent {
  const e = new FakeEvent("keydown", { key, shiftKey: false });
  (doc.activeElement ?? doc.body).dispatchEvent(e);
  return e;
}

/** A finger tap on `el` that is not a click on a button: pointerdown, then pointerup. */
export function tapOn(el: FakeElement): void {
  el.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 1, clientX: 195, clientY: 420 }));
  el.dispatchEvent(new FakeEvent("pointerup", { pointerId: 1, clientX: 195, clientY: 420 }));
}
