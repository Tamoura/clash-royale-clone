/**
 * Deck editor: tap owned cards to build the 8-card deck. In battle mode a
 * sticky footer starts the bot match and the setup chip row opens Battle
 * Setup; in deck mode the footer saves. A legal deck is also saved when
 * leaving by Back or a tab, so edits are never lost (an unfinished deck
 * says so in a toast).
 *
 * Deck slots (meta/decks.ts): the 1 / 2 / 3 switcher picks the active
 * deck, the one the next battle (bot or online) uses. Switching saves the
 * deck being edited first.
 *
 * Swap mode: with a full deck, tapping a collection card picks it up
 * ("Now tap a card in your deck to swap"); the next tap on a deck card
 * swaps the two in place. Tap the picked card again, Cancel or Esc to
 * drop it.
 *
 * Deck codes (meta/deckCode.ts): Share shows the deck's code with a Copy
 * button; Enter code reads one, flags the cards the player hasn't found
 * and loads the rest into the current slot.
 */
import type { AppCtx, DeckPickerOpts } from "../../app/ctx";
import { DECK, getCard, type CardId } from "../../game/cards";
import { canPutInDeck } from "../../meta/collection";
import { encodeDeck, lockedCards, parseDeckCode, type DeckCodeError } from "../../meta/deckCode";
import {
  SLOT_COUNT,
  SLOT_NAME_MAX,
  loadDeckSlots,
  playableDeck,
  renameSlot,
  saveDeckSlots,
  setActiveSlot,
  setSlotCards,
  type DeckSlotStore,
  type DeckSlots,
} from "../../meta/decks";
import { isOwnedDeck, ownedSet } from "../../meta/progress";
import { cardDisplayName } from "../../render/cardNames";
import { button, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { reducedMotion } from "../prefs";
import { setupChipRow } from "./battleSetup";
import { cardSilhouette } from "./collection";
import { cardTileCanvas } from "./common";
import { mountSubscreen, openSheet, section, sfx } from "./frame";
import "../styles/decks.css";

export function openDeckPicker(ctx: AppCtx, opts: DeckPickerOpts = { mode: "deck" }): void {
  buildDeckPicker(ctx, opts);
}

// ---- Pure editing rules (tested) ----------------------------------------------

/**
 * A locked card from an entered code, kept in the spot it left so the
 * code's hand order survives: it is drawn just before `deck[at]` (after
 * the last card when `at` is past the end).
 */
export interface Ghost {
  id: CardId;
  at: number;
}

export interface EditState {
  /** The deck being edited, in hand order (at most 8). */
  deck: CardId[];
  /** A collection card picked up in swap mode, waiting for a deck card. */
  pending: CardId | null;
  /** Locked cards from an entered code, sorted by `at`. New cards fill their spots first. */
  ghosts?: Ghost[];
}

/**
 * Split an entered code into the cards the player owns (in code order)
 * and ghosts for the locked ones, each in the spot it held in the code.
 */
export function loadCode(cards: readonly CardId[], owned: ReadonlySet<CardId>): { deck: CardId[]; ghosts: Ghost[] } {
  const deck: CardId[] = [];
  const ghosts: Ghost[] = [];
  for (const id of cards) {
    if (owned.has(id)) deck.push(id);
    else ghosts.push({ id, at: deck.length });
  }
  return { deck, ghosts };
}

/** One of the 8 deck spots: a card (with its deck index), a ghost, or empty. */
export type DeckSpot = { card: CardId; index: number } | { ghost: CardId } | null;

/** The 8 spots as drawn: deck cards in order with each ghost in its spot, then empties. */
export function deckSpots(deck: readonly CardId[], ghosts: readonly Ghost[] = []): DeckSpot[] {
  const out: DeckSpot[] = [];
  let g = 0;
  for (let i = 0; i < deck.length; i++) {
    while (g < ghosts.length && ghosts[g].at <= i) out.push({ ghost: ghosts[g++].id });
    out.push({ card: deck[i], index: i });
  }
  while (g < ghosts.length) out.push({ ghost: ghosts[g++].id });
  while (out.length < 8) out.push(null);
  return out.slice(0, 8);
}

export type EditAction =
  /** A tap on a collection card. */
  | { kind: "collection"; id: CardId }
  /** A tap on deck spot `index`. */
  | { kind: "slot"; index: number }
  | { kind: "cancel" };

/**
 * One tap in the deck editor. Returns the next state; `swapped` is the
 * deck index that just changed card in a swap.
 *
 * - Collection card in the deck: removed (in swap mode: swapped out for
 *   the picked-up card).
 * - Collection card not in the deck: added while there is room; with a
 *   full deck it is picked up (swap mode). Tapping it again drops it.
 * - Deck spot: removed (in swap mode: replaced by the picked-up card).
 * - Ghosts (locked cards from a code) keep their spots: an added card
 *   fills the first ghost's spot before it goes to the end.
 */
export function editDeck(s: EditState, a: EditAction): EditState & { swapped?: number } {
  const deck = s.deck.slice();
  let ghosts = (s.ghosts ?? []).map((g) => ({ ...g }));
  const done = (pending: CardId | null, swapped?: number): EditState & { swapped?: number } =>
    swapped === undefined ? { deck, pending, ghosts } : { deck, pending, ghosts, swapped };
  /** Take deck[k] out; ghosts after it move up with the cards. */
  const remove = (k: number): void => {
    deck.splice(k, 1);
    ghosts = ghosts.map((g) => (g.at > k ? { ...g, at: g.at - 1 } : g));
  };
  /** A new card goes into the first ghost's spot, else at the end. */
  const add = (id: CardId): void => {
    const first = ghosts.shift();
    if (!first) {
      deck.push(id);
      return;
    }
    deck.splice(first.at, 0, id);
    ghosts = ghosts.map((g) => ({ ...g, at: g.at + 1 }));
  };
  if (a.kind === "cancel") return done(null);
  if (a.kind === "slot") {
    if (a.index < 0 || a.index >= deck.length) return done(s.pending);
    if (s.pending && !deck.includes(s.pending)) {
      deck[a.index] = s.pending;
      return done(null, a.index);
    }
    remove(a.index);
    return done(null);
  }
  const id = a.id;
  const at = deck.indexOf(id);
  if (s.pending) {
    if (id === s.pending) return done(null);
    if (at >= 0) {
      deck[at] = s.pending;
      return done(null, at);
    }
    return done(id);
  }
  if (at >= 0) {
    remove(at);
    return done(null);
  }
  if (deck.length < 8) {
    add(id);
    return done(null);
  }
  return done(id);
}

/**
 * How far to scroll the editor when swap mode starts (positive = down),
 * so the "Now tap a card in your deck" bar and the deck are in view. It
 * scrolls no further than needed to show the whole deck, and never past
 * the bar; on a screen too short for the bar and a deck row together
 * (phone landscape), the first deck row wins: the next tap goes there.
 * 0 when everything is already in view.
 */
export function swapScroll(
  view: { top: number; bottom: number },
  barTop: number,
  rowBottom: number,
  gridBottom: number,
  margin = 8,
): number {
  const barInView = barTop >= view.top;
  if (barInView && gridBottom <= view.bottom) return 0;
  const toBar = barTop - view.top - margin;
  let d = barInView ? Math.max(0, Math.min(toBar, gridBottom - view.bottom + margin)) : toBar;
  if (rowBottom - d > view.bottom) d = rowBottom - view.bottom + margin;
  return Math.round(d);
}

/** The message for a code that could not be made or read (EN / AR). */
export function codeErrorText(tr: AppCtx["tr"], error: DeckCodeError, detail?: string): string {
  switch (error) {
    case "empty":
      return tr("Type or paste a deck code first.", "اكتب رمز مجموعة أو الصقه أولًا.");
    case "char":
      return tr(
        `Deck codes never use "${detail ?? "?"}". Check that letter.`,
        `رموز المجموعات لا تستخدم "${detail ?? "?"}". راجع هذا الحرف.`,
      );
    case "length": {
      const n = Number(detail ?? 0);
      return tr(
        `A deck code has 12 letters and numbers. This one has ${n}.`,
        `رمز المجموعة فيه ${fmtNum(12)} حرفًا ورقمًا. هذا فيه ${fmtNum(n)}.`,
      );
    }
    case "check":
      return tr("That code has a typo. Check each letter and try again.", "في هذا الرمز خطأ. راجع كل حرف وحاول مجددًا.");
    case "version":
      return tr(
        "That code is from a newer version of the game. Update the game and try again.",
        "هذا الرمز من إصدار أحدث من اللعبة. حدّث اللعبة وحاول مجددًا.",
      );
    case "count":
      return tr("Fill all 8 spots to get a code for this deck.", "املأ الخانات الثماني لتحصل على رمز لهذه المجموعة.");
    case "champion":
      return tr(
        "Your Champion is one of a kind, so it can't be shared. Swap it out to get a code.",
        "بطلك فريد من نوعه، فلا يمكن مشاركته. استبدله لتحصل على رمز.",
      );
    default:
      return tr("That code doesn't make a real deck. Ask for the code again.", "هذا الرمز لا يصنع مجموعة حقيقية. اطلب الرمز مرة أخرى.");
  }
}

// ---- Deck slots ---------------------------------------------------------------

function store(): DeckSlotStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The deck slots, reconciled with the live deck (meta.playerDeck). */
export function readSlots(ctx: AppCtx): DeckSlots {
  return loadDeckSlots(store(), ctx.meta.playerDeck);
}

/** "Deck 2" or the slot's custom name. */
export function slotName(ctx: AppCtx, slots: DeckSlots, i: number): string {
  return slots.slots[i]?.name || ctx.tr(`Deck ${i + 1}`, `مجموعة ${fmtNum(i + 1)}`);
}

/**
 * Make slot i the active deck: the next battle (bot or online) uses it.
 * Returns the new slots.
 */
export function activateSlot(ctx: AppCtx, slots: DeckSlots, i: number): DeckSlots {
  const { meta } = ctx;
  const next = setActiveSlot(slots, i);
  if (next === slots) return slots;
  const deck = playableDeck(next, i, ownedSet(meta.profile.owned));
  const saved = setSlotCards(next, i, deck);
  // Save the slots before persistProfile: its mirror writes into the active slot.
  saveDeckSlots(saved, store());
  meta.playerDeck = deck;
  meta.profile = { ...meta.profile, deck };
  ctx.persistProfile();
  return saved;
}

/**
 * The 1 / 2 / 3 slot switcher (a radio group). `onPick` gets the tapped
 * slot; arrow keys move between slots.
 */
export function slotSwitcher(ctx: AppCtx, slots: DeckSlots, onPick: (i: number) => void): HTMLElement {
  const { tr } = ctx;
  const row = document.createElement("div");
  row.className = "dq-slots";
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-label", tr("Deck slots", "خانات المجموعات"));
  const buttons: HTMLButtonElement[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const b = document.createElement("button");
    b.type = "button";
    const on = i === slots.active;
    b.className = "dq-slot" + (on ? " is-active" : "");
    b.dataset.slot = String(i);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
    const num = document.createElement("span");
    num.className = "dq-slot__num";
    num.textContent = fmtNum(i + 1);
    // The number is in the circle: an unnamed slot just says "Deck".
    const name = document.createElement("span");
    name.className = "dq-slot__name";
    name.textContent = slots.slots[i]?.name || tr("Deck", "مجموعة");
    b.append(num, name);
    b.setAttribute("aria-label", slotName(ctx, slots, i));
    b.addEventListener("click", () => onPick(i));
    buttons.push(b);
    row.appendChild(b);
  }
  row.addEventListener("keydown", (e) => {
    const rtl = row.closest("[dir=rtl]") !== null;
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const dir = e.key === fwd ? 1 : e.key === back ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = ((at < 0 ? slots.active : at) + dir + SLOT_COUNT) % SLOT_COUNT;
    const host = row.parentElement;
    onPick(next);
    host?.querySelector<HTMLButtonElement>(`.dq-slot[data-slot="${next}"]`)?.focus();
  });
  return row;
}

// ---- Clipboard ----------------------------------------------------------------

/** Copy text; false when neither the async clipboard nor execCommand worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // denied or insecure context: try the old way
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---- Sheets: share, enter code, rename ------------------------------------------

/** Eight small tiles; cards not in `owned` show as locked silhouettes. */
function miniDeck(ctx: AppCtx, cards: readonly CardId[], owned?: Set<CardId>): HTMLElement {
  const { tr } = ctx;
  const grid = document.createElement("div");
  grid.className = "dq-mini-deck";
  for (const id of cards) {
    const t = document.createElement("div");
    const locked = owned ? !owned.has(id) : false;
    t.className = `v2-tile v2-tile--static rarity-${getCard(id).rarity}` + (locked ? " is-locked dq-is-locked" : "");
    const art = document.createElement("div");
    art.className = "v2-tile-art";
    art.appendChild(locked ? cardSilhouette(id) : cardTileCanvas(id));
    t.appendChild(art);
    const name = document.createElement("span");
    name.className = "v2-tile-name";
    name.textContent = cardDisplayName(id);
    t.appendChild(name);
    if (locked) {
      const lock = document.createElement("span");
      lock.className = "dq-lock";
      lock.innerHTML = icon("lock");
      t.appendChild(lock);
    }
    t.setAttribute("role", "img");
    t.setAttribute(
      "aria-label",
      locked ? tr(`${cardDisplayName(id)}, not found yet`, `${cardDisplayName(id)}، لم تجدها بعد`) : cardDisplayName(id),
    );
    grid.appendChild(t);
  }
  return grid;
}

/** The code for this deck, big and copyable. */
function openShareSheet(ctx: AppCtx, deck: readonly CardId[], name: string): void {
  const { tr } = ctx;
  const title = tr(`Share ${name}`, `شارك ${name}`);
  const content = document.createElement("div");
  content.className = "dq-sheet";
  const res = encodeDeck(deck);
  if (!res.ok) {
    const p = document.createElement("p");
    p.className = "dq-msg is-error";
    p.textContent = codeErrorText(tr, res.error);
    content.appendChild(p);
    openSheet({ title, content, className: "dq-share" });
    return;
  }
  content.appendChild(miniDeck(ctx, deck));
  const code = document.createElement("output");
  code.className = "dq-code";
  code.dir = "ltr";
  code.textContent = res.code;
  code.setAttribute("aria-label", `${tr("Deck code", "رمز المجموعة")} ${res.code.split("").join(" ")}`);
  content.appendChild(code);
  const hint = document.createElement("p");
  hint.className = "v2-hint dq-hint";
  hint.textContent = tr(
    "Read it out or send it to a friend. They tap Enter code in their deck editor.",
    "اقرأه بصوت عالٍ أو أرسله لصديق. يضغط صديقك أدخل رمزًا في محرر المجموعة.",
  );
  content.appendChild(hint);
  const copy = button({
    variant: "cta",
    size: "lg",
    icon: "copy",
    label: tr("Copy code", "انسخ الرمز"),
    onClick: async () => {
      const ok = await copyText(res.code);
      sfx(ctx, "uiTap");
      if (ok) {
        copy.querySelector(".ui-btn__label")!.textContent = tr("Copied!", "نُسخ!");
        copy.classList.add("is-done");
        toast(tr("Deck code copied", "نُسخ رمز المجموعة"), "success");
      } else {
        // Clipboard blocked: select the code so a long press copies it.
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        toast(tr("Press and hold the code to copy it", "اضغط مطولًا على الرمز لنسخه"), "neutral");
      }
    },
  });
  copy.classList.add("dq-wide");
  content.appendChild(copy);
  openSheet({ title, content, className: "dq-share" });
}

/**
 * Read a code; on "Use", `onUse` gets the whole deck (locked cards
 * included, flagged in the preview) and the sheet closes.
 */
function openCodeSheet(ctx: AppCtx, target: string, owned: Set<CardId>, onUse: (cards: CardId[]) => void): void {
  const { tr } = ctx;
  const content = document.createElement("div");
  content.className = "dq-sheet";
  const hint = document.createElement("p");
  hint.className = "v2-hint dq-hint";
  hint.textContent = tr("Type the 12 letters and numbers of a deck code.", "اكتب الأحرف والأرقام الاثني عشر لرمز المجموعة.");
  const field = document.createElement("div");
  field.className = "dq-field";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "dq-input";
  input.dir = "ltr";
  input.placeholder = "XXXX-XXXX-XXXX";
  input.maxLength = 24;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "characters");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("enterkeyhint", "done");
  input.setAttribute("aria-label", tr("Deck code", "رمز المجموعة"));
  field.appendChild(input);
  if (typeof navigator.clipboard?.readText === "function") {
    const paste = button({
      variant: "secondary",
      icon: "copy",
      label: tr("Paste", "الصق"),
      onClick: async () => {
        try {
          input.value = (await navigator.clipboard.readText()).trim().slice(0, 24);
          check(true);
        } catch {
          toast(tr("Long-press the box and choose Paste", "اضغط مطولًا على الخانة واختر لصق"), "neutral");
          input.focus();
        }
      },
    });
    paste.classList.add("dq-paste");
    field.appendChild(paste);
  }
  const msg = document.createElement("p");
  msg.className = "dq-msg";
  msg.id = `dq-msg-${Math.random().toString(36).slice(2, 8)}`;
  msg.setAttribute("role", "status");
  msg.setAttribute("aria-live", "polite");
  input.setAttribute("aria-describedby", msg.id);
  const preview = document.createElement("div");
  preview.className = "dq-preview";
  const use = button({
    variant: "cta",
    size: "lg",
    icon: "check",
    label: tr(`Use in ${target}`, `استخدمها في ${target}`),
    onClick: () => {
      const cards = check(true);
      if (!cards) return;
      sfx(ctx, "uiTap");
      s.close();
      onUse(cards);
    },
  });
  use.classList.add("dq-wide");
  use.disabled = true;

  /** Validate. `loud` also reports a half-typed code. Returns the cards when good. */
  function check(loud: boolean): CardId[] | null {
    const r = parseDeckCode(input.value);
    preview.innerHTML = "";
    msg.className = "dq-msg";
    msg.textContent = "";
    use.disabled = !r.ok;
    if (!r.ok) {
      // While typing, a short code is just unfinished, not wrong.
      const typing = (r.error === "length" && Number(r.detail) < 12) || r.error === "empty";
      if (loud || !typing) {
        msg.textContent = codeErrorText(tr, r.error, r.detail);
        msg.classList.add("is-error");
        if (loud) {
          input.classList.remove("is-shake");
          void input.offsetWidth; // restart the shake
          input.classList.add("is-shake");
        }
      }
      return null;
    }
    input.value = r.code;
    preview.appendChild(miniDeck(ctx, r.cards, owned));
    const locked = lockedCards(r.cards, owned);
    if (locked.length === 0) {
      msg.textContent = tr("A real deck! You have every card in it.", "مجموعة حقيقية! لديك كل بطاقاتها.");
      msg.classList.add("is-ok");
    } else {
      const names = locked.map(cardDisplayName).join(tr(", ", "، "));
      msg.textContent = tr(
        `${locked.length === 1 ? "1 card is" : `${locked.length} cards are`} still locked: ${names}. You'll pick others for those spots.`,
        `${fmtNum(locked.length)} من البطاقات ما زالت مقفلة: ${names}. ستختار غيرها لتلك الخانات.`,
      );
      msg.classList.add("is-warn");
    }
    return r.cards;
  }
  input.addEventListener("input", () => check(false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (check(true)) use.click();
    }
  });
  input.addEventListener("animationend", () => input.classList.remove("is-shake"));
  content.append(hint, field, msg, preview, use);
  const s = openSheet({ title: tr("Enter a deck code", "أدخل رمز مجموعة"), content, className: "dq-enter" });
  window.setTimeout(() => input.focus({ preventScroll: true }), 120);
}

