/**
 * "New cards!" welcome: a one-time sheet over Home that introduces the
 * card wave (Stone Golem, Digger, Comet) with their portraits and one-line
 * blurbs. Each row's "Try it" starts that card's trial battle
 * (game/challenges.ts TRIAL_CHALLENGES), which plays with a fixed deck, so
 * it works long before the card unlocks (200 / 400 / 3000 trophies).
 *
 * It plugs into Home through the existing slot API (registerHomeSlot
 * "battle-top"); registerNewCards(ctx) wires it with the app context
 * (starting a challenge needs AppCtx.startChallenge). Closing it, by
 * "Got it", the close button, Escape or a "Try it", sets the seen flag in
 * storage, so it shows once per profile. It waits while Home's pointer hand
 * guides a brand-new player to their first chest (first-hour onboarding).
 */
import type { AppCtx } from "../app/ctx";
import { registerHomeSlot } from "../app/slots";
import type { CardId } from "../game/cards";
import { trialFor, type Challenge } from "../game/challenges";
import { TUTORED_KEY } from "../game/tutorial";
import { arenaArForUnlock, arenaNameForUnlock, unlockTrophiesFor } from "../meta/arenas";
import { blurbText } from "../render/cardBlurbs";
import { cardDisplayName } from "../render/cardNames";
import { makeCardCanvas } from "./cardFrame";
import { button, trapOrder } from "./components";
import { formatNum } from "./i18n";
import { icon } from "./icons";
import { CHEST_PULSE_KEY, CHEST_TAPPED_KEY, chestGuideSlot } from "./screens/home";
import { reducedMotion } from "./prefs";
import { ARABIC } from "../render3d/theme";
import "./styles/newcards.css";

/** Storage key of the seen flag ("1" once the sheet was closed). */
export const NEW_CARDS_SEEN_KEY = "cr-clone-newcards-seen";
/** The wave the sheet introduces, in the order it lists them. */
export const NEW_CARD_IDS: readonly CardId[] = Object.freeze(["stone-golem", "digger", "comet"] as CardId[]);

/** The slice of Storage the seen flag needs (injectable for tests). */
export interface SeenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): SeenStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the sheet was already closed once. Unreadable storage counts as seen (never nag). */
export function newCardsSeen(store: SeenStore | null = defaultStore()): boolean {
  if (!store) return true;
  try {
    return store.getItem(NEW_CARDS_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markNewCardsSeen(store: SeenStore | null = defaultStore()): void {
  try {
    store?.setItem(NEW_CARDS_SEEN_KEY, "1");
  } catch {
    // storage full or blocked: the sheet may show again, which is harmless
  }
}

/**
 * Show the sheet on this Home? Only once, and only after the guided first
 * battle (a brand-new player meets the basics first, then the new cards).
 * `guiding`: Home's pointer hand is showing the kid their first chest right
 * now; the sheet waits for a later Home instead of covering it.
 */
export function shouldShowNewCards(store: SeenStore | null, tutored: boolean, guiding = false): boolean {
  return tutored && !guiding && !newCardsSeen(store);
}

/** The guided first battle is done (tutorialOverlay sets this flag). */
function tutored(store: SeenStore | null): boolean {
  try {
    return store?.getItem(TUTORED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Where a card the player does not own yet comes from. */
export interface LockInfo {
  text: string;
  /** Its arena is reached: it can drop from chests now (else it is still locked). */
  findable: boolean;
}

/**
 * For a card the player does not own yet: "Unlocks in Bone Pit (200
 * trophies)" while its arena is ahead, "Find it in chests" once the player
 * stands in it (the collection's "In chests"). null for an owned card.
 */
export function lockInfo(
  id: CardId,
  owned: ReadonlySet<CardId>,
  trophies: number,
  tr: (en: string, ar: string) => string,
): LockInfo | null {
  if (owned.has(id)) return null;
  const n = unlockTrophiesFor(id);
  if (trophies >= n) return { text: tr("Find it in chests", "ابحث عنها في الصناديق"), findable: true };
  return {
    text: tr(
      `Unlocks in ${arenaNameForUnlock(id)} (${formatNum(n, false)} trophies)`,
      `تُفتح في ${arenaArForUnlock(id)} (${formatNum(n, true)} كأس)`,
    ),
    findable: false,
  };
}

/** lockInfo's line alone. */
export function lockText(
  id: CardId,
  owned: ReadonlySet<CardId>,
  trophies: number,
  tr: (en: string, ar: string) => string,
): string | null {
  return lockInfo(id, owned, trophies, tr)?.text ?? null;
}

/** One row of the sheet: what it shows and which trial its "Try it" starts. */
export interface NewCardRow {
  id: CardId;
  name: string;
  blurb: string;
  /** Where it comes from while the player does not own it, else null. */
  lock: LockInfo | null;
  trial: Challenge | null;
}

/** The sheet's rows, in NEW_CARD_IDS order. */
export function newCardRows(owned: ReadonlySet<CardId>, trophies: number, tr: (en: string, ar: string) => string): NewCardRow[] {
  return NEW_CARD_IDS.map((id) => ({
    id,
    name: cardDisplayName(id),
    blurb: blurbText(id) ?? "",
    lock: lockInfo(id, owned, trophies, tr),
    trial: trialFor(id),
  }));
}

/** What the sheet needs from the app. */
export interface NewCardsDeps {
  tr: (en: string, ar: string) => string;
  /** Start a trial battle (the sheet has already closed itself). */
  startTrial: (ch: Challenge) => void;
  /** Cards the player owns: the others get an "Unlocks in ..." line. */
  owned: () => ReadonlySet<CardId>;
  /** The player's trophies (a reached arena's card reads "Find it in chests"). */
  trophies: () => number;
  /** True while something on Home needs the kid first (the first-chest pointer). */
  guiding?: () => boolean;
  /** Defaults to localStorage. */
  store?: SeenStore | null;
  /** Card art (defaults to the card frame canvas; tests pass a stub). */
  portrait?: (id: CardId) => HTMLElement;
}

/** A built sheet: its element, and how to take it down without marking it seen. */
export interface NewCardsSheet {
  root: HTMLElement;
  /** Remove it and its key listener; it is not marked seen and comes back next time. */
  dispose(): void;
}

/**
 * The sheet itself: a dialog with a title, three card rows (portrait, name,
 * blurb, lock line, "Try it") and "Got it". `close` runs once, whichever
 * way it closes; it marks the sheet seen. Tab and Shift+Tab stay inside it.
 */
export function buildNewCardsSheet(deps: NewCardsDeps, onClosed: () => void = () => {}): NewCardsSheet {
  const { tr } = deps;
  const store = deps.store === undefined ? defaultStore() : deps.store;
  const owned = deps.owned();
  const trophies = deps.trophies();
  const root = document.createElement("div");
  root.className = "nc-backdrop";
  // It mounts on <body>: mirror it for Arabic, and keep it still under reduced motion.
  root.dir = ARABIC ? "rtl" : "ltr";
  root.classList.toggle("nc-calm", reducedMotion());
  const sheet = document.createElement("section");
  sheet.className = "nc-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "nc-title");
  root.appendChild(sheet);

  let closed = false;
  // One signal drops the document key listener however the sheet goes away.
  const keys = new AbortController();
  const takeDown = (): boolean => {
    if (closed) return false;
    closed = true;
    keys.abort();
    root.remove();
    return true;
  };
  const close = (): void => {
    if (!takeDown()) return;
    markNewCardsSeen(store);
    onClosed();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    } else if (ev.key === "Tab") {
      // A modal: focus cycles through the sheet's own buttons.
      const items = Array.from(sheet.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const next = trapOrder(items.length, items.indexOf(document.activeElement as HTMLElement), ev.shiftKey);
      ev.preventDefault();
      if (next >= 0) items[next].focus();
    }
  };
  document.addEventListener("keydown", onKey, { capture: true, signal: keys.signal });
  root.addEventListener("click", (ev) => {
    if (ev.target === root) close(); // a tap outside the sheet
  });

  const head = document.createElement("header");
  head.className = "nc-head";
  const spark = document.createElement("span");
  spark.className = "nc-spark";
  spark.innerHTML = icon("sparkle");
  const title = document.createElement("h2");
  title.id = "nc-title";
  title.className = "nc-title";
  title.textContent = tr("New cards!", "بطاقات جديدة!");
  const x = document.createElement("button");
  x.type = "button";
  x.className = "nc-x";
  x.setAttribute("aria-label", tr("Close", "إغلاق"));
  x.textContent = "×";
  x.addEventListener("click", close);
  head.append(spark, title, x);
  const lead = document.createElement("p");
  lead.className = "nc-lead";
  lead.textContent = tr(
    "Three new cards have arrived. Try each one in its own battle, even before you unlock it!",
    "وصلت ثلاث بطاقات جديدة. جرّب كل واحدة في معركتها الخاصة، حتى قبل أن تفتحها!",
  );
  sheet.append(head, lead);

  const list = document.createElement("ul");
  list.className = "nc-list";
  for (const r of newCardRows(owned, trophies, tr)) {
    const row = document.createElement("li");
    row.className = "nc-card";
    row.dataset.card = r.id;
    const art = (deps.portrait ?? ((c: CardId) => makeCardCanvas(c, { size: 96 })))(r.id);
    art.classList.add("nc-art");
    const text = document.createElement("div");
    text.className = "nc-text";
    const name = document.createElement("b");
    name.className = "nc-name";
    name.textContent = r.name;
    const blurb = document.createElement("p");
    blurb.className = "nc-blurb";
    blurb.textContent = r.blurb;
    text.append(name, blurb);
    if (r.lock) {
      const l = document.createElement("small");
      l.className = "nc-lock" + (r.lock.findable ? " is-findable" : "");
      l.innerHTML = icon(r.lock.findable ? "chest" : "lock");
      l.appendChild(document.createTextNode(r.lock.text));
      text.appendChild(l);
    }
    row.append(art, text);
    const trial = r.trial;
    if (trial) {
      const go = button({
        variant: "cta",
        icon: "play",
        label: tr("Try it", "جرّبها"),
        ariaLabel: tr(`Try the ${r.name}`, `جرّب ${r.name}`),
        onClick: () => {
          close();
          deps.startTrial(trial);
        },
      });
      go.classList.add("nc-try");
      row.appendChild(go);
    }
    list.appendChild(row);
  }
  sheet.appendChild(list);
  const done = button({ variant: "secondary", label: tr("Got it", "حسنًا"), onClick: close });
  done.classList.add("nc-done");
  sheet.appendChild(done);
  // Focus lands inside the dialog (the first "Try it"), for keyboards and screen readers.
  queueMicrotask(() => sheet.querySelector<HTMLButtonElement>(".nc-try, .nc-done")?.focus({ preventScroll: true }));
  return { root, dispose: () => void takeDown() };
}

/**
 * Put the sheet on Home (the "battle-top" slot) until it is closed once.
 * Returns the unregister function.
 */
export function installNewCards(deps: NewCardsDeps): () => void {
  let open: NewCardsSheet | null = null;
  // Set while a slot cleanup waits to take the open sheet down.
  let leaving = false;
  return registerHomeSlot("battle-top", () => {
    const store = deps.store === undefined ? defaultStore() : deps.store;
    if (open && leaving) {
      // Home was rebuilt in the same turn (a redraw): keep the sheet as it is.
      leaving = false;
    } else {
      if (open || !shouldShowNewCards(store, tutored(store), deps.guiding?.() ?? false)) return;
      // Over the whole Home (the slot host scrolls with the tab panel).
      const sheet: NewCardsSheet = buildNewCardsSheet(deps, () => {
        if (open === sheet) open = null;
      });
      open = sheet;
      document.body.appendChild(sheet.root);
    }
    // Home is left (another tab, another screen): take the sheet down
    // without marking it seen, so it comes back on the next Home. A redraw
    // renders the slot again right away and keeps it instead.
    const mine = open;
    return () => {
      if (!mine || open !== mine) return;
      leaving = true;
      queueMicrotask(() => {
        if (!leaving || open !== mine) return;
        leaving = false;
        open = null;
        mine.dispose();
      });
    };
  });
}

/** Is Home's pointer hand bouncing over the first chest now? (home.ts chestGuideSlot) */
function chestGuideShowing(chests: readonly (object | null | undefined)[]): boolean {
  let pulse: string | null = null;
  let tapped: string | null = null;
  try {
    pulse = sessionStorage.getItem(CHEST_PULSE_KEY);
    tapped = localStorage.getItem(CHEST_TAPPED_KEY);
  } catch {
    return false;
  }
  return chestGuideSlot(pulse, tapped, chests) >= 0;
}

/** Wire the sheet to the app: "Try it" leaves Home and starts the trial. */
export function registerNewCards(ctx: AppCtx): () => void {
  return installNewCards({
    tr: ctx.tr,
    owned: () => new Set(ctx.meta.profile.owned),
    trophies: () => ctx.meta.profile.trophies,
    guiding: () => chestGuideShowing(ctx.meta.profile.chests),
    startTrial: (ch) => {
      ctx.closeDeckPicker();
      ctx.startChallenge(ch);
    },
  });
}