function openRenameSheet(ctx: AppCtx, current: string, fallback: string, onSave: (name: string) => void): void {
  const { tr } = ctx;
  const content = document.createElement("div");
  content.className = "dq-sheet";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "dq-input dq-input--name";
  input.value = current;
  input.placeholder = fallback;
  input.maxLength = SLOT_NAME_MAX;
  input.autocomplete = "off";
  input.setAttribute("enterkeyhint", "done");
  input.setAttribute("aria-label", tr("Deck name", "اسم المجموعة"));
  const save = button({
    variant: "cta",
    size: "lg",
    icon: "save",
    label: tr("Save name", "احفظ الاسم"),
    onClick: () => {
      sfx(ctx, "uiTap");
      s.close();
      onSave(input.value);
    },
  });
  save.classList.add("dq-wide");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save.click();
    }
  });
  const hint = document.createElement("p");
  hint.className = "v2-hint dq-hint";
  hint.textContent = tr("Leave it empty to use the number.", "اتركه فارغًا لاستخدام الرقم.");
  content.append(input, hint, save);
  const s = openSheet({ title: tr("Name this deck", "سمِّ هذه المجموعة"), content, className: "dq-rename" });
  window.setTimeout(() => input.focus({ preventScroll: true }), 120);
}

// ---- The editor ---------------------------------------------------------------

/** The open editor's Esc listener on document; aborted when the editor goes. */
let editorKeys: AbortController | null = null;

function buildDeckPicker(ctx: AppCtx, opts: DeckPickerOpts): void {
  const { meta, tr } = ctx;
  const battle = opts.mode === "battle";
  const owned = ownedSet(meta.profile.owned);
  let slots = readSlots(ctx);
  // Locked cards from an entered code (edit.ghosts) show greyed in the spots they left.
  let edit: EditState = { deck: meta.playerDeck.filter((id) => owned.has(id)).slice(0, 8), pending: null };
  let lastSwapped = -1;
  // A new editor replaces the old one: drop the old one's Esc listener.
  editorKeys?.abort();
  const keys = new AbortController();
  editorKeys = keys;
  const stopKeys = (): void => {
    keys.abort();
    if (editorKeys === keys) editorKeys = null;
  };

  const switcherHost = document.createElement("div");
  switcherHost.className = "dq-slots-row";
  const swapBar = document.createElement("div");
  swapBar.className = "dq-swapbar";
  swapBar.hidden = true;
  const swapLive = document.createElement("p");
  swapLive.className = "dq-sr";
  swapLive.setAttribute("aria-live", "polite");
  const deckGrid = document.createElement("div");
  deckGrid.className = "v2-grid v2-grid--deck v2-deck-slots";
  const summary = document.createElement("p");
  summary.className = "v2-deck-summary";
  const grid = document.createElement("div");
  grid.className = "v2-grid v2-pick-grid";
  const hint = document.createElement("p");
  hint.className = "v2-hint";

  const dirty = (): boolean => edit.deck.join() !== slots.slots[slots.active].cards.join();

  function commitDeck(): boolean {
    if (!isOwnedDeck(edit.deck, owned)) return false;
    meta.playerDeck = edit.deck.slice();
    meta.profile = { ...meta.profile, deck: meta.playerDeck };
    slots = setSlotCards(slots, slots.active, meta.playerDeck);
    saveDeckSlots(slots, store());
    ctx.persistProfile();
    return true;
  }
  /** Save on the way out; say so when an unfinished deck can't be kept. */
  function commitOrWarn(): void {
    if (commitDeck() || !dirty()) return;
    const name = slotName(ctx, slots, slots.active);
    toast(tr(`${name} was not changed: a deck needs 8 cards.`, `لم تتغير ${name}: المجموعة تحتاج ${fmtNum(8)} بطاقات.`), "danger");
  }

  const footer = document.createElement("div");
  const main = battle
    ? button({
        variant: "cta",
        size: "lg",
        icon: "sword",
        label: tr("Battle", "قتال"),
        ariaLabel: "Start a battle against the bot",
        onClick: () => {
          if (!commitDeck()) return;
          sfx(ctx, "uiTap");
          stopKeys();
          ctx.closeDeckPicker();
          ctx.startLadder();
        },
      })
    : button({
        variant: "cta",
        size: "lg",
        icon: "save",
        label: tr("Save deck", "حفظ المجموعة"),
        ariaLabel: "Save deck",
        onClick: () => {
          if (!commitDeck()) return;
          sfx(ctx, "uiTap");
          stopKeys();
          ctx.openHome();
        },
      });
  footer.appendChild(main);

  function apply(a: EditAction): void {
    const before = edit.pending;
    const next = editDeck(edit, a);
    edit = { deck: next.deck, pending: next.pending, ghosts: next.ghosts };
    lastSwapped = next.swapped ?? -1;
    if (next.swapped !== undefined) sfx(ctx, "uiTap");
    sync();
    if (edit.pending && edit.pending !== before) revealSwap();
  }

  /** Bring the swap prompt and the deck into view (the kid's next tap goes there). */
  function revealSwap(): void {
    const body = swapBar.closest<HTMLElement>(".v2-screen-body");
    const row = deckGrid.firstElementChild as HTMLElement | null;
    const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
    if (!body || !row) {
      swapBar.scrollIntoView({ block: "start", behavior });
      return;
    }
    // Layout offsets, not boxes: the bar drops in and the deck cards wiggle (transforms).
    const v = body.getBoundingClientRect();
    const gridTop = deckGrid.getBoundingClientRect().top;
    const d = swapScroll(
      { top: v.top, bottom: v.bottom },
      gridTop - (deckGrid.offsetTop - swapBar.offsetTop),
      gridTop + row.offsetHeight,
      gridTop + deckGrid.offsetHeight,
    );
    if (d) body.scrollBy({ top: d, behavior });
  }

  function pickSlot(i: number): void {
    if (i === slots.active) return;
    commitOrWarn();
    slots = activateSlot(ctx, slots, i);
    edit = { deck: meta.playerDeck.slice(), pending: null };
    lastSwapped = -1;
    sfx(ctx, "uiTap");
    drawSwitcher();
    sync();
  }

  const rename = button({
    variant: "secondary",
    icon: "pencil",
    label: tr("Name", "الاسم"),
    onClick: () => {
      const i = slots.active;
      openRenameSheet(ctx, slots.slots[i].name, tr(`Deck ${i + 1}`, `مجموعة ${fmtNum(i + 1)}`), (n) => {
        slots = renameSlot(slots, i, n);
        saveDeckSlots(slots, store());
        drawSwitcher();
      });
    },
  });
  rename.classList.add("v2-head-btn", "dq-rename-btn");

  function drawSwitcher(): void {
    switcherHost.innerHTML = "";
    switcherHost.appendChild(slotSwitcher(ctx, slots, pickSlot));
    const name = slotName(ctx, slots, slots.active);
    rename.setAttribute("aria-label", tr(`Rename ${name}`, `أعد تسمية ${name}`));
  }

  function useCode(cards: CardId[]): void {
    // The code's hand order stays: locked cards wait as ghosts in their own spots.
    edit = { ...loadCode(cards, owned), pending: null };
    lastSwapped = -1;
    const name = slotName(ctx, slots, slots.active);
    const locked = (edit.ghosts ?? []).map((g) => cardDisplayName(g.id));
    if (commitDeck()) {
      toast(tr(`New deck in ${name}!`, `مجموعة جديدة في ${name}!`), "success");
    } else {
      const names = locked.join(tr(", ", "، "));
      toast(
        locked.length === 1
          ? tr(
              `Deck loaded! ${names} is still locked: pick another card for its spot.`,
              `حُمّلت المجموعة! ${names} ما زالت مقفلة: اختر بطاقة أخرى لخانتها.`,
            )
          : tr(
              `Deck loaded! ${names} are still locked: pick other cards for their spots.`,
              `حُمّلت المجموعة! ${names} ما زالت مقفلة: اختر بطاقات أخرى لخاناتها.`,
            ),
        "neutral",
      );
    }
    sync();
  }

  function deckSpot(s: DeckSpot): HTMLButtonElement {
    const spot = document.createElement("button");
    spot.type = "button";
    if (s && "card" in s) {
      const { card: id, index: i } = s;
      spot.className = `v2-tile rarity-${getCard(id).rarity}` + (i === lastSwapped ? " dq-swapped" : "");
      spot.dataset.deckCard = id;
      const art = document.createElement("div");
      art.className = "v2-tile-art";
      art.appendChild(cardTileCanvas(id));
      spot.appendChild(art);
      const cost = document.createElement("span");
      cost.className = "v2-cost";
      cost.textContent = fmtNum(getCard(id).cost);
      spot.appendChild(cost);
      const name = cardDisplayName(id);
      if (edit.pending) {
        const p = cardDisplayName(edit.pending);
        spot.classList.add("dq-target");
        spot.setAttribute("aria-label", tr(`Swap ${name} for ${p}`, `استبدل ${name} بـ ${p}`));
      } else {
        spot.setAttribute("aria-label", tr(`Remove ${name}`, `أزل ${name}`));
      }
      spot.addEventListener("click", () => apply({ kind: "slot", index: i }));
      return spot;
    }
    spot.className = "v2-tile is-empty";
    spot.disabled = true;
    if (s) {
      const ghost = s.ghost;
      spot.classList.add("dq-ghost");
      spot.dataset.ghost = ghost;
      const art = document.createElement("div");
      art.className = "v2-tile-art";
      art.appendChild(cardSilhouette(ghost));
      spot.appendChild(art);
      const lock = document.createElement("span");
      lock.className = "dq-lock";
      lock.innerHTML = icon("lock");
      spot.appendChild(lock);
      // Which locked card this spot stands for (a kid copying a sibling's deck needs to know).
      const label = document.createElement("span");
      label.className = "v2-tile-name";
      label.textContent = cardDisplayName(ghost);
      spot.appendChild(label);
      spot.setAttribute(
        "aria-label",
        tr(`Empty: ${cardDisplayName(ghost)} is not found yet. Pick another card.`, `فارغة: ${cardDisplayName(ghost)} لم تجدها بعد. اختر بطاقة أخرى.`),
      );
    } else {
      spot.setAttribute("aria-label", tr("Empty slot", "خانة فارغة"));
    }
    return spot;
  }

  function sync(): void {
    const { deck, pending } = edit;
    deckGrid.innerHTML = "";
    for (const s of deckSpots(deck, edit.ghosts)) deckGrid.appendChild(deckSpot(s));
    deckGrid.classList.toggle("dq-swapping", !!pending);

    swapBar.innerHTML = "";
    swapBar.hidden = !pending;
    swapLive.textContent = "";
    if (pending) {
      const mini = document.createElement("div");
      mini.className = `v2-tile v2-tile--mini v2-tile--static rarity-${getCard(pending).rarity}`;
      mini.appendChild(cardTileCanvas(pending));
      const text = document.createElement("p");
      text.className = "dq-swapbar__text";
      text.textContent = tr("Now tap a card in your deck to swap", "الآن اضغط بطاقة في مجموعتك للتبديل");
      swapLive.textContent = tr(
        `Now tap a card in your deck to swap it for ${cardDisplayName(pending)}.`,
        `الآن اضغط بطاقة في مجموعتك لتستبدلها بـ ${cardDisplayName(pending)}.`,
      );
      const cancel = button({
        variant: "secondary",
        label: tr("Cancel", "إلغاء"),
        onClick: () => apply({ kind: "cancel" }),
      });
      cancel.classList.add("dq-swapbar__cancel");
      swapBar.append(mini, text, cancel);
    }

    const costs = deck.map((id) => getCard(id).cost);
    const avg = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0;
    summary.innerHTML = icon("elixir");
    const t = document.createElement("span");
    t.textContent = tr(
      `${fmtNum(deck.length)} / ${fmtNum(8)} cards · average ${fmtNum(Number(avg.toFixed(1)))} elixir`,
      `${fmtNum(deck.length)} / ${fmtNum(8)} بطاقات · متوسط الإكسير ${fmtNum(Number(avg.toFixed(1)))}`,
    );
    summary.appendChild(t);
    summary.classList.toggle("is-short", deck.length < 8);
    main.disabled = !isOwnedDeck(deck, owned);
    hint.textContent =
      deck.length >= 8
        ? tr("Your deck is full: tap a card to swap it in.", "مجموعتك ممتلئة: اضغط بطاقة لتبدّلها.")
        : tr("Tap a card to add or remove it.", "اضغط بطاقة لإضافتها أو إزالتها.");
    grid.querySelectorAll<HTMLButtonElement>("button[data-card]").forEach((b) => {
      const id = b.dataset.card as CardId;
      const on = deck.includes(id);
      b.classList.toggle("is-chosen", on);
      b.classList.toggle("dq-pending", id === pending);
      b.setAttribute("aria-pressed", String(on || id === pending));
    });
  }

  for (const id of DECK) {
    if (!owned.has(id)) continue;
    const card = getCard(id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = `v2-tile rarity-${card.rarity}`;
    b.dataset.card = id;
    b.setAttribute("aria-label", tr(`${cardDisplayName(id)}, ${card.cost} elixir`, `${cardDisplayName(id)}، ${card.cost} إكسير`));
    const art = document.createElement("div");
    art.className = "v2-tile-art";
    art.appendChild(cardTileCanvas(id));
    b.appendChild(art);
    const cost = document.createElement("span");
    cost.className = "v2-cost";
    cost.textContent = fmtNum(card.cost);
    b.appendChild(cost);
    const name = document.createElement("span");
    name.className = "v2-tile-name";
    name.textContent = cardDisplayName(id);
    b.appendChild(name);
    const tick = document.createElement("span");
    tick.className = "v2-tile-tick";
    tick.innerHTML = icon("check");
    b.appendChild(tick);
    b.addEventListener("click", () => {
      if (!canPutInDeck(id, owned)) return;
      apply({ kind: "collection", id });
    });
    grid.appendChild(b);
  }

  const codeRow = document.createElement("div");
  codeRow.className = "dq-code-row";
  const share = button({
    variant: "secondary",
    icon: "share",
    label: tr("Share deck", "شارك المجموعة"),
    onClick: () => {
      sfx(ctx, "uiTap");
      openShareSheet(ctx, edit.deck, slotName(ctx, slots, slots.active));
    },
  });
  share.classList.add("dq-share-btn");
  const enter = button({
    variant: "secondary",
    icon: "text",
    label: tr("Enter code", "أدخل رمزًا"),
    onClick: () => {
      sfx(ctx, "uiTap");
      openCodeSheet(ctx, slotName(ctx, slots, slots.active), owned, useCode);
    },
  });
  enter.classList.add("dq-enter-btn");
  codeRow.append(share, enter);

  const { root } = mountSubscreen(ctx, {
    id: "deckPicker",
    title: battle ? tr("Battle deck", "مجموعة المعركة") : tr("Edit deck", "تعديل المجموعة"),
    footer,
    onLeave: () => {
      stopKeys();
      commitOrWarn();
    },
    build: (body) => {
      const d = section(tr("Your deck", "مجموعتك"), rename);
      d.el.classList.add("dq-deck");
      // The switcher lives in the head: its own row on phones, inline next
      // to Name on short (landscape) screens, so the deck stays in view.
      d.head.classList.add("dq-deck-head");
      d.head.appendChild(switcherHost);
      d.el.append(swapBar, swapLive, deckGrid, summary, codeRow);
      body.appendChild(d.el);
      if (battle) {
        const holder = document.createElement("div");
        holder.className = "v2-setup-holder";
        const draw = (): void => {
          holder.innerHTML = "";
          holder.appendChild(setupChipRow(ctx, draw));
        };
        draw();
        body.appendChild(holder);
      }
      const toCollection = button({
        variant: "secondary",
        icon: "book",
        label: tr("Collection", "المجموعة"),
        onClick: () => {
          stopKeys();
          commitOrWarn();
          ctx.openCollection();
        },
      });
      toCollection.classList.add("v2-head-btn");
      const c = section(tr("Your cards", "بطاقاتك"), toCollection);
      c.el.appendChild(hint);
      c.el.appendChild(grid);
      body.appendChild(c.el);
    },
  });
  // Esc drops a picked-up card (an open sheet takes its own Esc first).
  // Removed on every way out (Back, tabs, Save, Battle, Collection, the next
  // editor), and as a last guard on the first key press after the editor left.
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      stopKeys();
      return;
    }
    if (e.key !== "Escape" || e.defaultPrevented || !edit.pending || document.querySelector(".ui-sheet")) return;
    e.preventDefault();
    apply({ kind: "cancel" });
  };
  document.addEventListener("keydown", onKey, { signal: keys.signal });
  drawSwitcher();
  sync();
}
